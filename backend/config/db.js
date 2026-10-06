const mongoose = require('mongoose');
const config = require('./index');

// Connects to MongoDB. If it fails we log the error but do NOT crash,
// so /api/health can still report "mongodb: disconnected" for debugging.
async function connectDB() {
  try {
    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 5000, // fail fast instead of hanging 30s
    });
    console.log(`[MongoDB] Connected: ${config.mongoUri}`);
  } catch (err) {
    console.error(`[MongoDB] Connection failed: ${err.message}`);
  }
}

module.exports = connectDB;