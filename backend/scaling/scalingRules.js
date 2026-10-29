// Pure scaling rules: no database, no Docker.
const { instanceNumber } = require('../recovery/instanceNaming');

const HEALTHY = ['HEALTHY', 'RECOVERED'];

// May we scale in this direction right now? (Rules 9 and 10)
function canScale(action, { replicas, healthyReplicas, min, max }) {
  if (action === 'SCALE_OUT') {
    if (replicas >= max) return { ok: false, reason: `the service already runs the maximum of ${max} replicas` };
    return { ok: true };
  }
  if (action === 'SCALE_IN') {
    if (replicas <= min) return { ok: false, reason: `the service is at its minimum of ${min} replicas` };
    if (healthyReplicas <= min) {
      return { ok: false, reason: `only ${healthyReplicas} replicas are healthy (minimum ${min})` };
    }
    return { ok: true };
  }
  return { ok: false, reason: `unknown action ${action}` };
}

// Scale in removes the NEWEST healthy instance that is receiving traffic (app-5 before app-4 ...).
function pickScaleInTarget(instances) {
  const candidates = instances.filter(
    (i) => HEALTHY.includes(i.status) && i.inTraffic !== false && i.containerId
  );
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => instanceNumber(b.instanceName) - instanceNumber(a.instanceName))[0];
}

// Which metric caused the scaling (stored in the scaling event).
function triggerFor(rule) {
  return { RULE_4_CPU_SCALE_OUT: 'CPU', RULE_5_MEMORY_SCALE_OUT: 'MEMORY', RULE_6_SCALE_IN: 'LOW_USAGE' }[rule] || 'MANUAL';
}

// Milliseconds left of the cooldown (0 = free to scale).
function cooldownRemaining(lastAt, now, seconds) {
  if (lastAt == null) return 0;
  return Math.max(0, lastAt + seconds * 1000 - now);
}

module.exports = { canScale, pickScaleInTarget, triggerFor, cooldownRemaining };