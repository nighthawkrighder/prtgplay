# Release Notes - Version 11.2.3

**Release Date:** December 10, 2025  
**Type:** Patch Release - 3D Topology Enhancements

## 🎯 Overview
This release focuses on improving the 3D network topology visualization with dynamic status-based ship engine colors, better device positioning, and intelligent camera interaction handling.

---

## ✨ New Features

### Dynamic Ship Engine Colors
- **Mothership Status Reflection**: Mothership engines now dynamically change color based on the aggregate status of their visible child devices
  - 🔴 **Red** - Any child device is down (status 5)
  - 🟡 **Yellow/Orange** - Any child device has warnings (status 4/10/1)
  - 🔵 **Cyan** - All child devices are healthy (status 3)
- **Individual Device Colors**: Each device ship engine reflects its own status independently
- **Filtered View Support**: In filtered views, motherships reflect only the status of currently visible devices
- **SOS Morse Code**: Motherships in trouble (red/yellow) blink SOS pattern for attention

### Individual Material Instances
- Each ship now has its own engine material (cloned from cached templates)
- Enables independent color animation without affecting other ships
- Maintains performance optimization through geometry sharing
- Preserves WebGL efficiency improvements from previous versions

---

## 🔧 Improvements

### Device Positioning Accuracy
- **Fixed radial alignment**: Devices now position correctly relative to their parent motherships
- **Improved coordinate system**: Uses proper radial/tangential offsets for grid placement
  - Radial offset: Pushes devices toward/away from galaxy center
  - Tangential offset: Spreads devices left/right perpendicular to radial line
- **Tightened spacing**: Reduced column spacing from 30 to 20 units for better visual grouping
- **Centered grid calculation**: Fixed centering logic for multi-column device layouts

### Camera Interaction Intelligence
- **Drag Detection**: Distinguishes between deliberate clicks and camera panning
  - 10-pixel threshold for drag detection
  - Mouse movement tracking from mousedown to click event
- **OrbitControls Integration**: Monitors camera manipulation state
  - Tracks 'start', 'change', and 'end' events from OrbitControls
  - Only blocks clicks if camera actually moved (not just mousedown/up)
  - Prevents accidental zoom during panning operations
- **Smart Click Filtering**: Ignores clicks that result from releasing drag operations
- **No Delay on True Clicks**: Eliminated time-based buffers for instant response

---

## 🐛 Bug Fixes

### Status Color Issues
- Fixed ships all cycling the same color due to shared material references
- Fixed motherships showing constant cyan regardless of child device status
- Fixed status calculation to only consider visible devices in filtered views

### Positioning Issues
- Fixed devices appearing skewed/offset from parent motherships
- Corrected rotation matrix for column grid alignment
- Fixed device clustering appearing under wrong companies

### Click/Zoom Issues
- Fixed unintended zoom when releasing mouse after panning
- Fixed drag detection not working due to scope issues (moved variables to window object)
- Fixed zoom not working due to overly aggressive time-based blocking
- Fixed false positives where simple clicks were treated as drags

---

## 🏗️ Technical Details

### Material Management
```javascript
// Before: Shared materials (all ships affected by color changes)
const materials = [materialCache.shipHull, materialCache.shipEngine];

// After: Individual engine materials per ship
const instanceEngineMaterial = materialCache.shipEngine.clone();
const materials = [materialCache.shipHull, instanceEngineMaterial];
```

### Status Calculation
```javascript
function getNodeEffectiveStatus(node) {
    // Devices: Return own status
    // Motherships: Calculate from visible children only
    // Priority: Down > Warning > Up
}
```

### Drag Detection Logic
```javascript
// OrbitControls events track actual camera movement
controls.addEventListener('change', () => {
    window.orbitControlsWasUsed = true; // Camera moved
});

// Click handler checks if drag occurred
if (window.orbitControlsWasUsed) {
    return; // Block click
}
```

### Device Positioning Math
```javascript
// Proper radial/tangential coordinate system
const rotatedOffsetX = 
    columnOffsetRadial * Math.cos(companyAngle) + 
    columnOffsetTangent * Math.cos(companyAngle + Math.PI / 2);
```

---

## 📊 Performance

### Maintained Optimizations
- ✅ Shared geometries (80-90% reduction in objects from v11.1.0)
- ✅ Texture caching system
- ✅ Material pooling for status-based materials
- ➕ Individual engine materials for color independence (minimal overhead)

### New Overhead
- **Per-ship engine materials**: ~1 cloned material per ship
  - Impact: Negligible (materials are lightweight compared to geometries)
  - Benefit: Independent color animation essential for status visualization

---

## 🎮 User Experience

### Visual Feedback
- Motherships now provide instant visual feedback of fleet health
- Color cycling naturally draws attention to problem areas
- SOS morse code pattern adds urgency indicator for critical issues

### Interaction Quality
- Smooth panning without accidental selections
- Responsive clicking for deliberate node selection
- Natural camera manipulation feel

### Filtered Views
- Motherships accurately reflect visible subset status
- Dynamic color updates as filters change
- No confusion from hidden device status affecting visible indicators

---

## 🔄 Migration Notes

### Backwards Compatibility
- ✅ All existing features maintained
- ✅ No API changes
- ✅ No configuration changes required
- ✅ Existing saved views/filters work unchanged

### Automatic Upgrades
- Engine colors update automatically based on current data
- No user action required for new features
- Existing deployments benefit immediately

---

## 🧪 Testing Recommendations

1. **Status Colors**: Verify motherships change color based on child device status
2. **Filtered Views**: Check mothership colors update when filters change
3. **Camera Interaction**: Test that panning doesn't trigger zoom
4. **Click Responsiveness**: Ensure deliberate clicks still work immediately
5. **Device Positioning**: Verify devices appear under correct motherships

---

## 📝 Known Limitations

- SOS morse code pattern may be subtle on small displays
- Very rapid filter changes may have 1-frame delay in color updates
- Drag threshold (10px) is fixed (not user-configurable)

---

## 🚀 Future Enhancements

- Configurable drag threshold in settings
- Status color customization options
- Alternative alert patterns beyond SOS morse code
- Device positioning density controls

---

## 👥 Credits

**Development Team**: LANAIR SOC Dashboard Team  
**Version**: 11.2.3  
**Previous Version**: 11.2.2  
**Architecture**: Node.js + Three.js WebGL  

---

## 📞 Support

For issues or questions about this release:
- Check console logs for drag/click detection messages
- Verify filtered view shows expected devices
- Review status calculations in browser dev tools

---

**Upgrade Command:**
```bash
git pull origin main
pm2 restart ecosystem.config.js
```
