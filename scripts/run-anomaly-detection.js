const AnomalyDetector = require('../src/utils/anomaly-detector');
const logger = require('../src/utils/logger');
const db = require('../src/config/mysql-pool');

async function main() {
  logger.info('=== Starting Anomaly Detection Job ===');
  try {
    await AnomalyDetector.runDetection();
    logger.info('=== Anomaly Detection Job Completed Successfully ===');
  } catch (error) {
    logger.error('=== Anomaly Detection Job Failed ===', error);
  } finally {
    // Close DB connection to allow script to exit
    // Note: mysql-pool uses a pool, so we might need to explicitly end it if the script hangs
    // But usually process.exit(0) is fine for a script
    setTimeout(() => process.exit(0), 1000);
  }
}

main();
