const Order = require('../models/Order');
const { getDBStatus } = require('../config/db');
const steadfastService = require('../services/steadfastService');

// Check config status
const getConfigStatus = async (req, res) => {
  const isConfigured = Boolean(process.env.STEADFAST_API_KEY && process.env.STEADFAST_SECRET_KEY);
  return res.json({
    success: true,
    isConfigured,
    baseUrl: steadfastService.getBaseUrl(),
  });
};

// POST /api/steadfast/send-order/:id - Send single order to Steadfast
const sendOrderToSteadfast = async (req, res) => {
  try {
    const { id } = req.params;
    let order;

    if (getDBStatus().isConnected) {
      order = await Order.findOne({
        $or: [
          ...(id.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: id }] : []),
          { orderId: id },
        ],
      });
    }

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'অর্ডার পাওয়া যায়নি।',
      });
    }

    const sfRes = await steadfastService.createOrder(order);

    if (!sfRes.success) {
      return res.status(400).json({
        success: false,
        message: sfRes.message || 'স্টিডফাস্টে অর্ডার পাঠাতে সমস্যা হয়েছে।',
        details: sfRes,
      });
    }

    const consignment = sfRes.consignment || {};
    order.steadfast = {
      consignmentId: consignment.consignment_id || null,
      trackingCode: consignment.tracking_code || '',
      status: consignment.status || 'in_review',
      sentAt: new Date(),
      responseMessage: sfRes.message || 'Consignment created',
    };

    // If order was in Pending, move to Processing
    if (order.status === 'Pending') {
      order.status = 'Processing';
      if (!order.statusHistory) order.statusHistory = [];
      order.statusHistory.push({
        status: 'Processing',
        changedBy: req.user?.id || 'admin',
        changedAt: new Date(),
      });
    }

    if (getDBStatus().isConnected) {
      await order.save();
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('order_updated', order);
    }

    return res.json({
      success: true,
      message: `অর্ডার (${order.orderId}) সফলভাবে স্টিডফাস্টে পাঠানো হয়েছে! ট্র্যাকিং কোড: ${consignment.tracking_code || 'N/A'}`,
      order,
      consignment,
    });
  } catch (err) {
    console.error('[sendOrderToSteadfast Error]', err);
    return res.status(500).json({
      success: false,
      message: 'সার্ভার ত্রুটি। স্টিডফাস্টে পাঠানো যায়নি।',
      error: err.message,
    });
  }
};

// POST /api/steadfast/send-bulk - Send multiple selected orders to Steadfast
const sendBulkOrdersToSteadfast = async (req, res) => {
  try {
    const { orderIds } = req.body;

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'স্টিডফাস্টে পাঠানোর জন্য কমপক্ষে একটি অর্ডার নির্বাচন করুন।',
      });
    }

    let orders = [];

    if (getDBStatus().isConnected) {
      const isObjectId = (id) => typeof id === 'string' && id.match(/^[0-9a-fA-F]{24}$/);
      const objectIds = orderIds.filter(isObjectId);
      const czOrderIds = orderIds.filter((id) => !isObjectId(id));

      const queryConditions = [];
      if (objectIds.length > 0) queryConditions.push({ _id: { $in: objectIds } });
      if (czOrderIds.length > 0) queryConditions.push({ orderId: { $in: czOrderIds } });

      if (queryConditions.length > 0) {
        orders = await Order.find({ $or: queryConditions });
      }
    }

    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'নির্বাচিত কোনো অর্ডার পাওয়া যায়নি।',
      });
    }

    // Attempt bulk API first
    const sfBulkRes = await steadfastService.createBulkOrders(orders);

    let updatedOrders = [];
    let successCount = 0;
    let failedCount = 0;

    if (sfBulkRes.success) {
      const consignments = sfBulkRes.consignments || [];
      const consignmentMap = new Map();
      consignments.forEach((c) => {
        if (c.invoice) consignmentMap.set(c.invoice, c);
      });

      for (const order of orders) {
        const c = consignmentMap.get(order.orderId);
        if (c) {
          order.steadfast = {
            consignmentId: c.consignment_id || null,
            trackingCode: c.tracking_code || '',
            status: c.status || 'in_review',
            sentAt: new Date(),
            responseMessage: sfBulkRes.message || 'Bulk submitted',
          };
          if (order.status === 'Pending') {
            order.status = 'Processing';
            if (!order.statusHistory) order.statusHistory = [];
            order.statusHistory.push({
              status: 'Processing',
              changedBy: req.user?.id || 'admin',
              changedAt: new Date(),
            });
          }
          if (getDBStatus().isConnected) await order.save();
          updatedOrders.push(order);
          successCount++;
        } else {
          // If bulk map didn't have it, try single fallback
          const singleRes = await steadfastService.createOrder(order);
          if (singleRes.success && singleRes.consignment) {
            order.steadfast = {
              consignmentId: singleRes.consignment.consignment_id || null,
              trackingCode: singleRes.consignment.tracking_code || '',
              status: singleRes.consignment.status || 'in_review',
              sentAt: new Date(),
              responseMessage: singleRes.message,
            };
            if (getDBStatus().isConnected) await order.save();
            updatedOrders.push(order);
            successCount++;
          } else {
            failedCount++;
          }
        }
      }
    } else {
      // If bulk API failed (e.g. endpoint not supported on some accounts), fallback to sequential single calls
      for (const order of orders) {
        const singleRes = await steadfastService.createOrder(order);
        if (singleRes.success && singleRes.consignment) {
          order.steadfast = {
            consignmentId: singleRes.consignment.consignment_id || null,
            trackingCode: singleRes.consignment.tracking_code || '',
            status: singleRes.consignment.status || 'in_review',
            sentAt: new Date(),
            responseMessage: singleRes.message,
          };
          if (order.status === 'Pending') {
            order.status = 'Processing';
            if (!order.statusHistory) order.statusHistory = [];
            order.statusHistory.push({
              status: 'Processing',
              changedBy: req.user?.id || 'admin',
              changedAt: new Date(),
            });
          }
          if (getDBStatus().isConnected) await order.save();
          updatedOrders.push(order);
          successCount++;
        } else {
          failedCount++;
        }
      }
    }

    const io = req.app.get('io');
    if (io && updatedOrders.length > 0) {
      io.emit('orders_bulk_status_updated', {
        orderIds: updatedOrders.map((o) => o._id),
        status: 'Processing',
        count: updatedOrders.length,
      });
    }

    if (successCount === 0) {
      return res.status(400).json({
        success: false,
        message: sfBulkRes.message || 'স্টিডফাস্টে অর্ডার পাঠানো সম্ভব হয়নি। দয়া করে API Credentials চেক করুন।',
        details: sfBulkRes,
      });
    }

    return res.json({
      success: true,
      message: `${successCount} টি অর্ডার সফলভাবে স্টিডফাস্টে পাঠানো হয়েছে!${failedCount > 0 ? ` (${failedCount} টি ব্যর্থ)` : ''}`,
      successCount,
      failedCount,
      updatedOrders,
    });
  } catch (err) {
    console.error('[sendBulkOrdersToSteadfast Error]', err);
    return res.status(500).json({
      success: false,
      message: 'সার্ভার ত্রুটি। স্টিডফাস্টে বাল্ক অর্ডার পাঠানো যায়নি।',
      error: err.message,
    });
  }
};

// GET /api/steadfast/status/:orderId - Check & sync latest status from Steadfast
const checkSteadfastStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    let order;

    if (getDBStatus().isConnected) {
      order = await Order.findOne({
        $or: [
          ...(orderId.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: orderId }] : []),
          { orderId },
        ],
      });
    }

    if (!order) {
      return res.status(404).json({ success: false, message: 'অর্ডার পাওয়া যায়নি।' });
    }

    let sfRes;
    if (order.steadfast?.consignmentId) {
      sfRes = await steadfastService.getStatusByCid(order.steadfast.consignmentId);
    } else {
      sfRes = await steadfastService.getStatusByInvoice(order.orderId);
    }

    if (sfRes.success && sfRes.delivery_status) {
      order.steadfast.status = sfRes.delivery_status;
      if (getDBStatus().isConnected) {
        await order.save();
      }
    }

    return res.json({
      success: true,
      orderId: order.orderId,
      steadfast: order.steadfast,
      delivery_status: sfRes.delivery_status || order.steadfast?.status || 'unknown',
      details: sfRes,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'স্ট্যাটাস চেক ব্যর্থ হয়েছে।', error: err.message });
  }
};

// GET /api/steadfast/fraud-score/:phone - Check customer fraud score & delivery history
const checkCustomerFraudScore = async (req, res) => {
  try {
    const { phone } = req.params;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'ফোন নম্বর আবশ্যক।' });
    }

    const result = await steadfastService.checkFraudScore(phone);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'ফ্রড স্কোর চেক ব্যর্থ হয়েছে।',
      error: err.message,
    });
  }
};

module.exports = {
  getConfigStatus,
  sendOrderToSteadfast,
  sendBulkOrdersToSteadfast,
  checkSteadfastStatus,
  checkCustomerFraudScore,
};
