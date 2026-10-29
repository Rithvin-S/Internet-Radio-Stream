/**
 * Full-Stack Internet Radio Streaming System
 * Station Controller (src/controllers/stationController.js)
 * Implements FR-01, FR-02, FR-11, T-02, T-03, T-08
 */

const db = require('../config/db');
const { validateStationInput } = require('../validators/stationValidator');

/**
 * GET /api/stations
 * Public listing of stations. By default returns only active stations (T-02).
 * Admin can pass ?all=true to view inactive stations.
 * Authenticated listeners get an `is_favourite` boolean flag.
 */
async function getStations(req, res, next) {
  try {
    const { genre, search, all } = req.query;
    const isUserAdmin = req.user && req.user.role === 'admin';
    const showAll = isUserAdmin && all === 'true';

    let sql = 'SELECT * FROM stations WHERE 1=1';
    const params = [];

    // Filter active unless admin explicitly requests all
    if (!showAll) {
      sql += ' AND is_active = 1';
    }

    if (genre && genre.trim()) {
      sql += ' AND LOWER(genre) LIKE ?';
      params.push(`%${genre.trim().toLowerCase()}%`);
    }

    if (search && search.trim()) {
      sql += ' AND (LOWER(name) LIKE ? OR LOWER(description) LIKE ?)';
      params.push(`%${search.trim().toLowerCase()}%`, `%${search.trim().toLowerCase()}%`);
    }

    sql += ' ORDER BY id ASC';

    const stations = await db.query(sql, params);

    // If user is logged in, attach is_favourite flag
    if (req.user) {
      const favRows = await db.query(
        'SELECT station_id FROM favourites WHERE user_id = ?',
        [req.user.id]
      );
      const favSet = new Set(favRows.map((r) => r.station_id));

      const enriched = stations.map((s) => ({
        ...s,
        is_active: Boolean(s.is_active),
        is_favourite: favSet.has(s.id)
      }));

      return res.status(200).json({
        success: true,
        count: enriched.length,
        data: enriched
      });
    }

    const formatted = stations.map((s) => ({
      ...s,
      is_active: Boolean(s.is_active)
    }));

    res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/stations/:id
 * Get single station by ID (T-03)
 */
async function getStationById(req, res, next) {
  try {
    const stationId = parseInt(req.params.id, 10);

    if (isNaN(stationId) || stationId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid station ID provided. ID must be a positive integer.'
      });
    }

    const stations = await db.query('SELECT * FROM stations WHERE id = ?', [stationId]);

    if (!stations || stations.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Station with ID ${stationId} was not found.`
      });
    }

    const station = {
      ...stations[0],
      is_active: Boolean(stations[0].is_active)
    };

    // If logged in, check if user favourited this station
    if (req.user) {
      const fav = await db.query(
        'SELECT 1 FROM favourites WHERE user_id = ? AND station_id = ?',
        [req.user.id, stationId]
      );
      station.is_favourite = fav.length > 0;
    }

    res.status(200).json({
      success: true,
      data: station
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/stations
 * Create new radio station record (Admin only - FR-11, T-08)
 */
async function adminCreateStation(req, res, next) {
  try {
    const validation = validateStationInput(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: validation.errors
      });
    }

    const { name, description, genre, stream_url, artwork_url, is_active } = req.body;
    const activeVal = is_active !== undefined ? (is_active ? 1 : 0) : 1;

    const result = await db.query(
      `INSERT INTO stations (name, description, genre, stream_url, artwork_url, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        description ? description.trim() : null,
        genre ? genre.trim() : null,
        stream_url.trim(),
        artwork_url ? artwork_url.trim() : 'assets/station-artwork.svg',
        activeVal
      ]
    );

    const newId = result.insertId;
    const created = await db.query('SELECT * FROM stations WHERE id = ?', [newId]);

    res.status(201).json({
      success: true,
      message: 'Station created successfully.',
      data: {
        ...created[0],
        is_active: Boolean(created[0].is_active)
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/admin/stations/:id
 * Update station details (Admin only - FR-11, T-08)
 */
async function adminUpdateStation(req, res, next) {
  try {
    const stationId = parseInt(req.params.id, 10);
    if (isNaN(stationId) || stationId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid station ID.'
      });
    }

    // Check station exists
    const existing = await db.query('SELECT * FROM stations WHERE id = ?', [stationId]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Station with ID ${stationId} was not found.`
      });
    }

    const validation = validateStationInput(req.body, true);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: validation.errors
      });
    }

    const current = existing[0];
    const name = req.body.name !== undefined ? req.body.name.trim() : current.name;
    const description = req.body.description !== undefined ? req.body.description.trim() : current.description;
    const genre = req.body.genre !== undefined ? req.body.genre.trim() : current.genre;
    const stream_url = req.body.stream_url !== undefined ? req.body.stream_url.trim() : current.stream_url;
    const artwork_url = req.body.artwork_url !== undefined ? req.body.artwork_url.trim() : current.artwork_url;
    const is_active = req.body.is_active !== undefined ? (req.body.is_active ? 1 : 0) : current.is_active;

    await db.query(
      `UPDATE stations
       SET name = ?, description = ?, genre = ?, stream_url = ?, artwork_url = ?, is_active = ?
       WHERE id = ?`,
      [name, description, genre, stream_url, artwork_url, is_active, stationId]
    );

    const updated = await db.query('SELECT * FROM stations WHERE id = ?', [stationId]);

    res.status(200).json({
      success: true,
      message: 'Station updated successfully.',
      data: {
        ...updated[0],
        is_active: Boolean(updated[0].is_active)
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/admin/stations/:id/status
 * Toggle or set station active status (Admin only - FR-11)
 */
async function adminToggleStationStatus(req, res, next) {
  try {
    const stationId = parseInt(req.params.id, 10);
    if (isNaN(stationId) || stationId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid station ID.'
      });
    }

    const existing = await db.query('SELECT * FROM stations WHERE id = ?', [stationId]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Station with ID ${stationId} was not found.`
      });
    }

    let nextStatus;
    if (req.body.is_active !== undefined) {
      nextStatus = req.body.is_active ? 1 : 0;
    } else {
      nextStatus = existing[0].is_active ? 0 : 1;
    }

    await db.query('UPDATE stations SET is_active = ? WHERE id = ?', [nextStatus, stationId]);

    res.status(200).json({
      success: true,
      message: `Station status changed to ${nextStatus ? 'active' : 'inactive'}.`,
      data: {
        id: stationId,
        is_active: Boolean(nextStatus)
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/admin/stations/:id
 * Delete station (Admin only - FR-11)
 */
async function adminDeleteStation(req, res, next) {
  try {
    const stationId = parseInt(req.params.id, 10);
    if (isNaN(stationId) || stationId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid station ID.'
      });
    }

    const existing = await db.query('SELECT * FROM stations WHERE id = ?', [stationId]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Station with ID ${stationId} was not found.`
      });
    }

    await db.query('DELETE FROM stations WHERE id = ?', [stationId]);

    res.status(200).json({
      success: true,
      message: `Station "${existing[0].name}" was deleted successfully.`
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getStations,
  getStationById,
  adminCreateStation,
  adminUpdateStation,
  adminToggleStationStatus,
  adminDeleteStation
};

