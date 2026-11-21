// Prometheus HTTP service discovery: one scrape target per running managed container.
// Containers are reached by name on the Docker network, so nothing is hardcoded.
function buildTargets(containers, port) {
  return containers
    .filter((c) => c.state === 'running' && c.instanceName)
    .map((c) => ({
      targets: [`${c.name}:${port}`],
      labels: { instance_name: c.instanceName, service: c.serviceLabel || 'unknown' },
    }));
}

module.exports = { buildTargets };