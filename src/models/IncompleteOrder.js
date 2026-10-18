const mongoose = require('mongoose');

const incompleteOrderSchema = new mongoose.Schema(
  {
    customerName: {
      type: String,
      required: [true, 'Customer name is required'],
      trim: true,
    },
    phoneNumber: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      index: true,
    },
    email: {
      type: String,
      trim: true,
      default: '',
    },
    address: {
      type: String,
      trim: true,
      default: '',
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
      default: 950,
    },
    totalPrice: {
      type: Number,
      default: 950,
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
    status: {
      type: String,
      enum: ['Pending', 'Contacted', 'Converted', 'Cancelled'],
      default: 'Pending',
      index: true,
    },
    adminNotes: {
      type: String,
      default: '',
    },
    hasPreviousOrders: {
      type: Boolean,
      default: false,
    },
    previousOrdersCount: {
      type: Number,
      default: 0,
    },
    convertedOrderId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('IncompleteOrder', incompleteOrderSchema);
