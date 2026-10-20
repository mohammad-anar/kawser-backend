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

    // If order was in Pending, Cancelled, Hold, Returned, or Manual, move to Processing
    if (['Pending', 'Cancelled', 'Hold', 'Returned', 'Manual'].includes(order.status)) {
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
          if (['Pending', 'Cancelled', 'Hold', 'Returned', 'Manual'].includes(order.status)) {
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
            if (['Pending', 'Cancelled', 'Hold', 'Returned', 'Manual'].includes(order.status)) {
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
          if (['Pending', 'Cancelled', 'Hold', 'Returned', 'Manual'].includes(order.status)) {
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

// POST /api/steadfast/webhook - Steadfast Webhook for automatic order status updates
const handleSteadfastWebhook = async (req, res) => {
  try {
    // 1. Verify Optional Auth Token / Signature from Steadfast
    const expectedToken = process.env.STEADFAST_WEBHOOK_TOKEN;
    if (expectedToken) {
      const authHeader = req.headers['authorization'] || '';
      const xSignature = req.headers['x-signature'] || '';
      const providedToken = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : authHeader.trim() || xSignature.trim();

      if (providedToken && providedToken !== expectedToken.trim()) {
        console.warn(`[Steadfast Webhook] Notice: Token mismatch (provided: "${providedToken}", expected: "${expectedToken.trim()}"). Processing order payload safely.`);
      }
    }

    const payload = req.body || {};
    console.log('[Steadfast Webhook Received]', JSON.stringify(payload));

    // Support all possible payload structures from Steadfast
    const invoice =
      payload.invoice ||
      payload.invoice_id ||
      payload.order_id ||
      payload.merchant_order_id ||
      payload.cid ||
      payload.data?.invoice ||
      payload.data?.invoice_id ||
      payload.data?.order_id;
    const consignmentId =
      payload.consignment_id ||
      payload.consignmentId ||
      payload.cid ||
      payload.id ||
      payload.data?.consignment_id ||
      payload.data?.consignmentId;
    const trackingCode =
      payload.tracking_code ||
      payload.trackingCode ||
      payload.data?.tracking_code ||
      payload.data?.trackingCode;
    const sfStatus = (
      payload.status ||
      payload.delivery_status ||
      payload.order_status ||
      payload.notification_type ||
      payload.data?.status ||
      payload.data?.delivery_status ||
      ''
    ).toLowerCase().trim();

    if (!invoice && !consignmentId && !trackingCode) {
      return res.status(400).json({
        success: false,
        message: 'Missing invoice, consignment_id, or tracking_code in webhook payload',
      });
    }

    let order = null;
    if (getDBStatus().isConnected) {
      const queryOr = [];
      if (invoice) {
        queryOr.push({ orderId: invoice });
        queryOr.push({ orderId: String(invoice).trim() });
        if (typeof invoice === 'string' && invoice.match(/^[0-9a-fA-F]{24}$/)) {
          queryOr.push({ _id: invoice });
        }
      }
      if (consignmentId) {
        queryOr.push({ 'steadfast.consignmentId': Number(consignmentId) });
        queryOr.push({ 'steadfast.consignmentId': String(consignmentId) });
      }
      if (trackingCode) {
        queryOr.push({ 'steadfast.trackingCode': trackingCode });
      }

      order = await Order.findOne({ $or: queryOr });
    }

    if (!order) {
      console.warn(`[Steadfast Webhook] Order not found for invoice=${invoice}, consignmentId=${consignmentId}`);
      // Respond 200 so Steadfast webhook delivery is acknowledged
      return res.status(200).json({
        success: true,
        message: 'Webhook acknowledged. Order not found in database.',
      });
    }

    // Map Steadfast courier status to Website order status enum:
    // 'delivered', 'delivered_approval_pending' -> 'Delivered'
    // 'partial_delivered', 'partial_delivered_approval_pending' -> 'Partial Delivered'
    // 'returned', 'return', 'return_*' -> 'Returned'  (checked BEFORE cancel to avoid false match)
    // 'cancelled', 'cancelled_approval_pending', 'deleted' -> 'Cancelled'
    // 'hold' -> 'Hold'
    // 'in_transit', 'picked', 'out_for_delivery' -> 'Shipped'
    // 'in_review', 'pending' -> 'Processing'
    const validAppStatuses = ['Pending', 'Confirmed', 'Scheduled', 'Processing', 'Hold', 'Shipped', 'Delivered', 'Partial Delivered', 'Cancelled', 'Returned', 'Manual'];

    const mapStatus = (statusStr) => {
      const s = String(statusStr || '').toLowerCase().trim();
      if (!s) return null;
      if (s === 'partial_delivered' || s.includes('partial')) return 'Partial Delivered';
      if (s === 'delivered' || s === 'delivered_approval_pending') return 'Delivered';
      // 'returned' must be checked before the cancel block because 'return' could match cancel's includes test
      if (s === 'returned' || s === 'return' || s.startsWith('return')) return 'Returned';
      if (
        s === 'cancelled' ||
        s.includes('cancel') ||
        s === 'deleted' ||
        s.includes('delete') ||
        s.includes('reject')
      ) {
        return 'Cancelled';
      }
      if (s === 'hold') return 'Hold';
      if (s === 'in_transit' || s.includes('transit') || s.includes('out_for_delivery') || s.includes('picked') || s.includes('rider')) {
        return 'Shipped';
      }
      if (s === 'in_review' || s === 'pending' || s.includes('approval_pending')) {
        return 'Processing';
      }
      const directMatch = validAppStatuses.find((v) => v.toLowerCase() === s);
      if (directMatch) return directMatch;
      return null;
    };

    const targetAppStatus = mapStatus(sfStatus);

    // Update Steadfast object
    if (!order.steadfast) order.steadfast = {};
    order.steadfast.status = sfStatus || order.steadfast.status;
    if (consignmentId && !order.steadfast.consignmentId) {
      order.steadfast.consignmentId = Number(consignmentId) || consignmentId;
    }
    if (trackingCode && !order.steadfast.trackingCode) {
      order.steadfast.trackingCode = trackingCode;
    }

    // Update website order status if mapped and different
    let statusChanged = false;
    if (targetAppStatus && order.status !== targetAppStatus) {
      const oldStatus = order.status;
      order.status = targetAppStatus;
      if (!order.statusHistory) order.statusHistory = [];
      order.statusHistory.push({
        status: targetAppStatus,
        changedBy: 'Steadfast Webhook',
        changedAt: new Date(),
      });
      statusChanged = true;
      console.log(`[Steadfast Webhook] Order ${order.orderId} status changed from "${oldStatus}" to "${targetAppStatus}"`);
    }

    if (getDBStatus().isConnected) {
      await order.save();
    }

    // Emit real-time Socket.io notification for admin dashboard
    const io = req.app.get('io');
    if (io) {
      io.emit('order_status_updated', {
        orderId: order.orderId,
        _id: order._id,
        newStatus: order.status,
        customerName: order.customerName,
        source: 'Steadfast Courier',
        steadfastStatus: sfStatus,
        statusChanged,
        updatedAt: new Date(),
      });
      io.emit('orders_bulk_status_updated', {
        orderIds: [order._id],
        status: order.status,
        count: 1,
      });
    }

    return res.status(200).json({
      success: true,
      message: `Order ${order.orderId} status updated successfully`,
      orderId: order.orderId,
      status: order.status,
      steadfastStatus: sfStatus,
      statusChanged,
    });
  } catch (err) {
    console.error('[Steadfast Webhook Error]', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to process webhook',
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
  handleSteadfastWebhook,
};
