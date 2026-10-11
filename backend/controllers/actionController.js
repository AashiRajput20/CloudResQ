// Manual actions from the dashboard / API: restart, replace, simulate.
const mongoose = require('mongoose');
const Service = require('../models/Service');
const Instance = require('../models/Instance');
const RecoveryEvent = require('../models/RecoveryEvent');
const recovery = require('../recovery/recoveryController');
const simulation = require('../services/simulationService');

const { httpError } = simulation;
const DOCKER_DOWN = ['ENOENT', 'ECONNREFUSED', 'EACCES'];

function handleError(err, res, next) {
  if (err.code === 'RECOVERY_BUSY') return res.status(409).json({ error: err.message });
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (DOCKER_DOWN.includes(err.code)) {
    return res.status(503).json({ error: 'Cannot reach Docker Engine. Is Docker Desktop running?' });
  }
  if (err.statusCode === 404) return res.status(404).json({ error: 'The container no longer exists' });
  if (err.name === 'TimeoutError' || err.cause) return res.status(502).json({ error: 'Could not reach the app inside the container' });
  return next(err);
}

async function loadInstance(id) {
  if (!mongoose.isValidObjectId(id)) throw httpError(400, 'Invalid instance id');
  const instance = await Instance.findById(id);
  if (!instance) throw httpError(404, 'Instance not found');
  const service = await Service.findById(instance.serviceId);
  return { instance, service };
}

async function loadService(id) {
  if (!mongoose.isValidObjectId(id)) throw httpError(400, 'Invalid service id');
  const service = await Service.findById(id);
  if (!service) throw httpError(404, 'Service not found');
  return service;
}

// POST /api/instances/:id/restart   (waits for the result)
exports.restartInstance = async (req, res, next) => {
  try {
    const { instance, service } = await loadInstance(req.params.id);
    const { event, done } = await recovery.restartInstance({
      service, instance, reason: 'Manual restart requested from the dashboard',
    });
    await done;
    res.json(await RecoveryEvent.findById(event._id));
  } catch (err) {
    handleError(err, res, next);
  }
};

// POST /api/instances/:id/replace
exports.replaceInstance = async (req, res, next) => {
  try {
    const { instance, service } = await loadInstance(req.params.id);
    const { event, done } = await recovery.replaceInstance({
      service, instance, reason: 'Manual replacement requested from the dashboard',
    });
    await done;
    res.json(await RecoveryEvent.findById(event._id));
  } catch (err) {
    handleError(err, res, next);
  }
};

// POST /api/instances/:id/simulate   body: { "type": "health" | "persistent" | "crash" | "cpu" | "memory" | "latency" | "recovery" }
exports.simulateInstance = async (req, res, next) => {
  try {
    const { instance } = await loadInstance(req.params.id);
    res.json(await simulation.simulate(instance, req.body?.type || 'health'));
  } catch (err) {
    handleError(err, res, next);
  }
};

// POST /api/services/:id/restart   (rolling restart: one instance at a time)
exports.restartService = async (req, res, next) => {
  try {
    const service = await loadService(req.params.id);
    const instances = await Instance.find({ serviceId: service._id }).sort({ instanceName: 1 });
    const results = [];
    for (const instance of instances) {
      try {
        const { event, done } = await recovery.restartInstance({
          service, instance, reason: `Rolling restart of ${service.name}`,
        });
        await done;
        const e = await RecoveryEvent.findById(event._id);
        results.push({ instance: instance.instanceName, status: e.status, duration: e.duration });
      } catch (err) {
        results.push({ instance: instance.instanceName, status: 'SKIPPED', error: err.message });
      }
    }
    res.json({ service: service.name, results });
  } catch (err) {
    handleError(err, res, next);
  }
};

// POST /api/services/:id/simulate-failure   body: { "instance": "app-2", "type": "health" }
// POST /api/services/:id/simulate-recovery  body: { "instance": "app-2" }  (omit instance = clear all)
const simulateOnService = (defaultType) => async (req, res, next) => {
  try {
    const service = await loadService(req.params.id);
    const name = req.body?.instance;
    if (!name && defaultType !== 'recovery') {
      throw httpError(400, 'Body must include "instance", for example {"instance":"app-2"}');
    }
    const type = defaultType === 'recovery' ? 'recovery' : (req.body?.type || 'health');

    const filter = { serviceId: service._id };
    if (name) filter.instanceName = name;
    const instances = await Instance.find(filter);
    if (instances.length === 0) throw httpError(404, 'No matching instance');

    const out = [];
    for (const instance of instances) {
      try {
        out.push({ instance: instance.instanceName, ...(await simulation.simulate(instance, type)) });
      } catch (err) {
        out.push({ instance: instance.instanceName, error: err.message });
      }
    }
    res.json({ type, results: out });
  } catch (err) {
    handleError(err, res, next);
  }
};
exports.simulateFailureOnService = simulateOnService('health');
exports.simulateRecoveryOnService = simulateOnService('recovery');