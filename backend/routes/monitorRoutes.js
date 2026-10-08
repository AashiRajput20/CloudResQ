const express = require('express');
const ctrl = require('../controllers/healthCheckController');

const router = express.Router();

router.get('/health-checks', ctrl.listHealthChecks); // GET /api/health-checks
router.get('/monitor/status', ctrl.getMonitorStatus); // GET /api/monitor/status

module.exports = router;