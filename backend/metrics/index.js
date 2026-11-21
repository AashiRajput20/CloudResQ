// Prometheus metrics for CloudResQ.
//  - Counters (failures, recoveries, scaling) are fed by the event bus, so no other module needs changing.
//  - Gauges (CPU, memory, replicas ...) are read from MongoDB at scrape time.
// Metrics must never break the system: every listener and collector is wrapped in try/catch.
const client = require('prom-client');
const mongoose = require('mongoose');
const eventBus = require('../events/eventBus');
const Service = require('../models/Service');
const Instance = require('../models/Instance');
const { slugify } = require('../services/serviceRegistry');

const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'cloudresq_backend_' });

const FAILURE_TYPES = [
  'CONTAINER_DOWN', 'HEALTH_CHECK_FAILED', 'HIGH_CPU', 'HIGH_MEMORY',
  'HIGH_LATENCY', 'HIGH_ERROR_RATE', 'REPEATED_FAILURE',
];
const RECOVERY_ACTIONS = ['RESTART', 'REPLACE'];
const SCALING_ACTIONS = ['SCALE_OUT', 'SCALE_IN'];
const RESULTS = ['SUCCESS', 'FAILED'];
const ACTIVE_STATUSES = ['HEALTHY', 'WARNING', 'RECOVERED']; // these receive traffic (if inTraffic)
const HEALTHY_STATUSES = ['HEALTHY', 'RECOVERED'];

// ---------- counters, fed by the event bus ----------

const failures = new client.Counter({
  name: 'cloudresq_failures_total',
  help: 'Failures detected by the Failure Detector',
  labelNames: ['type'],
  registers: [register],
});
const recoveries = new client.Counter({
  name: 'cloudresq_recoveries_total',
  help: 'Recovery actions (restart or replace) finished by the Recovery Controller',
  labelNames: ['action', 'status'],
  registers: [register],
});
const recoveryDuration = new client.Histogram({
  name: 'cloudresq_recovery_duration_seconds',
  help: 'Time taken by successful recoveries',
  labelNames: ['action'],
  buckets: [1, 2, 3, 5, 8, 13, 20, 30, 60],
  registers: [register],
});
const scaling = new client.Counter({
  name: 'cloudresq_scaling_events_total',
  help: 'Scaling actions finished by the Scaling Controller',
  labelNames: ['action', 'status'],
  registers: [register],
});

// Start every series at 0, so dashboards show 0 instead of "no data".
for (const type of FAILURE_TYPES) failures.inc({ type }, 0);
for (const action of RECOVERY_ACTIONS) {
  for (const status of RESULTS) recoveries.inc({ action, status }, 0);
  if (typeof recoveryDuration.zero === 'function') recoveryDuration.zero({ action });
}
for (const action of SCALING_ACTIONS) for (const status of RESULTS) scaling.inc({ action, status }, 0);

const safe = (fn) => (event) => {
  try { fn(event); } catch { /* metrics must never break the system */ }
};

eventBus.local.on('health.failure', safe((e) => failures.inc({ type: e.failureType })));
eventBus.local.on('recovery.completed', safe((e) => {
  recoveries.inc({ action: e.action, status: e.status });
  // Only successful recoveries count towards recovery time, like the Analytics page.
  if (e.status === 'SUCCESS' && typeof e.duration === 'number') recoveryDuration.observe({ action: e.action }, e.duration);
}));
eventBus.local.on('scaling.completed', safe((e) => scaling.inc({ action: e.action, status: e.status })));

// ---------- the backend's own API traffic ----------

const apiRequests = new client.Counter({
  name: 'cloudresq_api_requests_total',
  help: 'HTTP requests handled by the CloudResQ backend API',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});
const apiDuration = new client.Histogram({
  name: 'cloudresq_api_request_duration_seconds',
  help: 'Response time of the CloudResQ backend API',
  labelNames: ['method', 'route'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

const SKIP_PATHS = ['/metrics', '/api/prometheus/targets']; // Prometheus's own calls are not "traffic"

function apiMiddleware(req, res, next) {
  if (SKIP_PATHS.includes(req.path)) return next();
  const stop = apiDuration.startTimer();
  res.on('finish', () => {
    try {
      const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
      apiRequests.inc({ method: req.method, route, status: String(res.statusCode) });
      stop({ method: req.method, route });
    } catch { /* ignore */ }
  });
  next();
}

// ---------- gauges, read from MongoDB when Prometheus scrapes ----------

const EMPTY = { services: [], instances: [] };
let cached = { at: 0, promise: null };

async function load() {
  if (mongoose.connection.readyState !== 1) return EMPTY; // database not connected: no gauge values
  try {
    const [services, instances] = await Promise.all([Service.find().lean(), Instance.find().lean()]);
    const slugById = new Map(services.map((s) => [String(s._id), slugify(s.name)]));
    return {
      services: services.map((s) => ({ ...s, slug: slugify(s.name) })),
      instances: instances.map((i) => ({ ...i, slug: slugById.get(String(i.serviceId)) || 'unknown' })),
    };
  } catch {
    return EMPTY;
  }
}

// One database read serves all gauges of a scrape.
function snapshot() {
  const now = Date.now();
  if (!cached.promise || now - cached.at > 1000) cached = { at: now, promise: load() };
  return cached.promise;
}

// A gauge whose labelled values are rebuilt from the snapshot on every scrape
// (reset() makes removed instances disappear instead of staying at their last value).
function gauge(name, help, labelNames, rows) {
  return new client.Gauge({
    name, help, labelNames, registers: [register],
    async collect() {
      this.reset();
      const snap = await snapshot();
      for (const row of rows(snap)) this.set(row.labels, row.value);
    },
  });
}

const perInstance = (pick) => (snap) => snap.instances
  .filter((i) => pick(i) != null)
  .map((i) => ({ labels: { service: i.slug, instance: i.instanceName }, value: pick(i) }));

const perService = (pick) => (snap) => snap.services
  .map((s) => ({ labels: { service: s.slug }, value: pick(s, snap) }));

const L = ['service', 'instance'];
gauge('cloudresq_cpu_usage', 'CPU usage of an instance, percent of its container CPU limit', L, perInstance((i) => i.cpuUsage));
gauge('cloudresq_memory_usage', 'Memory usage of an instance, percent of its container memory limit', L, perInstance((i) => i.memoryUsage));
gauge('cloudresq_response_time_ms', 'Response time of the last health check, in milliseconds', L, perInstance((i) => i.responseTimeMs));
gauge('cloudresq_instance_healthy', '1 if the instance is HEALTHY or RECOVERED, otherwise 0', L,
  perInstance((i) => (HEALTHY_STATUSES.includes(i.status) ? 1 : 0)));
gauge('cloudresq_instance_in_traffic', '1 if the instance is flagged as part of the traffic pool', L,
  perInstance((i) => (i.inTraffic === false ? 0 : 1)));
gauge('cloudresq_instance_restart_count', 'Restarts of the instance performed by CloudResQ', L,
  perInstance((i) => i.restartCount || 0));

const S = ['service'];
gauge('cloudresq_active_instances', 'Instances currently able to receive traffic', S,
  perService((s, snap) => snap.instances.filter((i) => i.slug === s.slug && ACTIVE_STATUSES.includes(i.status) && i.inTraffic !== false).length));
gauge('cloudresq_current_replicas', 'Running replicas of the service', S, perService((s) => s.currentReplicas || 0));
gauge('cloudresq_desired_replicas', 'Desired replicas of the service', S, perService((s) => s.desiredReplicas || 0));
gauge('cloudresq_min_replicas', 'Minimum replicas allowed for the service', S, perService((s) => s.minimumReplicas || 0));
gauge('cloudresq_max_replicas', 'Maximum replicas allowed for the service', S, perService((s) => s.maximumReplicas || 0));

new client.Gauge({
  name: 'cloudresq_monitor_cycles',
  help: 'Health monitor cycles completed since the backend started',
  registers: [register],
  collect() {
    try {
      this.set(require('../monitoring/healthMonitor').getStatus().cycles); // loaded lazily to avoid a require cycle
    } catch { /* monitor not loaded */ }
  },
});

module.exports = { register, apiMiddleware };