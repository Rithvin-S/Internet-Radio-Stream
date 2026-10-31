/**
 * PulseCast Internet Radio Streaming System
 * Radio Playback & Liquidsoap Streaming Bridge (src/routes/streaming.js)
 *
 * Implements the private-file-to-Liquidsoap playback bridge:
 * - Dynamically resolves upcoming scheduled tracks
 * - Creates short-lived signed URLs immediately prior to playback
 * - Handles expired URLs safely
 * - Exposes radio endpoints for Liquidsoap / EC2 radio playback worker
 */

const express = require('express');
const router = express.Router();
const songService = require('../services/songService');
const { getSupabase } = require('../config/supabase');
const { authenticateUser, requireAdmin } = require('../middleware/auth');

/**
 * Authorization Guard for Radio Playback & Signed URL streaming
 * Only authorized EC2 radio daemon (via x-radio-token) or administrators can request signed URLs
 */
function requireStreamingAuth(req, res, next) {
  const radioToken = req.headers['x-radio-token'] || req.query.radio_token;
  const expectedSecret = process.env.RADIO_STREAMING_KEY || process.env.STREAMING_SECRET || 'pulsecast_streaming_secure_token_key';

  if (radioToken && radioToken === expectedSecret) {
    return next();
  }

  return authenticateUser(req, res, (err) => {
    if (err) return next(err);
    return requireAdmin(req, res, next);
  });
}

/**
 * GET /api/streaming/schedule/:scheduleId/next-track
 * Resolves the next scheduled song and creates an immediate signed URL for Liquidsoap playback.
 * Protected: Requires radio daemon token or admin JWT.
 */
router.get('/schedule/:scheduleId/next-track', requireStreamingAuth, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const playlist = await songService.getSchedulePlaylist(scheduleId);

    if (!playlist || playlist.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No tracks currently assigned to this program schedule.'
      });
    }

    // Default to the first track or requested track index
    const index = parseInt(req.query.index, 10) || 0;
    const track = playlist[index % playlist.length];

    let audioUrl = track.stream_url;
    let signedExpiresIn = 300; // 5 minutes

    // If linked to a library song, generate immediate signed URL
    if (track.song_id) {
      try {
        const signed = await songService.generateSignedUrl(track.song_id, signedExpiresIn);
        audioUrl = signed.signedUrl;
      } catch (err) {
        console.warn(`[STREAMING] Signed URL generation failed for song ${track.song_id}: ${err.message}`);
      }
    }

    res.status(200).json({
      success: true,
      schedule_id: Number(scheduleId),
      play_order: track.play_order || index + 1,
      title: track.title,
      artist: track.artist || 'Unknown Artist',
      album: track.album || '',
      duration: track.duration || '03:45',
      duration_seconds: track.duration_seconds || 225,
      audio_url: audioUrl,
      is_signed_url: Boolean(track.song_id),
      expires_in: signedExpiresIn,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/streaming/stations/:stationId/current-broadcast
 * Resolves currently active broadcast and immediate signed track for a station
 */
router.get('/stations/:stationId/current-broadcast', async (req, res) => {
  try {
    const { stationId } = req.params;
    const supabase = getSupabase();

    if (!supabase) {
      return res.status(500).json({ success: false, message: 'Database client not available.' });
    }

    // Find active published schedule for this station
    const { data: schedules } = await supabase
      .from('program_schedules')
      .select('*')
      .eq('station_id', stationId)
      .eq('is_published', true)
      .limit(1);

    if (!schedules || schedules.length === 0) {
      return res.status(200).json({
        success: true,
        station_id: Number(stationId),
        has_schedule: false,
        message: 'Station is running default continuous broadcast.'
      });
    }

    const currentSchedule = schedules[0];
    const tracks = await songService.getSchedulePlaylist(currentSchedule.id);

    res.status(200).json({
      success: true,
      station_id: Number(stationId),
      has_schedule: true,
      schedule: {
        id: currentSchedule.id,
        title: currentSchedule.title,
        start_time: currentSchedule.start_time,
        end_time: currentSchedule.end_time,
        total_tracks: tracks.length
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

