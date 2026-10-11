const mongoose = require('mongoose');
const RecoveryEvent = require('../models/RecoveryEvent');

// GET /api/recovery-events?serviceId=&instance=app-2&action=RESTART&status=SUCCESS&limit=50
exports.listRecoveryEvents = async (req, res, next) => {
  try {
    const { serviceId, instance, action, status } = req.query;
    const filter = { simulated: { $ne: true } };
    if (serviceId) {
      if (!mongoose.isValidObjectId(serviceId)) return res.status(400).json({ error: 'Invalid serviceId' });
      filter.serviceId = serviceId;
    }
    if (instance) filter.instanceName = instance;
    if (action) filter.action = action.toUpperCase();
    if (status) filter.status = status.toUpperCase();

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    res.json(await RecoveryEvent.find(filter).sort({ startedAt: -1 }).limit(limit));
  } catch (err) {
    next(err);
  }
};