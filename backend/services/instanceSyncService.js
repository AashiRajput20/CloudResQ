// Copies the real Docker containers into MongoDB (Service + Instance records).
// Phase 5: a one-time snapshot on demand. Phase 6 replaces this with continuous monitoring.
const Service = require('../models/Service');
const Instance = require('../models/Instance');
const dockerManager = require('../docker/dockerManager');

// "Demo Service" -> "demo-service" (matches the cloudresq.service label)
const slugify = (s) => s.toLowerCase().trim().replace(/\s+/g, '-');
const titleCase = (slug) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

// One look at a container: health + resource usage.
async function snapshotContainer(c) {
  if (c.state !== 'running') return { status: 'FAILED', cpuUsage: 0, memoryUsage: 0 };

  const [health, stats] = await Promise.all([
    dockerManager.getContainerHealth(c.containerId),
    dockerManager.getContainerStats(c.containerId),
  ]);

  return {
    // A single failed check is only a WARNING. UNHEALTHY needs 3 in a row (Phase 6).
    status: health.healthy ? 'HEALTHY' : 'WARNING',
    cpuUsage: stats ? stats.cpuPercent : 0,
    memoryUsage: stats ? stats.memoryPercent : 0,
  };
}

async function syncFromDocker() {
  const containers = await dockerManager.listManagedContainers();

  // Group containers by their cloudresq.service label
  const groups = new Map();
  for (const c of containers) {
    if (!c.serviceLabel || !c.instanceName) continue;
    if (!groups.has(c.serviceLabel)) groups.set(c.serviceLabel, []);
    groups.get(c.serviceLabel).push(c);
  }

  const allServices = await Service.find();
  const summary = [];

  for (const [label, list] of groups) {
    // Find the Service for this label, or create it
    let service = allServices.find((s) => slugify(s.name) === label);
    if (!service) {
      service = await Service.create({
        name: titleCase(label),
        desiredReplicas: Math.min(5, Math.max(2, list.length)),
      });
    }

    const snapshots = await Promise.all(list.map(snapshotContainer));
    const now = new Date();

    await Promise.all(
      list.map((c, i) =>
        Instance.updateOne(
          { serviceId: service._id, instanceName: c.instanceName },
          { $set: { containerId: c.containerId, ...snapshots[i], lastHealthCheck: now } },
          { upsert: true }
        )
      )
    );

    // Instances in MongoDB whose container no longer exists
    await Instance.deleteMany({
      serviceId: service._id,
      instanceName: { $nin: list.map((c) => c.instanceName) },
    });

    const healthyCount = snapshots.filter((s) => s.status === 'HEALTHY').length;
    const serviceStatus =
      healthyCount === list.length ? 'HEALTHY' : healthyCount === 0 ? 'FAILED' : 'WARNING';

    await Service.updateOne(
      { _id: service._id },
      { currentReplicas: list.filter((c) => c.state === 'running').length, status: serviceStatus }
    );

    summary.push({ service: service.name, containers: list.length, healthy: healthyCount, status: serviceStatus });
  }

  return summary;
}

module.exports = { syncFromDocker };