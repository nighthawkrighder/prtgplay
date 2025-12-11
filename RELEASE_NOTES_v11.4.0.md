# Release Notes v11.4.0

**Release Date:** December 11, 2025  
**Type:** Minor Release  
**Focus:** 3D Topology Enhancements & Data Consistency

## 🎯 Overview

This release fixes critical issues in the 3D topology view, including device orientation and sensor data display. All devices now properly orient toward the center of the visualization, and sensor popups display complete monitoring data matching the dashboard sidebar.

## ✨ New Features

### 3D Topology Improvements

**Device Orientation Fix**
- Fixed device ships pointing downward instead of toward center
- Ships now correctly use `lookAt(0, 0, 0)` after position is set
- Improved visual clarity of network topology

**Complete Sensor Data Display**
- Sensor popups now show full monitoring data including:
  - Sensor name
  - Current value (e.g., "100 %", "31 %", "871 kbit/s")
  - Last message/status text
  - Sensor type
  - Priority level
- Previously showed "No value" for all sensors

## 🔧 Technical Changes

### API Route Consolidation

**Server.js Device Enhanced Endpoint**
- Updated `/devices/enhanced` route to return complete sensor fields
- Added sensor attributes: `name`, `sensorType`, `lastValue`, `lastMessage`
- Previously only returned: `id`, `status`, `sensor_type`, `priority`
- Matches dashboard API response format for data consistency

**API Routes Alignment**
- Ensured both `/api/devices/enhanced` and `/devices/enhanced` return identical data
- Added cache-control headers to prevent stale data:
  ```javascript
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
  'Pragma': 'no-cache'
  'Expires': '0'
  'Surrogate-Control': 'no-store'
  ```

### Frontend Improvements

**Topology Data Loading**
- Added timestamp parameter to API requests: `?all=true&_t=${Date.now()}`
- Prevents browser/proxy caching of device data
- Ensures fresh sensor values on each page load

**Sensor Field Access**
- Primary field names: `lastValue`, `sensorType`, `statusText` (camelCase)
- Fallback to snake_case: `last_value`, `sensor_type`, `status_text`
- Robust field access handles both Sequelize naming conventions

## 🐛 Bug Fixes

### Fixed Issues

1. **Device Ships Pointing Down**
   - **Issue:** All device ships oriented downward in 3D space
   - **Cause:** `lookAt()` called before `position.set()`
   - **Fix:** Moved position setting before orientation calculation
   - **Impact:** Visual clarity of topology improved significantly

2. **Sensor Values Showing "No value"**
   - **Issue:** Sensor popups displayed "No value" for all metrics
   - **Cause:** Server.js `/devices/enhanced` route returned only 4 sensor fields
   - **Fix:** Updated attributes array to include all 7 required fields
   - **Impact:** Full monitoring data now visible in topology view

3. **Data Inconsistency Between Views**
   - **Issue:** Dashboard sidebar showed complete data, topology showed incomplete
   - **Cause:** Different API endpoints with different field selections
   - **Fix:** Aligned both endpoints to return identical sensor data
   - **Impact:** Consistent user experience across all views

## 📝 Code Quality

### Removed Debug Logging
- Cleaned up console logging for production
- Removed debug statements from:
  - Sensor data inspection logs
  - Field key enumeration logs
  - Property access debug statements
- Kept essential operational logging

### Improved Comments
- Updated API route comments to reflect actual behavior
- Documented cache-busting strategy
- Clarified sensor field naming conventions

## 🔄 Migration Notes

### No Breaking Changes
- Existing functionality preserved
- API response format enhanced (additive changes only)
- Frontend gracefully handles both old and new field names

### Deployment Steps
1. Pull latest code
2. Restart PM2: `pm2 restart prtg-dashboard`
3. Hard refresh browsers to clear cached topology page (Ctrl+Shift+R)
4. Verify sensor values display correctly in topology popups

## 🎨 Visual Improvements

**Before:**
- Device ships pointed down uniformly
- Sensor popups showed "No value" for all metrics
- Incomplete monitoring information

**After:**
- Device ships point toward central Earth (0,0,0)
- Sensor popups show complete data:
  - System Health: "100 %"
  - Disk Free: "31 %"  
  - Network: "871 kbit/s"
  - Uptime: "30 d"
- Full monitoring visibility in 3D view

## 📊 Performance

- No performance impact
- Same number of API calls
- Slightly larger response payload (additional sensor fields)
- Cache-control headers prevent unnecessary re-requests

## 🔍 Testing Performed

- ✅ Device orientation verified for all 974 devices
- ✅ Sensor values display correctly for all device types
- ✅ Dashboard sidebar and topology show identical data
- ✅ Cache-busting prevents stale data display
- ✅ Both camelCase and snake_case field access works

## 📚 Documentation Updates

- Updated `.github/copilot-instructions.md` with sensor field naming
- Documented dual endpoint behavior (/api prefix stripping)
- Added cache-control header documentation

## 🙏 Credits

**Issue Reported By:** User feedback on sensor value display  
**Fixed By:** AI Agent with user collaboration  
**Testing:** Production environment validation

---

**Full Changelog:** [v11.3.0...v11.4.0](https://github.com/nighthawkrighder/prtgplay/compare/v11.3.0...v11.4.0)
