const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const UserSession = sequelize.define('UserSession', {
    session_id: {
      type: DataTypes.STRING(64),
      primaryKey: true,
      allowNull: false
    },
    user_id: {
      type: DataTypes.STRING(100),
      allowNull: false,
      index: true
    },
    username: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    user_role: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'user'
    },
    ip_address: {
      type: DataTypes.STRING(45), // IPv6 can be up to 45 characters
      allowNull: false
    },
    user_agent: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    login_time: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    last_activity: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Absolute session expiration time - does not reset on activity'
    },
    logout_time: {
      type: DataTypes.DATE,
      allowNull: true
    },
    session_status: {
      type: DataTypes.ENUM('active', 'expired', 'logged_out', 'terminated'),
      allowNull: false,
      defaultValue: 'active'
    },
    logout_reason: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    device_fingerprint: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    location_data: {
      type: DataTypes.JSON,
      allowNull: true
    },
    session_metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Additional EDR-like metadata: browser info, screen resolution, timezone, etc.'
    },
    security_events: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Array of security events during session'
    },
    activity_log: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'High-level activity tracking for EDR analysis'
    },
    risk_score: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: 'Calculated risk score based on behavior'
    },
    anomaly_flags: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Detected anomalies during session'
    }
  }, {
    tableName: 'user_sessions',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['user_id'] },
      { fields: ['session_status'] },
      { fields: ['login_time'] },
      { fields: ['last_activity'] },
      { fields: ['ip_address'] },
      { fields: ['risk_score'] }
    ]
  });

  return UserSession;
};