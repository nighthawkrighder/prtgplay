const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const config = require('./config');
const logger = require('./utils/logger');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const { sequelize, testConnection } = require('./config/database');
const { PRTGServer, Device, Sensor } = require('./models');
const apiRoutes = require('./routes/api');
const PRTGClient = require('./services/prtgClient');
const PRTGCollector = require('./collectors/prtgCollector');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// WebSocket Server
const wss = new WebSocket.Server({ server });

// Store active WebSocket connections
const clients = new Set();

// Persistent session store using Sequelize (MySQL)
const sessionStore = new SequelizeStore({ db: sequelize });

// Session configuration
const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'prtg-dashboard-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    secure: false, // Set to true if using HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
};

app.use(session(sessionConfig));

// Middleware
app.use(cors({
  origin: config.cors.origins,
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Add session fingerprint middleware to persist session identity across hard refreshes
app.use((req, res, next) => {
  const fingerprint = crypto.createHash('sha256')
    .update(req.ip + (req.headers['user-agent'] || ''))
    .digest('hex');
  if (!req.session.fingerprint) {
    req.session.fingerprint = fingerprint;
    logger.info('Session fingerprint set for new session');
  } else if (req.session.fingerprint !== fingerprint) {
    logger.warn('Fingerprint mismatch: destroying session');
    req.session.destroy(err => {
      if (err) logger.error('Failed to destroy session on fingerprint mismatch:', err);
      return res.status(403).send('Session verification failed.');
    });
    return;
  }
  next();
});

// Authentication middleware
function requireAuth(req, res, next) {
  logger.debug(`Auth check for ${req.path}:`, { 
    session: req.session?.authenticated || false,
    sessionId: req.sessionID 
  });
  
  if (req.session && req.session.authenticated) {
    next();
  } else {
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ error: 'Authentication required' });
    } else {
      res.redirect('/login');
    }
  }
}

// Authentication routes
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  try {
    // Test authentication against any configured PRTG server
    let authSuccess = false;
    
    for (const serverConfig of config.prtgServers) {
      try {
        // Create a test client with provided credentials
        const testClient = new PRTGClient({
          id: 'auth-test',
          url: serverConfig.url,
          username: username,
          passhash: password, // In PRTG, this should be the passhash, not plain password
          enabled: true
        });
        
        // Test authentication by making a simple API call
        await testClient.request('/api/table.json', { content: 'servers', count: 1 });
        authSuccess = true;
        break;
      } catch (error) {
        // Continue to next server if auth fails
        logger.debug(`Auth failed for server ${serverConfig.id}: ${error.message}`);
      }
    }
    
    if (authSuccess) {
      req.session.authenticated = true;
      req.session.username = username;
      logger.info(`User authenticated: ${username}`, { sessionId: req.sessionID });
      res.json({ success: true, message: 'Authentication successful' });
    } else {
      logger.warn(`Authentication failed for user: ${username}`);
      res.status(401).json({ error: 'Invalid PRTG credentials' });
    }
    
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(500).json({ error: 'Authentication service error' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      logger.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// Login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

// Root route - serve SOC dashboard (protected) - MUST be before static middleware
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/soc-dashboard.html'));
});

// Legacy dashboard route
app.get('/legacy', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// API Routes (protected)
app.use('/api', requireAuth, apiRoutes);

// Static files (serve login.html and other assets publicly) - MUST be after specific routes
app.use(express.static(path.join(__dirname, '../public')));

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  // Check authentication for WebSocket connections
  // Note: For production, implement proper WebSocket authentication
  // This is a simple check - in production, use JWT tokens or similar
  
  clients.add(ws);
  logger.info('New WebSocket client connected');
  
  // Send initial sensor data
  sendSensorUpdate(ws);
  
  // Handle client messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      logger.debug('WebSocket message received:', data);
      
      // Handle ping/pong for heartbeat
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (error) {
      logger.error('Error parsing WebSocket message:', error);
    }
  });
  
  // Handle connection close
  ws.on('close', () => {
    clients.delete(ws);
    logger.info('WebSocket client disconnected');
  });
  
  // Handle connection errors
  ws.on('error', (error) => {
    logger.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

// Function to send sensor updates to all clients
async function sendSensorUpdate(targetClient = null) {
  try {
    // Get aggregated sensor data with status counts
    const sensors = await Sensor.findAll({
      include: [{
        model: Device,
        as: 'device',
        attributes: ['name', 'host']
      }, {
        model: PRTGServer,
        as: 'server',
        attributes: ['id', 'url']
      }],
      attributes: ['id', 'name', 'status', 'statusText', 'sensorType', 'lastSeen'],
      order: [['status', 'DESC'], ['name', 'ASC']]
    });

    // Group sensors by status for summary
    const statusSummary = {
      up: sensors.filter(s => s.status === 3).length,
      down: sensors.filter(s => s.status === 5).length,
      warning: sensors.filter(s => s.status === 4).length,
      paused: sensors.filter(s => s.status === 7).length,
      unusual: sensors.filter(s => s.status === 10).length,
      unknown: sensors.filter(s => s.status === 1).length,
      total: sensors.length
    };

    const updateData = {
      type: 'sensor-update',
      timestamp: new Date().toISOString(),
      summary: statusSummary,
      sensors: sensors.map(sensor => ({
        id: sensor.id,
        name: sensor.name,
        status: sensor.status,
        statusText: sensor.statusText,
        sensorType: sensor.sensorType,
        deviceName: sensor.device?.name,
        deviceHost: sensor.device?.host,
        prtgServer: sensor.server?.id,
        lastSeen: sensor.lastSeen
      }))
    };

    const message = JSON.stringify(updateData);

    if (targetClient) {
      // Send to specific client
      if (targetClient.readyState === WebSocket.OPEN) {
        targetClient.send(message);
      }
    } else {
      // Broadcast to all clients
      clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    }
  } catch (error) {
    logger.error('Error sending sensor update:', error);
  }
}

// Function to broadcast server status updates
async function sendServerUpdate() {
  try {
    const servers = await PRTGServer.findAll({
      attributes: ['id', 'url', 'enabled', 'lastSuccessfulPoll', 'lastError']
    });

    const updateData = {
      type: 'server-update',
      timestamp: new Date().toISOString(),
      servers: servers.map(server => ({
        id: server.id,
        url: server.url,
        enabled: server.enabled,
        lastSuccessfulPoll: server.lastSuccessfulPoll,
        status: server.lastError ? 'error' : 'ok'
      }))
    };

    const message = JSON.stringify(updateData);
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  } catch (error) {
    logger.error('Error sending server update:', error);
  }
}

// Periodic updates - send sensor data every 5 seconds
setInterval(() => {
  if (clients.size > 0) {
    sendSensorUpdate();
  }
}, config.polling.interval);

// Periodic heartbeat to keep connections alive
setInterval(() => {
  const heartbeat = JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() });
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(heartbeat);
    }
  });
}, config.polling.wsHeartbeat);

// Graceful shutdown

let shuttingDown = false;
process.on('SIGTERM', (signal) => gracefulShutdown(signal));
process.on('SIGINT', (signal) => gracefulShutdown(signal));


async function gracefulShutdown(signal = 'UNKNOWN') {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Received shutdown signal, closing server gracefully...', { signal });

  // Block new requests
  app.use((req, res, next) => {
    res.status(503).send('Server is shutting down');
  });

  // Stop PRTG collector
  if (global.prtgCollector) {
    try {
      await global.prtgCollector.stop();
    } catch (error) {
      logger.error('Error stopping PRTG collector during shutdown:', error);
    }
  }

  // Close WebSocket server
  await new Promise((resolve) => {
    try {
      wss.close(() => {
        logger.info('WebSocket server closed');
        resolve();
      });
    } catch (error) {
      logger.error('Error closing WebSocket server:', error);
      resolve();
    }
  });

  // Close HTTP server
  await new Promise((resolve) => {
    server.close(() => {
      logger.info('HTTP server closed');
      resolve();
    });
  });

  // Close database connection LAST
  try {
    await sequelize.close();
    logger.info('Database connection closed');
  } catch (error) {
    logger.error('Error closing database connection:', error);
  }

  process.exit(0);
}

// Global error handlers to ensure clean exit on crash
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// Start server
async function startServer() {
  try {
    logger.info('Starting PRTG Unified Dashboard...');
    
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      logger.error('Failed to connect to database. Exiting...');
      process.exit(1);
    }

    if (shuttingDown) {
      logger.warn('Shutdown initiated during startup; aborting server start.');
      return;
    }
    
  // Sync session store tables before app models
    if (!shuttingDown) {
      await sessionStore.sync();
      logger.info('Session store synchronized');
    }

  // Sync database models
    if (!shuttingDown) {
      await sequelize.sync();
      logger.info('Database models synchronized');
    }
    
    // Initialize PRTG servers in database if they don't exist
    for (const serverConfig of config.prtgServers) {
      if (shuttingDown) {
        logger.warn('Shutdown initiated during server initialization; aborting.');
        return;
      }
      const [server] = await PRTGServer.findOrCreate({
        where: { id: serverConfig.id },
        defaults: {
          url: serverConfig.url,
          username: serverConfig.username,
          enabled: serverConfig.enabled
        }
      });
      logger.info(`PRTG Server initialized: ${server.id} - ${server.url}`);
    }
    
    // Initialize and start PRTG data collector
    const collector = new PRTGCollector();
    if (!shuttingDown) {
      await collector.start();
    }
    
    // Store collector instance for graceful shutdown
    global.prtgCollector = collector;
    
    // Start HTTP server
    if (shuttingDown) {
      logger.warn('Shutdown initiated before HTTP server start; aborting listen.');
      return;
    }

    server.listen(config.port, () => {
      logger.info(`PRTG Dashboard server running on port ${config.port}`);
      logger.info(`WebSocket server ready for real-time updates`);
      logger.info(`Dashboard available at: http://localhost:${config.port}`);
    });
    
  } catch (error) {
    if (shuttingDown) {
      logger.warn('Server start aborted due to shutdown signal.');
      return;
    }
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * Health check endpoint for process monitoring and lifecycle management
 * Returns JSON if Accept: application/json, else serves health.html page
 */
app.get('/health', (req, res) => {
  if (req.accepts('html')) {
    res.sendFile(path.join(__dirname, '../public/health.html'));
  } else {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
  }
});

/**
 * PROCESS MANAGEMENT BEST PRACTICES
 * - Use restart-dashboard.sh for safe restarts (stops PM2, cleans port, verifies health)
 * - Use fix-503.sh for emergency port cleanup if dashboard is stuck
 * - PM2 auto-restarts on crash, but global error handlers ensure port is released
 * - Monitor /health endpoint for automated restarts and CI/CD integration
 * - Sessions are persisted in MySQL via SequelizeStore
 */

// Export for testing
module.exports = { app, server, wss, sendSensorUpdate, sendServerUpdate };

// Start the server if this file is run directly
if (require.main === module) {
  startServer();
}
