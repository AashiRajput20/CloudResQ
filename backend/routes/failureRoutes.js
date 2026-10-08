const express = require('express');
const ctrl = require('../controllers/failureController');

const router = express.Router();

router.get('/', ctrl.listFailures);      // GET /api/failures
router.get('/:id', ctrl.getFailureById); // GET /api/failures/:id

module.exports = router;