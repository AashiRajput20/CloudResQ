// Picks the name and host port for a NEW instance (used by REPLACE, and by scaling in Phase 13).
// app-1..app-3 use ports 3001..3003, so app-N uses port 3000 + N.
const instanceNumber = (name) => {
  const m = /^app-(\d+)$/.exec(name || '');
  return m ? parseInt(m[1], 10) : 0;
};

// `containers` = the output of dockerManager.listManagedContainers() (running AND stopped)
function nextSlot(containers, { basePort = 3000, maxPort = 3099 } = {}) {
  const highest = Math.max(0, ...containers.map((c) => instanceNumber(c.instanceName)));
  const usedPorts = new Set(containers.map((c) => c.hostPort).filter(Boolean));

  const n = highest + 1; // names are never reused while a higher number exists
  let port = basePort + n;
  while (usedPorts.has(port) && port <= maxPort) port += 1;
  if (port > maxPort) throw new Error('No free host port left for a new instance');

  return { instanceName: `app-${n}`, hostPort: port };
}

module.exports = { nextSlot, instanceNumber };