const express = require('express');
const cors = require('cors');
const config = require('./config');
const connectDB = require('./config/db');
const healthRoutes = require('./routes/healthRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const dockerRoutes = require('./routes/dockerRoutes');
const { syncFromDocker } = require('./services/instanceSyncService');

const app = express();

// Middleware
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/docker', dockerRoutes);

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

  // Initial sync so the dashboard shows real instances right away.
  // Not awaited and never fatal: the backend works even if Docker is down.
  syncFromDocker()
    .then((s) => console.log('[Sync] Docker -> MongoDB:', JSON.stringify(s)))
    .catch((err) => console.warn(`[Sync] skipped: ${err.message}`));
}

start();