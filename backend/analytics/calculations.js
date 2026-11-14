// Analytics formulas from the project spec. Pure functions: easy to unit test and to explain.
const { instanceNumber } = require('../recovery/instanceNaming');

const RECOVERY_ACTIONS = ['RESTART', 'REPLACE'];
const AVAILABILITY_FAILURES = ['CONTAINER_DOWN', 'HEALTH_CHECK_FAILED'];

const round = (n, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
const percent = (num, den) => (den > 0 ? round((num / den) * 100) : null);
const average = (list, digits) => (list.length ? round(list.reduce((a, b) => a + b, 0) / list.length, digits) : null);

// A "recovery" is an automatic RESTART or REPLACE. Manual button clicks are not failure recoveries.
const isAutoRecovery = (e) => RECOVERY_ACTIONS.includes(e.action) && e.source !== 'MANUAL';

// Recovery Success Rate = successful / total x 100
// Average Recovery Time = total time of successful recoveries / number of successful recoveries
function recoveryStats(events) {
  const done = events.filter((e) => isAutoRecovery(e) && e.status !== 'IN_PROGRESS');
  const ok = done.filter((e) => e.status === 'SUCCESS');
  const times = ok.map((e) => e.duration).filter((d) => typeof d === 'number');

  return {
    total: done.length,
    successful: ok.length,
    failed: done.length - ok.length,
    successRate: percent(ok.length, done.length),
    avgRecoveryTimeSec: average(times, 2),
    minRecoveryTimeSec: times.length ? Math.min(...times) : null,
    maxRecoveryTimeSec: times.length ? Math.max(...times) : null,
    byAction: RECOVERY_ACTIONS.map((action) => {
      const rows = done.filter((e) => e.action === action);
      const success = rows.filter((e) => e.status === 'SUCCESS').length;
      return { action, success, failed: rows.length - success };
    }),
  };
}

// Failure Detection Time = detected at - occurred at (stored as detectionTimeSec on availability failures)
function detectionStats(failures) {
  const times = failures
    .filter((f) => AVAILABILITY_FAILURES.includes(f.failureType))
    .map((f) => f.detectionTimeSec)
    .filter((n) => typeof n === 'number');
  return {
    samples: times.length,
    avgDetectionTimeSec: average(times, 1),
    minDetectionTimeSec: times.length ? Math.min(...times) : null,
    maxDetectionTimeSec: times.length ? Math.max(...times) : null,
  };
}

// How many failures of each type (types with zero are left out), most frequent first.
function failureStats(failures) {
  const counts = {};
  for (const f of failures) counts[f.failureType] = (counts[f.failureType] || 0) + 1;
  return {
    total: failures.length,
    active: failures.filter((f) => f.status === 'ACTIVE').length,
    resolved: failures.filter((f) => f.status === 'RESOLVED').length,
    byType: Object.entries(counts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
  };
}

// Availability = uptime / (uptime + downtime) x 100. One monitor cycle represents one interval of time.
function availabilityStats({ upCycles, totalCycles, intervalMs }) {
  const down = totalCycles - upCycles;
  return {
    percent: percent(upCycles, totalCycles),
    monitoredCycles: totalCycles,
    upCycles,
    downCycles: down,
    uptimeSec: round((upCycles * intervalMs) / 1000, 0),
    downtimeSec: round((down * intervalMs) / 1000, 0),
  };
}

// rows: [{ instanceName, checks, healthyChecks }]
function instanceAvailability(rows) {
  return rows
    .map((r) => ({ ...r, availability: percent(r.healthyChecks, r.checks) }))
    .sort((a, b) => instanceNumber(a.instanceName) - instanceNumber(b.instanceName)
      || a.instanceName.localeCompare(b.instanceName));
}

function scalingStats(events) {
  const finished = events.filter((e) => e.status !== 'IN_PROGRESS');
  return {
    total: events.length,
    scaleOut: events.filter((e) => e.action === 'SCALE_OUT').length,
    scaleIn: events.filter((e) => e.action === 'SCALE_IN').length,
    successful: finished.filter((e) => e.status === 'SUCCESS').length,
    failed: finished.filter((e) => e.status === 'FAILED').length,
  };
}

// The newest `limit` finished automatic recoveries, oldest first (for the "recovery time" chart).
function recoveryTimeline(events, limit = 20) {
  return events
    .filter((e) => isAutoRecovery(e) && e.status !== 'IN_PROGRESS')
    .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
    .slice(-limit)
    .map((e) => ({
      t: e.startedAt,
      name: e.action === 'REPLACE' && e.newInstance ? `${e.oldInstance} > ${e.newInstance}` : e.instanceName,
      action: e.action,
      duration: e.duration ?? 0,
      status: e.status,
    }));
}

module.exports = {
  RECOVERY_ACTIONS, isAutoRecovery, recoveryStats, detectionStats, failureStats,
  availabilityStats, instanceAvailability, scalingStats, recoveryTimeline,
};