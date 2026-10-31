/**
 * PulseCast Internet Radio Streaming System
 * Radio Playback & Liquidsoap Streaming Bridge (src/routes/streaming.js)
 *
 * Implements the private-file-to-Liquidsoap playback bridge:
 * - Station-aware real-time schedule resolution
 * - Dynamically resolves upcoming scheduled tracks
 * - Creates short-lived signed URLs immediately prior to playback
 * - Handles expired URLs safely
 * - Exposes radio endpoints for Liquidsoap / EC2 radio playback worker
 */

const express = require('express');
const router = express.Router();
const songService = require('../services/songService');
const streamingService = require('../services/streamingService');
const { getSupabase } = require('../config/supabase');
const { authenticateUser, requireAdmin } = require('../middleware/auth');

/**
 * Authorization Guard for Radio Playback & Signed URL streaming
 * Only authorized EC2 radio daemon (via x-radio-token) or administrators can request streaming tracks.
 * Rejects the default hardcoded token in production mode.
 */
function requireStreamingAuth(req, res, next) {
  const radioToken = req.headers['x-radio-token'] || req.query.radio_token;
  const configuredKey = process.env.RADIO_STREAMING_KEY || process.env.STREAMING_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  // 1. Enforce production security check: reject default token
  if (isProduction) {
    if (!configuredKey || configuredKey === 'pulsecast_streaming_secure_token_key') {
      console.error('[STREAMING AUTH] CRITICAL: RADIO_STREAMING_KEY must be configured in production.');
      return res.status(500).json({
        success: false,
        message: 'Streaming authorization key configuration error.'
      });
    }
  }

  const expectedSecret = configuredKey || 'pulsecast_streaming_secure_token_key';

  // 2. Radio Token Authentication
  if (radioToken) {
    if (radioToken === expectedSecret) {
      return next();
    }
    return res.status(401).json({
      success: false,
      message: 'Invalid radio streaming token.'
    });
  }

  // 3. Fallback to Admin JWT (for Admin dashboard tests and control)
  return authenticateUser(req, res, (err) => {
    if (err) {
      return res.status(401).json({
        success: false,
        message: 'Missing or invalid streaming authorization credentials.'
      });
    }
    return requireAdmin(req, res, next);
  });
}

/**
 * GET /api/streaming/stations/:stationId/next-track
 * Station-Aware Playback Dispatcher:
 * - Identifies currently active published schedule for requested station
 * - Evaluates start/end times in Asia/Kolkata timezone
 * - Returns next track in playlist (Supabase signed URL or General audio URL)
 * - Protected: Requires x-radio-token or admin JWT
 */
router.get('/stations/:stationId/next-track', requireStreamingAuth, async (req, res) => {
  try {
    const { stationId } = req.params;
    const result = await streamingService.resolveStationNextTrack(stationId, req.query);
    return res.status(200).json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * GET /api/streaming/schedule/:scheduleId/next-track
 * Resolves the next scheduled song and creates an immediate signed URL for Liquidsoap playback.
 * Protected: Requires radio daemon token or admin JWT.
 */
router.get('/schedule/:scheduleId/next-track', requireStreamingAuth, async (req, res) => {
  try {
    const { scheduleId } = req.params;
    let playlist = await songService.getSchedulePlaylist(scheduleId);

    if (!playlist || playlist.length === 0) {
      // Fallback: check program_schedules JSON metadata
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data: sched } = await supabase
            .from('program_schedules')
            .select('description')
            .eq('id', scheduleId)
            .maybeSingle();

          if (sched && sched.description && sched.description.startsWith('{')) {
            const parsed = JSON.parse(sched.description);
            if (Array.isArray(parsed.songs) && parsed.songs.length > 0) {
              playlist = parsed.songs;
            }
          }
        } catch (err) {
          console.warn('[STREAMING] Fallback metadata check error:', err.message);
        }
      }
    }

    if (!playlist || playlist.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No tracks currently assigned to this program schedule.'
      });
    }

    // Default to the first track or requested track index
    const index = parseInt(req.query.index, 10) || 0;
    const track = playlist[index % playlist.length];

    const isSupabase = track.source === 'supabase' || Boolean(track.song_id);
    let audioUrl = track.stream_url || null;
    let signedExpiresIn = 300; // 5 minutes

    // Source-based audio resolution
    if (isSupabase && track.song_id) {
      try {
        const signed = await songService.generateSignedUrl(track.song_id, signedExpiresIn);
        audioUrl = signed.signedUrl;
      } catch (err) {
        console.warn(`[STREAMING] Signed URL generation failed for Supabase song ${track.song_id}: ${err.message}`);
      }
    } else if (!isSupabase) {
      // General Library track: resolve stream_url from track or upcoming_tracks table
      if (!audioUrl && (track.track_id || track.id)) {
        const supabase = getSupabase();
        if (supabase) {
          const tId = track.track_id || (!isNaN(Number(track.id)) ? Number(track.id) : null);
          if (tId) {
            const { data } = await supabase.from('upcoming_tracks').select('stream_url').eq('id', tId).maybeSingle();
            if (data && data.stream_url) {
              audioUrl = data.stream_url;
            }
          }
        }
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
      source: isSupabase ? 'supabase' : 'general',
      is_signed_url: isSupabase,
      expires_in: isSupabase ? signedExpiresIn : null,
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
