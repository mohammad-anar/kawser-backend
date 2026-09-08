const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const User = require('../models/User');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const generateToken = (userId, role) => {
  return jwt.sign(
    { id: userId, role },
    process.env.JWT_SECRET || 'default_jwt_secret',
    { expiresIn: '7d' }
  );
};

/** Short-lived JWT specifically for password reset after OTP verification */
const generateResetToken = (userId, tokenId) => {
  return jwt.sign(
    { id: userId, tokenId, purpose: 'password_reset' },
    process.env.JWT_RESET_SECRET || 'default_reset_secret',
    { expiresIn: '15m' }
  );
};

/** Creates a configured Nodemailer transporter */
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: false, // TLS
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

/** Sends a 6-digit OTP email */
const sendOtpEmail = async (to, otp, subject = 'আপনার OTP কোড — Personal Care BD') => {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'Personal Care BD <noreply@personalcarebd.com>',
    to,
    subject,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:32px;background:#0d0d1e;border-radius:16px;color:#fff;border:1px solid #eab30840;">
        <h2 style="color:#eab308;margin-bottom:8px;">Personal Care BD</h2>
        <p style="color:#9ca3af;font-size:14px;">আপনার পাসওয়ার্ড পরিবর্তনের OTP কোড:</p>
        <div style="background:#1a1a2e;border:2px solid #eab30860;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
          <span style="font-size:40px;font-weight:900;letter-spacing:12px;color:#eab308;">${otp}</span>
        </div>
        <p style="color:#9ca3af;font-size:13px;">এই কোডটি <strong style="color:#fff;">১০ মিনিটের</strong> জন্য বৈধ।</p>
        <p style="color:#6b7280;font-size:12px;margin-top:16px;">যদি আপনি এই অনুরোধ না করে থাকেন, তাহলে এই ইমেইলটি উপেক্ষা করুন।</p>
      </div>
    `,
  });
};

// ─── Auth Controllers ──────────────────────────────────────────────────────────

// POST /api/auth/register
const register = async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;
    if (!name || !phone || !password) {
      return res.status(400).json({ success: false, message: 'নাম, ফোন নম্বর এবং পাসওয়ার্ড আবশ্যক।' });
    }
    const existing = await User.findOne({ phone });
    if (existing) {
      return res.status(409).json({ success: false, message: 'এই ফোন নম্বর দিয়ে আগেই অ্যাকাউন্ট তৈরি হয়েছে।' });
    }
    const user = await User.create({ name, phone, email, password, role: 'customer' });
    const token = generateToken(user._id, user.role);
    res.status(201).json({
      success: true,
      message: 'অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে।',
      token,
      user: { id: user._id, name: user.name, phone: user.phone, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ success: false, message: 'ফোন নম্বর এবং পাসওয়ার্ড আবশ্যক।' });
    }
    const user = await User.findOne({ phone }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'ফোন নম্বর অথবা পাসওয়ার্ড ভুল।' });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'আপনার অ্যাকাউন্ট নিষ্ক্রিয় করা হয়েছে।' });
    }
    const token = generateToken(user._id, user.role);
    res.json({
      success: true,
      message: 'সফলভাবে লগইন হয়েছে।',
      token,
      user: { id: user._id, name: user.name, phone: user.phone, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// POST /api/auth/admin/login
const adminLogin = async (req, res) => {
  try {
    const { email, phone, password } = req.body;
    const identifier = (email || phone || '').trim().toLowerCase();

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'অ্যাডমিন ইমেইল এবং পাসওয়ার্ড আবশ্যক।' });
    }

    const user = await User.findOne({
      role: 'admin',
      $or: [
        { email: identifier },
        { phone: identifier },
        { phone: identifier.replace(/\s/g, '') },
      ],
    }).select('+password');

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'ইমেইল অথবা পাসওয়ার্ড ভুল।' });
    }

    const token = generateToken(user._id, user.role);
    res.json({
      success: true,
      message: 'অ্যাডমিন লগইন সফল।',
      token,
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'ব্যবহারকারী পাওয়া যায়নি।' });
    res.json({ success: true, user: { id: user._id, name: user.name, phone: user.phone, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// ─── Forgot Password Flow (public) ──────────────────────────────────────────

// POST /api/auth/forgot-password
// Body: { email }
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'ইমেইল ঠিকানা আবশ্যক।' });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase(), role: 'admin' })
      .select('+passwordResetOtp +passwordResetOtpExpiry');

    // Always respond with success to prevent email enumeration
    if (!user) {
      return res.json({ success: true, message: 'যদি এই ইমেইলে অ্যাডমিন অ্যাকাউন্ট থাকে, OTP পাঠানো হয়েছে।' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = await bcrypt.hash(otp, 10);

    user.passwordResetOtp = hashedOtp;
    user.passwordResetOtpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    user.otpVerified = false;
    user.passwordResetTokenId = null;
    await user.save({ validateBeforeSave: false });

    try {
      await sendOtpEmail(user.email, otp, 'পাসওয়ার্ড রিসেট OTP — Personal Care BD');
    } catch (emailErr) {
      console.error('[Email Error]', emailErr.message);
      // Reset the OTP fields if email failed
      user.passwordResetOtp = undefined;
      user.passwordResetOtpExpiry = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ success: false, message: 'OTP ইমেইল পাঠাতে ব্যর্থ হয়েছে। পরে আবার চেষ্টা করুন।' });
    }

    res.json({ success: true, message: 'OTP পাঠানো হয়েছে। আপনার ইমেইল চেক করুন।' });
  } catch (err) {
    console.error('[forgotPassword Error]', err);
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// POST /api/auth/verify-forgot-otp
// Body: { email, otp }
const verifyForgotOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'ইমেইল এবং OTP আবশ্যক।' });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase(), role: 'admin' })
      .select('+passwordResetOtp +passwordResetOtpExpiry +passwordResetTokenId');

    if (!user || !user.passwordResetOtp) {
      return res.status(400).json({ success: false, message: 'OTP পাওয়া যায়নি। নতুন OTP অনুরোধ করুন।' });
    }

    if (user.passwordResetOtpExpiry < new Date()) {
      return res.status(400).json({ success: false, message: 'OTP এর মেয়াদ শেষ হয়ে গেছে। নতুন OTP অনুরোধ করুন।' });
    }

    const isMatch = await bcrypt.compare(otp, user.passwordResetOtp);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'OTP সঠিক নয়।' });
    }

    // Mark OTP as verified, clear it, issue a reset token ID
    const tokenId = crypto.randomBytes(16).toString('hex');
    user.passwordResetOtp = undefined;
    user.passwordResetOtpExpiry = undefined;
    user.otpVerified = true;
    user.passwordResetTokenId = tokenId;
    await user.save({ validateBeforeSave: false });

    const resetToken = generateResetToken(user._id, tokenId);

    res.json({
      success: true,
      message: 'OTP যাচাই সফল। নতুন পাসওয়ার্ড সেট করুন।',
      resetToken,
    });
  } catch (err) {
    console.error('[verifyForgotOtp Error]', err);
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// POST /api/auth/reset-password
// Header: Authorization: Bearer <resetToken>
// Body: { newPassword }
const resetPassword = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'রিসেট টোকেন আবশ্যক।' });
    }
    const resetToken = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_RESET_SECRET || 'default_reset_secret');
    } catch {
      return res.status(401).json({ success: false, message: 'রিসেট টোকেন অবৈধ বা মেয়াদোত্তীর্ণ।' });
    }

    if (decoded.purpose !== 'password_reset') {
      return res.status(401).json({ success: false, message: 'অবৈধ টোকেন।' });
    }

    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।' });
    }

    const user = await User.findById(decoded.id).select('+passwordResetTokenId +otpVerified');
    if (!user) {
      return res.status(404).json({ success: false, message: 'ব্যবহারকারী পাওয়া যায়নি।' });
    }

    // Validate one-time token ID (prevents re-use)
    if (!user.otpVerified || user.passwordResetTokenId !== decoded.tokenId) {
      return res.status(401).json({ success: false, message: 'রিসেট টোকেন ইতিমধ্যে ব্যবহার করা হয়েছে।' });
    }

    user.password = newPassword;
    user.passwordResetTokenId = undefined;
    user.otpVerified = false;
    await user.save();

    res.json({ success: true, message: 'পাসওয়ার্ড সফলভাবে পরিবর্তন হয়েছে। নতুন পাসওয়ার্ড দিয়ে লগইন করুন।' });
  } catch (err) {
    console.error('[resetPassword Error]', err);
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// ─── Change Password Flow (admin must be logged in) ──────────────────────────

// POST /api/auth/send-change-otp
// Requires: protect + adminOnly middleware
const sendChangePasswordOtp = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('+passwordResetOtp +passwordResetOtpExpiry');
    if (!user) {
      return res.status(404).json({ success: false, message: 'ব্যবহারকারী পাওয়া যায়নি।' });
    }
    if (!user.email) {
      return res.status(400).json({ success: false, message: 'অ্যাডমিন অ্যাকাউন্টে কোনো ইমেইল সেট করা নেই।' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = await bcrypt.hash(otp, 10);

    user.passwordResetOtp = hashedOtp;
    user.passwordResetOtpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    user.otpVerified = false;
    await user.save({ validateBeforeSave: false });

    try {
      await sendOtpEmail(user.email, otp, 'পাসওয়ার্ড পরিবর্তন OTP — Personal Care BD');
    } catch (emailErr) {
      console.error('[Email Error]', emailErr.message);
      user.passwordResetOtp = undefined;
      user.passwordResetOtpExpiry = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ success: false, message: 'OTP ইমেইল পাঠাতে ব্যর্থ হয়েছে।' });
    }

    res.json({
      success: true,
      message: `OTP পাঠানো হয়েছে ${user.email} এ। ১০ মিনিটের মধ্যে ব্যবহার করুন।`,
      email: user.email,
    });
  } catch (err) {
    console.error('[sendChangePasswordOtp Error]', err);
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// POST /api/auth/verify-change-otp
// Requires: protect + adminOnly middleware
// Body: { otp }
const verifyChangePasswordOtp = async (req, res) => {
  try {
    const { otp } = req.body;
    if (!otp) {
      return res.status(400).json({ success: false, message: 'OTP আবশ্যক।' });
    }

    const user = await User.findById(req.user.id)
      .select('+passwordResetOtp +passwordResetOtpExpiry +passwordResetTokenId');

    if (!user || !user.passwordResetOtp) {
      return res.status(400).json({ success: false, message: 'OTP পাওয়া যায়নি। নতুন OTP অনুরোধ করুন।' });
    }

    if (user.passwordResetOtpExpiry < new Date()) {
      return res.status(400).json({ success: false, message: 'OTP এর মেয়াদ শেষ হয়ে গেছে।' });
    }

    const isMatch = await bcrypt.compare(otp, user.passwordResetOtp);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'OTP সঠিক নয়।' });
    }

    const tokenId = crypto.randomBytes(16).toString('hex');
    user.passwordResetOtp = undefined;
    user.passwordResetOtpExpiry = undefined;
    user.otpVerified = true;
    user.passwordResetTokenId = tokenId;
    await user.save({ validateBeforeSave: false });

    const resetToken = generateResetToken(user._id, tokenId);

    res.json({
      success: true,
      message: 'OTP যাচাই সফল।',
      resetToken,
    });
  } catch (err) {
    console.error('[verifyChangePasswordOtp Error]', err);
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

// POST /api/auth/change-password
// Requires: protect + adminOnly middleware
// Header: X-Reset-Token: <resetToken>
// Body: { newPassword }
const changePassword = async (req, res) => {
  try {
    const resetToken = req.headers['x-reset-token'];
    if (!resetToken) {
      return res.status(401).json({ success: false, message: 'রিসেট টোকেন আবশ্যক।' });
    }

    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_RESET_SECRET || 'default_reset_secret');
    } catch {
      return res.status(401).json({ success: false, message: 'রিসেট টোকেন অবৈধ বা মেয়াদোত্তীর্ণ।' });
    }

    if (decoded.purpose !== 'password_reset' || decoded.id !== req.user.id) {
      return res.status(401).json({ success: false, message: 'অবৈধ টোকেন।' });
    }

    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।' });
    }

    const user = await User.findById(req.user.id).select('+passwordResetTokenId +otpVerified +password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'ব্যবহারকারী পাওয়া যায়নি।' });
    }

    if (!user.otpVerified || user.passwordResetTokenId !== decoded.tokenId) {
      return res.status(401).json({ success: false, message: 'রিসেট টোকেন ইতিমধ্যে ব্যবহার করা হয়েছে।' });
    }

    user.password = newPassword;
    user.passwordResetTokenId = undefined;
    user.otpVerified = false;
    await user.save();

    res.json({ success: true, message: 'পাসওয়ার্ড সফলভাবে পরিবর্তন হয়েছে।' });
  } catch (err) {
    console.error('[changePassword Error]', err);
    res.status(500).json({ success: false, message: 'সার্ভার ত্রুটি।', error: err.message });
  }
};

module.exports = {
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
};
