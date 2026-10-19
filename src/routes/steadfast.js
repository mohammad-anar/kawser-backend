const express = require('express');
const router = express.Router();
const {
  getConfigStatus,
  sendOrderToSteadfast,
  sendBulkOrdersToSteadfast,
  checkSteadfastStatus,
  checkCustomerFraudScore,
  handleSteadfastWebhook,
} = require('../controllers/steadfastController');
const { protect, adminOnly } = require('../middleware/auth');

// --- Public Webhook Endpoint (Called directly by Steadfast Courier) ---
router.post('/webhook', handleSteadfastWebhook);
router.get('/webhook', (req, res) => {
  res.json({
    success: true,
    message: 'Steadfast Webhook endpoint is active and listening for POST requests.',
    hasTokenConfigured: !!process.env.STEADFAST_WEBHOOK_TOKEN,
  });
});

// All Steadfast courier admin endpoints are protected for admin use
router.get('/config-status', protect, adminOnly, getConfigStatus);
router.post('/send-order/:id', protect, adminOnly, sendOrderToSteadfast);
router.post('/send-bulk', protect, adminOnly, sendBulkOrdersToSteadfast);
router.get('/status/:orderId', protect, adminOnly, checkSteadfastStatus);
router.get('/fraud-score/:phone', protect, adminOnly, checkCustomerFraudScore);

module.exports = router;
