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

    detection: {
    cpuThreshold: parseFloat(process.env.CPU_SCALE_OUT_THRESHOLD) || 85,
    memoryThreshold: parseFloat(process.env.MEMORY_SCALE_OUT_THRESHOLD) || 85,
    latencyThresholdMs: parseInt(process.env.LATENCY_THRESHOLD_MS, 10) || 500,
    errorRateThreshold: parseFloat(process.env.ERROR_RATE_THRESHOLD) || 50, // percent of 5xx
    minRequestsForErrorRate: parseInt(process.env.MIN_REQUESTS_FOR_ERROR_RATE, 10) || 10,

    // How long a condition must hold (as a window average) before it counts as a failure
    cpuSustainSeconds: parseInt(process.env.CPU_SUSTAIN_SECONDS, 10) || 60,
    memorySustainSeconds: parseInt(process.env.MEMORY_SUSTAIN_SECONDS, 10) || 60,
    latencySustainSeconds: parseInt(process.env.LATENCY_SUSTAIN_SECONDS, 10) || 30,
    errorRateSustainSeconds: parseInt(process.env.ERROR_RATE_SUSTAIN_SECONDS, 10) || 15,

    // REPEATED_FAILURE: N availability failures within M minutes
    repeatedFailureCount: parseInt(process.env.REPEATED_FAILURE_COUNT, 10) || 3,
    repeatedFailureWindowMinutes: parseInt(process.env.REPEATED_FAILURE_WINDOW_MINUTES, 10) || 10,
  },
    decision: {
    maxRestartsBeforeReplacement: parseInt(process.env.MAX_RESTARTS_BEFORE_REPLACEMENT, 10) || 3,
    cpuScaleInThreshold: parseFloat(process.env.CPU_SCALE_IN_THRESHOLD) || 20,
    minimumReplicas: parseInt(process.env.MIN_REPLICAS, 10) || 2,
    maximumReplicas: parseInt(process.env.MAX_REPLICAS, 10) || 5,
  },
};