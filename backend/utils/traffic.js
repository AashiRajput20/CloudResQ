// Sends steady traffic through Nginx so the Grafana request-rate and error-rate panels have data.
//   npm run traffic -- 15 60      15 requests per second for 60 seconds (defaults: 10 and 60)
// While an instance is failing (for example after /simulate/failure) its 503 responses show up as errors;
// Nginx retries them on another instance, so the "users" still get an answer.
const base = process.env.TRAFFIC_URL || 'http://localhost:8080';
const rps = Math.min(Math.max(Number(process.argv[2]) || 10, 1), 100);
const seconds = Math.max(Number(process.argv[3]) || 60, 1);
const paths = ['/', '/health', '/api/status'];

const stats = { sent: 0, connectionErrors: 0, byStatus: {} };
let n = 0;

async function hit() {
  const path = paths[n++ % paths.length];
  stats.sent += 1;
  try {
    const res = await fetch(base + path, { signal: AbortSignal.timeout(5000) });
    stats.byStatus[res.status] = (stats.byStatus[res.status] || 0) + 1;
  } catch {
    stats.connectionErrors += 1;
  }
}

const line = () => `sent ${stats.sent} | status ${JSON.stringify(stats.byStatus)} | connection errors ${stats.connectionErrors}`;

console.log(`Sending ${rps} requests/s to ${base} for ${seconds} s (Ctrl+C to stop) ...`);
const sender = setInterval(hit, 1000 / rps);
const reporter = setInterval(() => console.log(`  ${line()}`), 5000);

setTimeout(() => {
  clearInterval(sender);
  clearInterval(reporter);
  setTimeout(() => {
    console.log(`Done: ${line()}`);
    process.exit(0);
  }, 1000);
}, seconds * 1000);