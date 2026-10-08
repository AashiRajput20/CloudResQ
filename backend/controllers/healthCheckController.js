const mongoose = require('mongoose');
const Service = require('../models/Service');
const Instance = require('../models/Instance');
const HealthCheck = require('../models/HealthCheck');
const healthMonitor = require('../monitoring/healthMonitor');

// GET /api/health-checks?serviceId=&instance=app-2&failedOnly=true&limit=50
exports.listHealthChecks = async (req, res, next) => {
  try {
    const { serviceId, instance, failedOnly } = req.query;
    const filter = {};
    if (serviceId) {
      if (!mongoose.isValidObjectId(serviceId)) return res.status(400).json({ error: 'Invalid serviceId' });
      filter.serviceId = serviceId;
    }
    if (instance) filter.instanceName = instance;
    if (failedOnly === 'true') filter.healthy = false;

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    res.json(await HealthCheck.find(filter).sort({ checkedAt: -1 }).limit(limit));
  } catch (err) {
    next(err);
  }
};

// GET /api/services/:id/health
exports.getServiceHealth = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid service id' });
    const service = await Service.findById(req.params.id);
    if (!service) return res.status(404).json({ error: 'Service not found' });

    const instances = await Instance.find({ serviceId: service._id }).sort({ instanceName: 1 });
    res.json({
      serviceId: service._id,
      name: service.name,
      status: service.status,
      currentReplicas: service.currentReplicas,
      instances: instances.map((i) => ({
        instanceName: i.instanceName,
        status: i.status,
        consecutiveFailures: i.consecutiveFailures,
        responseTimeMs: i.responseTimeMs,
        cpuUsage: i.cpuUsage,
        memoryUsage: i.memoryUsage,
        lastError: i.lastError,
        lastHealthCheck: i.lastHealthCheck,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/monitor/status
exports.getMonitorStatus = (req, res) => res.json(healthMonitor.getStatus());