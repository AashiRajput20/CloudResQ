// Unit tests for the analytics formulas. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../analytics/calculations');

const rec = (action, status, duration, o = {}) => ({
  action, status, duration, source: 'AUTO', startedAt: new Date(2026, 9, 1, 10, 0, duration || 0), instanceName: 'app-2', ...o,
});

test('Recovery Success Rate = successful / total x 100, and Average Recovery Time uses successful ones only', () => {
  const s = calc.recoveryStats([
    rec('RESTART', 'SUCCESS', 2), rec('RESTART', 'SUCCESS', 4), rec('REPLACE', 'SUCCESS', 3), rec('RESTART', 'FAILED', 15),
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.successful, 3);
  assert.equal(s.failed, 1);
  assert.equal(s.successRate, 75);
  assert.equal(s.avgRecoveryTimeSec, 3); // (2 + 4 + 3) / 3, the failed 15 s is not counted
  assert.equal(s.minRecoveryTimeSec, 2);
  assert.equal(s.maxRecoveryTimeSec, 4);
});

test('manual actions, traffic changes and unfinished recoveries are not counted', () => {
  const s = calc.recoveryStats([
    rec('RESTART', 'SUCCESS', 2),
    rec('RESTART', 'SUCCESS', 9, { source: 'MANUAL' }),
    rec('RESTART', 'IN_PROGRESS', null),
    rec('REMOVE_FROM_TRAFFIC', 'SUCCESS', 0),
  ]);
  assert.equal(s.total, 1);
  assert.equal(s.successRate, 100);
});

test('with no recoveries the rate and time are null, not zero', () => {
  const s = calc.recoveryStats([]);
  assert.equal(s.total, 0);
  assert.equal(s.successRate, null);
  assert.equal(s.avgRecoveryTimeSec, null);
});

test('Availability = uptime / (uptime + downtime) x 100', () => {
  const a = calc.availabilityStats({ upCycles: 95, totalCycles: 100, intervalMs: 5000 });
  assert.equal(a.percent, 95);
  assert.equal(a.uptimeSec, 475);
  assert.equal(a.downtimeSec, 25);
  assert.equal(a.downCycles, 5);
});

test('availability is null when nothing was monitored', () => {
  assert.equal(calc.availabilityStats({ upCycles: 0, totalCycles: 0, intervalMs: 5000 }).percent, null);
});

test('Failure Detection Time averages only availability failures that have a start time', () => {
  const d = calc.detectionStats([
    { failureType: 'HEALTH_CHECK_FAILED', detectionTimeSec: 10 },
    { failureType: 'CONTAINER_DOWN', detectionTimeSec: 12 },
    { failureType: 'HIGH_CPU', detectionTimeSec: null },
    { failureType: 'REPEATED_FAILURE', detectionTimeSec: 99 },
  ]);
  assert.equal(d.samples, 2);
  assert.equal(d.avgDetectionTimeSec, 11);
  assert.equal(d.maxDetectionTimeSec, 12);
});

test('failures are counted by type, most frequent first, with active and resolved totals', () => {
  const f = calc.failureStats([
    { failureType: 'HIGH_CPU', status: 'RESOLVED' },
    { failureType: 'HEALTH_CHECK_FAILED', status: 'RESOLVED' },
    { failureType: 'HEALTH_CHECK_FAILED', status: 'ACTIVE' },
  ]);
  assert.equal(f.total, 3);
  assert.equal(f.active, 1);
  assert.equal(f.resolved, 2);
  assert.deepEqual(f.byType, [{ type: 'HEALTH_CHECK_FAILED', count: 2 }, { type: 'HIGH_CPU', count: 1 }]);
});

test('instance availability is a percentage per instance, sorted by number (app-2 before app-10)', () => {
  const rows = calc.instanceAvailability([
    { instanceName: 'app-10', checks: 10, healthyChecks: 10 },
    { instanceName: 'app-2', checks: 10, healthyChecks: 9 },
  ]);
  assert.deepEqual(rows.map((r) => r.instanceName), ['app-2', 'app-10']);
  assert.equal(rows[0].availability, 90);
  assert.equal(rows[1].availability, 100);
});

test('the recovery timeline is oldest first and labels a replacement as old > new', () => {
  const t = calc.recoveryTimeline([
    rec('REPLACE', 'SUCCESS', 3, { startedAt: new Date(2026, 9, 1, 10, 5), oldInstance: 'app-2', newInstance: 'app-4' }),
    rec('RESTART', 'SUCCESS', 2, { startedAt: new Date(2026, 9, 1, 10, 1) }),
  ]);
  assert.deepEqual(t.map((x) => x.name), ['app-2', 'app-2 > app-4']);
  assert.equal(t[1].duration, 3);
});

test('scaling statistics count directions and results', () => {
  const s = calc.scalingStats([
    { action: 'SCALE_OUT', status: 'SUCCESS' }, { action: 'SCALE_OUT', status: 'FAILED' },
    { action: 'SCALE_IN', status: 'SUCCESS' }, { action: 'SCALE_IN', status: 'IN_PROGRESS' },
  ]);
  assert.deepEqual(s, { total: 4, scaleOut: 2, scaleIn: 2, successful: 2, failed: 1 });
});