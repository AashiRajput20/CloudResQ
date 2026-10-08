const express = require('express');
const ctrl = require('../controllers/dockerController');

const router = express.Router();

router.get('/containers', ctrl.listContainers); // GET  /api/docker/containers
router.post('/sync', ctrl.sync);                // POST /api/docker/sync

module.exports = router;