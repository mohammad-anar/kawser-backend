const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      unique: true,
      required: true,
    },
    customerName: {
      type: String,
      required: [true, 'Customer name is required'],
      trim: true,
    },
    phoneNumber: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    address: {
      type: String,
      required: [true, 'Delivery address is required'],
      trim: true,
    },
    district: {
      type: String,
      trim: true,
      default: '',
    },
    thana: {
      type: String,
      trim: true,
      default: '',
    },
    gpsCoordinates: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    productName: {
      type: String,
      default: 'চীন ড্রাগন সিলিকন ম্যাজিক কনডম (Top Notch Reusable)',
    },
    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },
    size: {
      type: String,
      trim: true,
      default: '6.7 inch',
    },
    unitPrice: {
      type: Number,
      default: 950,
    },
    deliveryCharge: {
      type: Number,
      default: 0,
    },
    totalPrice: {
      type: Number,
      required: true,
    },
    paymentMethod: {
      type: String,
      default: 'Cash on Delivery',
    },
    status: {
      type: String,
      enum: ['Pending', 'Confirmed', 'Scheduled', 'Processing', 'Hold', 'Shipped', 'Delivered', 'Cancelled'],
      default: 'Pending',
    },
    ipAddress: {
      type: String,
      trim: true,
      default: '',
    },
    deviceId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    statusHistory: [
      {
        status: String,
        changedAt: { type: Date, default: Date.now },
        changedBy: { type: String, default: 'system' },
      },
    ],
    orderNotes: {
      type: String,
      default: '',
    },
    isGuestOrder: {
      type: Boolean,
      default: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    steadfast: {
      consignmentId: { type: Number, default: null },
      trackingCode: { type: String, default: '' },
      status: { type: String, default: '' },
      sentAt: { type: Date, default: null },
      responseMessage: { type: String, default: '' },
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Static helper to get next sequential CZ order ID
orderSchema.statics.generateNextOrderId = async function () {
  try {
    const lastCzOrder = await this.findOne({ orderId: /^CZ-\d+$/ })
      .sort({ orderId: -1 })
      .collation({ locale: 'en_US', numericOrdering: true });

    let nextNum = 1;
    if (lastCzOrder && lastCzOrder.orderId) {
      const match = lastCzOrder.orderId.match(/^CZ-(\d+)$/);
      if (match) {
        nextNum = parseInt(match[1], 10) + 1;
      }
    }
    return `CZ-${String(nextNum).padStart(4, '0')}`;
  } catch (err) {
    const count = await this.countDocuments();
    return `CZ-${String(count + 1).padStart(4, '0')}`;
  }
};

// Auto-generate orderId before saving
orderSchema.pre('save', async function (next) {
  if (!this.orderId) {
    this.orderId = await mongoose.model('Order').generateNextOrderId();
  }
  // Record initial status in history
  if (this.isNew && this.statusHistory.length === 0) {
    this.statusHistory.push({ status: this.status, changedBy: 'customer' });
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
