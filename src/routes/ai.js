const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const { parseOrderText } = require('../services/geminiService');

/**
 * POST /api/ai/parse-order
 * Parse raw order text using Gemini AI.
 * Body: { text: string }
 * Returns: { success, data: { customerName, phoneNumber, address, amount, orderNotes } }
 */
router.post('/parse-order', protect, adminOnly, async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ success: false, message: 'text field is required.' });
    }

    if (text.length > 2000) {
      return res.status(400).json({ success: false, message: 'Text too long (max 2000 characters).' });
    }

    const result = await parseOrderText(text.trim());

    if (!result.success) {
      if (result.isConfigMissing) {
        return res.status(503).json({ success: false, message: result.message, isConfigMissing: true });
      }
      return res.status(500).json({ success: false, message: result.message });
    }

    return res.json({ success: true, data: result.data });
  } catch (err) {
    console.error('[AI parse-order] Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'AI parsing failed.' });
  }
});

module.exports = router;
