/**
 * PulseCast Internet Radio Streaming System
 * Song Library Controller (src/controllers/songController.js)
 *
 * Exposes administrative endpoints for uploading, managing,
 * searching, and assigning music library tracks.
 */

const songService = require('../services/songService');

/**
 * GET /api/admin/songs
 * List, search, filter, and paginate songs
 */
async function listSongs(req, res, next) {
  try {
    const search = req.query.search || req.query.q || '';
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const activeOnly = req.query.activeOnly === 'true';
    const sortBy = req.query.sortBy || req.query.sort || 'created_at';
    const order = req.query.order || req.query.direction || 'desc';

    const result = await songService.getSongsList({ search, page, limit, activeOnly, sortBy, order });

    res.status(200).json({
      success: true,
      count: result.songs.length,
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      stats: result.stats,
      data: result.songs
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/songs/stats
 * Aggregate statistics for song collection
 */
async function getStats(req, res, next) {
  try {
    const stats = await songService.getLibraryStats();
    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/songs/:id
 * Retrieve a single song by UUID
 */
async function getSong(req, res, next) {
  try {
    const song = await songService.getSongById(req.params.id);
    if (!song) {
      return res.status(404).json({ success: false, message: 'Song not found in library.' });
    }
    res.status(200).json({ success: true, data: song });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/songs
 * Upload single audio file with metadata
 */
async function uploadSong(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No audio file provided. Please attach an MP3, WAV, or AAC file.'
      });
    }

    const { title, artist, album } = req.body;
    const userId = req.user ? req.user.id : null;

    const song = await songService.uploadSingleSong({
      file: req.file,
      title,
      artist,
      album,
      userId
    });

    res.status(201).json({
      success: true,
      message: `Song "${song.title}" uploaded successfully.`,
      data: song
    });
  } catch (err) {
    if (err.message && (err.message.includes('exceeds maximum') || err.message.includes('Invalid file extension') || err.message.includes('Invalid MIME type'))) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
}

/**
 * POST /api/admin/songs/bulk
 * Bulk upload multiple audio files with bounded concurrency
 */
async function uploadBulk(req, res, next) {
  try {
    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files provided for bulk upload. Please select audio files.'
      });
    }

    const userId = req.user ? req.user.id : null;
    const concurrency = parseInt(req.query.concurrency || req.body.concurrency, 10) || 3;

    const result = await songService.uploadBulkSongs({
      files: req.files,
      userId,
      concurrency
    });

    res.status(200).json({
      success: true,
      total: result.total,
      successful: result.successful,
      failed: result.failed,
      data: result.results
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/admin/songs/:id
 * Update editable metadata (title, artist, album, is_active)
 */
async function updateSong(req, res, next) {
  try {
    const { title, artist, album, is_active } = req.body;
    const song = await songService.updateSongMetadata(req.params.id, {
      title,
      artist,
      album,
      is_active
    });

    res.status(200).json({
      success: true,
      message: `Metadata updated for "${song.title}".`,
      data: song
    });
  } catch (err) {
    if (err.message === 'Song not found') {
      return res.status(404).json({ success: false, message: err.message });
    }
    next(err);
  }
}

/**
 * DELETE /api/admin/songs/:id
 * Soft delete (archive) or permanent delete
 */
async function deleteSong(req, res, next) {
  try {
    const permanent = req.query.permanent === 'true';
    const force = req.query.force === 'true';

    const result = await songService.deleteSong(req.params.id, { permanent, force });

    res.status(200).json({
      success: true,
      message: result.message || 'Song status updated.'
    });
  } catch (err) {
    if (err.status === 409 || err.conflict) {
      return res.status(409).json({
        success: false,
        conflict: true,
        assignedCount: err.assignedCount,
        message: err.message
      });
    }
    if (err.message === 'Song not found') {
      return res.status(404).json({ success: false, message: err.message });
    }
    next(err);
  }
}

/**
 * POST /api/admin/songs/:id/signed-url
 * GET  /api/admin/songs/:id/signed-url
 * Generate short-lived signed URL for preview or playback
 */
async function getSignedUrl(req, res, next) {
  try {
    const expiresIn = parseInt(req.query.expiresIn || req.body.expiresIn, 10) || 300;
    const result = await songService.generateSignedUrl(req.params.id, expiresIn);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    if (err.message === 'Song not found') {
      return res.status(404).json({ success: false, message: err.message });
    }
    next(err);
  }
}

/**
 * Schedule Playlist Endpoints
 */
async function getScheduleTracks(req, res, next) {
  try {
    const tracks = await songService.getSchedulePlaylist(req.params.id);
    res.status(200).json({
      success: true,
      count: tracks.length,
      data: tracks
    });
  } catch (err) {
    next(err);
  }
}

async function updateScheduleTracks(req, res, next) {
  try {
    const tracks = req.body.tracks || req.body.songs || [];
    const saved = await songService.saveSchedulePlaylist(req.params.id, tracks);
    res.status(200).json({
      success: true,
      count: saved.length,
      message: 'Schedule playlist updated successfully.',
      data: saved
    });
  } catch (err) {
    next(err);
  }
}

async function removeScheduleTrack(req, res, next) {
  try {
    const scheduleId = req.params.id;
    const trackId = req.params.trackId;

    const existing = await songService.getSchedulePlaylist(scheduleId);
    const filtered = existing.filter((t) => String(t.id) !== String(trackId) && String(t.song_id) !== String(trackId));
    const saved = await songService.saveSchedulePlaylist(scheduleId, filtered);

    res.status(200).json({
      success: true,
      count: saved.length,
      message: 'Track removed from schedule playlist. Library song remains intact.',
      data: saved
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listSongs,
  getSong,
  getStats,
  uploadSong,
  uploadBulk,
  updateSong,
  deleteSong,
  getSignedUrl,
  getScheduleTracks,
  updateScheduleTracks,
  removeScheduleTrack
};

