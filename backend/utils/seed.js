// Creates one sample service with 3 sample instances so the UI has something to show.
// Safe to run multiple times. Real data will come from Docker in Phase 5.
const mongoose = require('mongoose');
const config = require('../config');
const Service = require('../models/Service');
const Instance = require('../models/Instance');

async function seed() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });

  let service = await Service.findOne({ name: 'Demo Service' });
  if (!service) {
    service = await Service.create({
      name: 'Demo Service',
      status: 'HEALTHY',
      desiredReplicas: 3,
      currentReplicas: 3,
    });
  }

  for (const instanceName of ['app-1', 'app-2', 'app-3']) {
    await Instance.updateOne(
      { serviceId: service._id, instanceName },
      {
        $setOnInsert: {
          status: 'HEALTHY',
          cpuUsage: 30,
          memoryUsage: 40,
          lastHealthCheck: new Date(),
        },
      },
      { upsert: true }
    );
  }

  console.log('[Seed] Demo Service and 3 sample instances are ready');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('[Seed] Failed:', err.message);
  process.exit(1);
});