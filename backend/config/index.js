// Central place for all configuration. No other file should read process.env directly.
require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 5000,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/cloudresq',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',

  docker: {
    // Leave empty to use the default (Windows named pipe / Linux socket).
    socketPath: process.env.DOCKER_SOCKET || undefined,
    image: process.env.DEMO_APP_IMAGE || 'cloudresq-app',
    network: process.env.DOCKER_NETWORK || 'cloudresq-net',
    containerPort: parseInt(process.env.APP_CONTAINER_PORT, 10) || 3000,
    healthHost: process.env.HEALTH_HOST || '127.0.0.1',
    healthTimeoutMs: parseInt(process.env.HEALTH_TIMEOUT_MS, 10) || 3000,
    memoryLimitMB: parseInt(process.env.APP_MEMORY_LIMIT_MB, 10) || 256,
    cpuLimit: parseFloat(process.env.APP_CPU_LIMIT) || 1.0,
    stopTimeoutSec: parseInt(process.env.STOP_TIMEOUT_SEC, 10) || 5,
  },

  monitor: {
    enabled: process.env.MONITOR_ENABLED !== 'false', // set MONITOR_ENABLED=false to pause it
    intervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL, 10) || 5000,
    failureThreshold: parseInt(process.env.FAILURE_THRESHOLD, 10) || 3,
    historyHours: parseInt(process.env.HEALTH_HISTORY_HOURS, 10) || 24,
  },
};