// Unit tests for the Prometheus metrics and service discovery (no Docker, MongoDB or Redis needed). Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const bus = require('../events/eventBus');
const metrics = require('../metrics');
const { buildTargets } = require('../metrics/promTargets');

const scrape = () => metrics.register.metrics();

test('the event bus has in-process listeners (the metrics depend on them)', () => {
  assert.equal(typeof bus.local.on, 'function');
});

test('counters start at 0, so Grafana shows 0 instead of "no data"', async () => {
  const out = await scrape();
  assert.match(out, /cloudresq_failures_total\{type="CONTAINER_DOWN"\} 0/);
  assert.match(out, /cloudresq_recoveries_total\{action="REPLACE",status="FAILED"\} 0/);
  assert.match(out, /cloudresq_scaling_events_total\{action="SCALE_OUT",status="SUCCESS"\} 0/);
});

test('a health.failure event increases cloudresq_failures_total for its type', async () => {
  bus.publish('health.failure', { instance: 'app-2', failureType: 'HIGH_CPU' });
  assert.match(await scrape(), /cloudresq_failures_total\{type="HIGH_CPU"\} 1/);
});

test('a successful recovery is counted and its duration observed', async () => {
  bus.publish('recovery.completed', { instance: 'app-2', action: 'RESTART', status: 'SUCCESS', duration: 2.5 });
  const out = await scrape();
  assert.match(out, /cloudresq_recoveries_total\{action="RESTART",status="SUCCESS"\} 1/);
  assert.match(out, /cloudresq_recovery_duration_seconds_count\{action="RESTART"\} 1/);
  assert.match(out, /cloudresq_recovery_duration_seconds_sum\{action="RESTART"\} 2\.5/);
});

test('a failed recovery is counted but its duration is not observed', async () => {
  bus.publish('recovery.completed', { instance: 'app-2', action: 'REPLACE', status: 'FAILED', duration: 15 });
  const out = await scrape();
  assert.match(out, /cloudresq_recoveries_total\{action="REPLACE",status="FAILED"\} 1/);
  assert.match(out, /cloudresq_recovery_duration_seconds_count\{action="REPLACE"\} 0/);
});

test('a scaling.completed event increases cloudresq_scaling_events_total', async () => {
  bus.publish('scaling.completed', { action: 'SCALE_OUT', status: 'SUCCESS', previousReplicas: 3, newReplicas: 4 });
  assert.match(await scrape(), /cloudresq_scaling_events_total\{action="SCALE_OUT",status="SUCCESS"\} 1/);
});

test('the API middleware counts requests by route pattern and ignores /metrics', async () => {
  const run = (req) => {
    const res = new EventEmitter();
    res.statusCode = 200;
    metrics.apiMiddleware(req, res, () => {});
    res.emit('finish');
  };
  run({ path: '/api/instances/abc/restart', method: 'POST', baseUrl: '/api/instances', route: { path: '/:id/restart' } });
  run({ path: '/metrics', method: 'GET', baseUrl: '', route: { path: '/metrics' } });
  const out = await scrape();
  assert.match(out, /cloudresq_api_requests_total\{method="POST",route="\/api\/instances\/:id\/restart",status="200"\} 1/);
  assert.doesNotMatch(out, /route="\/metrics"/);
});

test('service discovery lists only running containers, reached by name on the Docker network', () => {
  const targets = buildTargets([
    { name: 'cloudresq-app-1', instanceName: 'app-1', serviceLabel: 'demo-service', state: 'running' },
    { name: 'cloudresq-app-2', instanceName: 'app-2', serviceLabel: 'demo-service', state: 'exited' },
  ], 3000);
  assert.deepEqual(targets, [
    { targets: ['cloudresq-app-1:3000'], labels: { instance_name: 'app-1', service: 'demo-service' } },
  ]);
});

test('a scrape does not hang when MongoDB is not connected (gauges are simply empty)', async () => {
  const started = Date.now();
  const out = await scrape();
  assert.ok(Date.now() - started < 3000);
  assert.match(out, /# TYPE cloudresq_cpu_usage gauge/);
});