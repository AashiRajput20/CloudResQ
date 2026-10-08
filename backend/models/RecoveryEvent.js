const mongoose = require('mongoose');

const ACTIONS = [
  'NO_ACTION', 'RESTART', 'REPLACE', 'REMOVE_FROM_TRAFFIC',
  'ADD_TO_TRAFFIC', 'SCALE_OUT', 'SCALE_IN', 'ALERT',
];

const recoveryEventSchema = new mongoose.Schema(
  {
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true, index: true },
    instanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Instance', default: null },
    instanceName: { type: String, required: true },

    action: { type: String, enum: ACTIONS, required: true },
    reason: { type: String, default: '' },
    trigger: { type: String, default: null },   // failure type that caused it
    priority: { type: String, default: null },
    confidence: { type: Number, default: null },

    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    duration: { type: Number, default: null },  // seconds
    status: { type: String, enum: ['IN_PROGRESS', 'SUCCESS', 'FAILED'], default: 'IN_PROGRESS' },
    retryCount: { type: Number, default: 0 },

    // For REPLACE: which instance was removed and which one took its place
    oldInstance: { type: String, default: null },
    newInstance: { type: String, default: null },

    simulated: { type: Boolean, default: false }, // true only for events made by utils/analyzerDemo.js
  },
  { timestamps: true, collection: 'recoveryEvents' }
);

recoveryEventSchema.index({ serviceId: 1, instanceName: 1, startedAt: -1 });

module.exports = mongoose.model('RecoveryEvent', recoveryEventSchema);
module.exports.ACTIONS = ACTIONS;