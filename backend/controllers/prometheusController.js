const config = require('../config');
const dockerManager = require('../docker/dockerManager');
const { register } = require('../metrics');
const { buildTargets } = require('../metrics/promTargets');

// GET /metrics   (what Prometheus scrapes)
exports.metrics = async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
};

// GET /api/prometheus/targets   (Prometheus HTTP service discovery: which app containers to scrape)
exports.targets = async (req, res) => {
  try {
    res.json(buildTargets(await dockerManager.listManagedContainers(), config.docker.containerPort));
  } catch {
    // Docker unreachable: an error makes Prometheus keep its previous target list.
    res.status(503).json({ error: 'Cannot reach Docker Engine' });
  }
};