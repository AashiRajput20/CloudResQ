const express = require('express');
const cors = require('cors');
const config = require('./config');
const connectDB = require('./config/db');
const healthRoutes = require('./routes/healthRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const dockerRoutes = require('./routes/dockerRoutes');
const monitorRoutes = require('./routes/monitorRoutes');
const healthMonitor = require('./monitoring/healthMonitor');

const app = express();

// Middleware
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/docker', dockerRoutes);
app.use('/api', monitorRoutes);

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ error: messages.join('; ') });
  }
  if (err.code === 11000) {
    return res.status(409).json({ error: 'A record with that name already exists' });
  }
  console.error('[Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  await connectDB();
  app.listen(config.port, () => {
    console.log(`[CloudResQ] Backend running on http://localhost:${config.port}`);
  });

  // The monitor never crashes the backend: errors are caught inside its loop.
  if (config.monitor.enabled) healthMonitor.start();
  else console.log('[Monitor] disabled (MONITOR_ENABLED=false)');
}

start();