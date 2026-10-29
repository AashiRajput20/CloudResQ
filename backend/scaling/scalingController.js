// Scaling Controller: EXECUTES SCALE_OUT and SCALE_IN.
//   SCALE_OUT  create next instance -> wait until healthy -> add to the traffic pool
//   SCALE_IN   take the newest instance out of traffic -> drain -> remove it
// Every action is stored in scalingEvents. A cooldown prevents flapping.
const config = require('../config');
const dockerManager = require('../docker/dockerManager');
const Service = require('../models/Service');
const Instance = require('../models/Instance');
const ScalingEvent = require('../models/ScalingEvent');
const Decision = require('../models/Decision');
const decisionService = require('../services/decisionService');
const loadBalancer = require('../loadbalancer/trafficManager');
const eventBus = require('../events/eventBus');
const { slugify } = require('../services/serviceRegistry');
const { nextSlot } = require('../recovery/instanceNaming');
const shared = require('../recovery/shared');
const { canScale, pickScaleInTarget, triggerFor, cooldownRemaining } = require('./scalingRules');

const cfg = config.scaling;
const busyServices = new Set(); // one scaling action per service at a time
const lastScaleAt = new Map();  // serviceId -> ms of the last finished scaling action

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code });
const isScaling = (serviceId) => busyServices.has(String(serviceId));

async function finishEvent(event, status, extra = {}) {
  event.status = status;
  event.completedAt = new Date();
  event.duration = Math.round((event.completedAt - event.startedAt) / 100) / 10;
  Object.assign(event, extra);
  await event.save();
  eventBus.publish('scaling.completed', {
    instance: event.instanceName, serviceId: String(event.serviceId), action: event.action,
    status: event.status, previousReplicas: event.previousReplicas, newReplicas: event.newReplicas,
    duration: event.duration, error: event.error || null,
  });
  return event;
}

async function facts(service) {
  const instances = await Instance.find({ serviceId: service._id }).sort({ instanceName: 1 });
  const healthy = instances.filter((i) => ['HEALTHY', 'RECOVERED'].includes(i.status));
  return {
    instances,
    replicas: instances.length,
    healthyReplicas: healthy.length,
    min: service.minimumReplicas,
    max: service.maximumReplicas,
  };
}

// ---------- SCALE OUT ----------
async function runScaleOut(ctx, event, slot, label) {
  const { service } = ctx;
  let created = null;
  try {
    created = await dockerManager.createContainer({
      serviceLabel: label, instanceName: slot.instanceName, hostPort: slot.hostPort,
    });
    const v = await shared.verifyHealthy(created.containerId);
    if (!v.ok) {
      throw new Error(`New instance ${slot.instanceName} was not healthy after ${v.waitedSec} s (${v.error || 'no response'})`);
    }

    // Register it right away, so it joins Nginx now and not on the next monitor cycle.
    const now = new Date();
    await Instance.updateOne(
      { serviceId: service._id, instanceName: slot.instanceName },
      { $set: { containerId: created.containerId, status: 'HEALTHY', inTraffic: true, consecutiveFailures: 0, lastHealthCheck: now, statusChangedAt: now } },
      { upsert: true }
    );
    await Service.updateOne({ _id: service._id }, { $set: { desiredReplicas: event.newReplicas, currentReplicas: event.newReplicas } });
    await finishEvent(event, 'SUCCESS');
    await loadBalancer.sync();

    console.log(`[Scaling] ${service.name}: SCALE_OUT ${event.previousReplicas} -> ${event.newReplicas} in ${event.duration} s (new instance ${slot.instanceName} on port ${slot.hostPort})`);
    await shared.closeDecision(ctx.decisionId, 'EXECUTED', `Scaled out ${event.previousReplicas} -> ${event.newReplicas}: ${slot.instanceName} created in ${event.duration} s`);
  } catch (err) {
    if (created) await dockerManager.removeContainer(created.containerId).catch(() => {});
    await finishEvent(event, 'FAILED', { error: err.message });
    console.warn(`[Scaling] ${service.name}: SCALE_OUT failed - ${err.message}`);
    await shared.closeDecision(ctx.decisionId, 'FAILED', `SCALE_OUT failed: ${err.message}`);
  }
}

// ---------- SCALE IN ----------
async function runScaleIn(ctx, event, target) {
  const { service } = ctx;
  try {
    // 1. stop sending traffic to it
    await Instance.updateOne(
      { _id: target._id },
      { $set: { status: 'SCALING', inTraffic: false, statusChangedAt: new Date() } }
    );
    await loadBalancer.sync();
    // 2. let requests that are already running finish
    await shared.sleep(cfg.drainSeconds * 1000);
    // 3. remove it (marked first, so an in-flight monitor cycle does not recreate its record)
    shared.markRemoved(target.containerId);
    await dockerManager.removeContainer(target.containerId);
    await Instance.deleteOne({ _id: target._id });
    await Service.updateOne({ _id: service._id }, { $set: { desiredReplicas: event.newReplicas, currentReplicas: event.newReplicas } });
    await finishEvent(event, 'SUCCESS');
    await loadBalancer.sync();

    console.log(`[Scaling] ${service.name}: SCALE_IN ${event.previousReplicas} -> ${event.newReplicas} in ${event.duration} s (removed ${target.instanceName})`);
    await shared.closeDecision(ctx.decisionId, 'EXECUTED', `Scaled in ${event.previousReplicas} -> ${event.newReplicas}: ${target.instanceName} removed in ${event.duration} s`);
  } catch (err) {
    // put it back; the monitor corrects the status on its next cycle
    await Instance.updateOne({ _id: target._id }, { $set: { status: 'HEALTHY', inTraffic: true } }).catch(() => {});
    await finishEvent(event, 'FAILED', { error: err.message });
    console.warn(`[Scaling] ${service.name}: SCALE_IN failed - ${err.message}`);
    await shared.closeDecision(ctx.decisionId, 'FAILED', `SCALE_IN failed: ${err.message}`);
  }
}

// ---------- starting a scaling action ----------
// ctx = { service, source, reason, trigger, triggerInstance, triggerInstanceId, priority, confidence, decisionId, target }
// Validates and records the event (quick), then runs the slow part in the background.
// Resolves to { event, done }.
async function scale(action, ctx) {
  const { service } = ctx;
  const svcKey = String(service._id);
  if (busyServices.has(svcKey)) throw httpError(409, `${service.name} is already scaling`, 'SCALING_BUSY');
  busyServices.add(svcKey);

  let instKey = null;
  let event;
  let run;
  try {
    const f = await facts(service);
    const check = canScale(action, f);
    if (!check.ok) {
      throw httpError(409, `Cannot ${action === 'SCALE_OUT' ? 'scale out' : 'scale in'}: ${check.reason}`, 'SCALE_BLOCKED');
    }

    const previous = f.replicas;
    const next = action === 'SCALE_OUT' ? previous + 1 : previous - 1;
    const label = slugify(service.name);
    let slot = null;
    let target = null;

    if (action === 'SCALE_OUT') {
      slot = nextSlot(await dockerManager.listManagedContainers());
    } else {
      target = ctx.target || pickScaleInTarget(f.instances);
      if (!target) throw httpError(409, 'Cannot scale in: no healthy instance can be removed', 'SCALE_BLOCKED');
      instKey = shared.lockKey(service._id, target.instanceName);
      if (!shared.tryLock(instKey)) {
        instKey = null;
        throw httpError(409, `${target.instanceName} is being recovered, so it cannot be removed now`, 'SCALING_BUSY');
      }
    }

    event = await ScalingEvent.create({
      serviceId: service._id, serviceName: service.name, action,
      previousReplicas: previous, newReplicas: next,
      instanceName: slot ? slot.instanceName : target.instanceName,
      reason: ctx.reason, trigger: ctx.trigger || 'MANUAL', triggerInstance: ctx.triggerInstance || null,
      source: ctx.source, priority: ctx.priority || null, confidence: ctx.confidence ?? null,
      decisionId: ctx.decisionId || null, status: 'IN_PROGRESS', startedAt: new Date(), timestamp: new Date(),
    });
    await Service.updateOne({ _id: service._id }, { $set: { status: 'SCALING' } });
    if (ctx.decisionId) await Decision.updateOne({ _id: ctx.decisionId }, { $set: { status: 'EXECUTING' } });

    eventBus.publish('scaling.request', {
      instance: event.instanceName, serviceId: svcKey, action, source: ctx.source,
      previousReplicas: previous, newReplicas: next, reason: ctx.reason,
    });
    console.log(`[Scaling] ${service.name}: ${action} started (${previous} -> ${next}, ${ctx.source.toLowerCase()})`);

    run = action === 'SCALE_OUT' ? runScaleOut(ctx, event, slot, label) : runScaleIn(ctx, event, target);
  } catch (err) {
    busyServices.delete(svcKey);
    if (instKey) shared.unlock(instKey);
    throw err;
  }

  const done = run
    .catch((err) => console.error(`[Scaling] unexpected error - ${err.message}`))
    .finally(() => {
      busyServices.delete(svcKey);
      if (instKey) shared.unlock(instKey);
      lastScaleAt.set(svcKey, Date.now());
      // If the load is still there when the cooldown ends, let the engine propose again.
      if (ctx.source === 'AUTO' && ctx.triggerInstanceId) {
        setTimeout(() => decisionService.forget(ctx.triggerInstanceId), cfg.cooldownSeconds * 1000 + 1000).unref();
      }
      loadBalancer.sync();
    });
  return { event, done };
}

// ---------- executing the Decision Engine's SCALE_OUT / SCALE_IN ----------
// ctx comes from the Recovery Controller: { service, instance, decisionId, ... }; d is the decision.
async function handleDecision(ctx, d) {
  const { service } = ctx;
  const skip = (note) => shared.closeDecision(ctx.decisionId, 'SKIPPED', note);
  const retryAfter = (ms) => setTimeout(() => decisionService.forget(d.instanceId), ms).unref();

  if (!cfg.autoEnabled) return skip('Auto-scaling is turned off (AUTO_SCALING=false)');

  const left = cooldownRemaining(lastScaleAt.get(String(service._id)), Date.now(), cfg.cooldownSeconds);
  if (left > 0) {
    retryAfter(left + 1000);
    return skip(`Cooldown: another scaling action finished less than ${cfg.cooldownSeconds} s ago. Evaluated again in ${Math.ceil(left / 1000)} s.`);
  }

  try {
    await scale(d.action, {
      service, source: 'AUTO', reason: d.reason, trigger: triggerFor(d.rule),
      triggerInstance: d.instanceName, triggerInstanceId: d.instanceId,
      priority: d.priority, confidence: d.confidence, decisionId: d.decisionId,
      target: d.action === 'SCALE_IN' ? ctx.instance : null,
    });
  } catch (err) {
    const skipped = ['SCALING_BUSY', 'SCALE_BLOCKED'].includes(err.code);
    await shared.closeDecision(ctx.decisionId, skipped ? 'SKIPPED' : 'FAILED', err.message);
    retryAfter(cfg.cooldownSeconds * 1000);
  }
}

// On startup: scaling events left "in progress" belong to a run that was stopped midway.
async function init() {
  const r = await ScalingEvent.updateMany(
    { status: 'IN_PROGRESS' },
    { $set: { status: 'FAILED', error: 'Backend stopped during scaling', completedAt: new Date() } }
  );
  if (r.modifiedCount) console.log(`[Scaling] closed ${r.modifiedCount} unfinished scaling event(s) from a previous run`);
  console.log(`[Scaling] auto-scaling is ${cfg.autoEnabled ? 'ON' : 'OFF (decisions are only logged)'}, cooldown ${cfg.cooldownSeconds} s`);
}

module.exports = { init, scale, handleDecision, isScaling };