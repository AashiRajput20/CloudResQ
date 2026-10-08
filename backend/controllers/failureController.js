const mongoose = require('mongoose');
const Failure = require('../models/Failure');

// GET /api/failures?status=ACTIVE&type=HIGH_CPU&instance=app-2&serviceId=...&limit=50
exports.listFailures = async (req, res, next) => {
  try {
    const { status, type, instance, serviceId } = req.query;
    const filter = {};

    if (status) {
      if (!['ACTIVE', 'RESOLVED'].includes(status.toUpperCase())) {
        return res.status(400).json({ error: 'status must be ACTIVE or RESOLVED' });
      }
      filter.status = status.toUpperCase();
    }
    if (type) {
      if (!Failure.FAILURE_TYPES.includes(type.toUpperCase())) {
        return res.status(400).json({ error: `type must be one of: ${Failure.FAILURE_TYPES.join(', ')}` });
      }
      filter.failureType = type.toUpperCase();
    }
    if (instance) filter.instanceName = instance;
    if (serviceId) {
      if (!mongoose.isValidObjectId(serviceId)) return res.status(400).json({ error: 'Invalid serviceId' });
      filter.serviceId = serviceId;
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    res.json(await Failure.find(filter).sort({ detectedAt: -1 }).limit(limit));
  } catch (err) {
    next(err);
  }
};

// GET /api/failures/:id
exports.getFailureById = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid failure id' });
    const failure = await Failure.findById(req.params.id);
    if (!failure) return res.status(404).json({ error: 'Failure not found' });
    res.json(failure);
  } catch (err) {
    next(err);
  }
};