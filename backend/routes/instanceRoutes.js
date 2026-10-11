const express = require('express');
const analysisCtrl = require('../controllers/analysisController');
const actionCtrl = require('../controllers/actionController');

const router = express.Router();

router.get('/:id/analysis', analysisCtrl.getInstanceAnalysis); // GET  /api/instances/:id/analysis
router.post('/:id/restart', actionCtrl.restartInstance);       // POST /api/instances/:id/restart
router.post('/:id/replace', actionCtrl.replaceInstance);       // POST /api/instances/:id/replace
router.post('/:id/simulate', actionCtrl.simulateInstance);     // POST /api/instances/:id/simulate

module.exports = router;