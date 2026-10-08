const express = require('express');
const metrics = require('./metrics');
const simulation = require('./simulation');

const INSTANCE_ID = process.env.INSTANCE_ID || 'app-1';
const PORT = parseInt(process.env.PORT, 10) || 3000;

const app = express();
app.use(express.json());

// Measure every request: response time and status code.
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    metrics.recordRequest(durationMs, res.statusCode);
  });
  next();
});

// Simulated slowness: delays normal requests (never the /simulate/* controls).
app.use((req, res, next) => {
  const ms = simulation.state.latencyMs;
  if (!ms || req.path.startsWith('/simulate')) return next();
  setTimeout(next, ms);
});

const now = () => new Date().toISOString();

// ---------- Normal endpoints ----------

app.get('/', (req, res) => {
  res.json({ message: `Hello from CloudResQ demo app`, service: INSTANCE_ID, timestamp: now() });
});

// Health endpoint: this is what the CloudResQ Health Monitor will call every 5 seconds.
app.get('/health', (req, res) => {
  if (simulation.state.failMode) {
    return res.status(503).json({
      status: 'unhealthy',
      service: INSTANCE_ID,
      reason: 'Failure simulation enabled',
      timestamp: now(),
    });
  }
  res.json({ status: 'healthy', service: INSTANCE_ID, timestamp: now() });
});

// Detailed metrics. Still answers while failMode is on, so the monitor can see the
// instance is alive but unhealthy (different from a crashed container).
app.get('/api/status', (req, res) => {
  res.json({
    service: INSTANCE_ID,
    timestamp: now(),
    simulation: simulation.status(),
    ...metrics.snapshot(),
  });
});

// ---------- Failure simulation ----------

app.post('/simulate/failure', (req, res) => {
  simulation.setFailMode(true);
  res.json({ message: `${INSTANCE_ID}: /health will now return 503`, ...simulation.status() });
});

app.post('/simulate/recovery', (req, res) => {
  simulation.resetAll();
  res.json({ message: `${INSTANCE_ID}: all simulated failures cleared`, ...simulation.status() });
});

app.post('/simulate/cpu', (req, res) => {
  const seconds = Number(req.body?.seconds) || 60;
  simulation.startCpuLoad(seconds);
  res.json({ message: `${INSTANCE_ID}: CPU load for ${seconds}s`, ...simulation.status() });
});

app.post('/simulate/memory', (req, res) => {
  const mb = Number(req.body?.mb) || 210;
  const allocated = simulation.startMemoryLoad(mb);
  res.json({ message: `${INSTANCE_ID}: allocated ${allocated} MB`, ...simulation.status() });
});

app.post('/simulate/latency', (req, res) => {
  // capped at 2500 ms so it stays under the monitor's 3 s timeout
  const ms = Math.min(Number(req.body?.ms) || 800, 2500);
  simulation.setLatency(ms);
  res.json({ message: `${INSTANCE_ID}: adding ${ms} ms delay to requests`, ...simulation.status() });
});

// Crash: the process exits, which stops the container (CONTAINER_DOWN).
app.post('/simulate/crash', (req, res) => {
  res.json({ message: `${INSTANCE_ID}: crashing in 200 ms` });
  setTimeout(() => process.exit(1), 200);
});

// Unknown routes
app.use((req, res) => res.status(404).json({ error: 'Not found', service: INSTANCE_ID }));

app.listen(PORT, () => {
  console.log(`[${INSTANCE_ID}] listening on port ${PORT} (failMode=${simulation.state.failMode})`);
});