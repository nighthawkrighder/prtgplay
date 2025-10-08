const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const DeviceMetadata = sequelize.define('DeviceMetadata', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    device_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      references: {
        model: 'devices',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },
    
    // Company/Client Information
    company_code: {
      type: DataTypes.STRING(10),
      allowNull: true,
      comment: 'Extracted company/client code (e.g., ABQ, ANA, VEC)'
    },
    company_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Full company/client name'
    },
    company_confidence: {
      type: DataTypes.ENUM('high', 'medium', 'low'),
      allowNull: true,
      comment: 'Confidence level of company extraction'
    },
    
    // Site/Location Information
    site_identifier: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Site code or identifier (e.g., DC, HQ, LAC)'
    },
    site_type: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Type of site (Data Center, Headquarters, Branch Office, etc.)'
    },
    site_location: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Physical location or city'
    },
    
    // Device Classification
    device_category: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Device category (Server, Network, Security, Storage, etc.)'
    },
    device_type_full: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Full device type description'
    },
    device_function: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Primary function of the device'
    },
    
    // Equipment Details
    vendor: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Equipment vendor (Dell, Cisco, Fortinet, etc.)'
    },
    model: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Equipment model number'
    },
    series: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Equipment series or family'
    },
    
    // Network Information
    network_segment: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Network segment (DMZ, LAN, WAN, GUEST, etc.)'
    },
    subnet_info: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Subnet information'
    },
    network_role: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Role in network (Core, Access, Distribution, etc.)'
    },
    
    // Environment and Tags
    environment: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Environment type (Production, Development, Test, etc.)'
    },
    criticality: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Criticality level (Critical, Standard, Low, etc.)'
    },
    tags: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'JSON array of additional tags'
    },
    
    // Raw extracted data for expandable sections
    raw_metadata: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Complete parsed metadata as JSON for expandable UI sections'
    },
    
    // Processing information
    naming_pattern: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Identified naming convention pattern'
    },
    extraction_confidence: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      comment: 'Overall confidence score for metadata extraction (0.00-1.00)'
    },
    last_parsed: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
      comment: 'When metadata was last extracted/updated'
    }
  }, {
    tableName: 'device_metadata',
    timestamps: true,
    indexes: [
      {
        fields: ['company_code']
      },
      {
        fields: ['site_identifier']
      },
      {
        fields: ['device_category']
      },
      {
        fields: ['vendor']
      },
      {
        fields: ['environment']
      },
      {
        fields: ['criticality']
      }
    ]
  });

  return DeviceMetadata;
};