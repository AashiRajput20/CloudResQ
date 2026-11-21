const express = require('express');
const ctrl = require('../controllers/prometheusController');

const router = express.Router(); // mounted at the root, because Prometheus expects /metrics

router.get('/metrics', ctrl.metrics);                         // GET /metrics
router.get('/api/prometheus/targets', ctrl.targets);          // GET /api/prometheus/targets

module.exports = router;