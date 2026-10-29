/**
 * Full-Stack Internet Radio Streaming System
 * Track & Upcoming Songs Controller (src/controllers/trackController.js)
 * Manages currently playing and queued songs/streams stored in MySQL.
 */

const db = require('../config/db');

/**
 * GET /api/stations/:id/tracks
 * Returns currently playing track and the queue of songs/streams to be played next
 */
async function getStationTracks(req, res, next) {
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

    const sql = `
      SELECT id, station_id, title, artist, album, duration, stream_url, play_order, status, created_at
      FROM upcoming_tracks
      WHERE station_id = ?
      ORDER BY play_order ASC, id ASC
    `;

    const tracks = await db.query(sql, [stationId]);

    const nowPlaying = tracks.find((t) => t.status === 'playing') || (tracks.length > 0 ? tracks[0] : null);
    const upNext = tracks.filter((t) => t.id !== (nowPlaying ? nowPlaying.id : null) && t.status !== 'played');

    res.status(200).json({
      success: true,
      station: stations[0],
      total_tracks: tracks.length,
      now_playing: nowPlaying,
      up_next: upNext,
      all_tracks: tracks
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/stations/:id/tracks
 * Admin: Add song or stream to be played next
 */
async function adminAddTrack(req, res, next) {
  try {
    const stationId = parseInt(req.params.id, 10);
    if (isNaN(stationId) || stationId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid station ID.'
      });
    }

    const { title, artist, album, duration, stream_url, play_order, status } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Song/stream title is required.'
      });
    }

    if (!artist || typeof artist !== 'string' || artist.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Artist name is required.'
      });
    }

    // Determine play order if not provided
    let orderVal = play_order ? parseInt(play_order, 10) : null;
    if (!orderVal || isNaN(orderVal)) {
      const maxOrder = await db.query(
        'SELECT MAX(play_order) AS max_order FROM upcoming_tracks WHERE station_id = ?',
        [stationId]
      );
      orderVal = (maxOrder[0].max_order || 0) + 1;
    }

    const statusVal = status === 'playing' ? 'playing' : 'queued';

    // If setting to 'playing', set existing playing tracks to 'played'
    if (statusVal === 'playing') {
      await db.query(
        "UPDATE upcoming_tracks SET status = 'played' WHERE station_id = ? AND status = 'playing'",
        [stationId]
      );
    }

    const result = await db.query(
      `INSERT INTO upcoming_tracks (station_id, title, artist, album, duration, stream_url, play_order, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        stationId,
        title.trim(),
        artist.trim(),
        album ? album.trim() : null,
        duration ? duration.trim() : '03:30',
        stream_url ? stream_url.trim() : null,
        orderVal,
        statusVal
      ]
    );

    const created = await db.query('SELECT * FROM upcoming_tracks WHERE id = ?', [result.insertId]);

    res.status(201).json({
      success: true,
      message: 'Song added to upcoming queue.',
      data: created[0]
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/admin/tracks/:id/status
 * Admin: Update track status (e.g. advance queue to 'playing')
 */
async function adminUpdateTrackStatus(req, res, next) {
  try {
    const trackId = parseInt(req.params.id, 10);
    const { status } = req.body;

    if (!['playing', 'queued', 'played'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be playing, queued, or played.'
      });
    }

    const existing = await db.query('SELECT * FROM upcoming_tracks WHERE id = ?', [trackId]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Track not found.'
      });
    }

    if (status === 'playing') {
      // Demote current playing
      await db.query(
        "UPDATE upcoming_tracks SET status = 'played' WHERE station_id = ? AND status = 'playing'",
        [existing[0].station_id]
      );
    }

    await db.query('UPDATE upcoming_tracks SET status = ? WHERE id = ?', [status, trackId]);

    res.status(200).json({
      success: true,
      message: `Track status updated to ${status}.`
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/admin/tracks/:id
 * Admin: Remove track from upcoming queue
 */
async function adminDeleteTrack(req, res, next) {
  try {
    const trackId = parseInt(req.params.id, 10);
    await db.query('DELETE FROM upcoming_tracks WHERE id = ?', [trackId]);
    res.status(200).json({
      success: true,
      message: 'Track removed from queue.'
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getStationTracks,
  adminAddTrack,
  adminUpdateTrackStatus,
  adminDeleteTrack
};

