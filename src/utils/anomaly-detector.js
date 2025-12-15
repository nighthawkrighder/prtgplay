const db = require('../config/mysql-pool');
const logger = require('./logger');

class AnomalyDetector {
  constructor() {
    this.Z_SCORE_THRESHOLD = 3;
    this.MIN_DATA_POINTS = 5;
  }

  /**
   * Run full anomaly detection cycle
   */
  async runDetection() {
    logger.info('Starting anomaly detection cycle...');
    try {
      await this.detectSensorAnomalies();
      await this.detectDeviceAnomalies();
      logger.info('Anomaly detection cycle completed.');
    } catch (err) {
      logger.error('Error during anomaly detection cycle:', err);
    }
  }

  /**
   * Detect anomalies in sensor data
   */
  async detectSensorAnomalies() {
    // Get active sensors with recent data
    const query = `
      SELECT DISTINCT sensor_id, sensor_name, device_id, device_name, company_name 
      FROM sensor_snapshots 
      WHERE snapshot_time > DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `;

    return new Promise((resolve, reject) => {
      db.query(query, async (err, sensors) => {
        if (err) return reject(err);

        logger.info(`Analyzing ${sensors.length} sensors for anomalies...`);
        
        for (const sensor of sensors) {
          await this.analyzeSensor(sensor);
        }
        resolve();
      });
    });
  }

  /**
   * Analyze a single sensor for anomalies
   */
  async analyzeSensor(sensor) {
    const historyQuery = `
      SELECT value_float, snapshot_time 
      FROM sensor_snapshots 
      WHERE sensor_id = ? 
      AND snapshot_time > DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY snapshot_time ASC
    `;

    return new Promise((resolve) => {
      db.query(historyQuery, [sensor.sensor_id], async (err, rows) => {
        if (err || !rows || rows.length < this.MIN_DATA_POINTS) return resolve();

        const values = rows.map(r => r.value_float).filter(v => v !== null);
        if (values.length < this.MIN_DATA_POINTS) return resolve();

        // 1. Check for Flatline (Zero Variance)
        if (this.isFlatline(values)) {
          await this.reportSensorAnomaly(sensor, 'value_flatlined', 'warning', 
            'Sensor value has not changed in 24 hours', values[values.length-1]);
        }

        // 2. Check for Spikes (Z-Score)
        const { mean, stdDev } = this.calculateStats(values);
        const lastValue = values[values.length - 1];
        
        if (stdDev > 0) {
          const zScore = (lastValue - mean) / stdDev;
          if (Math.abs(zScore) > this.Z_SCORE_THRESHOLD) {
            const type = zScore > 0 ? 'value_spike' : 'value_drop';
            const msg = `Unusual value detected (Z-Score: ${zScore.toFixed(2)})`;
            await this.reportSensorAnomaly(sensor, type, 'warning', msg, lastValue, { zScore, mean, stdDev });
          }
        }

        // 3. Predictive Alarm (Linear Regression)
        // Use predictive_analytics table for forecasting
        const trend = this.calculateTrend(values);
        if (Math.abs(trend.slope) > 0.05) { // Lower threshold for sensitivity
            const prediction = this.analyzePrediction(sensor, values, trend);
            
            if (prediction) {
                await this.reportPrediction(sensor, prediction);
            }
        }

        resolve();
      });
    });
  }

  /**
   * Analyze sensor type and trend to generate prediction
   */
  analyzePrediction(sensor, values, trend) {
      const lastValue = values[values.length - 1];
      const name = sensor.sensor_name.toLowerCase();
      let target = null;
      let type = null;
      let isRisingBad = true; // Default assumption

      // Determine sensor type and thresholds
      if (name.includes('disk') || name.includes('storage') || name.includes('drive')) {
          if (name.includes('free')) {
              isRisingBad = false;
              target = 0; // 0% free space is bad
              type = 'disk_full';
          } else {
              target = 100; // 100% usage is bad
              type = 'disk_full';
          }
      } else if (name.includes('temp')) {
          target = 80; // 80C is warning
          type = 'overheating';
      } else if (name.includes('cpu') || name.includes('processor')) {
          target = 95; // 95% usage
          type = 'cpu_saturation';
      } else if (name.includes('fan')) {
          isRisingBad = false;
          target = 0; // 0 RPM is bad
          type = 'fan_failure';
      }

      if (target === null) return null;

      // Calculate days to target
      let daysToTarget = null;
      if (isRisingBad && trend.slope > 0) {
          // Rising towards target (e.g. Temp rising to 80)
          if (lastValue < target) {
              daysToTarget = (target - lastValue) / (trend.slope * 24); // slope is per hour (approx if data is hourly)
          }
      } else if (!isRisingBad && trend.slope < 0) {
          // Falling towards target (e.g. Free space falling to 0)
          if (lastValue > target) {
              daysToTarget = (target - lastValue) / (trend.slope * 24); // slope is negative, result negative
              daysToTarget = Math.abs(daysToTarget);
          }
      }

      if (daysToTarget !== null && daysToTarget > 0 && daysToTarget < 30) {
          const predictedDate = new Date();
          predictedDate.setDate(predictedDate.getDate() + daysToTarget);
          
          return {
              type: type,
              days: Math.round(daysToTarget),
              date: predictedDate,
              target: target,
              slope: trend.slope,
              confidence: 0.8 // Placeholder
          };
      }
      return null;
  }

  // --- Helpers ---

  isFlatline(values) {
    if (values.length === 0) return false;
    const first = values[0];
    return values.every(v => v === first);
  }

  calculateStats(values) {
    const n = values.length;
    if (n === 0) return { mean: 0, stdDev: 0 };
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
    return { mean, stdDev: Math.sqrt(variance) };
  }

  calculateTrend(values) {
    const n = values.length;
    if (n === 0) return { slope: 0 };
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumXX += i * i;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    return { slope };
  }

  async reportSensorAnomaly(sensor, type, severity, message, currentValue, details = {}, daysToCritical = null) {
    const query = `
      INSERT INTO sensor_anomalies 
      (sensor_id, sensor_name, device_id, device_name, company_name, anomaly_type, severity, message, current_value, details, days_to_critical, detected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE 
      severity = VALUES(severity), 
      message = VALUES(message), 
      current_value = VALUES(current_value),
      details = VALUES(details),
      days_to_critical = VALUES(days_to_critical),
      detected_at = NOW()
    `;
    
    return new Promise((resolve) => {
        const checkQuery = `SELECT id FROM sensor_anomalies WHERE sensor_id = ? AND anomaly_type = ? AND is_active = 1`;
        db.query(checkQuery, [sensor.sensor_id, type], (err, rows) => {
            if (err) return resolve();
            
            if (rows && rows.length > 0) {
                const updateQuery = `
                    UPDATE sensor_anomalies SET 
                    severity = ?, message = ?, current_value = ?, details = ?, days_to_critical = ?, detected_at = NOW()
                    WHERE id = ?
                `;
                db.query(updateQuery, [severity, message, currentValue, JSON.stringify(details), daysToCritical, rows[0].id], () => resolve());
            } else {
                db.query(query, [
                    sensor.sensor_id, sensor.sensor_name, sensor.device_id, sensor.device_name, sensor.company_name,
                    type, severity, message, currentValue, JSON.stringify(details), daysToCritical
                ], (err) => {
                    if (err) logger.error('Failed to insert sensor anomaly:', err);
                    resolve();
                });
            }
        });
    });
  }

  /**
   * Detect anomalies in device data
   */
  async detectDeviceAnomalies() {
    // Similar logic for devices (health percentage)
    const query = `
      SELECT DISTINCT device_id, device_name, company_name 
      FROM device_snapshots 
      WHERE snapshot_time > DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `;

    return new Promise((resolve, reject) => {
      db.query(query, async (err, devices) => {
        if (err) return reject(err);

        for (const device of devices) {
            await this.analyzeDevice(device);
        }
        resolve();
      });
    });
  }

  async analyzeDevice(device) {
      const historyQuery = `
        SELECT health_percentage, snapshot_time 
        FROM device_snapshots 
        WHERE device_id = ? 
        AND snapshot_time > DATE_SUB(NOW(), INTERVAL 24 HOUR)
        ORDER BY snapshot_time ASC
      `;

      return new Promise((resolve) => {
          db.query(historyQuery, [device.device_id], async (err, rows) => {
              if (err || !rows || rows.length < this.MIN_DATA_POINTS) return resolve();
              
              const values = rows.map(r => r.health_percentage).filter(v => v !== null);
              if (values.length < this.MIN_DATA_POINTS) return resolve();

              // Check for Health Decline
              const trend = this.calculateTrend(values);
              if (trend.slope < -0.5) { // Dropping more than 0.5% per hour (approx)
                  const lastValue = values[values.length - 1];
                  const daysToZero = lastValue / (Math.abs(trend.slope) * 24);
                  
                  if (daysToZero < 14) {
                      const predictedDate = new Date();
                      predictedDate.setDate(predictedDate.getDate() + daysToZero);
                      
                      // Report to predictive_analytics
                      const details = {
                          message: `Health projected to hit 0% in ${Math.round(daysToZero)} days`,
                          current_value: lastValue,
                          trend_slope: trend.slope
                      };
                      
                      await this.reportPrediction({
                          sensor_id: device.device_id, // Hack: reuse ID field
                          sensor_name: device.device_name,
                          company_name: device.company_name,
                          entity_type: 'device'
                      }, {
                          type: 'health_decline',
                          days: Math.round(daysToZero),
                          date: predictedDate,
                          target: 0,
                          slope: trend.slope,
                          confidence: 0.9
                      });
                  }
              }
              resolve();
          });
      });
  }

  /**
   * Report a predictive alarm to the database (Generic)
   */
  async reportPrediction(entity, prediction) {
      const entityType = entity.entity_type || 'sensor';
      const entityId = entity.sensor_id || entity.device_id; // Handle both
      
      const query = `
          INSERT INTO predictive_analytics 
          (entity_type, entity_id, entity_name, company_name, prediction_type, confidence_score, predicted_time, details, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
          ON DUPLICATE KEY UPDATE
          confidence_score = VALUES(confidence_score),
          predicted_time = VALUES(predicted_time),
          details = VALUES(details),
          created_at = NOW()
      `;

      const details = {
          message: `Predicted to hit ${prediction.target} in ${prediction.days} days`,
          trend_slope: prediction.slope
      };

      return new Promise((resolve) => {
          const checkQuery = `
              SELECT id FROM predictive_analytics 
              WHERE entity_type = ? 
              AND entity_id = ? 
              AND prediction_type = ? 
              AND is_active = 1
          `;

          db.query(checkQuery, [entityType, entityId, prediction.type], (err, rows) => {
              if (err) return resolve();

              if (rows && rows.length > 0) {
                  // Update
                  const updateQuery = `
                      UPDATE predictive_analytics SET
                      confidence_score = ?, predicted_time = ?, details = ?, created_at = NOW()
                      WHERE id = ?
                  `;
                  db.query(updateQuery, [
                      prediction.confidence, 
                      prediction.date, 
                      JSON.stringify(details), 
                      rows[0].id
                  ], () => resolve());
              } else {
                  // Insert
                  db.query(query, [
                      entityType,
                      entityId,
                      entity.sensor_name || entity.device_name, // Handle both
                      entity.company_name,
                      prediction.type,
                      prediction.confidence,
                      prediction.date,
                      JSON.stringify(details)
                  ], (err) => {
                      if (err) logger.error('Failed to insert prediction:', err);
                      resolve();
                  });
              }
          });
      });
  }
}

module.exports = new AnomalyDetector();
