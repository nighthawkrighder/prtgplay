// Quick test script to check PRTG API response format
console.log('Starting PRTG API test...');

const PRTGClient = require('./src/services/prtgClient');

async function testPRTGAPI() {
  try {
    console.log('Loading config...');
    const config = require('./src/config');

    // Get the first PRTG server config
    const serverConfigs = config.prtg.servers;
    if (!serverConfigs || serverConfigs.length === 0) {
      console.log('No PRTG servers configured');
      return;
    }

    const serverConfig = serverConfigs[0];
    console.log(`Testing PRTG API for server: ${serverConfig.url}`);

    const client = new PRTGClient(serverConfig.url, serverConfig.username, serverConfig.passhash);

    // Test devices API
    console.log('\n=== Testing Devices API ===');
    const devicesData = await client.request('/api/table.json', {
      content: 'devices',
      output: 'json',
      columns: 'objid,device,host,devicetype,status,message,priority,lastvalue'
    });

    console.log('Sample device objects:');
    if (devicesData && devicesData.devices && devicesData.devices.length > 0) {
      console.log(JSON.stringify(devicesData.devices.slice(0, 3), null, 2));
    } else {
      console.log('No devices data returned');
      console.log('Full response:', JSON.stringify(devicesData, null, 2));
    }

    // Test sensors API
    console.log('\n=== Testing Sensors API ===');
    const sensorsData = await client.request('/api/table.json', {
      content: 'sensors',
      output: 'json',
      columns: 'objid,device,deviceid,sensor,type,status,message,priority,lastvalue,lastcheck'
    });

    console.log('Sample sensor objects:');
    if (sensorsData && sensorsData.sensors && sensorsData.sensors.length > 0) {
      console.log(JSON.stringify(sensorsData.sensors.slice(0, 3), null, 2));
    } else {
      console.log('No sensors data returned');
      console.log('Full response:', JSON.stringify(sensorsData, null, 2));
    }

  } catch (error) {
    console.error('Error testing PRTG API:', error);
  }
}

testPRTGAPI().then(() => {
  console.log('Test completed');
  process.exit(0);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});