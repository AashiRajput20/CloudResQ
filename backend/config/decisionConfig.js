// All Decision Engine thresholds in one place. Nothing here is hardcoded in the rules:
// values come from .env through config/index.js, with defaults.
const config = require('./index');

module.exports = {
  consecutiveFailuresBeforeRestart: config.monitor.failureThreshold, // 3
  maxRestartsBeforeReplacement: config.decision.maxRestartsBeforeReplacement, // 3
  failuresBeforeUnstable: config.detection.repeatedFailureCount, // 3 failures ...
  failureWindowMinutes: config.detection.repeatedFailureWindowMinutes, // ... in 10 minutes

  cpuScaleOutThreshold: config.detection.cpuThreshold, // 85
  memoryScaleOutThreshold: config.detection.memoryThreshold, // 85
  cpuScaleInThreshold: config.decision.cpuScaleInThreshold, // 20

  minimumReplicas: config.decision.minimumReplicas, // 2
  maximumReplicas: config.decision.maximumReplicas, // 5
};