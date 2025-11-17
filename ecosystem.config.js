module.exports = {
  apps: [{
    name: 'prtg-dashboard',
    script: './src/server.js',
    cwd: '/srv/www/htdocs/cva/cpm',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3010
    },
    error_file: './logs/prtg-dashboard-error.log',
    out_file: './logs/prtg-dashboard-out.log',
    log_file: './logs/prtg-dashboard-combined.log',
    time: true,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    node_args: '--max-old-space-size=2048',
    restart_delay: 4000,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};