const jwt = require('jsonwebtoken');
const User = require('../models/User');

const generateToken = (userId, role) => {
  return jwt.sign(
    { id: userId, role },
    process.env.JWT_SECRET || 'default_jwt_secret',
    { expiresIn: '7d' }
  );
};

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

    // Find admin by email or phone
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

module.exports = { register, login, adminLogin, getMe };
