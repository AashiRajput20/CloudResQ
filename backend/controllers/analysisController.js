const mongoose = require('mongoose');
const Instance = require('../models/Instance');
const Service = require('../models/Service');
const { analyzeAll, analyzeInstance } = require('../services/analysisService');

// GET /api/analysis?serviceId=
exports.listAnalysis = async (req, res, next) => {
  try {
    const { serviceId } = req.query;
    if (serviceId && !mongoose.isValidObjectId(serviceId)) {
      return res.status(400).json({ error: 'Invalid serviceId' });
    }
    res.json(await analyzeAll({ serviceId }));
  } catch (err) {
    next(err);
  }
};

// GET /api/instances/:id/analysis
exports.getInstanceAnalysis = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid instance id' });
    const instance = await Instance.findById(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Instance not found' });
    const service = await Service.findById(instance.serviceId);
    res.json(await analyzeInstance(instance, service));
  } catch (err) {
    next(err);
  }
};