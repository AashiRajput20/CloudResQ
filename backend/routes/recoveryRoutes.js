const express = require('express');
const ctrl = require('../controllers/recoveryEventController');

const router = express.Router();

router.get('/', ctrl.listRecoveryEvents); // GET /api/recovery-events

module.exports = router;