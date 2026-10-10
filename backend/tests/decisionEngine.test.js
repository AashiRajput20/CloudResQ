// Unit tests for the Decision Engine. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateInstance } = require('../decision-engine/decisionEngine');

const cfg = {
  consecutiveFailuresBeforeRestart: 3, maxRestartsBeforeReplacement: 3, failureWindowMinutes: 10,
  cpuScaleOutThreshold: 85, memoryScaleOutThreshold: 85, cpuSustainSeconds: 60, memorySustainSeconds: 60,
  cpuScaleInThreshold: 20, scaleInSustainSeconds: 60, lowTrafficRequestsPerCycle: 5,
  minimumReplicas: 2, maximumReplicas: 5,
};

// A healthy analysis (same shape as failureAnalyzer.analyze() output)
const analysis = (o = {}) => ({
  instanceName: 'app-2', health: 'HEALTHY', failureType: null, activeFailureTypes: [], severity: 'NONE',
  failureCount: 0, consecutiveFailures: 0, recentRestarts: 0, failedRestarts: 0, cpu: 30, memory: 40,
  responseTimeMs: 5, errorRate: null, unstable: false, restartsExhausted: false, reasons: [], ...o,
});
const svc = (o = {}) => ({
  currentReplicas: 3, healthyReplicas: 3, minimumReplicas: 2, maximumReplicas: 5,
  avgCpu: 30, cpuLowForSeconds: 0, requestsPerCycle: 2, ...o,
});
const decide = (a, { inTraffic = true, service = svc() } = {}) =>
  evaluateInstance({ analysis: analysis(a), inTraffic, service }, cfg);

const down = (type = 'HEALTH_CHECK_FAILED', o = {}) => ({
  health: type === 'CONTAINER_DOWN' ? 'FAILED' : 'UNHEALTHY',
  failureType: type, activeFailureTypes: [type], severity: 'HIGH',
  consecutiveFailures: 3, failureCount: 1, ...o,
});
const idleService = (o = {}) => svc({ avgCpu: 5, cpuLowForSeconds: 70, requestsPerCycle: 2, ...o });

test('TC01: healthy instance -> NO_ACTION', () => {
  const d = decide();
  assert.equal(d.action, 'NO_ACTION');
  assert.equal(d.trafficAction, null);
});

test('TC02: 1 failed health check (WARNING) -> NO_ACTION, waiting', () => {
  const d = decide({ health: 'WARNING', consecutiveFailures: 1 });
  assert.equal(d.action, 'NO_ACTION');
  assert.match(d.reason, /2 more/);
});

test('TC03 + Rules 1 and 7: 3 consecutive failures -> RESTART and REMOVE_FROM_TRAFFIC', () => {
  const d = decide(down());
  assert.equal(d.action, 'RESTART');
  assert.equal(d.trafficAction, 'REMOVE_FROM_TRAFFIC');
  assert.equal(d.priority, 'HIGH');
  assert.equal(d.confidence, 0.92);
  assert.match(d.reason, /3 consecutive health checks/);
});

test('container down -> RESTART, reason mentions the container', () => {
  const d = decide(down('CONTAINER_DOWN'));
  assert.equal(d.action, 'RESTART');
  assert.match(d.reason, /container is not running/);
});

test('already out of traffic -> RESTART without another REMOVE', () => {
  assert.equal(decide(down(), { inTraffic: false }).trafficAction, null);
});

test('confidence falls as restarts are used', () => {
  const c0 = decide(down()).confidence;
  const c2 = decide(down('HEALTH_CHECK_FAILED', { recentRestarts: 2 })).confidence;
  assert.equal(c0, 0.92);
  assert.equal(c2, 0.76);
  assert.ok(c2 < c0);
});

test('TC05 + Rule 2: a restart failed -> REPLACE', () => {
  const d = decide(down('HEALTH_CHECK_FAILED', {
    recentRestarts: 1, failedRestarts: 1, restartsExhausted: true, failureCount: 2,
  }));
  assert.equal(d.action, 'REPLACE');
  assert.equal(d.priority, 'CRITICAL');
  assert.equal(d.rule, 'RULE_2_RESTART_FAILED');
  assert.match(d.reason, /already failed/);
});

test('Rule 2: restart limit reached (none failed) -> REPLACE', () => {
  const d = decide(down('HEALTH_CHECK_FAILED', { recentRestarts: 3, restartsExhausted: true }));
  assert.equal(d.action, 'REPLACE');
  assert.match(d.reason, /all 3 allowed restarts/);
});

test('Rule 3: 4 failures in 10 min -> UNSTABLE -> REPLACE', () => {
  const d = decide(down('HEALTH_CHECK_FAILED', {
    unstable: true, failureCount: 4, failedRestarts: 1, recentRestarts: 1, restartsExhausted: true,
  }));
  assert.equal(d.action, 'REPLACE');
  assert.equal(d.rule, 'RULE_3_UNSTABLE');
  assert.equal(d.confidence, 0.97);
  assert.match(d.reason, /failed 4 times in the last 10 minutes and restart attempts were unsuccessful/);
  assert.match(d.reason, /UNSTABLE/);
});

test('Rule 3: unstable but currently healthy -> still REPLACE, no traffic change', () => {
  const d = decide({ unstable: true, failureCount: 3, activeFailureTypes: ['REPEATED_FAILURE'], failureType: 'REPEATED_FAILURE' });
  assert.equal(d.action, 'REPLACE');
  assert.equal(d.trafficAction, null);
});

test('TC06 + Rule 4: sustained high CPU -> SCALE_OUT 3 -> 4', () => {
  const d = decide({ cpu: 92, failureType: 'HIGH_CPU', activeFailureTypes: ['HIGH_CPU'] });
  assert.equal(d.action, 'SCALE_OUT');
  assert.deepEqual(d.scale, { from: 3, to: 4 });
  assert.match(d.reason, /above 85% for 60 s/);
});

test('Rule 5: sustained high memory -> SCALE_OUT', () => {
  const d = decide({ memory: 90, failureType: 'HIGH_MEMORY', activeFailureTypes: ['HIGH_MEMORY'] });
  assert.equal(d.action, 'SCALE_OUT');
  assert.equal(d.rule, 'RULE_5_MEMORY_SCALE_OUT');
});

test('TC08 + Rule 9: maximum replicas reached -> ALERT, no scaling', () => {
  const d = decide(
    { cpu: 95, failureType: 'HIGH_CPU', activeFailureTypes: ['HIGH_CPU'] },
    { service: svc({ currentReplicas: 5, healthyReplicas: 5 }) }
  );
  assert.equal(d.action, 'ALERT');
  assert.equal(d.blockedBy, 'MAX_REPLICAS');
  assert.equal(d.scale, null);
  assert.match(d.reason, /maximum of 5 replicas/);
});

test('TC07 + Rule 6: idle service above the minimum -> SCALE_IN', () => {
  const d = decide({}, { service: idleService() });
  assert.equal(d.action, 'SCALE_IN');
  assert.deepEqual(d.scale, { from: 3, to: 2 });
});

test('TC09 + Rule 10: idle service at the minimum -> no scale in', () => {
  const d = decide({}, { service: idleService({ currentReplicas: 2, healthyReplicas: 2 }) });
  assert.equal(d.action, 'NO_ACTION');
  assert.equal(d.blockedBy, 'MIN_REPLICAS');
  assert.match(d.reason, /minimum of 2/);
});

test('Rule 10: an unhealthy replica does not count towards the minimum', () => {
  const d = decide({}, { service: idleService({ currentReplicas: 3, healthyReplicas: 2 }) });
  assert.equal(d.blockedBy, 'MIN_REPLICAS');
});

test('Scale in needs low CPU for long enough AND low traffic', () => {
  assert.equal(decide({}, { service: idleService({ cpuLowForSeconds: 30 }) }).action, 'NO_ACTION');
  assert.equal(decide({}, { service: idleService({ requestsPerCycle: 40 }) }).action, 'NO_ACTION');
  assert.equal(decide({}, { service: idleService({ requestsPerCycle: null }) }).action, 'NO_ACTION');
});

test('Rule 8: healthy again but out of traffic -> ADD_TO_TRAFFIC', () => {
  const d = decide({}, { inTraffic: false });
  assert.equal(d.action, 'ADD_TO_TRAFFIC');
  assert.equal(d.rule, 'RULE_8_ADD_TO_TRAFFIC');
});

test('Rule 7: high error rate -> REMOVE_FROM_TRAFFIC', () => {
  const d = decide({ failureType: 'HIGH_ERROR_RATE', activeFailureTypes: ['HIGH_ERROR_RATE'], errorRate: 70 });
  assert.equal(d.action, 'REMOVE_FROM_TRAFFIC');
});

test('high latency -> ALERT with low confidence', () => {
  const d = decide({ failureType: 'HIGH_LATENCY', activeFailureTypes: ['HIGH_LATENCY'], responseTimeMs: 900 });
  assert.equal(d.action, 'ALERT');
  assert.equal(d.confidence, 0.6);
});

test('availability failure wins over high CPU', () => {
  const d = decide(down('HEALTH_CHECK_FAILED', { activeFailureTypes: ['HEALTH_CHECK_FAILED', 'HIGH_CPU'] }));
  assert.equal(d.action, 'RESTART');
});

test('thresholds are configurable', () => {
  const strict = { ...cfg, maxRestartsBeforeReplacement: 1 };
  const d = evaluateInstance(
    { analysis: analysis(down('HEALTH_CHECK_FAILED', { recentRestarts: 1, restartsExhausted: true })), service: svc() },
    strict
  );
  assert.equal(d.action, 'REPLACE');
});