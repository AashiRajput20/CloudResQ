// Decides an instance's new status after one health check.
//   WARNING   : 1 or 2 failed checks in a row
//   UNHEALTHY : threshold reached, container is running but the app fails
//   FAILED    : threshold reached, container is not running
function evaluateHealthState({ previousFailures = 0, healthy, containerRunning, threshold }) {
  if (healthy) return { consecutiveFailures: 0, status: 'HEALTHY' };

  const consecutiveFailures = previousFailures + 1; // keeps counting past the threshold
  if (consecutiveFailures < threshold) return { consecutiveFailures, status: 'WARNING' };

  return { consecutiveFailures, status: containerRunning ? 'UNHEALTHY' : 'FAILED' };
}

module.exports = { evaluateHealthState };