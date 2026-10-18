const express = require('express');
const router = express.Router();
const {
  getConfigStatus,
  sendOrderToSteadfast,
  sendBulkOrdersToSteadfast,
  checkSteadfastStatus,
  checkCustomerFraudScore,
} = require('../controllers/steadfastController');
const { protect, adminOnly } = require('../middleware/auth');

// All Steadfast courier endpoints are protected for admin use
router.get('/config-status', protect, adminOnly, getConfigStatus);
router.post('/send-order/:id', protect, adminOnly, sendOrderToSteadfast);
router.post('/send-bulk', protect, adminOnly, sendBulkOrdersToSteadfast);
router.get('/status/:orderId', protect, adminOnly, checkSteadfastStatus);
router.get('/fraud-score/:phone', protect, adminOnly, checkCustomerFraudScore);

module.exports = router;
