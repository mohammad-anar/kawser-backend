const express = require('express');
const router = express.Router();
const {
  register,
  login,
  adminLogin,
  getMe,
  forgotPassword,
  verifyForgotOtp,
  resetPassword,
  sendChangePasswordOtp,
  verifyChangePasswordOtp,
  changePassword,
} = require('../controllers/authController');
const { protect, adminOnly } = require('../middleware/auth');

// ── Public auth routes ────────────────────────────────────────────────────────
router.post('/register', register);
router.post('/login', login);
router.post('/admin/login', adminLogin);
router.get('/me', protect, getMe);

// ── Forgot password flow (public — no login required) ────────────────────────
// Step 1: Request OTP → email
router.post('/forgot-password', forgotPassword);
// Step 2: Verify OTP → returns short-lived resetToken JWT
router.post('/verify-forgot-otp', verifyForgotOtp);
// Step 3: Submit new password with resetToken in Authorization header
router.post('/reset-password', resetPassword);

// ── Change password flow (admin must be logged in) ───────────────────────────
// Step 1: Send OTP to admin's registered email
router.post('/send-change-otp', protect, adminOnly, sendChangePasswordOtp);
// Step 2: Verify OTP → returns short-lived resetToken JWT
router.post('/verify-change-otp', protect, adminOnly, verifyChangePasswordOtp);
// Step 3: Submit new password with resetToken in X-Reset-Token header
router.post('/change-password', protect, adminOnly, changePassword);

module.exports = router;
