const express = require('express');
const analysisCtrl = require('../controllers/analysisController');

const router = express.Router();

router.get('/:id/analysis', analysisCtrl.getInstanceAnalysis); // GET /api/instances/:id/analysis
// Phase 10 adds POST /:id/restart and POST /:id/replace here.

module.exports = router;