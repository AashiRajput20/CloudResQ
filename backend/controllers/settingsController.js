// System Settings: shows every live threshold and lets an admin change replica limits.
// Thresholds themselves come from .env (restart the backend to change them); this page makes them visible.
const mongoose = require('mongoose');
const config = require('../config');
const decisionConfig = require('../config/decisionConfig');
const Service = require('../models/Service');
const healthMonitor = require('../monitoring/healthMonitor');

const HARD_MAX_REPLICAS = 8; // protects an 8 GB laptop

const item = (label, value, env, unit = '') => ({ label, value, env, unit });
const section = (title, description, items) => ({ title, description, items });

function buildSections() {
  const m = config.monitor;
  const d = config.detection;
  const r = config.recovery;
  const s = config.scaling;
  return [
    section('Health monitoring', 'How often instances are checked and when they count as failed.', [
      item('Monitor running', healthMonitor.getStatus().running, 'MONITOR_ENABLED'),
      item('Check interval', m.intervalMs, 'HEALTH_CHECK_INTERVAL', 'ms'),
      item('Failed checks before UNHEALTHY', m.failureThreshold, 'FAILURE_THRESHOLD'),
      item('Health check timeout', config.docker.healthTimeoutMs, 'HEALTH_TIMEOUT_MS', 'ms'),
      item('Health history kept for', m.historyHours, 'HEALTH_HISTORY_HOURS', 'hours'),
    ]),
    section('Failure detection', 'Resource failures use a sliding-window average, so one spike does not count.', [
      item('High CPU threshold', d.cpuThreshold, 'CPU_SCALE_OUT_THRESHOLD', '%'),
      item('High CPU must last', d.cpuSustainSeconds, 'CPU_SUSTAIN_SECONDS', 's'),
      item('High memory threshold', d.memoryThreshold, 'MEMORY_SCALE_OUT_THRESHOLD', '%'),
      item('High memory must last', d.memorySustainSeconds, 'MEMORY_SUSTAIN_SECONDS', 's'),
      item('High latency threshold', d.latencyThresholdMs, 'LATENCY_THRESHOLD_MS', 'ms'),
      item('High latency must last', d.latencySustainSeconds, 'LATENCY_SUSTAIN_SECONDS', 's'),
      item('High error rate threshold', d.errorRateThreshold, 'ERROR_RATE_THRESHOLD', '% of 5xx'),
      item('Repeated failure: failures', d.repeatedFailureCount, 'REPEATED_FAILURE_COUNT'),
      item('Repeated failure: window', d.repeatedFailureWindowMinutes, 'REPEATED_FAILURE_WINDOW_MINUTES', 'minutes'),
    ]),
    section('Decision Engine', 'Rule-based thresholds used by the rules (Rules 1 to 10).', [
      item('Decision Engine enabled', config.decision.enabled, 'DECISION_ENGINE_ENABLED'),
      item('Max restarts before REPLACE', decisionConfig.maxRestartsBeforeReplacement, 'MAX_RESTARTS_BEFORE_REPLACEMENT'),
      item('Failures before UNSTABLE', decisionConfig.failuresBeforeUnstable, 'REPEATED_FAILURE_COUNT'),
      item('Failure window', decisionConfig.failureWindowMinutes, 'REPEATED_FAILURE_WINDOW_MINUTES', 'minutes'),
      item('Scale-out CPU / memory threshold', `${decisionConfig.cpuScaleOutThreshold} / ${decisionConfig.memoryScaleOutThreshold}`, 'CPU_SCALE_OUT_THRESHOLD, MEMORY_SCALE_OUT_THRESHOLD', '%'),
      item('Scale-in CPU threshold', decisionConfig.cpuScaleInThreshold, 'CPU_SCALE_IN_THRESHOLD', '%'),
      item('Scale-in CPU must stay low for', decisionConfig.scaleInSustainSeconds, 'SCALE_IN_SUSTAIN_SECONDS', 's'),
      item('Low traffic means at most', decisionConfig.lowTrafficRequestsPerCycle, 'LOW_TRAFFIC_REQUESTS_PER_CYCLE', 'requests per check'),
      item('Default min / max replicas', `${decisionConfig.minimumReplicas} / ${decisionConfig.maximumReplicas}`, 'MIN_REPLICAS, MAX_REPLICAS'),
    ]),
    section('Recovery', 'How actions are executed and verified.', [
      item('Automatic recovery', r.autoEnabled, 'AUTO_RECOVERY'),
      item('Verification timeout', r.verifyTimeoutMs, 'RECOVERY_VERIFY_TIMEOUT_MS', 'ms'),
      item('Healthy checks needed to verify', r.verifySuccesses, 'RECOVERY_VERIFY_SUCCESSES'),
      item('RECOVERED shown for', r.recoveredDisplaySeconds, 'RECOVERED_DISPLAY_SECONDS', 's'),
      item('Retry after a failed replace', r.retryCooldownSeconds, 'RECOVERY_RETRY_COOLDOWN_SECONDS', 's'),
    ]),
    section('Scaling', 'Horizontal scaling behaviour.', [
      item('Automatic scaling', s.autoEnabled, 'AUTO_SCALING'),
      item('Cooldown between scaling actions', s.cooldownSeconds, 'SCALING_COOLDOWN_SECONDS', 's'),
      item('Drain time before removing an instance', s.drainSeconds, 'SCALE_IN_DRAIN_SECONDS', 's'),
    ]),
    section('Infrastructure', 'Optional components.', [
      item('Nginx load balancer', config.nginx.enabled, 'NGINX_ENABLED'),
      item('Redis events', config.redis.enabled, 'REDIS_ENABLED'),
      item('App memory limit', config.docker.memoryLimitMB, 'APP_MEMORY_LIMIT_MB', 'MB'),
      item('App CPU limit', config.docker.cpuLimit, 'APP_CPU_LIMIT', 'cores'),
    ]),
  ];
}

// GET /api/settings
exports.getSettings = async (req, res, next) => {
  try {
    const services = await Service.find().sort({ name: 1 }).lean();
    res.json({
      sections: buildSections(),
      hardMaxReplicas: HARD_MAX_REPLICAS,
      services: services.map((s) => ({
        _id: s._id, name: s.name, minimumReplicas: s.minimumReplicas, maximumReplicas: s.maximumReplicas,
        desiredReplicas: s.desiredReplicas, currentReplicas: s.currentReplicas,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/settings/services/:id/limits   body: { minimumReplicas, maximumReplicas }
exports.updateLimits = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid service id' });
    const service = await Service.findById(req.params.id);
    if (!service) return res.status(404).json({ error: 'Service not found' });

    const min = Number(req.body?.minimumReplicas);
    const max = Number(req.body?.maximumReplicas);
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      return res.status(400).json({ error: 'Minimum and maximum replicas must be whole numbers' });
    }
    if (min < 1) return res.status(400).json({ error: 'Minimum replicas must be at least 1' });
    if (min > max) return res.status(400).json({ error: 'Minimum replicas cannot exceed maximum replicas' });
    if (max > HARD_MAX_REPLICAS) {
      return res.status(400).json({ error: `Maximum replicas cannot exceed ${HARD_MAX_REPLICAS} on this machine` });
    }

    service.minimumReplicas = min;
    service.maximumReplicas = max;
    service.desiredReplicas = Math.min(max, Math.max(min, service.desiredReplicas)); // keep min <= desired <= max
    await service.save(); // the model validates again; the next monitor cycle uses the new limits

    res.json({
      _id: service._id, name: service.name, minimumReplicas: service.minimumReplicas,
      maximumReplicas: service.maximumReplicas, desiredReplicas: service.desiredReplicas,
      currentReplicas: service.currentReplicas,
    });
  } catch (err) {
    next(err);
  }
};