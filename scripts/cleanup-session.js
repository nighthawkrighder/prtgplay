#!/usr/bin/env node
/**
 * Manual Session Cleanup Script
 * 
 * Usage:
 *   node scripts/cleanup-session.js <session-id>
 *   node scripts/cleanup-session.js --all-logged-out
 *   node scripts/cleanup-session.js --expired
 * 
 * Examples:
 *   node scripts/cleanup-session.js 59
 *   node scripts/cleanup-session.js --all-logged-out
 */

const path = require('path');
const { sequelize } = require('../src/config/database');
const { UserSession } = require('../src/models');
const logger = require('../src/utils/logger');

async function cleanupSession(sessionId) {
  try {
    console.log(`\n🔍 Looking for session: ${sessionId}...`);
    
    const session = await UserSession.findByPk(sessionId);
    
    if (!session) {
      console.log(`❌ Session ${sessionId} not found in database`);
      return false;
    }

    console.log(`\n📊 Session Details:`);
    console.log(`   User: ${session.username}`);
    console.log(`   Status: ${session.session_status}`);
    console.log(`   Login Time: ${session.login_time}`);
    console.log(`   Last Activity: ${session.last_activity}`);
    console.log(`   Logout Time: ${session.logout_time || 'N/A'}`);
    console.log(`   IP Address: ${session.ip_address}`);

    // Update to logged_out if still active
    if (session.session_status === 'active') {
      await session.update({
        session_status: 'logged_out',
        logout_time: new Date(),
        logout_reason: 'manual_cleanup'
      });
      console.log(`\n✅ Session ${sessionId} marked as logged_out`);
    } else {
      console.log(`\n✅ Session ${sessionId} already in ${session.session_status} state`);
    }

    return true;

  } catch (error) {
    console.error(`❌ Error cleaning up session ${sessionId}:`, error.message);
    return false;
  }
}

async function cleanupAllLoggedOut() {
  try {
    console.log(`\n🔍 Finding all logged_out sessions...`);
    
    const count = await UserSession.count({
      where: { session_status: 'logged_out' }
    });

    console.log(`Found ${count} logged_out session(s)`);

    if (count > 0) {
      const deleted = await UserSession.destroy({
        where: { session_status: 'logged_out' }
      });
      console.log(`✅ Deleted ${deleted} logged_out session(s)`);
    } else {
      console.log(`✅ No logged_out sessions to clean up`);
    }

    return true;

  } catch (error) {
    console.error(`❌ Error cleaning up logged_out sessions:`, error.message);
    return false;
  }
}

async function cleanupExpired() {
  try {
    console.log(`\n🔍 Finding all expired sessions...`);
    
    const count = await UserSession.count({
      where: { session_status: 'expired' }
    });

    console.log(`Found ${count} expired session(s)`);

    if (count > 0) {
      const deleted = await UserSession.destroy({
        where: { session_status: 'expired' }
      });
      console.log(`✅ Deleted ${deleted} expired session(s)`);
    } else {
      console.log(`✅ No expired sessions to clean up`);
    }

    return true;

  } catch (error) {
    console.error(`❌ Error cleaning up expired sessions:`, error.message);
    return false;
  }
}

async function listAllSessions() {
  try {
    const sessions = await UserSession.findAll({
      order: [['login_time', 'DESC']],
      limit: 50
    });

    console.log(`\n📋 Recent Sessions (last 50):\n`);
    console.log(`${'ID'.padEnd(40)} | ${'Username'.padEnd(20)} | ${'Status'.padEnd(12)} | ${'Last Activity'.padEnd(20)}`);
    console.log('-'.repeat(100));

    sessions.forEach(s => {
      const id = String(s.session_id).padEnd(40);
      const user = String(s.username).padEnd(20);
      const status = String(s.session_status).padEnd(12);
      const lastActivity = new Date(s.last_activity).toISOString().replace('T', ' ').substring(0, 19).padEnd(20);
      console.log(`${id} | ${user} | ${status} | ${lastActivity}`);
    });

    console.log(`\n📊 Summary:`);
    const active = sessions.filter(s => s.session_status === 'active').length;
    const loggedOut = sessions.filter(s => s.session_status === 'logged_out').length;
    const expired = sessions.filter(s => s.session_status === 'expired').length;
    console.log(`   Active: ${active}`);
    console.log(`   Logged Out: ${loggedOut}`);
    console.log(`   Expired: ${expired}`);

  } catch (error) {
    console.error(`❌ Error listing sessions:`, error.message);
  }
}

async function main() {
  console.log(`\n🔧 Session Cleanup Utility\n`);

  try {
    // Test database connection
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');

    const args = process.argv.slice(2);

    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
      console.log(`Usage:`);
      console.log(`  node scripts/cleanup-session.js <session-id>          - Cleanup specific session`);
      console.log(`  node scripts/cleanup-session.js --all-logged-out      - Delete all logged_out sessions`);
      console.log(`  node scripts/cleanup-session.js --expired             - Delete all expired sessions`);
      console.log(`  node scripts/cleanup-session.js --list                - List all recent sessions`);
      console.log(`  node scripts/cleanup-session.js --help                - Show this help\n`);
      process.exit(0);
    }

    const command = args[0];

    if (command === '--list') {
      await listAllSessions();
    } else if (command === '--all-logged-out') {
      await cleanupAllLoggedOut();
    } else if (command === '--expired') {
      await cleanupExpired();
    } else {
      // Assume it's a session ID
      await cleanupSession(command);
    }

    console.log(`\n✅ Cleanup complete\n`);

  } catch (error) {
    console.error(`\n❌ Fatal error:`, error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { cleanupSession, cleanupAllLoggedOut, cleanupExpired };
