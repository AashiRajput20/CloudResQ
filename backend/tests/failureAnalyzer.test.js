// Unit tests for the Failure Analyzer. Run with: npm test
// Uses Node's built-in test runner, so there is nothing to install.
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../decision-engine/failureAnalyzer');

// Fixed config so the tests do not depend on .env
const cfg = {
  consecutiveFailuresBeforeRestart: 3,
  maxRestartsBeforeReplacement: 3,
  failuresBeforeUnstable: 3,
  failureWindowMinutes: 10,
};

const ctx = (instance = {}, extra = {}) => ({
  instance: {
    instanceName: 'app-2', status: 'HEALTHY', consecutiveFailures: 0,
    cpuUsage: 30, memoryUsage: 40, responseTimeMs: 5, restartCount: 0, ...instance,
  },
  activeFailures: [],
  recentFailureCount: 0,
  recentRestarts: 0,
  failedRestarts: 0,
  ...extra,
});

const failure = (failureType, severity = 'HIGH') => ({ failureType, severity, message: `${failureType} active` });

test('TC01: healthy instance -> NO_ACTION', () => {
  const a = analyze(ctx(), cfg);
  assert.equal(a.recommendedAction, 'NO_ACTION');
  assert.equal(a.severity, 'NONE');
  assert.equal(a.failureType, null);
});

test('TC02: 1 failed health check -> WARNING, still NO_ACTION', () => {
  const a = analyze(ctx({ status: 'WARNING', consecutiveFailures: 1 }), cfg);
  assert.equal(a.recommendedAction, 'NO_ACTION');
  assert.equal(a.severity, 'LOW');
  assert.match(a.reasons[0], /2 more/);
});

test('TC03: 3 consecutive failures (unhealthy) -> RESTART', () => {
  const a = analyze(
    ctx({ status: 'UNHEALTHY', consecutiveFailures: 3 }, { activeFailures: [failure('HEALTH_CHECK_FAILED')], recentFailureCount: 1 }),
    cfg
  );
  assert.equal(a.failureType, 'HEALTH_CHECK_FAILED');
  assert.equal(a.recommendedAction, 'RESTART');
  assert.equal(a.severity, 'HIGH');
});

test('container down -> RESTART', () => {
  const a = analyze(
    ctx({ status: 'FAILED', consecutiveFailures: 3 }, { activeFailures: [failure('CONTAINER_DOWN')], recentFailureCount: 1 }),
    cfg
  );
  assert.equal(a.failureType, 'CONTAINER_DOWN');
  assert.equal(a.recommendedAction, 'RESTART');
});

test('TC05: a previous restart failed -> REPLACE, CRITICAL', () => {
  const a = analyze(
    ctx({ status: 'UNHEALTHY' }, {
      activeFailures: [failure('HEALTH_CHECK_FAILED')], recentFailureCount: 2, recentRestarts: 1, failedRestarts: 1,
    }),
    cfg
  );
  assert.equal(a.recommendedAction, 'REPLACE');
  assert.equal(a.severity, 'CRITICAL');
  assert.equal(a.restartsExhausted, true);
});

test('restart limit reached (none failed) -> REPLACE', () => {
  const a = analyze(
    ctx({ status: 'UNHEALTHY' }, { activeFailures: [failure('HEALTH_CHECK_FAILED')], recentFailureCount: 2, recentRestarts: 3 }),
    cfg
  );
  assert.equal(a.recommendedAction, 'REPLACE');
});

test('2 restarts so far -> still RESTART', () => {
  const a = analyze(
    ctx({ status: 'UNHEALTHY' }, { activeFailures: [failure('HEALTH_CHECK_FAILED')], recentFailureCount: 2, recentRestarts: 2 }),
    cfg
  );
  assert.equal(a.recommendedAction, 'RESTART');
});

test('3 failures in 10 minutes -> UNSTABLE, REPLACE', () => {
  const a = analyze(
    ctx({}, { activeFailures: [failure('REPEATED_FAILURE', 'CRITICAL')], recentFailureCount: 3 }),
    cfg
  );
  assert.equal(a.failureType, 'REPEATED_FAILURE');
  assert.equal(a.unstable, true);
  assert.equal(a.recommendedAction, 'REPLACE');
  assert.equal(a.severity, 'CRITICAL');
});

test('TC06: high CPU only -> SCALE_OUT', () => {
  const a = analyze(ctx({ cpuUsage: 92 }, { activeFailures: [failure('HIGH_CPU', 'MEDIUM')] }), cfg);
  assert.equal(a.failureType, 'HIGH_CPU');
  assert.equal(a.recommendedAction, 'SCALE_OUT');
  assert.equal(a.severity, 'MEDIUM');
  assert.equal(a.cpu, 92);
});

test('high memory only -> SCALE_OUT', () => {
  const a = analyze(ctx({ memoryUsage: 90 }, { activeFailures: [failure('HIGH_MEMORY', 'MEDIUM')] }), cfg);
  assert.equal(a.recommendedAction, 'SCALE_OUT');
});

test('availability failure wins over a resource failure', () => {
  const a = analyze(
    ctx({ status: 'FAILED' }, {
      activeFailures: [failure('HIGH_CPU', 'MEDIUM'), failure('CONTAINER_DOWN')], recentFailureCount: 1,
    }),
    cfg
  );
  assert.equal(a.failureType, 'CONTAINER_DOWN');
  assert.equal(a.recommendedAction, 'RESTART');
  assert.deepEqual(a.activeFailureTypes.sort(), ['CONTAINER_DOWN', 'HIGH_CPU']);
});

test('high latency -> ALERT, high error rate -> REMOVE_FROM_TRAFFIC', () => {
  assert.equal(analyze(ctx({}, { activeFailures: [failure('HIGH_LATENCY', 'MEDIUM')] }), cfg).recommendedAction, 'ALERT');
  assert.equal(
    analyze(ctx({}, { activeFailures: [failure('HIGH_ERROR_RATE')], errorRate: 70 }), cfg).recommendedAction,
    'REMOVE_FROM_TRAFFIC'
  );
});

test('metrics and recovery history are passed through', () => {
  const lastRecovery = { action: 'RESTART', status: 'SUCCESS', startedAt: new Date(), duration: 4.2 };
  const a = analyze(ctx({ responseTimeMs: 12 }, { errorRate: 3, lastRecovery }), cfg);
  assert.equal(a.responseTimeMs, 12);
  assert.equal(a.errorRate, 3);
  assert.equal(a.lastRecovery.duration, 4.2);
  assert.ok(a.reasons.length > 0);
});