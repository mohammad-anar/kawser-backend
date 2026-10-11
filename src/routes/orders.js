const express = require('express');
const router = express.Router();
const {
  createOrder,
  trackOrder,
  getMyOrders,
  getAllOrders,
  updateOrderStatus,
  updateOrder,
  softDeleteOrder,
  restoreOrder,
  permanentDeleteOrder,
  getOrderStats,
  exportOrdersExcel,
  exportOrdersCSV,
  blockIp,
  unblockIp,
  getBlockedIps,
} = require('../controllers/orderController');
const {
  recordIncompleteOrder,
  getIncompleteOrders,
  updateIncompleteOrderStatus,
  convertIncompleteOrder,
  deleteIncompleteOrder,
} = require('../controllers/incompleteOrderController');
const { protect, adminOnly } = require('../middleware/auth');
const { orderRateLimiter } = require('../middleware/rateLimiter');

// Public routes
router.post('/', orderRateLimiter, createOrder);
router.post('/incomplete', recordIncompleteOrder);
router.get('/track', trackOrder);

// User-auth routes
router.get('/my', protect, getMyOrders);

// Admin routes: Standard Orders
router.get('/admin/all', protect, adminOnly, getAllOrders);
router.get('/admin/stats', protect, adminOnly, getOrderStats);
router.get('/admin/blocked-ips', protect, adminOnly, getBlockedIps);
router.post('/admin/block-ip', protect, adminOnly, blockIp);
router.delete('/admin/block-ip/:ip', protect, adminOnly, unblockIp);
router.patch('/admin/:id/status', protect, adminOnly, updateOrderStatus);
router.put('/admin/:id', protect, adminOnly, updateOrder);
router.delete('/admin/:id/permanent', protect, adminOnly, permanentDeleteOrder);
router.patch('/admin/:id/restore', protect, adminOnly, restoreOrder);
router.delete('/admin/:id', protect, adminOnly, softDeleteOrder);
router.post('/admin/export', protect, adminOnly, exportOrdersExcel);

// Admin routes: Incomplete / Abandoned Orders
router.get('/admin/incomplete', protect, adminOnly, getIncompleteOrders);
router.patch('/admin/incomplete/:id/status', protect, adminOnly, updateIncompleteOrderStatus);
router.post('/admin/incomplete/:id/convert', protect, adminOnly, convertIncompleteOrder);
router.delete('/admin/incomplete/:id', protect, adminOnly, deleteIncompleteOrder);

module.exports = router;
