const trafficManager = require('../loadbalancer/trafficManager');

// GET /api/loadbalancer
exports.getLoadBalancer = (req, res) => res.json(trafficManager.getStatus());

// POST /api/loadbalancer/sync   (recompute the pool now and re-apply the Nginx config)
exports.syncLoadBalancer = async (req, res, next) => {
  try {
    res.json(await trafficManager.sync({ force: true }));
  } catch (err) {
    next(err);
  }
};
