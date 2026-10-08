// Gathers everything the Analyzer needs about ONE instance from MongoDB.
const decisionConfig = require('../config/decisionConfig');
const Failure = require('../models/Failure');
const RecoveryEvent = require('../models/RecoveryEvent');
const failureDetector = require('../monitoring/failureDetector');
const { AVAILABILITY } = require('./failureAnalyzer');

async function buildContext(instance, service) {
  const since = new Date(Date.now() - decisionConfig.failureWindowMinutes * 60 * 1000);
  const byInstance = { serviceId: service._id, instanceName: instance.instanceName };

  const [activeFailures, recentFailureCount, recentRestartEvents, lastRecovery] = await Promise.all([
    Failure.find({ ...byInstance, status: 'ACTIVE' }),
    Failure.countDocuments({ ...byInstance, failureType: { $in: AVAILABILITY }, detectedAt: { $gte: since } }),
    RecoveryEvent.find({ ...byInstance, action: 'RESTART', startedAt: { $gte: since } }),
    RecoveryEvent.findOne(byInstance).sort({ startedAt: -1 }),
  ]);

  return {
    instance,
    activeFailures,
    recentFailureCount,
    recentRestarts: recentRestartEvents.length,
    failedRestarts: recentRestartEvents.filter((e) => e.status === 'FAILED').length,
    lastRecovery,
    errorRate: failureDetector.getLastErrorRate(instance._id),
  };
}

module.exports = { buildContext };