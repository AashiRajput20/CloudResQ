// Reads the stored history and turns it into the numbers shown on the Dashboard and Analytics pages.
const mongoose = require('mongoose');
const config = require('../config');
const Service = require('../models/Service');
const Instance = require('../models/Instance');
const Failure = require('../models/Failure');
const HealthCheck = require('../models/HealthCheck');
const RecoveryEvent = require('../models/RecoveryEvent');
const ScalingEvent = require('../models/ScalingEvent');
const Decision = require('../models/Decision');
const calc = require('../analytics/calculations');

const HEALTHY = ['HEALTHY', 'RECOVERED'];
const UNHEALTHY = ['UNHEALTHY', 'FAILED'];

async function getAnalytics({ serviceId, minutes } = {}) {
  const windowMinutes = Math.min(Math.max(parseInt(minutes, 10) || 60, 5), 1440); // health checks live 24 h
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  const intervalMs = config.monitor.intervalMs;
  const scope = serviceId ? { serviceId: new mongoose.Types.ObjectId(serviceId) } : {};

  const [
    recoveryEvents, failures, scalingEvents, cycleRows, instanceRows, decisionRows,
    services, instances, activeFailures,
  ] = await Promise.all([
    RecoveryEvent.find({
      ...scope, simulated: { $ne: true }, action: { $in: calc.RECOVERY_ACTIONS }, startedAt: { $gte: since },
    }).lean(),
    Failure.find({ ...scope, detectedAt: { $gte: since } }).lean(),
    ScalingEvent.find({ ...scope, startedAt: { $gte: since } }).lean(),

    // Service availability: was at least one instance healthy in each monitor cycle?
    HealthCheck.aggregate([
      { $match: { ...scope, checkedAt: { $gte: since } } },
      { $group: { _id: { t: '$checkedAt', s: '$serviceId' }, anyHealthy: { $max: { $cond: ['$healthy', 1, 0] } } } },
      { $group: { _id: null, total: { $sum: 1 }, up: { $sum: '$anyHealthy' } } },
    ]),
    // Instance availability: share of passed health checks per instance
    HealthCheck.aggregate([
      { $match: { ...scope, checkedAt: { $gte: since } } },
      {
        $group: {
          _id: { s: '$serviceId', n: '$instanceName' },
          checks: { $sum: 1 },
          healthyChecks: { $sum: { $cond: ['$healthy', 1, 0] } },
        },
      },
    ]),
    Decision.aggregate([
      { $match: { ...scope, decidedAt: { $gte: since } } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
    ]),

    Service.find(serviceId ? { _id: serviceId } : {}).lean(),
    Instance.find(scope).lean(),
    Failure.countDocuments({ ...scope, status: 'ACTIVE' }),
  ]);

  const cycles = cycleRows[0] || { total: 0, up: 0 };

  return {
    minutes: windowMinutes,
    since,
    generatedAt: new Date(),
    intervalMs,

    // Live numbers (not limited to the time window)
    overview: {
      totalServices: services.length,
      totalInstances: instances.length,
      healthyInstances: instances.filter((i) => HEALTHY.includes(i.status)).length,
      unhealthyInstances: instances.filter((i) => UNHEALTHY.includes(i.status)).length,
      otherInstances: instances.filter((i) => !HEALTHY.includes(i.status) && !UNHEALTHY.includes(i.status)).length,
      activeReplicas: services.reduce((sum, s) => sum + (s.currentReplicas || 0), 0),
      activeFailures,
    },

    recovery: calc.recoveryStats(recoveryEvents),
    detection: calc.detectionStats(failures),
    failures: calc.failureStats(failures),
    availability: {
      service: calc.availabilityStats({ upCycles: cycles.up, totalCycles: cycles.total, intervalMs }),
      instances: calc.instanceAvailability(
        instanceRows.map((r) => ({ instanceName: r._id.n, serviceId: r._id.s, checks: r.checks, healthyChecks: r.healthyChecks }))
      ),
    },
    scaling: calc.scalingStats(scalingEvents),
    decisions: {
      byAction: decisionRows.map((r) => ({ action: r._id, count: r.count })).sort((a, b) => b.count - a.count),
    },
    timeline: calc.recoveryTimeline(recoveryEvents),
  };
}

module.exports = { getAnalytics };