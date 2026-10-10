// Sets the min and max replicas of "Demo Service".
//   npm run limits -- 2 5     (defaults)
//   npm run limits -- 2 3     (to test "maximum replicas reached")
//   npm run limits -- 3 5     (to test "minimum replicas reached")
const mongoose = require('mongoose');
const config = require('../config');
const Service = require('../models/Service');

async function main() {
  const min = parseInt(process.argv[2], 10);
  const max = parseInt(process.argv[3], 10);
  if (!min || !max) throw new Error('Usage: npm run limits -- <min> <max>');

  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  const service = await Service.findOne({ name: 'Demo Service' });
  if (!service) throw new Error('Demo Service not found. Wait for the monitor to create it.');

  service.minimumReplicas = min;
  service.maximumReplicas = max;
  await service.save(); // validation: min <= desired <= max
  console.log(`Demo Service limits: min=${service.minimumReplicas}, max=${service.maximumReplicas}, desired=${service.desiredReplicas}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});