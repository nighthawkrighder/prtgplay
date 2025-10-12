# Changelog

All notable changes to this project will be documented in this file.

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
