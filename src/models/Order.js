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
      default: 'স্ট্যান্ডার্ড',
    },
    unitPrice: {
      type: Number,
      default: 899,
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
      enum: ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'],
      default: 'Pending',
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
  },
  {
    timestamps: true,
  }
);

// Auto-generate orderId before saving
orderSchema.pre('save', async function (next) {
  if (!this.orderId) {
    const count = await mongoose.model('Order').countDocuments();
    this.orderId = `PC-${String(count + 1001).padStart(4, '0')}`;
  }
  // Record initial status in history
  if (this.isNew && this.statusHistory.length === 0) {
    this.statusHistory.push({ status: this.status, changedBy: 'customer' });
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
