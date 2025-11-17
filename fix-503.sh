#!/bin/bash
# Quick fix for 503 errors - use this when dashboard is broken

echo "🆘 Emergency PRTG Dashboard fix..."

# Force stop everything
pm2 stop prtg-dashboard
sudo pkill -f "node.*srv/www/htdocs/cva/cpm" 2>/dev/null
sleep 3

# Restart
cd /srv/www/htdocs/cva/cpm  
pm2 start prtg-dashboard

echo "✅ Emergency fix completed"