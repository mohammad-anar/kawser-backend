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
router.put('/admin/:id', protect, adminOnly, updateOrder);
router.delete('/admin/:id/permanent', protect, adminOnly, permanentDeleteOrder);
router.patch('/admin/:id/restore', protect, adminOnly, restoreOrder);
router.delete('/admin/:id', protect, adminOnly, softDeleteOrder);
router.post('/admin/export', protect, adminOnly, exportOrdersExcel);

module.exports = router;
