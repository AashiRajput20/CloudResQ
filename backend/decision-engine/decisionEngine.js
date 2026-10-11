// Rule-Based Intelligent Decision Engine.
// A PURE function: same input, same output, no database, no Docker.
// It decides WHAT to do and WHY. The Recovery Controller (Phase 10) does it.
const decisionConfig = require('../config/decisionConfig');

const AVAILABILITY = ['CONTAINER_DOWN', 'HEALTH_CHECK_FAILED'];
const round2 = (n) => Math.round(n * 100) / 100;
const clamp01 = (n) => Math.min(1, Math.max(0, n));
const pct = (n) => (n == null ? '?' : `${Math.round(n)}%`);

// state = {
//   analysis:  output of failureAnalyzer.analyze()
//   inTraffic: is the instance currently receiving traffic?
//   service:   { currentReplicas, healthyReplicas, minimumReplicas, maximumReplicas,
//                avgCpu, cpuLowForSeconds, requestsPerCycle }
// }
function evaluateInstance(state, cfg = decisionConfig) {
  const { analysis: a, inTraffic = true, service = {} } = state;
  const name = a.instanceName;
  const types = a.activeFailureTypes || [];
  const availabilityDown = types.some((t) => AVAILABILITY.includes(t));

  const min = service.minimumReplicas ?? cfg.minimumReplicas;
  const max = service.maximumReplicas ?? cfg.maximumReplicas;
  const replicas = service.currentReplicas ?? 0;
  const healthyReplicas = service.healthyReplicas ?? replicas;

  // RULE 7: an unhealthy instance is taken out of traffic, whatever else is decided.
  const trafficAction = availabilityDown && inTraffic ? 'REMOVE_FROM_TRAFFIC' : null;

  const make = (f) => ({
    instanceName: name,
    action: 'NO_ACTION',
    trafficAction: null,
    priority: 'LOW',
    rule: 'NONE',
    reason: '',
    blockedBy: null,
    scale: null,
    trigger: a.failureType,
    decidedAt: new Date().toISOString(),
    ...f,
    confidence: round2(clamp01(f.confidence ?? 0.9)),
  });

  // ---- RULE 3: failed too often in the window -> UNSTABLE -> REPLACE ----
  if (a.unstable) {
    const tail = a.failedRestarts > 0 ? ' and restart attempts were unsuccessful' : '';
    return make({
      action: 'REPLACE', trafficAction, priority: 'CRITICAL', confidence: 0.97, rule: 'RULE_3_UNSTABLE',
      reason: `${name} failed ${a.failureCount} times in the last ${cfg.failureWindowMinutes} minutes${tail}, so it is marked UNSTABLE and will be replaced.`,
    });
  }

  // ---- RULE 2: a restart failed, or the restart limit is used up -> REPLACE ----
  if (availabilityDown && a.restartsExhausted) {
    const why = a.failedRestarts > 0
      ? `a restart of ${name} already failed (${a.failedRestarts} of ${a.recentRestarts} restart(s) in the last ${cfg.failureWindowMinutes} minutes)`
      : `${name} has used all ${cfg.maxRestartsBeforeReplacement} allowed restarts in the last ${cfg.failureWindowMinutes} minutes`;
    return make({
      action: 'REPLACE', trafficAction, priority: 'CRITICAL', confidence: 0.93, rule: 'RULE_2_RESTART_FAILED',
      reason: `${why}, so restarting again is unlikely to help. The instance will be replaced.`,
    });
  }

  // ---- RULE 1: 3 consecutive failed checks, restart budget left -> RESTART ----
  if (
    availabilityDown &&
    a.consecutiveFailures >= cfg.consecutiveFailuresBeforeRestart &&
    a.recentRestarts < cfg.maxRestartsBeforeReplacement
  ) {
    const what = types.includes('CONTAINER_DOWN') ? 'its container is not running' : 'its health endpoint is failing';
    return make({
      action: 'RESTART', trafficAction, priority: 'HIGH',
      confidence: 0.92 - 0.08 * a.recentRestarts, // earlier restarts make another one less likely to help
      rule: 'RULE_1_RESTART',
      reason: `${name} has failed ${a.consecutiveFailures} consecutive health checks (${what}) and has used ${a.recentRestarts} of ${cfg.maxRestartsBeforeReplacement} allowed restarts, so it will be restarted.`,
    });
  }

  // ---- RULE 7 (error rate): serving many 5xx errors -> take it out of traffic ----
  if (types.includes('HIGH_ERROR_RATE') && inTraffic) {
    return make({
      action: 'REMOVE_FROM_TRAFFIC', priority: 'HIGH', confidence: 0.8, rule: 'RULE_7_REMOVE_FROM_TRAFFIC',
      reason: `${name} is returning many server errors (about ${pct(a.errorRate)} of recent responses), so it is removed from traffic until the error rate drops.`,
    });
  }

  // ---- RULE 8: healthy again but still out of traffic -> ADD_TO_TRAFFIC ----
   if (!inTraffic && (a.health === 'HEALTHY' || a.health === 'RECOVERED') && !availabilityDown && !types.includes('HIGH_ERROR_RATE'))  {
    return make({
      action: 'ADD_TO_TRAFFIC', priority: 'MEDIUM', confidence: 0.9, rule: 'RULE_8_ADD_TO_TRAFFIC',
      reason: `${name} is passing health checks again, so it is added back to traffic.`,
    });
  }

  // ---- RULES 4 + 5 (+ 9): sustained high CPU or memory -> SCALE_OUT ----
  const hot = [];
  if (types.includes('HIGH_CPU')) {
    hot.push(`average CPU usage remained above ${cfg.cpuScaleOutThreshold}% for ${cfg.cpuSustainSeconds} s (now ${pct(a.cpu)})`);
  }
  if (types.includes('HIGH_MEMORY')) {
    hot.push(`average memory usage remained above ${cfg.memoryScaleOutThreshold}% for ${cfg.memorySustainSeconds} s (now ${pct(a.memory)})`);
  }
  if (hot.length > 0) {
    const base = `On ${name}, ${hot.join(' and ')}.`;
    if (replicas >= max) { // RULE 9: do not scale past the maximum
      return make({
        action: 'ALERT', priority: 'HIGH', confidence: 0.9, rule: 'RULE_9_MAX_REPLICAS', blockedBy: 'MAX_REPLICAS',
        reason: `${base} The service already runs the maximum of ${max} replicas, so it will not scale further. An alert is raised instead.`,
      });
    }
    return make({
      action: 'SCALE_OUT', priority: 'MEDIUM', confidence: hot.length > 1 ? 0.9 : 0.85,
      rule: types.includes('HIGH_CPU') ? 'RULE_4_CPU_SCALE_OUT' : 'RULE_5_MEMORY_SCALE_OUT',
      scale: { from: replicas, to: replicas + 1 },
      reason: `${base} Scaling out from ${replicas} to ${replicas + 1} replicas.`,
    });
  }

  // ---- High latency has no automatic fix of its own -> ALERT ----
  if (types.includes('HIGH_LATENCY')) {
    return make({
      action: 'ALERT', priority: 'MEDIUM', confidence: 0.6, rule: 'LATENCY_ALERT',
      reason: `${name} has had high response times (${a.responseTimeMs ?? '?'} ms). There is no safe automatic fix, so an alert is raised.`,
    });
  }

  // ---- RULES 6 + 10: idle service -> SCALE_IN, never below the minimum ----
  const idle =
    a.health === 'HEALTHY' && inTraffic && types.length === 0 &&
    service.avgCpu != null && service.avgCpu < cfg.cpuScaleInThreshold &&
    (service.cpuLowForSeconds || 0) >= cfg.scaleInSustainSeconds &&
    service.requestsPerCycle != null && service.requestsPerCycle <= cfg.lowTrafficRequestsPerCycle;

  if (idle) {
    const why = `Average CPU of the service has been ${pct(service.avgCpu)} (below ${cfg.cpuScaleInThreshold}%) for ${service.cpuLowForSeconds} s and traffic is low`;
    if (healthyReplicas > min) {
      return make({
        action: 'SCALE_IN', priority: 'LOW', confidence: 0.8, rule: 'RULE_6_SCALE_IN',
        scale: { from: replicas, to: replicas - 1 },
        reason: `${why}. The service has ${healthyReplicas} healthy replicas (minimum ${min}), so it scales in from ${replicas} to ${replicas - 1}.`,
      });
    }
    return make({
      action: 'NO_ACTION', priority: 'LOW', confidence: 0.9, rule: 'RULE_10_MIN_REPLICAS', blockedBy: 'MIN_REPLICAS',
      reason: `${why}, but the service is at its minimum of ${min} healthy replicas, so it will not scale in.`,
    });
  }

  // ---- Nothing to do ----
  if (a.health === 'WARNING') {
    const n = a.consecutiveFailures || 0;
    const left = Math.max(0, cfg.consecutiveFailuresBeforeRestart - n);
    return make({
      action: 'NO_ACTION', priority: 'LOW', confidence: 0.9, rule: 'WAIT_FOR_CONFIRMATION',
      reason: `${name} has ${n} failed health check(s). ${left} more in a row are needed before it counts as failed, so no action yet.`,
    });
  }

  return make({
    action: 'NO_ACTION', priority: 'LOW', confidence: 0.95, rule: 'HEALTHY',
    reason: `${name} is healthy and within all thresholds.`,
  });
}

module.exports = { evaluateInstance, AVAILABILITY };