const mongoose = require('mongoose');

// Maps mongoose's numeric readyState to a readable string.
const DB_STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

exports.getHealth = (req, res) => {
  const dbState = DB_STATES[mongoose.connection.readyState] || 'unknown';

  res.status(200).json({
    status: 'ok',
    service: 'cloudresq-backend',
    mongodb: dbState,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
};