const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) {
    return res.status(401).json({ success: false, message: 'অ্যাক্সেসের জন্য লগইন করুন।' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_jwt_secret');
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'টোকেন অবৈধ বা মেয়াদোত্তীর্ণ।' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'শুধুমাত্র অ্যাডমিনের অ্যাক্সেস।' });
  }
  next();
};

module.exports = { protect, adminOnly };
