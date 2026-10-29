const express = require('express');
const ctrl = require('../controllers/eventController');

const router = express.Router();

router.get('/', ctrl.getEvents);          // GET  /api/events
router.post('/test', ctrl.sendTestEvent); // POST /api/events/test

module.exports = router;