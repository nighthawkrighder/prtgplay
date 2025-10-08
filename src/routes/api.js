const express = require('express');
const { Op, sequelize } = require('sequelize');
const { PRTGServer, Device, Sensor, SensorReading, Alert, DeviceMetadata, UserSession } = require('../models');
const logger = require('../utils/logger');
const EDRSessionManager = require('../services/edrSessionManager');

const router = express.Router();

// ============================================
// Dashboard Summary
// ============================================
router.get('/dashboard/summary', async (req, res) => {
  try {
    const summary = {
      servers: await PRTGServer.count({ where: { enabled: true } }),
      devices: {
        total: await Device.count(),
        up: await Device.count({ where: { status: 3 } }),
        down: await Device.count({ where: { status: 5 } }),
        warning: await Device.count({ where: { status: 4 } })
      },
      sensors: {
        total: await Sensor.count(),
        up: await Sensor.count({ where: { status: 3 } }),
        down: await Sensor.count({ where: { status: 5 } }),
        warning: await Sensor.count({ where: { status: 4 } }),
        paused: await Sensor.count({ where: { status: 7 } }),
        unusual: await Sensor.count({ where: { status: 10 } }),
        unknown: await Sensor.count({ where: { status: 1 } })
      },
      alerts: {
        unacknowledged: await Alert.count({ where: { acknowledged: false } }),
        last24h: await Alert.count({
          where: {
            timestamp: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          }
        })
      }
    };

    res.json(summary);
  } catch (error) {
    logger.error('Error fetching dashboard summary:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard summary' });
  }
});

// ============================================
// PRTG Servers
// ============================================
router.get('/servers', async (req, res) => {
  try {
    const servers = await PRTGServer.findAll({
      attributes: ['id', 'url', 'username', 'enabled', 'lastSuccessfulPoll', 'lastError']
    });
    res.json(servers);
  } catch (error) {
    logger.error('Error fetching servers:', error);
    res.status(500).json({ error: 'Failed to fetch servers' });
  }
});

router.get('/servers/:id', async (req, res) => {
  try {
    const server = await PRTGServer.findByPk(req.params.id);
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }
    res.json(server);
  } catch (error) {
    logger.error('Error fetching server:', error);
    res.status(500).json({ error: 'Failed to fetch server' });
  }
});

// ============================================
// Devices
// ============================================
router.get('/devices', async (req, res) => {
  try {
    const { serverId, status, search, limit = 100, offset = 0 } = req.query;
    
    const where = {};
    if (serverId) where.prtgServerId = serverId;
    if (status) where.status = parseInt(status);
    if (search) {
      where.name = { [Op.like]: `%${search}%` };
    }

    const devices = await Device.findAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['status', 'DESC'], ['priority', 'DESC'], ['name', 'ASC']],
      include: [{
        model: PRTGServer,
        as: 'server',
        attributes: ['id', 'url']
      }]
    });

    const total = await Device.count({ where });

    res.json({
      devices,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    logger.error('Error fetching devices:', error);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

// Get enhanced device list with metadata (must be before :id route)
router.get('/devices/enhanced', async (req, res) => {
  try {
    const { 
      company, 
      site, 
      category, 
      environment, 
      search, 
      limit = 100,  // Increased default limit
      offset = 0,
      all = false,   // New parameter to get all devices
      includeSensors = 'true'  // Allow excluding sensors for performance
    } = req.query;
    
    const deviceWhere = {};
    const metadataWhere = {};
    
    if (search) {
      deviceWhere.name = { [Op.like]: `%${search}%` };
    }
    
    if (company) metadataWhere.company_code = company;
    if (site) metadataWhere.site_identifier = site;
    if (category) metadataWhere.device_category = category;
    if (environment) metadataWhere.environment = environment;

    // Build query options
    const queryOptions = {
      where: deviceWhere,
      order: [['status', 'DESC'], ['priority', 'DESC'], ['name', 'ASC']],
      include: [
        {
          model: PRTGServer,
          as: 'server',
          attributes: ['id', 'url']
        },
        {
          model: DeviceMetadata,
          as: 'metadata',
          where: Object.keys(metadataWhere).length > 0 ? metadataWhere : undefined,
          required: false,
          attributes: [
            'company_code', 'company_name', 'site_identifier', 'site_type', 
            'device_category', 'device_type_full', 'vendor', 'model',
            'environment', 'criticality', 'tags', 'raw_metadata', 'extraction_confidence'
          ]
        }
      ]
    };

    // Only include sensors if explicitly requested (improves performance for large datasets)
    if (includeSensors === 'true') {
      queryOptions.include.push({
        model: Sensor,
        as: 'sensors',
        required: false,
        attributes: ['id', 'status', 'sensor_type', 'priority', 'last_message']
      });
    }

    // Apply pagination only if not requesting all devices
    if (all !== 'true') {
      queryOptions.limit = parseInt(limit);
      queryOptions.offset = parseInt(offset);
    }

    // Get total count for pagination metadata
    const totalCount = await Device.count({
      where: deviceWhere,
      include: Object.keys(metadataWhere).length > 0 ? [{
        model: DeviceMetadata,
        as: 'metadata',
        where: metadataWhere,
        required: false
      }] : []
    });

    // Fetch devices
    const devices = await Device.findAll(queryOptions);

    // Calculate pagination metadata
    const currentLimit = parseInt(limit);
    const currentOffset = parseInt(offset);
    const hasMore = currentOffset + currentLimit < totalCount;
    const totalPages = Math.ceil(totalCount / currentLimit);
    const currentPage = Math.floor(currentOffset / currentLimit) + 1;

    // Process devices with enhanced metadata
    const enhancedDevices = devices.map(device => {
      const deviceData = device.toJSON();
      
      // Extract company information
      const companyCode = extractCompanyCode(deviceData.name);
      
      // Calculate sensor statistics only if sensors are included
      const sensors = deviceData.sensors || [];
      const sensorStats = includeSensors === 'true' ? {
        total: sensors.length,
        up: sensors.filter(s => s.status === 3).length,
        down: sensors.filter(s => s.status === 5).length,
        warning: sensors.filter(s => s.status === 4).length,
        paused: sensors.filter(s => s.status === 7).length,
        unusual: sensors.filter(s => s.status === 10).length
      } : {
        total: 0, up: 0, down: 0, warning: 0, paused: 0, unusual: 0
      };
      
      // Determine device type and criticality
      const deviceType = getDeviceType(deviceData.name);
      const criticality = getCriticality(deviceData.name, deviceType);
      
      return {
        ...deviceData,
        companyCode,
        companyName: getCompanyName(companyCode),
        deviceType,
        criticality,
        sensorStats,
        alertCount: sensorStats.down + sensorStats.warning,
        healthScore: calculateHealthScore(sensorStats),
        lastSeen: deviceData.last_seen || deviceData.updated_at
      };
    });

    // Return paginated response
    res.json({
      devices: enhancedDevices,
      pagination: {
        total: totalCount,
        limit: currentLimit,
        offset: currentOffset,
        page: currentPage,
        totalPages: totalPages,
        hasMore: hasMore,
        hasNext: hasMore,
        hasPrev: currentOffset > 0
      },
      meta: {
        fetched: enhancedDevices.length,
        requestedAll: all === 'true',
        filters: {
          company,
          site,
          category,
          environment,
          search
        }
      }
    });

  } catch (error) {
    logger.error('Error fetching enhanced devices:', error);
    res.status(500).json({ error: 'Failed to fetch enhanced devices' });
  }
});

router.get('/devices/:id', async (req, res) => {
  try {
    const device = await Device.findByPk(req.params.id, {
      include: [
        {
          model: PRTGServer,
          as: 'server',
          attributes: ['id', 'url']
        },
        {
          model: Sensor,
          as: 'sensors',
          limit: 50
        }
      ]
    });

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    res.json(device);
  } catch (error) {
    logger.error('Error fetching device:', error);
    res.status(500).json({ error: 'Failed to fetch device' });
  }
});

// ============================================
// Sensors
// ============================================
router.get('/sensors', async (req, res) => {
  try {
    const { serverId, deviceId, status, search, limit = 100, offset = 0 } = req.query;
    
    const where = {};
    if (serverId) where.prtgServerId = serverId;
    if (deviceId) where.deviceId = parseInt(deviceId);
    if (status) where.status = parseInt(status);
    if (search) {
      where.name = { [Op.like]: `%${search}%` };
    }

    const sensors = await Sensor.findAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['status', 'DESC'], ['priority', 'DESC'], ['name', 'ASC']],
      include: [
        {
          model: Device,
          as: 'device',
          attributes: ['id', 'name']
        },
        {
          model: PRTGServer,
          as: 'server',
          attributes: ['id', 'url']
        }
      ]
    });

    const total = await Sensor.count({ where });

    res.json({
      sensors,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    logger.error('Error fetching sensors:', error);
    res.status(500).json({ error: 'Failed to fetch sensors' });
  }
});

router.get('/sensors/:id', async (req, res) => {
  try {
    const sensor = await Sensor.findByPk(req.params.id, {
      include: [
        {
          model: Device,
          as: 'device'
        },
        {
          model: PRTGServer,
          as: 'server',
          attributes: ['id', 'url']
        }
      ]
    });

    if (!sensor) {
      return res.status(404).json({ error: 'Sensor not found' });
    }

    res.json(sensor);
  } catch (error) {
    logger.error('Error fetching sensor:', error);
    res.status(500).json({ error: 'Failed to fetch sensor' });
  }
});

// ============================================
// Sensor Readings (Historical Data)
// ============================================
router.get('/sensors/:id/readings', async (req, res) => {
  try {
    const { hours = 24, limit = 1000 } = req.query;
    const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);

    const readings = await SensorReading.findAll({
      where: {
        sensorId: req.params.id,
        timestamp: { [Op.gte]: startTime }
      },
      order: [['timestamp', 'ASC']],
      limit: parseInt(limit)
    });

    res.json({ readings });
  } catch (error) {
    logger.error('Error fetching sensor readings:', error);
    res.status(500).json({ error: 'Failed to fetch sensor readings' });
  }
});

// ============================================
// Alerts
// ============================================
router.get('/alerts', async (req, res) => {
  try {
    const { 
      serverId, 
      severity, 
      acknowledged = 'false', 
      hours = 24,
      limit = 100, 
      offset = 0 
    } = req.query;
    
    const where = {};
    if (serverId) where.prtgServerId = serverId;
    if (severity) where.severity = severity;
    where.acknowledged = acknowledged === 'true';
    
    if (hours !== 'all') {
      where.timestamp = { 
        [Op.gte]: new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000) 
      };
    }

    const alerts = await Alert.findAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['timestamp', 'DESC']]
    });

    const total = await Alert.count({ where });

    res.json({
      alerts,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    logger.error('Error fetching alerts:', error);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

router.post('/alerts/:id/acknowledge', async (req, res) => {
  try {
    const { acknowledgedBy } = req.body;
    
    const alert = await Alert.findByPk(req.params.id);
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    alert.acknowledged = true;
    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = new Date();
    await alert.save();

    res.json(alert);
  } catch (error) {
    logger.error('Error acknowledging alert:', error);
    res.status(500).json({ error: 'Failed to acknowledge alert' });
  }
});

// ============================================
// Health Check
// ============================================
router.get('/health', async (req, res) => {
  try {
    const dbHealthy = await PRTGServer.count() >= 0;
    res.json({
      status: 'healthy',
      database: dbHealthy,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============================================
// Device Metadata & Expandable Sections
// ============================================



// Get device expandable sections
router.get('/devices/:id/metadata', async (req, res) => {
  try {
    const deviceId = req.params.id;
    
    const device = await Device.findByPk(deviceId, {
      include: [
        {
          model: DeviceMetadata,
          as: 'metadata',
          attributes: ['raw_metadata', 'extraction_confidence', 'last_parsed']
        },
        {
          model: Sensor,
          as: 'sensors',
          attributes: ['name', 'sensor_type', 'last_message', 'status_text'],
          limit: 10 // Limit sensors for performance
        }
      ]
    });

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    let expandableSections = {};
    
    if (device.metadata && device.metadata.raw_metadata) {
      try {
        const rawMetadata = JSON.parse(device.metadata.raw_metadata);
        expandableSections = rawMetadata.expandable_sections || {};
      } catch (err) {
        logger.warn(`Failed to parse raw metadata for device ${deviceId}:`, err);
      }
    }

    // Add sensor information section
    if (device.sensors && device.sensors.length > 0) {
      expandableSections.sensors = {
        label: 'Sensors',
        icon: '📊',
        data: {
          sensor_count: device.sensors.length,
          sensors: device.sensors.map(sensor => ({
            name: sensor.name,
            type: sensor.sensor_type,
            status: sensor.status_text,
            last_message: sensor.last_message ? sensor.last_message.replace(/<[^>]*>/g, '') : null
          }))
        }
      };
    }

    res.json({
      device_id: deviceId,
      device_name: device.name,
      expandable_sections: expandableSections,
      extraction_confidence: device.metadata?.extraction_confidence || null,
      last_parsed: device.metadata?.last_parsed || null
    });

  } catch (error) {
    logger.error(`Error fetching device metadata for ${req.params.id}:`, error);
    res.status(500).json({ error: 'Failed to fetch device metadata' });
  }
});

// Get metadata aggregations for filtering
router.get('/metadata/aggregations', async (req, res) => {
  try {
    const [companies, sites, categories, vendors, environments] = await Promise.all([
      // Companies
      DeviceMetadata.findAll({
        attributes: [
          'company_code',
          'company_name',
          [sequelize.fn('COUNT', sequelize.col('device_id')), 'device_count']
        ],
        where: { company_code: { [Op.not]: null } },
        group: ['company_code', 'company_name'],
        order: [[sequelize.fn('COUNT', sequelize.col('device_id')), 'DESC']]
      }),
      
      // Sites
      DeviceMetadata.findAll({
        attributes: [
          'site_identifier',
          'site_type',
          [sequelize.fn('COUNT', sequelize.col('device_id')), 'device_count']
        ],
        where: { site_identifier: { [Op.not]: null } },
        group: ['site_identifier', 'site_type'],
        order: [[sequelize.fn('COUNT', sequelize.col('device_id')), 'DESC']]
      }),
      
      // Device categories
      DeviceMetadata.findAll({
        attributes: [
          'device_category',
          [sequelize.fn('COUNT', sequelize.col('device_id')), 'device_count']
        ],
        where: { device_category: { [Op.not]: null } },
        group: ['device_category'],
        order: [[sequelize.fn('COUNT', sequelize.col('device_id')), 'DESC']]
      }),
      
      // Vendors
      DeviceMetadata.findAll({
        attributes: [
          'vendor',
          [sequelize.fn('COUNT', sequelize.col('device_id')), 'device_count']
        ],
        where: { vendor: { [Op.not]: null } },
        group: ['vendor'],
        order: [[sequelize.fn('COUNT', sequelize.col('device_id')), 'DESC']]
      }),
      
      // Environments
      DeviceMetadata.findAll({
        attributes: [
          'environment',
          [sequelize.fn('COUNT', sequelize.col('device_id')), 'device_count']
        ],
        where: { environment: { [Op.not]: null } },
        group: ['environment'],
        order: [[sequelize.fn('COUNT', sequelize.col('device_id')), 'DESC']]
      })
    ]);

    res.json({
      companies,
      sites,
      categories,
      vendors,
      environments,
      summary: {
        total_devices_with_metadata: await DeviceMetadata.count(),
        extraction_stats: await DeviceMetadata.findAll({
          attributes: [
            [sequelize.fn('AVG', sequelize.col('extraction_confidence')), 'avg_confidence'],
            [sequelize.fn('MIN', sequelize.col('extraction_confidence')), 'min_confidence'],
            [sequelize.fn('MAX', sequelize.col('extraction_confidence')), 'max_confidence']
          ]
        })
      }
    });

  } catch (error) {
    logger.error('Error fetching metadata aggregations:', error);
    res.status(500).json({ error: 'Failed to fetch metadata aggregations' });
  }
});

// ============================================
// SOC Dashboard Enhanced Endpoints  
// ============================================

// Company summary endpoint
router.get('/companies/summary', async (req, res) => {
  try {
    const devices = await Device.findAll({
      include: [
        {
          model: Sensor,
          as: 'sensors',
          required: false,
          attributes: ['id', 'status']
        }
      ]
    });

    const companySummary = {};
    
    devices.forEach(device => {
      const deviceData = device.toJSON();
      const companyCode = extractCompanyCode(deviceData.name);
      
      if (!companySummary[companyCode]) {
        companySummary[companyCode] = {
          code: companyCode,
          name: getCompanyName(companyCode),
          deviceCount: 0,
          sensorCount: 0,
          stats: {
            devicesUp: 0,
            devicesDown: 0,
            devicesWarning: 0,
            sensorsUp: 0,
            sensorsDown: 0,
            sensorsWarning: 0
          },
          criticality: 'low',
          lastUpdate: null
        };
      }
      
      const company = companySummary[companyCode];
      company.deviceCount++;
      
      const sensors = deviceData.sensors || [];
      company.sensorCount += sensors.length;
      
      // Update device status counts
      if (deviceData.status === 3) company.stats.devicesUp++;
      else if (deviceData.status === 5) company.stats.devicesDown++;
      else if (deviceData.status === 4) company.stats.devicesWarning++;
      
      // Update sensor status counts
      sensors.forEach(sensor => {
        if (sensor.status === 3) company.stats.sensorsUp++;
        else if (sensor.status === 5) company.stats.sensorsDown++;
        else if (sensor.status === 4) company.stats.sensorsWarning++;
      });
      
      // Update criticality
      if (company.stats.devicesDown > 0 || company.stats.sensorsDown > 0) {
        company.criticality = 'high';
      } else if (company.stats.devicesWarning > 0 || company.stats.sensorsWarning > 0) {
        company.criticality = 'medium';
      }
      
      // Update last update time
      const lastUpdate = new Date(deviceData.updated_at);
      if (!company.lastUpdate || lastUpdate > company.lastUpdate) {
        company.lastUpdate = lastUpdate;
      }
    });

    // Sort by device count descending
    const sortedCompanies = Object.values(companySummary)
      .sort((a, b) => b.deviceCount - a.deviceCount);

    res.json(sortedCompanies);

  } catch (error) {
    logger.error('Error fetching company summary:', error);
    res.status(500).json({ error: 'Failed to fetch company summary' });
  }
});

// Real-time dashboard stats
router.get('/dashboard/realtime-stats', async (req, res) => {
  try {
    const stats = await Promise.all([
      Device.count(),
      Device.count({ where: { status: 3 } }),
      Device.count({ where: { status: 5 } }),
      Device.count({ where: { status: 4 } }),
      Sensor.count(),
      Sensor.count({ where: { status: 5 } }),
      Sensor.count({ where: { status: 4 } })
    ]);

    const [totalDevices, devicesUp, devicesDown, devicesWarning, 
           totalSensors, sensorsDown, sensorsWarning] = stats;
           
    // Calculate company count
    const devices = await Device.findAll({ attributes: ['name'] });
    const companies = new Set();
    devices.forEach(device => {
      companies.add(extractCompanyCode(device.name));
    });

    const realtimeStats = {
      timestamp: new Date(),
      devices: {
        total: totalDevices,
        up: devicesUp,
        down: devicesDown,
        warning: devicesWarning,
        upPercent: totalDevices > 0 ? Math.round((devicesUp / totalDevices) * 100) : 0
      },
      sensors: {
        total: totalSensors,
        down: sensorsDown,
        warning: sensorsWarning,
        alerts: sensorsDown + sensorsWarning
      },
      companies: {
        total: companies.size
      },
      systemHealth: {
        overall: calculateSystemHealth(devicesUp, totalDevices, sensorsDown, totalSensors),
        status: getSystemStatus(devicesDown, devicesWarning, sensorsDown)
      }
    };

    res.json(realtimeStats);

  } catch (error) {
    logger.error('Error fetching realtime stats:', error);
    res.status(500).json({ error: 'Failed to fetch realtime stats' });
  }
});

// Helper functions
function extractCompanyCode(deviceName) {
  const patterns = [
    /^([A-Z]{2,4})-/,  // VEC-, DEC-, etc.
    /^([A-Za-z]+)-/,   // CalTel-, etc.
  ];
  
  for (const pattern of patterns) {
    const match = deviceName.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }
  
  return 'OTHER';
}

function getCompanyName(companyCode) {
  const companyNames = {
    'VEC': 'Vector Communications',
    'DEC': 'Digital Edge Communications', 
    'CALTEL': 'California Telecom',
    'GPS': 'GPS Network Systems',
    'EBA': 'Enterprise Business Associates',
    'CPM': 'Control Point Monitor',
    'PRTG': 'PRTG Core Services',
    'OTHER': 'Unclassified Devices'
  };
  
  return companyNames[companyCode] || `${companyCode} Network`;
}

function getDeviceType(deviceName) {
  const types = {
    'ESX': 'VMware Server',
    'ESXI': 'VMware Server', 
    'PDU': 'Power Distribution',
    'APC': 'UPS/Power',
    'CORE': 'Core Switch',
    'SW': 'Network Switch',
    'FW': 'Firewall',
    'AP': 'Access Point',
    'WLC': 'Wireless Controller',
    'MPLS': 'MPLS Router'
  };
  
  const upperName = deviceName.toUpperCase();
  for (const [key, value] of Object.entries(types)) {
    if (upperName.includes(key)) {
      return value;
    }
  }
  return 'Network Device';
}

function getCriticality(deviceName, deviceType) {
  const upperName = deviceName.toUpperCase();
  if (upperName.includes('CORE') || upperName.includes('FW') || upperName.includes('ESXI')) {
    return 'high';
  } else if (upperName.includes('SW') || upperName.includes('PDU') || upperName.includes('APC')) {
    return 'medium';
  }
  return 'low';
}

function calculateHealthScore(sensorStats) {
  if (sensorStats.total === 0) return 100;
  
  const healthyCount = sensorStats.up;
  const totalCount = sensorStats.total;
  
  return Math.round((healthyCount / totalCount) * 100);
}

function calculateSystemHealth(devicesUp, totalDevices, sensorsDown, totalSensors) {
  if (totalDevices === 0) return 100;
  
  const deviceHealthWeight = 0.7;
  const sensorHealthWeight = 0.3;
  
  const deviceHealth = (devicesUp / totalDevices) * 100;
  const sensorHealth = totalSensors > 0 ? ((totalSensors - sensorsDown) / totalSensors) * 100 : 100;
  
  return Math.round(deviceHealth * deviceHealthWeight + sensorHealth * sensorHealthWeight);
}

function getSystemStatus(devicesDown, devicesWarning, sensorsDown) {
  if (devicesDown > 0 || sensorsDown > 5) return 'critical';
  if (devicesWarning > 0 || sensorsDown > 0) return 'warning';
  return 'healthy';
}

// ============================================
// EDR SESSION MANAGEMENT ENDPOINTS
// ============================================

const sessionManager = new EDRSessionManager();

// Create new session (login)
router.post('/sessions/login', async (req, res) => {
  try {
    const { username, password, additionalData } = req.body;
    
    // Validate credentials (integrate with your auth system)
    // For now, accepting any credentials as example
    const userData = {
      user_id: username,
      username: username,
      role: 'administrator'
    };
    
    const session = await sessionManager.createSession(userData, req);
    
    res.json({
      success: true,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
      user: {
        username: userData.username,
        role: userData.role
      },
      securityInfo: {
        riskScore: session.session.risk_score,
        deviceFingerprint: session.session.device_fingerprint
      }
    });
    
  } catch (error) {
    logger.error('Login failed:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// Validate session
router.post('/sessions/validate', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const validation = await sessionManager.validateSession(sessionId, req);
    
    if (validation.valid) {
      res.json({
        valid: true,
        user: {
          username: validation.session.username,
          role: validation.session.user_role
        },
        security: validation.securityStatus,
        riskScore: validation.session.risk_score
      });
    } else {
      res.status(401).json({ valid: false, reason: validation.reason });
    }
  } catch (error) {
    logger.error('Session validation failed:', error);
    res.status(500).json({ valid: false, error: error.message });
  }
});

// Logout session
router.post('/sessions/logout', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const success = await sessionManager.terminateSession(sessionId, 'user_logout');
    
    res.json({ success: success });
  } catch (error) {
    logger.error('Logout failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get session info
router.get('/sessions/:sessionId', async (req, res) => {
  try {
    const session = await UserSession.findByPk(req.params.sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const sessionDuration = session.logout_time 
      ? new Date(session.logout_time) - new Date(session.login_time)
      : Date.now() - new Date(session.login_time);
    
    res.json({
      sessionId: session.session_id,
      username: session.username,
      role: session.user_role,
      loginTime: session.login_time,
      lastActivity: session.last_activity,
      logoutTime: session.logout_time,
      status: session.session_status,
      durationMinutes: Math.round(sessionDuration / 60000),
      ipAddress: session.ip_address,
      userAgent: session.user_agent,
      riskScore: session.risk_score,
      securityEvents: (session.security_events || []).length,
      anomalies: (session.anomaly_flags || []).length,
      activities: (session.activity_log || []).slice(-10) // Last 10 activities
    });
    
  } catch (error) {
    logger.error('Failed to get session info:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get session analytics (EDR dashboard)
router.get('/sessions/analytics/:timeframe?', async (req, res) => {
  try {
    const timeframe = parseInt(req.params.timeframe) || 24;
    const analytics = await sessionManager.getSessionAnalytics(timeframe);
    
    res.json(analytics);
  } catch (error) {
    logger.error('Failed to get session analytics:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get active sessions (admin only)
router.get('/sessions/active/list', async (req, res) => {
  try {
    const activeSessions = await UserSession.findAll({
      where: { session_status: 'active' },
      attributes: ['session_id', 'username', 'user_role', 'login_time', 'last_activity', 'ip_address', 'risk_score'],
      order: [['last_activity', 'DESC']]
    });
    
    res.json(activeSessions);
  } catch (error) {
    logger.error('Failed to get active sessions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Force terminate session (admin only)
router.post('/sessions/:sessionId/terminate', async (req, res) => {
  try {
    const { reason = 'admin_terminated' } = req.body;
    const success = await sessionManager.terminateSession(req.params.sessionId, reason);
    
    res.json({ success: success });
  } catch (error) {
    logger.error('Failed to terminate session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
