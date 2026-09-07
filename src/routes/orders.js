const express = require('express');
const router = express.Router();
const {
  createOrder,
  trackOrder,
  getMyOrders,
  getAllOrders,
  updateOrderStatus,
  getOrderStats,
  exportOrdersCSV,
} = require('../controllers/orderController');
const { protect, adminOnly } = require('../middleware/auth');

// Public routes
router.post('/', createOrder);
router.get('/track', trackOrder);

// User-auth routes
router.get('/my', protect, getMyOrders);

// Admin routes
router.get('/admin/all', protect, adminOnly, getAllOrders);
router.get('/admin/stats', protect, adminOnly, getOrderStats);
router.patch('/admin/:id/status', protect, adminOnly, updateOrderStatus);
router.post('/admin/export', protect, adminOnly, exportOrdersCSV);

module.exports = router;
