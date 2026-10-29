const express = require('express');
const scaleCtrl = require('../controllers/scaleController');
const metricsCtrl = require('../controllers/metricsController');

const router = express.Router(); // mounted at /api

router.get('/scaling-events', scaleCtrl.listScalingEvents); // GET  /api/scaling-events
router.post('/services/:id/scale', scaleCtrl.scaleService); // POST /api/services/:id/scale
router.get('/metrics', metricsCtrl.getMetrics);             // GET  /api/metrics

module.exports = router;