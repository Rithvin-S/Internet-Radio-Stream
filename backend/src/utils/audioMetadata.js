/**
 * PulseCast Internet Radio Streaming System
 * Audio Metadata Extraction & Validation Utility (src/utils/audioMetadata.js)
 *
 * Validates audio file uploads, sanitizes filenames, and extracts
 * ID3 / Vorbis tags and playback duration using music-metadata.
 */

const path = require('path');

// Maximum allowed audio file size: 50MB (Supabase Free Storage Limit)
const MAX_AUDIO_SIZE_BYTES = 50 * 1024 * 1024; // 52,428,800 bytes

// Allowed audio extensions and MIME types
const ALLOWED_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.aac', '.m4a', '.flac']);
const ALLOWED_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/aac',
  'audio/x-m4a',
  'audio/mp4',
  'audio/flac'
]);

/**
 * Sanitize a filename to prevent path traversal and shell injection
 */
function sanitizeFilename(originalName) {
  if (!originalName || typeof originalName !== 'string') {
    return 'audio_track.mp3';
  }

  const basename = path.basename(originalName.trim());
  const ext = path.extname(basename).toLowerCase().trim();
  const nameWithoutExt = path.basename(basename, ext);

  // Remove control characters, path separators, and normalize
  const cleanName = nameWithoutExt
    .replace(/[^a-zA-Z0-9_\-\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 100);

  const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '.mp3';
  return `${cleanName || 'track'}${safeExt}`;
}

/**
 * Validate audio file type, extension, and size
 */
function validateAudioFile(file, customMaxBytes = MAX_AUDIO_SIZE_BYTES) {
  if (!file) {
    return { valid: false, error: 'No audio file provided.' };
  }

  const originalName = (file.originalname || '').trim();
  const ext = path.extname(originalName).toLowerCase().trim();
  const mimeType = (file.mimetype || '').toLowerCase();
  const size = file.size || (file.buffer ? file.buffer.length : 0);

  // 1. File size check
  if (size <= 0) {
    return { valid: false, error: 'Audio file is empty.' };
  }
  if (size > customMaxBytes) {
    const sizeMb = (size / (1024 * 1024)).toFixed(1);
    const limitMb = (customMaxBytes / (1024 * 1024)).toFixed(0);
    return {
      valid: false,
      error: `File size (${sizeMb} MB) exceeds maximum allowed limit of ${limitMb} MB.`
    };
  }

  // 2. Extension check
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `Invalid file extension "${ext}". Supported formats: MP3, WAV, OGG, AAC.`
    };
  }

  // 3. MIME type check
  if (!ALLOWED_MIME_TYPES.has(mimeType) && mimeType !== 'application/octet-stream') {
    return {
      valid: false,
      error: `Invalid MIME type "${mimeType}". Audio files only.`
    };
  }

  return { valid: true };
}

/**
 * Format duration in seconds to MM:SS string
 */
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '00:00';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Extract audio metadata tags (title, artist, album, duration)
 * Resilient fallback: derived from filename if tags are absent.
 */
async function extractAudioMetadata(buffer, originalFilename, mimeType = 'audio/mpeg') {
  const fallbackTitle = path.basename(originalFilename, path.extname(originalFilename))
    .replace(/[_\-]+/g, ' ')
    .trim() || 'Untitled Track';

  let metadata = {
    title: fallbackTitle,
    artist: null,
    album: null,
    durationSeconds: 0,
    duration: '00:00',
    bitrate: null
  };

  try {
    const mm = await import('music-metadata');
    const parsed = await mm.parseBuffer(buffer, { mimeType, size: buffer.length });

    if (parsed) {
      const common = parsed.common || {};
      const format = parsed.format || {};

      if (common.title && common.title.trim()) {
        metadata.title = common.title.trim();
      }
      if (common.artist && common.artist.trim()) {
        metadata.artist = common.artist.trim();
      }
      if (common.album && common.album.trim()) {
        metadata.album = common.album.trim();
      }
      if (format.duration && format.duration > 0) {
        metadata.durationSeconds = Math.round(format.duration);
        metadata.duration = formatDuration(format.duration);
      }
      if (format.bitrate) {
        metadata.bitrate = Math.round(format.bitrate / 1000); // kbps
      }
    }
  } catch (err) {
    // If music-metadata fails to parse headers, fallback cleanly to filename
    console.warn(`[METADATA] Could not parse ID3 tags for "${originalFilename}": ${err.message}. Using filename.`);
  }

  return metadata;
}

module.exports = {
  MAX_AUDIO_SIZE_BYTES,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  sanitizeFilename,
  validateAudioFile,
  formatDuration,
  extractAudioMetadata
};

