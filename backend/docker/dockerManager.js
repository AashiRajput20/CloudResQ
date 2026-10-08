// Docker Manager: the ONLY module that talks to Docker.
// Everything else in CloudResQ calls these functions.
const docker = require('./dockerClient');
const config = require('../config');

const cfg = config.docker;

// Labels set in docker-compose.yml. We find containers with these, never by ID.
const LABEL = {
  managed: 'cloudresq.managed',
  service: 'cloudresq.service',
  instance: 'cloudresq.instance',
};

const round = (n, digits = 1) => Number(n.toFixed(digits));
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const sleepTimeoutName = 'TimeoutError';

// `ref` can be a container name or a container ID.
const getContainer = (ref) => docker.getContainer(ref);

const hostPortOf = (info) => {
  const bindings = info.NetworkSettings?.Ports?.[`${cfg.containerPort}/tcp`];
  return bindings && bindings[0] ? parseInt(bindings[0].HostPort, 10) : null;
};

// ---------- Discovery ----------

async function ping() {
  try {
    await docker.ping();
    return true;
  } catch {
    return false;
  }
}

// All containers (running or stopped) that carry cloudresq.managed=true
async function listManagedContainers() {
  const list = await docker.listContainers({
    all: true,
    filters: { label: [`${LABEL.managed}=true`] },
  });

  return list
    .map((c) => {
      const port = (c.Ports || []).find((p) => p.PrivatePort === cfg.containerPort && p.PublicPort);
      return {
        containerId: c.Id,
        name: c.Names[0].replace(/^\//, ''),
        serviceLabel: c.Labels[LABEL.service],
        instanceName: c.Labels[LABEL.instance],
        state: c.State,       // running | exited | created ...
        statusText: c.Status, // "Up 5 minutes", "Exited (1) 3 seconds ago"
        hostPort: port ? port.PublicPort : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// ---------- Inspection ----------

async function getContainerStatus(ref) {
  try {
    const info = await getContainer(ref).inspect();
    return {
      exists: true,
      containerId: info.Id,
      name: info.Name.replace(/^\//, ''),
      state: info.State.Status, // running | exited | ...
      running: info.State.Running,
      exitCode: info.State.ExitCode,
      oomKilled: info.State.OOMKilled,
      startedAt: info.State.StartedAt,
      finishedAt: info.State.FinishedAt,
      // Docker's own auto-restart counter. It stays 0 because restart policy is "no".
      // CloudResQ keeps its own restart count in MongoDB.
      dockerRestartCount: info.RestartCount,
      hostPort: hostPortOf(info),
    };
  } catch (err) {
    if (err.statusCode === 404) return { exists: false, running: false, state: 'removed' };
    throw err;
  }
}

// Calls the app's own /health endpoint and measures response time.
async function getContainerHealth(ref) {
  const status = await getContainerStatus(ref);

  if (!status.running) {
    return { reachable: false, healthy: false, httpStatus: null, responseTimeMs: null, error: `container ${status.state}` };
  }
  if (!status.hostPort) {
    return { reachable: false, healthy: false, httpStatus: null, responseTimeMs: null, error: 'no published port' };
  }

  const url = `http://${cfg.healthHost}:${status.hostPort}/health`;
  const start = process.hrtime.bigint();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(cfg.healthTimeoutMs) });
    const responseTimeMs = round(Number(process.hrtime.bigint() - start) / 1e6, 2);
    return {
      reachable: true,
      healthy: res.ok, // 200-299
      httpStatus: res.status,
      responseTimeMs,
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      reachable: false,
      healthy: false,
      httpStatus: null,
      responseTimeMs: null,
      error: err.name === sleepTimeoutName ? 'timeout' : (err.cause?.code || err.message),
    };
  }
}

// CPU % is relative to the container's CPU limit; memory % to its memory limit.
async function getContainerStats(ref) {
  const container = getContainer(ref);
  const info = await container.inspect();
  if (!info.State.Running) return null;

  const s = await container.stats({ stream: false });

  const cpuTotal = s.cpu_stats?.cpu_usage?.total_usage || 0;
  const preCpuTotal = s.precpu_stats?.cpu_usage?.total_usage || 0;
  const systemDelta = (s.cpu_stats?.system_cpu_usage || 0) - (s.precpu_stats?.system_cpu_usage || 0);
  const cpuDelta = cpuTotal - preCpuTotal;
  const onlineCpus = s.cpu_stats?.online_cpus || 1;
  const limitCores = info.HostConfig.NanoCpus ? info.HostConfig.NanoCpus / 1e9 : onlineCpus;

  let cpuPercent = 0;
  if (preCpuTotal > 0 && cpuDelta > 0 && systemDelta > 0) {
    cpuPercent = ((cpuDelta / systemDelta) * onlineCpus * 100) / limitCores;
  }

  // Docker counts file cache as "used"; subtract it like `docker stats` does.
  const cache = s.memory_stats?.stats?.inactive_file ?? s.memory_stats?.stats?.cache ?? 0;
  const memUsedBytes = Math.max(0, (s.memory_stats?.usage || 0) - cache);
  const memLimitBytes = s.memory_stats?.limit || 0;

  return {
    cpuPercent: round(clamp(cpuPercent, 0, 100)),
    memoryUsedMB: round(memUsedBytes / 1024 / 1024),
    memoryLimitMB: round(memLimitBytes / 1024 / 1024),
    memoryPercent: memLimitBytes ? round(clamp((memUsedBytes / memLimitBytes) * 100, 0, 100)) : 0,
  };
}

// ---------- Actions ----------

async function restartContainer(ref) {
  await getContainer(ref).restart({ t: cfg.stopTimeoutSec });
}

async function stopContainer(ref) {
  try {
    await getContainer(ref).stop({ t: cfg.stopTimeoutSec });
  } catch (err) {
    if (err.statusCode !== 304) throw err; // 304 = already stopped
  }
}

async function startContainer(ref) {
  try {
    await getContainer(ref).start();
  } catch (err) {
    if (err.statusCode !== 304) throw err; // 304 = already running
  }
}

async function removeContainer(ref) {
  try {
    await getContainer(ref).remove({ force: true, v: true });
  } catch (err) {
    if (err.statusCode !== 404) throw err; // 404 = already gone
  }
}

// Creates and starts a new managed instance (used by REPLACE and SCALE_OUT later).
// Same settings as docker-compose.yml: labels, network, limits, no auto-restart.
async function createContainer({ serviceLabel, instanceName, hostPort }) {
  const name = `cloudresq-${instanceName}`;
  const portKey = `${cfg.containerPort}/tcp`;

  const container = await docker.createContainer({
    name,
    Image: cfg.image,
    Env: [`INSTANCE_ID=${instanceName}`, `PORT=${cfg.containerPort}`],
    Labels: {
      [LABEL.managed]: 'true',
      [LABEL.service]: serviceLabel,
      [LABEL.instance]: instanceName,
    },
    ExposedPorts: { [portKey]: {} },
    HostConfig: {
      PortBindings: { [portKey]: [{ HostPort: String(hostPort) }] },
      NetworkMode: cfg.network,
      Memory: cfg.memoryLimitMB * 1024 * 1024,
      NanoCpus: Math.round(cfg.cpuLimit * 1e9),
      RestartPolicy: { Name: 'no' }, // CloudResQ decides recovery, not Docker
    },
  });

  await container.start();
  return { containerId: container.id, name, instanceName, hostPort };
}

// Reads the app's own request counters (used to compute the error rate).
async function getAppStatus(hostPort) {
  if (!hostPort) return null;
  try {
    const res = await fetch(`http://${cfg.healthHost}:${hostPort}/api/status`, {
      signal: AbortSignal.timeout(cfg.healthTimeoutMs),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return { requestCount: d.requestCount, errorCount: d.errorCount };
  } catch {
    return null;
  }
}

module.exports = {
  LABEL,
  ping,
  listManagedContainers,
  getContainerStatus,
  getContainerHealth,
  getContainerStats,
  getAppStatus,
  restartContainer,
  stopContainer,
  startContainer,
  removeContainer,
  createContainer,
};