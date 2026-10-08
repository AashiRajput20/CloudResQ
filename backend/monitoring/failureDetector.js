// Failure Detector: turns monitor observations into Failure records.
//  - Availability failures come from the status the monitor already decided
//    (UNHEALTHY -> HEALTH_CHECK_FAILED, FAILED -> CONTAINER_DOWN).
//  - Resource failures (CPU, memory, latency, error rate) use a sliding-window average.
//  - REPEATED_FAILURE counts availability failures of one instance in a time window.
// It only RECORDS. Deciding what to do about a failure is the Decision Engine's job.
const config = require('../config');
const Failure = require('../models/Failure');
const Instance = require('../models/Instance');
const SampleWindow = require('./sampleWindow');

const cfg = config.detection;
const AVAILABILITY = ['CONTAINER_DOWN', 'HEALTH_CHECK_FAILED'];

const windows = new Map();  // "instanceId:TYPE" -> SampleWindow
const counters = new Map(); // instanceId -> last seen { requestCount, errorCount }
const lastErrorRates = new Map(); // instanceId -> latest error-rate sample (read by the Analyzer)

const round = (n) => Math.round(n * 10) / 10;
const isFor = (f, inst) => String(f.instanceId) === String(inst._id);
const findActive = (active, inst, types) =>
  active.find((f) => f.status === 'ACTIVE' && isFor(f, inst) && types.includes(f.failureType));

// Error rate = 5xx responses / all responses since the previous check.
// Too little traffic (just our own probes) counts as 0%, so it cannot raise a false alarm.
function errorRateSample(o) {
  const { requestCount, errorCount } = o.probe;
  if (requestCount == null) return null;
  const id = String(o.instance._id);
  const prev = counters.get(id);
  counters.set(id, { requestCount, errorCount });
  if (!prev || requestCount < prev.requestCount) return 0; // first look, or the container restarted
  const dReq = requestCount - prev.requestCount;
  const dErr = errorCount - prev.errorCount;
  return dReq < cfg.minRequestsForErrorRate ? 0 : (dErr / dReq) * 100;
}

const RESOURCE_RULES = [
  {
    type: 'HIGH_CPU', label: 'CPU usage', unit: '%',
    threshold: cfg.cpuThreshold, sustain: cfg.cpuSustainSeconds,
    value: (o) => o.probe.cpuPercent, severity: () => 'MEDIUM',
  },
  {
    type: 'HIGH_MEMORY', label: 'memory usage', unit: '%',
    threshold: cfg.memoryThreshold, sustain: cfg.memorySustainSeconds,
    value: (o) => o.probe.memoryPercent, severity: (avg) => (avg >= 95 ? 'HIGH' : 'MEDIUM'),
  },
  {
    type: 'HIGH_LATENCY', label: 'response time', unit: ' ms',
    threshold: cfg.latencyThresholdMs, sustain: cfg.latencySustainSeconds,
    value: (o) => o.probe.responseTimeMs, severity: () => 'MEDIUM',
  },
  {
    type: 'HIGH_ERROR_RATE', label: 'error rate', unit: '%',
    threshold: cfg.errorRateThreshold, sustain: cfg.errorRateSustainSeconds,
    value: errorRateSample, severity: () => 'HIGH',
  },
];

function getWindow(inst, rule) {
  const key = `${inst._id}:${rule.type}`;
  if (!windows.has(key)) windows.set(key, new SampleWindow(rule.sustain, config.monitor.intervalMs));
  return windows.get(key);
}

const snapshot = (o) => ({
  cpuPercent: o.probe.cpuPercent,
  memoryPercent: o.probe.memoryPercent,
  responseTimeMs: o.probe.responseTimeMs,
  httpStatus: o.probe.httpStatus,
  consecutiveFailures: o.instance.consecutiveFailures,
});

// Creates an ACTIVE failure and adds it to the in-memory list for this cycle.
async function open(service, o, active, fields) {
  const now = new Date();
  const occurredAt = fields.occurredAt || now;
  const doc = await Failure.create({
    serviceId: service._id,
    instanceId: o.instance._id,
    instanceName: o.instance.instanceName,
    status: 'ACTIVE',
    detectedAt: now,
    // Detection time only makes sense when we know when the problem started.
    detectionTimeSec: fields.occurredAt ? round((now - occurredAt) / 1000) : null,
    metrics: snapshot(o),
    ...fields,
    occurredAt,
  });
  active.push(doc);
  console.log(`[Detector] ${doc.instanceName}: ${doc.failureType} detected (${doc.severity}) - ${doc.message}`);
  return doc;
}

async function close(failure, resolution) {
  failure.status = 'RESOLVED';
  failure.resolvedAt = new Date();
  failure.resolution = resolution;
  await failure.save();
  console.log(`[Detector] ${failure.instanceName}: ${failure.failureType} resolved (${resolution})`);
}

function recentAvailabilityCount(serviceId, instanceName) {
  const since = new Date(Date.now() - cfg.repeatedFailureWindowMinutes * 60 * 1000);
  return Failure.countDocuments({
    serviceId, instanceName, failureType: { $in: AVAILABILITY }, detectedAt: { $gte: since },
  });
}

// ---------- 1. Container down / health check failed ----------
// Returns true if a NEW availability failure was created in this cycle.
async function checkAvailability(service, o, active) {
  const inst = o.instance;
  const current = findActive(active, inst, AVAILABILITY);

  if (inst.status === 'UNHEALTHY' || inst.status === 'FAILED') {
    const type = inst.status === 'FAILED' ? 'CONTAINER_DOWN' : 'HEALTH_CHECK_FAILED';
    const message = type === 'CONTAINER_DOWN'
      ? `Container is not running (${o.probe.error || 'unknown'}) after ${inst.consecutiveFailures} failed checks`
      : `Health endpoint failed ${inst.consecutiveFailures} consecutive checks (${o.probe.error || 'no response'})`;

    if (current) {
      // Same outage that got worse (e.g. app was unhealthy, then the container died): update it.
      if (current.failureType !== type) {
        current.failureType = type;
        current.message = message;
        await current.save();
      }
      return false;
    }

    const count = (await recentAvailabilityCount(service._id, inst.instanceName)) + 1;
    await open(service, o, active, {
      failureType: type,
      severity: 'HIGH',
      message,
      failureCount: count,
      occurredAt: inst.firstFailureAt || new Date(),
    });
    await Instance.updateOne({ _id: inst._id }, { $inc: { failureCount: 1 } });
    return true;
  }

  if (inst.status === 'HEALTHY' && current) await close(current, 'Instance healthy again');
  return false;
}

// ---------- 2. CPU / memory / latency / error rate ----------
async function checkResources(service, o, active) {
  const inst = o.instance;
  const running = o.probe.containerState === 'running';

  for (const rule of RESOURCE_RULES) {
    const current = findActive(active, inst, [rule.type]);
    const win = getWindow(inst, rule);

    if (!running) { // a stopped container has no CPU or memory to judge
      win.clear();
      if (current) await close(current, 'Container stopped');
      continue;
    }

    const value = rule.value(o);
    if (rule.type === 'HIGH_ERROR_RATE' && value != null) lastErrorRates.set(String(inst._id), value);    if (value != null) win.add(value);
    if (!win.ready) continue; // not enough data yet; keep any existing failure as it is

    const avg = win.average;
    const breached = avg >= rule.threshold;

    if (breached && !current) {
      await open(service, o, active, {
        failureType: rule.type,
        severity: rule.severity(avg),
        message: `Average ${rule.label} was ${round(avg)}${rule.unit} over the last ${rule.sustain} s (threshold ${rule.threshold}${rule.unit})`,
      });
    } else if (!breached && current) {
      await close(current, `Average ${rule.label} back to ${round(avg)}${rule.unit}`);
    }
  }
}

// ---------- 3. Repeated failure ----------
async function checkRepeated(service, o, active, createdNow) {
  const inst = o.instance;
  const current = findActive(active, inst, ['REPEATED_FAILURE']);
  if (!createdNow && !current) return; // nothing new, nothing to resolve

  const count = await recentAvailabilityCount(service._id, inst.instanceName);

  if (!current && count >= cfg.repeatedFailureCount) {
    await open(service, o, active, {
      failureType: 'REPEATED_FAILURE',
      severity: 'CRITICAL',
      failureCount: count,
      message: `${inst.instanceName} failed ${count} times in the last ${cfg.repeatedFailureWindowMinutes} minutes (limit ${cfg.repeatedFailureCount})`,
    });
  } else if (current && count < cfg.repeatedFailureCount) {
    await close(current, 'Failure rate back below the limit');
  }
}

// Called by the Health Monitor after each cycle with one observation per instance:
//   { instance: <Instance doc after update>, probe: { healthy, containerState, cpuPercent, ... } }
async function detect(service, observations) {
  const active = await Failure.find({ serviceId: service._id, status: 'ACTIVE' });

  for (const o of observations) {
    const created = await checkAvailability(service, o, active);
    await checkResources(service, o, active);
    await checkRepeated(service, o, active, created);
  }

  // Instances that no longer exist (removed or replaced) cannot be failing any more.
  await Failure.updateMany(
    {
      serviceId: service._id,
      status: 'ACTIVE',
      instanceName: { $nin: observations.map((o) => o.instance.instanceName) },
    },
    { $set: { status: 'RESOLVED', resolvedAt: new Date(), resolution: 'Instance removed' } }
  );
}

module.exports = {
  detect,
  getLastErrorRate: (instanceId) => lastErrorRates.get(String(instanceId)) ?? null,
};