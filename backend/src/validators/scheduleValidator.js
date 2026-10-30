/**
 * Full-Stack Internet Radio Streaming System
 * Program Schedule Validator (src/validators/scheduleValidator.js)
 * Implements FR-14 & T-10 (Time-Range & Field Validation)
 */

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function validateScheduleInput(data, isUpdate = false) {
  const errors = [];

  // Title
  if (!isUpdate || data.title !== undefined) {
    if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
      errors.push('Schedule title is required.');
    } else if (data.title.trim().length > 150) {
      errors.push('Schedule title must not exceed 150 characters.');
    }
  }

  // Date (optional in basic mode, validated if provided)
  if (data.schedule_date !== undefined && data.schedule_date !== null && data.schedule_date !== '') {
    if (!DATE_REGEX.test(data.schedule_date.toString().trim())) {
      errors.push('Schedule date must be formatted as YYYY-MM-DD (e.g. 2026-10-31).');
    }
  }

  // Start Time
  if (!isUpdate || data.start_time !== undefined) {
    if (!data.start_time || !TIME_REGEX.test(data.start_time.trim())) {
      errors.push('Start time must be formatted as HH:MM in 24-hour time (e.g. 09:00, 18:30).');
    }
  }

  // End Time
  if (!isUpdate || data.end_time !== undefined) {
    if (!data.end_time || !TIME_REGEX.test(data.end_time.trim())) {
      errors.push('End time must be formatted as HH:MM in 24-hour time (e.g. 12:00, 22:00).');
    }
  }

  // Range validation: start_time vs end_time (T-10 check)
  if (data.start_time && data.end_time && TIME_REGEX.test(data.start_time.trim()) && TIME_REGEX.test(data.end_time.trim())) {
    const start = data.start_time.trim();
    const end = data.end_time.trim();

    // Reject if end time is equal to start time
    if (start === end) {
      errors.push('End time cannot be the same as start time.');
    }
  }

  // Song items validation (if provided)
  if (data.songs && Array.isArray(data.songs)) {
    data.songs.forEach((song, idx) => {
      if (!song || typeof song !== 'object') {
        errors.push(`Song at position ${idx + 1} is invalid.`);
      } else if (!song.title || typeof song.title !== 'string' || song.title.trim().length === 0) {
        errors.push(`Song at position ${idx + 1} must have a valid title.`);
      }
    });
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

module.exports = {
  validateScheduleInput
};
