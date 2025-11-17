#!/bin/bash
# Quick Session Management Commands
# Usage: source this file or copy commands as needed

# ======================
# SESSION MONITORING
# ======================

# List all recent sessions
alias session-list='node /srv/www/htdocs/cva/cpm/scripts/cleanup-session.js --list'

# Count sessions by status
alias session-count='mysql -u root -p cpm_dashboard -e "SELECT session_status, COUNT(*) as count FROM user_sessions GROUP BY session_status;"'

# Show active sessions only
alias session-active='mysql -u root -p cpm_dashboard -e "SELECT LEFT(session_id, 20) as id, username, ip_address, last_activity FROM user_sessions WHERE session_status=\"active\" ORDER BY last_activity DESC;"'

# ======================
# SESSION CLEANUP
# ======================

# Clean all logged-out sessions
alias session-clean-loggedout='node /srv/www/htdocs/cva/cpm/scripts/cleanup-session.js --all-logged-out'

# Clean all expired sessions
alias session-clean-expired='node /srv/www/htdocs/cva/cpm/scripts/cleanup-session.js --expired'

# Clean specific session (usage: session-clean-one SESSION_ID)
function session-clean-one() {
  if [ -z "$1" ]; then
    echo "Usage: session-clean-one SESSION_ID"
    return 1
  fi
  node /srv/www/htdocs/cva/cpm/scripts/cleanup-session.js "$1"
}

# ======================
# TROUBLESHOOTING
# ======================

# Check dashboard logs
alias dashboard-logs='tail -f /srv/www/htdocs/cva/cpm/logs/prtg-dashboard.log'

# Check dashboard status
alias dashboard-status='pm2 status prtg-dashboard'

# Restart dashboard safely
alias dashboard-restart='cd /srv/www/htdocs/cva/cpm && ./restart-dashboard.sh'

# Check for zombie sessions (active but old)
alias session-zombies='mysql -u root -p cpm_dashboard -e "SELECT session_id, username, last_activity, TIMESTAMPDIFF(HOUR, last_activity, NOW()) as hours_idle FROM user_sessions WHERE session_status=\"active\" AND last_activity < DATE_SUB(NOW(), INTERVAL 24 HOUR);"'

echo "✅ Session management commands loaded!"
echo ""
echo "Quick Reference:"
echo "  session-list              - List all recent sessions"
echo "  session-count             - Count by status"
echo "  session-active            - Show active sessions"
echo "  session-clean-loggedout   - Clean logged-out sessions"
echo "  session-clean-expired     - Clean expired sessions"
echo "  session-clean-one ID      - Clean specific session"
echo "  session-zombies           - Find stale active sessions"
echo "  dashboard-logs            - Tail application logs"
echo "  dashboard-status          - Check PM2 status"
echo "  dashboard-restart         - Safe restart"
echo ""
