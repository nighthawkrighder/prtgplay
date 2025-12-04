# PRTG Dashboard v8.12.0 Release Notes

**Release Date:** December 4, 2025  
**Codename:** Seamless Topology Interactions  
**Aligns with:** CVA v10.1.0 "Galaxy Fleet Enhanced"

---

## 🎯 Overview

Version 8.12.0 delivers a complete overhaul of the 3D topology interaction system, achieving seamless click transitions across all 15 node type permutations (sensor↔sensor, sensor↔device, device↔device, company↔any, empty space↔any). This release eliminates all click-outside interference, duplicate event listeners, and popup state conflicts that previously required multiple clicks or empty space resets.

---

## ✨ New Features

### Perfect Popup Transitions (v8.11.6 → v8.11.28)
- **Universal Click Support**: All 15 click permutations work seamlessly:
  - Sensor → Sensor (with forced refresh)
  - Sensor → Device (zoom + device sensor list)
  - Device → Sensor (zoom + individual sensor details)
  - Device → Device (zoom + device sensor list)
  - Company → Any Node (clears state, zooms, shows appropriate popup)
  - Empty Space → Any Node (clean slate, full popup display)
- **Smart Popup Reuse**: Single popup element intelligently updates content based on node type
- **Intelligent State Tracking**: 
  - `lastPopupNode` tracks last displayed node for transition detection
  - `isProcessingCanvasClick` prevents click-outside listener interference during canvas clicks
- **Cyan Selection Highlighting**: Selected nodes glow with distinctive cyan (#00ffff) for clear visual feedback

### Click-Outside-to-Close Intelligence
- **Canvas Click Protection**: Click-outside listener properly detects canvas vs UI clicks
- **10ms Delay Check**: Ensures popup updates complete before checking click-outside status
- **Single Global Listener**: Removed duplicate listeners that caused immediate popup closure

### Enhanced Logging System
- **Comprehensive State Tracking**: Logs every `lastPopupNode` and `selectedNode` change
- **Transition Detection**: Logs `isSwitchingNodes` status for debugging
- **Material Application**: Confirms cyan highlighting applied to devices/sensors
- **Popup Display State**: Tracks when popup visibility changes

---

## 🔧 Technical Improvements

### Event Listener Architecture (v8.11.15 → v8.11.28)
- **Removed Duplicate Listeners**: Eliminated competing click-outside handlers in:
  - `showSensorPopup()` (100ms setTimeout listener)
  - `showIndividualSensorPopup()` (100ms setTimeout listener)
- **Single Global Handler**: Centralized click-outside logic with `isProcessingCanvasClick` flag
- **50ms Processing Delay**: Increased from 0ms to ensure popup updates complete before flag reset

### Popup State Management
- **Forced Refresh on Transitions**: When `isSwitchingNodes = true`:
  - Sets `popup.style.display = 'none'`
  - Forces reflow with `void popup.offsetHeight`
  - Re-displays with cyan border flash animation
- **lastPopupNode Clearing Strategy**:
  - Cleared on `closeSensorPopup()` (empty space clicks, company clicks)
  - Cleared in `showSensorPopup()` (device clicks reset sensor tracking)
  - Set to current sensor in `showIndividualSensorPopup()`
- **Zoom Completion Behavior**: Removed `lastPopupNode` clearing from zoom animation end (v8.11.24)

### Device Selection Highlighting (v8.11.26)
- **selectNode() Call Sequence**: Properly called before type-specific handlers
- **Material Preservation**: Stores `originalMaterial` before applying cyan glow
- **Scale Reset Logic**: Only resets scale for non-animated devices (status ≠ 5, 4, 10)
- **Deselection Flow**: Restores original material when selecting different node

### Status Filter Fixes (v8.11.20)
- **Status Circle Visibility**: `statusCircle.visible = false` when filtering by critical/warning/offline
- **Proper Aggregation**: Device status based on worst sensor status (5=down, 4=warning, 10=unusual)

---

## 🐛 Bug Fixes

### Critical Fixes
- **v8.11.26**: Device popup not showing after refresh or sensor clicks
  - Root cause: Duplicate 100ms setTimeout listener in `showSensorPopup()` 
  - Impact: Popup displayed then immediately closed
  - Solution: Removed duplicate listener, rely on global handler

- **v8.11.28**: Sensor-to-sensor transitions failing
  - Root cause: Duplicate 100ms setTimeout listener in `showIndividualSensorPopup()`
  - Impact: Second sensor click would show popup then close after 100ms
  - Solution: Removed duplicate listener competing with global handler

- **v8.11.19**: Sensor-to-sensor requiring deselect/reselect
  - Root cause: No transition detection between sensor clicks
  - Impact: Popup content wouldn't update without clicking outside first
  - Solution: Implemented `lastPopupNode` tracking with `isSwitchingNodes` detection

- **v8.11.17**: Click-outside listener interfering with canvas clicks
  - Root cause: No flag to distinguish canvas clicks from UI clicks
  - Impact: Popup would close during legitimate canvas click transitions
  - Solution: Added `isProcessingCanvasClick` flag with proper timing

### Minor Fixes
- **v8.11.21**: Post-zoom popup state confusion
  - Fixed: Removed `lastPopupNode` clearing from zoom completion
  - Impact: Allowed popup state to persist through zoom animations

- **v8.11.22**: Device clicks not resetting sensor popup state
  - Fixed: Added `lastPopupNode = null` in `showSensorPopup()`
  - Impact: Device sensor list now properly replaces individual sensor popups

- **v8.11.23**: Conditional `lastPopupNode` clearing causing state leaks
  - Fixed: Simplified to always clear on `closeSensorPopup()`
  - Impact: Consistent state management across all closure scenarios

- **v8.11.24**: Empty space clicks not closing popups
  - Fixed: Added `closeSensorPopup()` call in empty space handler
  - Impact: Clicking empty canvas now properly resets popup state

- **v8.11.25**: Company clicks leaving popup state active
  - Fixed: Added `closeSensorPopup()` call before company zoom
  - Impact: All 15 click permutations now work seamlessly

---

## 📊 Impact & Metrics

### Before v8.12.0
- ❌ Sensor → Sensor required clicking outside first
- ❌ Device popup appeared then immediately closed
- ❌ Company → Sensor → Sensor failed on second sensor
- ❌ Post-zoom clicks required empty space reset
- ❌ Multiple competing event listeners
- ❌ Inconsistent popup state management

### After v8.12.0
- ✅ All 15 click permutations work seamlessly
- ✅ Zero required clicks outside or double-clicks
- ✅ Single global click-outside handler
- ✅ Consistent popup state across transitions
- ✅ Comprehensive logging for debugging
- ✅ Perfect cyan highlighting on all node types

### Version Progression
- **v8.11.6-8.11.14**: Basic click/popup functionality
- **v8.11.15-8.11.19**: Click-outside-to-close, sensor transitions
- **v8.11.20**: Status filter fixes
- **v8.11.21-8.11.23**: Post-zoom state management
- **v8.11.24**: Empty space click handler
- **v8.11.25**: Company click permutations
- **v8.11.26**: Device popup duplicate listener removal
- **v8.11.27**: Enhanced logging for debugging
- **v8.11.28**: Individual sensor popup listener removal

---

## 🚀 Deployment Notes

### Automatic Deployment
- Changes in `/protected/topology.html` load on browser refresh (no restart required)
- PM2 restart not required for client-side topology improvements

### Testing Checklist - All 15 Permutations
1. ✅ Empty Space → Sensor (clean slate)
2. ✅ Empty Space → Device (clean slate)
3. ✅ Empty Space → Company (clean slate)
4. ✅ Sensor → Sensor (forced refresh)
5. ✅ Sensor → Device (zoom + device list)
6. ✅ Sensor → Company (clear state, zoom)
7. ✅ Sensor → Empty Space (close popup)
8. ✅ Device → Sensor (zoom + sensor details)
9. ✅ Device → Device (zoom + device list)
10. ✅ Device → Company (clear state, zoom)
11. ✅ Device → Empty Space (close popup)
12. ✅ Company → Sensor (clear state, zoom + sensor details)
13. ✅ Company → Device (clear state, zoom + device list)
14. ✅ Company → Company (zoom between companies)
15. ✅ Company → Empty Space (close any previous state)

### Visual Verification
- ✅ Cyan glow (#00ffff) applied to selected nodes
- ✅ Popup border flashes cyan on node transitions
- ✅ Status circles hidden when filtering by status
- ✅ Device highlighting persists through popup display

---

## 🔄 Upgrade Instructions

### From v9.2.1
```bash
cd /srv/www/htdocs/cva/cpm
git pull origin main
# No restart required - refresh browser to load new topology.html
```

### Browser Cache
- Hard refresh recommended: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
- Check browser console for new logging messages confirming v8.12.0

---

## 📝 Files Changed

### Frontend (HTML/JS/CSS)
- `protected/topology.html` - Complete popup interaction overhaul (23 commits, v8.11.6→v8.11.28)

### Key Code Changes
- Lines 2568-2577: Added `isProcessingCanvasClick` flag and `lastPopupNode` tracking
- Lines 2592-2600: Added `closeSensorPopup()` function
- Lines 2605-2690: Enhanced `showIndividualSensorPopup()` with transition detection
- Lines 2418-2428: Added state tracking logs in `showSensorPopup()`
- Lines 2211-2232: Enhanced `selectNode()` with comprehensive logging
- Lines 2070-2079: Added empty space click popup closure
- Lines 2283-2290: Added company click popup closure
- Lines 2655-2675: Single global click-outside listener with canvas protection
- Lines 2678-2685: Forced refresh logic for node transitions
- Removed: Duplicate 100ms setTimeout listeners (2 instances)

### Documentation
- `RELEASE_NOTES_v8.12.0.md` - This document
- `version.json` - Will be updated to reflect v8.12.0

---

## 🎓 User Guide

### Interacting with 3D Topology

#### Sensor Clicks
- **Single Sensor Click**: Zooms to sensor, shows individual sensor details popup
- **Sensor → Different Sensor**: Seamlessly transitions, updates popup content with cyan flash
- **Sensor → Device**: Zooms to device, shows device sensor list popup
- **Sensor → Company**: Closes sensor popup, zooms to company, highlights devices

#### Device Clicks
- **Single Device Click**: Zooms to device, shows device sensor list popup
- **Device → Different Device**: Seamlessly transitions, updates popup content
- **Device → Sensor**: Zooms to sensor, shows individual sensor details
- **Device → Company**: Closes device popup, zooms to company, highlights devices

#### Company Clicks
- **Company → Any Node**: Clears all popup state, zooms to target, shows appropriate popup
- **Company → Company**: Zooms between company locations

#### Empty Space Clicks
- **Empty Space Click**: Closes all popups, resets rotation, clears selection state
- **Empty Space → Any Node**: Clean slate interaction with fresh popup display

#### Visual Feedback
- **Cyan Glow**: Selected node glows with distinctive cyan (#00ffff) color
- **Popup Border Flash**: Cyan border flash when transitioning between nodes
- **Smooth Zoom**: 1000ms camera animation with easing
- **Status Circles**: Rotating status indicators (hidden during status filtering)

---

## 🔮 Future Enhancements

### Planned for v8.13.0
- Keyboard shortcuts for topology navigation (Arrow keys, Home, End)
- Minimap overview for large network topologies
- Search/filter bar to highlight specific devices or sensors
- Breadcrumb trail showing navigation path (Company → Device → Sensor)

### Planned for v9.0.0
- Multi-select with Ctrl+Click for bulk operations
- Right-click context menus for quick actions
- Drag-and-drop to reorganize topology layout
- Save/load custom topology views

---

## 📞 Support

### Issues & Questions
- GitHub Issues: https://github.com/nighthawkrighder/cva/issues
- Documentation: See README.md for topology interaction guide

### Known Limitations
- Touch devices: Long-press may not show hover tooltips
- Very large networks (>1000 devices): May experience FPS drops during rotation
- Browser zoom levels <80% or >150%: Text may be harder to read in popups

---

## 🏆 Credits

**Development Team:** LANAIR Technology Group  
**Release Manager:** CVA Engineering Team  
**Version Alignment:** CVA v10.1.0 "Galaxy Fleet Enhanced"  
**Special Recognition:** Persistent debugging through 23 commit iterations (v8.11.6→v8.11.28)

---

## 📜 Version History

- **v8.12.0** (2025-12-04) - Seamless Topology Interactions (this release)
- **v9.2.1** (2025-11-17) - Interactive Status Cards
- **v8.1.0** (2025-11-XX) - Topology WebGL Visualization
- **v1.0.0** (2025-10-12) - Admin Console, Session Intelligence

---

**End of Release Notes**
