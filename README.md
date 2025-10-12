# PRTG Unified Dashboard

Enterprise dashboard that consolidates data from multiple PRTG Network Monitor instances into a single experience. The application collects device and sensor telemetry, persists it in MySQL using Sequelize, and exposes a secure web UI with real-time updates, admin tooling, and health endpoints.

## Highlights

- **Multi-PRTG aggregation** – Ingests from any number of PRTG servers defined via environment variables.
- **Database-backed sessions** – Sessions persist across refreshes with inactivity-based expiry and EDR-style tracking.
- **Admin quick access** – Shield icon in the header exposes shortcuts to the Admin Console, Session Intelligence, and Telemetry Overview when an allow-listed user is signed in.
- **Admin dashboards** – Dedicated pages under `/admin` for live session management and aggregated telemetry, each with raw JSON views for auditing.
- **Resilient health checks** – `/health?format=json` delivers machine-readable status for uptime monitors; HTML view remains available for browsers.
- **WebSocket updates** – Devices and sensors stream updates without constant polling.

## Requirements

- Node.js 18+
- npm 9+
- MySQL server (accessible from the application host)

## Getting Started

1. **Install dependencies**
	```bash
	npm install
	```

2. **Configure environment variables**
	- Copy `.env.example` to `.env`.
	- Populate database credentials and PRTG server list:
	  ```env
	  PRTG_SERVERS=https://prtg1.local|apiuser|passhash1,https://prtg2.local|apiuser|passhash2
	  ADMIN_USERS=LoginApiUser,AnotherAdmin
	  SESSION_SECRET=change-me
	  ```

3. **Initialise the database**
	```bash
	npm run init-db
	```
	The script guides you through creating the schema and tables.

4. **Run the server**
	- Development with automatic reloads:
	  ```bash
	  npm run dev
	  ```
	- Production mode:
	  ```bash
	  npm start
	  ```

5. **Access the dashboard**
	- Default URL: `http://localhost:3010`
	- Login with a PRTG username and passhash.

## Admin Experience

Users listed in `ADMIN_USERS` gain elevated features after authentication:

- **Quick access menu** – A shield icon appears in the header. Clicking it reveals links to:
  - `/admin` – Admin Console landing page.
  - `/admin/sessions.html` – Session Intelligence dashboard with purge/terminate controls.
  - `/admin/telemetry.html` – Telemetry Overview combining visual summaries with raw JSON output.
- **Session info badge** – Role is displayed in the user menu, and admin-only options become available.

## Health & Monitoring

- `GET /health` – HTML heartbeat page for browsers.
- `GET /health?format=json` – JSON payload containing `{ status, uptime }` for uptime monitoring or automation.
- `GET /api/dashboard/summary` – Aggregated metrics used by the telemetry admin page.

## Development Notes

- WebSockets are served from the same host; ensure HTTPS reverse proxies forward the connection (e.g., Apache or Nginx configured for WSS).
- Sessions are stored via `connect-session-sequelize`; MySQL connectivity must remain stable.
- Logs are managed through Winston (console in development, JSON/file in production as configured in `src/utils/logger.js`).

## Testing & Quality

- Run tests with coverage: `npm test`
- Lint the backend: `npm run lint`

## Release Process

1. Update documentation (README, admin guides, etc.).
2. Bump the version in `package.json` and `package-lock.json`.
3. Record changes in `CHANGELOG.md`.
4. Commit and push to `main`.
5. Optionally tag the release: `git tag -a v1.0.0 -m "PRTG Unified Dashboard 1.0.0"` then `git push origin v1.0.0`.

## License

This project is distributed under a proprietary license. See `package.json` for details.