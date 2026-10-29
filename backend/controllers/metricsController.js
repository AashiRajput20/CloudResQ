const mongoose = require('mongoose');
const HealthCheck = require('../models/HealthCheck');

const round = (n) => Math.round(n * 10) / 10;

// GET /api/metrics?serviceId=&minutes=10
// One point per monitor cycle: average and maximum CPU, average memory, response time, running replicas.
exports.getMetrics = async (req, res, next) => {
  try {
    const minutes = Math.min(Math.max(parseInt(req.query.minutes, 10) || 10, 1), 60);
    const match = {
      checkedAt: { $gte: new Date(Date.now() - minutes * 60 * 1000) },
      containerState: 'running', // a stopped container has no CPU or memory to average
    };
    if (req.query.serviceId) {
      if (!mongoose.isValidObjectId(req.query.serviceId)) return res.status(400).json({ error: 'Invalid serviceId' });
      match.serviceId = new mongoose.Types.ObjectId(req.query.serviceId);
    }

    const rows = await HealthCheck.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$checkedAt', // all instances of one cycle share the same timestamp
          avgCpu: { $avg: '$cpuPercent' },
          maxCpu: { $max: '$cpuPercent' },
          avgMemory: { $avg: '$memoryPercent' },
          avgResponse: { $avg: '$responseTimeMs' },
          replicas: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      minutes,
      points: rows.map((r) => ({
        t: r._id,
        cpu: round(r.avgCpu),
        maxCpu: round(r.maxCpu),
        memory: round(r.avgMemory),
        responseMs: r.avgResponse == null ? null : round(r.avgResponse),
        replicas: r.replicas,
      })),
    });
  } catch (err) {
    next(err);
  }
};