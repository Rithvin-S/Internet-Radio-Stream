/**
 * Full-Stack Internet Radio Streaming System
 * Favourites Controller (src/controllers/favouriteController.js)
 * Implements FR-09, T-09 (User Favourites Management)
 */

const db = require('../config/db');

/**
 * GET /api/favourites
 * List all favourite stations for the current authenticated user (FR-09)
 */
async function listUserFavourites(req, res, next) {
  try {
    const userId = req.user.id;

    const sql = `
      SELECT s.*, f.created_at AS favourited_at
      FROM favourites f
      JOIN stations s ON f.station_id = s.id
      WHERE f.user_id = ? AND s.is_active = 1
      ORDER BY f.created_at DESC
    `;

    const favourites = await db.query(sql, [userId]);

    res.status(200).json({
      success: true,
      count: favourites.length,
      data: favourites.map((s) => ({
        ...s,
        is_active: Boolean(s.is_active),
        is_favourite: true
      }))
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/favourites/:stationId
 * Add a station to the current user's favourites (FR-09, T-09)
 */
async function addFavourite(req, res, next) {
  try {
    const userId = req.user.id;
    const stationId = parseInt(req.params.stationId, 10);

    if (isNaN(stationId) || stationId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid station ID.'
      });
    }

    // Check station exists
    const stations = await db.query('SELECT id, name FROM stations WHERE id = ?', [stationId]);
    if (!stations || stations.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Station with ID ${stationId} was not found.`
      });
    }

    // Check if already favourited (duplicate prevention)
    const existing = await db.query(
      'SELECT 1 FROM favourites WHERE user_id = ? AND station_id = ?',
      [userId, stationId]
    );

    if (existing && existing.length > 0) {
      return res.status(200).json({
        success: true,
        message: `Station "${stations[0].name}" is already in your favourites.`,
        station_id: stationId
      });
    }

    await db.query(
      'INSERT INTO favourites (user_id, station_id) VALUES (?, ?)',
      [userId, stationId]
    );

    res.status(201).json({
      success: true,
      message: `Station "${stations[0].name}" added to your favourites.`,
      station_id: stationId
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/favourites/:stationId
 * Remove a station from the current user's favourites (FR-09, T-09)
 */
async function removeFavourite(req, res, next) {
  try {
    const userId = req.user.id;
    const stationId = parseInt(req.params.stationId, 10);

    if (isNaN(stationId) || stationId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid station ID.'
      });
    }

    await db.query(
      'DELETE FROM favourites WHERE user_id = ? AND station_id = ?',
      [userId, stationId]
    );

    res.status(200).json({
      success: true,
      message: 'Station removed from your favourites.',
      station_id: stationId
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listUserFavourites,
  addFavourite,
  removeFavourite
};

