# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2025-11-17
### Added
- Interactive status cards with click-to-filter functionality on the main dashboard.
- `filterByStatus()` method that updates the status dropdown, applies filters, and smoothly scrolls to device list.
- Visual feedback on status cards with hover effects and tooltips.
- Seamless integration between stat card clicks and existing filter dropdown.

### Enhanced
- User experience with single-click filtering directly from overview statistics.
- Dashboard interactivity allowing quick navigation to specific device status categories.
- Accessibility with descriptive tooltips on clickable stat cards ("Click to show all/online/warning/offline devices").

### Technical
- Added `.stat-card.clickable` CSS class with cursor pointer and active state styling.
- Implemented `onclick` handlers for Total Devices, Online, Warning, and Offline stat cards.
- Enhanced `updateOverviewStats()` to generate clickable card elements with proper event bindings.

---

## [1.0.0] - 2025-10-12
### Added
- Admin Console landing page with quick links to session management and telemetry tools.
- Session Intelligence dashboard for viewing, purging, and terminating EDR-backed sessions.
- Telemetry Overview page that renders `/api/dashboard/summary` visually while preserving raw JSON access.
- Header shield icon providing a compact admin quick menu when an allow-listed user is signed in.
- `?format=json` support on `/health` for machine-friendly status checks.
- Comprehensive README with setup instructions and release workflow guidance.

### Changed
- Bumped application version to `1.0.0` signalling the first major release.

### Fixed
- Health check consumers no longer misinterpret the HTML response thanks to the JSON preference flag.

---

## [0.1.0] - 2025-10-08
- Initial pre-release snapshot of the PRTG unified dashboard.
