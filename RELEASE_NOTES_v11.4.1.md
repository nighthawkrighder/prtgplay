# Release Notes - Version 11.4.1

**Release Date:** December 11, 2025  
**Type:** Patch Release - Click Detection Refinements

## Overview
Enhanced topology view click detection with significantly improved auto zoom-out distance and mouse jitter tolerance for more reliable ship selection at all camera distances.

## Bug Fixes

### Topology Click Detection
- **Increased Auto Zoom-Out Distance** (Critical)
  - Raised minimum camera distance from 200 to 600 units before processing clicks
  - Ensures raycaster operates at optimal distance for accurate ship selection
  - Addresses issue where ships were only clickable when manually zoomed out far
  - Auto zoom-out now triggers at 3x the previous threshold

- **Enhanced Mouse Jitter Tolerance** (High)
  - Doubled maximum drag threshold scaling from 5x to 10x at close camera distances
  - Formula changed from `500/cameraDistance` to `1000/cameraDistance`
  - At 100 units: allows up to 50px mouse movement (was 25px)
  - Significantly more forgiving for hand tremor/movement when zoomed in close
  - Far distances remain strict (1x base threshold) for precision

## Technical Details

### Click Detection Formula
```javascript
// Distance-scaled drag threshold
scaledThreshold = baseDragThreshold * min(10, max(1, 1000/cameraDistance))
```

### Auto Zoom-Out Behavior
- Minimum distance: 600 units (increased from 200)
- Animation duration: 100ms
- Click processing: Deferred until zoom-out completes

## User Impact
- **Improved**: Ship selection now works reliably without manual zoom-out
- **Improved**: Close-up inspections allow more natural mouse movement
- **No Breaking Changes**: All existing functionality preserved

## Upgrade Notes
- No configuration changes required
- No database migrations needed
- Restart via PM2 applies changes immediately

## Related Issues
- Resolves: Ships difficult to click at close camera distances
- Resolves: Excessive mouse precision required when zoomed in

---
**Full Changelog:** v11.4.0...v11.4.1
