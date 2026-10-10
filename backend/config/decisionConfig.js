// All Decision Engine thresholds in one place. Nothing is hardcoded in the rules:
// values come from .env through config/index.js, with defaults.
const config = require('./index');

module.exports = {
  // Restart / replace
  consecutiveFailuresBeforeRestart: config.monitor.failureThreshold,          // 3
  maxRestartsBeforeReplacement: config.decision.maxRestartsBeforeReplacement, // 3
  failuresBeforeUnstable: config.detection.repeatedFailureCount,              // 3 failures ...
  failureWindowMinutes: config.detection.repeatedFailureWindowMinutes,        // ... in 10 minutes

  // Scale out
  cpuScaleOutThreshold: config.detection.cpuThreshold,         // 85
  memoryScaleOutThreshold: config.detection.memoryThreshold,   // 85
  cpuSustainSeconds: config.detection.cpuSustainSeconds,       // 60
  memorySustainSeconds: config.detection.memorySustainSeconds, // 60

  // Scale in
  cpuScaleInThreshold: config.decision.cpuScaleInThreshold,             // 20
  scaleInSustainSeconds: config.decision.scaleInSustainSeconds,         // 60
  lowTrafficRequestsPerCycle: config.decision.lowTrafficRequestsPerCycle, // 5

  // Defaults, used when a Service has no limits of its own
  minimumReplicas: config.decision.minimumReplicas, // 2
  maximumReplicas: config.decision.maximumReplicas, // 5
};