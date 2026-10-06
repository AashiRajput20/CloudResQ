// Tracks request statistics and process CPU usage for this instance.

const WINDOW_SIZE = 100; // error rate and latency use the last 100 requests
const recent = [];       // [{ duration, isError }]
let requestCount = 0;
let errorCount = 0;

// CPU: compare process CPU time against wall-clock time every 2 seconds.
// The value is a percentage of ONE core (can be shown directly in the dashboard).
let lastCpu = process.cpuUsage();
let lastTime = process.hrtime.bigint();
let cpuPercent = 0;

setInterval(() => {
  const now = process.hrtime.bigint();
  const used = process.cpuUsage(lastCpu); // difference since lastCpu, in microseconds
  const elapsedMicros = Number(now - lastTime) / 1000;
  cpuPercent = Math.min(100, ((used.user + used.system) / elapsedMicros) * 100);
  lastCpu = process.cpuUsage();
  lastTime = now;
}, 2000).unref(); // unref: this timer alone will not keep the process alive

function recordRequest(durationMs, statusCode) {
  const isError = statusCode >= 500;
  requestCount += 1;
  if (isError) errorCount += 1;
  recent.push({ duration: durationMs, isError });
  if (recent.length > WINDOW_SIZE) recent.shift();
}

function snapshot() {
  const n = recent.length;
  const avgResponseMs = n ? recent.reduce((sum, r) => sum + r.duration, 0) / n : 0;
  const recentErrors = recent.filter((r) => r.isError).length;
  const mem = process.memoryUsage();

  return {
    uptimeSeconds: Math.round(process.uptime()),
    requestCount,
    errorCount,
    avgResponseTimeMs: Number(avgResponseMs.toFixed(2)),
    errorRate: n ? Number(((recentErrors / n) * 100).toFixed(2)) : 0, // percent, recent window
    cpuPercent: Number(cpuPercent.toFixed(1)),
    memory: {
      rssMB: Number((mem.rss / 1024 / 1024).toFixed(1)),
      heapUsedMB: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
    },
  };
}

module.exports = { recordRequest, snapshot };