const mongoose = require('mongoose');
const dockerManager = require('../docker/dockerManager');
const healthMonitor = require('../monitoring/healthMonitor');
const eventBus = require('../events/eventBus');

const DB_STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

exports.getHealth = async (req, res) => {
  const dbState = DB_STATES[mongoose.connection.readyState] || 'unknown';
  const dockerUp = await dockerManager.ping();
  const events = eventBus.getStatus();

  res.status(200).json({
    status: 'ok',
    service: 'cloudresq-backend',
    mongodb: dbState,
    docker: dockerUp ? 'connected' : 'unreachable',
    monitor: healthMonitor.getStatus().running ? 'running' : 'stopped',
    redis: !events.enabled ? 'disabled' : events.connected ? 'connected' : 'unreachable',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
};