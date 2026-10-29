/**
 * Full-Stack Internet Radio Streaming System
 * Lightweight Auth Rate Limiter (src/middleware/rateLimiter.js)
 * Implements SRS Section 9 security requirements against brute-force login attempts.
 */

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes window
const MAX_ATTEMPTS = 30; // max 30 auth requests per 15 minutes per IP

function rateLimiter(req, res, next) {
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  const record = attempts.get(clientIp);

  if (!record || now > record.resetTime) {
    attempts.set(clientIp, {
      count: 1,
      resetTime: now + WINDOW_MS
    });
    return next();
  }

  record.count++;

  if (record.count > MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil((record.resetTime - now) / 1000);
    res.setHeader('Retry-After', retryAfterSec);
    return res.status(429).json({
      success: false,
      message: `Too many login/registration attempts. Please try again in ${Math.ceil(retryAfterSec / 60)} minutes.`
    });
  }

  next();
}

// Periodic cleanup of expired rate-limit records
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of attempts.entries()) {
    if (now > data.resetTime) {
      attempts.delete(ip);
    }
  }
}, 5 * 60 * 1000);

module.exports = rateLimiter;

