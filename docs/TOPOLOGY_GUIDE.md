# 3D Network Topology Visualization

## Overview

The 3D Network Topology provides an immersive, interactive visualization of your entire PRTG-monitored network infrastructure using WebGL and Three.js.

## Features

### 🎯 Interactive 3D Navigation
- **Orbit Controls**: Click and drag to rotate the view
- **Zoom**: Mouse wheel to zoom in/out
- **Pan**: Right-click and drag to pan
- **Auto-Rotate**: Continuous rotation for presentation mode

### 🏢 Hierarchical Visualization
- **Companies**: Large blue spheres positioned in a circle
- **Devices**: Color-coded boxes orbiting around their company
  - 🟢 Green = Online
  - 🟡 Yellow = Warning
  - 🔴 Red = Offline
- **Sensors**: Purple cones (expandable per device)

### 🔍 Search & Filter
- **Real-time Search**: Find companies or devices instantly
- **Status Filtering**: Filter by online/warning/offline
- **Click-to-Focus**: Click any node to zoom and view details

### 📊 Information Panel
- **Device Details**: Status, IP address, sensor counts
- **Company Stats**: Device counts per company
- **Real-time Updates**: Live connection to PRTG data

### 🎨 Visual Controls
- **Node Size**: Adjust size of all nodes (0.5x - 2x)
- **Spread Factor**: Control spacing between elements (0.5x - 3x)
- **Toggle Labels**: Show/hide node names
- **Toggle Connections**: Show/hide connecting lines

## Usage

### Accessing the Topology
1. Navigate to the main dashboard
2. Click the "Topology" button in the navigation sidebar
3. Or directly access: `https://your-domain.com/topology`

### Navigation Controls

#### Mouse Controls
- **Left Click + Drag**: Rotate camera around scene
- **Right Click + Drag**: Pan camera
- **Scroll Wheel**: Zoom in/out
- **Click Node**: Select and focus on that node

#### Keyboard Shortcuts
- **R**: Reset camera to default view
- **A**: Toggle auto-rotate mode

#### Control Panel (Right Side)
- **Node Size Slider**: Scale all nodes
- **Spread Factor Slider**: Adjust node spacing
- **Search Box**: Type to find companies/devices
- **Status Filter**: Filter by device status
- **Toggle Labels**: Show/hide text labels
- **Toggle Lines**: Show/hide connections
- **Expand All**: Show all sensor nodes
- **Collapse All**: Hide all sensor nodes

### Understanding the View

#### Node Types
1. **Company Nodes** (Large Blue Spheres)
   - Represent organizational groups
   - Central hub for related devices
   - Positioned in outer circle

2. **Device Nodes** (Colored Boxes)
   - Orbit around their company node
   - Color indicates health status
   - Rotating animation for visual interest

3. **Sensor Nodes** (Purple Cones)
   - Orbit around their parent device
   - Collapsed by default (performance)
   - Expandable via controls

#### Color Legend
- 🔵 **Blue** = Company/Organization
- 🟢 **Green** = Device Online (All sensors up)
- 🟡 **Yellow** = Device Warning (Some sensors warning)
- 🔴 **Red** = Device Offline (Some sensors down)
- 🟣 **Purple** = Sensor

#### Connection Lines
- **Gray Lines**: Show relationships
  - Company → Device
  - Device → Sensor (when expanded)
- Opacity adjusts based on zoom level
- Can be toggled off for cleaner view

## Performance Optimization

### Large Networks
For networks with 500+ devices:
1. Keep sensors collapsed by default
2. Use status filtering to focus on specific subsets
3. Adjust spread factor to reduce visual density
4. Disable labels for better performance

### Rendering Settings
- **Anti-aliasing**: Enabled for smooth edges
- **Fog**: Depth cue for spatial awareness
- **Dynamic LOD**: Future enhancement planned

## Technical Details

### Technology Stack
- **Three.js**: WebGL 3D rendering engine
- **OrbitControls**: Camera navigation
- **Canvas API**: Text label rendering
- **WebSocket**: Real-time data updates (planned)

### Data Flow
1. Fetch device data from `/devices/enhanced` API
2. Group devices by company
3. Calculate spatial positions using circular layout
4. Create 3D meshes and materials
5. Render scene at 60fps
6. Update on data changes

### Browser Compatibility
- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+
- ⚠️ IE11: Not supported (WebGL 2.0 required)

### Performance Characteristics
- **Small Network** (<100 devices): 60fps, smooth
- **Medium Network** (100-500 devices): 45-60fps
- **Large Network** (500+ devices): 30-45fps
- **Very Large Network** (1000+ devices): Consider pagination

## Troubleshooting

### Scene Not Loading
1. Check browser console for errors
2. Verify `/devices/enhanced` API is accessible
3. Ensure WebGL is enabled in browser
4. Try disabling browser extensions

### Performance Issues
1. Collapse all sensors first
2. Reduce node size multiplier
3. Disable labels
4. Close other GPU-intensive applications
5. Update graphics drivers

### Missing Nodes
1. Verify devices have proper company assignments
2. Check device status in main dashboard
3. Try resetting filters
4. Refresh the page

### Controls Not Responding
1. Click on canvas to focus
2. Check for JavaScript errors in console
3. Try different mouse/trackpad
4. Reset camera view

## Future Enhancements

### Planned Features (v9.3.0)
- [ ] WebSocket real-time updates
- [ ] Drill-down animations (company → device → sensor)
- [ ] Traffic flow visualization
- [ ] Alert animations (pulsing red)
- [ ] VR mode support
- [ ] Network path tracing
- [ ] Export to image/video
- [ ] Time-travel (historical topology)

### Experimental Features
- [ ] Physics-based layout
- [ ] Force-directed graph
- [ ] Clustering algorithm
- [ ] Heat map overlay
- [ ] Network traffic particles

## API Reference

### Endpoints Used
- `GET /devices/enhanced` - Fetch all devices with sensor stats
- `GET /topology` - Serve topology HTML page (auth required)

### Data Structure Expected
```javascript
{
  name: "Device Name",
  company: "Company Name",
  host: "192.168.1.1",
  effectiveStatus: "up|warning|down",
  sensorStats: {
    total: 10,
    up: 8,
    warning: 1,
    down: 1
  }
}
```

## Tips & Tricks

### Best Practices
1. **Start with Overview**: Use reset camera to see full network
2. **Filter First**: Reduce clutter before searching
3. **Use Search**: Faster than manual navigation
4. **Bookmark Nodes**: Click to remember interesting devices
5. **Adjust Spread**: Find optimal spacing for your network

### Presentation Mode
1. Enable auto-rotate
2. Zoom to optimal level
3. Disable labels for cleaner look
4. Full-screen browser (F11)

### Investigation Workflow
1. Filter by status (e.g., "offline")
2. Click device to see details
3. Check sensor counts in info panel
4. Navigate to main dashboard for deep dive

## Support

### Documentation
- Main Dashboard: See dashboard help section
- API Docs: `/api/docs` (if enabled)
- GitHub: See repository README

### Known Limitations
- Sensor nodes limited to 10 per device for performance
- No mobile touch gesture support yet
- Labels may overlap in dense areas
- Maximum recommended: 2000 devices

### Feedback
Report issues or suggest features through your admin portal.

---

**Version**: 9.2.1  
**Last Updated**: November 17, 2025  
**Requires**: PRTG Dashboard v9.2.1+
