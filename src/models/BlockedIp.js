const mongoose = require('mongoose');

const blockedIpSchema = new mongoose.Schema(
  {
    ip: {
      type: String,
      required: true,
      unique: true,
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

module.exports = mongoose.model('BlockedIp', blockedIpSchema);
