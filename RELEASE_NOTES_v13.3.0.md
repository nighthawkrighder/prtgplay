# Release Notes — v13.3.0

**Release Date:** 2026-03-01
**Type:** Minor — Analytics module rewrite + 4 new reports

---

## Highlights

- **Analytics module completely rewritten** — was non-functional; now a full multi-tab dashboard with 6 live KPIs, four chart types rendered in Canvas 2D, and 5-minute auto-refresh.
- **4 new production-quality reports** added to the Reports Catalog (SLA Uptime, Flapping Devices, Sensor Type Distribution, Alert Ack Latency), each with their own API endpoint, HTML viewer page, and JS renderer.
- **Reports Catalog** updated to list all 6 reports with proper viewer and JSON URL bindings.
- Navigation consistency fixes across all report viewers (Analytics ↔ Reports ↔ Dashboard).

---

## New Features

### Analytics Module (`/analytics`)

Complete ground-up rewrite of `protected/analytics.html` and `public/js/analytics/analytics.js`.

**UI changes**
- 6-card KPI strip: Total Servers, Total Devices, Avg Health %, Warn/Down count, Total Sensors, Alerts (24 h)
- Tab bar: **Health**, **Alerts**, **Companies** — each tab swaps the main chart + side panel
- Two-column layout: main canvas (left) + contextual side panel (right)
- Sticky status bar with animated spinner during every fetch

**Chart types (all Canvas 2D, no external libraries)**
- `drawLineChart` — area fill, confidence band, "now" separator, dashed forecast, dot markers for sparse data
- `drawStackedBar` — severity-stacked alert volume bars, auto-legend
- `drawHBar` — horizontal bars with min/max range ticks and gradient fill, per-company health
- `drawDonut` — sensor status donut with center total label

**Data loading**
- `Promise.allSettled` — partial API failure no longer kills the entire page
- 5-minute auto-refresh via `scheduleRefresh()`
- Graceful degradation: each panel renders independently

**New API endpoint**
- `GET /api/analytics/company-health` — per-company avg/min/max health from `device_snapshots`, 60 s cache

---

### New Report: SLA / Uptime by Company (`/reports/sla-uptime`)

Compares per-company actual uptime against a configurable SLA threshold.

- Controls: lookback window (7 d / 30 d / 90 d / 1 yr), SLA target % (default 99.0 %)
- KPIs: Company count, SLA target, breaching companies, avg uptime, total breaches
- Chart: horizontal bar chart ranked by uptime; SLA threshold line overlaid in red
- Detail table: company, uptime %, device count, breach buckets, est. breach minutes, MET / BREACH badge
- API: `GET /api/reports/sla-uptime?hours=&slaTarget=`

---

### New Report: Flapping / Unstable Devices (`/reports/flapping-devices`)

Identifies devices with the highest health-percentage standard deviation — chronic intermittent faults.

- Controls: lookback window (24 h / 7 d / 30 d), result limit (15 / 25 / 50)
- Chart: horizontal σ-ranked bar with min/max range tick overlays
- Volatility levels: Critical / High / Moderate / Low (driven by σ thresholds)
- Detail table: rank, device, company, avg health, σ, health range, volatility badge, bad-bucket count
- API: `GET /api/reports/flapping-devices?hours=&limit=`

---

### New Report: Sensor Type Distribution (`/reports/sensor-type-distribution`)

Full breakdown of every sensor type in the environment by operational status.

- No time-range controls — always reflects live sensor table
- KPIs: sensor type count, total sensors, up/warning/down totals with percentages
- Chart: stacked horizontal bar per type (Up / Warning / Down / Paused / Other), auto-scales height to row count
- Detail table: type, total, up, warning, down, paused counts with inline percentages
- API: `GET /api/reports/sensor-type-distribution`

---

### New Report: Alert Acknowledgment Latency (`/reports/alert-ack-latency`)

Measures how quickly alerts are being acknowledged, per severity.

- Controls: lookback window (24 h / 7 d / 30 d)
- KPIs: total alerts, acknowledged, global ack rate, avg ack time, stale alert count
- Severity table: ack rate, avg latency, max latency — color-coded ≥ 80 % / < 80 %
- Stale alerts table: unacknowledged alerts with age
- Trend chart: hourly alert volume (area) + ack rate (dashed overlay)
- API: `GET /api/reports/alert-ack-latency?hours=`

---

### Reports Catalog (`/reports`)

- Updated `GET /api/reports/catalog` to enumerate all 6 reports with full parameter documentation
- Updated `public/js/reports/catalog.js` with `VIEWER_URLS` and `JSON_URLS` lookup tables covering all 6 reports

---

## Bug Fixes / UX

- **Nav consistency**: Added "Analytics" nav button to all 3 pre-existing report viewer pages (`reports-catalog.html`, `reports-alerts-trend.html`, `reports-company-device-health-graph.html`)
- Each new report viewer has consistent nav: **Reports → Analytics → Dashboard → JSON → Refresh**

---

## Files Changed

### New Files
| File | Description |
|---|---|
| `protected/analytics.html` | Analytics module page (rewrite) |
| `public/js/analytics/analytics.js` | Analytics JS (rewrite, 742 lines) |
| `protected/reports-sla-uptime.html` | SLA Uptime report viewer |
| `protected/reports-flapping-devices.html` | Flapping Devices report viewer |
| `protected/reports-sensor-type-distribution.html` | Sensor Type Distribution viewer |
| `protected/reports-alert-ack-latency.html` | Alert Ack Latency report viewer |
| `public/js/reports/slaUptime.js` | SLA Uptime chart + table renderer |
| `public/js/reports/flappingDevices.js` | Flapping Devices chart + table renderer |
| `public/js/reports/sensorTypeDistribution.js` | Sensor Type Distribution renderer |
| `public/js/reports/alertAckLatency.js` | Alert Ack Latency chart + table renderer |

### Modified Files
| File | Change |
|---|---|
| `src/routes/api.js` | +5 new API endpoints (analytics/company-health + 4 reports) |
| `src/server.js` | +4 new page route handlers |
| `public/js/reports/catalog.js` | VIEWER_URLS + JSON_URLS lookup tables for all 6 reports |
| `protected/reports-catalog.html` | Added Analytics nav button |
| `protected/reports-alerts-trend.html` | Added Analytics nav button |
| `protected/reports-company-device-health-graph.html` | Added Analytics nav button |
| `package.json` | Version bump 13.2.0 → 13.3.0 |

---

## Upgrade Notes

No database schema changes. No environment variable changes. Restart the process after pulling (`pm2 restart prtg-dashboard`).
