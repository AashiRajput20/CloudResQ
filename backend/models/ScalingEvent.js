const mongoose = require('mongoose');

const scalingEventSchema = new mongoose.Schema(
  {
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true, index: true },
    serviceName: { type: String },
    action: { type: String, enum: ['SCALE_OUT', 'SCALE_IN'], required: true },

    previousReplicas: { type: Number, required: true },
    newReplicas: { type: Number, required: true },
    instanceName: { type: String, required: true }, // the instance that was created or removed

    reason: { type: String, default: '' },
    trigger: { type: String, default: 'MANUAL' },   // CPU | MEMORY | LOW_USAGE | MANUAL
    triggerInstance: { type: String, default: null },
    source: { type: String, enum: ['AUTO', 'MANUAL'], default: 'AUTO' },
    priority: { type: String, default: null },
    confidence: { type: Number, default: null },
    decisionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Decision', default: null },

    status: { type: String, enum: ['IN_PROGRESS', 'SUCCESS', 'FAILED'], default: 'IN_PROGRESS' },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    duration: { type: Number, default: null }, // seconds
    error: { type: String, default: null },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'scalingEvents' }
);

scalingEventSchema.index({ startedAt: -1 });

module.exports = mongoose.model('ScalingEvent', scalingEventSchema);