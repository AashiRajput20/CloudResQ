const mongoose = require('mongoose');

const FAILURE_TYPES = [
  'CONTAINER_DOWN', 'HEALTH_CHECK_FAILED', 'HIGH_CPU', 'HIGH_MEMORY',
  'HIGH_LATENCY', 'HIGH_ERROR_RATE', 'REPEATED_FAILURE',
];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const failureSchema = new mongoose.Schema(
  {
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true, index: true },
    instanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Instance', required: true },
    instanceName: { type: String, required: true },

    failureType: { type: String, enum: FAILURE_TYPES, required: true },
    severity: { type: String, enum: SEVERITIES, required: true },
    status: { type: String, enum: ['ACTIVE', 'RESOLVED'], default: 'ACTIVE' },
    message: { type: String, default: '' },        // human-readable explanation
    failureCount: { type: Number, default: 1 },    // availability failures of this instance in the recent window

    occurredAt: { type: Date, default: Date.now }, // when the problem first showed up (first failed check)
    detectedAt: { type: Date, default: Date.now }, // when CloudResQ confirmed it
    detectionTimeSec: { type: Number, default: null }, // detectedAt - occurredAt (availability failures only)
    resolvedAt: { type: Date, default: null },
    resolution: { type: String, default: null },

    // Snapshot of the instance when the failure was detected
    metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

failureSchema.index({ status: 1, detectedAt: -1 });
failureSchema.index({ instanceName: 1, detectedAt: -1 });

module.exports = mongoose.model('Failure', failureSchema);
module.exports.FAILURE_TYPES = FAILURE_TYPES;
module.exports.SEVERITIES = SEVERITIES;