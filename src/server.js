const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const config = require('./config');
const cookieParser = require('cookie-parser');
const logger = require('./utils/logger');
const { sequelize, testConnection } = require('./config/database');
const { PRTGServer, Device, Sensor, DeviceMetadata } = require('./models');
const { Op } = require('sequelize');
const apiRoutes = require('./routes/api');
const PRTGCollector = require('./collectors/prtgCollector');
const crypto = require('crypto');
const EDRSessionManager = require('./services/edrSessionManager');
const progressTracker = require('./utils/progressTracker');
const { URL } = require('url');

const returnToHostSuffix = (process.env.RETURN_TO_HOST_SUFFIX || '.lanairgroup.com').toLowerCase();
const strippedReturnSuffix = returnToHostSuffix.replace(/^\.+/, '').toLowerCase();
const extraReturnHosts = (process.env.RETURN_TO_ALLOWED_HOSTS || '')
  .split(',')
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
let cvaLoginUrlDetails = null;

function isHostAllowedForReturn(hostname, requestHost) {
  if (!hostname) return false;
  const normalizedHost = hostname.toLowerCase();
  if (normalizedHost === (requestHost || '').toLowerCase()) {
    return true;
  }
  if (extraReturnHosts.includes(normalizedHost)) {
    return true;
  }
  if (!strippedReturnSuffix) {
    return false;
  }
  return normalizedHost.endsWith(strippedReturnSuffix);
}

function normalizeReturnTarget(req, rawValue, depth = 0) {
  if (!rawValue || typeof rawValue !== 'string') {
    return null;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('/')) {
    return trimmed;
  }

  if (depth > 3) {
    logger.warn('normalizeReturnTarget recursion limit reached', { value: trimmed });
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    const requestHost = (req.hostname || '').toLowerCase();
    const hostname = (parsed.hostname || '').toLowerCase();
    const matchesRequestHost = hostname === requestHost;
    const matchesSuffix = strippedReturnSuffix ? hostname.endsWith(strippedReturnSuffix) : false;
    const matchesExtraHost = extraReturnHosts.includes(hostname);

    if (cvaLoginUrlDetails && hostname === cvaLoginUrlDetails.hostname.toLowerCase()) {
      if (parsed.pathname === cvaLoginUrlDetails.pathname) {
        const nested = parsed.searchParams.get('returnTo');
        if (nested) {
          return normalizeReturnTarget(req, nested, depth + 1);
        }
        return null;
      }
    }

    if (!isHostAllowedForReturn(hostname, requestHost)) {
      return null;
    }

    if ((matchesSuffix || matchesExtraHost) && (!parsed.protocol || parsed.protocol === 'http:')) {
      parsed.protocol = 'https:';
    }

    if (!matchesRequestHost && parsed.protocol !== 'https:') {
      return null;
    }

    return parsed.toString();
  } catch (error) {
    logger.debug('normalizeReturnTarget failed', { value: rawValue, error: error.message });
    return null;
  }
}

// Initialize EDR session manager
const edrManager = new EDRSessionManager();

function normalizeBaseUrl(url) {
  if (!url) return '';
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

function joinBaseAndPath(base, targetPath) {
  if (!base) return targetPath;
  if (!targetPath) return base;
  const normalizedPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
  return `${base}${normalizedPath}`;
}

function deriveCvaLoginUrl() {
  const configured = process.env.CVA_LOGIN_PATH;
  const baseCandidate = normalizeBaseUrl(
    process.env.CVA_LOGIN_BASE_URL || process.env.CVA_BASE_URL || process.env.BASE_URL || ''
  );

  if (configured && /^https?:\/\//i.test(configured)) {
    return configured;
  }

  if (configured && baseCandidate) {
    return joinBaseAndPath(baseCandidate, configured);
  }

  if (configured) {
    return joinBaseAndPath('https://cva.lanairgroup.com', configured);
  }

  if (baseCandidate) {
    return joinBaseAndPath(baseCandidate, '/login');
  }

  return 'https://cva.lanairgroup.com/login';
}

const app = express();
const server = http.createServer(app);

// WebSocket Server
const wss = new WebSocket.Server({ server });

// Store active WebSocket connections
const clients = new Set();

// Shared CVA session store (MySQL-backed)
const defaultCookieDomain = config.env === 'production' ? '.lanairgroup.com' : null;
const sessionCookieName = process.env.CVA_SESSION_COOKIE_NAME || process.env.SESSION_COOKIE_NAME || 'cva.sid';
const sessionCookieSecure = (process.env.CVA_SESSION_COOKIE_SECURE || process.env.SESSION_COOKIE_SECURE || 'false').toString().toLowerCase() === 'true';

const sessionStoreOptions = {
  host: process.env.CVA_SESSION_DB_HOST || process.env.CVA_DB_HOST || process.env.DB_HOST || config.database.host,
  port: parseInt(process.env.CVA_SESSION_DB_PORT || process.env.CVA_DB_PORT || process.env.DB_PORT || config.database.port, 10),
  user: process.env.CVA_SESSION_DB_USER || process.env.CVA_DB_USER || process.env.DB_USER || config.database.user,
  password: process.env.CVA_SESSION_DB_PASSWORD || process.env.CVA_DB_PASSWORD || process.env.DB_PASSWORD || config.database.password,
  database: process.env.CVA_SESSION_DB_NAME || process.env.CVA_DB_NAME || process.env.DB_NAME || config.database.name,
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: parseInt(process.env.CVA_SESSION_MAX_AGE || '1800000', 10),
  createDatabaseTable: false,
  schema: {
    tableName: process.env.CVA_SESSION_TABLE || 'sessions'
  }
};

const sessionStore = new MySQLStore(sessionStoreOptions);
const sessionStoreReady = sessionStore.onReady();
sessionStoreReady
  .then(() => {
    logger.info('CVA shared session store ready', { table: sessionStoreOptions.schema.tableName });
  })
  .catch((error) => {
    logger.error('Failed to initialize CVA shared session store', { error: error?.message || error });
  });

// Session configuration
const sessionCookieSameSite = process.env.CVA_SESSION_COOKIE_SAMESITE || process.env.SESSION_COOKIE_SAMESITE || 'lax';
const sessionCookieDomain = process.env.CVA_SESSION_COOKIE_DOMAIN || process.env.SESSION_COOKIE_DOMAIN || defaultCookieDomain;
const sessionCookieMaxAge = parseInt(process.env.CVA_SESSION_MAX_AGE || process.env.SESSION_MAX_AGE || '1800000', 10);

const sessionSecretUsed = process.env.SESSION_SECRET || process.env.CVA_SESSION_SECRET || 'prtg-dashboard-secret-key-change-in-production';
console.log('[PRTG CONFIG] SESSION_SECRET loaded, length:', sessionSecretUsed.length, 'first 10 chars:', sessionSecretUsed.substring(0, 10));

const sessionConfig = {
  key: sessionCookieName,
  secret: sessionSecretUsed,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  rolling: true, // refresh cookie expiry on each request to avoid unexpected timeouts
  cookie: {
    secure: sessionCookieSecure,
    httpOnly: true,
    sameSite: sessionCookieSameSite,
    maxAge: Number.isFinite(sessionCookieMaxAge) ? sessionCookieMaxAge : 1800000
  }
};

if (sessionCookieDomain) {
  sessionConfig.cookie.domain = sessionCookieDomain;
}

// If behind a proxy (Apache/Nginx), trust it to get correct IPs and secure cookies
app.set('trust proxy', 1);
app.use(session(sessionConfig));

// Middleware
app.use(cors({
  origin: config.cors.origins,
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const edrCookieOptions = {
  httpOnly: true,
  sameSite: sessionConfig.cookie.sameSite,
  secure: sessionCookieSecure,
  maxAge: sessionConfig.cookie.maxAge,
  path: '/'
};
const clearEdrCookieOptions = {
  httpOnly: true,
  sameSite: sessionConfig.cookie.sameSite,
  secure: sessionCookieSecure,
  path: '/'
};
const clearSessionCookieOptions = {
  httpOnly: true,
  sameSite: sessionConfig.cookie.sameSite,
  secure: sessionCookieSecure,
  path: '/'
};

if (sessionCookieDomain) {
  edrCookieOptions.domain = sessionCookieDomain;
  clearEdrCookieOptions.domain = sessionCookieDomain;
  clearSessionCookieOptions.domain = sessionCookieDomain;
}

function isUserAuthenticated(req) {
  return Boolean(req.session?.isAuthenticated && req.session?.user);
}

function getSessionUserIdentifier(req) {
  const sessionUser = req.session?.user || {};
  return sessionUser.email || sessionUser.displayName || sessionUser.id || null;
}

function resolveUserRole(identifier) {
  if (!identifier) return 'user';
  const normalized = String(identifier).toLowerCase();
  return config.adminUsers.some((admin) => String(admin).toLowerCase() === normalized) ? 'admin' : 'user';
}

function determineAbsoluteReturnUrl(req) {
  const rawProto = (req.headers['x-forwarded-proto'] || '').split(',')[0]?.trim();
  const protocol = rawProto || req.protocol || 'https';
  const rawHost = (req.headers['x-forwarded-host'] || '').split(',')[0]?.trim();
  const host = rawHost || req.headers.host;
  const path = req.originalUrl || req.path || '/';
  if (!host) {
    return path.startsWith('/') ? path : `/${path}`;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${protocol}://${host}${normalizedPath}`;
}

function buildLoginRedirectTarget(base, returnTo) {
  const fallbackBase = base || 'https://cva.lanairgroup.com/login';
  const resolverOrigin = fallbackBase.startsWith('http') ? undefined : 'https://cva.lanairgroup.com';
  let redirectUrl;

  try {
    redirectUrl = resolverOrigin ? new URL(fallbackBase, resolverOrigin) : new URL(fallbackBase);
  } catch (error) {
    logger.warn('Failed to parse CVA login path, falling back to default', { error: error.message });
    redirectUrl = new URL('https://cva.lanairgroup.com/login');
  }

  if (!redirectUrl.searchParams.has('from')) {
    redirectUrl.searchParams.append('from', 'cpm');
  }

  if (returnTo) {
    redirectUrl.searchParams.set('returnTo', returnTo);
  }

  return redirectUrl.toString();
}

const cvaLoginUrl = deriveCvaLoginUrl();

try {
  cvaLoginUrlDetails = new URL(cvaLoginUrl);
} catch (error) {
  logger.warn('Failed to parse CVA login URL for return normalization', {
    cvaLoginUrl,
    error: error.message
  });
  cvaLoginUrlDetails = null;
}

// Align CPM session metadata with CVA authentication context
app.use((req, res, next) => {
  try {
    if (isUserAuthenticated(req)) {
      const identifier = getSessionUserIdentifier(req);
      if (identifier) {
        req.session.username = identifier;
        req.session.role = resolveUserRole(identifier);
      }
      if (!req.session.loginTime) {
        req.session.loginTime = Date.now();
      }
    }
  } catch (error) {
    logger.error('Failed to synchronize CVA auth context', { error: error.message });
  } finally {
    next();
  }
});

// Remove duplicate session initialization (we already configured session above)

// Add session fingerprint middleware to persist session identity across hard refreshes
app.use((req, res, next) => {
  const normalizeIp = (value = '') => {
    if (!value) return '';
    const trimmed = value.split(',')[0].trim();
    if (trimmed === '::1') return '127.0.0.1';
    if (trimmed.startsWith('::ffff:')) return trimmed.substring(7);
    return trimmed;
  };

  const ipFromHeader = req.headers['x-forwarded-for'];
  const candidateIp = ipFromHeader || req.socket?.remoteAddress || req.connection?.remoteAddress || req.ip || '';
  const ipAddress = normalizeIp(candidateIp);
  const userAgent = req.headers['user-agent'] || '';
  const fingerprintSource = `${ipAddress}|${userAgent}`;
  const fingerprint = crypto.createHash('sha256').update(fingerprintSource).digest('hex');

  if (!req.session.fingerprint) {
    req.session.fingerprint = fingerprint;
    req.session.fingerprintMeta = { ip: ipAddress, userAgent };
    logger.debug('Session fingerprint set for new session', { sessionId: req.sessionID, ipAddress });
  } else if (req.session.fingerprint !== fingerprint) {
    const previousMeta = req.session.fingerprintMeta || {};
    if (previousMeta.userAgent === userAgent) {
      logger.warn('Session IP drift detected, refreshing fingerprint', {
        sessionId: req.sessionID,
        previousIp: previousMeta.ip,
        newIp: ipAddress
      });
      req.session.fingerprint = fingerprint;
      req.session.fingerprintMeta = { ip: ipAddress, userAgent };
    } else {
      logger.warn('Fingerprint mismatch: destroying session', {
        sessionId: req.sessionID,
        previousIp: previousMeta.ip,
        newIp: ipAddress
      });
      req.session.destroy(err => {
        if (err) logger.error('Failed to destroy session on fingerprint mismatch:', err);
        return res.status(403).send('Session verification failed.');
      });
      return;
    }
  }
  next();
});

// Authentication middleware
function requireAuth(req, res, next) {
  const authenticated = isUserAuthenticated(req);
  const sessionUser = req.session?.user?.email || req.session?.user?.displayName;

  // Enhanced logging for debugging
  console.log(`[PRTG AUTH] ========== AUTH CHECK START ==========`);
  console.log(`[PRTG AUTH] Path: ${req.path}`);
  console.log(`[PRTG AUTH] Session ID: ${req.sessionID}`);
  console.log(`[PRTG AUTH] Authenticated: ${authenticated}`);
  console.log(`[PRTG AUTH] Session user: ${sessionUser || 'none'}`);
  console.log(`[PRTG AUTH] Cookies:`, req.cookies);
  console.log(`[PRTG AUTH] Session data:`, {
    isAuthenticated: req.session?.isAuthenticated,
    user: req.session?.user,
    hasSession: !!req.session
  });
  console.log(`[PRTG AUTH] ========== AUTH CHECK END ==========`);

  logger.debug(`Auth check for ${req.path}:`, {
    authenticated,
    sessionId: req.sessionID,
    user: sessionUser || 'anonymous'
  });

  if (authenticated) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const rawReturnTo = determineAbsoluteReturnUrl(req);
  const normalizedReturnTo =
    normalizeReturnTarget(req, rawReturnTo) ||
    normalizeReturnTarget(req, req.session?.returnTo) ||
    '/';

  if (req.session) {
    req.session.returnTo = normalizedReturnTo;
  }

  const redirectTarget = buildLoginRedirectTarget(cvaLoginUrl, normalizedReturnTo);
  return res.redirect(redirectTarget);
}

// Authentication routes
app.post('/login', (req, res) => {
  logger.warn('Direct CPM login attempt blocked; CVA handles authentication');
  const candidateReturnTo = req.session?.returnTo || req.query?.returnTo || determineAbsoluteReturnUrl(req);
  const normalizedReturnTo =
    normalizeReturnTarget(req, candidateReturnTo) ||
    normalizeReturnTarget(req, req.session?.returnTo) ||
    '/';
  const redirectTarget = buildLoginRedirectTarget(cvaLoginUrl, normalizedReturnTo);
  if (req.session) {
    req.session.returnTo = normalizedReturnTo;
  }

  if (req.xhr || (req.headers.accept || '').includes('application/json')) {
    return res.status(403).json({
      error: 'Authentication is managed by CVA. Please use the primary CVA login flow.',
      redirect: redirectTarget
    });
  }

  return res.redirect(redirectTarget);
});

// Auto-restore session middleware (runs before route guards)
app.use(async (req, res, next) => {
  // Skip if headers already sent (shouldn't happen but safety check)
  if (res.headersSent) {
    logger.warn('[SESSION MIDDLEWARE] Headers already sent, skipping');
    return;
  }
  
  try {
    const authenticated = isUserAuthenticated(req);
    const existingEdrId = req.session?.edrSessionId;
    const edrCookie = req.cookies?.['edr.sid'];

    if (existingEdrId) {
      if (!edrCookie || edrCookie !== existingEdrId) {
        res.cookie('edr.sid', existingEdrId, edrCookieOptions);
      }
      return next();
    }

    if (edrCookie) {
      const validation = await edrManager.validateSession(edrCookie, req);
      if (validation.valid && validation.session?.session_status === 'active') {
        req.session.edrSessionId = edrCookie;
        req.session.restoredFromCache = true;

        if (authenticated) {
          const identifier = req.session.username || getSessionUserIdentifier(req) || validation.session.username;
          req.session.username = identifier;
          req.session.role = req.session.role || resolveUserRole(identifier);
          if (!req.session.loginTime && validation.session.login_time) {
            req.session.loginTime = new Date(validation.session.login_time).getTime();
          }
        }

        res.cookie('edr.sid', edrCookie, edrCookieOptions);
        logger.info('Session auto-restored from EDR session', { edrSessionId: edrCookie, sessionId: req.sessionID });
        return next();
      }

      logger.debug('Invalid EDR session during auto-restore', { edrSessionId: edrCookie, reason: validation.reason });
      res.clearCookie('edr.sid', clearEdrCookieOptions);
    }

    if (authenticated) {
      const identifier = req.session.username || getSessionUserIdentifier(req);
      if (!identifier) {
        logger.warn('Authenticated CVA session missing identifier; skipping EDR bootstrap');
        return next();
      }

      const role = req.session.role || resolveUserRole(identifier);
      const { sessionId: edrSessionId } = await edrManager.createSession({ username: identifier, role }, req);
      req.session.edrSessionId = edrSessionId;
      req.session.restoredFromCache = false;
      res.cookie('edr.sid', edrSessionId, edrCookieOptions);
    }
  } catch (error) {
    logger.error('EDR session synchronization failed', { error: error.message });
  } finally {
    next();
  }
});

// Admin guard middleware
function requireAdmin(req, res, next) {
  if (isUserAuthenticated(req) && req.session?.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin access required' });
}

app.post('/logout', async (req, res) => {
  const sessionId = req.sessionID;
  const edrSessionId = req.session?.edrSessionId || req.cookies?.['edr.sid'];
  const accepts = (req.headers['accept'] || '').toLowerCase();
  const wantsJson = accepts.includes('application/json') || req.headers['x-requested-with'] === 'XMLHttpRequest';
  const isBeacon = req.headers['content-type'] === 'text/plain;charset=UTF-8'; // sendBeacon signature
  const redirectUrl = `/logout.html?sessionId=${encodeURIComponent(sessionId || '')}`;

  logger.info('Logout initiated', { sessionId, edrSessionId, isBeacon });

  try {
    // Terminate EDR session FIRST
    if (edrSessionId) {
      try {
        await edrManager.terminateSession(edrSessionId, 'user_logout');
        logger.info('EDR session terminated successfully', { edrSessionId });
      } catch (err) {
        logger.error('EDR terminate failed', { error: err.message, edrSessionId });
      }
    }

    // Destroy express session
    if (req.session) {
      await new Promise((resolve, reject) => {
        req.session.destroy((err) => {
          if (err) {
            logger.error('Session destroy error', { error: err.message });
            reject(err);
          } else {
            logger.info('Session destroyed successfully', { sessionId });
            resolve();
          }
        });
      });
    }

    // Check if headers already sent before clearing cookies
    if (res.headersSent) {
      logger.warn('Headers already sent, cannot clear cookies or send logout response');
      return;
    }

    // Clear cookies AFTER session is destroyed
    res.clearCookie(sessionCookieName, clearSessionCookieOptions);
    res.clearCookie('edr.sid', clearEdrCookieOptions);
    
    // Also clear the session cookie with explicit domain for cross-domain logout
    if (sessionCookieDomain) {
      res.clearCookie(sessionCookieName, { ...clearSessionCookieOptions, domain: sessionCookieDomain });
      res.clearCookie('edr.sid', { ...clearEdrCookieOptions, domain: sessionCookieDomain });
    }

    // Regenerate a fresh session to prevent stale session reuse
    await new Promise((resolve) => {
      req.session.regenerate(() => resolve());
    });

    // Send response based on request type
    if (isBeacon) {
      // sendBeacon doesn't care about response, but send 204 No Content
      return res.status(204).end();
    }
    
    if (wantsJson) {
      return res.json({ success: true, redirect: redirectUrl, sessionId });
    }
    return res.redirect(redirectUrl);

  } catch (error) {
    logger.error('Logout error:', error);
    
    // Check if headers already sent before error response
    if (res.headersSent) {
      logger.warn('Headers already sent, cannot send error response');
      return;
    }
    
    if (wantsJson || isBeacon) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    return res.status(500).send('Logout failed');
  }
});

// Also support GET for logout (for simple links)
app.get('/logout', async (req, res) => {
  const sessionId = req.sessionID;
  const edrSessionId = req.session?.edrSessionId || req.cookies?.['edr.sid'];
  
  logger.info('Logout initiated via GET', { sessionId, edrSessionId });

  try {
    // Terminate EDR session
    if (edrSessionId) {
      try {
        await edrManager.terminateSession(edrSessionId, 'user_logout');
        logger.info('EDR session terminated successfully', { edrSessionId });
      } catch (err) {
        logger.error('EDR terminate failed', { error: err.message, edrSessionId });
      }
    }

    // Destroy express session
    if (req.session) {
      await new Promise((resolve, reject) => {
        req.session.destroy((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    // Check if headers already sent before clearing cookies
    if (res.headersSent) {
      logger.warn('Headers already sent in GET logout, cannot clear cookies or redirect');
      return;
    }

    // Clear cookies
    res.clearCookie(sessionCookieName, clearSessionCookieOptions);
    res.clearCookie('edr.sid', clearEdrCookieOptions);
    
    // Also clear the session cookie with explicit domain for cross-domain logout
    if (sessionCookieDomain) {
      res.clearCookie(sessionCookieName, { ...clearSessionCookieOptions, domain: sessionCookieDomain });
      res.clearCookie('edr.sid', { ...clearEdrCookieOptions, domain: sessionCookieDomain });
    }

    // Regenerate a fresh session to prevent stale session reuse
    await new Promise((resolve) => {
      req.session.regenerate(() => resolve());
    });

    // Redirect to logout page
    return res.redirect(`/logout.html?sessionId=${encodeURIComponent(sessionId || '')}`);

  } catch (error) {
    logger.error('Logout GET error:', error);
    
    // Check if headers already sent before error response
    if (res.headersSent) {
      logger.warn('Headers already sent in GET logout error, cannot redirect');
      return;
    }
    
    const fallbackReturn = normalizeReturnTarget(req, determineAbsoluteReturnUrl(req)) || '/';
    const fallbackTarget = buildLoginRedirectTarget(cvaLoginUrl, fallbackReturn);
    return res.redirect(fallbackTarget);
  }
});

// Login page
app.get('/login', (req, res) => {
  // If user is already authenticated, redirect to destination instead of re-authenticating
  if (isUserAuthenticated(req)) {
    const destination = req.query.next || req.session?.returnTo || '/';
    logger.info(`User already authenticated, redirecting to: ${destination}`);
    return res.redirect(destination);
  }

  const candidateReturnTo = req.session?.returnTo || req.query?.returnTo || determineAbsoluteReturnUrl(req);
  const normalizedReturnTo =
    normalizeReturnTarget(req, candidateReturnTo) ||
    normalizeReturnTarget(req, req.session?.returnTo) ||
    '/';

  if (req.session) {
    req.session.returnTo = normalizedReturnTo;
  }

  const redirectTarget = buildLoginRedirectTarget(cvaLoginUrl, normalizedReturnTo);

  try {
    const parsedTarget = new URL(redirectTarget);
    const currentHost = req.headers.host;
    if (currentHost && parsedTarget.host === currentHost) {
      logger.error('CVA login URL points back to CPM. Update CVA_LOGIN_PATH/CVA_BASE_URL to the CVA portal.');
      return res.status(502).send('CVA authentication endpoint is misconfigured. Please contact an administrator.');
    }
  } catch (error) {
    logger.error('Failed to validate CVA login redirect target', { error: error.message, redirectTarget });
  }

  res.redirect(redirectTarget);
});

app.get('/api/system/progress', (req, res) => {
  res.json(progressTracker.getState());
});

// EDR metadata ingestion (post-login enhancement)
app.post('/edr/metadata', async (req, res) => {
  try {
    const edrId = req.session?.edrSessionId || req.cookies?.['edr.sid'];
    if (!edrId) return res.status(204).end();
    const { UserSession } = require('./models');
    const session = await UserSession.findByPk(edrId);
    if (!session) return res.status(204).end();
    const meta = Object.assign({}, session.session_metadata || {}, { client: req.body });
    await session.update({ session_metadata: meta });
    res.status(204).end();
  } catch (e) {
    logger.error('Failed to save EDR metadata', { error: e.message });
    res.status(204).end();
  }
});

// EDR activity refresher: for authenticated users, refresh EDR last_activity on each request
app.use(async (req, res, next) => {
  try {
    if (!isUserAuthenticated(req)) {
      return next();
    }

    const edrId = req.session?.edrSessionId || req.cookies?.['edr.sid'];
    if (!edrId) {
      return next();
    }

    const validation = await edrManager.validateSession(edrId, req);
    if (validation.valid) {
      return next();
    }

    logger.warn('EDR validation failed during activity refresh; redirecting to CVA login', {
      sessionId: req.sessionID,
      edrSessionId: edrId,
      reason: validation.reason
    });

    const edrReturnTo = normalizeReturnTarget(req, determineAbsoluteReturnUrl(req)) || '/';
    const redirectTarget = buildLoginRedirectTarget(cvaLoginUrl, edrReturnTo);

    res.clearCookie(sessionCookieName, clearSessionCookieOptions);
    res.clearCookie('edr.sid', clearEdrCookieOptions);

    if (!res.headersSent) {
      res.redirect(redirectTarget);
    }

    if (req.session && typeof req.session.destroy === 'function') {
      req.session.destroy((err) => {
        if (err) {
          logger.error('Session destroy failed during EDR validation redirect', { error: err.message });
        }
      });
    }
  } catch (e) {
    logger.error('EDR refresh failed', { error: e.message });
    if (!res.headersSent) {
      res.status(500).send('Session validation failed');
    }
  }
});

// Root route - serve SOC dashboard (protected) - MUST be before static middleware
app.get('/', requireAuth, async (req, res, next) => {
  // Prevent any caching or multiple processing
  if (res.headersSent) {
    console.log('[ROOT ROUTE] Headers already sent, aborting');
    return;
  }
  
  try {
    const filePath = path.join(__dirname, '../protected/soc-dashboard.html');
    console.log('[ROOT ROUTE] Reading file:', filePath);
    const content = await fs.promises.readFile(filePath, 'utf8');
    console.log('[ROOT ROUTE] File read successfully, length:', content.length);
    
    if (res.headersSent) {
      console.log('[ROOT ROUTE] Headers sent after read, aborting');
      return;
    }
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(content);
    console.log('[ROOT ROUTE] Response sent successfully');
  } catch (err) {
    logger.error('[ROOT ROUTE] Error loading SOC dashboard:', err);
    console.error('[ROOT ROUTE] Error details:', err.message, err.stack);
    if (!res.headersSent) {
      res.status(500).send('Error loading dashboard');
    }
  }
});

// 3D Network Topology route
app.get('/topology', requireAuth, async (req, res, next) => {
  if (res.headersSent) {
    return;
  }
  
  try {
    const filePath = path.join(__dirname, '../protected/topology.html');
    const content = await fs.promises.readFile(filePath, 'utf8');
    
    if (res.headersSent) {
      return;
    }
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(content);
  } catch (err) {
    logger.error('Error loading topology:', err);
    if (!res.headersSent) {
      res.status(500).send('Error loading topology');
    }
  }
});

// Legacy sensor dashboard route
app.get('/legacy', requireAuth, async (req, res, next) => {
  if (res.headersSent) {
    return;
  }
  
  try {
    const filePath = path.join(__dirname, '../protected/index.html');
    const content = await fs.promises.readFile(filePath, 'utf8');
    
    if (res.headersSent) {
      return;
    }
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(content);
  } catch (err) {
    logger.error('Error loading legacy dashboard:', err);
    if (!res.headersSent) {
      res.status(500).send('Error loading dashboard');
    }
  }
});

// Admin console routes (protected)
const adminStaticPath = path.join(__dirname, '../secure/admin');
app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(adminStaticPath, 'index.html'));
});
app.use('/admin', requireAuth, requireAdmin, express.static(adminStaticPath));

// Direct route for devices/enhanced (NGINX strips /api prefix)
// MUST be before /api routes to take precedence
app.get('/devices/enhanced', requireAuth, async (req, res, next) => {
  // Increase timeout to 30 seconds for this slow query
  req.setTimeout(30000);
  res.setTimeout(30000);
  
  const routeStartTime = Date.now();
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  logger.info(`[${requestId}] ========== /devices/enhanced REQUEST START ==========`);
  logger.info(`[${requestId}] Headers sent status at entry: ${res.headersSent}`);
  logger.info(`[${requestId}] Response writableEnded: ${res.writableEnded}`);
  logger.info(`[${requestId}] Response writableFinished: ${res.writableFinished}`);
  
  // Check if already responded (auth middleware may have redirected)
  if (res.headersSent || res.writableEnded) {
    logger.warn(`[${requestId}] Response already sent/ended at entry, aborting`);
    return;
  }
  
  // Mark route as handling the response to prevent any default handlers
  req.route_handled = true;
  
  // Prevent response from timing out
  let timeoutCleared = false;
  const keepAliveInterval = setInterval(() => {
    if (!res.headersSent && !res.writableEnded) {
      logger.debug(`[${requestId}] Keep-alive ping`);
    }
  }, 5000);
  
  const clearKeepAlive = () => {
    if (!timeoutCleared) {
      clearInterval(keepAliveInterval);
      timeoutCleared = true;
    }
  };
  
  logger.info(`[${requestId}] Query params:`, req.query);
  logger.info(`[${requestId}] Auth user:`, req.session?.user?.username || 'NONE');
  logger.info(`[${requestId}] Session ID:`, req.sessionID);
  logger.info(`[${requestId}] Remote IP:`, req.ip || req.connection?.remoteAddress);
  
  // CRITICAL: Write headers immediately to lock the response and prevent 404
  // This reserves the response before async operations start
  res.writeHead(200, { 'Content-Type': 'application/json' });
  logger.info(`[${requestId}] Headers sent. statusCode: ${res.statusCode}, headersSent: ${res.headersSent}`);
  
  try {
    const { 
      company, 
      site, 
      category, 
      environment, 
      search, 
      limit = 100,
      offset = 0,
      all = false
    } = req.query;
    
    const deviceWhere = {};
    const metadataWhere = {};
    
    if (search) {
      deviceWhere.name = { [Op.like]: `%${search}%` };
    }
    
    if (company) metadataWhere.company_code = company;
    if (site) metadataWhere.site_identifier = site;
    if (category) metadataWhere.device_category = category;
    if (environment) metadataWhere.environment = environment;

    const queryOptions = {
      where: deviceWhere,
      order: [['status', 'DESC'], ['priority', 'DESC'], ['name', 'ASC']],
      include: [
        {
          model: PRTGServer,
          as: 'server',
          attributes: ['id', 'url']
        },
        {
          model: DeviceMetadata,
          as: 'metadata',
          where: Object.keys(metadataWhere).length > 0 ? metadataWhere : undefined,
          required: false
        },
        {
          model: Sensor,
          as: 'sensors',
          required: false,
          attributes: ['id', 'status', 'sensor_type', 'priority']
        }
      ]
    };

    if (all !== 'true') {
      queryOptions.limit = parseInt(limit);
      queryOptions.offset = parseInt(offset);
      logger.info(`[${requestId}] Pagination: limit=${limit}, offset=${offset}`);
    } else {
      logger.info(`[${requestId}] Fetching ALL devices (no pagination)`);
    }

    logger.info(`[${requestId}] Executing database query...`);
    const queryStartTime = Date.now();
    
    // Get total count for pagination
    const totalCount = await Device.count({
      where: deviceWhere,
      include: Object.keys(metadataWhere).length > 0 ? [{
        model: DeviceMetadata,
        as: 'metadata',
        where: metadataWhere,
        required: false
      }] : []
    });
    
    const devices = await Device.findAll(queryOptions);
    
    const queryTime = Date.now() - queryStartTime;
    logger.info(`[${requestId}] Database query completed in ${queryTime}ms, found ${devices.length} devices out of ${totalCount} total`);
    
    logger.info(`[${requestId}] Processing device data...`);
    const processStartTime = Date.now();
    
    const enhancedDevices = devices.map(device => {
      const deviceData = device.toJSON();
      const sensors = deviceData.sensors || [];
      const sensorStats = {
        total: sensors.length,
        up: sensors.filter(s => s.status === 3).length,
        down: sensors.filter(s => s.status === 5).length,
        warning: sensors.filter(s => s.status === 4).length,
        paused: sensors.filter(s => s.status === 7).length
      };
      
      let effectiveStatus = deviceData.status;
      if (sensorStats.down > 0) effectiveStatus = 5;
      else if (sensorStats.warning > 0) effectiveStatus = 4;
      
      return {
        ...deviceData,
        status: effectiveStatus,
        effectiveStatus: effectiveStatus,
        sensorStats,
        companyName: deviceData.metadata?.company_name || 'Unknown'
      };
    });
    
    const processTime = Date.now() - processStartTime;
    logger.info(`[${requestId}] Device processing completed in ${processTime}ms`);

    logger.info(`[${requestId}] Preparing response with ${enhancedDevices.length} devices`);
    
    // Sample first device for structure validation
    if (enhancedDevices.length > 0) {
      const sample = enhancedDevices[0];
      logger.info(`[${requestId}] Sample device:`, {
        id: sample.id,
        name: sample.name,
        status: sample.status,
        hasMetadata: !!sample.metadata,
        sensorCount: sample.sensors?.length || 0
      });
    }
    
    // Log response state for debugging
    logger.info(`[${requestId}] Response state before send:`, {
      headersSent: res.headersSent,
      finished: res.finished,
      statusCode: res.statusCode
    });
    
    // Clear keep-alive interval
    clearKeepAlive();
    
    // Calculate pagination metadata
    const currentLimit = parseInt(limit);
    const currentOffset = parseInt(offset);
    const currentPage = Math.floor(currentOffset / currentLimit) + 1;
    const totalPages = Math.ceil(totalCount / currentLimit);
    const hasMore = (currentOffset + enhancedDevices.length) < totalCount;
    
    // 🔍 DETAILED PAGINATION LOGGING
    logger.info(`[${requestId}] 📊 PAGINATION DETAILS:`);
    logger.info(`[${requestId}]    Total devices in DB: ${totalCount}`);
    logger.info(`[${requestId}]    Devices in this response: ${enhancedDevices.length}`);
    logger.info(`[${requestId}]    Page: ${currentPage}/${totalPages}`);
    logger.info(`[${requestId}]    Offset: ${currentOffset}, Limit: ${currentLimit}`);
    logger.info(`[${requestId}]    Has more pages: ${hasMore}`);
    logger.info(`[${requestId}]    Devices returned so far: ${currentOffset + enhancedDevices.length}`);
    
    // Headers already sent via writeHead, so use end() instead of json()
    if (!res.writableEnded) {
      logger.info(`[${requestId}] Sending JSON response with pagination: page ${currentPage}/${totalPages}, hasMore: ${hasMore}`);
      const responseData = JSON.stringify({
        devices: enhancedDevices,
        pagination: {
          total: totalCount,
          fetched: enhancedDevices.length,
          limit: currentLimit,
          offset: currentOffset,
          page: currentPage,
          totalPages: totalPages,
          hasMore: hasMore
        }
      });
      res.end(responseData);
      
      const totalTime = Date.now() - routeStartTime;
      logger.info(`[${requestId}] ========== REQUEST COMPLETE in ${totalTime}ms ==========`);
    } else {
      logger.error(`[${requestId}] Cannot send response - already sent or ended:`, {
        headersSent: res.headersSent,
        writableEnded: res.writableEnded,
        writableFinished: res.writableFinished,
        statusCode: res.statusCode,
        stack: new Error('Response state').stack
      });
    }
  } catch (error) {
    clearKeepAlive();
    const totalTime = Date.now() - routeStartTime;
    logger.error(`[${requestId}] ❌ ERROR after ${totalTime}ms:`);
    logger.error(`[${requestId}] Error name: ${error.name}`);
    logger.error(`[${requestId}] Error message: ${error.message}`);
    logger.error(`[${requestId}] Error stack:`, error.stack);
    
    if (error.name === 'SequelizeConnectionError') {
      logger.error(`[${requestId}] Database connection error - DB may be down`);
    } else if (error.name === 'SequelizeDatabaseError') {
      logger.error(`[${requestId}] Database query error - check SQL syntax`);
    }
    
    if (!res.writableEnded) {
      logger.info(`[${requestId}] Sending 500 error response`);
      // Headers already sent via writeHead, must use res.end() not res.json()
      const errorResponse = JSON.stringify({
        error: 'Internal server error',
        requestId: requestId,
        message: error.message
      });
      res.end(errorResponse);
    } else {
      logger.error(`[${requestId}] Cannot send error response - response already ended`);
    }
  }
});

// API Routes (protected) - mounted after direct routes
app.use('/api', requireAuth, apiRoutes);

// Test endpoint to verify API routes are accessible
app.get('/api/test', requireAuth, (req, res) => {
  res.json({ status: 'ok', message: 'API routes are working' });
});

// Session status endpoint (unprotected: returns minimal info)
app.get('/api/session/status', async (req, res) => {
  try {
    // Check if response already sent
    if (res.headersSent) {
      logger.warn('[SESSION_STATUS] Headers already sent, aborting');
      return;
    }
    
    const edrId = req.session?.edrSessionId || req.cookies?.['edr.sid'];
    const isSessionAuthenticated = isUserAuthenticated(req);
    const restoredFromCache = Boolean(req.session?.restoredFromCache);
    let expiresAt = null;
    let timeLeftMs = null;
    let valid = false;
    let validationResult = null;
    let loginTimeIso = req.session?.loginTime ? new Date(req.session.loginTime).toISOString() : null;
    let lastActivityIso = null;
    let sessionStatus = null;
    let riskScore = null;
    if (edrId) {
      validationResult = await edrManager.validateSession(edrId, req);
      valid = validationResult.valid;
      if (validationResult.valid) {
        // Use the absolute expires_at timestamp from database (does not reset on activity)
        if (validationResult.session.expires_at) {
          expiresAt = new Date(validationResult.session.expires_at).toISOString();
          timeLeftMs = Math.max(0, new Date(validationResult.session.expires_at).getTime() - Date.now());
        }
        if (validationResult.session.login_time) {
          loginTimeIso = new Date(validationResult.session.login_time).toISOString();
        }
        if (validationResult.session.last_activity) {
          lastActivityIso = new Date(validationResult.session.last_activity).toISOString();
        }
        sessionStatus = validationResult.session.session_status;
        riskScore = validationResult.session.risk_score;
        req.session.username = req.session.username || validationResult.session.username;
        req.session.role = req.session.role || validationResult.session.user_role || resolveUserRole(validationResult.session.username);
        req.session.edrSessionId = req.session.edrSessionId || edrId;
        if (!req.session.loginTime && validationResult.session.login_time) {
          req.session.loginTime = new Date(validationResult.session.login_time).getTime();
        }
      }
    }
    
    // Final check before sending
    if (res.headersSent) {
      logger.warn('[SESSION_STATUS] Headers sent during processing, aborting response');
      return;
    }
    
    res.json({
      authenticated: isSessionAuthenticated || valid,
      username: req.session?.username || validationResult?.session?.username || null,
      role: req.session?.role || (validationResult?.valid ? validationResult.session.user_role || 'user' : null),
      edrSessionId: edrId || null,
      restoredFromCache: restoredFromCache,
      expiresAt,
      timeLeftMs,
      loginTime: loginTimeIso,
      lastActivity: lastActivityIso,
      sessionStatus,
      riskScore
    });
  } catch (e) {
    logger.error('Session status failed', { error: e.message });
    if (!res.headersSent) {
      res.json({ authenticated: false });
    }
  }
});

app.get('/api/session/details', requireAuth, async (req, res) => {
  try {
    const edrId = req.session?.edrSessionId || req.cookies?.['edr.sid'];
    if (!edrId) {
      return res.status(404).json({ error: 'No active session found' });
    }
    const details = await edrManager.getSessionDetails(edrId);
    if (!details) {
      return res.status(404).json({ error: 'Session not found or expired' });
    }
    res.json(details);
  } catch (e) {
    logger.error('Failed to fetch session details', { error: e.message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Unable to retrieve session details' });
    }
  }
});

// Admin session endpoints (protected)
app.post('/api/admin/sessions/purge', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await edrManager.purgeExpiredAndOldSessions();
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/admin/sessions/:sessionId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { reason = 'admin_termination' } = req.body;
    
    const success = await edrManager.terminateSession(sessionId, reason);
    if (success) {
      logger.info('Admin terminated session', { sessionId, reason, adminUser: req.session.username });
      res.json({ success: true, message: 'Session terminated successfully' });
    } else {
      res.status(404).json({ success: false, error: 'Session not found' });
    }
  } catch (e) {
    logger.error('Failed to terminate session', { error: e.message });
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/admin/sessions/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { UserSession } = require('./models');
    const total = await UserSession.count();
    const active = await UserSession.count({ where: { session_status: 'active' } });
    const expired = await UserSession.count({ where: { session_status: 'expired' } });
    const loggedOut = await UserSession.count({ where: { session_status: 'logged_out' } });
    const terminated = await UserSession.count({ where: { session_status: 'terminated' } });
    res.json({ total, active, expired, loggedOut, terminated, retentionHours: edrManager.retentionHours });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Middleware to prevent static serving of protected HTML files
app.use((req, res, next) => {
  const protectedFiles = ['/soc-dashboard.html', '/index.html', '/topology.html'];
  if (protectedFiles.includes(req.path)) {
    return res.status(404).send('Not Found');
  }
  next();
});

// Static files (serve login.html and other assets publicly) - MUST be after specific routes
app.use(express.static(path.join(__dirname, '../public')));

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  // Check authentication for WebSocket connections
  // Note: For production, implement proper WebSocket authentication
  // This is a simple check - in production, use JWT tokens or similar
  
  clients.add(ws);
  logger.info('New WebSocket client connected');
  
  // Send initial sensor data after a short delay to ensure client is ready
  setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN) {
      sendSensorUpdate(ws);
    }
  }, 100);
  
  // Handle client messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      logger.debug('WebSocket message received:', data);
      
      // Handle ping/pong for heartbeat
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (error) {
      logger.error('Error parsing WebSocket message:', error);
    }
  });
  
  // Handle connection close
  ws.on('close', () => {
    clients.delete(ws);
    logger.info('WebSocket client disconnected');
  });
  
  // Handle connection errors
  ws.on('error', (error) => {
    logger.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

// Function to send sensor updates to all clients
async function sendSensorUpdate(targetClient = null) {
  try {
    // Get aggregated sensor data with status counts
    const sensors = await Sensor.findAll({
      include: [{
        model: Device,
        as: 'device',
        attributes: ['name', 'host']
      }, {
        model: PRTGServer,
        as: 'server',
        attributes: ['id', 'url']
      }],
      attributes: ['id', 'name', 'status', 'statusText', 'sensorType', 'lastSeen'],
      order: [['status', 'DESC'], ['name', 'ASC']]
    });

    // Group sensors by status for summary
    const statusSummary = {
      up: sensors.filter(s => s.status === 3).length,
      down: sensors.filter(s => s.status === 5).length,
      warning: sensors.filter(s => s.status === 4).length,
      paused: sensors.filter(s => s.status === 7).length,
      unusual: sensors.filter(s => s.status === 10).length,
      unknown: sensors.filter(s => s.status === 1).length,
      total: sensors.length
    };

    const updateData = {
      type: 'sensor-update',
      timestamp: new Date().toISOString(),
      summary: statusSummary,
      sensors: sensors.map(sensor => ({
        id: sensor.id,
        name: sensor.name,
        status: sensor.status,
        statusText: sensor.statusText,
        sensorType: sensor.sensorType,
        deviceName: sensor.device?.name,
        deviceHost: sensor.device?.host,
        prtgServer: sensor.server?.id,
        lastSeen: sensor.lastSeen
      }))
    };

    const message = JSON.stringify(updateData);

    if (targetClient) {
      // Send to specific client
      if (targetClient.readyState === WebSocket.OPEN) {
        targetClient.send(message);
      }
    } else {
      // Broadcast to all clients
      clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    }
  } catch (error) {
    logger.error('Error sending sensor update:', error);
  }
}

// Function to broadcast server status updates
async function sendServerUpdate() {
  try {
    const servers = await PRTGServer.findAll({
      attributes: ['id', 'url', 'enabled', 'lastSuccessfulPoll', 'lastError']
    });

    const updateData = {
      type: 'server-update',
      timestamp: new Date().toISOString(),
      servers: servers.map(server => ({
        id: server.id,
        url: server.url,
        enabled: server.enabled,
        lastSuccessfulPoll: server.lastSuccessfulPoll,
        status: server.lastError ? 'error' : 'ok'
      }))
    };

    const message = JSON.stringify(updateData);
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  } catch (error) {
    logger.error('Error sending server update:', error);
  }
}

// Periodic updates - send sensor data every 5 seconds
setInterval(() => {
  if (clients.size > 0) {
    sendSensorUpdate();
  }
}, config.polling.interval);

// Periodic heartbeat to keep connections alive
setInterval(() => {
  const heartbeat = JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() });
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(heartbeat);
    }
  });
}, config.polling.wsHeartbeat);

// Graceful shutdown

let shuttingDown = false;
process.on('SIGTERM', (signal) => gracefulShutdown(signal));
process.on('SIGINT', (signal) => gracefulShutdown(signal));


async function gracefulShutdown(signal = 'UNKNOWN') {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Received shutdown signal, closing server gracefully...', { signal });
  progressTracker.update({ phase: 'shutdown', message: 'Shutting down services', ready: false });

  // Block new requests
  app.use((req, res, next) => {
    res.status(503).send('Server is shutting down');
  });

  // Stop PRTG collector
  if (global.prtgCollector) {
    try {
      await global.prtgCollector.stop();
    } catch (error) {
      logger.error('Error stopping PRTG collector during shutdown:', error);
    }
  }

  // Close WebSocket server
  await new Promise((resolve) => {
    try {
      wss.close(() => {
        logger.info('WebSocket server closed');
        resolve();
      });
    } catch (error) {
      logger.error('Error closing WebSocket server:', error);
      resolve();
    }
  });

  // Close HTTP server
  await new Promise((resolve) => {
    server.close(() => {
      logger.info('HTTP server closed');
      resolve();
    });
  });

  // Close database connection LAST
  try {
    await sequelize.close();
    logger.info('Database connection closed');
  } catch (error) {
    logger.error('Error closing database connection:', error);
  }

  process.exit(0);
}

// Global error handlers to ensure clean exit on crash
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// Start server
async function startServer() {
  try {
    console.log('[PRTG DEBUG] startServer() called');
    console.log('[PRTG DEBUG] About to call logger.info()');
    logger.info('Starting PRTG Unified Dashboard...');
    console.log('[PRTG DEBUG] About to reset progressTracker');
    progressTracker.reset({ message: 'Bootstrapping services', percentage: 2, ready: false });
    console.log('[PRTG DEBUG] About to test database connection');
    
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      logger.error('Failed to connect to database. Exiting...');
      progressTracker.update({ phase: 'error', message: 'Database connection failed', percentage: 5, ready: false });
      process.exit(1);
    }
    progressTracker.update({ phase: 'startup', message: 'Database connection established', percentage: 15, ready: false });

    if (shuttingDown) {
      logger.warn('Shutdown initiated during startup; aborting server start.');
      progressTracker.update({ phase: 'shutdown', message: 'Startup aborted during shutdown', ready: false });
      return;
    }
    
  // Ensure shared session store is ready before proceeding
    if (!shuttingDown) {
      try {
        await sessionStoreReady;
        logger.info('Session store ready for CVA auth sessions');
        progressTracker.update({ phase: 'startup', message: 'Session store ready', percentage: 25, ready: false });
      } catch (storeError) {
        logger.error('Session store failed to initialize', { error: storeError?.message || storeError });
        progressTracker.update({ phase: 'error', message: 'Session store initialization failed', percentage: 20, ready: false });
        process.exit(1);
      }
    }

  // Sync database models
    if (!shuttingDown) {
      await sequelize.sync();
      logger.info('Database models synchronized');
      progressTracker.update({ phase: 'startup', message: 'Database models synchronized', percentage: 40, ready: false });
    }
    
    // Initialize PRTG servers in database if they don't exist
    const totalServers = config.prtgServers.length || 1;
    let serverIndex = 0;
    for (const serverConfig of config.prtgServers) {
      if (shuttingDown) {
        logger.warn('Shutdown initiated during server initialization; aborting.');
        progressTracker.update({ phase: 'shutdown', message: 'Startup aborted during server initialization', ready: false });
        return;
      }
      serverIndex += 1;
      const [server] = await PRTGServer.findOrCreate({
        where: { id: serverConfig.id },
        defaults: {
          url: serverConfig.url,
          username: serverConfig.username,
          enabled: serverConfig.enabled
        }
      });
      logger.info(`PRTG Server initialized: ${server.id} - ${server.url}`);
      const serverProgress = 40 + Math.round((serverIndex / totalServers) * 15);
      progressTracker.update({
        phase: 'startup',
        message: `Initialized PRTG server ${server.id}`,
        percentage: Math.min(serverProgress, 60),
        ready: false
      });
    }
    
    // Start HTTP server FIRST to accept connections immediately
    if (shuttingDown) {
      logger.warn('Shutdown initiated before HTTP server start; aborting listen.');
      progressTracker.update({ phase: 'shutdown', message: 'Startup aborted before server listen', ready: false });
      return;
    }

    server.listen(config.port, () => {
      logger.info(`PRTG Dashboard server running on port ${config.port}`);
      logger.info(`WebSocket server ready for real-time updates`);
      logger.info(`Dashboard available at: http://localhost:${config.port}`);
      progressTracker.update({
        phase: 'ready',
        message: `Dashboard online on port ${config.port}`,
        percentage: 70,
        ready: false
      });
    });
    
    // Initialize and start PRTG data collector in background (non-blocking)
    const collector = new PRTGCollector();
    collector.setProgressTracker(progressTracker, { start: 70, end: 95 });
    progressTracker.update({ phase: 'collector', message: 'Starting PRTG data collector', percentage: 70, ready: false });
    
    // Store collector instance for graceful shutdown
    global.prtgCollector = collector;
    
    // Start collector in background without blocking
    if (!shuttingDown) {
      collector.start().then(() => {
        logger.info('Initial PRTG data collection complete');
        progressTracker.update({ phase: 'collector', message: 'Initial PRTG data collected', percentage: 100, ready: true });
      }).catch(error => {
        logger.error('Initial PRTG data collection failed:', error);
        progressTracker.update({ phase: 'error', message: 'Data collection failed, but server is online', percentage: 100, ready: true });
      });
    }
    
  } catch (error) {
    if (shuttingDown) {
      logger.warn('Server start aborted due to shutdown signal.');
      return;
    }
    logger.error('Failed to start server:', error);
    progressTracker.update({ phase: 'error', message: 'Server failed to start', ready: false });
    process.exit(1);
  }
}

/**
 * Health check endpoint for process monitoring and lifecycle management
 * Returns JSON if Accept: application/json, else serves health.html page
 */
app.get('/health', (req, res) => {
  const wantsJson = req.query.format === 'json' || req.accepts(['json', 'html']) === 'json';
  if (wantsJson) {
    return res.status(200).json({ status: 'ok', uptime: process.uptime() });
  }
  res.sendFile(path.join(__dirname, '../public/health.html'));
});

/**
 * PROCESS MANAGEMENT BEST PRACTICES
 * - Use restart-dashboard.sh for safe restarts (stops PM2, cleans port, verifies health)
 * - Use fix-503.sh for emergency port cleanup if dashboard is stuck
 * - PM2 auto-restarts on crash, but global error handlers ensure port is released
 * - Monitor /health endpoint for automated restarts and CI/CD integration
 * - Sessions are persisted in MySQL via SequelizeStore
 */

// Export for testing
module.exports = { app, server, wss, sendSensorUpdate, sendServerUpdate };

// Start the server if this file is run directly
console.log('[PRTG DEBUG] require.main:', require.main?.filename);
console.log('[PRTG DEBUG] module:', module.filename);
console.log('[PRTG DEBUG] require.main === module:', require.main === module);

if (require.main === module) {
  console.log('[PRTG DEBUG] Starting server...');
  startServer();
} else {
  console.log('[PRTG DEBUG] NOT starting server (module being required)');
}
