/**
 * Full-Stack Internet Radio Streaming System
 * Express Application Configuration (src/app.js)
 * Implements Security, CORS, Middleware, REST APIs & Static Frontend Serving
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config(); // Fallback to current working directory
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const healthRoutes = require('./routes/health');
const stationRoutes = require('./routes/stations');
const authRoutes = require('./routes/auth');
const favouriteRoutes = require('./routes/favourites');
const adminRoutes = require('./routes/admin');
const streamingRoutes = require('./routes/streaming');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Enable trust proxy for Render / Vercel cloud deployment
app.set('trust proxy', 1);

// 1. Security Headers (Helmet) with relaxed Media and Script policies for Radio streaming
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
        mediaSrc: ["'self'", 'blob:', 'https:', 'http:'],
        connectSrc: ["'self'", 'https:', 'http:']
      }
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

// 2. CORS Configuration (Allows Vercel Frontend & Local Development)
const defaultOrigins = [
  'http://localhost:5000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:5000'
];

const envOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOriginsList = [...defaultOrigins, ...envOrigins];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (e.g. mobile apps, same-origin, curl)
      if (!origin) return callback(null, true);

      // 1. Explicitly configured origins (from CORS_ORIGIN or FRONTEND_URL env var)
      if (allowedOriginsList.includes(origin) || allowedOriginsList.includes('*')) {
        return callback(null, true);
      }

      // 2. Allow all deployed Vercel frontend URLs (*.vercel.app)
      if (/^https:\/\/[a-zA-Z0-9_.-]+\.vercel\.app$/.test(origin)) {
        return callback(null, true);
      }

      // 3. Allow local development origins
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }

      console.warn(`[CORS] Blocked request from unauthorized origin: ${origin}`);
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-radio-token', 'X-Radio-Token']
  })
);

// 3. Body Parsers and Cookie Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser(process.env.COOKIE_SECRET));

// 4. Safe Request Logger (never logs passwords - NFR-02)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.originalUrl.startsWith('/css') && !req.originalUrl.startsWith('/js') && !req.originalUrl.startsWith('/assets')) {
      const safeUrl = req.originalUrl
        .replace(/radio_token=[^&]+/gi, 'radio_token=[REDACTED]')
        .replace(/token=[^&]+/gi, 'token=[REDACTED]');
      console.log(`[API] ${req.method} ${safeUrl} -> ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// 5. REST API Route Mounts (SRS Section 7)
app.use('/api/health', healthRoutes);
app.use('/api/stations', stationRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/favourites', favouriteRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/streaming', streamingRoutes);

// 6. Serve Frontend Static Assets and Pages
const frontendPath = path.join(__dirname, '../../frontend');
app.use(express.static(frontendPath));

// Also serve root assets for backward compatibility
app.use('/assets', express.static(path.join(__dirname, '../../assets')));
app.use('/css', express.static(path.join(__dirname, '../../frontend/css')));
app.use('/js', express.static(path.join(__dirname, '../../frontend/js')));

// 7. 404 & Centralized Error Handlers
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

