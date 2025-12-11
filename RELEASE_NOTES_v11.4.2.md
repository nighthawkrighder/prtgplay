# Release Notes - Version 11.4.2

**Release Date:** December 11, 2025  
**Type:** Feature Release - Double-Click Zoom Navigation

## Overview
Added intuitive double-click zoom navigation to the topology view, allowing users to quickly zoom to any point in 3D space - whether clicking on a ship or empty space.

## New Features

### Double-Click Zoom Navigation (High)
- **Smart Target Detection**
  - Double-click on a ship: Zooms to that ship at 150 units distance
  - Double-click on empty space: Zooms along the ray direction into that area
  - Raycasting determines if click hit an object or empty space
  
- **Smooth Animation**
  - 500ms zoom animation with ease-out cubic easing
  - Camera position and target smoothly interpolate to destination
  - Non-blocking - doesn't interfere with other controls
  
- **Optimal Viewing Distance**
  - Automatically positions camera 150 units from target
  - Maintains proper orientation relative to center (0,0,0)
  - Works consistently regardless of current camera position

## Technical Details

### Implementation
```javascript
// Event listener
canvas.addEventListener('dblclick', onCanvasDoubleClick);

// Zoom calculation
const zoomDistance = 150;
const direction = camera.position.sub(targetPoint).normalize();
const endPos = targetPoint.add(direction.multiplyScalar(zoomDistance));
```

### Animation Easing
- Duration: 500ms
- Easing: Cubic ease-out (1 - (1 - t)³)
- Updates both camera position and OrbitControls target

## User Impact
- **New**: Quick navigation to any point in topology with double-click
- **Improved**: Faster inspection of specific ships or areas
- **Enhanced**: More intuitive 3D navigation workflow

## Upgrade Notes
- No configuration changes required
- No database migrations needed
- Restart via PM2 applies changes immediately

## Compatibility
- Works alongside existing single-click selection
- Compatible with OrbitControls camera movement
- Does not interfere with drag detection or auto zoom-out

---
**Full Changelog:** v11.4.1...v11.4.2
