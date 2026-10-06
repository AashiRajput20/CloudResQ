const mongoose = require('mongoose');
const Service = require('../models/Service');
const Instance = require('../models/Instance');

const invalidId = (id) => !mongoose.isValidObjectId(id);

// GET /api/services
exports.getServices = async (req, res, next) => {
  try {
    const services = await Service.find().sort({ createdAt: -1 });
    res.json(services);
  } catch (err) {
    next(err);
  }
};

// GET /api/services/:id
exports.getServiceById = async (req, res, next) => {
  try {
    if (invalidId(req.params.id)) return res.status(400).json({ error: 'Invalid service id' });
    const service = await Service.findById(req.params.id);
    if (!service) return res.status(404).json({ error: 'Service not found' });
    res.json(service);
  } catch (err) {
    next(err);
  }
};

// POST /api/services
exports.createService = async (req, res, next) => {
  try {
    const { name, desiredReplicas, minimumReplicas, maximumReplicas } = req.body;
    // Only accept known fields (never trust the whole body).
    const service = await Service.create({ name, desiredReplicas, minimumReplicas, maximumReplicas });
    res.status(201).json(service);
  } catch (err) {
    next(err); // validation / duplicate errors are handled in server.js
  }
};

// DELETE /api/services/:id
exports.deleteService = async (req, res, next) => {
  try {
    if (invalidId(req.params.id)) return res.status(400).json({ error: 'Invalid service id' });
    const service = await Service.findByIdAndDelete(req.params.id);
    if (!service) return res.status(404).json({ error: 'Service not found' });
    // Remove its instances too. (From Phase 5 this will also remove the Docker containers.)
    await Instance.deleteMany({ serviceId: service._id });
    res.json({ message: `Service "${service.name}" deleted` });
  } catch (err) {
    next(err);
  }
};

// GET /api/services/:id/instances
exports.getServiceInstances = async (req, res, next) => {
  try {
    if (invalidId(req.params.id)) return res.status(400).json({ error: 'Invalid service id' });
    const exists = await Service.exists({ _id: req.params.id });
    if (!exists) return res.status(404).json({ error: 'Service not found' });
    const instances = await Instance.find({ serviceId: req.params.id }).sort({ instanceName: 1 });
    res.json(instances);
  } catch (err) {
    next(err);
  }
};