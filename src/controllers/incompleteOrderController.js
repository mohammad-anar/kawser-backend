const IncompleteOrder = require('../models/IncompleteOrder');
const Order = require('../models/Order');
const BlockedEntity = require('../models/BlockedEntity');
const BlockedIp = require('../models/BlockedIp');
const { getDBStatus } = require('../config/db');
const { getClientIp } = require('../middleware/rateLimiter');

// In-memory fallback when MongoDB is offline
const mockIncompleteOrders = [];

// Helper to generate unique CZ order ID
const generateOrderId = async () => {
  if (getDBStatus().isConnected) {
    try {
      return await Order.generateNextOrderId();
    } catch (e) {
      console.warn('[generateOrderId fallback]', e.message);
    }
  }
  return `CZ-${String(mockIncompleteOrders.length + 1).padStart(4, '0')}`;
};

// POST /api/orders/incomplete - Public endpoint to record abandoned / incomplete orders
const recordIncompleteOrder = async (req, res) => {
  try {
    const {
      customerName,
      phoneNumber,
      email,
      address,
      district,
      thana,
      productName,
      quantity,
      size,
      totalPrice,
      deviceId,
    } = req.body;

    if (!customerName || !phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'নাম এবং মোবাইল নম্বর আবশ্যক।',
      });
    }

    const cleanPhone = String(phoneNumber).replace(/\s/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({
        success: false,
        message: 'সঠিক মোবাইল নম্বর প্রদান করুন।',
      });
    }

    const clientIp = getClientIp(req);
    const clientDeviceId = (deviceId && String(deviceId).trim()) || (req.headers['x-device-id'] ? String(req.headers['x-device-id']).trim() : '');
    const isConnected = getDBStatus().isConnected;

    // Check if client is blocked
    if (isConnected) {
      const conditions = [];
      if (clientIp) conditions.push({ type: 'ip', value: clientIp });
      if (cleanPhone) conditions.push({ type: 'phone', value: cleanPhone });
      if (clientDeviceId) conditions.push({ type: 'device', value: clientDeviceId });

      if (conditions.length > 0) {
        const isBlocked = await BlockedEntity.exists({ $or: conditions });
        if (isBlocked) {
          return res.status(403).json({
            success: false,
            message: 'দুঃখিত, এই মুহূর্তে আপনার অর্ডারটি সম্পন্ন করা সম্ভব হচ্ছে না।',
          });
        }
      }
      if (clientIp) {
        const ipBlocked = await BlockedIp.exists({ ip: clientIp });
        if (ipBlocked) {
          return res.status(403).json({
            success: false,
            message: 'দুঃখিত, এই মুহূর্তে আপনার অর্ডারটি সম্পন্ন করা সম্ভব হচ্ছে না।',
          });
        }
      }
    }

    const qty = parseInt(quantity) || 1;
    const cleanSize = (size && (String(size).includes('5.7') || String(size).includes('৫.৭'))) ? '5.7 inch' : '6.7 inch';
    const unitPrice = cleanSize === '5.7 inch' ? 1199 : 950;
    const computedTotal = totalPrice ? Number(totalPrice) : unitPrice * qty;

    // Check if customer has previous confirmed/placed orders
    let previousOrdersCount = 0;
    if (isConnected) {
      previousOrdersCount = await Order.countDocuments({
        phoneNumber: cleanPhone,
        isDeleted: { $ne: true },
      });
    }

    const hasPreviousOrders = previousOrdersCount > 0;

    const docData = {
      customerName: customerName.trim(),
      phoneNumber: cleanPhone,
      email: email ? email.trim() : '',
      address: address ? address.trim() : '',
      district: district ? district.trim() : '',
      thana: thana ? thana.trim() : '',
      productName: productName || 'চীন ড্রাগন সিলিকন ম্যাজিক কনডম (Top Notch Reusable)',
      quantity: qty,
      size: cleanSize,
      unitPrice,
      totalPrice: computedTotal,
      ipAddress: clientIp,
      deviceId: clientDeviceId,
      status: 'Pending',
      hasPreviousOrders,
      previousOrdersCount,
    };

    let incompleteOrder;

    if (isConnected) {
      // Check if there is an existing pending/contacted record within the last 24 hours
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const existing = await IncompleteOrder.findOne({
        phoneNumber: cleanPhone,
        status: { $in: ['Pending', 'Contacted'] },
        createdAt: { $gte: oneDayAgo },
      });

      if (existing) {
        existing.customerName = docData.customerName;
        if (docData.address) existing.address = docData.address;
        if (docData.district) existing.district = docData.district;
        if (docData.thana) existing.thana = docData.thana;
        existing.quantity = docData.quantity;
        existing.totalPrice = docData.totalPrice;
        existing.ipAddress = docData.ipAddress;
        existing.hasPreviousOrders = hasPreviousOrders;
        existing.previousOrdersCount = previousOrdersCount;
        incompleteOrder = await existing.save();
      } else {
        incompleteOrder = await IncompleteOrder.create(docData);
      }
    } else {
      const existingIndex = mockIncompleteOrders.findIndex(
        (o) => o.phoneNumber === cleanPhone && (o.status === 'Pending' || o.status === 'Contacted')
      );
      if (existingIndex > -1) {
        mockIncompleteOrders[existingIndex] = {
          ...mockIncompleteOrders[existingIndex],
          ...docData,
          updatedAt: new Date(),
        };
        incompleteOrder = mockIncompleteOrders[existingIndex];
      } else {
        incompleteOrder = {
          ...docData,
          _id: `inc_${Date.now()}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        mockIncompleteOrders.unshift(incompleteOrder);
      }
    }

    // Real-time socket notification to admin
    const io = req.app.get('io');
    if (io) {
      io.emit('new_incomplete_order', {
        _id: incompleteOrder._id,
        customerName: incompleteOrder.customerName,
        phoneNumber: incompleteOrder.phoneNumber,
        address: incompleteOrder.address,
        quantity: incompleteOrder.quantity,
        totalPrice: incompleteOrder.totalPrice,
        status: incompleteOrder.status,
        hasPreviousOrders: incompleteOrder.hasPreviousOrders,
        createdAt: incompleteOrder.createdAt,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'অসম্পূর্ণ অর্ডার সংরক্ষিত হয়েছে।',
      incompleteOrder,
    });
  } catch (err) {
    console.error('[recordIncompleteOrder Error]', err);
    return res.status(500).json({
      success: false,
      message: 'সার্ভার ত্রুটি।',
      error: err.message,
    });
  }
};

// GET /api/orders/admin/incomplete - Protected Admin list
const getIncompleteOrders = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, status, size } = req.query;
    const parsedPage = parseInt(page) || 1;
    const parsedLimit = parseInt(limit) || 10;
    const skip = (parsedPage - 1) * parsedLimit;

    if (getDBStatus().isConnected) {
      const query = {};

      if (status && status !== 'all') {
        query.status = status;
      }

      if (size && size !== 'all') {
        const clean = String(size).trim();
        if (clean.includes('5.7') || clean.includes('৫.৭')) {
          query.size = { $regex: '5\\.7|৫\\.৭', $options: 'i' };
        } else {
          query.size = { $regex: '6\\.7|৬\\.৭', $options: 'i' };
        }
      }

      if (search && search.trim()) {
        const cleanSearch = search.trim();
        query.$or = [
          { customerName: { $regex: cleanSearch, $options: 'i' } },
          { phoneNumber: { $regex: cleanSearch, $options: 'i' } },
          { address: { $regex: cleanSearch, $options: 'i' } },
        ];
      }

      const [incompleteOrders, total] = await Promise.all([
        IncompleteOrder.find(query).sort({ createdAt: -1 }).skip(skip).limit(parsedLimit),
        IncompleteOrder.countDocuments(query),
      ]);

      // Re-verify previous order counts in real-time
      const enrichedOrders = await Promise.all(
        incompleteOrders.map(async (doc) => {
          const prevCount = await Order.countDocuments({
            phoneNumber: doc.phoneNumber,
            isDeleted: { $ne: true },
          });
          const obj = doc.toObject();
          obj.hasPreviousOrders = prevCount > 0;
          obj.previousOrdersCount = prevCount;
          return obj;
        })
      );

      return res.json({
        success: true,
        incompleteOrders: enrichedOrders,
        total,
        page: parsedPage,
        pages: Math.ceil(total / parsedLimit) || 1,
      });
    }

    // Mock mode
    let filtered = [...mockIncompleteOrders];
    if (status && status !== 'all') {
      filtered = filtered.filter((o) => o.status === status);
    }
    if (size && size !== 'all') {
      const clean = String(size).trim();
      if (clean.includes('5.7') || clean.includes('৫.৭')) {
        filtered = filtered.filter(
          (o) => o.size && (o.size.includes('5.7') || o.size.includes('৫.৭'))
        );
      } else {
        filtered = filtered.filter(
          (o) => !o.size || o.size.includes('6.7') || o.size.includes('৬.৭')
        );
      }
    }
    if (search && search.trim()) {
      const s = search.trim().toLowerCase();
      filtered = filtered.filter(
        (o) =>
          o.customerName?.toLowerCase().includes(s) ||
          o.phoneNumber?.includes(s) ||
          o.address?.toLowerCase().includes(s)
      );
    }

    const total = filtered.length;
    const paginated = filtered.slice(skip, skip + parsedLimit);

    return res.json({
      success: true,
      incompleteOrders: paginated,
      total,
      page: parsedPage,
      pages: Math.ceil(total / parsedLimit) || 1,
    });
  } catch (err) {
    console.error('[getIncompleteOrders Error]', err);
    return res.status(500).json({
      success: false,
      message: 'সার্ভার ত্রুটি।',
      error: err.message,
    });
  }
};

// PATCH /api/orders/admin/incomplete/:id/status - Update status or notes
const updateIncompleteOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    const validStatuses = ['Pending', 'Contacted', 'Converted', 'Cancelled'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'অবৈধ স্ট্যাটাস।' });
    }

    if (getDBStatus().isConnected) {
      const order = await IncompleteOrder.findById(id);
      if (!order) {
        return res.status(404).json({ success: false, message: 'অসম্পূর্ণ অর্ডার পাওয়া যায়নি।' });
      }

      if (status) order.status = status;
      if (adminNotes !== undefined) order.adminNotes = adminNotes;
      await order.save();

      return res.json({ success: true, message: 'স্ট্যাটাস আপডেট হয়েছে।', incompleteOrder: order });
    }

    const idx = mockIncompleteOrders.findIndex((o) => o._id === id);
    if (idx === -1) {
      return res.status(404).json({ success: false, message: 'অসম্পূর্ণ অর্ডার পাওয়া যায়নি।' });
    }

    if (status) mockIncompleteOrders[idx].status = status;
    if (adminNotes !== undefined) mockIncompleteOrders[idx].adminNotes = adminNotes;

    return res.json({
      success: true,
      message: 'স্ট্যাটাস আপডেট হয়েছে।',
      incompleteOrder: mockIncompleteOrders[idx],
    });
  } catch (err) {
    console.error('[updateIncompleteOrderStatus Error]', err);
    return res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// POST /api/orders/admin/incomplete/:id/convert - Convert incomplete order to real Order
const convertIncompleteOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      customerName,
      phoneNumber,
      address,
      district,
      thana,
      productName,
      quantity,
      size,
      unitPrice,
      deliveryCharge,
      totalPrice,
      paymentMethod,
      orderNotes,
    } = req.body;

    let incomplete;
    const isConnected = getDBStatus().isConnected;

    if (isConnected) {
      incomplete = await IncompleteOrder.findById(id);
    } else {
      incomplete = mockIncompleteOrders.find((o) => o._id === id);
    }

    if (!incomplete) {
      return res.status(404).json({ success: false, message: 'অসম্পূর্ণ অর্ডার পাওয়া যায়নি।' });
    }

    const finalName = customerName?.trim() || incomplete.customerName;
    const finalPhone = (phoneNumber?.trim() || incomplete.phoneNumber).replace(/\s/g, '');
    const finalAddress = address?.trim() || incomplete.address;

    if (!finalName || !finalPhone || !finalAddress) {
      return res.status(400).json({
        success: false,
        message: 'গ্রাহকের নাম, ফোন নম্বর এবং সম্পূর্ণ ডেলিভারি ঠিকানা আবশ্যক।',
      });
    }

    const qty = Number(quantity) || incomplete.quantity || 1;
    const uPrice = unitPrice !== undefined ? Number(unitPrice) : (incomplete.unitPrice || 950);
    const dCharge = deliveryCharge !== undefined ? Number(deliveryCharge) : 0;
    const finalTotal = totalPrice !== undefined ? Number(totalPrice) : (uPrice * qty + dCharge);
    const orderId = await generateOrderId();

    const orderDoc = {
      orderId,
      customerName: finalName,
      phoneNumber: finalPhone,
      address: finalAddress,
      district: district?.trim() || incomplete.district || '',
      thana: thana?.trim() || incomplete.thana || '',
      productName: productName?.trim() || incomplete.productName || 'Love Lock Condom / Magic Condom',
      quantity: qty,
      size: (size && (String(size).includes('5.7') || String(size).includes('৫.৭'))) ? '5.7 inch' : '6.7 inch',
      unitPrice: uPrice,
      deliveryCharge: dCharge,
      totalPrice: finalTotal,
      paymentMethod: paymentMethod || 'Cash on Delivery',
      isGuestOrder: true,
      orderNotes: orderNotes ? orderNotes.trim() : `অসম্পূর্ণ অর্ডার থেকে কনভার্ট করা হয়েছে (${id})`,
      status: 'Confirmed',
      ipAddress: incomplete.ipAddress || '',
      deviceId: incomplete.deviceId || '',
      statusHistory: [
        {
          status: 'Confirmed',
          changedAt: new Date(),
          changedBy: req.user?.id || 'admin',
        },
      ],
    };

    let newOrder;
    if (isConnected) {
      newOrder = await Order.create(orderDoc);
      incomplete.status = 'Converted';
      incomplete.convertedOrderId = orderId;
      await incomplete.save();
    } else {
      newOrder = { ...orderDoc, _id: `ord_${Date.now()}`, createdAt: new Date() };
      mockOrders.unshift(newOrder);
      incomplete.status = 'Converted';
      incomplete.convertedOrderId = orderId;
    }

    // Real-time WebSocket emission to admin dashboard
    const io = req.app.get('io');
    if (io) {
      io.emit('new_order', {
        _id: newOrder._id ? newOrder._id.toString() : `ord_${Date.now()}`,
        orderId: newOrder.orderId,
        customerName: newOrder.customerName,
        phoneNumber: newOrder.phoneNumber,
        address: newOrder.address,
        quantity: newOrder.quantity,
        totalPrice: newOrder.totalPrice,
        status: newOrder.status,
        createdAt: newOrder.createdAt || new Date().toISOString(),
      });
    }

    return res.status(201).json({
      success: true,
      message: `অসম্পূর্ণ অর্ডারটি সফলভাবে মূল অর্ডারে (${orderId}) রূপান্তরিত হয়েছে!`,
      order: newOrder,
    });
  } catch (err) {
    console.error('[convertIncompleteOrder Error]', err);
    return res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// DELETE /api/orders/admin/incomplete/:id - Delete incomplete order
const deleteIncompleteOrder = async (req, res) => {
  try {
    const { id } = req.params;
    if (getDBStatus().isConnected) {
      const order = await IncompleteOrder.findById(id);
      if (!order) {
        return res.status(404).json({ success: false, message: 'অসম্পূর্ণ অর্ডার পাওয়া যায়নি।' });
      }
      await IncompleteOrder.findByIdAndDelete(id);
      return res.json({ success: true, message: 'অসম্পূর্ণ অর্ডারটি মুছে ফেলা হয়েছে।' });
    }

    const idx = mockIncompleteOrders.findIndex((o) => o._id === id);
    if (idx === -1) {
      return res.status(404).json({ success: false, message: 'অসম্পূর্ণ অর্ডার পাওয়া যায়নি।' });
    }
    mockIncompleteOrders.splice(idx, 1);
    return res.json({ success: true, message: 'অসম্পূর্ণ অর্ডারটি মুছে ফেলা হয়েছে।' });
  } catch (err) {
    console.error('[deleteIncompleteOrder Error]', err);
    return res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

module.exports = {
  recordIncompleteOrder,
  getIncompleteOrders,
  updateIncompleteOrderStatus,
  convertIncompleteOrder,
  deleteIncompleteOrder,
};
