const express = require('express');
const cors = require('cors');
const config = require('./config');
const connectDB = require('./config/db');
const healthRoutes = require('./routes/healthRoutes');

const app = express();

// Middleware
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

// Routes
app.use('/api/health', healthRoutes);

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  await connectDB();
  app.listen(config.port, () => {
    console.log(`[CloudResQ] Backend running on http://localhost:${config.port}`);
  });
}

start();