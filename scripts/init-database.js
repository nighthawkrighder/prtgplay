const mysql = require('mysql2/promise');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function initDatabase() {
  console.log('=== PRTG Dashboard Database Initialization ===\n');
  
  // Get MySQL root/admin password
  const password = await question('Enter MySQL password for sqladmin: ');
  const dbName = await question('Database name [prtg_dashboard]: ') || 'prtg_dashboard';
  
  let connection;
  
  try {
    // Connect to MySQL server (without database)
    console.log('\n📡 Connecting to MySQL server...');
    connection = await mysql.createConnection({
      host: 'localhost',
      user: 'sqladmin',
      password: password
    });
    
    console.log('✓ Connected to MySQL server\n');
    
    // Create database if it doesn't exist
    console.log(`📦 Creating database '${dbName}' if not exists...`);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`✓ Database '${dbName}' ready\n`);
    
    // Switch to the database
    await connection.query(`USE \`${dbName}\``);
    
    // Create tables
    console.log('🔨 Creating tables...\n');
    
    // PRTG Servers table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS prtg_servers (
        id VARCHAR(50) PRIMARY KEY,
        url VARCHAR(255) NOT NULL,
        username VARCHAR(100) NOT NULL,
        enabled BOOLEAN DEFAULT true,
        last_successful_poll DATETIME NULL,
        last_error TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_enabled (enabled),
        INDEX idx_last_poll (last_successful_poll)
      ) ENGINE=InnoDB
    `);
    console.log('  ✓ prtg_servers');
    
    // Devices table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS devices (
        id INT PRIMARY KEY,
        prtg_server_id VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        host VARCHAR(255),
        device_type VARCHAR(100),
        status INT NOT NULL,
        status_text VARCHAR(50),
        priority INT,
        last_seen DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (prtg_server_id) REFERENCES prtg_servers(id) ON DELETE CASCADE,
        INDEX idx_server_device (prtg_server_id, id),
        INDEX idx_status (status),
        INDEX idx_last_seen (last_seen)
      ) ENGINE=InnoDB
    `);
    console.log('  ✓ devices');
    
    // Sensors table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS sensors (
        id INT PRIMARY KEY,
        prtg_server_id VARCHAR(50) NOT NULL,
        device_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        sensor_type VARCHAR(100),
        status INT NOT NULL,
        status_text VARCHAR(50),
        priority INT,
        last_value VARCHAR(255),
        last_message TEXT,
        last_seen DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (prtg_server_id) REFERENCES prtg_servers(id) ON DELETE CASCADE,
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
        INDEX idx_server_sensor (prtg_server_id, id),
        INDEX idx_device (device_id),
        INDEX idx_status (status),
        INDEX idx_last_seen (last_seen)
      ) ENGINE=InnoDB
    `);
    console.log('  ✓ sensors');
    
    // Sensor Readings table (time series data)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS sensor_readings (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        prtg_server_id VARCHAR(50) NOT NULL,
        sensor_id INT NOT NULL,
        timestamp DATETIME NOT NULL,
        value DECIMAL(20,4),
        value_text VARCHAR(255),
        status INT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (prtg_server_id) REFERENCES prtg_servers(id) ON DELETE CASCADE,
        FOREIGN KEY (sensor_id) REFERENCES sensors(id) ON DELETE CASCADE,
        INDEX idx_sensor_time (sensor_id, timestamp DESC),
        INDEX idx_server_time (prtg_server_id, timestamp DESC),
        INDEX idx_timestamp (timestamp)
      ) ENGINE=InnoDB
    `);
    console.log('  ✓ sensor_readings');
    
    // Alerts table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        prtg_server_id VARCHAR(50) NOT NULL,
        sensor_id INT,
        device_id INT,
        alert_type VARCHAR(50) NOT NULL,
        severity VARCHAR(20) NOT NULL,
        message TEXT NOT NULL,
        timestamp DATETIME NOT NULL,
        acknowledged BOOLEAN DEFAULT false,
        acknowledged_by VARCHAR(100),
        acknowledged_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (prtg_server_id) REFERENCES prtg_servers(id) ON DELETE CASCADE,
        INDEX idx_server_time (prtg_server_id, timestamp DESC),
        INDEX idx_acknowledged (acknowledged),
        INDEX idx_severity (severity)
      ) ENGINE=InnoDB
    `);
    console.log('  ✓ alerts');
    
    // System Log table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS system_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        level VARCHAR(20) NOT NULL,
        component VARCHAR(100) NOT NULL,
        message TEXT NOT NULL,
        metadata JSON,
        timestamp DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_level_time (level, timestamp DESC),
        INDEX idx_component (component),
        INDEX idx_timestamp (timestamp)
      ) ENGINE=InnoDB
    `);
    console.log('  ✓ system_logs\n');
    
    // Create a stored procedure for data cleanup
    await connection.query(`DROP PROCEDURE IF EXISTS cleanup_old_data`);
    await connection.query(`
      CREATE PROCEDURE cleanup_old_data(IN retention_days INT)
      BEGIN
        DECLARE cutoff_date DATETIME;
        SET cutoff_date = DATE_SUB(NOW(), INTERVAL retention_days DAY);
        
        DELETE FROM sensor_readings WHERE timestamp < cutoff_date;
        DELETE FROM alerts WHERE timestamp < cutoff_date AND acknowledged = true;
        DELETE FROM system_logs WHERE timestamp < cutoff_date;
        
        SELECT ROW_COUNT() as rows_deleted;
      END
    `);
    console.log('✓ Created cleanup_old_data stored procedure\n');
    
    console.log('✅ Database initialization complete!\n');
    console.log('Next steps:');
    console.log(`  1. Update .env with: DB_NAME=${dbName}`);
    console.log(`  2. Update .env with: DB_USER=sqladmin`);
    console.log('  3. Update .env with your MySQL password');
    console.log('  4. Run: npm install');
    console.log('  5. Run: npm start\n');
    
  } catch (error) {
    console.error('❌ Error initializing database:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
    rl.close();
  }
}

initDatabase();
