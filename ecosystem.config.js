module.exports = {
  apps: [
    {
      name: 'invoicesmart-backend',
      script: './dist/index.js',
      cwd: '/root/InvoiceSmart-backend',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3008,
      },
      env_file: '.env',
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_memory_restart: '512M',
      restart_delay: 3000,
      min_uptime: '10s',
      max_restarts: 10,
      autorestart: true,
      kill_timeout: 5000,
      listen_timeout: 10000,
      source_map_support: false,
    },
  ],
};
