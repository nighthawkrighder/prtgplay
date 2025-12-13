# CPM v11.5.0 Release Notes

**Release Date:** 2025-12-13  
**Codename:** Unified Vendor Management  
**Aligns with:** CVA v11.5.0

---

## 🎯 Overview

This release includes various updates and improvements to the platform.

This release includes **4 commits** with various improvements, bug fixes, and enhancements.

---

## ✨ What's New

### Other Changes
- v11.4.0: Updates and improvements
- v11.3.0: Updates and improvements
- v11.4.2 - Added double-click zoom navigation: smart raycasting to ships or empty space with 500ms smooth animation
- v11.4.1 - Enhanced click detection: 3x auto zoom-out distance (600 units) + 2x mouse jitter tolerance (10x at close range)
---

## 🚀 Deployment Notes

### Automatic Deployment
- Changes load on browser refresh (no restart required for client-side changes)
- PM2 restart required for server-side changes: `pm2 restart prtg-dashboard`

### Upgrade Instructions

```bash
cd /srv/www/htdocs/cva/cpm
git pull origin main
```

---

## 📝 Version History

- **v11.5.0** (2025-12-13) - Unified Vendor Management (this release)

---

**End of Release Notes**
