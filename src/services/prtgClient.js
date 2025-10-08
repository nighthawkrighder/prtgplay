const axios = require('axios');
const https = require('https');
const logger = require('../utils/logger');

// Create HTTPS agent that bypasses SSL certificate validation
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

class PRTGClient {
  constructor(config) {
    this.id = config.id;
    this.baseUrl = config.url;
    this.username = config.username;
    this.passhash = config.passhash;
    this.enabled = config.enabled;
  }

  /**
   * Make authenticated request to PRTG API
   */
  async request(endpoint, params = {}) {
    if (!this.enabled) {
      throw new Error(`PRTG server ${this.id} is disabled`);
    }

    const url = `${this.baseUrl}${endpoint}`;
    
    try {
      const response = await axios.get(url, {
        httpsAgent,
        params: {
          ...params,
          username: this.username,
          passhash: this.passhash,
          output: 'json'
        },
        timeout: 30000
      });

      logger.debug(`PRTG API request successful: ${this.id} - ${endpoint}`);
      return response.data;
    } catch (error) {
      logger.error(`PRTG API request failed: ${this.id} - ${endpoint}`, {
        error: error.message,
        code: error.code
      });
      throw error;
    }
  }

  /**
   * Get all sensors with optional filters
   */
  async getSensors(filters = {}) {
    const params = {
      content: 'sensors',
      count: 50000, // Get up to 50,000 sensors instead of default 500
      columns: [
        'objid', 'name', 'status', 'status_raw', 'lastvalue', 'lastvalue_raw',
        'priority', 'device', 'deviceid', 'group', 'groupid', 'probe', 'probeid',
        'sensor', 'type', 'message', 'lastcheck', 'uptimesince', 'downtimesince'
      ].join(','),
      ...filters
    };

    const data = await this.request('/api/table.json', params);
    return data.sensors || [];
  }

  /**
   * Get all devices
   */
  async getDevices(filters = {}) {
    const params = {
      content: 'devices',
      count: 50000, // Get up to 50,000 devices instead of default 500
      columns: [
        'objid', 'name', 'status', 'status_raw', 'host', 'device',
        'group', 'groupid', 'probe', 'probeid', 'priority',
        'lastup', 'lastdown', 'downtimesince', 'lastcheck',
        'access', 'comments', 'favorite', 'tags', 'active', 'message'
      ].join(','),
      ...filters
    };

    const data = await this.request('/api/table.json', params);
    return data.devices || [];
  }

  /**
   * Get sensor details by ID
   */
  async getSensorById(sensorId) {
    const params = {
      content: 'sensors',
      columns: [
        'objid', 'name', 'status', 'status_raw', 'lastvalue', 'lastvalue_raw',
        'priority', 'device', 'deviceid', 'group', 'groupid', 'probe', 'probeid',
        'message', 'lastup', 'lastup_raw', 'lastdown', 'lastdown_raw',
        'downtimesince', 'downtimesince_raw', 'lastcheck', 'lastcheck_raw',
        'interval', 'access', 'comments', 'favorite', 'tags', 'type'
      ].join(','),
      filter_objid: sensorId
    };

    const data = await this.request('/api/table.json', params);
    return data.sensors?.[0] || null;
  }

  /**
   * Get historical data for a sensor
   */
  async getSensorHistory(sensorId, options = {}) {
    const params = {
      id: sensorId,
      sdate: options.startDate || this.getDateOffset(7), // Default 7 days
      edate: options.endDate || 'now',
      avg: options.avg || 0, // 0 = raw data
      ...options
    };

    return await this.request('/api/historicdata.json', params);
  }

  /**
   * Get system status
   */
  async getStatus() {
    const data = await this.request('/api/status.json');
    return data;
  }

  /**
   * Get all groups
   */
  async getGroups() {
    const params = {
      content: 'groups',
      columns: 'objid,name,status,status_raw,priority,probe,probeid,access,comments,favorite'
    };

    const data = await this.request('/api/table.json', params);
    return data.groups || [];
  }

  /**
   * Get sensors by status
   */
  async getSensorsByStatus(status) {
    const statusMap = {
      'up': 3,
      'down': 5,
      'warning': 4,
      'paused': 7,
      'unusual': 10,
      'unknown': 1
    };

    const statusRaw = statusMap[status.toLowerCase()];
    if (!statusRaw) {
      throw new Error(`Invalid status: ${status}`);
    }

    return await this.getSensors({ filter_status: statusRaw });
  }

  /**
   * Health check - test connection to PRTG server
   */
  async healthCheck() {
    try {
      await this.getStatus();
      return { healthy: true, server: this.id };
    } catch (error) {
      return { 
        healthy: false, 
        server: this.id, 
        error: error.message 
      };
    }
  }

  /**
   * Helper: Get date offset for historical queries
   */
  getDateOffset(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }

  /**
   * Parse status raw value to text
   */
  static parseStatusText(statusRaw) {
    const statusMap = {
      1: 'Unknown',
      2: 'Scanning',
      3: 'Up',
      4: 'Warning',
      5: 'Down',
      6: 'No Probe',
      7: 'Paused by User',
      8: 'Paused by Dependency',
      9: 'Paused by Schedule',
      10: 'Unusual',
      11: 'Not Licensed',
      12: 'Paused Until',
      13: 'Down Acknowledged',
      14: 'Down Partial'
    };
    return statusMap[statusRaw] || 'Unknown';
  }
}

module.exports = PRTGClient;
