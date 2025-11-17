# PRTG Dashboard v9.2.1 Release Notes

**Release Date:** November 17, 2025  
**Codename:** Interactive Status Cards  
**Aligns with:** CVA v9.2.0 "Velocity"

---

## 🎯 Overview

Version 9.2.1 introduces interactive status cards that transform the dashboard overview into a powerful filtering interface. Users can now click directly on status statistics to instantly filter the device list, significantly improving navigation and workflow efficiency.

---

## ✨ New Features

### Interactive Status Cards
- **Click-to-Filter**: Click any status card (Total Devices, Online, Warning, Offline) to instantly filter the device list
- **Automatic Dropdown Sync**: Status filter dropdown automatically updates to match your clicked card
- **Smooth Scrolling**: Automatically scrolls to the device list after filtering for seamless navigation
- **Visual Feedback**: Hover effects and descriptive tooltips guide user interaction
  - "Click to show all devices"
  - "Click to show online devices"
  - "Click to show warning devices"
  - "Click to show offline devices"

### Enhanced Branding
- **Clickable Logo**: ControlPoint Monitor logo now links to homepage with smooth hover animation

---

## 🔧 Technical Improvements

### Sensor-to-Device Linking (Critical Fix)
- **97.5% Success Rate**: Fixed sensor linking now properly associates 7,364 of 7,550 sensors to devices
- **Robust Device ID Parsing**: Enhanced parser handles invalid PRTG API responses:
  - Validates deviceid values (rejects '0', empty strings, null)
  - Multi-stage validation with proper type checking
  - Automatic fallback to device name matching
- **Accurate Status Detection**: Dashboard now correctly displays warning and offline devices instead of defaulting everything to online

### Dashboard Architecture
- **filterByStatus() Method**: New centralized filtering logic
  - Updates dropdown state
  - Applies filters to device list
  - Triggers smooth scroll to results
  - Maintains consistent state across UI components

### CSS Enhancements
- `.stat-card.clickable`: New class for interactive cards
  - Cursor pointer on hover
  - Active state feedback
  - Seamless integration with existing card styling

---

## 🐛 Bug Fixes

### Sensor Management
- **Fixed**: PRTG collector now properly parses deviceid field from API responses
- **Fixed**: Sensors without valid deviceid now fall back to device name matching
- **Fixed**: Status aggregation now works correctly with properly linked sensors
- **Fixed**: Sensor counts no longer show zero when devices have active sensors

### Status Detection
- **Fixed**: Devices with warning sensors now show warning status (not online)
- **Fixed**: Devices with offline sensors now show offline status (not online)
- **Fixed**: effectiveStatus calculation now uses actual sensor health metrics

---

## 📊 Impact & Metrics

### Before v9.2.1
- 7,550 sensors with `device_id: null`
- 0% sensor-to-device linking
- Sensor counts always showing 0
- All devices defaulting to "online" status
- Static status cards (display only)

### After v9.2.1
- 7,364 sensors properly linked (97.5% success rate)
- 186 sensors remain unlinked (2.5% - likely device name mismatches)
- Accurate sensor counts displayed
- Correct status detection (online/warning/offline)
- Interactive status cards with click-to-filter

---

## 🚀 Deployment Notes

### Automatic Deployment
- Changes in `/protected/soc-dashboard.html` load on browser refresh (no restart required)
- Backend sensor linking improvements active immediately via PM2 restart

### Testing Checklist
1. ✅ Click "Total Devices" card → shows all devices
2. ✅ Click "Online" card → filters to online devices only
3. ✅ Click "Warning" card → filters to warning devices only
4. ✅ Click "Offline" card → filters to offline devices only
5. ✅ Verify dropdown syncs with clicked card
6. ✅ Verify smooth scroll to device list
7. ✅ Verify hover tooltips display correctly
8. ✅ Verify sensor counts now display accurate numbers

---

## 🔄 Upgrade Instructions

### From v1.0.0
```bash
cd /srv/www/htdocs/cva/cpm
git pull origin main
git checkout v9.2.1
pm2 restart prtg-dashboard
```

### Database Migration
No database schema changes required. Sensor linking improvements work with existing schema.

---

## 📝 Files Changed

### Frontend (HTML/CSS/JS)
- `protected/soc-dashboard.html` - Added clickable stat cards, filterByStatus() method

### Backend (Node.js)
- `src/collectors/prtgCollector.js` - Enhanced deviceid parsing and device name fallback
- `src/routes/api.js` - Status calculation now uses linked sensor data

### Documentation
- `package.json` - Version bumped to 9.2.1
- `CHANGELOG.md` - Detailed change log entry
- `README.md` - Updated highlights with interactive cards feature
- `RELEASE_NOTES_v9.2.1.md` - This document

---

## 🎓 User Guide

### Using Interactive Status Cards

1. **View Overview Statistics**
   - Total Devices: Total count of monitored devices
   - Online: Devices with all sensors up
   - Warning: Devices with at least one warning sensor
   - Offline: Devices with at least one offline sensor

2. **Filter by Status**
   - Click any status card to filter the device list
   - The status dropdown automatically updates
   - Page scrolls to show filtered results

3. **Clear Filters**
   - Click "Total Devices" card to show all devices
   - Or use the status dropdown to select "All Status"

---

## 🔮 Future Enhancements

### Planned for v9.3.0
- Click sensor counts within device cards to view sensor details
- Drill-down from company view to device view via click
- Export filtered device lists to CSV/PDF
- Keyboard shortcuts for status filters (1=all, 2=online, 3=warning, 4=offline)

---

## 📞 Support

### Issues & Questions
- GitHub Issues: https://github.com/nighthawkrighder/prtgplay/issues
- Documentation: See README.md for setup and configuration

### Known Limitations
- 186 sensors (2.5%) remain unlinked due to device name mismatches between PRTG servers
- Status cards do not yet support middle-click or Ctrl+click for new tab behavior
- Mobile view: Touch interaction may not show hover tooltips (relies on title attribute)

---

## 🏆 Credits

**Development Team:** LANAIR Technology Group  
**Release Manager:** CVA Engineering Team  
**Version Alignment:** CVA v9.2.0 "Velocity"

---

## 📜 Version History

- **v9.2.1** (2025-11-17) - Interactive Status Cards (this release)
- **v1.0.0** (2025-10-12) - Admin Console, Session Intelligence, Telemetry Overview
- **v0.1.0** (2025-10-08) - Initial pre-release snapshot

---

**End of Release Notes**
