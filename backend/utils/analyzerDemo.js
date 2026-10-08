// Prints the analysis of every instance, and can fake restart history for testing.
//   npm run analyze                              -> print analysis
//   npm run analyze -- --fake-restarts app-2 3   -> add 3 FAILED restart events for app-2
//   npm run analyze -- --clear-fake              -> remove those fake events
// (Fake events only count for 10 minutes, the analysis window.)
const mongoose = require('mongoose');
const config = require('../config');
const Instance = require('../models/Instance');
const RecoveryEvent = require('../models/RecoveryEvent');
const { analyzeAll } = require('../services/analysisService');

async function main() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  const args = process.argv.slice(2);

  const fakeAt = args.indexOf('--fake-restarts');
  if (fakeAt !== -1) {
    const name = args[fakeAt + 1];
    const count = parseInt(args[fakeAt + 2], 10) || 3;
    const instance = await Instance.findOne({ instanceName: name });
    if (!instance) throw new Error(`No instance named "${name}"`);
    const now = new Date();
    await RecoveryEvent.insertMany(
      Array.from({ length: count }, () => ({
        serviceId: instance.serviceId,
        instanceId: instance._id,
        instanceName: name,
        action: 'RESTART',
        reason: 'Simulated failed restart (analyzerDemo)',
        status: 'FAILED',
        startedAt: now,
        completedAt: now,
        duration: 0,
        simulated: true,
      }))
    );
    console.log(`Added ${count} fake FAILED restart(s) for ${name}`);
  }

  if (args.includes('--clear-fake')) {
    const r = await RecoveryEvent.deleteMany({ simulated: true });
    console.log(`Removed ${r.deletedCount} fake recovery event(s)`);
  }

  const results = await analyzeAll();
  console.table(
    results.map((a) => ({
      instance: a.instanceName,
      health: a.health,
      failureType: a.failureType,
      severity: a.severity,
      failures10m: a.failureCount,
      restarts10m: a.recentRestarts,
      failedRestarts: a.failedRestarts,
      cpu: a.cpu,
      mem: a.memory,
      hint: a.recommendedAction,
    }))
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});