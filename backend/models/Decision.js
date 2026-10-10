const mongoose = require('mongoose');
const { ACTIONS } = require('./RecoveryEvent');

const decisionSchema = new mongoose.Schema(
  {
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true, index: true },
    serviceName: { type: String },
    instanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Instance', default: null },
    instanceName: { type: String, required: true },

    action: { type: String, enum: ACTIONS, required: true },
    trafficAction: { type: String, enum: [null, 'REMOVE_FROM_TRAFFIC', 'ADD_TO_TRAFFIC'], default: null },
    priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'LOW' },
    confidence: { type: Number, default: null }, // rule-based score 0..1, not a probability
    reason: { type: String, default: '' },       // the explanation shown in the dashboard
    rule: { type: String, default: null },       // which rule fired, e.g. RULE_1_RESTART
    trigger: { type: String, default: null },    // failure type behind it
    blockedBy: { type: String, default: null },  // MAX_REPLICAS or MIN_REPLICAS
    scale: { type: mongoose.Schema.Types.Mixed, default: null }, // { from, to } for scaling
    inputs: { type: mongoose.Schema.Types.Mixed, default: {} },  // values the decision was based on

    // Phase 9 only proposes. Phase 10 sets EXECUTED or FAILED.
    status: { type: String, enum: ['PROPOSED', 'EXECUTING', 'EXECUTED', 'FAILED', 'SKIPPED'], default: 'PROPOSED' },
    decidedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'decisions' }
);

decisionSchema.index({ decidedAt: -1 });
decisionSchema.index({ serviceId: 1, decidedAt: -1 });

module.exports = mongoose.model('Decision', decisionSchema);