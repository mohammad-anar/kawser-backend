const Order = require('../models/Order');
const { getDBStatus } = require('../config/db');
const { Parser } = require('json2csv');

// In-memory orders store fallback when MongoDB is offline
const mockOrders = [
  {
    _id: 'mock_ord_1',
    orderId: 'PC-1082',
    customerName: 'তানভীর হাসান',
    phoneNumber: '01711223344',
    email: 'tanvir@gmail.com',
    address: 'বাড়ি ১২, রোড ৪, সেক্টর ৭, উত্তরা, ঢাকা',
    district: 'ঢাকা',
    thana: 'উত্তরা',
    gpsCoordinates: { lat: 23.8759, lng: 90.3795 },
    productName: 'চীন ড্রাগন সিলিকন ম্যাজিক কনডম (Top Notch Reusable)',
    quantity: 1,
    size: 'মিডিয়াম (52mm)',
    unitPrice: 899,
    deliveryCharge: 0,
    totalPrice: 899,
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
    orderId: 'PC-1085',
    customerName: 'আরিফুল ইসলাম',
    phoneNumber: '01899887766',
    email: '',
    address: 'ধানমন্ডি ৩২, ঢাকা',
    district: 'ঢাকা',
    thana: 'ধানমন্ডি',
    gpsCoordinates: { lat: 23.7511, lng: 90.3773 },
    productName: 'চীন ড্রাগন সিলিকন ম্যাজিক কনডম (Top Notch Reusable)',
    quantity: 2,
    size: 'লার্জ (56mm)',
    unitPrice: 899,
    deliveryCharge: 0,
    totalPrice: 1798,
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

// Helper to generate unique order ID
const generateOrderId = () => {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `PC-${num}`;
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
      orderNotes,
      userId,
      productName,
    } = req.body;

    if (!customerName || !phoneNumber || !address) {
      return res.status(400).json({
        success: false,
        message: 'নাম, ফোন নম্বর এবং ঠিকানা আবশ্যক।',
      });
    }

    const bdPhoneRegex = /^(?:\+88)?01[3-9]\d{8}$/;
    if (!bdPhoneRegex.test(phoneNumber.replace(/\s/g, ''))) {
      return res.status(400).json({
        success: false,
        message: 'সঠিক বাংলাদেশি ফোন নম্বর দিন (01XXXXXXXXX)।',
      });
    }

    const qty = parseInt(quantity) || 1;
    const unitPrice = 899;
    const totalPrice = unitPrice * qty;
    const orderId = generateOrderId();

    const cleanPhone = phoneNumber.replace(/\s/g, '');
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
      size: size ? String(size).trim() : 'স্ট্যান্ডার্ড',
      unitPrice,
      deliveryCharge: 0,
      totalPrice,
      paymentMethod: 'Cash on Delivery',
      isGuestOrder: !validUserId,
      userId: validUserId,
      orderNotes: orderNotes ? orderNotes.trim() : '',
      status: 'Pending',
      statusHistory: [{ status: 'Pending', changedAt: new Date(), changedBy: 'customer' }],
    };

    let order;
    if (getDBStatus().isConnected) {
      order = await Order.create(orderDoc);
      console.log(`[Order Saved in MongoDB Atlas] ID: ${order.orderId}, _id: ${order._id}`);
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
    const { status, search, page = 1, limit = 50 } = req.query;

    if (getDBStatus().isConnected) {
      const query = {};
      if (status && status !== 'all') query.status = status;
      if (search) {
        query.$or = [
          { orderId: { $regex: search, $options: 'i' } },
          { customerName: { $regex: search, $options: 'i' } },
          { phoneNumber: { $regex: search, $options: 'i' } },
        ];
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [orders, total] = await Promise.all([
        Order.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
        Order.countDocuments(query),
      ]);

      return res.json({ success: true, orders, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
    }

    // Mock fallback
    let filtered = [...mockOrders];
    if (status && status !== 'all') {
      filtered = filtered.filter((o) => o.status === status);
    }
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (o) =>
          o.orderId.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          o.phoneNumber.includes(q)
      );
    }

    const total = filtered.length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const orders = filtered.slice(skip, skip + parseInt(limit));

    res.json({ success: true, orders, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// PATCH /api/admin/orders/:id/status
const updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'অবৈধ স্ট্যাটাস।' });
    }

    if (getDBStatus().isConnected) {
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ success: false, message: 'অর্ডার পাওয়া যায়নি।' });

      order.status = status;
      order.statusHistory.push({ status, changedBy: req.user?.id || 'admin' });
      await order.save();
      return res.json({ success: true, message: 'অর্ডার স্ট্যাটাস আপডেট হয়েছে।', order });
    }

    const order = mockOrders.find((o) => o._id === req.params.id || o.orderId === req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'অর্ডার পাওয়া যায়নি।' });

    order.status = status;
    order.statusHistory.push({ status, changedBy: 'admin', timestamp: new Date() });

    res.json({ success: true, message: 'অর্ডার স্ট্যাটাস আপডেট হয়েছে।', order });
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
        totalRevenueResult,
        uniquePhones,
        recentDailyOrders,
      ] = await Promise.all([
        Order.countDocuments(),
        Order.countDocuments({ status: 'Delivered' }),
        Order.countDocuments({ status: 'Pending' }),
        Order.aggregate([{ $group: { _id: null, total: { $sum: '$totalPrice' } } }]),
        Order.distinct('phoneNumber'),
        Order.aggregate([
          { $match: { createdAt: { $gte: sevenDaysAgo } } },
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
          uniqueCustomers: uniquePhones.length,
          totalRevenue: totalRevenueResult[0]?.total || 0,
          deliveryRate: totalOrders > 0 ? Math.round((deliveredOrders / totalOrders) * 100) : 0,
        },
        dailyTrend,
      });
    }

    // Mock stats calculation
    const totalOrders = mockOrders.length;
    const deliveredOrders = mockOrders.filter((o) => o.status === 'Delivered').length;
    const pendingOrders = mockOrders.filter((o) => o.status === 'Pending').length;
    const totalRevenue = mockOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
    const uniquePhones = new Set(mockOrders.map((o) => o.phoneNumber)).size;

    const dailyTrend = [];
    for (let i = 6; i >= 0; i--) {
      const targetDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = formatBDDate(targetDate);
      const ordersOnDay = mockOrders.filter((o) => formatBDDate(o.createdAt) === dateStr);
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

// POST /api/admin/orders/export - Export CSV
const exportOrdersCSV = async (req, res) => {
  try {
    const { ids, status } = req.body;
    let orders = [];

    if (getDBStatus().isConnected) {
      let query = {};
      if (ids && ids.length > 0) {
        const validObjectIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
        query.$or = [
          { _id: { $in: validObjectIds } },
          { orderId: { $in: ids } },
        ];
      } else if (status && status !== 'all') {
        query.status = status;
      }
      orders = await Order.find(query).sort({ createdAt: -1 }).lean();
    } else {
      orders = [...mockOrders];
      if (ids && ids.length > 0) {
        orders = orders.filter((o) => ids.includes(o._id) || ids.includes(o.orderId));
      } else if (status && status !== 'all') {
        orders = orders.filter((o) => o.status === status);
      }
    }

    const fields = [
      { label: 'Order ID', value: 'orderId' },
      { label: 'Customer Name', value: 'customerName' },
      { label: 'Phone', value: 'phoneNumber' },
      { label: 'Email', value: 'email' },
      { label: 'Address', value: 'address' },
      { label: 'District', value: 'district' },
      { label: 'GPS Lat', value: 'gpsCoordinates.lat' },
      { label: 'GPS Lng', value: 'gpsCoordinates.lng' },
      { label: 'Product', value: 'productName' },
      { label: 'Quantity', value: 'quantity' },
      { label: 'Size', value: 'size' },
      { label: 'Unit Price (BDT)', value: 'unitPrice' },
      { label: 'Total Price (BDT)', value: 'totalPrice' },
      { label: 'Delivery Charge', value: 'deliveryCharge' },
      { label: 'Payment Method', value: 'paymentMethod' },
      { label: 'Status', value: 'status' },
      { label: 'Order Notes', value: 'orderNotes' },
      { label: 'Order Date', value: (row) => new Date(row.createdAt).toLocaleString('en-BD') },
    ];

    const parser = new Parser({ fields });
    const csv = parser.parse(orders);

    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header('Content-Disposition', `attachment; filename="orders-${Date.now()}.csv"`);
    res.send('\uFEFF' + csv); // BOM for Excel compatibility with Bangla text
  } catch (err) {
    res.status(500).json({ success: false, message: 'CSV এক্সপোর্ট ব্যর্থ।', error: err.message });
  }
};

module.exports = {
  createOrder,
  trackOrder,
  getMyOrders,
  getAllOrders,
  updateOrderStatus,
  getOrderStats,
  exportOrdersCSV,
};
