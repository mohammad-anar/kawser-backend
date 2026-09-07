const mongoose = require('mongoose');

let isConnected = false;
let isMockMode = false;

const connectDB = async () => {
  if (isConnected) return;

  const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/personalcarebd';

  try {
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000,
    });
    isConnected = true;
    isMockMode = false;
    console.log(`[MongoDB] Successfully connected to database: ${mongoURI.includes('@') ? 'MongoDB Atlas Cloud' : mongoURI}`);
  } catch (error) {
    console.warn(`[MongoDB] Connection failed: ${error.message}`);
    console.warn('[MongoDB] Running with in-memory resilient fallback mode.');
    isMockMode = true;
    isConnected = false;
  }
};

const getDBStatus = () => ({ isConnected, isMockMode });

module.exports = { connectDB, getDBStatus };
