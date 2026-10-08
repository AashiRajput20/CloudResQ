// Tries every Docker Manager function from the terminal.
//   npm run docker:test                -> read-only checks
//   npm run docker:test -- --mutate    -> also restarts app-1 and creates/removes a temp app-9
const dm = require('../docker/dockerManager');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const show = (label, value) => {
  console.log(`\n--- ${label} ---`);
  console.log(value);
};

// Polls /health until it returns 200. Returns seconds taken, or null on timeout.
async function waitUntilHealthy(ref, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const h = await dm.getContainerHealth(ref);
    if (h.healthy) return (Date.now() - start) / 1000;
    await sleep(500);
  }
  return null;
}

async function main() {
  if (!(await dm.ping())) {
    console.error('Docker Engine not reachable. Is Docker Desktop running?');
    process.exit(1);
  }
  console.log('Docker Engine: connected');

  const containers = await dm.listManagedContainers();
  show('1. listManagedContainers', containers.map((c) => `${c.name}  ${c.state}  port=${c.hostPort}  ${c.statusText}`));
  if (containers.length === 0) {
    console.error('\nNo managed containers found. Run: docker compose up -d');
    process.exit(1);
  }

  const target = containers[0];
  show(`2. getContainerStatus(${target.name})`, await dm.getContainerStatus(target.name));
  show(`3. getContainerHealth(${target.name})`, await dm.getContainerHealth(target.name));
  show(`4. getContainerStats(${target.name})`, await dm.getContainerStats(target.name));

  if (!process.argv.includes('--mutate')) {
    console.log('\nRead-only checks done. Add "-- --mutate" to also test restart/create/remove.');
    return;
  }

  // ----- restart + recovery time -----
  console.log(`\n--- 5. restartContainer(${target.name}) ---`);
  const t0 = Date.now();
  await dm.restartContainer(target.name);
  const restartSec = (Date.now() - t0) / 1000;
  const healthySec = await waitUntilHealthy(target.name);
  console.log(`restart call took ${restartSec.toFixed(1)}s, healthy again after ${healthySec?.toFixed(1) ?? 'TIMEOUT'}s more`);

  // ----- create / stop / start / remove a temporary instance -----
  const TEMP = { serviceLabel: 'demo-service', instanceName: 'app-9', hostPort: 3009 };
  console.log('\n--- 6. createContainer / stop / start / removeContainer (temp app-9) ---');
  await dm.removeContainer('cloudresq-app-9'); // clean up leftovers from an earlier run

  const created = await dm.createContainer(TEMP);
  console.log('created:', created.name);
  console.log('healthy after:', (await waitUntilHealthy(created.name))?.toFixed(1), 's');

  await dm.stopContainer(created.name);
  console.log('after stop :', (await dm.getContainerStatus(created.name)).state);

  await dm.startContainer(created.name);
  console.log('after start:', (await dm.getContainerStatus(created.name)).state);

  await dm.removeContainer(created.name);
  console.log('after remove:', (await dm.getContainerStatus(created.name)).state);

  console.log('\nAll Docker Manager functions work.');
}

main().catch((err) => {
  console.error('\nTest failed:', err.message);
  process.exit(1);
});