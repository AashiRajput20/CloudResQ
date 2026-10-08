const mongoose = require('mongoose');
const config = require('../config');

const healthCheckSchema = new mongoose.Schema(
  {
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    instanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Instance', required: true },
    instanceName: { type: String, required: true },
    containerState: { type: String },            // running | exited | ...
    healthy: { type: Boolean, required: true },
    httpStatus: { type: Number, default: null },
    responseTimeMs: { type: Number, default: null },
    error: { type: String, default: null },
    cpuPercent: { type: Number, default: 0 },
    memoryPercent: { type: Number, default: 0 },
    consecutiveFailures: { type: Number, default: 0 }, // streak AFTER this check
    statusAfter: { type: String },                     // instance status AFTER this check
    checkedAt: { type: Date, default: Date.now },
  },
  { collection: 'healthChecks', versionKey: false }
);

// Auto-delete old checks so the database does not grow forever.
healthCheckSchema.index({ checkedAt: 1 }, { expireAfterSeconds: config.monitor.historyHours * 3600 });
healthCheckSchema.index({ serviceId: 1, checkedAt: -1 });
healthCheckSchema.index({ instanceId: 1, checkedAt: -1 });

module.exports = mongoose.model('HealthCheck', healthCheckSchema);