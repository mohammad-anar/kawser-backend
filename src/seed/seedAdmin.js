require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const { connectDB, getDBStatus } = require('../config/db');

const seedAdmin = async () => {
  await connectDB();
  const { isConnected } = getDBStatus();

  const email = (process.env.ADMIN_EMAIL || 'admin@personalcarebd.com').toLowerCase();
  const phone = process.env.ADMIN_PHONE || '01700000000';
  const password = process.env.ADMIN_PASSWORD || 'admin123456';
  const name = process.env.ADMIN_NAME || 'Admin';

  if (!isConnected) {
    console.log('[Seed] Notice: MongoDB is not connected.');
    console.log(`[Seed] Default Admin Credentials: Email = ${email}, Phone = ${phone}, Password = ${password}`);
    process.exit(0);
  }

  try {
    let adminUser = await User.findOne({
      role: 'admin',
      $or: [{ phone }, { email }],
    });

    if (adminUser) {
      adminUser.email = email;
      adminUser.phone = phone;
      adminUser.password = password; // Will be hashed by pre-save hook
      await adminUser.save();
      console.log(`[Seed] Admin updated successfully!`);
      console.log(`  Email: ${email}`);
      console.log(`  Phone: ${phone}`);
      console.log(`  Password: ${password}`);
      process.exit(0);
    }

    await User.create({ name, email, phone, password, role: 'admin' });
    console.log(`[Seed] Admin created successfully!`);
    console.log(`  Email: ${email}`);
    console.log(`  Phone: ${phone}`);
    console.log(`  Password: ${password}`);
    process.exit(0);
  } catch (err) {
    console.error('[Seed Error]', err.message);
    process.exit(0);
  }
};

seedAdmin();
