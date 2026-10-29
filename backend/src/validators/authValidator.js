/**
 * Full-Stack Internet Radio Streaming System
 * Authentication Input Validator (src/validators/authValidator.js)
 * Implements FR-07, FR-14 (Email and Credential Validation)
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRegisterInput(data) {
  const errors = [];

  // Name
  if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
    errors.push('Full name is required.');
  } else if (data.name.trim().length > 100) {
    errors.push('Name must not exceed 100 characters.');
  }

  // Email
  if (!data.email || typeof data.email !== 'string' || !EMAIL_REGEX.test(data.email.trim())) {
    errors.push('A valid email address is required.');
  } else if (data.email.trim().length > 191) {
    errors.push('Email must not exceed 191 characters.');
  }

  // Password
  if (!data.password || typeof data.password !== 'string') {
    errors.push('Password is required.');
  } else if (data.password.length < 6) {
    errors.push('Password must be at least 6 characters long.');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

function validateLoginInput(data) {
  const errors = [];

  if (!data.email || typeof data.email !== 'string' || !EMAIL_REGEX.test(data.email.trim())) {
    errors.push('A valid email address is required.');
  }

  if (!data.password || typeof data.password !== 'string') {
    errors.push('Password is required.');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

module.exports = {
  validateRegisterInput,
  validateLoginInput
};

