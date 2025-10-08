const { sequelize } = require('../config/database');
const { DataTypes } = require('sequelize');

// Import UserSession model
const UserSession = require('./UserSession')(sequelize);

// Define models
const PRTGServer = sequelize.define('PRTGServer', {
  id: {
    type: DataTypes.STRING(50),
    primaryKey: true
  },
  url: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  username: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  lastSuccessfulPoll: {
    type: DataTypes.DATE,
    field: 'last_successful_poll'
  },
  lastError: {
    type: DataTypes.TEXT,
    field: 'last_error'
  }
}, {
  tableName: 'prtg_servers'
});

const Device = sequelize.define('Device', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: false
  },
  prtgServerId: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'prtg_server_id'
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  host: DataTypes.STRING(255),
  deviceType: {
    type: DataTypes.STRING(100),
    field: 'device_type'
  },
  status: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  statusText: {
    type: DataTypes.STRING(50),
    field: 'status_text'
  },
  message: {
    type: DataTypes.TEXT,
    field: 'message'
  },
  priority: DataTypes.INTEGER,
  lastSeen: {
    type: DataTypes.DATE,
    field: 'last_seen'
  }
}, {
  tableName: 'devices'
});

const Sensor = sequelize.define('Sensor', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: false
  },
  prtgServerId: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'prtg_server_id'
  },
  deviceId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'device_id'
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  sensorType: {
    type: DataTypes.STRING(100),
    field: 'sensor_type'
  },
  status: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  statusText: {
    type: DataTypes.STRING(50),
    field: 'status_text'
  },
  priority: DataTypes.INTEGER,
  lastValue: {
    type: DataTypes.STRING(255),
    field: 'last_value'
  },
  lastMessage: {
    type: DataTypes.TEXT,
    field: 'last_message'
  },
  lastSeen: {
    type: DataTypes.DATE,
    field: 'last_seen'
  }
}, {
  tableName: 'sensors'
});

const SensorReading = sequelize.define('SensorReading', {
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    autoIncrement: true
  },
  prtgServerId: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'prtg_server_id'
  },
  sensorId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'sensor_id'
  },
  timestamp: {
    type: DataTypes.DATE,
    allowNull: false
  },
  value: DataTypes.DECIMAL(20, 4),
  valueText: {
    type: DataTypes.STRING(255),
    field: 'value_text'
  },
  status: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  tableName: 'sensor_readings',
  updatedAt: false
});

const Alert = sequelize.define('Alert', {
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    autoIncrement: true
  },
  prtgServerId: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'prtg_server_id'
  },
  sensorId: {
    type: DataTypes.INTEGER,
    field: 'sensor_id'
  },
  deviceId: {
    type: DataTypes.INTEGER,
    field: 'device_id'
  },
  alertType: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'alert_type'
  },
  severity: {
    type: DataTypes.STRING(20),
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  timestamp: {
    type: DataTypes.DATE,
    allowNull: false
  },
  acknowledged: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  acknowledgedBy: {
    type: DataTypes.STRING(100),
    field: 'acknowledged_by'
  },
  acknowledgedAt: {
    type: DataTypes.DATE,
    field: 'acknowledged_at'
  }
}, {
  tableName: 'alerts',
  updatedAt: false
});

// Define relationships
PRTGServer.hasMany(Device, { foreignKey: 'prtg_server_id', as: 'devices' });
Device.belongsTo(PRTGServer, { foreignKey: 'prtg_server_id', as: 'server' });

PRTGServer.hasMany(Sensor, { foreignKey: 'prtg_server_id', as: 'sensors' });
Sensor.belongsTo(PRTGServer, { foreignKey: 'prtg_server_id', as: 'server' });

Device.hasMany(Sensor, { foreignKey: 'device_id', as: 'sensors' });
Sensor.belongsTo(Device, { foreignKey: 'device_id', as: 'device' });

Sensor.hasMany(SensorReading, { foreignKey: 'sensor_id', as: 'readings' });
SensorReading.belongsTo(Sensor, { foreignKey: 'sensor_id', as: 'sensor' });

// Import DeviceMetadata model
const DeviceMetadata = require('./DeviceMetadata')(sequelize);

// Add DeviceMetadata relationships
Device.hasOne(DeviceMetadata, { foreignKey: 'device_id', as: 'metadata' });
DeviceMetadata.belongsTo(Device, { foreignKey: 'device_id', as: 'device' });

module.exports = {
  sequelize,
  PRTGServer,
  Device,
  Sensor,
  SensorReading,
  Alert,
  DeviceMetadata,
  UserSession
};
