require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

/**
 * Parse PRTG server configuration from environment
 * @returns {Array} Array of PRTG server configurations
 */
function parsePrtgServers() {
  const serverString = process.env.PRTG_SERVERS;
  if (!serverString) {
    throw new Error('PRTG_SERVERS environment variable is required');
  }

  return serverString.split(',').map((server, idx) => {
    const [url, username, passhash] = server.split('|');
    
    if (!url || !username || !passhash) {
      throw new Error(`Invalid PRTG server configuration at index ${idx}`);
    }

    return {
      id: `prtg-${idx + 1}`,
      url: url.trim(),
      username: username.trim(),
      passhash: passhash.trim(),
      enabled: true
    };
  });
}

/**
 * Application configuration object
 */
const config = {
  // Server settings
  port: parseInt(process.env.PORT || '3000', 10),
  env: process.env.NODE_ENV || 'development',
  
  // PRTG servers
  prtgServers: parsePrtgServers(),
  
  // Database configuration
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    name: process.env.DB_NAME || 'prtg_dashboard',
    user: process.env.DB_USER || 'prtg_user',
    password: process.env.DB_PASSWORD || '',
    pool: {
      max: parseInt(process.env.DB_POOL_MAX || '10', 10),
      min: parseInt(process.env.DB_POOL_MIN || '2', 10),
      acquire: parseInt(process.env.DB_POOL_ACQUIRE || '30000', 10),
      idle: parseInt(process.env.DB_POOL_IDLE || '10000', 10)
    }
  },
  
  // Data collection
  collection: {
    interval: parseInt(process.env.COLLECTOR_INTERVAL || '60000', 10),
    retentionDays: parseInt(process.env.RETENTION_DAYS || '90', 10)
  },
  
  // Cache configuration
  cache: {
    ttl: parseInt(process.env.CACHE_TTL || '30', 10),
    checkPeriod: parseInt(process.env.CACHE_CHECK_PERIOD || '60', 10)
  },
  
  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || './logs/prtg-dashboard.log'
  },
  
  // CORS
  cors: {
    origins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
      .split(',')
      .map(o => o.trim())
  },
  
  // Polling
  polling: {
    interval: parseInt(process.env.POLL_INTERVAL || '5000', 10),
    wsHeartbeat: parseInt(process.env.WEBSOCKET_HEARTBEAT || '30000', 10)
  }
};

/**
 * Validate configuration
 */
function validateConfig() {
  const errors = [];
  
  if (config.prtgServers.length === 0) {
    errors.push('At least one PRTG server must be configured');
  }
  
  if (config.port < 1 || config.port > 65535) {
    errors.push('Invalid port number');
  }
  
  if (!config.database.password) {
    errors.push('Database password is required');
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

// Validate on load
validateConfig();

module.exports = config;
