/**
 * PulseCast Internet Radio Streaming System
 * Multer Audio Upload Middleware (src/middleware/upload.js)
 *
 * Configures memory storage and file size limits for audio file uploads.
 */

const multer = require('multer');
const { MAX_AUDIO_SIZE_BYTES } = require('../utils/audioMetadata');

// Use memory storage so buffers can be validated and uploaded directly to Supabase Storage
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_AUDIO_SIZE_BYTES, // 50MB
    files: 20 // Max 20 files per bulk upload
  }
});

module.exports = upload;

