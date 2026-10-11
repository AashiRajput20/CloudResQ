const express = require('express');
const ctrl = require('../controllers/loadBalancerController');

const router = express.Router();

router.get('/', ctrl.getLoadBalancer);       // GET  /api/loadbalancer
router.post('/sync', ctrl.syncLoadBalancer); // POST /api/loadbalancer/sync

module.exports = router;