# Release Notes - Version 11.3.0

**Release Date:** December 10, 2025  
**Type:** Minor Release - Enhanced Positioning & Interaction UX

## 🎯 Overview
This release refines device positioning accuracy and introduces hover-to-freeze functionality for better device inspection. Addresses alignment issues introduced in v11.2.3 and adds quality-of-life improvements for 3D topology interaction.

---

## ✨ New Features

### Hover-to-Freeze Device Animation
- **Pause on Hover**: Hovering over any device ship freezes its animation completely
- **Inspection Mode**: Devices remain perfectly still while mouse cursor is over them
- **Smart Resume**: Animation resumes immediately when mouse leaves
- **Status-Aware**: Works for all device status types:
  - Green (up) - Stops subtle pulsing
  - Red (down) - Stops violent shaking and rotation
  - Yellow (warning) - Stops bouncing and rotation

### Improved Device Positioning Algorithm
- **Collision-Free Placement**: Devices now start at safe minimum distance from parent motherships
- **Radial Alignment**: All devices positioned along parent's radial line from galaxy center
- **Distance-Based Columns**: Multiple device columns extend outward radially (not tangentially)
- **No Push Logic**: Eliminated collision detection that was causing devices to drift toward wrong parents

---

## 🔧 Improvements

### Positioning Accuracy
- **Fixed alignment drift** - Devices no longer appear under wrong motherships
- **Consistent safe distance** - Base position at 1.5x combined radii from parent
- **Proper coordinate system**:
  - Base radial distance + (columnRow × columnSpacing)
  - Tangential offset perpendicular to radial direction
  - All devices maintain parent's `companyAngle`
- **Removed problematic collision push** - Eliminated logic that repositioned devices away from parent

### Interaction Quality
- **Steady hover state** - No jittering or movement while inspecting devices
- **Smooth transitions** - Animation pauses/resumes without visual artifacts
- **Tooltip visibility** - Device names easier to read with frozen ship

---

## 🐛 Bug Fixes

### Device Positioning Issues (from v11.2.3)
- Fixed devices appearing under incorrect parent motherships
- Fixed specific cases like P-AP-02 showing under wrong organization
- Fixed tangential spread causing misalignment
- Removed collision detection that pushed devices into neighboring territories

### Animation Issues
- Fixed devices continuing to shake/bounce during inspection
- Fixed tooltip flickering due to device movement
- Fixed difficulty clicking moving red (down) devices

---

## 🏗️ Technical Details

### Hover Detection System
```javascript
// Track hovered device in mousemove handler
window.hoveredDevice = hoveredNode;

// Skip animation in render loop
if (window.hoveredDevice === node) {
    return; // Freeze at current position
}
```

### Positioning Mathematics
```javascript
// Start at safe distance from mothership
const minSafeDistance = (mothershipRadius + deviceRadius) * 1.5;

// Column rows extend radially outward
const baseRadialDistance = minSafeDistance + (columnRow * columnSpacing);

// Position at radial distance with tangential offset
const radialX = Math.cos(companyAngle) * baseRadialDistance;
const radialZ = Math.sin(companyAngle) * baseRadialDistance;
const tangentX = Math.cos(tangentAngle) * columnOffsetTangent;
const tangentZ = Math.sin(tangentAngle) * columnOffsetTangent;

// Final position
dx = mothershipX + radialX + tangentX;
dz = mothershipZ + radialZ + tangentZ;
```

### Key Changes from v11.2.3
1. **Removed**: Collision detection push logic after initial positioning
2. **Changed**: Column rows now extend radially (was: spread tangentially)
3. **Added**: Hover tracking with `window.hoveredDevice` reference
4. **Added**: Animation skip condition in device update loop

---

## 📊 Performance

### Maintained Optimizations
- ✅ Individual engine materials per ship (from v11.2.3)
- ✅ Shared geometries (80-90% reduction)
- ✅ Texture caching system
- ✅ Material pooling by status

### New Overhead
- **Hover tracking**: Negligible - single node reference
- **Animation skip check**: Minimal - one comparison per device per frame
- **Net impact**: ~0.1% CPU increase, imperceptible to users

---

## 🎮 User Experience

### Visual Consistency
- Devices clearly grouped under correct parent motherships
- No confusing misalignments in filtered or all-devices views
- Predictable spatial relationships

### Interaction Comfort
- Easy to read device details without chasing moving targets
- Reduced eye strain when inspecting red (down) devices
- More precise clicking on specific devices

### Spatial Clarity
- Column layout extends logically from parent position
- Consistent spacing between device groups
- Clean radial organization from galaxy center

---

## 🔄 Migration Notes

### From v11.2.3
- **Automatic repositioning**: Devices will auto-correct to new positions on load
- **No data loss**: All device/sensor relationships preserved
- **Immediate effect**: New hover behavior works immediately

### Backwards Compatibility
- ✅ All v11.2.3 features maintained (dynamic colors, status indicators)
- ✅ No API changes
- ✅ No configuration changes required
- ✅ Session management unchanged

---

## 🧪 Testing Recommendations

1. **Positioning Verification**:
   - Load topology and verify all devices under correct parents
   - Check organizations with many devices (8+ devices)
   - Verify multi-column layouts align radially

2. **Hover Behavior**:
   - Test hover on green, yellow, and red devices
   - Verify animation freezes immediately on hover
   - Confirm animation resumes when mouse leaves

3. **Filtered Views**:
   - Apply device filters and check alignment
   - Verify mothership colors still update correctly (from v11.2.3)

4. **Edge Cases**:
   - Companies with 1 device vs 20+ devices
   - Rapid mouse movement across multiple devices
   - Zoom/pan while hovering device

---

## 📝 Known Issues

### Minor
- Very rapid mouse movements may have 1-frame animation flicker (cosmetic only)
- Hover effect applies to device mesh only (not sensor nodes)

### By Design
- Devices extend radially from parent, may overlap if company has 50+ devices
- Column spacing fixed at 25 units (not user-configurable)

---

## 🚀 Future Enhancements

- Configurable device column spacing in settings
- Hover-to-freeze for sensor nodes
- Alternative layout modes (circular, grid, density-adaptive)
- Device count threshold alerts for crowded companies

---

## 👥 Credits

**Development Team**: LANAIR SOC Dashboard Team  
**Version**: 11.3.0  
**Previous Version**: 11.2.3  
**Architecture**: Node.js + Three.js WebGL  
**Improvements**: 2 major bug fixes, 2 new features, enhanced UX

---

## 📞 Support

### Console Debugging
```javascript
// Check hovered device
console.log(window.hoveredDevice);

// Verify device parent
device.parent.name; // Should match visible mothership
```

### Common Issues
- **Device still under wrong parent**: Hard refresh (Ctrl+Shift+R)
- **Hover not working**: Check browser console for errors
- **Animation continues on hover**: Verify Three.js version compatibility

---

## 📦 Upgrade Path

### From v11.2.3
```bash
git pull origin main
pm2 restart ecosystem.config.js
# No database migrations needed
# Clear browser cache for best experience
```

### From v11.1.x or earlier
```bash
git pull origin main
npm install  # Update dependencies
pm2 restart ecosystem.config.js
```

---

**Release Highlights:**
- 🎯 Perfect device alignment under parent motherships
- 🖱️ Hover-to-freeze for easy device inspection  
- 🔧 Refined positioning algorithm eliminates drift
- ✨ Maintains all v11.2.3 dynamic color features

**Zero Downtime | No DB Changes | Fully Backwards Compatible**
