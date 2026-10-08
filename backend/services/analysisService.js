const Service = require('../models/Service');
const Instance = require('../models/Instance');
const { buildContext } = require('../decision-engine/contextBuilder');
const { analyze } = require('../decision-engine/failureAnalyzer');

async function analyzeInstance(instance, service) {
  const ctx = await buildContext(instance, service);
  return {
    instanceId: instance._id,
    serviceId: service._id,
    serviceName: service.name,
    ...analyze(ctx),
  };
}

// Analyzes every instance (optionally only one service's instances).
async function analyzeAll({ serviceId } = {}) {
  const services = await Service.find(serviceId ? { _id: serviceId } : {});
  const results = [];
  for (const service of services) {
    const instances = await Instance.find({ serviceId: service._id }).sort({ instanceName: 1 });
    results.push(...(await Promise.all(instances.map((i) => analyzeInstance(i, service)))));
  }
  return results;
}

module.exports = { analyzeInstance, analyzeAll };