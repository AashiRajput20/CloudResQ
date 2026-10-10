const mongoose = require('mongoose');
const Decision = require('../models/Decision');
const decisionConfig = require('../config/decisionConfig');
const decisionService = require('../services/decisionService');

// GET /api/decisions?serviceId=&instance=app-2&action=RESTART&limit=50   (the saved decision log)
exports.listDecisions = async (req, res, next) => {
  try {
    const { serviceId, instance, action } = req.query;
    const filter = {};
    if (serviceId) {
      if (!mongoose.isValidObjectId(serviceId)) return res.status(400).json({ error: 'Invalid serviceId' });
      filter.serviceId = serviceId;
    }
    if (instance) filter.instanceName = instance;
    if (action) filter.action = action.toUpperCase();

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    res.json(await Decision.find(filter).sort({ decidedAt: -1 }).limit(limit));
  } catch (err) {
    next(err);
  }
};

// GET /api/decisions/live?serviceId=   (what the engine would decide right now; nothing is saved)
exports.liveDecisions = async (req, res, next) => {
  try {
    const { serviceId } = req.query;
    if (serviceId && !mongoose.isValidObjectId(serviceId)) return res.status(400).json({ error: 'Invalid serviceId' });
    res.json(await decisionService.evaluateAll({ serviceId }));
  } catch (err) {
    next(err);
  }
};

// GET /api/decisions/config
exports.getConfig = (req, res) => res.json(decisionConfig);