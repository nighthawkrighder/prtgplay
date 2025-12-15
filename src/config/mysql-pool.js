const mysql = require('mysql');
const config = require('./index');
const logger = require('../utils/logger');

// Create MySQL connection pool for callback-style queries
const pool = mysql.createPool({
  connectionLimit: 10,
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name
});

// Test the connection
pool.getConnection((err, connection) => {
  if (err) {
    logger.error('Failed to create MySQL pool for topology stats:', err);
  } else {
    logger.info('MySQL pool for topology stats created successfully');
    connection.release();
  }
});

module.exports = pool;
