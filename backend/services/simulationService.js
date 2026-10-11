// Triggers the demo app's own failure simulations (the dashboard's "Simulate" button).
const dockerManager = require('../docker/dockerManager');

const TYPES = {
  health:     { path: '/simulate/failure' },                         // /health returns 503
  persistent: { path: '/simulate/persistent-failure' },              // survives a restart
  crash:      { path: '/simulate/crash' },                           // the process exits
  cpu:        { path: '/simulate/cpu', body: { seconds: 120 } },
  memory:     { path: '/simulate/memory' },
  latency:    { path: '/simulate/latency', body: { ms: 800 } },
  recovery:   { path: '/simulate/recovery' },                        // clears every simulation
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

async function simulate(instance, type) {
  const def = TYPES[type];
  if (!def) throw httpError(400, `Unknown simulation "${type}". Use one of: ${Object.keys(TYPES).join(', ')}`);

  const status = await dockerManager.getContainerStatus(instance.containerId);
  if (!status.running) throw httpError(409, `${instance.instanceName} is not running`);

  return dockerManager.postToApp(status.hostPort, def.path, def.body || {});
}

module.exports = { simulate, TYPES, httpError };