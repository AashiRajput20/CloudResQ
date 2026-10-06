const mongoose = require('mongoose');
const { STATUSES } = require('./Service');

const instanceSchema = new mongoose.Schema(
  {
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true, index: true },
    instanceName: { type: String, required: true, trim: true }, // e.g. "app-2"
    containerId: { type: String, default: null },               // filled in once Docker is connected
    status: { type: String, enum: STATUSES, default: 'UNKNOWN' },
    restartCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    cpuUsage: { type: Number, default: 0 },    // percent
    memoryUsage: { type: Number, default: 0 }, // percent
    lastHealthCheck: { type: Date, default: null },
  },
  { timestamps: true }
);

// The same instance name cannot appear twice in one service.
instanceSchema.index({ serviceId: 1, instanceName: 1 }, { unique: true });

module.exports = mongoose.model('Instance', instanceSchema);