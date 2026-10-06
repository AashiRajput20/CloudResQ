const express = require('express');
const ctrl = require('../controllers/serviceController');

const router = express.Router();

router.get('/', ctrl.getServices);                       // GET    /api/services
router.post('/', ctrl.createService);                    // POST   /api/services
router.get('/:id', ctrl.getServiceById);                 // GET    /api/services/:id
router.delete('/:id', ctrl.deleteService);               // DELETE /api/services/:id
router.get('/:id/instances', ctrl.getServiceInstances);  // GET    /api/services/:id/instances

module.exports = router;