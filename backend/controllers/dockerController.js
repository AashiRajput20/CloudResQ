const dockerManager = require('../docker/dockerManager');
const { syncFromDocker } = require('../services/instanceSyncService');

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

// POST /api/docker/sync
exports.sync = async (req, res, next) => {
  try {
    res.json({ synced: await syncFromDocker() });
  } catch (err) {
    handleError(err, res, next);
  }
};