// Unit tests for the traffic pool rules and the Nginx config builder. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, buildUpstreamConfig } = require('../loadbalancer/upstreamBuilder');

const c = (n, state = 'running') => ({ instanceName: `app-${n}`, name: `cloudresq-app-${n}`, state });
const i = (n, o = {}) => ({ instanceName: `app-${n}`, status: 'HEALTHY', inTraffic: true, ...o });
const names = (list) => list.map((x) => x.instanceName);

test('healthy running instances in traffic form the pool', () => {
  const r = classify([c(1), c(2), c(3)], [i(1), i(2), i(3)]);
  assert.deepEqual(names(r.pool), ['app-1', 'app-2', 'app-3']);
  assert.deepEqual(r.excluded, []);
});

test('a stopped container is excluded', () => {
  const r = classify([c(1), c(2, 'exited')], [i(1), i(2)]);
  assert.deepEqual(names(r.pool), ['app-1']);
  assert.match(r.excluded[0].reason, /exited/);
});

test('an instance removed from traffic is excluded (Rule 7)', () => {
  const r = classify([c(1), c(2)], [i(1), i(2, { inTraffic: false })]);
  assert.deepEqual(names(r.pool), ['app-1']);
  assert.equal(r.excluded[0].reason, 'removed from traffic');
});

test('a RECOVERING instance is excluded', () => {
  const r = classify([c(1), c(2)], [i(1), i(2, { status: 'RECOVERING' })]);
  assert.deepEqual(names(r.pool), ['app-1']);
  assert.equal(r.excluded[0].reason, 'being recovered');
});

test('UNHEALTHY and FAILED instances are excluded even if still flagged in traffic', () => {
  const r = classify([c(1), c(2), c(3)], [i(1), i(2, { status: 'UNHEALTHY' }), i(3, { status: 'FAILED' })]);
  assert.deepEqual(names(r.pool), ['app-1']);
  assert.equal(r.excluded.length, 2);
});

test('WARNING (1-2 failed checks) and RECOVERED stay in the pool', () => {
  const r = classify([c(1), c(2)], [i(1, { status: 'WARNING' }), i(2, { status: 'RECOVERED' })]);
  assert.deepEqual(names(r.pool), ['app-1', 'app-2']);
});

test('a container without a monitor record is not added yet', () => {
  const r = classify([c(1), c(4)], [i(1)]);
  assert.deepEqual(names(r.pool), ['app-1']);
  assert.equal(r.excluded[0].reason, 'not monitored yet');
});

test('instances are sorted by number (app-10 after app-2)', () => {
  const r = classify([c(10), c(2), c(1)], [i(10), i(2), i(1)]);
  assert.deepEqual(names(r.pool), ['app-1', 'app-2', 'app-10']);
});

test('config lists every pool server, with max_fails=0', () => {
  const { pool } = classify([c(1), c(2)], [i(1), i(2)]);
  const text = buildUpstreamConfig(pool, 3000);
  assert.match(text, /upstream cloudresq_backend \{/);
  assert.match(text, /server cloudresq-app-1:3000 max_fails=0;/);
  assert.match(text, /server cloudresq-app-2:3000 max_fails=0;/);
});

test('an empty pool produces a valid config with one down server', () => {
  const text = buildUpstreamConfig([], 3000);
  assert.match(text, /server 127\.0\.0\.1:1 down;/);
  assert.doesNotMatch(text, /max_fails/);
});

test('the same pool always produces identical text (so unchanged pools are never reloaded)', () => {
  const { pool } = classify([c(1), c(3)], [i(1), i(3)]);
  assert.equal(buildUpstreamConfig(pool, 3000), buildUpstreamConfig(pool, 3000));
});