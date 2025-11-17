const path = require('path');
const { Device, Sensor } = require(path.join(__dirname, 'src', 'models'));

async function checkStatuses() {
    try {
        const deviceStatuses = await Device.findAll({
            attributes: [
                'status',
                [require('sequelize').fn('COUNT', '*'), 'count']
            ],
            group: ['status'],
            raw: true
        });
        
        console.log('\n=== DEVICE STATUS COUNTS ===');
        deviceStatuses.forEach(row => {
            const statusMap = { 1: 'Unknown', 3: 'Up', 4: 'Warning', 5: 'Down', 7: 'Paused', 10: 'Unusual' };
            console.log(`${statusMap[row.status] || 'Other'} (${row.status}): ${row.count} devices`);
        });
        
        const sensorStatuses = await Sensor.findAll({
            attributes: [
                'status',
                [require('sequelize').fn('COUNT', '*'), 'count']
            ],
            group: ['status'],
            raw: true
        });
        
        console.log('\n=== SENSOR STATUS COUNTS ===');
        sensorStatuses.forEach(row => {
            const statusMap = { 1: 'Unknown', 3: 'Up', 4: 'Warning', 5: 'Down', 7: 'Paused', 10: 'Unusual' };
            console.log(`${statusMap[row.status] || 'Other'} (${row.status}): ${row.count} sensors`);
        });
        
        console.log('\n');
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkStatuses();
