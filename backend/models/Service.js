const mongoose = require('mongoose');

// All states from the CloudResQ spec, plus UNKNOWN for a brand-new service.
const STATUSES = [
  'UNKNOWN', 'HEALTHY', 'WARNING', 'UNHEALTHY',
  'FAILED', 'RECOVERING', 'RECOVERED', 'SCALING',
];

const serviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    status: { type: String, enum: STATUSES, default: 'UNKNOWN' },
    desiredReplicas: { type: Number, default: 3, min: 0 },
    currentReplicas: { type: Number, default: 0, min: 0 },
    minimumReplicas: { type: Number, default: 2, min: 1 },
    maximumReplicas: { type: Number, default: 5, min: 1 },
  },
  { timestamps: true } // adds createdAt and updatedAt automatically
);

// Business rule: min <= desired <= max
serviceSchema.pre('validate', function () {
  if (this.minimumReplicas > this.maximumReplicas) {
    this.invalidate('minimumReplicas', 'minimumReplicas cannot exceed maximumReplicas');
  }
  if (this.desiredReplicas < this.minimumReplicas || this.desiredReplicas > this.maximumReplicas) {
    this.invalidate('desiredReplicas', 'desiredReplicas must be between minimumReplicas and maximumReplicas');
  }
});

module.exports = mongoose.model('Service', serviceSchema);
module.exports.STATUSES = STATUSES;