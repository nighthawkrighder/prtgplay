#!/usr/bin/env node
/**
 * Check specific session status
 */

const { sequelize } = require('../src/config/database');
const { UserSession } = require('../src/models');

async function checkSession(sessionId) {
  try {
    await sequelize.authenticate();
    
    const session = await UserSession.findByPk(sessionId);
    
    if (!session) {
      console.log(`Session ${sessionId} not found`);
      return;
    }

    console.log('\n📊 Session Details:\n');
    console.log(`Session ID: ${session.session_id}`);
    console.log(`Username: ${session.username}`);
    console.log(`Status: ${session.session_status}`);
    console.log(`Login Time: ${session.login_time}`);
    console.log(`Last Activity: ${session.last_activity}`);
    console.log(`Logout Time: ${session.logout_time || 'N/A'}`);
    console.log(`Logout Reason: ${session.logout_reason || 'N/A'}`);
    console.log(`IP Address: ${session.ip_address}`);
    console.log(`User Agent: ${session.user_agent}`);
    console.log('');

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await sequelize.close();
  }
}

const sessionId = process.argv[2] || '5341545e5c2eaf7febbf0547de862c1db2ef1ac9be1ac12b229310d21823b6a2';
checkSession(sessionId);
