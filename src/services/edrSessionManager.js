const crypto = require('crypto');
const { Op } = require('sequelize');
const { UserSession } = require('../models');
const logger = require('../utils/logger');

class EDRSessionManager {
    constructor() {
        // Inactivity window for auto-restore. Default to 24h.
        this.retentionHours = parseInt(process.env.USER_SESSION_RETENTION_HOURS || '24', 10);
        this.sessionTimeout = this.retentionHours * 60 * 60 * 1000;
        this.maxConcurrentSessions = 5;
        this.riskThresholds = {
            low: 25,
            medium: 50,
            high: 75,
            critical: 90
        };
        
        // Start cleanup interval
        this.startCleanupInterval();
    }

    /**
     * Create a new user session with comprehensive EDR tracking
     */
    async createSession(userData, req) {
        try {
            const sessionId = this.generateSecureSessionId();
            const deviceFingerprint = this.generateDeviceFingerprint(req);
            const sessionMetadata = await this.collectSessionMetadata(req);
            
            // Check for concurrent sessions and security risks
            await this.enforceConcurrentSessionLimit(userData.username);
            const riskScore = await this.calculateInitialRiskScore(userData, req);
            
            const expiresAt = new Date(Date.now() + this.sessionTimeout);
            
            const session = await UserSession.create({
                session_id: sessionId,
                user_id: userData.user_id || userData.username,
                username: userData.username,
                user_role: userData.role || 'user',
                ip_address: this.getClientIP(req),
                user_agent: req.headers['user-agent'] || 'Unknown',
                device_fingerprint: deviceFingerprint,
                location_data: sessionMetadata.location,
                session_metadata: sessionMetadata,
                security_events: [],
                activity_log: [{
                    timestamp: new Date(),
                    action: 'session_created',
                    details: 'User session initialized',
                    ip_address: this.getClientIP(req)
                }],
                risk_score: riskScore,
                anomaly_flags: [],
                expires_at: expiresAt
            });

            logger.info('EDR Session created', {
                session_id: sessionId,
                username: userData.username,
                ip_address: this.getClientIP(req),
                risk_score: riskScore,
                device_fingerprint: deviceFingerprint
            });

            return {
                sessionId,
                session: session,
                expiresAt: expiresAt
            };

        } catch (error) {
            logger.error('Failed to create EDR session', { error: error.message });
            throw error;
        }
    }

    /**
     * Validate and update session activity
     */
    async validateSession(sessionId, req) {
        try {
            const session = await UserSession.findByPk(sessionId);
            
            if (!session) {
                return { valid: false, reason: 'Session not found' };
            }

            // Check session status - do not validate logged_out, expired, or terminated sessions
            if (session.session_status !== 'active') {
                return { valid: false, reason: `Session status is ${session.session_status}` };
            }

            // Check absolute expiry time (does not reset on activity)
            if (session.expires_at) {
                const expiresAt = new Date(session.expires_at);
                const now = new Date();
                
                if (now >= expiresAt) {
                    await this.terminateSession(sessionId, 'expired');
                    return { valid: false, reason: 'Session expired' };
                }
            }

            // Update activity and perform security checks
            const securityCheck = await this.performSecurityChecks(session, req);
            await this.updateSessionActivity(session, req, securityCheck);

            return { 
                valid: true, 
                session: session,
                securityStatus: securityCheck 
            };

        } catch (error) {
            logger.error('Session validation failed', { sessionId, error: error.message });
            return { valid: false, reason: 'Validation error' };
        }
    }

    /**
     * Update session activity with EDR tracking
     */
    async updateSessionActivity(session, req, securityCheck = null) {
        try {
            const now = new Date();
            const activityEntry = {
                timestamp: now,
                action: 'activity_update',
                ip_address: this.getClientIP(req),
                user_agent: req.headers['user-agent'],
                endpoint: req.path || 'unknown'
            };

            // Add security events if any, ensuring arrays are normalized for legacy data
            let securityEvents = this.coerceArray(session.security_events);
            let anomalyFlags = this.coerceArray(session.anomaly_flags);
            
            if (securityCheck && securityCheck.events.length > 0) {
                securityEvents = [...securityEvents, ...securityCheck.events];
                activityEntry.security_events = securityCheck.events;
            }

            if (securityCheck && securityCheck.anomalies.length > 0) {
                anomalyFlags = [...anomalyFlags, ...securityCheck.anomalies];
            }

            // Update activity log (keep last 100 entries)
            let activityLog = this.coerceArray(session.activity_log);
            activityLog.push(activityEntry);
            if (activityLog.length > 100) {
                activityLog = activityLog.slice(-100);
            }

            // Update risk score
            const newRiskScore = await this.recalculateRiskScore(session, securityCheck);

            await session.update({
                last_activity: now,
                activity_log: activityLog,
                security_events: securityEvents,
                anomaly_flags: anomalyFlags,
                risk_score: newRiskScore
            });

            // Log high-risk activities
            if (newRiskScore > this.riskThresholds.high) {
                logger.warn('High-risk session activity detected', {
                    session_id: session.session_id,
                    username: session.username,
                    risk_score: newRiskScore,
                    recent_events: securityCheck?.events || []
                });
            }

        } catch (error) {
            logger.error('Failed to update session activity', { 
                sessionId: session.session_id, 
                error: error.message 
            });
        }
    }

    /**
     * Terminate session with reason logging
     */
    async terminateSession(sessionId, reason = 'user_logout') {
        try {
            const session = await UserSession.findByPk(sessionId);
            if (!session) return false;

            const now = new Date();
            const sessionDuration = now - new Date(session.login_time);

            await session.update({
                logout_time: now,
                session_status: reason === 'timeout' ? 'expired' : 'logged_out',
                logout_reason: reason,
                activity_log: [
                    ...(session.activity_log || []),
                    {
                        timestamp: now,
                        action: 'session_terminated',
                        reason: reason,
                        duration_ms: sessionDuration
                    }
                ]
            });

            logger.info('EDR Session terminated', {
                session_id: sessionId,
                username: session.username,
                reason: reason,
                duration_minutes: Math.round(sessionDuration / 60000),
                final_risk_score: session.risk_score
            });

            return true;
        } catch (error) {
            logger.error('Failed to terminate session', { sessionId, error: error.message });
            return false;
        }
    }

    /**
     * Get comprehensive session analytics
     */
    async getSessionAnalytics(timeframe = 24) {
        try {
            const since = new Date(Date.now() - timeframe * 60 * 60 * 1000);
            
            const sessions = await UserSession.findAll({
                where: {
                    created_at: {
                        [require('sequelize').Op.gte]: since
                    }
                },
                order: [['created_at', 'DESC']]
            });

            const analytics = {
                totalSessions: sessions.length,
                activeSessions: sessions.filter(s => s.session_status === 'active').length,
                averageSessionDuration: 0,
                riskDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
                topUsers: {},
                securityEvents: 0,
                anomalies: 0,
                ipAddresses: new Set(),
                userAgents: new Set()
            };

            sessions.forEach(session => {
                // Calculate session duration
                const endTime = session.logout_time || new Date();
                const duration = endTime - new Date(session.login_time);
                analytics.averageSessionDuration += duration;

                // Risk distribution
                const riskScore = session.risk_score || 0;
                if (riskScore < this.riskThresholds.low) analytics.riskDistribution.low++;
                else if (riskScore < this.riskThresholds.medium) analytics.riskDistribution.medium++;
                else if (riskScore < this.riskThresholds.high) analytics.riskDistribution.high++;
                else analytics.riskDistribution.critical++;

                // Top users
                analytics.topUsers[session.username] = (analytics.topUsers[session.username] || 0) + 1;

                // Security events and anomalies
                analytics.securityEvents += (session.security_events || []).length;
                analytics.anomalies += (session.anomaly_flags || []).length;

                // IP addresses and user agents
                analytics.ipAddresses.add(session.ip_address);
                analytics.userAgents.add(session.user_agent);
            });

            analytics.averageSessionDuration = sessions.length > 0 ? 
                Math.round(analytics.averageSessionDuration / sessions.length / 60000) : 0;
            
            analytics.uniqueIPs = analytics.ipAddresses.size;
            analytics.uniqueUserAgents = analytics.userAgents.size;
            delete analytics.ipAddresses;
            delete analytics.userAgents;

            return analytics;
        } catch (error) {
            logger.error('Failed to get session analytics', { error: error.message });
            throw error;
        }
    }

    // Helper methods
    generateSecureSessionId() {
        return crypto.randomBytes(32).toString('hex');
    }

    generateDeviceFingerprint(req) {
        const components = [
            req.headers['user-agent'] || '',
            req.headers['accept-language'] || '',
            req.headers['accept-encoding'] || '',
            this.getClientIP(req)
        ];
        return crypto.createHash('sha256').update(components.join('|')).digest('hex');
    }

    async collectSessionMetadata(req) {
        return {
            timestamp: new Date(),
            headers: {
                userAgent: req.headers['user-agent'],
                acceptLanguage: req.headers['accept-language'],
                acceptEncoding: req.headers['accept-encoding']
            },
            connection: {
                remoteAddress: req.connection?.remoteAddress,
                remotePort: req.connection?.remotePort
            },
            location: null // Could integrate with GeoIP service
        };
    }

    getClientIP(req) {
        return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
               req.headers['x-real-ip'] ||
               req.connection?.remoteAddress ||
               req.socket?.remoteAddress ||
               '127.0.0.1';
    }

    async calculateInitialRiskScore(userData, req) {
        let risk = 0;
        
        // Base risk factors
        if (userData.role === 'administrator') risk += 10;
        
        // Check for suspicious IP patterns
        const ip = this.getClientIP(req);
        if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.')) {
            risk += 0; // Internal network
        } else {
            risk += 15; // External access
        }
        
        return Math.min(risk, 100);
    }

    async performSecurityChecks(session, req) {
        const events = [];
        const anomalies = [];
        
        // IP address change detection
        const currentIP = this.getClientIP(req);
        if (session.ip_address !== currentIP) {
            events.push({
                timestamp: new Date(),
                type: 'ip_change',
                severity: 'medium',
                details: `IP changed from ${session.ip_address} to ${currentIP}`
            });
        }
        
        // User agent change detection
        const currentUA = req.headers['user-agent'];
        if (session.user_agent !== currentUA) {
            events.push({
                timestamp: new Date(),
                type: 'user_agent_change',
                severity: 'low',
                details: 'User agent string changed during session'
            });
        }
        
        return { events, anomalies };
    }

    async recalculateRiskScore(session, securityCheck) {
        let currentRisk = session.risk_score || 0;
        
        if (securityCheck) {
            // Increase risk based on security events
            securityCheck.events.forEach(event => {
                switch (event.severity) {
                    case 'low': currentRisk += 5; break;
                    case 'medium': currentRisk += 15; break;
                    case 'high': currentRisk += 30; break;
                    case 'critical': currentRisk += 50; break;
                }
            });
        }
        
        return Math.min(currentRisk, 100);
    }

    async enforceConcurrentSessionLimit(username) {
        const activeSessions = await UserSession.count({
            where: {
                username: username,
                session_status: 'active'
            }
        });

        if (activeSessions >= this.maxConcurrentSessions) {
            // Terminate oldest session
            const oldestSession = await UserSession.findOne({
                where: {
                    username: username,
                    session_status: 'active'
                },
                order: [['last_activity', 'ASC']]
            });

            if (oldestSession) {
                await this.terminateSession(oldestSession.session_id, 'concurrent_limit_exceeded');
            }
        }
    }

    coerceArray(value) {
        if (Array.isArray(value)) return [...value];
        if (!value) return [];
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? [...parsed] : [];
            } catch (error) {
                logger.debug('Failed to parse legacy array payload', { error: error.message });
                return [];
            }
        }
        return [];
    }

    startCleanupInterval() {
        // Clean up expired sessions every 5 minutes
        setInterval(async () => {
            try {
                const expiredTime = new Date(Date.now() - this.sessionTimeout);
                await UserSession.update(
                    { 
                        session_status: 'expired',
                        logout_time: new Date()
                    },
                    {
                        where: {
                            session_status: 'active',
                            last_activity: { [Op.lt]: expiredTime }
                        }
                    }
                );

                // Purge sessions older than retention window (24h by default)
                const retentionCutoff = new Date(Date.now() - this.retentionHours * 60 * 60 * 1000);
                const deleted = await UserSession.destroy({
                    where: {
                        [Op.or]: [
                            // Any non-active session with logout_time older than cutoff
                            {
                                session_status: { [Op.ne]: 'active' },
                                logout_time: { [Op.ne]: null, [Op.lt]: retentionCutoff }
                            },
                            // Non-active sessions with last update older than cutoff
                            {
                                session_status: { [Op.in]: ['expired', 'terminated', 'logged_out'] },
                                updated_at: { [Op.lt]: retentionCutoff }
                            }
                        ]
                    }
                });
                if (deleted > 0) {
                    logger.info('Purged old user sessions', { count: deleted, retentionHours: this.retentionHours });
                }
            } catch (error) {
                logger.error('Session cleanup failed', { error: error.message });
            }
        }, 5 * 60 * 1000);
    }

    /**
     * Purge expired sessions and delete historical sessions older than retention
     * Returns { expiredUpdated, deletedOld }
     */
    async purgeExpiredAndOldSessions() {
        try {
            const expiredTime = new Date(Date.now() - this.sessionTimeout);
            const [expiredUpdated] = await UserSession.update(
                { session_status: 'expired', logout_time: new Date() },
                { where: { session_status: 'active', last_activity: { [Op.lt]: expiredTime } } }
            );

            const retentionCutoff = new Date(Date.now() - this.retentionHours * 60 * 60 * 1000);
            const deletedOld = await UserSession.destroy({
                where: {
                    [Op.or]: [
                        { session_status: { [Op.ne]: 'active' }, logout_time: { [Op.ne]: null, [Op.lt]: retentionCutoff } },
                        { session_status: { [Op.in]: ['expired', 'terminated', 'logged_out'] }, updated_at: { [Op.lt]: retentionCutoff } }
                    ]
                }
            });
            return { expiredUpdated, deletedOld };
        } catch (error) {
            logger.error('Manual purge failed', { error: error.message });
            throw error;
        }
    }

    async getSessionDetails(sessionId) {
        if (!sessionId) return null;
        const session = await UserSession.findByPk(sessionId);
        if (!session) return null;

        const plain = session.get({ plain: true });
        const activityLog = this.coerceArray(plain.activity_log).slice(-50);
        const securityEvents = this.coerceArray(plain.security_events);
        const anomalyFlags = this.coerceArray(plain.anomaly_flags);

        const loginTime = plain.login_time ? new Date(plain.login_time) : null;
        const lastActivity = plain.last_activity ? new Date(plain.last_activity) : null;
        const logoutTime = plain.logout_time ? new Date(plain.logout_time) : null;
        const now = new Date();
        const durationMs = loginTime ? ((logoutTime || now) - loginTime) : 0;

        return {
            sessionId: plain.session_id,
            username: plain.username,
            role: plain.user_role || 'user',
            status: plain.session_status,
            loginTime: loginTime ? loginTime.toISOString() : null,
            lastActivity: lastActivity ? lastActivity.toISOString() : null,
            logoutTime: logoutTime ? logoutTime.toISOString() : null,
            logoutReason: plain.logout_reason || null,
            ipAddress: plain.ip_address,
            userAgent: plain.user_agent,
            riskScore: plain.risk_score || 0,
            anomalyFlags,
            securityEvents,
            activityLog,
            durationMinutes: Math.round(durationMs / 60000),
            metadata: plain.session_metadata || {}
        };
    }
}

module.exports = EDRSessionManager;