#!/usr/bin/env node

/**
 * Database Migration: Add expires_at column to user_sessions table
 * 
 * This script adds the expires_at column and populates it for existing active sessions
 * based on their last_activity + session timeout (24 hours by default)
 */

const { sequelize, UserSession } = require('../src/models');
const logger = require('../src/utils/logger');

async function migrate() {
    try {
        logger.info('🔄 Starting migration: Add expires_at column to user_sessions');

        // Add the column if it doesn't exist
        const queryInterface = sequelize.getQueryInterface();
        const tableDescription = await queryInterface.describeTable('user_sessions');
        
        if (!tableDescription.expires_at) {
            logger.info('📝 Adding expires_at column...');
            await queryInterface.addColumn('user_sessions', 'expires_at', {
                type: sequelize.Sequelize.DATE,
                allowNull: true,
                comment: 'Absolute session expiration time - does not reset on activity'
            });
            logger.info('✅ Column added successfully');
        } else {
            logger.info('ℹ️  Column expires_at already exists, skipping creation');
        }

        // Update existing active sessions
        const sessionTimeout = parseInt(process.env.USER_SESSION_RETENTION_HOURS || '24', 10) * 60 * 60 * 1000;
        
        logger.info('🔄 Updating existing active sessions...');
        const activeSessions = await UserSession.findAll({
            where: {
                session_status: 'active',
                expires_at: null
            }
        });

        let updated = 0;
        for (const session of activeSessions) {
            // Set expires_at based on last_activity + timeout
            const lastActivity = new Date(session.last_activity);
            const expiresAt = new Date(lastActivity.getTime() + sessionTimeout);
            
            await session.update({ expires_at: expiresAt });
            updated++;
        }

        logger.info(`✅ Migration complete: Updated ${updated} active sessions`);
        logger.info('📊 Summary:');
        logger.info(`   - Session timeout: ${sessionTimeout / (60 * 60 * 1000)} hours`);
        logger.info(`   - Active sessions updated: ${updated}`);

    } catch (error) {
        logger.error('❌ Migration failed:', { error: error.message, stack: error.stack });
        throw error;
    } finally {
        await sequelize.close();
    }
}

// Run migration
migrate()
    .then(() => {
        console.log('\n✅ Migration completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Migration failed:', error.message);
        process.exit(1);
    });
