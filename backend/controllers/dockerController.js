const dockerManager = require('../docker/dockerManager');
const healthMonitor = require('../monitoring/healthMonitor');

const DOCKER_DOWN_CODES = ['ENOENT', 'ECONNREFUSED', 'EACCES'];

// Turn "Docker is not running" into a clear 503 instead of a generic 500.
function handleError(err, res, next) {
  if (DOCKER_DOWN_CODES.includes(err.code)) {
    return res.status(503).json({ error: 'Cannot reach Docker Engine. Is Docker Desktop running?' });
  }
  next(err);
}

// GET /api/docker/containers
exports.listContainers = async (req, res, next) => {
  try {
    res.json(await dockerManager.listManagedContainers());
  } catch (err) {
    handleError(err, res, next);
  }
};

// POST /api/docker/sync  ("Check now": runs one monitor cycle immediately)
exports.sync = async (req, res, next) => {
  try {
    res.json({ synced: await healthMonitor.runOnce() });
  } catch (err) {
    handleError(err, res, next);
  }
};