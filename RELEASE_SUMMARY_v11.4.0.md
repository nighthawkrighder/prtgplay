# Release Summary v11.4.0

## 3D Topology Enhancements & Data Consistency

**Release Date:** December 11, 2025

### Key Improvements

✅ **Fixed Device Orientation** - Ships now point toward center  
✅ **Complete Sensor Data** - Popup shows values like "100 %", "31 %", "871 kbit/s"  
✅ **Data Consistency** - Topology matches dashboard sidebar information  
✅ **Cache Prevention** - Fresh data on every page load

### Technical Changes

- Updated `/devices/enhanced` endpoint to return all 7 sensor fields
- Fixed device ship `lookAt()` calculation order
- Added cache-control headers to prevent stale data
- Aligned API responses between dashboard and topology views

### Bug Fixes

1. Device ships pointing down → Now point toward center (0,0,0)
2. Sensor values "No value" → Now show actual metrics
3. Incomplete API data → Now returns full sensor information

**Upgrade:** `pm2 restart prtg-dashboard` + hard refresh browsers
