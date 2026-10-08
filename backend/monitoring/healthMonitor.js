// Health Monitor: checks every managed container on a schedule, stores the result,
// and updates each Instance's status using the "N consecutive failures" rule.
// After each cycle it hands its observations to the Failure Detector.
const config = require('../config');
const dockerManager = require('../docker/dockerManager');
const Service = require('../models/Service');
const Instance = require('../models/Instance');
const HealthCheck = require('../models/HealthCheck');
const { ensureService } = require('../services/serviceRegistry');
const { evaluateHealthState } = require('./healthState');
const failureDetector = require('./failureDetector');

const cfg = config.monitor;

const state = {
  running: false,
  timer: null,
  cycles: 0,
  lastCycleAt: null,
  lastCycleDurationMs: null,
  lastError: null,
};
let inFlight = null; // the cycle currently running (prevents two cycles at once)

// One look at one container: is it healthy, and how busy is it?
async function probe(c) {
  if (c.state !== 'running') {
    return {
      healthy: false, containerState: c.state, httpStatus: null, responseTimeMs: null,
      error: `container ${c.state}`, cpuPercent: 0, memoryPercent: 0,
      requestCount: null, errorCount: null,
    };
  }
  const [health, stats, app] = await Promise.all([
    dockerManager.getContainerHealth(c.containerId),
    dockerManager.getContainerStats(c.containerId).catch(() => null),
    dockerManager.getAppStatus(c.hostPort),
  ]);
  return {
    healthy: health.healthy,
    containerState: 'running',
    httpStatus: health.httpStatus,
    responseTimeMs: health.responseTimeMs,
    error: health.error,
    cpuPercent: stats?.cpuPercent ?? 0,
    memoryPercent: stats?.memoryPercent ?? 0,
    requestCount: app?.requestCount ?? null,
    errorCount: app?.errorCount ?? null,
  };
}

// Handles all containers that belong to one service.
async function processGroup(label, list) {
  const service = await ensureService(label, list.length);
  const existing = await Instance.find({ serviceId: service._id });
  const previous = new Map(existing.map((i) => [i.instanceName, i]));

  const results = await Promise.all(list.map(probe));
  const now = new Date();
  const checks = [];
  const statuses = [];
  const observations = [];

  await Promise.all(
    list.map(async (c, idx) => {
      const r = results[idx];
      const prev = previous.get(c.instanceName);

      const next = evaluateHealthState({
        previousFailures: prev?.consecutiveFailures || 0,
        healthy: r.healthy,
        containerRunning: c.state === 'running',
        threshold: cfg.failureThreshold,
      });

      const set = {
        containerId: c.containerId,
        status: next.status,
        consecutiveFailures: next.consecutiveFailures,
        cpuUsage: r.cpuPercent,
        memoryUsage: r.memoryPercent,
        responseTimeMs: r.responseTimeMs,
        lastError: r.error,
        lastHealthCheck: now,
      };
      if (!prev || prev.status !== next.status) set.statusChangedAt = now;
      // Remember when the current failure streak began (used for detection time).
      if (next.consecutiveFailures === 0) set.firstFailureAt = null;
      else if (next.consecutiveFailures === 1) set.firstFailureAt = now;

      if (prev && prev.status !== next.status) {
        console.log(`[Monitor] ${c.instanceName}: ${prev.status} -> ${next.status} (${r.error || 'ok'})`);
      }

      const instance = await Instance.findOneAndUpdate(
        { serviceId: service._id, instanceName: c.instanceName },
        { $set: set },
        { upsert: true, new: true }
      );

      checks.push({
        serviceId: service._id,
        instanceId: instance._id,
        instanceName: c.instanceName,
        containerState: r.containerState,
        healthy: r.healthy,
        httpStatus: r.httpStatus,
        responseTimeMs: r.responseTimeMs,
        error: r.error,
        cpuPercent: r.cpuPercent,
        memoryPercent: r.memoryPercent,
        consecutiveFailures: next.consecutiveFailures,
        statusAfter: next.status,
        checkedAt: now,
      });
      statuses.push(next.status);
      observations.push({ instance, probe: r });
    })
  );

  await HealthCheck.insertMany(checks);

  // Instances whose container no longer exists
  await Instance.deleteMany({
    serviceId: service._id,
    instanceName: { $nin: list.map((c) => c.instanceName) },
  });

  // The detector must never break monitoring.
  try {
    await failureDetector.detect(service, observations);
  } catch (err) {
    console.warn(`[Detector] failed: ${err.message}`);
  }

  const healthy = statuses.filter((s) => s === 'HEALTHY').length;
  const serviceStatus = healthy === statuses.length ? 'HEALTHY' : healthy === 0 ? 'FAILED' : 'WARNING';
  await Service.updateOne(
    { _id: service._id },
    { currentReplicas: list.filter((c) => c.state === 'running').length, status: serviceStatus }
  );

  return { service: service.name, containers: list.length, healthy, status: serviceStatus };
}

// One full check of every managed container.
async function cycle() {
  const started = Date.now();
  const containers = await dockerManager.listManagedContainers();

  const groups = new Map();
  for (const c of containers) {
    if (!c.serviceLabel || !c.instanceName) continue;
    if (!groups.has(c.serviceLabel)) groups.set(c.serviceLabel, []);
    groups.get(c.serviceLabel).push(c);
  }

  const summary = [];
  for (const [label, list] of groups) summary.push(await processGroup(label, list));

  state.cycles += 1;
  state.lastCycleAt = new Date();
  state.lastCycleDurationMs = Date.now() - started;
  if (state.cycles === 1) {
    console.log(`[Monitor] first cycle done in ${state.lastCycleDurationMs} ms:`, JSON.stringify(summary));
  }
  return summary;
}

// Runs one cycle now. If a cycle is already running, joins it instead of starting another.
function runOnce() {
  if (!inFlight) inFlight = cycle().finally(() => { inFlight = null; });
  return inFlight;
}

// Schedules the next cycle AFTER the current one finishes, so cycles never overlap.
async function loop() {
  const started = Date.now();
  try {
    await runOnce();
    if (state.lastError) console.log('[Monitor] recovered from earlier error');
    state.lastError = null;
  } catch (err) {
    if (err.message !== state.lastError) console.warn(`[Monitor] cycle failed: ${err.message}`);
    state.lastError = err.message;
  }
  if (!state.running) return;
  const delay = Math.max(0, cfg.intervalMs - (Date.now() - started));
  state.timer = setTimeout(loop, delay);
}

function start() {
  if (state.running) return;
  state.running = true;
  console.log(`[Monitor] started: every ${cfg.intervalMs} ms, UNHEALTHY after ${cfg.failureThreshold} failed checks`);
  loop();
}

function stop() {
  state.running = false;
  clearTimeout(state.timer);
  console.log('[Monitor] stopped');
}

function getStatus() {
  return {
    running: state.running,
    intervalMs: cfg.intervalMs,
    failureThreshold: cfg.failureThreshold,
    cycles: state.cycles,
    lastCycleAt: state.lastCycleAt,
    lastCycleDurationMs: state.lastCycleDurationMs,
    lastError: state.lastError,
  };
}

module.exports = { start, stop, runOnce, getStatus };