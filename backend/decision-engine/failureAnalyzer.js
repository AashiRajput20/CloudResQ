// Failure Analyzer: a PURE function. Same input, same output, no database, no Docker.
// That makes it easy to unit test and easy to explain in a viva.
// The "recommendedAction" is a simple hint; the Decision Engine (Phase 9) makes the final call.
const decisionConfig = require('../config/decisionConfig');

const SEVERITY_RANK = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const higher = (a, b) => (SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a);

// Which failure is "the" problem when several are active at once.
const PRIORITY = [
  'REPEATED_FAILURE', 'CONTAINER_DOWN', 'HEALTH_CHECK_FAILED',
  'HIGH_ERROR_RATE', 'HIGH_MEMORY', 'HIGH_CPU', 'HIGH_LATENCY',
];
const AVAILABILITY = ['CONTAINER_DOWN', 'HEALTH_CHECK_FAILED'];

// ctx = {
//   instance:          { instanceName, status, consecutiveFailures, cpuUsage, memoryUsage, responseTimeMs, restartCount }
//   activeFailures:    [{ failureType, severity, message }]
//   recentFailureCount: availability failures within the window
//   recentRestarts:     RESTART actions within the window
//   failedRestarts:     how many of those failed
//   lastRecovery:       most recent recovery event or null
//   errorRate:          percent of 5xx, or null
// }
function analyze(ctx, cfg = decisionConfig) {
  const {
    instance,
    activeFailures = [],
    recentFailureCount = 0,
    recentRestarts = 0,
    failedRestarts = 0,
    lastRecovery = null,
    errorRate = null,
  } = ctx;

  const activeTypes = [...new Set(activeFailures.map((f) => f.failureType))];
  const failureType = PRIORITY.find((t) => activeTypes.includes(t)) || null;
  const availabilityDown = activeTypes.some((t) => AVAILABILITY.includes(t));

  // Rule 3 input: repeated failures in the window mean the instance is UNSTABLE.
  const unstable =
    activeTypes.includes('REPEATED_FAILURE') ||
    (availabilityDown && recentFailureCount >= cfg.failuresBeforeUnstable);

  // Rule 2 input: a restart already failed, or we ran out of restart attempts.
  const restartsExhausted = failedRestarts > 0 || recentRestarts >= cfg.maxRestartsBeforeReplacement;

  const needsReplacement = unstable || (availabilityDown && restartsExhausted);

  // ----- severity -----
  let severity = 'NONE';
  if (activeFailures.length > 0) {
    severity = activeFailures.map((f) => f.severity).reduce(higher, 'LOW');
  } else if (instance.status === 'WARNING') {
    severity = 'LOW';
  }
  if (needsReplacement) severity = 'CRITICAL';

  // ----- explanation facts -----
  const reasons = [];
  if (instance.status === 'WARNING' && activeFailures.length === 0) {
    const n = instance.consecutiveFailures || 0;
    const left = Math.max(0, cfg.consecutiveFailuresBeforeRestart - n);
    reasons.push(`${n} failed health check(s) so far; ${left} more before the instance counts as failed`);
  }
  for (const f of activeFailures) reasons.push(f.message || f.failureType);
  if (recentFailureCount > 0) {
    reasons.push(`${recentFailureCount} availability failure(s) in the last ${cfg.failureWindowMinutes} minutes`);
  }
  if (recentRestarts > 0) {
    reasons.push(`${recentRestarts} restart(s) in the last ${cfg.failureWindowMinutes} minutes, ${failedRestarts} of them failed`);
  }
  if (reasons.length === 0) reasons.push('Instance is healthy, no active failures');

  // ----- hint -----
  let recommendedAction = 'NO_ACTION';
  if (needsReplacement) {
    recommendedAction = 'REPLACE';
    reasons.push(
      unstable
        ? 'Instance is unstable (too many recent failures), so restarting again is unlikely to help'
        : 'Restart limit reached or a restart already failed'
    );
  } else if (availabilityDown) {
    recommendedAction = 'RESTART';
  } else if (failureType === 'HIGH_CPU' || failureType === 'HIGH_MEMORY') {
    recommendedAction = 'SCALE_OUT';
  } else if (failureType === 'HIGH_ERROR_RATE') {
    recommendedAction = 'REMOVE_FROM_TRAFFIC';
  } else if (failureType === 'HIGH_LATENCY') {
    recommendedAction = 'ALERT';
  }

  return {
    instanceName: instance.instanceName,
    health: instance.status,
    failureType,
    activeFailureTypes: activeTypes,
    severity,
    failureCount: recentFailureCount,
    consecutiveFailures: instance.consecutiveFailures || 0,
    recentRestarts,
    failedRestarts,
    totalRestarts: instance.restartCount || 0,
    cpu: instance.cpuUsage ?? null,
    memory: instance.memoryUsage ?? null,
    responseTimeMs: instance.responseTimeMs ?? null,
    errorRate,
    lastRecovery: lastRecovery
      ? {
          action: lastRecovery.action,
          status: lastRecovery.status,
          startedAt: lastRecovery.startedAt,
          duration: lastRecovery.duration,
        }
      : null,
    unstable,
    restartsExhausted,
    recommendedAction,
    reasons,
    analyzedAt: new Date().toISOString(),
  };
}

module.exports = { analyze, PRIORITY, AVAILABILITY };