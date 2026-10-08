const express = require('express');
const ctrl = require('../controllers/serviceController');
const healthCtrl = require('../controllers/healthCheckController');

const router = express.Router();

router.get('/', ctrl.getServices);                       // GET    /api/services
router.post('/', ctrl.createService);                    // POST   /api/services
router.get('/:id', ctrl.getServiceById);                 // GET    /api/services/:id
router.delete('/:id', ctrl.deleteService);               // DELETE /api/services/:id
router.get('/:id/instances', ctrl.getServiceInstances);  // GET    /api/services/:id/instances
router.get('/:id/health', healthCtrl.getServiceHealth);  // GET /api/services/:id/health

module.exports = router;