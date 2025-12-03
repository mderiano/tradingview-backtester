module.exports = {
  apps: [{
    name: 'tv-backtester',
    script: 'server.js',
    node_args: '--max-old-space-size=3072',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '3G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};
