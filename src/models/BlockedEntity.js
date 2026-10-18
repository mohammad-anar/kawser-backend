const mongoose = require('mongoose');

const blockedEntitySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['ip', 'phone', 'device'],
      required: true,
      index: true,
    },
    value: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    reason: {
      type: String,
      trim: true,
      default: 'Spam / Abuse',
    },
    blockedBy: {
      type: String,
      default: 'admin',
    },
  },
  {
    timestamps: true,
  }
);

blockedEntitySchema.index({ type: 1, value: 1 }, { unique: true });

module.exports = mongoose.model('BlockedEntity', blockedEntitySchema);
