const express = require('express');
const ctrl = require('../controllers/analyticsController');

const router = express.Router();

router.get('/', ctrl.getAnalytics); // GET /api/analytics

module.exports = router;