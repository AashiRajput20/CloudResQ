const mongoose = require('mongoose');
const Service = require('../models/Service');
const ScalingEvent = require('../models/ScalingEvent');
const scaling = require('../scaling/scalingController');

const DOCKER_DOWN = ['ENOENT', 'ECONNREFUSED', 'EACCES'];

function handleError(err, res, next) {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (DOCKER_DOWN.includes(err.code)) {
    return res.status(503).json({ error: 'Cannot reach Docker Engine. Is Docker Desktop running?' });
  }
  return next(err);
}

// GET /api/scaling-events?serviceId=&action=SCALE_OUT&status=SUCCESS&limit=50
exports.listScalingEvents = async (req, res, next) => {
  try {
    const { serviceId, action, status } = req.query;
    const filter = {};
    if (serviceId) {
      if (!mongoose.isValidObjectId(serviceId)) return res.status(400).json({ error: 'Invalid serviceId' });
      filter.serviceId = serviceId;
    }
    if (action) filter.action = action.toUpperCase();
    if (status) filter.status = status.toUpperCase();
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    res.json(await ScalingEvent.find(filter).sort({ startedAt: -1 }).limit(limit));
  } catch (err) {
    next(err);
  }
};

// POST /api/services/:id/scale   body: { "direction": "out" | "in" }   (one step; waits for the result)
exports.scaleService = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid service id' });
    const service = await Service.findById(req.params.id);
    if (!service) return res.status(404).json({ error: 'Service not found' });

    const direction = String(req.body?.direction || '').toLowerCase();
    if (!['out', 'in'].includes(direction)) {
      return res.status(400).json({ error: 'Body must be {"direction":"out"} or {"direction":"in"}' });
    }

    const { event, done } = await scaling.scale(direction === 'out' ? 'SCALE_OUT' : 'SCALE_IN', {
      service, source: 'MANUAL', trigger: 'MANUAL',
      reason: `Manual scale ${direction} requested from the dashboard`,
    });
    await done;
    res.json(await ScalingEvent.findById(event._id));
  } catch (err) {
    handleError(err, res, next);
  }
};