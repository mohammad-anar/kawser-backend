const User = require('../models/User');

/**
 * Auto-seeds the default admin user on server startup.
 * Safe to call from server.js — does NOT call process.exit().
 * Reads credentials from env vars (falls back to defaults).
 */
const seedAdmin = async () => {
  const email = (process.env.ADMIN_EMAIL || 'admin@personalcarebd.com').toLowerCase();
  const phone = process.env.ADMIN_PHONE || '01700000000';
  const password = process.env.ADMIN_PASSWORD || 'admin123456';
  const name = process.env.ADMIN_NAME || 'Admin';

  try {
    const existing = await User.findOne({
      role: 'admin',
      $or: [{ phone }, { email }],
    });

    if (existing) {
      // Update credentials if they changed in env
      existing.email = email;
      existing.phone = phone;
      existing.name = name;
      // Only rehash if password field is dirty (i.e. changed in env)
      const isSame = await existing.comparePassword(password).catch(() => false);
      if (!isSame) {
        existing.password = password; // pre-save hook will hash it
      }
      await existing.save();
      console.log(`[Seed] Admin synced → Email: ${email} | Phone: ${phone}`);
    } else {
      await User.create({ name, email, phone, password, role: 'admin' });
      console.log(`[Seed] Admin created → Email: ${email} | Phone: ${phone} | Password: ${password}`);
    }
  } catch (err) {
    console.error('[Seed] Admin seed error:', err.message);
  }
};

module.exports = seedAdmin;
