const logger = require('../utils/logger');

/**
 * Intelligent metadata parser for PRTG device and sensor names
 * Extracts company names, client info, site details, and equipment information
 */
class MetadataParser {
  constructor() {
    // Common company/client prefixes and patterns
    this.companyPatterns = [
      // 3-letter codes (very common pattern)
      /^([A-Z]{3})-/i,
      // 2-letter codes  
      /^([A-Z]{2})-/i,
      // Full company names
      /^(CalTel|Charter|Cogent|AT&T|Bendick|Annex)/i,
      // Location-based naming
      /(Anaheim|Crenshaw|Valley|GPS|TOW|DEC|VEC|Comunidad)/i
    ];

    // Device type patterns
    this.deviceTypes = {
      // Servers and virtualization
      'ESXi': { type: 'VMware Host', category: 'Server' },
      'VCSA': { type: 'vCenter Server', category: 'Management' },
      'IDPA': { type: 'Data Protection Appliance', category: 'Storage' },
      'SQL': { type: 'Database Server', category: 'Server' },
      
      // Networking equipment
      'FW': { type: 'Firewall', category: 'Security' },
      'FGT': { type: 'FortiGate Firewall', category: 'Security' },
      'SW': { type: 'Switch', category: 'Network' },
      'CORE': { type: 'Core Switch', category: 'Network' },
      'AP': { type: 'Access Point', category: 'Wireless' },
      'WAP': { type: 'Wireless Access Point', category: 'Wireless' },
      
      // Storage and infrastructure
      'PDU': { type: 'Power Distribution Unit', category: 'Infrastructure' },
      'APC': { type: 'UPS/Power Management', category: 'Infrastructure' },
      'SC': { type: 'Storage Controller', category: 'Storage' },
      'EN': { type: 'Storage Enclosure', category: 'Storage' },
      
      // Management interfaces
      'iDRAC': { type: 'Dell Remote Management', category: 'Management' },
      'MGMT': { type: 'Management Interface', category: 'Management' }
    };

    // Location/site patterns
    this.locationPatterns = [
      /-(HQ|DC|COLO|LAC|HV)(\d+)?/i,
      /-([A-Z]{2,3}\d+)/i, // Like DC2, LAC, etc.
      /(Anaheim|Crenshaw|Valley|Darin|Mazzoco)/i
    ];

    // Equipment vendors and models
    this.equipmentPatterns = {
      'Dell': /Dell|N\d{4}P?|S\d{4}/i,
      'Cisco': /\d{4}-\d{4}|Catalyst/i,
      'Juniper': /EX\d{4}/i,
      'Fortinet': /FGT\d+|Forti/i,
      'Brocade': /Brocade/i,
      'VMware': /ESXi|vCenter|VCSA/i,
      'APC': /APC/i
    };
  }

  /**
   * Parse a device name and extract all available metadata
   * @param {string} deviceName - The device name from PRTG
   * @param {string} host - The IP/hostname
   * @param {Object} additionalData - Any additional sensor data
   * @returns {Object} Structured metadata
   */
  parseDeviceMetadata(deviceName, host = '', additionalData = {}) {
    if (!deviceName) return this.getEmptyMetadata();

    const metadata = {
      original_name: deviceName,
      parsed_info: {
        company: this.extractCompany(deviceName),
        site: this.extractSite(deviceName),
        location: this.extractLocation(deviceName),
        device_type: this.extractDeviceType(deviceName),
        equipment: this.extractEquipment(deviceName),
        network_info: this.extractNetworkInfo(host),
        serial_numbers: this.extractSerialNumbers(additionalData),
        additional_tags: this.extractTags(deviceName)
      },
      expandable_sections: this.createExpandableSections(deviceName, host, additionalData)
    };

    // Clean up empty fields
    this.cleanupMetadata(metadata);
    
    return metadata;
  }

  /**
   * Extract company/client identifier
   */
  extractCompany(deviceName) {
    for (const pattern of this.companyPatterns) {
      const match = deviceName.match(pattern);
      if (match) {
        const company = match[1].toUpperCase();
        return {
          code: company,
          full_name: this.expandCompanyName(company),
          confidence: this.getConfidenceScore(match, deviceName)
        };
      }
    }
    return null;
  }

  /**
   * Extract site/location information
   */
  extractSite(deviceName) {
    const sites = [];
    
    // Check for location patterns
    for (const pattern of this.locationPatterns) {
      const match = deviceName.match(pattern);
      if (match) {
        sites.push({
          identifier: match[1],
          type: this.classifySiteType(match[1]),
          full_match: match[0]
        });
      }
    }

    // Check for city/location names
    const cityMatch = deviceName.match(/(Anaheim|Crenshaw|Valley|Darin|Mazzoco|Comunidad)/i);
    if (cityMatch) {
      sites.push({
        identifier: cityMatch[1],
        type: 'City/Area',
        full_match: cityMatch[0]
      });
    }

    return sites.length > 0 ? sites : null;
  }

  /**
   * Extract physical location details
   */
  extractLocation(deviceName) {
    const location = {};

    // Building/floor indicators
    const buildingMatch = deviceName.match(/-(B\d+|Floor\d+|Rack\d+)/i);
    if (buildingMatch) {
      location.building = buildingMatch[1];
    }

    // Network segments
    const segmentMatch = deviceName.match(/-(DMZ|LAN|WAN|GUEST)/i);
    if (segmentMatch) {
      location.network_segment = segmentMatch[1];
    }

    return Object.keys(location).length > 0 ? location : null;
  }

  /**
   * Extract device type and classification
   */
  extractDeviceType(deviceName) {
    for (const [pattern, info] of Object.entries(this.deviceTypes)) {
      if (new RegExp(pattern, 'i').test(deviceName)) {
        return {
          abbreviation: pattern,
          type: info.type,
          category: info.category,
          confidence: 'high'
        };
      }
    }

    // Fallback pattern matching
    if (deviceName.match(/switch|sw\d+/i)) {
      return { type: 'Network Switch', category: 'Network', confidence: 'medium' };
    }
    if (deviceName.match(/server|srv\d+/i)) {
      return { type: 'Server', category: 'Server', confidence: 'medium' };
    }

    return null;
  }

  /**
   * Extract equipment vendor and model information
   */
  extractEquipment(deviceName) {
    for (const [vendor, pattern] of Object.entries(this.equipmentPatterns)) {
      if (pattern.test(deviceName)) {
        return {
          vendor: vendor,
          model: this.extractModel(deviceName, pattern),
          series: this.extractSeries(deviceName, vendor)
        };
      }
    }
    return null;
  }

  /**
   * Extract network information from host/IP
   */
  extractNetworkInfo(host) {
    if (!host || host === '127.0.0.1' || host === 'NULL') return null;

    const networkInfo = { host };

    // Classify IP ranges
    if (host.match(/^10\./)) {
      networkInfo.network_type = 'Private Class A';
      networkInfo.subnet_guess = this.guessSubnet(host);
    } else if (host.match(/^172\.(1[6-9]|2[0-9]|3[01])\./)) {
      networkInfo.network_type = 'Private Class B';
      networkInfo.subnet_guess = this.guessSubnet(host);
    } else if (host.match(/^192\.168\./)) {
      networkInfo.network_type = 'Private Class C';
      networkInfo.subnet_guess = this.guessSubnet(host);
    } else {
      networkInfo.network_type = 'Public/WAN';
    }

    return networkInfo;
  }

  /**
   * Extract serial numbers from sensor data
   */
  extractSerialNumbers(additionalData) {
    const serials = [];
    
    if (additionalData.sensors) {
      additionalData.sensors.forEach(sensor => {
        if (sensor.name && sensor.name.match(/serial/i) && sensor.last_message) {
          const serialMatch = sensor.last_message.match(/[A-Z0-9]{8,}/);
          if (serialMatch) {
            serials.push({
              component: sensor.name,
              serial: serialMatch[0],
              source: 'SNMP'
            });
          }
        }
      });
    }

    return serials.length > 0 ? serials : null;
  }

  /**
   * Extract additional tags and classifications
   */
  extractTags(deviceName) {
    const tags = [];

    // Environment indicators
    if (deviceName.match(/prod|production/i)) tags.push('Production');
    if (deviceName.match(/dev|development|test|lab/i)) tags.push('Development');
    if (deviceName.match(/stage|staging/i)) tags.push('Staging');

    // Criticality indicators
    if (deviceName.match(/core|primary|main/i)) tags.push('Critical');
    if (deviceName.match(/backup|secondary|standby/i)) tags.push('Backup');

    // Special functions
    if (deviceName.match(/monitoring|mgmt/i)) tags.push('Management');
    if (deviceName.match(/guest|visitor/i)) tags.push('Guest Network');

    return tags.length > 0 ? tags : null;
  }

  /**
   * Create expandable sections for UI
   */
  createExpandableSections(deviceName, host, additionalData) {
    return {
      technical_details: {
        label: 'Technical Details',
        icon: '⚙️',
        data: {
          device_name: deviceName,
          host_address: host,
          name_pattern: this.analyzeNamingPattern(deviceName)
        }
      },
      network_info: {
        label: 'Network Information',
        icon: '🌐',
        data: this.extractNetworkInfo(host)
      },
      equipment_specs: {
        label: 'Equipment Details',
        icon: '🔧',
        data: this.extractEquipment(deviceName)
      },
      organizational: {
        label: 'Organizational',
        icon: '🏢',
        data: {
          company: this.extractCompany(deviceName),
          site: this.extractSite(deviceName),
          tags: this.extractTags(deviceName)
        }
      }
    };
  }

  // Helper methods
  expandCompanyName(code) {
    const companyMap = {
      'ABQ': 'Albuquerque Office',
      'ANA': 'Anaheim Office', 
      'BCH': 'Beach Office',
      'BWW': 'Burbank/West Wing',
      'VEC': 'Vector/Valencia',
      'GPS': 'GPS Systems',
      'SRCO': 'Source Company',
      'TOW': 'Town Hall',
      'DEC': 'Data Center East',
      'EBA': 'East Bay Area'
    };
    return companyMap[code] || `${code} Organization`;
  }

  classifySiteType(identifier) {
    if (identifier.match(/DC\d*/i)) return 'Data Center';
    if (identifier.match(/HQ/i)) return 'Headquarters';
    if (identifier.match(/COLO/i)) return 'Colocation';
    if (identifier.match(/LAC/i)) return 'Los Angeles Campus';
    if (identifier.match(/HV/i)) return 'Hypervisor Host';
    return 'Branch Office';
  }

  guessSubnet(ip) {
    const octets = ip.split('.');
    if (octets.length >= 3) {
      return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
    }
    return null;
  }

  analyzeNamingPattern(deviceName) {
    // Determine naming convention used
    if (deviceName.match(/^[A-Z]{2,4}-/)) {
      return 'Company-Location-Device pattern';
    }
    if (deviceName.match(/^\w+-\w+-\w+/)) {
      return 'Multi-segment hyphenated pattern';
    }
    return 'Custom naming pattern';
  }

  extractModel(deviceName, pattern) {
    const match = deviceName.match(pattern);
    return match ? match[0] : null;
  }

  extractSeries(deviceName, vendor) {
    // Vendor-specific series extraction logic
    if (vendor === 'Dell') {
      const seriesMatch = deviceName.match(/(N\d{4}|S\d{4})/);
      return seriesMatch ? seriesMatch[1] + ' Series' : null;
    }
    return null;
  }

  getConfidenceScore(match, fullString) {
    // Calculate confidence based on match position and context
    if (match.index === 0) return 'high';
    if (fullString.length - match[0].length < 5) return 'medium';
    return 'low';
  }

  getEmptyMetadata() {
    return {
      original_name: '',
      parsed_info: {},
      expandable_sections: {}
    };
  }

  cleanupMetadata(metadata) {
    // Remove null/empty values recursively
    Object.keys(metadata.parsed_info).forEach(key => {
      if (!metadata.parsed_info[key]) {
        delete metadata.parsed_info[key];
      }
    });

    Object.keys(metadata.expandable_sections).forEach(section => {
      if (!metadata.expandable_sections[section].data || 
          Object.keys(metadata.expandable_sections[section].data).length === 0) {
        delete metadata.expandable_sections[section];
      }
    });
  }
}

module.exports = MetadataParser;