
require('dotenv').config();
const mysql = require('mysql');

const connection = mysql.createConnection({
  host: process.env.CVA_SESSION_DB_HOST || 'localhost',
  user: process.env.CVA_SESSION_DB_USER || 'sqladmin',
  password: process.env.CVA_SESSION_DB_PASSWORD || 'lucRea7on$',
  database: process.env.CVA_SESSION_DB_NAME || 'cve_database'
});

console.log('Testing connection to:', connection.config.database);
console.log('User:', connection.config.user);
console.log('Password length:', connection.config.password.length);

connection.connect((err) => {
  if (err) {
    console.error('Connection failed:', err.message);
    process.exit(1);
  }
  console.log('Connection successful!');
  
  // Try to query sessions table
  connection.query('SELECT count(*) as count FROM sessions', (err, results) => {
    if (err) {
        // Try default 'sessions' table might be named differently?
        console.error('Query failed (maybe table name mismatch?):', err.message);
    } else {
        console.log('Session count:', results[0].count);
    }
    connection.end();
  });
});
