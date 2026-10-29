/**
 * Full-Stack Internet Radio Streaming System
 * Centralized Error Handling Middleware (src/middleware/errorHandler.js)
 * Implements NFR-03 (Reliability & Safe Error Responses)
 */

function notFoundHandler(req, res, next) {
  res.status(404).json({
    success: false,
    message: `Resource not found: ${req.method} ${req.originalUrl}`
  });
}

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  
  // Log server diagnostic internally without leaking sensitive data
  console.error(`[ERROR] [${req.method} ${req.originalUrl}]`, err.message || err);

  const response = {
    success: false,
    message: err.message || 'An unexpected internal server error occurred.'
  };

  // Only expose stack in development if specifically requested
  if (process.env.NODE_ENV === 'development' && statusCode === 500) {
    response.debug = err.stack;
  }

  res.status(statusCode).json(response);
}

module.exports = {
  notFoundHandler,
  errorHandler
};

