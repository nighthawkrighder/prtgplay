# PRTG Unified Dashboard - AI Agent Instructions

## Architecture Overview
This is a Node.js/Express application that creates a "single pane of glass" dashboard for multiple PRTG Network Monitor servers. The system collects monitoring data from multiple PRTG instances and stores it in a MySQL database for unified visualization.

**Core Data Flow**: PRTG APIs → PRTGClient → Collectors → Sequelize Models → MySQL → REST API → Dashboard

## Key Components

### Configuration System (`src/config/`)
- **Environment-driven multi-server setup**: PRTG servers are configured via `PRTG_SERVERS` env var using pipe-delimited format: `url|username|passhash,url2|username2|passhash2`
- **Validation on startup**: Configuration validates PRTG server configs, database credentials, and port ranges before starting
- **Example**: Use `.env.example` as template - contains all required environment variables with proper format

### Database Layer (`src/models/`, `src/config/database.js`)
- **Sequelize ORM** with MySQL, using snake_case table/column names but camelCase in JS models
- **Multi-server design**: All entities (devices, sensors) include `prtg_server_id` to track source PRTG instance
- **Status codes**: PRTG uses numeric status codes (3=Up, 4=Warning, 5=Down, 7=Paused, 10=Unusual, 1=Unknown)
- **Key models**: PRTGServer, Device, Sensor, SensorReading, Alert with proper foreign key relationships

### PRTG Integration (`src/services/prtgClient.js`)
- **SSL bypass**: Uses `rejectUnauthorized: false` for self-signed PRTG certificates (common in enterprise)
- **Authentication**: PRTG passhash-based auth (not password) - more secure for API access
- **Error handling**: Comprehensive logging and timeout handling (30s timeout)
- **API format**: Always requests `output=json` format from PRTG API endpoints

### API Design (`src/routes/api.js`)
- **Dashboard-focused endpoints**: `/api/dashboard/summary` provides aggregated counts across all PRTG servers
- **Status aggregation**: Counts devices/sensors by status across multiple PRTG instances
- **Real-time data**: Designed to support WebSocket polling (see polling config in `src/config/`)

## Development Workflows

### Database Initialization
```bash
npm run init-db  # Interactive script - prompts for MySQL credentials
```
- Uses `scripts/init-database.js` with interactive MySQL admin login
- Creates database, tables, and proper schema with character set utf8mb4
- Run this BEFORE starting the application

### Development vs Production
```bash
npm run dev      # Nodemon for development
npm start        # Production server
```

### Environment Setup Pattern
1. Copy `.env.example` to `.env`
2. Configure PRTG servers using the pipe-delimited format
3. Set up MySQL credentials (uses `sqladmin` by default)
4. Run `npm run init-db` to set up database
5. Start with `npm run dev`

## Project-Specific Patterns

### Multi-Server State Management
- Each PRTG server has `enabled` flag and `last_successful_poll` tracking
- Error states stored in `last_error` field for troubleshooting
- Server IDs generated as `prtg-1`, `prtg-2`, etc. based on env var order

### Logging Strategy
- Winston logger with structured JSON format in production, colorized console in development
- Log levels: debug for PRTG API calls, info for app lifecycle, error for failures
- File logging to `./logs/prtg-dashboard.log` (configurable)

### Status Code Handling
When working with device/sensor status, always use PRTG's numeric codes:
- `3` = Up/OK, `4` = Warning, `5` = Down/Error, `7` = Paused, `10` = Unusual, `1` = Unknown
- Status text fields store human-readable versions but queries should use numeric codes

### API Response Patterns
- Dashboard endpoints return nested objects with categorized counts
- All endpoints include error handling with structured error responses
- Use Sequelize `Op` operators for complex queries (especially date ranges for alerts)

## Integration Points
- **External PRTG servers**: Multiple instances via PRTGClient with individual authentication
- **MySQL database**: Sequelize ORM with connection pooling and automatic reconnection
- **WebSocket support**: Built-in but implementation in `src/server.js` (currently empty - needs implementation)
- **CORS**: Configurable allowed origins for cross-domain dashboard access

## Common Operations
- **Adding new PRTG server**: Update `PRTG_SERVERS` env var and restart
- **Database schema changes**: Modify models in `src/models/index.js`, Sequelize handles migration-style updates
- **API endpoints**: Add to `src/routes/api.js`, follow existing pattern with error handling and logging
- **PRTG API calls**: Extend `src/services/prtgClient.js` methods, always include timeout and error handling