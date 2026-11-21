// Prometheus metrics of this instance, served on GET /metrics.
const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'cloudresq_app_' });

const requests = new client.Counter({
  name: 'cloudresq_requests_total',
  help: 'HTTP requests handled by this instance',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});
const errors = new client.Counter({
  name: 'cloudresq_errors_total',
  help: 'HTTP responses with status 5xx from this instance',
  labelNames: ['route'],
  registers: [register],
});
const duration = new client.Histogram({
  name: 'cloudresq_request_duration_seconds',
  help: 'Response time of this instance in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// Called once per finished request. The route is the Express route pattern, so labels stay few.
function observeRequest(req, res, seconds) {
  const route = req.route ? req.route.path : 'unmatched';
  requests.inc({ method: req.method, route, status: String(res.statusCode) });
  duration.observe({ method: req.method, route }, seconds);
  if (res.statusCode >= 500) errors.inc({ route });
}

module.exports = { register, observeRequest };