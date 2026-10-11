// Recovery Controller: EXECUTES the Decision Engine's decisions and VERIFIES the result.
//   RESTART             remove from traffic -> restart -> wait until healthy -> RECOVERED
//   REPLACE             create new instance -> wait until healthy -> remove the old one
//   REMOVE/ADD_TO_TRAFFIC  update the traffic pool (Nginx applies it in Phase 11)
//   ALERT               logged;  SCALE_OUT / SCALE_IN are skipped until Phase 13
// Every action is recorded in the recoveryEvents collection, with its duration and result.
const config = require('../config');
const dockerManager = require('../docker/dockerManager');
const Instance = require('../models/Instance');
const Decision = require('../models/Decision');
const RecoveryEvent = require('../models/RecoveryEvent');
const decisionService = require('../services/decisionService');
const { slugify } = require('../services/serviceRegistry');
const { nextSlot } = require('./instanceNaming');
const loadBalancer = require('../loadbalancer/trafficManager');

const cfg = config.recovery;
const busy = new Set(); // "serviceId:instanceName" of instances being recovered right now
const removedContainers = new Map(); // containerId -> ms when we removed it (so the monitor ignores it)

function markRemoved(containerId) {
  removedContainers.set(containerId, Date.now());
}

// True for 60 s after CloudResQ removed the container, which covers any monitor cycle still in flight.
function wasRemoved(containerId) {
  const t = removedContainers.get(containerId);
  if (!t) return false;
  if (Date.now() - t > 60000) {
    removedContainers.delete(containerId);
    return false;
  }
  return true;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lockKey = (serviceId, instanceName) => `${serviceId}:${instanceName}`;

class RecoveryBusyError extends Error {
  constructor(name) {
    super(`${name} is already being recovered`);
    this.code = 'RECOVERY_BUSY';
  }
}

// The Health Monitor asks this so it does not count failures during a recovery.
const isBusy = (serviceId, instanceName) => busy.has(lockKey(serviceId, instanceName));

// ---------- helpers ----------

async function finishEvent(event, status, extra = {}) {
  event.status = status;
  event.completedAt = new Date();
  event.duration = Math.round((event.completedAt - event.startedAt) / 100) / 10; // seconds, 1 decimal
  Object.assign(event, extra);
  await event.save();
  return event;
}

async function closeDecision(ctx, status, note, event) {
  if (!ctx.decisionId) return;
  await Decision.updateOne(
    { _id: ctx.decisionId },
    { $set: { status, note, executedAt: new Date(), recoveryEventId: event?._id || null } }
  ).catch(() => {});
}

// Verification: /health must pass N times in a row before we call it recovered.
async function verifyHealthy(ref) {
  const started = Date.now();
  let streak = 0;
  let last = null;
  while (Date.now() - started < cfg.verifyTimeoutMs) {
    last = await dockerManager.getContainerHealth(ref).catch((e) => ({ healthy: false, error: e.message }));
    streak = last.healthy ? streak + 1 : 0;
    if (streak >= cfg.verifySuccesses) return { ok: true };
    await sleep(cfg.verifyIntervalMs);
  }
  return { ok: false, error: last?.error, waitedSec: Math.round((Date.now() - started) / 1000) };
}

// After a failed recovery, put the instance back into a failing state so the engine decides again.
async function markStillFailing(instance) {
  const st = await dockerManager.getContainerStatus(instance.containerId).catch(() => ({ running: false }));
  await Instance.updateOne(
    { _id: instance._id },
    { $set: { status: st.running ? 'UNHEALTHY' : 'FAILED', statusChangedAt: new Date() } }
  );
}

// Traffic pool change (REMOVE_FROM_TRAFFIC / ADD_TO_TRAFFIC). Phase 11 makes Nginx follow this flag.
async function setTraffic(ctx, inTraffic) {
  const action = inTraffic ? 'ADD_TO_TRAFFIC' : 'REMOVE_FROM_TRAFFIC';
  const now = new Date();
  await Instance.updateOne({ _id: ctx.instance._id }, { $set: { inTraffic } });
    loadBalancer.sync(); // not awaited: Nginx follows the traffic pool within a moment
  const event = await RecoveryEvent.create({
    serviceId: ctx.service._id, instanceId: ctx.instance._id, instanceName: ctx.instance.instanceName,
    action, reason: ctx.reason, trigger: ctx.trigger, priority: ctx.priority, confidence: ctx.confidence,
    source: ctx.source, decisionId: ctx.decisionId, failureCount: ctx.failureCount,
    status: 'SUCCESS', startedAt: now, completedAt: now, duration: 0,
  });
  console.log(`[Recovery] ${ctx.instance.instanceName}: ${action} done`);
  return event;
}

// ---------- RESTART ----------

async function runRestart(ctx, event) {
  const { instance } = ctx;
  try {
    await dockerManager.restartContainer(instance.containerId);
    const v = await verifyHealthy(instance.containerId);
    if (!v.ok) throw new Error(`Still unhealthy ${v.waitedSec} s after the restart (${v.error || 'no response'})`);

    await finishEvent(event, 'SUCCESS');
    await Instance.updateOne(
      { _id: instance._id },
      { $set: { status: 'RECOVERED', consecutiveFailures: 0, firstFailureAt: null, lastError: null, statusChangedAt: new Date() } }
    );
    console.log(`[Recovery] ${instance.instanceName}: RESTART succeeded in ${event.duration} s`);
    await closeDecision(ctx, 'EXECUTED', `RESTART succeeded in ${event.duration} s`, event);
  } catch (err) {
    await finishEvent(event, 'FAILED', { error: err.message });
    await markStillFailing(instance);
    console.warn(`[Recovery] ${instance.instanceName}: RESTART failed after ${event.duration} s - ${err.message}`);
    await closeDecision(ctx, 'FAILED', `RESTART failed: ${err.message}`, event);
  }
}

// ---------- REPLACE ----------

async function runReplace(ctx, event) {
  const { instance, service } = ctx;
  let created = null;
  try {
    const containers = await dockerManager.listManagedContainers();
    const old = containers.find((c) => c.containerId === instance.containerId)
      || containers.find((c) => c.instanceName === instance.instanceName);
    const label = old?.serviceLabel || slugify(service.name);
    const slot = nextSlot(containers);

    event.oldInstance = instance.instanceName;
    event.newInstance = slot.instanceName;
    await event.save();

    created = await dockerManager.createContainer({
      serviceLabel: label, instanceName: slot.instanceName, hostPort: slot.hostPort,
    });
    const v = await verifyHealthy(created.containerId);
    if (!v.ok) throw new Error(`New instance ${slot.instanceName} was not healthy after ${v.waitedSec} s (${v.error || 'no response'})`);

    // The replacement works, so the old instance can go now (capacity never dropped).
       markRemoved(instance.containerId); // BEFORE removing, so an in-flight monitor cycle skips it
    await dockerManager.removeContainer(instance.containerId);
    await Instance.deleteOne({ _id: instance._id });
    await finishEvent(event, 'SUCCESS');
    console.log(`[Recovery] ${instance.instanceName}: REPLACE succeeded in ${event.duration} s (new instance ${slot.instanceName} on port ${slot.hostPort})`);
    await closeDecision(ctx, 'EXECUTED', `${instance.instanceName} replaced by ${slot.instanceName} in ${event.duration} s`, event);
  } catch (err) {
    if (created) await dockerManager.removeContainer(created.containerId).catch(() => {});
    await finishEvent(event, 'FAILED', { error: err.message, newInstance: null });
    await markStillFailing(instance);
    console.warn(`[Recovery] ${instance.instanceName}: REPLACE failed - ${err.message}`);
    await closeDecision(ctx, 'FAILED', `REPLACE failed: ${err.message}`, event);
    // Let the engine try again after a cooldown instead of every 5 seconds.
    if (ctx.source === 'AUTO') {
      setTimeout(() => decisionService.forget(instance._id), cfg.retryCooldownSeconds * 1000).unref();
    }
  }
}

// ---------- starting a recovery ----------

const withDefaults = (ctx) => ({
  source: 'MANUAL', trigger: 'MANUAL', priority: 'MEDIUM', confidence: null,
  failureCount: 0, decisionId: null, ...ctx,
});

// Takes the lock, records the event and marks the instance RECOVERING (all quick),
// then runs the slow part in the background. Resolves to { event, done }.
async function startRecovery(action, ctx) {
  const { service, instance } = ctx;
  if (!instance.containerId) {
    const err = new Error(`${instance.instanceName} has no container yet`);
    err.status = 409;
    throw err;
  }
  const key = lockKey(service._id, instance.instanceName);
  if (busy.has(key)) throw new RecoveryBusyError(instance.instanceName);
  busy.add(key);

  let event;
  try {
    event = await RecoveryEvent.create({
      serviceId: service._id, instanceId: instance._id, instanceName: instance.instanceName,
      action, reason: ctx.reason, trigger: ctx.trigger, priority: ctx.priority, confidence: ctx.confidence,
      source: ctx.source, decisionId: ctx.decisionId, failureCount: ctx.failureCount,
      status: 'IN_PROGRESS', startedAt: new Date(),
      oldInstance: action === 'REPLACE' ? instance.instanceName : null,
    });
    const update = { $set: { status: 'RECOVERING', statusChangedAt: new Date() } };
    if (action === 'RESTART') update.$inc = { restartCount: 1 };
    await Instance.updateOne({ _id: instance._id }, update);
        loadBalancer.sync(); // a RECOVERING instance leaves the pool
    if (ctx.decisionId) await Decision.updateOne({ _id: ctx.decisionId }, { $set: { status: 'EXECUTING' } });
  } catch (err) {
    busy.delete(key);
    throw err;
  }

  console.log(`[Recovery] ${instance.instanceName}: ${action} started (${ctx.source.toLowerCase()})`);
  const run = action === 'RESTART' ? runRestart : runReplace;
  const done = run(ctx, event)
    .catch((err) => console.error(`[Recovery] ${instance.instanceName}: unexpected error - ${err.message}`))
        .finally(() => {
      busy.delete(key); // released only AFTER the final status was written
      loadBalancer.sync(); // recovered instances rejoin, removed ones leave
    });
  return { event, done };
}

const restartInstance = (ctx) => startRecovery('RESTART', withDefaults(ctx));
const replaceInstance = (ctx) => startRecovery('REPLACE', withDefaults(ctx));

// ---------- executing the Decision Engine's output ----------

async function dispatch(service, d) {
  const instance = await Instance.findById(d.instanceId);
  if (!instance) {
    await Decision.updateOne({ _id: d.decisionId }, { $set: { status: 'SKIPPED', note: 'Instance no longer exists', executedAt: new Date() } });
    return;
  }
  const ctx = withDefaults({
    service, instance, source: 'AUTO', reason: d.reason, trigger: d.trigger, priority: d.priority,
    confidence: d.confidence, failureCount: d.inputs?.failureCount ?? 0, decisionId: d.decisionId,
  });

  // RULE 7 comes first: an unhealthy instance leaves traffic before anything else happens.
  if (d.trafficAction) await setTraffic(ctx, d.trafficAction === 'ADD_TO_TRAFFIC');

  switch (d.action) {
    case 'RESTART':
    case 'REPLACE':
      try {
        await startRecovery(d.action, ctx); // returns as soon as the recovery has started
      } catch (err) {
        const status = err.code === 'RECOVERY_BUSY' ? 'SKIPPED' : 'FAILED';
        await closeDecision(ctx, status, err.message);
      }
      break;

    case 'REMOVE_FROM_TRAFFIC':
    case 'ADD_TO_TRAFFIC': {
      const event = await setTraffic(ctx, d.action === 'ADD_TO_TRAFFIC');
      await closeDecision(ctx, 'EXECUTED', 'Traffic pool updated', event);
      break;
    }

    case 'ALERT':
      console.warn(`[ALERT] ${d.instanceName}: ${d.reason}`);
      await closeDecision(ctx, 'EXECUTED', 'Alert logged');
      break;

    case 'SCALE_OUT':
    case 'SCALE_IN':
      await closeDecision(ctx, 'SKIPPED', 'Scaling is executed from Phase 13');
      break;

    default:
      await closeDecision(ctx, 'SKIPPED', 'Nothing to execute');
  }
}

// Called by the Health Monitor after the Decision Engine ran. Only NEW decisions are executed.
async function handle(service, results) {
  if (!cfg.autoEnabled) return; // proposals only
  for (const d of results) {
    if (!d.isNew) continue;
    try {
      await dispatch(service, d);
    } catch (err) {
      console.warn(`[Recovery] ${d.instanceName}: ${d.action} could not start - ${err.message}`);
      await Decision.updateOne(
        { _id: d.decisionId },
        { $set: { status: 'FAILED', note: err.message, executedAt: new Date() } }
      ).catch(() => {});
    }
  }
}

// On startup: anything still "in progress" belongs to a previous run that was stopped midway.
async function init() {
  const events = await RecoveryEvent.updateMany(
    { status: 'IN_PROGRESS' },
    { $set: { status: 'FAILED', error: 'Backend stopped during the recovery', completedAt: new Date() } }
  );
  await Decision.updateMany({ status: 'EXECUTING' }, { $set: { status: 'FAILED', note: 'Backend stopped during execution' } });
  if (events.modifiedCount) console.log(`[Recovery] closed ${events.modifiedCount} unfinished recovery event(s) from a previous run`);
  console.log(`[Recovery] auto-recovery is ${cfg.autoEnabled ? 'ON' : 'OFF (decisions are only proposed)'}`);
}

module.exports = { init, handle, isBusy, wasRemoved, restartInstance, replaceInstance };