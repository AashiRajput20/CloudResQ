const mongoose = require('mongoose');
const { getAnalytics } = require('../services/analyticsService');

// GET /api/analytics?serviceId=&minutes=60     (minutes: 5 to 1440)
exports.getAnalytics = async (req, res, next) => {
  try {
    const { serviceId, minutes } = req.query;
    if (serviceId && !mongoose.isValidObjectId(serviceId)) {
      return res.status(400).json({ error: 'Invalid serviceId' });
    }
    res.json(await getAnalytics({ serviceId, minutes }));
  } catch (err) {
    next(err);
  }
};