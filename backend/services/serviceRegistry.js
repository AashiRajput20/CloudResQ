const Service = require('../models/Service');

// "Demo Service" -> "demo-service" (matches the cloudresq.service label)
const slugify = (s) => s.toLowerCase().trim().replace(/\s+/g, '-');
const titleCase = (slug) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

async function ensureService(label, containerCount) {
  const all = await Service.find();
  let service = all.find((s) => slugify(s.name) === label);
  if (!service) {
    service = await Service.create({
      name: titleCase(label),
      desiredReplicas: Math.min(5, Math.max(2, containerCount)),
    });
  }
  return service;
}

module.exports = { ensureService, slugify };