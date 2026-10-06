// Central place for all configuration. No other file should read process.env directly.
require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 5000,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/cloudresq',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
};