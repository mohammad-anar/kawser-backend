const Order = require('../models/Order');
const BlockedIp = require('../models/BlockedIp');
const BlockedEntity = require('../models/BlockedEntity');
const { getClientIp } = require('../middleware/rateLimiter');
const { getDBStatus } = require('../config/db');
const XLSX = require('xlsx');

// In-memory blocked items fallback when MongoDB is offline
const mockBlockedIps = new Set();
const mockBlockedPhones = new Set();
const mockBlockedDevices = new Set();

// In-memory orders store fallback when MongoDB is offline
const mockOrders = [
  {
    _id: 'mock_ord_1',
    orderId: 'CZ-0001',
    customerName: 'তানভীর হাসান',
    phoneNumber: '01711223344',
    email: 'tanvir@gmail.com',
    address: 'বাড়ি ১২, রোড ৪, সেক্টর ৭, উত্তরা, ঢাকা',
    district: 'ঢাকা',
    thana: 'উত্তরা',
    gpsCoordinates: { lat: 23.8759, lng: 90.3795 },
    productName: 'চীন ড্রাগন সিলিকন ম্যাজিক কনডম (Top Notch Reusable)',
    quantity: 1,
    size: '5.7 inch',
    unitPrice: 1199,
    deliveryCharge: 0,
    totalPrice: 1199,
    status: 'Confirmed',
    paymentMethod: 'Cash on Delivery',
    isGuestOrder: true,
    statusHistory: [
      { status: 'Pending', timestamp: new Date(Date.now() - 3600000 * 5) },
      { status: 'Confirmed', timestamp: new Date(Date.now() - 3600000 * 2) },
    ],
    createdAt: new Date(Date.now() - 3600000 * 5),
  },
  {
    _id: 'mock_ord_2',
    orderId: 'CZ-0002',
    customerName: 'আরিফুল ইসলাম',
    phoneNumber: '01899887766',
    email: '',
    address: 'ধানমন্ডি ৩২, ঢাকা',
    district: 'ঢাকা',
    thana: 'ধানমন্ডি',
    gpsCoordinates: { lat: 23.7511, lng: 90.3773 },
    productName: 'চীন ড্রাগন সিলিকন ম্যাজিক কনডম (Top Notch Reusable)',
    quantity: 2,
    size: '6.7 inch',
    unitPrice: 950,
    deliveryCharge: 0,
    totalPrice: 1900,
    status: 'Processing',
    paymentMethod: 'Cash on Delivery',
    isGuestOrder: true,
    statusHistory: [
      { status: 'Pending', timestamp: new Date(Date.now() - 3600000 * 2) },
      { status: 'Processing', timestamp: new Date(Date.now() - 3600000) },
    ],
    createdAt: new Date(Date.now() - 3600000 * 2),
  },
];

const mongoose = require('mongoose');

// Helper to check if IP, Phone, or Device ID is blocked
const checkIsBlocked = async ({ ip, phone, deviceId }) => {
  const cleanIp = ip ? String(ip).trim() : '';
  const cleanPhone = phone ? String(phone).replace(/\s/g, '') : '';
  const cleanDev = deviceId ? String(deviceId).trim() : '';

  if (getDBStatus().isConnected) {
    const conditions = [];
    if (cleanIp) conditions.push({ type: 'ip', value: cleanIp });
    if (cleanPhone) conditions.push({ type: 'phone', value: cleanPhone });
    if (cleanDev) conditions.push({ type: 'device', value: cleanDev });

    if (conditions.length > 0) {
      const entityBlocked = await BlockedEntity.exists({ $or: conditions });
      if (entityBlocked) return true;
    }
    if (cleanIp) {
      const ipBlocked = await BlockedIp.exists({ ip: cleanIp });
      if (ipBlocked) return true;
    }
    return false;
  }

  // Offline fallback
  if (cleanIp && mockBlockedIps.has(cleanIp)) return true;
  if (cleanPhone && mockBlockedPhones.has(cleanPhone)) return true;
  if (cleanDev && mockBlockedDevices.has(cleanDev)) return true;
  return false;
};

// Helper to generate unique CZ order ID serially
const generateOrderId = async () => {
  if (getDBStatus().isConnected) {
    try {
      return await Order.generateNextOrderId();
    } catch (e) {
      console.warn('[generateOrderId fallback]', e.message);
    }
  }
  const nextNum = mockOrders.length + 1;
  return `CZ-${String(nextNum).padStart(4, '0')}`;
};

// POST /api/orders - Place a new order (guest or authenticated user)
const createOrder = async (req, res) => {
  try {
    const {
      customerName,
      phoneNumber,
      email,
      address,
      district,
      thana,
      gpsCoordinates,
      quantity,
      size,
      unitPrice: customUnitPrice,
      orderNotes,
      userId,
      productName,
      deviceId,
    } = req.body;

    if (!customerName || !phoneNumber || !address) {
      return res.status(400).json({
        success: false,
        message: 'নাম, ফোন নম্বর এবং ঠিকানা আবশ্যক।',
      });
    }

    const bdPhoneRegex = /^(?:\+88)?01[3-9]\d{8}$/;
    const cleanPhone = phoneNumber.replace(/\s/g, '');
    if (!bdPhoneRegex.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message: 'সঠিক বাংলাদেশি ফোন নম্বর দিন (01XXXXXXXXX)।',
      });
    }

    const clientIp = getClientIp(req);
    const clientDeviceId = (deviceId && String(deviceId).trim()) || (req.headers['x-device-id'] ? String(req.headers['x-device-id']).trim() : '');

    // Check if client is blocked via IP, Phone, or Device ID
    const isBlocked = await checkIsBlocked({
      ip: clientIp,
      phone: cleanPhone,
      deviceId: clientDeviceId,
    });

    if (isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'দুঃখিত, এই মুহূর্তে আপনার অর্ডারটি সম্পন্ন করা সম্ভব হচ্ছে না।',
      });
    }

    const qty = parseInt(quantity) || 1;
    const cleanSize = (size && (String(size).includes('5.7') || String(size).includes('৫.৭'))) ? '5.7 inch' : '6.7 inch';
    let unitPrice = cleanSize === '5.7 inch' ? 1199 : 950;
    if (customUnitPrice && Number(customUnitPrice) > 0) {
      unitPrice = Number(customUnitPrice);
    }
    const totalPrice = unitPrice * qty;
    const orderId = await generateOrderId();

    const validUserId = (userId && mongoose.Types.ObjectId.isValid(userId)) ? userId : null;

    const orderDoc = {
      orderId,
      customerName: customerName.trim(),
      phoneNumber: cleanPhone,
      email: email ? email.trim().toLowerCase() : '',
      address: address.trim(),
      district: district ? district.trim() : '',
      thana: thana ? thana.trim() : '',
      gpsCoordinates: (gpsCoordinates && gpsCoordinates.lat && gpsCoordinates.lng)
        ? { lat: Number(gpsCoordinates.lat), lng: Number(gpsCoordinates.lng) }
        : { lat: null, lng: null },
      productName: (productName && productName.trim()) ? productName.trim() : 'Love Lock Condom / Magic Condom',
      quantity: qty,
      size: cleanSize,
      unitPrice,
      deliveryCharge: 0,
      totalPrice,
      paymentMethod: 'Cash on Delivery',
      isGuestOrder: !validUserId,
      userId: validUserId,
      orderNotes: orderNotes ? orderNotes.trim() : '',
      status: 'Pending',
      ipAddress: clientIp,
      deviceId: clientDeviceId,
      statusHistory: [{ status: 'Pending', changedAt: new Date(), changedBy: 'customer' }],
    };

    let order;
    if (getDBStatus().isConnected) {
      order = await Order.create(orderDoc);
      console.log(`[Order Saved in MongoDB Atlas] ID: ${order.orderId}, _id: ${order._id}`);

      // Auto-mark pending incomplete orders with this phone as Converted
      try {
        const IncompleteOrder = require('../models/IncompleteOrder');
        await IncompleteOrder.updateMany(
          { phoneNumber: cleanPhone, status: { $in: ['Pending', 'Contacted'] } },
          { $set: { status: 'Converted', convertedOrderId: order.orderId } }
        );
      } catch (incErr) {
        console.warn('[IncompleteOrder Sync Warning]', incErr.message);
      }
    } else {
      console.warn('[MongoDB Atlas Offline] Saving order in memory fallback');
      order = { ...orderDoc, _id: `ord_${Date.now()}`, createdAt: new Date() };
      mockOrders.unshift(order);
    }

    // Real-time WebSocket emission to admin dashboard
    const io = req.app.get('io');
    if (io) {
      const orderPayload = {
        _id: order._id ? order._id.toString() : `ord_${Date.now()}`,
        orderId: order.orderId,
        customerName: order.customerName,
        phoneNumber: order.phoneNumber,
        address: order.address,
        quantity: order.quantity,
        totalPrice: order.totalPrice,
        status: order.status,
        createdAt: order.createdAt || new Date().toISOString(),
      };

      // Broadcast to all connected admins
      io.emit('new_order', orderPayload);
      console.log(`[Socket.io] Broadcasted 'new_order' event: ${order.orderId} - ৳${order.totalPrice}`);
    }

    res.status(201).json({
      success: true,
      message: 'আপনার অর্ডার সফলভাবে গ্রহণ করা হয়েছে! শীঘ্রই আমাদের টিম যোগাযোগ করবে।',
      orderId: order.orderId,
      totalPrice: order.totalPrice,
      productName: order.productName,
      estimatedDelivery: 'ঢাকায় ১ দিন, ঢাকার বাইরে ২-৩ দিন',
    });
  } catch (err) {
    console.error('[createOrder Error]', err);
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি। অর্ডার সেভ করতে সমস্যা হয়েছে।', error: err.message });
  }
};

// GET /api/orders/track?phone=&orderId= - Track order publicly
const trackOrder = async (req, res) => {
  try {
    const { phone, orderId } = req.query;
    if (!phone && !orderId) {
      return res.status(400).json({ success: false, message: 'ফোন নম্বর অথবা অর্ডার আইডি দিন।' });
    }

    let order = null;
    if (getDBStatus().isConnected) {
      const query = {};
      if (orderId) {
        query.orderId = { $regex: new RegExp(`^${orderId.trim()}$`, 'i') };
      }
      if (phone) {
        const cleanedPhone = phone.replace(/[\s\-\+]/g, '');
        query.phoneNumber = { $regex: new RegExp(`${cleanedPhone.slice(-11)}$`) };
      }
      order = await Order.findOne(query).select(
        'orderId customerName phoneNumber address status statusHistory productName quantity totalPrice createdAt estimatedDelivery'
      );
    } else {
      order = mockOrders.find((o) => {
        if (orderId && o.orderId.toLowerCase() === orderId.trim().toLowerCase()) return true;
        if (phone && o.phoneNumber.includes(phone.replace(/\s/g, '').slice(-11))) return true;
        return false;
      });
    }

    if (!order) {
      return res.status(404).json({ success: false, message: 'অর্ডার পাওয়া যায়নি। অনুগ্রহ করে সঠিক তথ্য দিন।' });
    }

    res.json({ success: true, order });
  } catch (err) {
    console.error('[trackOrder Error]', err);
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// GET /api/orders/my - Get orders for logged-in user
const getMyOrders = async (req, res) => {
  try {
    if (getDBStatus().isConnected) {
      const orders = await Order.find({ userId: req.user.id })
        .sort({ createdAt: -1 })
        .select('orderId status totalPrice quantity createdAt statusHistory productName');
      return res.json({ success: true, orders });
    }
    const orders = mockOrders.filter((o) => o.userId === req.user.id);
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// --- ADMIN ROUTES ---

// GET /api/admin/orders
const getAllOrders = async (req, res) => {
  try {
    const { status, search, phone, size, isDeleted, page = 1, limit = 10 } = req.query;
    const parsedPage = Math.max(1, parseInt(page) || 1);
    const parsedLimit = Math.max(1, parseInt(limit) || 10);
    const isDeletedQuery = isDeleted === 'true';

    if (getDBStatus().isConnected) {
      const query = isDeletedQuery ? { isDeleted: true } : { isDeleted: { $ne: true } };
      if (status && status !== 'all') query.status = status;
      if (phone) {
        query.phoneNumber = { $regex: phone.trim(), $options: 'i' };
      }
      if (size && size !== 'all') {
        const clean = String(size).trim();
        if (clean.includes('5.7') || clean.includes('৫.৭')) {
          query.size = { $regex: '5\\.7|৫\\.৭', $options: 'i' };
        } else {
          query.size = { $regex: '6\\.7|৬\\.৭', $options: 'i' };
        }
      }
      if (search) {
        query.$or = [
          { orderId: { $regex: search.trim(), $options: 'i' } },
          { customerName: { $regex: search.trim(), $options: 'i' } },
          { phoneNumber: { $regex: search.trim(), $options: 'i' } },
        ];
      }

      const skip = (parsedPage - 1) * parsedLimit;
      const [orders, total] = await Promise.all([
        Order.find(query).sort({ createdAt: -1 }).skip(skip).limit(parsedLimit),
        Order.countDocuments(query),
      ]);

      return res.json({
        success: true,
        orders,
        total,
        page: parsedPage,
        pages: Math.ceil(total / parsedLimit) || 1,
      });
    }

    // Mock fallback
    let filtered = mockOrders.filter((o) => (isDeletedQuery ? o.isDeleted === true : !o.isDeleted));
    if (status && status !== 'all') {
      filtered = filtered.filter((o) => o.status === status);
    }
    if (phone) {
      filtered = filtered.filter((o) => o.phoneNumber && o.phoneNumber.includes(phone.trim()));
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
    if (search) {
      const q = search.toLowerCase().trim();
      filtered = filtered.filter(
        (o) =>
          o.orderId.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          (o.phoneNumber && o.phoneNumber.includes(q))
      );
    }

    const total = filtered.length;
    const skip = (parsedPage - 1) * parsedLimit;
    const orders = filtered.slice(skip, skip + parsedLimit);

    res.json({
      success: true,
      orders,
      total,
      page: parsedPage,
      pages: Math.ceil(total / parsedLimit) || 1,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// PATCH /api/admin/orders/:id/status
const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['Pending', 'Confirmed', 'Scheduled', 'Processing', 'Hold', 'Shipped', 'Delivered', 'Partial Delivered', 'Cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'অবৈধ স্ট্যাটাস।' });
    }

    if (getDBStatus().isConnected) {
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ success: false, message: 'অর্ডার পাওয়া যায়নি।' });

      order.status = status;
      order.statusHistory.push({ status, changedBy: req.user?.id || 'admin' });
      await order.save();

      const io = req.app.get('io');
      if (io) {
        io.emit('order_status_updated', {
          orderId: order.orderId,
          _id: order._id,
          newStatus: status,
          customerName: order.customerName,
          source: req.user?.name || req.user?.email || 'Admin Panel',
          updatedAt: new Date(),
        });
      }

      return res.json({ success: true, message: 'অর্ডার স্ট্যাটাস আপডেট হয়েছে।', order });
    }

    const order = mockOrders.find((o) => o._id === req.params.id || o.orderId === req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'অর্ডার পাওয়া যায়নি।' });

    order.status = status;
    order.statusHistory.push({ status, changedBy: 'admin', timestamp: new Date() });

    const io = req.app.get('io');
    if (io) {
      io.emit('order_status_updated', {
        orderId: order.orderId,
        _id: order._id,
        newStatus: status,
        customerName: order.customerName,
        source: 'Admin Panel',
        updatedAt: new Date(),
      });
    }

    res.json({ success: true, message: 'অর্ডার স্ট্যাটাস আপডেট হয়েছে।', order });
  } catch (err) {
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// PATCH /api/orders/admin/bulk-status - Bulk update status for multiple orders
const bulkUpdateOrderStatus = async (req, res) => {
  try {
    const ids = req.body.ids || req.body.orderIds;
    const { status } = req.body;
    const validStatuses = ['Pending', 'Confirmed', 'Scheduled', 'Processing', 'Hold', 'Shipped', 'Delivered', 'Partial Delivered', 'Cancelled'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'অবৈধ স্ট্যাটাস।' });
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'কমপক্ষে একটি অর্ডার নির্বাচন করুন।' });
    }

    const changedBy = req.user ? (req.user.name || req.user.email || 'admin') : 'admin';
    const historyEntry = {
      status,
      changedAt: new Date(),
      changedBy,
    };

    if (getDBStatus().isConnected) {
      const isObjectId = (id) => typeof id === 'string' && id.match(/^[0-9a-fA-F]{24}$/);
      const objectIds = ids.filter(isObjectId);
      const czOrderIds = ids.filter((id) => !isObjectId(id));

      const queryConditions = [];
      if (objectIds.length > 0) queryConditions.push({ _id: { $in: objectIds } });
      if (czOrderIds.length > 0) queryConditions.push({ orderId: { $in: czOrderIds } });

      const filter = queryConditions.length > 0 ? { $or: queryConditions } : { _id: { $in: ids } };

      const orders = await Order.find(filter);
      for (const order of orders) {
        order.status = status;
        if (!order.statusHistory) order.statusHistory = [];
        order.statusHistory.push({
          status,
          changedBy,
          changedAt: new Date(),
        });
        await order.save();
      }

      // Socket.io emit if available
      const io = req.app.get('io');
      if (io) {
        io.emit('bulkStatusUpdated', { ids, status, changedBy });
        io.emit('orders_bulk_status_updated', {
          orderIds: ids,
          status,
          count: orders.length,
        });
      }

      return res.json({
        success: true,
        message: `${orders.length} টি অর্ডারের স্ট্যাটাস সফলভাবে '${status}' করা হয়েছে।`,
        modifiedCount: orders.length,
        updatedCount: orders.length,
      });
    }

    // Mock fallback
    let updatedCount = 0;
    mockOrders.forEach((o) => {
      if (ids.includes(o._id) || ids.includes(o.orderId)) {
        o.status = status;
        if (!o.statusHistory) o.statusHistory = [];
        o.statusHistory.push(historyEntry);
        updatedCount++;
      }
    });

    return res.json({
      success: true,
      message: `${updatedCount} টি অর্ডারের স্ট্যাটাস সফলভাবে '${status}' করা হয়েছে।`,
      modifiedCount: updatedCount,
      updatedCount,
    });
  } catch (err) {
    console.error('[bulkUpdateOrderStatus Error]', err);
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// PUT /api/admin/orders/:id - Update full order details
const updateOrder = async (req, res) => {
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
      unitPrice,
      deliveryCharge,
      totalPrice,
      paymentMethod,
      status,
      orderNotes,
    } = req.body;

    const validStatuses = ['Pending', 'Confirmed', 'Scheduled', 'Processing', 'Hold', 'Shipped', 'Delivered', 'Partial Delivered', 'Cancelled'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'অবৈধ স্ট্যাটাস।' });
    }

    if (getDBStatus().isConnected) {
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ success: false, message: 'অর্ডার পাওয়া যায়নি।' });

      if (customerName !== undefined) order.customerName = customerName.trim();
      if (phoneNumber !== undefined) order.phoneNumber = phoneNumber.trim();
      if (email !== undefined) order.email = email.trim();
      if (address !== undefined) order.address = address.trim();
      if (district !== undefined) order.district = district.trim();
      if (thana !== undefined) order.thana = thana.trim();
      if (productName !== undefined) order.productName = productName.trim();
      if (quantity !== undefined) order.quantity = Number(quantity) || 1;
      if (size !== undefined) {
        order.size = (String(size).includes('5.7') || String(size).includes('৫.৭')) ? '5.7 inch' : '6.7 inch';
      }
      if (unitPrice !== undefined) order.unitPrice = Number(unitPrice);
      if (deliveryCharge !== undefined) order.deliveryCharge = Number(deliveryCharge);

      if (totalPrice !== undefined && totalPrice !== null) {
        order.totalPrice = Number(totalPrice);
      } else if (quantity !== undefined || unitPrice !== undefined || deliveryCharge !== undefined) {
        const uPrice = unitPrice !== undefined ? Number(unitPrice) : (order.unitPrice || 950);
        const qty = quantity !== undefined ? Number(quantity) : (order.quantity || 1);
        const dCharge = deliveryCharge !== undefined ? Number(deliveryCharge) : (order.deliveryCharge || 0);
        order.totalPrice = (uPrice * qty) + dCharge;
      }

      if (paymentMethod !== undefined) order.paymentMethod = paymentMethod;
      if (orderNotes !== undefined) order.orderNotes = orderNotes;

      const statusChanged = Boolean(status && status !== order.status);
      if (statusChanged) {
        order.status = status;
        order.statusHistory.push({
          status,
          changedBy: req.user?.id || 'admin',
          changedAt: new Date(),
        });
      }

      await order.save();

      if (statusChanged) {
        const io = req.app.get('io');
        if (io) {
          io.emit('order_status_updated', {
            orderId: order.orderId,
            _id: order._id,
            newStatus: status,
            customerName: order.customerName,
            source: req.user?.name || req.user?.email || 'Admin Panel',
            updatedAt: new Date(),
          });
        }
      }

      return res.json({ success: true, message: 'অর্ডার সফলভাবে আপডেট করা হয়েছে।', order });
    }

    // Mock fallback
    const orderIndex = mockOrders.findIndex((o) => o._id === req.params.id || o.orderId === req.params.id);
    if (orderIndex === -1) {
      return res.status(404).json({ success: false, message: 'অর্ডার পাওয়া যায়নি।' });
    }

    const order = mockOrders[orderIndex];
    if (customerName !== undefined) order.customerName = customerName.trim();
    if (phoneNumber !== undefined) order.phoneNumber = phoneNumber.trim();
    if (email !== undefined) order.email = email.trim();
    if (address !== undefined) order.address = address.trim();
    if (district !== undefined) order.district = district.trim();
    if (thana !== undefined) order.thana = thana.trim();
    if (productName !== undefined) order.productName = productName.trim();
    if (quantity !== undefined) order.quantity = Number(quantity) || 1;
    if (size !== undefined) {
      order.size = (String(size).includes('5.7') || String(size).includes('৫.৭')) ? '5.7 inch' : '6.7 inch';
    }
    if (unitPrice !== undefined) order.unitPrice = Number(unitPrice);
    if (deliveryCharge !== undefined) order.deliveryCharge = Number(deliveryCharge);

    if (totalPrice !== undefined && totalPrice !== null) {
      order.totalPrice = Number(totalPrice);
    } else if (quantity !== undefined || unitPrice !== undefined || deliveryCharge !== undefined) {
      const uPrice = unitPrice !== undefined ? Number(unitPrice) : (order.unitPrice || 950);
      const qty = quantity !== undefined ? Number(quantity) : (order.quantity || 1);
      const dCharge = deliveryCharge !== undefined ? Number(deliveryCharge) : (order.deliveryCharge || 0);
      order.totalPrice = (uPrice * qty) + dCharge;
    }

    if (paymentMethod !== undefined) order.paymentMethod = paymentMethod;
    if (orderNotes !== undefined) order.orderNotes = orderNotes;

    const mockStatusChanged = Boolean(status && status !== order.status);
    if (mockStatusChanged) {
      order.status = status;
      if (!order.statusHistory) order.statusHistory = [];
      order.statusHistory.push({
        status,
        changedBy: 'admin',
        timestamp: new Date(),
      });
    }

    mockOrders[orderIndex] = order;

    if (mockStatusChanged) {
      const io = req.app.get('io');
      if (io) {
        io.emit('order_status_updated', {
          orderId: order.orderId,
          _id: order._id,
          newStatus: status,
          customerName: order.customerName,
          source: 'Admin Panel',
          updatedAt: new Date(),
        });
      }
    }

    return res.json({ success: true, message: 'অর্ডার সফলভাবে আপডেট করা হয়েছে।', order });
  } catch (err) {
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// DELETE /api/admin/orders/:id - Soft delete order
const softDeleteOrder = async (req, res) => {
  try {
    const { id } = req.params;
    if (getDBStatus().isConnected) {
      const order = await Order.findById(id);
      if (!order) return res.status(404).json({ success: false, message: 'অর্ডার পাওয়া যায়নি।' });
      order.isDeleted = true;
      order.deletedAt = new Date();
      order.statusHistory.push({
        status: 'Deleted',
        changedBy: req.user?.id || 'admin',
        changedAt: new Date(),
      });
      await order.save();
      return res.json({ success: true, message: 'অর্ডারটি সফলভাবে ট্র্যাশে সরানো হয়েছে।' });
    }

    const order = mockOrders.find((o) => o._id === id || o.orderId === id);
    if (!order) return res.status(404).json({ success: false, message: 'অর্ডার পাওয়া যায়নি।' });
    order.isDeleted = true;
    order.deletedAt = new Date();
    res.json({ success: true, message: 'অর্ডারটি সফলভাবে ট্র্যাশে সরানো হয়েছে।' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// PATCH /api/admin/orders/:id/restore - Restore soft-deleted order
const restoreOrder = async (req, res) => {
  try {
    const { id } = req.params;
    if (getDBStatus().isConnected) {
      const order = await Order.findById(id);
      if (!order) return res.status(404).json({ success: false, message: 'অর্ডার পাওয়া যায়নি।' });
      order.isDeleted = false;
      order.deletedAt = null;
      order.statusHistory.push({
        status: 'Restored',
        changedBy: req.user?.id || 'admin',
        changedAt: new Date(),
      });
      await order.save();
      return res.json({ success: true, message: 'অর্ডারটি সফলভাবে পুনরুদ্ধার করা হয়েছে।' });
    }

    const order = mockOrders.find((o) => o._id === id || o.orderId === id);
    if (!order) return res.status(404).json({ success: false, message: 'অর্ডার পাওয়া যায়নি।' });
    order.isDeleted = false;
    order.deletedAt = null;
    res.json({ success: true, message: 'অর্ডারটি সফলভাবে পুনরুদ্ধার করা হয়েছে।' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// DELETE /api/admin/orders/:id/permanent - Permanent hard delete order
const permanentDeleteOrder = async (req, res) => {
  try {
    const { id } = req.params;
    if (getDBStatus().isConnected) {
      const order = await Order.findByIdAndDelete(id);
      if (!order) return res.status(404).json({ success: false, message: 'অর্ডার পাওয়া যায়নি।' });
      return res.json({ success: true, message: 'অর্ডারটি স্থায়ীভাবে মুছে ফেলা হয়েছে।' });
    }

    const idx = mockOrders.findIndex((o) => o._id === id || o.orderId === id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'অর্ডার পাওয়া যায়নি।' });
    mockOrders.splice(idx, 1);
    res.json({ success: true, message: 'অর্ডারটি স্থায়ীভাবে মুছে ফেলা হয়েছে।' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// GET /api/admin/orders/stats
const getOrderStats = async (req, res) => {
  try {
    const formatBDDate = (date) => {
      const d = new Date(date);
      const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
      const bdDate = new Date(utc + (3600000 * 6));
      const year = bdDate.getFullYear();
      const month = String(bdDate.getMonth() + 1).padStart(2, '0');
      const day = String(bdDate.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    if (getDBStatus().isConnected) {
      const [
        totalOrders,
        deliveredOrders,
        pendingOrders,
        cancelledOrders,
        totalRevenueResult,
        uniquePhones,
        recentDailyOrders,
      ] = await Promise.all([
        Order.countDocuments({ isDeleted: { $ne: true } }),
        Order.countDocuments({ status: 'Delivered', isDeleted: { $ne: true } }),
        Order.countDocuments({ status: 'Pending', isDeleted: { $ne: true } }),
        Order.countDocuments({ status: 'Cancelled', isDeleted: { $ne: true } }),
        Order.aggregate([
          { $match: { status: 'Delivered', isDeleted: { $ne: true } } },
          { $group: { _id: null, total: { $sum: '$totalPrice' } } },
        ]),
        Order.distinct('phoneNumber', { status: 'Delivered', isDeleted: { $ne: true } }),
        Order.aggregate([
          { $match: { status: 'Delivered', createdAt: { $gte: sevenDaysAgo }, isDeleted: { $ne: true } } },
          {
            $group: {
              _id: {
                $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: '+06:00' },
              },
              count: { $sum: 1 },
              revenue: { $sum: '$totalPrice' },
            },
          },
          { $sort: { _id: 1 } },
        ]),
      ]);

      const dailyTrend = [];
      for (let i = 6; i >= 0; i--) {
        const targetDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateStr = formatBDDate(targetDate);
        const found = recentDailyOrders.find((x) => x._id === dateStr);
        dailyTrend.push({
          date: dateStr,
          count: found ? found.count : 0,
          revenue: found ? found.revenue : 0,
        });
      }

      return res.json({
        success: true,
        stats: {
          totalOrders,
          deliveredOrders,
          pendingOrders,
          cancelledOrders,
          uniqueCustomers: uniquePhones.length,
          totalRevenue: totalRevenueResult[0]?.total || 0,
          deliveryRate: totalOrders > 0 ? Math.round((deliveredOrders / totalOrders) * 100) : 0,
        },
        dailyTrend,
      });
    }

    // Mock stats calculation
    const activeMockOrders = mockOrders.filter((o) => !o.isDeleted);
    const deliveredMockOrders = activeMockOrders.filter((o) => o.status === 'Delivered');
    const totalOrders = activeMockOrders.length;
    const deliveredOrders = deliveredMockOrders.length;
    const pendingOrders = activeMockOrders.filter((o) => o.status === 'Pending').length;
    const cancelledOrders = activeMockOrders.filter((o) => o.status === 'Cancelled').length;
    const totalRevenue = deliveredMockOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
    const uniquePhones = new Set(deliveredMockOrders.map((o) => o.phoneNumber)).size;

    const dailyTrend = [];
    for (let i = 6; i >= 0; i--) {
      const targetDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = formatBDDate(targetDate);
      const ordersOnDay = deliveredMockOrders.filter((o) => formatBDDate(o.createdAt) === dateStr);
      dailyTrend.push({
        date: dateStr,
        count: ordersOnDay.length,
        revenue: ordersOnDay.reduce((sum, o) => sum + o.totalPrice, 0),
      });
    }

    res.json({
      success: true,
      stats: {
        totalOrders,
        deliveredOrders,
        pendingOrders,
        cancelledOrders,
        uniqueCustomers: uniquePhones,
        totalRevenue,
        deliveryRate: totalOrders > 0 ? Math.round((deliveredOrders / totalOrders) * 100) : 0,
      },
      dailyTrend,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// POST /api/admin/orders/export - Export Excel (.xlsx) / Google Sheets format
const exportOrdersExcel = async (req, res) => {
  try {
    const { ids, status, isDeleted, size } = req.body;
    let orders = [];

    const isDeletedFilter = isDeleted === true ? true : { $ne: true };

    if (getDBStatus().isConnected) {
      let query = { isDeleted: isDeletedFilter };
      if (ids && ids.length > 0) {
        const validObjectIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
        query = {
          $and: [
            { isDeleted: isDeletedFilter },
            {
              $or: [
                { _id: { $in: validObjectIds } },
                { orderId: { $in: ids } },
              ],
            },
          ],
        };
      } else {
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
      }
      orders = await Order.find(query).sort({ createdAt: -1 }).lean();
    } else {
      orders = mockOrders.filter((o) => (isDeleted === true ? o.isDeleted === true : !o.isDeleted));
      if (ids && ids.length > 0) {
        orders = orders.filter((o) => ids.includes(o._id) || ids.includes(o.orderId));
      } else {
        if (status && status !== 'all') {
          orders = orders.filter((o) => o.status === status);
        }
        if (size && size !== 'all') {
          const clean = String(size).trim();
          if (clean.includes('5.7') || clean.includes('৫.৭')) {
            orders = orders.filter(
              (o) => o.size && (o.size.includes('5.7') || o.size.includes('৫.৭'))
            );
          } else {
            orders = orders.filter(
              (o) => !o.size || o.size.includes('6.7') || o.size.includes('৬.৭')
            );
          }
        }
      }
    }

    const excelRows = orders.map((o) => ({
      'অর্ডার আইডি (Order ID)': o.orderId || '',
      'অর্ডারের তারিখ ও সময় (Date & Time GMT+6)': o.createdAt
        ? new Date(o.createdAt).toLocaleString('bn-BD', {
            timeZone: 'Asia/Dhaka',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          })
        : '',
      'গ্রাহকের নাম (Customer)': o.customerName || '',
      'মোবাইল নম্বর (Phone)': o.phoneNumber || '',
      'ইমেইল (Email)': o.email || '',
      'ঠিকানা (Address)': o.address || '',
      'জেলা (District)': o.district || '',
      'থানা (Thana)': o.thana || '',
      'পণ্য (Product)': o.productName || 'চীন ড্রাগন সিলিকন ম্যাজিক কনডম',
      'পরিমাণ (Quantity)': o.quantity || 1,
      'সাইজ (Size)': (o.size && (o.size.includes('5.7') || o.size.includes('৫.৭'))) ? '৫.৭ ইঞ্চি (5.7 inch)' : '৬.৭ ইঞ্চি (6.7 inch)',
      'প্রতিটির মূল্য (Unit Price)': o.unitPrice || 950,
      'ডেলিভারি চার্জ (Delivery)': o.deliveryCharge || 0,
      'সর্বমোট মূল্য (Total)': o.totalPrice || 950,
      'পেমেন্ট মেথড (Payment)': o.paymentMethod || 'Cash on Delivery',
      'স্ট্যাটাস (Status)': o.status || 'Pending',
      'নোট (Notes)': o.orderNotes || '',
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelRows);

    // Set practical column widths for optimal reading in Excel & Google Sheets
    worksheet['!cols'] = [
      { wch: 15 }, // Order ID
      { wch: 24 }, // Date
      { wch: 22 }, // Customer Name
      { wch: 18 }, // Phone
      { wch: 25 }, // Email
      { wch: 40 }, // Address
      { wch: 16 }, // District
      { wch: 16 }, // Thana
      { wch: 38 }, // Product
      { wch: 12 }, // Quantity
      { wch: 18 }, // Size
      { wch: 18 }, // Unit Price
      { wch: 18 }, // Delivery Charge
      { wch: 18 }, // Total Price
      { wch: 22 }, // Payment Method
      { wch: 14 }, // Status
      { wch: 30 }, // Notes
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Orders');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="orders-${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('[exportOrdersExcel Error]', err);
    res.status(500).json({ success: false, message: 'Excel এক্সপোর্ট ব্যর্থ হয়েছে।', error: err.message });
  }
};

// POST /api/orders/admin/block-ip
const blockIp = async (req, res) => {
  try {
    const { ip, reason } = req.body;
    if (!ip || !ip.trim()) {
      return res.status(400).json({ success: false, message: 'আইপি অ্যাড্রেস প্রদান করুন।' });
    }
    const cleanIp = ip.trim();

    if (getDBStatus().isConnected) {
      const blockedDoc = await BlockedIp.findOneAndUpdate(
        { ip: cleanIp },
        {
          ip: cleanIp,
          reason: reason?.trim() || 'Spam / Abuse',
          blockedBy: req.user?.id || 'admin',
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      return res.json({ success: true, message: `আইপি (${cleanIp}) সফলভাবে ব্লক করা হয়েছে।`, blockedIp: blockedDoc });
    }

    mockBlockedIps.add(cleanIp);
    return res.json({ success: true, message: `আইপি (${cleanIp}) সফলভাবে ব্লক করা হয়েছে।` });
  } catch (err) {
    console.error('[blockIp Error]', err);
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// DELETE /api/orders/admin/block-ip/:ip
const unblockIp = async (req, res) => {
  try {
    const { ip } = req.params;
    if (!ip) {
      return res.status(400).json({ success: false, message: 'আইপি অ্যাড্রেস প্রদান করুন।' });
    }
    const cleanIp = decodeURIComponent(ip).trim();

    if (getDBStatus().isConnected) {
      await BlockedIp.deleteOne({ ip: cleanIp });
    } else {
      mockBlockedIps.delete(cleanIp);
    }

    return res.json({ success: true, message: `আইপি (${cleanIp}) সফলভাবে আনব্লক করা হয়েছে।` });
  } catch (err) {
    console.error('[unblockIp Error]', err);
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// GET /api/orders/admin/blocked-ips
const getBlockedIps = async (req, res) => {
  try {
    if (getDBStatus().isConnected) {
      const blockedIps = await BlockedIp.find().sort({ createdAt: -1 });
      return res.json({ success: true, blockedIps });
    }

    const blockedIps = Array.from(mockBlockedIps).map((ip) => ({
      _id: `mock_ip_${ip}`,
      ip,
      reason: 'Spam / Abuse',
      blockedBy: 'admin',
      createdAt: new Date().toISOString(),
    }));
    return res.json({ success: true, blockedIps });
  } catch (err) {
    console.error('[getBlockedIps Error]', err);
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// GET /api/orders/admin/blocked-entities
const getBlockedEntities = async (req, res) => {
  try {
    if (getDBStatus().isConnected) {
      const [entities, legacyIps] = await Promise.all([
        BlockedEntity.find().sort({ createdAt: -1 }),
        BlockedIp.find().sort({ createdAt: -1 }),
      ]);

      const allEntities = [...entities];
      const existingIps = new Set(entities.filter((e) => e.type === 'ip').map((e) => e.value));
      legacyIps.forEach((lip) => {
        if (!existingIps.has(lip.ip)) {
          allEntities.push({
            _id: lip._id,
            type: 'ip',
            value: lip.ip,
            reason: lip.reason,
            blockedBy: lip.blockedBy,
            createdAt: lip.createdAt,
          });
        }
      });

      return res.json({ success: true, entities: allEntities });
    }

    // Mock fallback
    const entities = [
      ...Array.from(mockBlockedIps).map((ip) => ({
        _id: `mock_ip_${ip}`,
        type: 'ip',
        value: ip,
        reason: 'Spam / Abuse',
        blockedBy: 'admin',
        createdAt: new Date(),
      })),
      ...Array.from(mockBlockedPhones).map((phone) => ({
        _id: `mock_phone_${phone}`,
        type: 'phone',
        value: phone,
        reason: 'Spam / Abuse',
        blockedBy: 'admin',
        createdAt: new Date(),
      })),
      ...Array.from(mockBlockedDevices).map((dev) => ({
        _id: `mock_dev_${dev}`,
        type: 'device',
        value: dev,
        reason: 'Spam / Abuse',
        blockedBy: 'admin',
        createdAt: new Date(),
      })),
    ];
    return res.json({ success: true, entities });
  } catch (err) {
    console.error('[getBlockedEntities Error]', err);
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// POST /api/orders/admin/block-entity
const blockEntity = async (req, res) => {
  try {
    const { type, value, reason } = req.body;
    if (!type || !['ip', 'phone', 'device'].includes(type)) {
      return res.status(400).json({ success: false, message: 'ব্লকের ধরন (IP, Phone, বা Device) আবশ্যক।' });
    }
    if (!value || !String(value).trim()) {
      return res.status(400).json({ success: false, message: 'ভ্যালু আবশ্যক।' });
    }

    const cleanValue = type === 'phone' ? String(value).replace(/\s/g, '') : String(value).trim();
    const blockedBy = req.user ? (req.user.name || req.user.email || 'admin') : 'admin';
    const cleanReason = reason ? String(reason).trim() : 'স্প্যাম / অযাচিত অর্ডার';

    if (getDBStatus().isConnected) {
      const doc = await BlockedEntity.findOneAndUpdate(
        { type, value: cleanValue },
        { type, value: cleanValue, reason: cleanReason, blockedBy },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      if (type === 'ip') {
        await BlockedIp.findOneAndUpdate(
          { ip: cleanValue },
          { ip: cleanValue, reason: cleanReason, blockedBy },
          { upsert: true, new: true }
        ).catch(() => {});
      }
      return res.json({ success: true, message: `${type.toUpperCase()} সফলভাবে ব্লক করা হয়েছে।`, entity: doc });
    }

    if (type === 'ip') mockBlockedIps.add(cleanValue);
    if (type === 'phone') mockBlockedPhones.add(cleanValue);
    if (type === 'device') mockBlockedDevices.add(cleanValue);

    return res.json({ success: true, message: `${type.toUpperCase()} সফলভাবে ব্লক করা হয়েছে।` });
  } catch (err) {
    console.error('[blockEntity Error]', err);
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// POST /api/orders/admin/unblock-entity
const unblockEntity = async (req, res) => {
  try {
    const { type, value } = req.body;
    if (!type || !['ip', 'phone', 'device'].includes(type)) {
      return res.status(400).json({ success: false, message: 'ব্লকের ধরন আবশ্যক।' });
    }
    if (!value || !String(value).trim()) {
      return res.status(400).json({ success: false, message: 'ভ্যালু আবশ্যক।' });
    }

    const cleanValue = type === 'phone' ? String(value).replace(/\s/g, '') : String(value).trim();

    if (getDBStatus().isConnected) {
      await BlockedEntity.deleteOne({ type, value: cleanValue });
      if (type === 'ip') {
        await BlockedIp.deleteOne({ ip: cleanValue }).catch(() => {});
      }
      return res.json({ success: true, message: `${type.toUpperCase()} সফলভাবে আনব্লক করা হয়েছে।` });
    }

    if (type === 'ip') mockBlockedIps.delete(cleanValue);
    if (type === 'phone') mockBlockedPhones.delete(cleanValue);
    if (type === 'device') mockBlockedDevices.delete(cleanValue);

    return res.json({ success: true, message: `${type.toUpperCase()} সফলভাবে আনব্লক করা হয়েছে।` });
  } catch (err) {
    console.error('[unblockEntity Error]', err);
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// POST /api/orders/admin/block-all
const blockAllEntities = async (req, res) => {
  try {
    const { ip, phone, deviceId, reason } = req.body;
    const cleanReason = reason || 'স্প্যাম / অযাচিত অর্ডার';
    const blockedBy = req.user ? (req.user.name || req.user.email || 'admin') : 'admin';

    const operations = [];
    if (ip && String(ip).trim()) {
      operations.push({ type: 'ip', value: String(ip).trim() });
    }
    if (phone && String(phone).replace(/\s/g, '')) {
      operations.push({ type: 'phone', value: String(phone).replace(/\s/g, '') });
    }
    if (deviceId && String(deviceId).trim()) {
      operations.push({ type: 'device', value: String(deviceId).trim() });
    }

    if (operations.length === 0) {
      return res.status(400).json({ success: false, message: 'কোনো ব্লকযোগ্য তথ্য পাওয়া যায়নি।' });
    }

    if (getDBStatus().isConnected) {
      for (const op of operations) {
        await BlockedEntity.findOneAndUpdate(
          { type: op.type, value: op.value },
          { type: op.type, value: op.value, reason: cleanReason, blockedBy },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        if (op.type === 'ip') {
          await BlockedIp.findOneAndUpdate(
            { ip: op.value },
            { ip: op.value, reason: cleanReason, blockedBy },
            { upsert: true, new: true }
          ).catch(() => {});
        }
      }
    } else {
      operations.forEach((op) => {
        if (op.type === 'ip') mockBlockedIps.add(op.value);
        if (op.type === 'phone') mockBlockedPhones.add(op.value);
        if (op.type === 'device') mockBlockedDevices.add(op.value);
      });
    }

    return res.json({
      success: true,
      message: 'আইপি, ফোন নম্বর এবং ডিভাইস আইডি সফলভাবে ব্লক করা হয়েছে।',
    });
  } catch (err) {
    console.error('[blockAllEntities Error]', err);
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// POST /api/orders/admin/unblock-all
const unblockAllEntities = async (req, res) => {
  try {
    const { ip, phone, deviceId } = req.body;
    const operations = [];
    if (ip && String(ip).trim()) operations.push({ type: 'ip', value: String(ip).trim() });
    if (phone && String(phone).replace(/\s/g, '')) operations.push({ type: 'phone', value: String(phone).replace(/\s/g, '') });
    if (deviceId && String(deviceId).trim()) operations.push({ type: 'device', value: String(deviceId).trim() });

    if (operations.length === 0) {
      return res.status(400).json({ success: false, message: 'কোনো আনব্লকযোগ্য তথ্য পাওয়া যায়নি।' });
    }

    if (getDBStatus().isConnected) {
      for (const op of operations) {
        await BlockedEntity.deleteOne({ type: op.type, value: op.value });
        if (op.type === 'ip') {
          await BlockedIp.deleteOne({ ip: op.value }).catch(() => {});
        }
      }
    } else {
      operations.forEach((op) => {
        if (op.type === 'ip') mockBlockedIps.delete(op.value);
        if (op.type === 'phone') mockBlockedPhones.delete(op.value);
        if (op.type === 'device') mockBlockedDevices.delete(op.value);
      });
    }

    return res.json({
      success: true,
      message: 'আইপি, ফোন নম্বর এবং ডিভাইস আইডি সফলভাবে আনব্লক করা হয়েছে।',
    });
  } catch (err) {
    console.error('[unblockAllEntities Error]', err);
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// POST /api/orders/admin/manual - Admin creates manual order directly
const createManualOrder = async (req, res) => {
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
      unitPrice,
      deliveryCharge,
      totalPrice,
      paymentMethod,
      status,
      orderNotes,
    } = req.body;

    if (!customerName || !phoneNumber || !address) {
      return res.status(400).json({
        success: false,
        message: 'গ্রাহকের নাম, মোবাইল নম্বর এবং সম্পূর্ণ ডেলিভারি ঠিকানা আবশ্যক।',
      });
    }

    const cleanPhone = String(phoneNumber).replace(/\s/g, '');
    const bdPhoneRegex = /^(?:\+88)?01[3-9]\d{8}$/;
    if (!bdPhoneRegex.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message: 'সঠিক বাংলাদেশি ফোন নম্বর দিন (01XXXXXXXXX)।',
      });
    }

    const qty = parseInt(quantity) || 1;
    const uPrice = unitPrice !== undefined ? Number(unitPrice) : 950;
    const dCharge = deliveryCharge !== undefined ? Number(deliveryCharge) : 0;
    const computedTotal = totalPrice !== undefined ? Number(totalPrice) : (uPrice * qty + dCharge);
    const orderId = await generateOrderId();
    const orderStatus = status || 'Pending';
    const adminUser = req.user ? (req.user.name || req.user.email || 'Admin') : 'Admin';

    const orderDoc = {
      orderId,
      customerName: customerName.trim(),
      phoneNumber: cleanPhone,
      email: email ? email.trim().toLowerCase() : '',
      address: address.trim(),
      district: district ? district.trim() : '',
      thana: thana ? thana.trim() : '',
      productName: productName && productName.trim() ? productName.trim() : 'চীন ড্রাগন সিলিকন ম্যাজিক কনডম (Top Notch Reusable)',
      quantity: qty,
      size: (size && (String(size).includes('5.7') || String(size).includes('৫.৭'))) ? '5.7 inch' : '6.7 inch',
      unitPrice: uPrice,
      deliveryCharge: dCharge,
      totalPrice: computedTotal,
      paymentMethod: paymentMethod || 'Cash on Delivery',
      isGuestOrder: false,
      orderNotes: orderNotes ? orderNotes.trim() : '',
      status: orderStatus,
      ipAddress: getClientIp(req),
      statusHistory: [
        {
          status: orderStatus,
          changedAt: new Date(),
          changedBy: `Manual (${adminUser})`,
          note: 'অ্যাডমিন ড্যাশবোর্ড থেকে ম্যানুয়াল তৈরি',
        },
      ],
    };

    let order;
    if (getDBStatus().isConnected) {
      order = await Order.create(orderDoc);
      console.log(`[Manual Order Saved in MongoDB Atlas] ID: ${order.orderId}, _id: ${order._id}`);

      // Auto-mark pending incomplete orders with this phone as Converted
      try {
        const IncompleteOrder = require('../models/IncompleteOrder');
        await IncompleteOrder.updateMany(
          { phoneNumber: cleanPhone, status: { $in: ['Pending', 'Contacted'] } },
          { $set: { status: 'Converted', convertedOrderId: order.orderId } }
        );
      } catch (incErr) {
        console.warn('[IncompleteOrder Sync Warning]', incErr.message);
      }
    } else {
      console.warn('[MongoDB Atlas Offline] Saving manual order in memory fallback');
      order = { ...orderDoc, _id: `ord_${Date.now()}`, createdAt: new Date() };
      mockOrders.unshift(order);
    }

    // Real-time WebSocket emission to admin dashboard
    const io = req.app.get('io');
    if (io) {
      const orderPayload = {
        _id: order._id ? order._id.toString() : `ord_${Date.now()}`,
        orderId: order.orderId,
        customerName: order.customerName,
        phoneNumber: order.phoneNumber,
        address: order.address,
        quantity: order.quantity,
        totalPrice: order.totalPrice,
        status: order.status,
        createdAt: order.createdAt || new Date().toISOString(),
      };
      io.emit('new_order', orderPayload);
    }

    return res.status(201).json({
      success: true,
      message: `ম্যানুয়াল অর্ডার (${order.orderId}) সফলভাবে তৈরি হয়েছে!`,
      order,
    });
  } catch (err) {
    console.error('[createManualOrder Error]', err);
    return res.status(500).json({
      success: false,
      message: 'সার্ভার ত্রুটি। ম্যানুয়াল অর্ডার তৈরি করতে সমস্যা হয়েছে।',
      error: err.message,
    });
  }
};

module.exports = {
  createOrder,
  createManualOrder,
  trackOrder,
  getMyOrders,
  getAllOrders,
  updateOrderStatus,
  updateOrder,
  bulkUpdateOrderStatus,
  softDeleteOrder,
  restoreOrder,
  permanentDeleteOrder,
  getOrderStats,
  exportOrdersExcel,
  exportOrdersCSV: exportOrdersExcel,
  blockIp,
  unblockIp,
  getBlockedIps,
  getBlockedEntities,
  blockEntity,
  unblockEntity,
  blockAllEntities,
  unblockAllEntities,
};

