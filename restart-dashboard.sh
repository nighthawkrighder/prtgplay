#!/bin/bash

# PRTG Dashboard Safe Restart Script
# This script prevents port conflicts by ensuring clean shutdowns

echo "🔄 Starting PRTG Dashboard safe restart..."

# Step 1: Stop PM2 processes gracefully
echo "⏹️  Stopping PM2 processes..."
pm2 stop prtg-dashboard
sleep 2

# Step 2: Kill any remaining processes on port 3010
echo "🧹 Cleaning up port 3010..."
PIDS=$(lsof -ti:3010 2>/dev/null)
if [ ! -z "$PIDS" ]; then
    echo "   Found processes on port 3010: $PIDS"
    sudo kill -9 $PIDS
    echo "   ✅ Killed orphaned processes"
else
    echo "   ✅ Port 3010 is clean"
fi

# Step 3: Wait a moment for cleanup
echo "⏳ Waiting for cleanup..."
sleep 3

# Step 4: Verify port is free
if sudo ss -tlnp | grep -q ":3010"; then
    echo "❌ Port 3010 still in use, forcing cleanup..."
    sudo pkill -f "node.*srv/www/htdocs/cpm"
    sleep 2
fi

# Step 5: Start PM2 process
echo "🚀 Starting PRTG dashboard..."
cd /srv/www/htdocs/cva/cpm
pm2 start ecosystem.config.js

# Step 6: Verify startup
echo "⏳ Verifying startup..."
sleep 5

if curl -s -w "%{http_code}" -o /dev/null http://localhost:3010/ | grep -q "302"; then
    echo "✅ PRTG Dashboard restart successful!"
    echo "📊 Dashboard available at: http://localhost:3010"
    pm2 status
else
    echo "❌ Restart failed - checking logs..."
    pm2 logs prtg-dashboard --lines 10
fi

echo "🏁 Restart script completed"