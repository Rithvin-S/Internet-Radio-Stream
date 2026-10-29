/**
 * Full-Stack Internet Radio Streaming System
 * Program Schedule Controller (src/controllers/scheduleController.js)
 * Implements FR-10, FR-12, T-10
 */

const db = require('../config/db');
const { validateScheduleInput } = require('../validators/scheduleValidator');

/**
 * GET /api/stations/:id/schedules
 * Returns published program schedules for a specific station (FR-10)
 */
async function getSchedulesByStation(req, res, next) {
  try {
    const stationId = parseInt(req.params.id, 10);
    if (isNaN(stationId) || stationId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid station ID.'
      });
    }

    // Verify station exists
    const stations = await db.query('SELECT id, name FROM stations WHERE id = ?', [stationId]);
    if (!stations || stations.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Station with ID ${stationId} was not found.`
      });
    }

    const isUserAdmin = req.user && req.user.role === 'admin';
    const showAll = isUserAdmin && req.query.all === 'true';

    let sql = 'SELECT * FROM program_schedules WHERE station_id = ?';
    if (!showAll) {
      sql += ' AND is_published = 1';
    }
    sql += ' ORDER BY start_time ASC';

    const schedules = await db.query(sql, [stationId]);

    res.status(200).json({
      success: true,
      station: stations[0],
      count: schedules.length,
      data: schedules.map((s) => ({
        ...s,
        is_published: Boolean(s.is_published)
      }))
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/stations/:id/schedules
 * Create schedule entry for a station (Admin only - FR-12, T-10)
 */
async function adminCreateSchedule(req, res, next) {
  try {
    const stationId = parseInt(req.params.id, 10);
    if (isNaN(stationId) || stationId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid station ID.'
      });
    }

    // Verify station exists
    const stations = await db.query('SELECT id, name FROM stations WHERE id = ?', [stationId]);
    if (!stations || stations.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Station with ID ${stationId} was not found.`
      });
    }

    const validation = validateScheduleInput(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: validation.errors
      });
    }

    const { title, description, start_time, end_time, is_published } = req.body;
    const publishedVal = is_published !== undefined ? (is_published ? 1 : 0) : 1;

    const result = await db.query(
      `INSERT INTO program_schedules (station_id, title, description, start_time, end_time, is_published)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [stationId, title.trim(), description ? description.trim() : null, start_time.trim(), end_time.trim(), publishedVal]
    );

    const newSchedule = await db.query('SELECT * FROM program_schedules WHERE id = ?', [result.insertId]);

    res.status(201).json({
      success: true,
      message: 'Program schedule created successfully.',
      data: {
        ...newSchedule[0],
        is_published: Boolean(newSchedule[0].is_published)
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/admin/schedules/:id
 * Update program schedule entry (Admin only - FR-12)
 */
async function adminUpdateSchedule(req, res, next) {
  try {
    const scheduleId = parseInt(req.params.id, 10);
    if (isNaN(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid schedule ID.'
      });
    }

    const existing = await db.query('SELECT * FROM program_schedules WHERE id = ?', [scheduleId]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Schedule entry with ID ${scheduleId} was not found.`
      });
    }

    const validation = validateScheduleInput(req.body, true);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: validation.errors
      });
    }

    const current = existing[0];
    const title = req.body.title !== undefined ? req.body.title.trim() : current.title;
    const description = req.body.description !== undefined ? req.body.description.trim() : current.description;
    const start_time = req.body.start_time !== undefined ? req.body.start_time.trim() : current.start_time;
    const end_time = req.body.end_time !== undefined ? req.body.end_time.trim() : current.end_time;
    const is_published = req.body.is_published !== undefined ? (req.body.is_published ? 1 : 0) : current.is_published;

    await db.query(
      `UPDATE program_schedules
       SET title = ?, description = ?, start_time = ?, end_time = ?, is_published = ?
       WHERE id = ?`,
      [title, description, start_time, end_time, is_published, scheduleId]
    );

    const updated = await db.query('SELECT * FROM program_schedules WHERE id = ?', [scheduleId]);

    res.status(200).json({
      success: true,
      message: 'Program schedule updated successfully.',
      data: {
        ...updated[0],
        is_published: Boolean(updated[0].is_published)
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/admin/schedules/:id
 * Delete program schedule entry (Admin only - FR-12)
 */
async function adminDeleteSchedule(req, res, next) {
  try {
    const scheduleId = parseInt(req.params.id, 10);
    if (isNaN(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid schedule ID.'
      });
    }

    const existing = await db.query('SELECT * FROM program_schedules WHERE id = ?', [scheduleId]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Schedule entry with ID ${scheduleId} was not found.`
      });
    }

    await db.query('DELETE FROM program_schedules WHERE id = ?', [scheduleId]);

    res.status(200).json({
      success: true,
      message: `Schedule "${existing[0].title}" was deleted successfully.`
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSchedulesByStation,
  adminCreateSchedule,
  adminUpdateSchedule,
  adminDeleteSchedule
};

