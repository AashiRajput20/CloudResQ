const express = require('express');
const ctrl = require('../controllers/analysisController');

const router = express.Router();

router.get('/', ctrl.listAnalysis); // GET /api/analysis

module.exports = router;