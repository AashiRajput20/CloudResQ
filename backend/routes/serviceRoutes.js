const express = require('express');
const ctrl = require('../controllers/serviceController');
const healthCtrl = require('../controllers/healthCheckController');
const actionCtrl = require('../controllers/actionController');

const router = express.Router();

router.get('/', ctrl.getServices);                       // GET    /api/services
router.post('/', ctrl.createService);                    // POST   /api/services
router.get('/:id', ctrl.getServiceById);                 // GET    /api/services/:id
router.delete('/:id', ctrl.deleteService);               // DELETE /api/services/:id
router.get('/:id/instances', ctrl.getServiceInstances);  // GET    /api/services/:id/instances
router.get('/:id/health', healthCtrl.getServiceHealth);  // GET    /api/services/:id/health

router.post('/:id/restart', actionCtrl.restartService);                    // rolling restart
router.post('/:id/simulate-failure', actionCtrl.simulateFailureOnService);   // body: { instance, type }
router.post('/:id/simulate-recovery', actionCtrl.simulateRecoveryOnService); // body: { instance }

module.exports = router;