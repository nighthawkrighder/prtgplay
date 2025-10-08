const logger = require('../utils/logger');
const debugLog = (...args) => {
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true') {
    logger.debug(...args);
  }
};

const { PRTGServer, Device, Sensor, DeviceMetadata } = require('../models');
const PRTGClient = require('../services/prtgClient');
const MetadataParser = require('../utils/metadataParser');
const config = require('../config');
const { sequelize } = require('../config/database');

class PRTGCollector {
  constructor() {
    this.isRunning = false;
    this.collectionInterval = null;
    this.metadataParser = new MetadataParser();
    this.currentCollectionPromise = null;
  }

  /**
   * Start the data collection process
   */
  async start() {
    if (this.isRunning) {
      logger.warn('PRTG Collector already running');
      return;
    }

    logger.info('Starting PRTG data collection...');
    this.isRunning = true;

    // Run initial collection immediately
    await this.collectAllData();

    // Schedule periodic collection
    this.collectionInterval = setInterval(async () => {
      try {
        await this.collectAllData();
      } catch (error) {
        logger.error('Error in scheduled data collection:', error);
      }
    }, config.collection.interval);

    logger.info(`PRTG Collector started with ${config.collection.interval}ms interval`);
  }

  /**
   * Stop the data collection process
   */
  async stop() {
    if (!this.isRunning && !this.currentCollectionPromise) {
      return;
    }

    this.isRunning = false;

    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }

    if (this.currentCollectionPromise) {
      try {
        await this.currentCollectionPromise;
      } catch (error) {
        logger.warn('Collector stop encountered error in-flight:', error);
      } finally {
        this.currentCollectionPromise = null;
      }
    }

    logger.info('PRTG Collector stopped');
  }

  /**
   * Collect data from all configured PRTG servers
   */
  async collectAllData() {
    if (!this.isRunning) {
      logger.debug('Collector not running, skipping data collection cycle');
      return;
    }

    if (this.currentCollectionPromise) {
      logger.debug('Data collection already in progress, skipping new cycle');
      return this.currentCollectionPromise;
    }

    this.currentCollectionPromise = (async () => {
      logger.info('Starting data collection cycle...');
      
      for (const serverConfig of config.prtgServers) {
        if (!this.isRunning) {
          logger.info('Collector stop requested, aborting data collection cycle');
          break;
        }

        try {
          await this.collectServerData(serverConfig);
        } catch (error) {
          logger.error(`Error collecting data from server ${serverConfig.id}:`, error);
          
          // Update server error status
          await PRTGServer.update({
            lastError: error.message
          }, {
            where: { id: serverConfig.id }
          });
        }
      }
    })();

    try {
      await this.currentCollectionPromise;
    } finally {
      this.currentCollectionPromise = null;
    }
  }

  /**
   * Collect data from a specific PRTG server
   */
  async collectServerData(serverConfig) {
    if (!this.isRunning) {
      return;
    }

    logger.info(`Collecting data from PRTG server: ${serverConfig.id}`);
    const serverStart = Date.now();
    
    const client = new PRTGClient(serverConfig);
    
    try {
      if (!this.isRunning) {
        return;
      }
      // Collect devices first - use large count to get ALL devices (not just 500)
      const devicesData = await client.request('/api/table.json', {
        content: 'devices',
        output: 'json',
        count: 50000, // Get up to 50,000 devices instead of default 500
        columns: 'objid,device,host,devicetype,status,message,priority,lastvalue'
      });

      if (this.isRunning && devicesData && devicesData.devices) {
        logger.info(`Collected ${devicesData.devices.length} devices from PRTG server ${serverConfig.id}`);
        await this.processDevices(serverConfig.id, devicesData.devices);
      }

      // Collect sensors - use large count to get ALL sensors (not just 500)
      const sensorsData = await client.request('/api/table.json', {
        content: 'sensors',
        output: 'json',
        count: 50000, // Get up to 50,000 sensors instead of default 500
        columns: 'objid,device,deviceid,sensor,type,status,message,priority,lastvalue,lastcheck'
      });

      if (this.isRunning && sensorsData && sensorsData.sensors) {
        logger.info(`Collected ${sensorsData.sensors.length} sensors from PRTG server ${serverConfig.id}`);
        await this.processSensors(serverConfig.id, sensorsData.sensors);
      }

      // Update successful poll timestamp
      await PRTGServer.update({
        lastSuccessfulPoll: new Date(),
        lastError: null
      }, {
        where: { id: serverConfig.id }
      });

      logger.info(`Successfully collected data from ${serverConfig.id}`, {
        durationMs: Date.now() - serverStart
      });
      
    } catch (error) {
      logger.error(`Failed to collect data from ${serverConfig.id}:`, error.message);
      throw error;
    }
  }

  /**
   * Process and store device data
   */
  async processDevices(serverId, devices) {
    if (!this.isRunning) {
      return;
    }

    // Ensure the database connection is active before processing devices
    try {
      await sequelize.authenticate();
      logger.info('Database connection is active');
    } catch (error) {
      logger.error('Database connection error:', error);
      return; // Abort processing if connection is not active
    }
    
    logger.info(`Processing ${devices.length} devices for server ${serverId}`);

    const statusCounters = {
      Up: 0,
      Warning: 0,
      Down: 0,
      Paused: 0,
      Unusual: 0,
      Unknown: 0
    };
    const issueSamples = [];

    for (const device of devices) {
      if (!this.isRunning) {
        logger.debug('Collector stop requested during device processing');
        break;
      }
      try {
        const status = this.parseStatus(device.status);
        const deviceId = parseInt(device.objid);
        const deviceName = device.device || 'Unknown Device';
        const host = device.host || null;
        
        // Upsert device
        await Device.upsert({
          id: deviceId,
          prtgServerId: serverId,
          name: deviceName,
          host: host,
          deviceType: device.devicetype || null,
          status: status,
          statusText: this.getStatusText(status),
          message: device.message || null,
          priority: parseInt(device.priority) || 3,
          lastSeen: new Date()
        });

        // Extract and store metadata
        await this.extractAndStoreMetadata(deviceId, deviceName, host, device);

        const statusText = this.getStatusText(status);
        if (statusCounters[statusText] !== undefined) {
          statusCounters[statusText] += 1;
        }

        if (status !== 3 && issueSamples.length < 5) {
          issueSamples.push({
            id: deviceId,
            name: deviceName,
            status: statusText,
            message: device.message || null
          });
        }
        
      } catch (error) {
        logger.error(`Error processing device ${device.objid}:`, error);
      }
    }

    const issueSummary = Object.entries(statusCounters)
      .filter(([status]) => status !== 'Up')
      .reduce((acc, [status, count]) => ({ ...acc, [status.toLowerCase()]: count }), {});

    if (Object.values(issueSummary).some(count => count > 0)) {
      logger.warn(`Device health issues detected for server ${serverId}`, {
        total: devices.length,
        ...issueSummary,
        samples: issueSamples
      });
    } else {
      logger.info(`All ${devices.length} devices healthy for server ${serverId}`);
    }
  }

  /**
   * Process and store sensor data
   */
  async processSensors(serverId, sensors) {
    if (!this.isRunning) {
      return;
    }

    logger.info(`Processing ${sensors.length} sensors for server ${serverId}`);

    const statusCounters = {
      Up: 0,
      Warning: 0,
      Down: 0,
      Paused: 0,
      Unusual: 0,
      Unknown: 0
    };
    const issueSamples = [];

    for (const sensor of sensors) {
      if (!this.isRunning) {
        logger.debug('Collector stop requested during sensor processing');
        break;
      }
      try {
        // Parse last seen date with fallback for invalid dates
        let lastSeen = new Date();
        if (sensor.lastcheck && 
            sensor.lastcheck !== 'Invalid date' && 
            sensor.lastcheck !== 'Never' &&
            typeof sensor.lastcheck === 'string') {
          const parsedDate = new Date(sensor.lastcheck);
          if (!isNaN(parsedDate.getTime())) {
            lastSeen = parsedDate;
          }
        }

        // Parse device ID with null handling
        const deviceId = sensor.deviceid && sensor.deviceid !== '0' ? parseInt(sensor.deviceid) : null;
        
        const status = this.parseStatus(sensor.status);
        const sensorId = parseInt(sensor.objid);

        await Sensor.upsert({
          id: sensorId,
          prtgServerId: serverId,
          deviceId: deviceId,
          name: sensor.sensor || 'Unknown Sensor',
          sensorType: sensor.type || null,
          status: status,
          statusText: this.getStatusText(status),
          priority: parseInt(sensor.priority) || 3,
          lastValue: sensor.lastvalue || null,
          lastMessage: sensor.message || null,
          lastSeen: lastSeen
        });

        const statusText = this.getStatusText(status);
        if (statusCounters[statusText] !== undefined) {
          statusCounters[statusText] += 1;
        }

        if (status !== 3 && issueSamples.length < 5) {
          issueSamples.push({
            id: sensorId,
            name: sensor.sensor || 'Unknown Sensor',
            status: statusText,
            message: sensor.message || null,
            deviceId: deviceId
          });
        }
      } catch (error) {
        logger.error(`Error processing sensor ${sensor.objid}:`, error);
      }
    }

    const issueSummary = Object.entries(statusCounters)
      .filter(([status]) => status !== 'Up')
      .reduce((acc, [status, count]) => ({ ...acc, [status.toLowerCase()]: count }), {});

    if (Object.values(issueSummary).some(count => count > 0)) {
      logger.warn(`Sensor health issues detected for server ${serverId}`, {
        total: sensors.length,
        ...issueSummary,
        samples: issueSamples
      });
    } else {
      logger.info(`All ${sensors.length} sensors healthy for server ${serverId}`);
    }
  }

  /**
   * Convert PRTG status values to numeric codes
   */
  parseStatus(statusValue) {
    // Handle both numeric and text status values from PRTG API
    if (typeof statusValue === 'number') {
      return statusValue;
    }
    
    const statusStr = String(statusValue).toLowerCase();
    const statusMap = {
      'up': 3,
      'ok': 3,
      'warning': 4,
      'down': 5,
      'error': 5,
      'paused': 7,
      'unusual': 10,
      'unknown': 1
    };
    
    return statusMap[statusStr] || parseInt(statusValue) || 1;
  }

  /**
   * Convert PRTG status codes to text
   */
  getStatusText(status) {
    const statusMap = {
      3: 'Up',
      4: 'Warning',
      5: 'Down',
      7: 'Paused',
      10: 'Unusual',
      1: 'Unknown'
    };
    return statusMap[status] || 'Unknown';
  }

  /**
   * Extract and store device metadata using intelligent parsing
   */
  async extractAndStoreMetadata(deviceId, deviceName, host, rawDeviceData) {
    try {
      // Parse metadata using our intelligent parser
      const parsedMetadata = this.metadataParser.parseDeviceMetadata(deviceName, host, rawDeviceData);
      
      if (!parsedMetadata.parsed_info || Object.keys(parsedMetadata.parsed_info).length === 0) {
        // No meaningful metadata extracted, skip
        return;
      }

      // Calculate overall confidence score
      const confidenceScore = this.calculateOverallConfidence(parsedMetadata);
      
      // Prepare data for database storage
      const metadataRecord = {
        device_id: deviceId,
        
        // Company/Client info
        company_code: parsedMetadata.parsed_info.company?.code || null,
        company_name: parsedMetadata.parsed_info.company?.full_name || null,
        company_confidence: parsedMetadata.parsed_info.company?.confidence || null,
        
        // Site/Location info
        site_identifier: parsedMetadata.parsed_info.site?.[0]?.identifier || null,
        site_type: parsedMetadata.parsed_info.site?.[0]?.type || null,
        site_location: parsedMetadata.parsed_info.location?.building || null,
        
        // Device classification
        device_category: parsedMetadata.parsed_info.device_type?.category || null,
        device_type_full: parsedMetadata.parsed_info.device_type?.type || null,
        device_function: parsedMetadata.parsed_info.device_type?.abbreviation || null,
        
        // Equipment details
        vendor: parsedMetadata.parsed_info.equipment?.vendor || null,
        model: parsedMetadata.parsed_info.equipment?.model || null,
        series: parsedMetadata.parsed_info.equipment?.series || null,
        
        // Network info
        network_segment: parsedMetadata.parsed_info.location?.network_segment || null,
        subnet_info: parsedMetadata.parsed_info.network_info?.subnet_guess || null,
        network_role: parsedMetadata.parsed_info.network_info?.network_type || null,
        
        // Environment and tags
        environment: this.extractEnvironment(parsedMetadata.parsed_info.additional_tags),
        criticality: this.extractCriticality(parsedMetadata.parsed_info.additional_tags),
        tags: parsedMetadata.parsed_info.additional_tags ? JSON.stringify(parsedMetadata.parsed_info.additional_tags) : null,
        
        // Raw data and processing info
        raw_metadata: JSON.stringify(parsedMetadata),
        naming_pattern: this.metadataParser.analyzeNamingPattern(deviceName),
        extraction_confidence: confidenceScore,
        last_parsed: new Date()
      };

      // Upsert the metadata record
      await DeviceMetadata.upsert(metadataRecord);
      
    } catch (error) {
      logger.error(`Error extracting metadata for device ${deviceId}:`, error);
    }
  }

  /**
   * Calculate overall confidence score for metadata extraction
   */
  calculateOverallConfidence(parsedMetadata) {
    let totalScore = 0;
    let factorCount = 0;

    // Company confidence
    if (parsedMetadata.parsed_info.company?.confidence) {
      const companyScore = parsedMetadata.parsed_info.company.confidence === 'high' ? 0.9 : 
                          parsedMetadata.parsed_info.company.confidence === 'medium' ? 0.6 : 0.3;
      totalScore += companyScore;
      factorCount++;
    }

    // Device type confidence
    if (parsedMetadata.parsed_info.device_type?.confidence) {
      const typeScore = parsedMetadata.parsed_info.device_type.confidence === 'high' ? 0.8 : 0.5;
      totalScore += typeScore;
      factorCount++;
    }

    // Equipment detection adds confidence
    if (parsedMetadata.parsed_info.equipment?.vendor) {
      totalScore += 0.7;
      factorCount++;
    }

    // Site detection adds confidence
    if (parsedMetadata.parsed_info.site && parsedMetadata.parsed_info.site.length > 0) {
      totalScore += 0.6;
      factorCount++;
    }

    return factorCount > 0 ? (totalScore / factorCount) : 0;
  }

  /**
   * Extract environment from tags
   */
  extractEnvironment(tags) {
    if (!tags) return null;
    
    const envTags = ['Production', 'Development', 'Staging', 'Test'];
    for (const tag of tags) {
      if (envTags.includes(tag)) return tag;
    }
    return null;
  }

  /**
   * Extract criticality from tags
   */
  extractCriticality(tags) {
    if (!tags) return null;
    
    const criticalityTags = ['Critical', 'High', 'Standard', 'Low', 'Backup'];
    for (const tag of tags) {
      if (criticalityTags.includes(tag)) return tag;
    }
    return null;
  }
}

module.exports = PRTGCollector;