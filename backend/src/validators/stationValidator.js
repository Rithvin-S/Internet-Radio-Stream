/**
 * Full-Stack Internet Radio Streaming System
 * Station Input Validator (src/validators/stationValidator.js)
 * Implements FR-14 (Input Validation & Safe Sanitization)
 */

function validateStationInput(data, isUpdate = false) {
  const errors = [];

  // Name
  if (!isUpdate || data.name !== undefined) {
    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
      errors.push('Station name is required.');
    } else if (data.name.trim().length > 150) {
      errors.push('Station name must not exceed 150 characters.');
    }
  }

  // Stream URL
  if (!isUpdate || data.stream_url !== undefined) {
    if (!data.stream_url || typeof data.stream_url !== 'string' || data.stream_url.trim().length === 0) {
      errors.push('Stream URL is required.');
    } else {
      const url = data.stream_url.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        errors.push('Stream URL must begin with http:// or https://');
      }
    }
  }

  // Description
  if (data.description !== undefined && data.description !== null) {
    if (typeof data.description !== 'string') {
      errors.push('Description must be text.');
    }
  }

  // Genre
  if (data.genre !== undefined && data.genre !== null) {
    if (typeof data.genre !== 'string') {
      errors.push('Genre must be text.');
    } else if (data.genre.trim().length > 80) {
      errors.push('Genre must not exceed 80 characters.');
    }
  }

  // is_active
  if (data.is_active !== undefined) {
    if (typeof data.is_active !== 'boolean' && data.is_active !== 0 && data.is_active !== 1) {
      errors.push('is_active must be a boolean (true/false or 1/0).');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

module.exports = {
  validateStationInput
};

