/**
 * Full-Stack Internet Radio Streaming System
 * Health Check Controller (src/controllers/healthController.js)
 * Implements GET /api/health (SRS Section 7 & T-01)
 */

const db = require('../config/db');

async function getHealth(req, res) {
  const dbStatus = db.getDBStatus();
  
  res.status(200).json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    database: {
      connected: dbStatus.isReady,
      driver: dbStatus.type,
      target: dbStatus.host
    }
  });
}

module.exports = {
  getHealth
};

