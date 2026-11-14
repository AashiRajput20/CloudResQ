const express = require('express');
const ctrl = require('../controllers/settingsController');

const router = express.Router();

router.get('/', ctrl.getSettings);                            // GET   /api/settings
router.patch('/services/:id/limits', ctrl.updateLimits);     // PATCH /api/settings/services/:id/limits

module.exports = router;