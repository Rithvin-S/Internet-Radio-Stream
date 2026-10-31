/**
 * PulseCast Internet Radio Streaming System
 * Station-Aware Playback & Streaming Service (src/services/streamingService.js)
 * 
 * Implements:
 * - Station-aware real-time schedule resolution
 * - Timezone handling in Asia/Kolkata
 * - Midnight-crossing schedule evaluations
 * - Playlist progression and cursor management
 * - Ephemeral Supabase signed URL generation
 * - General Library vs Supabase Library source separation
 */

const { getSupabase } = require('../config/supabase');
const songService = require('./songService');

// Per-station playback progression memory cache
// Map: stationId -> { scheduleId, currentIndex, lastTrackId, lastPolledAt }
const stationPlaybackStates = new Map();

/**
 * Converts "HH:MM" string to minutes from midnight (0 to 1439)
 */
function timeToMinutes(t) {
  if (!t || typeof t !== 'string') return 0;
  const parts = t.trim().split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

/**
 * Returns date and time breakdown in Asia/Kolkata timezone
 */
function getKolkataDateTime(dateInput = null) {
  let dateObj;
  if (!dateInput) {
    dateObj = new Date();
  } else if (dateInput instanceof Date) {
    dateObj = dateInput;
  } else {
    let cleanInput = dateInput;
    if (typeof cleanInput === 'string' && cleanInput.includes(' ') && !cleanInput.includes('+')) {
      cleanInput = cleanInput.replace(' ', '+');
    }
    dateObj = new Date(cleanInput);
  }

  if (isNaN(dateObj.getTime())) {
    dateObj = new Date();
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(dateObj);
  const getPart = (t) => parts.find((p) => p.type === t)?.value;

  const year = getPart('year');
  const month = getPart('month');
  const day = getPart('day');
  const hour = parseInt(getPart('hour'), 10) || 0;
  const minute = parseInt(getPart('minute'), 10) || 0;
  const second = parseInt(getPart('second'), 10) || 0;

  const dateStr = `${year}-${month}-${day}`;
  const timeMinutes = hour * 60 + minute;
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  return {
    dateStr,
    timeMinutes,
    timeStr,
    hour,
    minute,
    second,
    rawDate: dateObj
  };
}

/**
 * Helper to compute the next day in YYYY-MM-DD
 */
function getNextDateString(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const parts = dateStr.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  const nextDt = new Date(Date.UTC(y, m - 1, d + 1));
  const nextY = nextDt.getUTCFullYear();
  const nextM = String(nextDt.getUTCMonth() + 1).padStart(2, '0');
  const nextD = String(nextDt.getUTCDate()).padStart(2, '0');
  return `${nextY}-${nextM}-${nextD}`;
}

/**
 * Safely parse metadata and songs from description JSON
 */
function extractMetadata(desc) {
  if (!desc || typeof desc !== 'string') return { cleanDesc: '', songs: [], category: 'Music', date: null };

  if (desc.startsWith('{') && desc.endsWith('}')) {
    try {
      const parsed = JSON.parse(desc);
      const rawSongs = Array.isArray(parsed.songs) ? parsed.songs : [];
      const normalizedSongs = rawSongs.map((s) => ({
        ...s,
        source: s.source || (s.song_id ? 'supabase' : 'general'),
        track_id: s.track_id || (s.song_id ? null : (!isNaN(Number(s.id)) ? Number(s.id) : null))
      }));
      return {
        cleanDesc: parsed.notes || parsed.description || '',
        songs: normalizedSongs,
        category: parsed.category || 'Music',
        date: parsed.schedule_date || null
      };
    } catch {
      // Fall through to plain text
    }
  }
  return { cleanDesc: desc, songs: [], category: 'Music', date: null };
}

/**
 * Check if a program schedule is currently active at kolkataNow
 */
function isScheduleActive(schedule, kolkataNow) {
  if (!schedule || !Boolean(schedule.is_published)) return false;
  if (!schedule.start_time || !schedule.end_time) return false;

  const startMin = timeToMinutes(schedule.start_time);
  const endMin = timeToMinutes(schedule.end_time);
  const currentMin = kolkataNow.timeMinutes;
  const currentDateStr = kolkataNow.dateStr;

  const meta = extractMetadata(schedule.description);
  const schedDate = schedule.schedule_date || meta.date;
  const isDaily = !schedDate || schedDate === 'daily';

  // Midnight crossing check (e.g. 22:00 to 02:00)
  const crossesMidnight = endMin <= startMin;

  if (isDaily) {
    if (crossesMidnight) {
      return currentMin >= startMin || currentMin < endMin;
    } else {
      return currentMin >= startMin && currentMin < endMin;
    }
  }

  // Date-specific schedule
  if (!crossesMidnight) {
    return (schedDate === currentDateStr) && (currentMin >= startMin && currentMin < endMin);
  } else {
    // Leg 1: Starts on schedDate, runs until 23:59:59
    if (schedDate === currentDateStr && currentMin >= startMin) {
      return true;
    }
    // Leg 2: Crosses into next day, runs from 00:00 until endMin
    const nextDateStr = getNextDateString(schedDate);
    if (nextDateStr === currentDateStr && currentMin < endMin) {
      return true;
    }
    return false;
  }
}

/**
 * Retrieve or initialize station playback state
 */
function getPlaybackState(stationId) {
  const key = String(stationId);
  if (!stationPlaybackStates.has(key)) {
    stationPlaybackStates.set(key, {
      stationId: Number(stationId),
      scheduleId: null,
      currentIndex: 0,
      lastPolledAt: null,
      lastTrackId: null
    });
  }
  return stationPlaybackStates.get(key);
}

/**
 * Reset station playback progression state (e.g. for testing or reset triggers)
 */
function resetStationPlayback(stationId) {
  const key = String(stationId);
  stationPlaybackStates.delete(key);
}

/**
 * Resolves the currently active track for a given station
 * 
 * @param {number|string} stationId - ID of station to query
 * @param {object} options - Optional query parameters:
 *    - now: Date or ISO string to simulate current time (for tests)
 *    - index: Explicit track index (0-based)
 *    - cursor: Explicit track cursor
 *    - current_track_id: Advance past this specific track ID
 *    - advance: Boolean flag to increment cursor
 */
async function resolveStationNextTrack(stationId, options = {}) {
  const sId = parseInt(stationId, 10);
  if (isNaN(sId) || sId <= 0) {
    const err = new Error('Invalid station ID provided. ID must be a positive integer.');
    err.statusCode = 400;
    throw err;
  }

  const supabase = getSupabase();
  if (!supabase) {
    const err = new Error('Database client not available.');
    err.statusCode = 500;
    throw err;
  }

  // 1. Verify Station Exists and is Active
  const { data: station, error: stationErr } = await supabase
    .from('stations')
    .select('id, name, is_active')
    .eq('id', sId)
    .maybeSingle();

  if (stationErr || !station) {
    const err = new Error(`Station with ID ${sId} was not found.`);
    err.statusCode = 404;
    throw err;
  }

  if (!station.is_active) {
    const err = new Error(`Station "${station.name}" (ID ${sId}) is inactive or disabled.`);
    err.statusCode = 400;
    throw err;
  }

  // 2. Resolve Asia/Kolkata wall-clock time
  const kolkataNow = getKolkataDateTime(options.now || options.simulated_time);

  // 3. Find published schedules for this station
  const { data: schedules, error: schedErr } = await supabase
    .from('program_schedules')
    .select('*')
    .eq('station_id', sId)
    .eq('is_published', true);

  if (schedErr) {
    const err = new Error(`Failed to query schedules: ${schedErr.message}`);
    err.statusCode = 500;
    throw err;
  }

  // 4. Filter active schedule matching current Asia/Kolkata time
  const activeSchedules = (schedules || []).filter((s) => isScheduleActive(s, kolkataNow));

  if (activeSchedules.length === 0) {
    return {
      success: true,
      has_schedule: false,
      fallback: true,
      station_id: sId,
      station_name: station.name,
      kolkata_time: kolkataNow.timeStr,
      kolkata_date: kolkataNow.dateStr,
      message: 'No active schedule'
    };
  }

  // Priority: Sort date-specific over daily, and earliest start_time
  activeSchedules.sort((a, b) => {
    const metaA = extractMetadata(a.description);
    const metaB = extractMetadata(b.description);
    const dateA = a.schedule_date || metaA.date;
    const dateB = b.schedule_date || metaB.date;
    const isDailyA = !dateA || dateA === 'daily';
    const isDailyB = !dateB || dateB === 'daily';

    if (!isDailyA && isDailyB) return -1;
    if (isDailyA && !isDailyB) return 1;
    return timeToMinutes(a.start_time) - timeToMinutes(b.start_time);
  });

  const currentSchedule = activeSchedules[0];

  // 5. Fetch assigned tracks from schedule_tracks (or fallback metadata)
  let playlist = await songService.getSchedulePlaylist(currentSchedule.id);
  if (!playlist || playlist.length === 0) {
    const meta = extractMetadata(currentSchedule.description);
    if (meta.songs && meta.songs.length > 0) {
      playlist = meta.songs;
    }
  }

  // 6. Handle empty playlist safely
  if (!playlist || playlist.length === 0) {
    return {
      success: true,
      has_schedule: true,
      fallback: true,
      station_id: sId,
      station_name: station.name,
      schedule_id: Number(currentSchedule.id),
      schedule_title: currentSchedule.title,
      start_time: currentSchedule.start_time,
      end_time: currentSchedule.end_time,
      total_tracks: 0,
      message: 'Active schedule has no assigned tracks'
    };
  }

  // 7. Playlist Progression & Cursor Resolution
  const state = getPlaybackState(sId);

  // If schedule transitioned to a new schedule, reset index to 0
  if (state.scheduleId !== currentSchedule.id) {
    state.scheduleId = currentSchedule.id;
    state.currentIndex = 0;
    state.lastTrackId = null;
  }

  let resolvedIndex = state.currentIndex;

  if (options.index !== undefined && !isNaN(parseInt(options.index, 10))) {
    resolvedIndex = parseInt(options.index, 10);
  } else if (options.cursor !== undefined && !isNaN(parseInt(options.cursor, 10))) {
    resolvedIndex = parseInt(options.cursor, 10);
  } else if (options.current_track_id) {
    // Find matching track and advance to next
    const curIdx = playlist.findIndex((t) =>
      (t.song_id && String(t.song_id) === String(options.current_track_id)) ||
      (t.track_id && String(t.track_id) === String(options.current_track_id)) ||
      (t.id && String(t.id) === String(options.current_track_id))
    );
    if (curIdx !== -1) {
      resolvedIndex = curIdx + 1;
    }
  } else if (options.advance === true || options.advance === 'true') {
    state.currentIndex = (state.currentIndex + 1) % playlist.length;
    resolvedIndex = state.currentIndex;
  }

  // Wrap index safely
  resolvedIndex = ((resolvedIndex % playlist.length) + playlist.length) % playlist.length;
  state.currentIndex = resolvedIndex;
  state.lastPolledAt = new Date().toISOString();

  const track = playlist[resolvedIndex];
  const isSupabase = track.source === 'supabase' || Boolean(track.song_id);

  // Calculate duration in seconds
  let durationSeconds = track.duration_seconds || null;
  if (!durationSeconds && track.duration) {
    const parts = String(track.duration).split(':');
    if (parts.length === 2) {
      durationSeconds = (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
    }
  }
  if (!durationSeconds) durationSeconds = 225;

  let audioUrl = track.stream_url || null;
  let isSignedUrl = false;
  let expiresIn = null;
  let storageError = null;

  // 8. Audio URL Resolution by Source
  if (isSupabase && track.song_id) {
    try {
      const signed = await songService.generateSignedUrl(track.song_id, 300);
      audioUrl = signed.signedUrl;
      isSignedUrl = true;
      expiresIn = 300;
    } catch (err) {
      storageError = err.message;
      audioUrl = null;
      isSignedUrl = true;
      expiresIn = null;
    }
  } else if (!isSupabase) {
    isSignedUrl = false;
    expiresIn = null;
    if (!audioUrl && (track.track_id || track.id)) {
      const tId = track.track_id || (!isNaN(Number(track.id)) ? Number(track.id) : null);
      if (tId) {
        const { data } = await supabase.from('upcoming_tracks').select('stream_url').eq('id', tId).maybeSingle();
        if (data && data.stream_url) {
          audioUrl = data.stream_url;
        }
      }
    }
  }

  const resolvedTrackId = isSupabase ? (track.song_id || track.id) : (track.track_id || track.id);
  state.lastTrackId = resolvedTrackId;

  return {
    success: true,
    has_schedule: true,
    fallback: false,
    station_id: sId,
    station_name: station.name,
    schedule_id: Number(currentSchedule.id),
    schedule_title: currentSchedule.title,
    start_time: currentSchedule.start_time,
    end_time: currentSchedule.end_time,
    play_order: track.play_order || resolvedIndex + 1,
    index: resolvedIndex,
    next_index: (resolvedIndex + 1) % playlist.length,
    total_tracks: playlist.length,
    cursor: (resolvedIndex + 1) % playlist.length,
    track_id: resolvedTrackId,
    song_id: isSupabase ? (track.song_id || null) : null,
    source: isSupabase ? 'supabase' : 'general',
    title: track.title,
    artist: track.artist || 'Unknown Artist',
    album: track.album || '',
    duration: track.duration || '03:45',
    duration_seconds: durationSeconds,
    audio_url: audioUrl,
    is_signed_url: isSignedUrl,
    expires_in: expiresIn,
    error: storageError || undefined,
    created_at: new Date().toISOString()
  };
}

module.exports = {
  timeToMinutes,
  getKolkataDateTime,
  getNextDateString,
  extractMetadata,
  isScheduleActive,
  getPlaybackState,
  resetStationPlayback,
  resolveStationNextTrack
};
