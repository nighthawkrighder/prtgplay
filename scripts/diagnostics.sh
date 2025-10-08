#!/bin/bash
# PRTG Dashboard - Diagnostics Script
# Run this if you encounter any issues after waking up

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       PRTG Dashboard Diagnostics                            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

echo "📊 PM2 Service Status:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
pm2 status prtg-dashboard
echo ""

echo "💾 Memory Usage:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
pm2 show prtg-dashboard | grep -E "memory|cpu|uptime|restarts"
echo ""

echo "📝 Recent Logs (last 20 lines):"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
pm2 logs prtg-dashboard --lines 20 --nostream
echo ""

echo "🔍 Version Check:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
grep "SOC Dashboard v" /srv/www/htdocs/cpm/public/soc-dashboard.html | head -1
echo ""

echo "✅ Service Listening on Port 3010:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
netstat -tlnp 2>/dev/null | grep :3010 || ss -tlnp 2>/dev/null | grep :3010
echo ""

echo "🌐 Quick Test:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:3010/ || echo "Could not connect to localhost:3010"
echo ""

echo "📊 Database Connection:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
mysql -u prtgdashboard -pprtg123 -D prtg_dashboard -e "SELECT COUNT(*) as device_count FROM devices;" 2>/dev/null || echo "Database connection issue"
echo ""

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║ Diagnostics Complete                                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "If all checks pass, dashboard should be working!"
echo ""
echo "To restart service: pm2 restart prtg-dashboard"
echo "To view live logs: pm2 logs prtg-dashboard"
echo ""
