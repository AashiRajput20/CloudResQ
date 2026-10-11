// Runs the Decision Engine for a whole service:
//  1. builds the Analyzer's view of every instance
//  2. adds service-level facts (replicas, average CPU, traffic)
//  3. asks the engine for a decision per instance
//  4. keeps ONE service-level scaling proposal
//  5. logs decisions that CHANGED; those are flagged isNew so the Recovery Controller executes them
const Service = require('../models/Service');
const Instance = require('../models/Instance');
const Decision = require('../models/Decision');
const decisionConfig = require('../config/decisionConfig');
const failureDetector = require('../monitoring/failureDetector');
const { analyzeInstance } = require('./analysisService');
const { evaluateInstance } = require('../decision-engine/decisionEngine');

const lowCpuSince = new Map(); // serviceId -> ms timestamp since average CPU stayed below the scale-in threshold
const lastLogged = new Map();  // instanceId -> "action|traffic|rule" of the last logged decision

// If several instances ask for the same service-level action, keep only one.
function keepOne(decisions, match, pickLast = false) {
  const hits = decisions.filter(match);
  if (hits.length <= 1) return;
  const keep = pickLast ? hits[hits.length - 1] : hits[0];
  for (const d of hits) {
    if (d === keep) continue;
    d.reason = `Service-level ${keep.action} is already proposed through ${keep.instanceName}.`;
    d.action = 'NO_ACTION';
    d.priority = 'LOW';
    d.rule = 'SERVICE_LEVEL_DEDUP';
    d.blockedBy = null;
    d.scale = null;
  }
}

// While the Recovery Controller works on an instance, the engine waits for the result.
function recoveringDecision(instance, service, facts) {
  return {
    instanceName: instance.instanceName,
    action: 'NO_ACTION',
    trafficAction: null,
    priority: 'LOW',
    confidence: 1,
    rule: 'RECOVERY_IN_PROGRESS',
    reason: `${instance.instanceName} is being recovered right now, so the engine waits for the result before deciding again.`,
    blockedBy: null,
    scale: null,
    trigger: null,
    decidedAt: new Date().toISOString(),
    instanceId: instance._id,
    serviceId: service._id,
    serviceName: service.name,
    inTraffic: instance.inTraffic !== false,
    inputs: {
      health: 'RECOVERING', failureType: null, failureCount: 0,
      consecutiveFailures: instance.consecutiveFailures || 0, recentRestarts: 0, failedRestarts: 0,
      cpu: instance.cpuUsage, memory: instance.memoryUsage, responseTimeMs: instance.responseTimeMs,
      errorRate: null, service: facts,
    },
  };
}

async function evaluateService(service, { track = false } = {}) {
  const instances = await Instance.find({ serviceId: service._id }).sort({ instanceName: 1 });
  if (instances.length === 0) return [];

  const running = instances.filter((i) => i.status !== 'FAILED' && i.status !== 'UNKNOWN');
  const healthy = instances.filter((i) => i.status === 'HEALTHY' || i.status === 'RECOVERED');
  const avgCpu = running.length ? running.reduce((s, i) => s + (i.cpuUsage || 0), 0) / running.length : null;

  // How long has the average CPU been below the scale-in threshold? (only the monitor updates this)
  const key = String(service._id);
  const now = Date.now();
  if (track) {
    if (avgCpu != null && avgCpu < decisionConfig.cpuScaleInThreshold) {
      if (!lowCpuSince.has(key)) lowCpuSince.set(key, now);
    } else {
      lowCpuSince.delete(key);
    }
  }
  const since = lowCpuSince.get(key);

  // Traffic = busiest running instance (requests since the last check, including our own probes)
  const deltas = running.map((i) => failureDetector.getLastRequestDelta(i._id));
  const requestsPerCycle = deltas.length > 0 && deltas.every((d) => d != null) ? Math.max(...deltas) : null;

  const facts = {
    currentReplicas: instances.length,
    healthyReplicas: healthy.length,
    minimumReplicas: service.minimumReplicas,
    maximumReplicas: service.maximumReplicas,
    avgCpu: avgCpu == null ? null : Math.round(avgCpu * 10) / 10,
    cpuLowForSeconds: since ? Math.round((now - since) / 1000) : 0,
    requestsPerCycle,
  };

  const results = [];
  for (const instance of instances) {
    if (instance.status === 'RECOVERING') {
      results.push(recoveringDecision(instance, service, facts));
      continue;
    }
    const analysis = await analyzeInstance(instance, service);
    const decision = evaluateInstance({ analysis, inTraffic: instance.inTraffic !== false, service: facts });
    results.push({
      ...decision,
      instanceId: instance._id,
      serviceId: service._id,
      serviceName: service.name,
      inTraffic: instance.inTraffic !== false,
      inputs: {
        health: analysis.health,
        failureType: analysis.failureType,
        failureCount: analysis.failureCount,
        consecutiveFailures: analysis.consecutiveFailures,
        recentRestarts: analysis.recentRestarts,
        failedRestarts: analysis.failedRestarts,
        cpu: analysis.cpu,
        memory: analysis.memory,
        responseTimeMs: analysis.responseTimeMs,
        errorRate: analysis.errorRate,
        service: facts,
      },
    });
  }

  keepOne(results, (d) => d.action === 'SCALE_OUT');
  keepOne(results, (d) => d.action === 'SCALE_IN', true);
  keepOne(results, (d) => d.action === 'ALERT' && d.blockedBy === 'MAX_REPLICAS');
  return results;
}

// Used by the live API: evaluates now, saves nothing, changes no tracking state.
async function evaluateAll({ serviceId } = {}) {
  const services = await Service.find(serviceId ? { _id: serviceId } : {});
  const all = [];
  for (const service of services) all.push(...(await evaluateService(service)));
  return all;
}

// Saves a decision only when it CHANGED for that instance, so the log is not flooded every 5 s.
// New decisions get isNew + decisionId, which is how the Recovery Controller knows what to execute.
async function logDecisions(results) {
  for (const d of results) {
    const id = String(d.instanceId);
    if (d.action === 'NO_ACTION' && !d.trafficAction) {
      lastLogged.delete(id); // back to normal: the next problem is logged again
      continue;
    }
    const sig = `${d.action}|${d.trafficAction}|${d.rule}`;
    if (lastLogged.get(id) === sig) continue;
    lastLogged.set(id, sig);

    const doc = await Decision.create({
      serviceId: d.serviceId, serviceName: d.serviceName,
      instanceId: d.instanceId, instanceName: d.instanceName,
      action: d.action, trafficAction: d.trafficAction,
      priority: d.priority, confidence: d.confidence,
      reason: d.reason, rule: d.rule, trigger: d.trigger,
      blockedBy: d.blockedBy, scale: d.scale, inputs: d.inputs,
      status: 'PROPOSED',
    });
    d.isNew = true;
    d.decisionId = doc._id;

    const traffic = d.trafficAction ? ` + ${d.trafficAction}` : '';
    console.log(`[Decision] ${d.instanceName}: ${d.action}${traffic} (${d.priority}, confidence ${d.confidence}) - ${d.reason}`);
  }
}

// Lets the engine propose the same decision again (used after a failed REPLACE, following a cooldown).
function forget(instanceId) {
  lastLogged.delete(String(instanceId));
}

// Called by the Health Monitor after each cycle. Returns the decisions (new ones are flagged).
async function run(service) {
  const results = await evaluateService(service, { track: true });
  await logDecisions(results);
  return results;
}

module.exports = { evaluateService, evaluateAll, run, forget };