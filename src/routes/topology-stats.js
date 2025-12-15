const express = require('express');
const router = express.Router();
const db = require('../config/mysql-pool');
const logger = require('../utils/logger');
const AnomalyDetector = require('../utils/anomaly-detector');

/**
 * GET /api/topology-stats/device/:deviceId/stats
 * Returns current statistics for a specific device with 24h comparison
 */
router.get('/device/:deviceId/stats', (req, res) => {
  const { deviceId } = req.params;
  
  logger.debug(`Fetching topology stats for device: ${deviceId}`);
  
  // Get current device data
  const currentQuery = `
    SELECT 
      d.id AS device_id,
      d.name AS device_name,
      dm.company_name,
      d.status_text AS status,
      COUNT(s.id) AS total_sensors,
      SUM(CASE WHEN s.status_text = 'Up' THEN 1 ELSE 0 END) AS sensors_up,
      SUM(CASE WHEN s.status_text = 'Down' THEN 1 ELSE 0 END) AS sensors_down,
      SUM(CASE WHEN s.status_text = 'Warning' THEN 1 ELSE 0 END) AS sensors_warning,
      SUM(CASE WHEN s.status_text = 'Paused' THEN 1 ELSE 0 END) AS sensors_paused
    FROM devices d
    LEFT JOIN device_metadata dm ON d.id = dm.device_id
    LEFT JOIN sensors s ON d.id = s.device_id
    WHERE d.id = ?
    GROUP BY d.id, d.name, dm.company_name, d.status_text
  `;
  
  db.query(currentQuery, [deviceId], (err, currentResults) => {
    if (err) {
      logger.error(`Error fetching current device stats for ${deviceId}:`, err);
      return res.status(500).json({ error: 'Database error fetching current stats' });
    }
    
    if (!currentResults || currentResults.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    const current = currentResults[0];
    const healthPercentage = current.total_sensors > 0 
      ? Math.round((current.sensors_up / current.total_sensors) * 100)
      : 100;
    
    // Get 24h historical snapshot
    const historicalQuery = `
      SELECT 
        health_percentage,
        sensors_down
      FROM device_snapshots
      WHERE device_id = ?
        AND snapshot_time >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY snapshot_time ASC
      LIMIT 1
    `;
    
    db.query(historicalQuery, [deviceId], (err2, historicalResults) => {
      if (err2) {
        logger.error(`Error fetching historical device stats for ${deviceId}:`, err2);
        // Continue without historical data
      }
      
      const historical = historicalResults && historicalResults.length > 0 ? historicalResults[0] : null;
      const healthDelta = historical ? healthPercentage - historical.health_percentage : null;
      const downDelta = historical ? current.sensors_down - historical.sensors_down : null;
      
      // Get urgent sensors (down or warning)
      const urgentQuery = `
        SELECT 
          id AS sensor_id,
          name AS sensor_name,
          status_text AS status,
          last_message AS status_raw
        FROM sensors
        WHERE device_id = ?
          AND status_text IN ('Down', 'Warning')
        ORDER BY 
          CASE status_text
            WHEN 'Down' THEN 1
            WHEN 'Warning' THEN 2
            ELSE 3
          END,
          name
        LIMIT 5
      `;
      
      db.query(urgentQuery, [deviceId], (err3, urgentResults) => {
        if (err3) {
          logger.error(`Error fetching urgent sensors for ${deviceId}:`, err3);
          // Continue without urgent sensor data
        }
        
        // Get temperature trends (sensors rising >2°C/hr)
        const tempQuery = `
          SELECT 
            sensor_name,
            current_temperature,
            temperature_delta_1h,
            temperature_delta_24h,
            trend_direction
          FROM temperature_trends
          WHERE device_id = ?
            AND ABS(temperature_delta_1h) > 2
            AND reading_time >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
          ORDER BY ABS(temperature_delta_1h) DESC
          LIMIT 3
        `;
        
        db.query(tempQuery, [deviceId], (err4, tempResults) => {
          if (err4) {
            logger.error(`Error fetching temperature trends for ${deviceId}:`, err4);
            // Continue without temperature data
          }
          
          // Get anomalies for this device
          const anomalyQuery = `
            SELECT 
              anomaly_type,
              severity,
              message,
              current_value,
              threshold_value,
              days_to_critical,
              details
            FROM device_anomalies
            WHERE device_id = ?
              AND is_active = TRUE
            ORDER BY 
              CASE severity
                WHEN 'critical' THEN 1
                WHEN 'warning' THEN 2
                WHEN 'info' THEN 3
              END,
              detected_at DESC
            LIMIT 10
          `;
          
          db.query(anomalyQuery, [deviceId], (err5, anomalyResults) => {
            if (err5) {
              logger.error(`Error fetching anomalies for ${deviceId}:`, err5);
              // Continue without anomaly data
            }
            
            // Get sensor-level anomalies
            const sensorAnomalyQuery = `
              SELECT 
                sensor_id,
                sensor_name,
                anomaly_type,
                severity,
                message,
                current_value,
                threshold_value,
                days_to_critical,
                details
              FROM sensor_anomalies
              WHERE device_id = ?
                AND is_active = TRUE
              ORDER BY 
                CASE severity
                  WHEN 'critical' THEN 1
                  WHEN 'warning' THEN 2
                  WHEN 'info' THEN 3
                END,
                detected_at DESC
              LIMIT 10
            `;
            
            db.query(sensorAnomalyQuery, [deviceId], (err6, sensorAnomalyResults) => {
              if (err6) {
                logger.error(`Error fetching sensor anomalies for ${deviceId}:`, err6);
                // Continue without sensor anomaly data
              }
              
              // Build response
              const response = {
                device: {
                  deviceId: current.device_id,
                  name: current.device_name,
                  companyName: current.company_name,
                  status: current.status
                },
                current: {
                  healthPercentage,
                  totalSensors: current.total_sensors,
                  sensorsUp: current.sensors_up,
                  sensorsDown: current.sensors_down,
                  sensorsWarning: current.sensors_warning,
                  sensorsPaused: current.sensors_paused
                },
                trend24h: {
                  healthDelta,
                  downDelta,
                  hasHistoricalData: !!historical
                },
                urgentSensors: urgentResults || [],
                temperatureTrends: tempResults || [],
                anomalies: anomalyResults || [],
                sensorAnomalies: sensorAnomalyResults || []
              };
              
              if (!res.headersSent) {
                res.json(response);
              }
            });
          });
        });
      });
    });
  });
});

/**
 * GET /api/topology-stats/company/:companyName/stats
 * Returns aggregated statistics for an organization with trends
 */
router.get('/company/:companyName/stats', (req, res) => {
  const { companyName } = req.params;
  
  logger.debug(`Fetching topology stats for company: ${companyName}`);
  
  // Get current company-wide stats
  const currentQuery = `
    SELECT 
      COUNT(DISTINCT d.id) AS total_devices,
      COUNT(DISTINCT CASE WHEN d.status_text = 'Up' THEN d.id END) AS devices_up,
      COUNT(DISTINCT CASE WHEN d.status_text = 'Down' THEN d.id END) AS devices_down,
      COUNT(s.id) AS total_sensors,
      SUM(CASE WHEN s.status_text = 'Up' THEN 1 ELSE 0 END) AS sensors_up,
      SUM(CASE WHEN s.status_text = 'Down' THEN 1 ELSE 0 END) AS sensors_down,
      SUM(CASE WHEN s.status_text = 'Warning' THEN 1 ELSE 0 END) AS sensors_warning
    FROM devices d
    LEFT JOIN device_metadata dm ON d.id = dm.device_id
    LEFT JOIN sensors s ON d.id = s.device_id
    WHERE dm.company_name = ?
  `;
  
  db.query(currentQuery, [companyName], (err, currentResults) => {
    if (err) {
      logger.error(`Error fetching current company stats for ${companyName}:`, err);
      return res.status(500).json({ error: 'Database error fetching current stats' });
    }
    
    if (!currentResults || currentResults.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    const current = currentResults[0];
    const healthPercentage = current.total_sensors > 0 
      ? Math.round((current.sensors_up / current.total_sensors) * 100)
      : 100;
    
    // Get 24h historical snapshot
    const historicalQuery = `
      SELECT 
        health_percentage,
        critical_devices
      FROM company_snapshots
      WHERE company_name = ?
        AND snapshot_time >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY snapshot_time ASC
      LIMIT 1
    `;
    
    db.query(historicalQuery, [companyName], (err2, historicalResults) => {
      if (err2) {
        logger.error(`Error fetching historical company stats for ${companyName}:`, err2);
        // Continue without historical data
      }
      
      const historical = historicalResults && historicalResults.length > 0 ? historicalResults[0] : null;
      const healthDelta = historical ? healthPercentage - historical.health_percentage : null;
      
      // Get critical devices (down or >50% sensors down)
      const criticalQuery = `
        SELECT 
          d.id AS device_id,
          d.name AS device_name,
          d.status_text AS status,
          COUNT(s.id) AS total_sensors,
          SUM(CASE WHEN s.status_text = 'Down' THEN 1 ELSE 0 END) AS sensors_down
        FROM devices d
        LEFT JOIN device_metadata dm ON d.id = dm.device_id
        LEFT JOIN sensors s ON d.id = s.device_id
        WHERE dm.company_name = ?
          AND (d.status_text = 'Down' OR (
            SELECT COUNT(*) 
            FROM sensors s2 
            WHERE s2.device_id = d.id AND s2.status_text = 'Down'
          ) > (
            SELECT COUNT(*) * 0.5
            FROM sensors s3
            WHERE s3.device_id = d.id
          ))
        GROUP BY d.id, d.name, d.status_text
        ORDER BY sensors_down DESC
        LIMIT 5
      `;
      
      db.query(criticalQuery, [companyName], (err3, criticalResults) => {
        if (err3) {
          logger.error(`Error fetching critical devices for ${companyName}:`, err3);
          // Continue without critical device data
        }
        
        // Get recent alerts (24h)
        const alertQuery = `
          SELECT 
            alert_type,
            severity,
            message,
            COUNT(*) AS alert_count
          FROM topology_alerts
          WHERE company_name = ?
            AND alert_time >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
          GROUP BY alert_type, severity, message
          ORDER BY 
            CASE severity
              WHEN 'Critical' THEN 1
              WHEN 'High' THEN 2
              WHEN 'Medium' THEN 3
              WHEN 'Low' THEN 4
              ELSE 5
            END,
            alert_count DESC
          LIMIT 5
        `;
        
        db.query(alertQuery, [companyName], (err4, alertResults) => {
          if (err4) {
            logger.error(`Error fetching alerts for ${companyName}:`, err4);
            // Continue without alert data
          }
          
          // Get company-level anomalies
          const anomalyQuery = `
            SELECT 
              anomaly_type,
              severity,
              message,
              affected_count,
              details
            FROM company_anomalies
            WHERE company_name = ?
              AND is_active = TRUE
            ORDER BY 
              CASE severity
                WHEN 'critical' THEN 1
                WHEN 'warning' THEN 2
                WHEN 'info' THEN 3
              END,
              detected_at DESC
            LIMIT 10
          `;
          
          db.query(anomalyQuery, [companyName], (err5, anomalyResults) => {
            if (err5) {
              logger.error(`Error fetching anomalies for ${companyName}:`, err5);
              // Continue without anomaly data
            }
            
            // Build response
            const response = {
              company: {
                name: companyName
              },
              current: {
                healthPercentage,
                totalDevices: current.total_devices,
                devicesUp: current.devices_up,
                devicesDown: current.devices_down,
                totalSensors: current.total_sensors,
                sensorsUp: current.sensors_up,
                sensorsDown: current.sensors_down,
                sensorsWarning: current.sensors_warning
              },
              trend24h: {
                healthDelta,
                hasHistoricalData: !!historical
              },
              criticalDevices: criticalResults || [],
              recentAlerts: alertResults || [],
              anomalies: anomalyResults || []
            };
            
            if (!res.headersSent) {
              res.json(response);
            }
          });
        });
      });
    });
  });
});

module.exports = router;
