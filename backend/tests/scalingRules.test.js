// Unit tests for the scaling rules. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { canScale, pickScaleInTarget, triggerFor, cooldownRemaining } = require('../scaling/scalingRules');

const f = (o = {}) => ({ replicas: 3, healthyReplicas: 3, min: 2, max: 5, ...o });
const inst = (n, o = {}) => ({ instanceName: `app-${n}`, status: 'HEALTHY', inTraffic: true, containerId: `c${n}`, ...o });

test('scale out is allowed below the maximum', () => {
  assert.equal(canScale('SCALE_OUT', f({ replicas: 4 })).ok, true);
});

test('Rule 9: scale out is blocked at the maximum', () => {
  const r = canScale('SCALE_OUT', f({ replicas: 5, healthyReplicas: 5 }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /maximum of 5/);
});

test('scale in is allowed above the minimum with enough healthy replicas', () => {
  assert.equal(canScale('SCALE_IN', f()).ok, true);
});

test('Rule 10: scale in is blocked at the minimum', () => {
  const r = canScale('SCALE_IN', f({ replicas: 2, healthyReplicas: 2 }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /minimum of 2/);
});

test('Rule 10: unhealthy replicas do not count towards the minimum', () => {
  const r = canScale('SCALE_IN', f({ replicas: 3, healthyReplicas: 2 }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /only 2 replicas are healthy/);
});

test('scale in removes the newest healthy instance (app-10 is newer than app-2)', () => {
  const t = pickScaleInTarget([inst(1), inst(2), inst(10)]);
  assert.equal(t.instanceName, 'app-10');
});

test('scale in never picks an unhealthy or out-of-traffic instance', () => {
  const list = [inst(1), inst(2, { status: 'UNHEALTHY' }), inst(3, { inTraffic: false })];
  assert.equal(pickScaleInTarget(list).instanceName, 'app-1');
  assert.equal(pickScaleInTarget([inst(2, { status: 'FAILED' })]), null);
});

test('the scaling trigger is derived from the rule that fired', () => {
  assert.equal(triggerFor('RULE_4_CPU_SCALE_OUT'), 'CPU');
  assert.equal(triggerFor('RULE_5_MEMORY_SCALE_OUT'), 'MEMORY');
  assert.equal(triggerFor('RULE_6_SCALE_IN'), 'LOW_USAGE');
  assert.equal(triggerFor(undefined), 'MANUAL');
});

test('cooldown: none before the first action, then counts down to zero', () => {
  assert.equal(cooldownRemaining(undefined, 1000, 60), 0);
  assert.equal(cooldownRemaining(1000, 31000, 60), 30000);
  assert.equal(cooldownRemaining(1000, 70000, 60), 0);
});