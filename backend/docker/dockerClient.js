const Docker = require('dockerode');
const config = require('../config');

// One shared client. Only dockerManager.js should import this file.
const options = config.docker.socketPath ? { socketPath: config.docker.socketPath } : {};

module.exports = new Docker(options);