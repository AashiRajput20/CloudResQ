const express = require('express');
const ctrl = require('../controllers/decisionController');

const router = express.Router();

router.get('/', ctrl.listDecisions);   // GET /api/decisions
router.get('/live', ctrl.liveDecisions); // GET /api/decisions/live
router.get('/config', ctrl.getConfig); // GET /api/decisions/config

module.exports = router;