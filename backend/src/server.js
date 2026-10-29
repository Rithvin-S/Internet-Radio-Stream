/**
 * Full-Stack Internet Radio Streaming System
 * HTTP Server Entrypoint (src/server.js)
 */

const app = require('./app');
const db = require('./config/db');

const PORT = parseInt(process.env.PORT || '5000', 10);

async function startServer() {
  console.log('======================================================================');
  console.log('   P U L S E C A S T   F U L L - S T A C K   B A C K E N D');
  console.log('   Node.js / Express + MySQL Engine (SRS v2.0 Compliant)');
  console.log('======================================================================');

  // Initialize Database Pool & Schemas
  try {
    await db.initDB();
  } catch (err) {
    console.error('[DB] Database initialization error:', err.message);
  }

  // Start HTTP Server
  const server = app.listen(PORT, () => {
    const dbStatus = db.getDBStatus();
    console.log(`\n[SERVER] PulseCast Backend is running on: http://localhost:${PORT}`);
    console.log(`[SERVER] Health Check: http://localhost:${PORT}/api/health`);
    console.log(`[SERVER] Stations API: http://localhost:${PORT}/api/stations`);
    console.log(`[SERVER] Database: ${dbStatus.type.toUpperCase()} (${dbStatus.isReady ? 'READY' : 'OFFLINE'})`);
    console.log('\n[INFO] Press Ctrl + C to gracefully stop the server.\n');
  });

  // Graceful Shutdown
  function handleShutdown(signal) {
    console.log(`\n[SERVER] Received ${signal}. Shutting down gracefully...`);
    server.close(() => {
      console.log('[SERVER] HTTP server closed.');
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

startServer();

