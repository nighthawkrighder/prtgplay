# Release Summary — v13.3.0

**2026-03-01** | Analytics rewrite + 4 new reports

## What's New
- **Analytics module** fully rebuilt: 6 KPIs, 3 tabs (Health / Alerts / Companies), 4 canvas chart types, `Promise.allSettled` loading, 5-min auto-refresh
- **SLA / Uptime by Company** report — configurable threshold, per-company breach tracking
- **Flapping / Unstable Devices** report — σ-ranked instability with volatility labels
- **Sensor Type Distribution** report — every sensor type × status breakdown
- **Alert Acknowledgment Latency** report — ack rate, avg/max latency, stale alerts, hourly trend

## Also
- Reports Catalog API now lists all 6 reports
- Nav "Analytics" button added to all existing report pages
- 5 new API endpoints in `src/routes/api.js`
- 4 new page routes in `src/server.js`

## Upgrade
No DB/env changes. `pm2 restart prtg-dashboard` after pull.
