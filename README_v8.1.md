# PRTG Dashboard - Version 8.1

## 🎯 Quick Start

```bash
# View dashboard
https://prtg.lanairgroup.com

# Check service status
pm2 status prtg-dashboard

# View logs
pm2 logs prtg-dashboard --lines 100

# Restart service
pm2 restart prtg-dashboard
```

## 📊 Current Status

| Metric | Value | Status |
|--------|-------|--------|
| **Total Devices** | 974 | ✅ All loading |
| **Companies** | 104 | ✅ Complete |
| **Online** | 848 | 🟢 87% |
| **Warnings** | 18 | 🟡 2% |
| **Down** | 8 | 🔴 1% |
| **Load Time** | ~2s | ✅ Acceptable |
| **JS Errors** | 0 | ✅ Clean |

## 🔧 What's New in v8.1

### Fixed Issues
1. **Missing redirectToLogin Method**
   - Added to SOCDashboard class
   - Fixes authentication redirect errors
   - Dashboard loads without hanging

2. **Complete Pagination** (v8.0)
   - All 974 devices load across 5 pages
   - Was only loading 200 devices (first page)
   - Fixed API returning wrong total count

3. **Clean Console** (v8.0)
   - Removed JavaScript errors
   - Silenced 404 spam
   - Debug-level logging only

## 📁 Project Structure

```
cpm/
├── src/
│   ├── routes/
│   │   └── api.js          # ✅ v8.0 Fixed pagination metadata
│   ├── server.js            # Main Express server
│   ├── models/              # Sequelize models
│   └── utils/               # Helper functions
├── protected/
│   ├── soc-dashboard.html   # ✅ v8.1 Fixed redirectToLogin
│   ├── topology.html        # 3D network visualization
│   └── login.html           # Authentication page
├── public/
│   ├── style_day.css        # Light theme
│   └── style_night.css      # Dark theme
├── RELEASE_NOTES_v8.1.md    # Detailed release notes
├── CHANGELOG_v8.x.md        # Version history
└── README_v8.1.md           # This file
```

## 🚀 Key Features

### Dashboard
- **Real-time monitoring** of 974 devices across 104 companies
- **Status indicators**: Online (green), Warning (yellow), Down (red)
- **Company grouping**: Expandable/collapsible company sections
- **Search & filter**: Find devices and companies quickly
- **Auto-refresh**: Updates every 60 seconds
- **Responsive design**: Works on desktop and mobile

### Topology
- **3D visualization** using Three.js
- **Company clusters**: Devices grouped by company
- **Interactive**: Click, drag, zoom
- **Color-coded**: Status-based coloring
- **Real-time updates**: WebSocket integration

### Performance
- **Fast loading**: 2-second full dataset load
- **Efficient pagination**: 200 devices per page
- **Guard clauses**: Prevents data regression
- **Smart caching**: Reduces server load

## 🔐 Security Features

### Activity Monitoring
**NOT User Tracking** - This is legitimate security monitoring:
- Detects user activity for session timeout
- Monitors: mousedown, mousemove, keypress, scroll, touchstart
- Used ONLY for auto-logout on inactivity
- NO third-party analytics
- NO personal data collection
- Local-only session management

### Session Management
- Session cookies: `cva.sid`, `edr.sid`
- HttpOnly, Secure, SameSite flags
- Automatic expiry on inactivity
- Cleared on logout
- Cross-domain authentication support

### Browser Tracking Warnings
Safari/Firefox may show warnings - this is **benign**:
- Activity monitoring is for session security
- Not actual user tracking
- No external service calls
- Privacy-respecting implementation

## 📖 API Documentation

### GET /api/devices/enhanced

Returns enhanced device list with sensors and metadata.

**Query Parameters:**
```javascript
{
  limit: 200,        // Devices per page (default: 100)
  offset: 0,         // Starting position (default: 0)
  company: 'CODE',   // Filter by company code
  site: 'SITE01',    // Filter by site
  search: 'term'     // Search device names
}
```

**Response Format (v8.0+):**
```json
{
  "devices": [
    {
      "id": 123,
      "name": "DEVICE-01",
      "status": 3,
      "effectiveStatus": 3,
      "sensorStats": {
        "total": 45,
        "up": 42,
        "down": 0,
        "warning": 3,
        "paused": 0
      },
      "companyName": "Company Name",
      "metadata": {...},
      "sensors": [...]
    }
  ],
  "pagination": {
    "total": 974,          // ✅ Total devices in database
    "fetched": 200,        // Devices in this response
    "limit": 200,          // Page size
    "offset": 0,           // Current offset
    "page": 1,             // Current page (1-indexed)
    "totalPages": 5,       // Total pages needed
    "hasMore": true        // ✅ More pages available
  }
}
```

### Status Codes
- **3** - Up (green)
- **4** - Warning (yellow)
- **5** - Down (red)
- **7** - Paused (gray)
- **10** - Unusual (orange)

## 🛠️ Development

### Prerequisites
```bash
# Node.js 14+
node --version

# PM2 for process management
npm install -g pm2

# Git for version control
git --version
```

### Local Setup
```bash
# Clone repository
cd /srv/www/htdocs/cva/cpm

# Install dependencies
npm install

# Start development server
npm run dev

# Or use PM2
pm2 start src/server.js --name prtg-dashboard
```

### Making Changes

1. **Create feature branch**
```bash
git checkout -b feature/your-feature-name
```

2. **Make changes and test**
```bash
# Edit files
# Test locally
pm2 restart prtg-dashboard
```

3. **Commit with descriptive message**
```bash
git add .
git commit -m "Description of changes"
```

4. **Push to main**
```bash
git push origin main
```

5. **Deploy to production**
```bash
pm2 restart prtg-dashboard
```

### Code Style

```javascript
// Use JSDoc comments for functions
/**
 * Description of what function does
 * @param {type} paramName - Parameter description
 * @returns {type} Return value description
 */
function myFunction(paramName) {
  // Implementation
}

// Use descriptive variable names
const deviceCount = 974;  // ✅ Good
const dc = 974;            // ❌ Bad

// Add comments for complex logic
// Calculate hasMore flag for pagination continuation
const hasMore = (currentOffset + enhancedDevices.length) < totalCount;
```

## 🐛 Troubleshooting

### Dashboard Shows Only 200 Devices
**Cause:** Browser cache or old version  
**Solution:**
```bash
# Hard refresh browser
Ctrl+Shift+R  # Windows/Linux
Cmd+Shift+R   # Mac

# Or clear cache
Browser Settings → Clear Browsing Data
```

### "Connecting..." Never Changes
**Cause:** JavaScript error or authentication issue  
**Solution:**
1. Open browser console (F12)
2. Check for errors
3. Verify v8.1 deployed: `pm2 describe prtg-dashboard`
4. Restart: `pm2 restart prtg-dashboard`

### Device Count Drops After Refresh
**Cause:** Guard clause rejected new data  
**Solution:**
```bash
# Check logs
pm2 logs prtg-dashboard | grep "REJECTED"

# Should see maxDeviceCountEverSeen value
# If stuck, clear localStorage in browser console:
localStorage.clear()
```

### Console Shows 404 Errors
**Expected:** Debug messages for `/api/session/status`
```
Session status endpoint not available (404)
```
This is normal - endpoint not yet implemented.

**Unexpected:** Other 404s
```bash
# Check if all files deployed
git status
git pull origin main
pm2 restart prtg-dashboard
```

### High Memory Usage
**Normal:** 20-30MB for dashboard process  
**High:** >100MB sustained

**Solution:**
```bash
# Restart service
pm2 restart prtg-dashboard

# Check for memory leaks in logs
pm2 logs prtg-dashboard | grep "memory"
```

## 📈 Performance Monitoring

### Key Metrics to Watch
```bash
# Process status
pm2 status prtg-dashboard

# Memory usage
pm2 monit

# Logs in real-time
pm2 logs prtg-dashboard --lines 0

# Restart count (should be low)
pm2 info prtg-dashboard | grep restart
```

### Performance Benchmarks
- **Load time:** < 3 seconds for 974 devices
- **Memory:** < 50MB sustained
- **CPU:** < 10% average
- **Restart count:** < 5 per day

### Optimization Tips
1. **Enable caching** for device counts
2. **Paginate** with cursor-based approach
3. **Compress** API responses with gzip
4. **Index** database columns used in WHERE clauses
5. **Monitor** slow query log

## 🧪 Testing

### Manual Testing Checklist
- [ ] Dashboard loads all 974 devices
- [ ] Shows 104 companies correctly
- [ ] No JavaScript errors in console
- [ ] Status indicators (online/warning/down) correct
- [ ] Search functionality works
- [ ] Company expand/collapse works
- [ ] Auto-refresh maintains device count
- [ ] Topology loads and renders correctly
- [ ] Authentication redirect works
- [ ] Session timeout logs out properly

### Automated Testing (Future)
```bash
# Unit tests (not yet implemented)
npm test

# Integration tests (not yet implemented)
npm run test:integration

# E2E tests (not yet implemented)
npm run test:e2e
```

## 📞 Support & Contacts

### Repository
- **GitHub:** github.com/nighthawkrighder/prtgplay
- **Branch:** main
- **Version:** 8.1

### Deployment
- **Server:** cvaserver1
- **Process:** prtg-dashboard (PM2)
- **Port:** 3010
- **URL:** https://prtg.lanairgroup.com

### Logs
- **PM2:** `pm2 logs prtg-dashboard`
- **Application:** `/srv/www/htdocs/cva/cpm/logs/`
- **System:** `/var/log/nginx/`

### Quick Commands
```bash
# Status
pm2 status prtg-dashboard

# Restart
pm2 restart prtg-dashboard

# Logs
pm2 logs prtg-dashboard --lines 100

# Info
pm2 info prtg-dashboard

# Stop
pm2 stop prtg-dashboard

# Start
pm2 start prtg-dashboard
```

## 📚 Additional Resources

- **Release Notes:** [RELEASE_NOTES_v8.1.md](RELEASE_NOTES_v8.1.md)
- **Changelog:** [CHANGELOG_v8.x.md](CHANGELOG_v8.x.md)
- **Migration Guide:** See CHANGELOG_v8.x.md → Migration section
- **API Docs:** This README → API Documentation section

## 🎓 Understanding the Fix

### The Pagination Problem (v8.0)
```javascript
// BEFORE (Wrong): Only showed 200 devices
pagination: {
  total: enhancedDevices.length,  // = 200 (page size)
  fetched: 200
}
// Client thinks: "Total is 200, I have 200, I'm done!"

// AFTER (Fixed): Shows all 974 devices
pagination: {
  total: totalCount,              // = 974 (actual DB count)
  fetched: 200,
  hasMore: true                   // = "Keep fetching!"
}
// Client thinks: "Total is 974, I have 200, keep going!"
```

### The Authentication Problem (v8.1)
```javascript
// BEFORE: SOCDashboard calling method from different class
class SOCDashboard {
  requireAuthentication() {
    this.redirectToLogin();  // ❌ Error: method doesn't exist
  }
}

// AFTER: Each class has its own method
class SOCDashboard {
  redirectToLogin() { ... }  // ✅ Method exists
  requireAuthentication() {
    this.redirectToLogin();  // ✅ Works!
  }
}
```

## ✅ Version 8.1 Checklist

- [x] All 974 devices load correctly
- [x] 104 companies display properly
- [x] No JavaScript errors
- [x] Clean console output
- [x] Authentication flow works
- [x] Pagination completes all pages
- [x] Guard clause prevents regression
- [x] Documentation updated
- [x] Code commented
- [x] Git committed and pushed
- [x] Production verified
- [x] Release notes published

---

**Version:** 8.1  
**Last Updated:** November 30, 2025  
**Status:** ✅ Production Ready  
**Maintained by:** Development Team
