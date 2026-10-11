// Unit tests for instance naming and the post-recovery traffic rule. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextSlot, instanceNumber } = require('../recovery/instanceNaming');
const { evaluateInstance } = require('../decision-engine/decisionEngine');

const list = (...names) => names.map((n) => ({ instanceName: n, hostPort: 3000 + instanceNumber(n) }));

test('first slot on an empty system is app-1 on port 3001', () => {
  assert.deepEqual(nextSlot([]), { instanceName: 'app-1', hostPort: 3001 });
});

test('after app-1..3 the next instance is app-4 on port 3004', () => {
  assert.deepEqual(nextSlot(list('app-1', 'app-2', 'app-3')), { instanceName: 'app-4', hostPort: 3004 });
});

test('replacing app-2 does not reuse a name (app-4 already exists -> app-5)', () => {
  assert.deepEqual(nextSlot(list('app-1', 'app-3', 'app-4')), { instanceName: 'app-5', hostPort: 3005 });
});

test('a port that is already published is skipped', () => {
  const s = nextSlot([{ instanceName: 'app-3', hostPort: 3003 }, { instanceName: 'worker', hostPort: 3004 }]);
  assert.deepEqual(s, { instanceName: 'app-4', hostPort: 3005 });
});

test('no free port -> error', () => {
  assert.throws(() => nextSlot([{ instanceName: 'app-3', hostPort: 3004 }], { maxPort: 3004 }), /No free host port/);
});

test('Rule 8 also fires right after a successful recovery (RECOVERED)', () => {
  const cfg = {
    consecutiveFailuresBeforeRestart: 3, maxRestartsBeforeReplacement: 3, failureWindowMinutes: 10,
    cpuScaleOutThreshold: 85, memoryScaleOutThreshold: 85, cpuSustainSeconds: 60, memorySustainSeconds: 60,
    cpuScaleInThreshold: 20, scaleInSustainSeconds: 60, lowTrafficRequestsPerCycle: 5,
    minimumReplicas: 2, maximumReplicas: 5,
  };
  const analysis = {
    instanceName: 'app-2', health: 'RECOVERED', failureType: null, activeFailureTypes: [], severity: 'NONE',
    failureCount: 1, consecutiveFailures: 0, recentRestarts: 1, failedRestarts: 0, cpu: 5, memory: 30,
    responseTimeMs: 4, errorRate: null, unstable: false, restartsExhausted: false, reasons: [],
  };
  const d = evaluateInstance({ analysis, inTraffic: false, service: { currentReplicas: 3, healthyReplicas: 3 } }, cfg);
  assert.equal(d.action, 'ADD_TO_TRAFFIC');
});