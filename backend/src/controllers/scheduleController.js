/**
 * PulseCast Internet Radio Streaming System
 * Program Schedule & Calendar Controller (src/controllers/scheduleController.js)
 * Implements Google Calendar-Style Scheduling, Conflict Detection & Track Assignment
 */

const db = require('../config/db');
const { getSupabase } = require('../config/supabase');
const { validateScheduleInput } = require('../validators/scheduleValidator');
const songService = require('../services/songService');

/**
 * Converts "HH:MM" string to minutes from midnight
 */
function timeToMinutes(t) {
  if (!t || typeof t !== 'string') return 0;
  const parts = t.trim().split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

/**
 * Checks if two time intervals [startA, endA] and [startB, endB] overlap
 * Adjacent intervals (e.g. 09:00-10:00 and 10:00-11:00) do NOT overlap.
 */
function checkTimeOverlap(startA, endA, startB, endB) {
  let sA = timeToMinutes(startA);
  let eA = timeToMinutes(endA);
  let sB = timeToMinutes(startB);
  let eB = timeToMinutes(endB);

  // Handle midnight crossing if any
  if (eA <= sA) eA += 1440;
  if (eB <= sB) eB += 1440;

  return sA < eB && eA > sB;
}

/**
 * Helper to get today's date in YYYY-MM-DD
 */
function getTodayDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Safely parse songs from description metadata if stored as JSON
 */
function extractMetadata(desc) {
  if (!desc) return { cleanDesc: '', songs: [], category: 'Music', date: null };
  if (typeof desc !== 'string') return { cleanDesc: '', songs: [], category: 'Music', date: null };

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
 * Package description with metadata for backward-compatibility and persistence
 */
function packageDescription(desc, category, date, songs) {
  const sanitizedSongs = (Array.isArray(songs) ? songs : []).map((s) => {
    const isSupabase = s.source === 'supabase' || Boolean(s.song_id);
    const clean = {
      id: s.id,
      song_id: isSupabase ? (s.song_id || (s.id && isNaN(Number(s.id)) ? s.id : null)) : null,
      track_id: !isSupabase ? (s.track_id || (!isNaN(Number(s.id)) ? Number(s.id) : null)) : null,
      source: isSupabase ? 'supabase' : 'general',
      title: s.title ? s.title.trim() : 'Untitled Track',
      artist: s.artist ? s.artist.trim() : null,
      album: s.album ? s.album.trim() : null,
      duration: s.duration || '03:45',
      duration_seconds: s.duration_seconds || 225,
      stream_url: isSupabase ? null : s.stream_url
    };
    if (clean.stream_url && (clean.stream_url.includes('token=') || clean.stream_url.includes('/signed-url'))) {
      clean.stream_url = null;
    }
    return clean;
  });

  return JSON.stringify({
    description: (desc || '').trim(),
    category: category || 'Music',
    schedule_date: date || getTodayDateString(),
    songs: sanitizedSongs
  });
}

/**
 * Fetch tracks assigned to a schedule
 */
async function fetchScheduleTracks(scheduleId, fallbackSongs = []) {
  try {
    const tracks = await songService.getSchedulePlaylist(scheduleId);
    if (Array.isArray(tracks) && tracks.length > 0) {
      return tracks;
    }
  } catch {
    // Fall through to fallback
  }
  return fallbackSongs || [];
}

/**
 * Save assigned tracks for a schedule
 */
async function saveScheduleTracks(scheduleId, songs) {
  if (!Array.isArray(songs)) return;
  try {
    await songService.saveSchedulePlaylist(scheduleId, songs);
  } catch (err) {
    console.warn(`[SCHEDULES] saveScheduleTracks notice: ${err.message}`);
  }
}

/**
 * Check schedule conflict for a station on a given date and time range
 */
async function checkScheduleConflict(stationId, date, startTime, endTime, excludeScheduleId = null) {
  const supabase = getSupabase();
  if (!supabase) return null;

  // Query all published schedules for this station
  let query = supabase
    .from('program_schedules')
    .select('*')
    .eq('station_id', stationId)
    .eq('is_published', true);

  if (excludeScheduleId) {
    query = query.neq('id', excludeScheduleId);
  }

  const { data, error } = await query;
  if (error || !Array.isArray(data)) return null;

  const targetDate = date || getTodayDateString();

  for (const item of data) {
    const meta = extractMetadata(item.description);
    const itemDate = item.schedule_date || meta.date;
    const isItemDaily = !itemDate || itemDate === 'daily';

    // Conflict applies if the existing item is daily OR if scheduled on the exact same date
    if (isItemDaily || itemDate === targetDate) {
      if (checkTimeOverlap(startTime, endTime, item.start_time, item.end_time)) {
        return {
          id: item.id,
          title: item.title,
          start_time: item.start_time,
          end_time: item.end_time,
          date: itemDate || targetDate
        };
      }
    }
  }

  return null;
}

/* ==========================================================================
   Public Endpoints (Listener & Radio Player Compatibility)
   ========================================================================== */

/**
 * GET /api/stations/:id/schedules
 * Returns published program schedules for a specific station (FR-10)
 */
async function getSchedulesByStation(req, res, next) {
  try {
    const stationId = parseInt(req.params.id, 10);
    if (isNaN(stationId) || stationId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid station ID.' });
    }

    const stations = await db.query('SELECT id, name FROM stations WHERE id = ?', [stationId]);
    if (!stations || stations.length === 0) {
      return res.status(404).json({ success: false, message: `Station with ID ${stationId} was not found.` });
    }

    const isUserAdmin = req.user && req.user.role === 'admin';
    const showAll = isUserAdmin && req.query.all === 'true';

    let sql = 'SELECT * FROM program_schedules WHERE station_id = ?';
    if (!showAll) {
      sql += ' AND is_published = 1';
    }
    sql += ' ORDER BY start_time ASC';

    const rawSchedules = await db.query(sql, [stationId]);

    const formatted = rawSchedules.map((s) => {
      const meta = extractMetadata(s.description);
      return {
        id: s.id,
        station_id: s.station_id,
        title: s.title,
        description: meta.cleanDesc,
        category: s.category || meta.category,
        schedule_date: s.schedule_date || meta.date || getTodayDateString(),
        start_time: s.start_time,
        end_time: s.end_time,
        is_published: Boolean(s.is_published),
        created_at: s.created_at
      };
    });

    res.status(200).json({
      success: true,
      station: stations[0],
      count: formatted.length,
      data: formatted
    });
  } catch (err) {
    next(err);
  }
}

/* ==========================================================================
   Admin Endpoints (Google Calendar-Style Scheduling)
   ========================================================================== */

/**
 * GET /api/admin/schedules
 * Fetch schedules across all stations for a visible date/calendar range
 */
async function getAdminSchedules(req, res, next) {
  try {
    const { from, to, stationId, status } = req.query;

    const supabase = getSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, message: 'Database not available.' });
    }

    // 1. Fetch stations map
    const { data: stations } = await supabase.from('stations').select('id, name, genre, artwork_url, is_active');
    const stationMap = new Map((stations || []).map((s) => [s.id, s]));

    // 2. Fetch all schedules
    let query = supabase.from('program_schedules').select('*');

    if (stationId && !isNaN(parseInt(stationId, 10))) {
      query = query.eq('station_id', parseInt(stationId, 10));
    }

    if (status === 'published') {
      query = query.eq('is_published', true);
    } else if (status === 'draft') {
      query = query.eq('is_published', false);
    }

    query = query.order('start_time', { ascending: true });
    const { data: rawSchedules, error } = await query;
    if (error) throw new Error(error.message);

    // 3. Format and enrich schedules
    const formatted = (rawSchedules || []).map((s) => {
      const meta = extractMetadata(s.description);
      const st = stationMap.get(s.station_id) || {};
      const hasSpecificDate = Boolean(s.schedule_date || meta.date);
      const scheduleDate = s.schedule_date || meta.date || null;
      const isDaily = !hasSpecificDate || scheduleDate === 'daily';

      return {
        id: s.id,
        station_id: s.station_id,
        station_name: st.name || `Station #${s.station_id}`,
        station_genre: st.genre || 'General',
        title: s.title,
        description: meta.cleanDesc,
        category: s.category || meta.category || 'Music',
        schedule_date: scheduleDate || getTodayDateString(),
        is_recurring: isDaily,
        start_time: s.start_time,
        end_time: s.end_time,
        is_published: Boolean(s.is_published),
        status: s.status || (s.is_published ? 'published' : 'draft'),
        songs: meta.songs || [],
        song_count: meta.songs ? meta.songs.length : 0,
        created_at: s.created_at
      };
    });

    // 4. Date range filter if 'from' and 'to' supplied
    let result = formatted;
    if (from && to) {
      result = formatted.filter((s) => {
        // Daily recurring programmes apply across all calendar ranges!
        if (s.is_recurring) return true;
        return s.schedule_date >= from && s.schedule_date <= to;
      });
    }

    res.status(200).json({
      success: true,
      count: result.length,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/schedules/:id
 * Fetch detailed schedule with ordered assigned songs
 */
async function getScheduleById(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid schedule ID.' });
    }

    const rows = await db.query('SELECT * FROM program_schedules WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, message: `Schedule #${id} not found.` });
    }

    const item = rows[0];
    const meta = extractMetadata(item.description);

    // Fetch station
    const stations = await db.query('SELECT id, name, genre, stream_url FROM stations WHERE id = ?', [item.station_id]);
    const station = stations && stations.length > 0 ? stations[0] : null;

    // Fetch assigned tracks
    const songs = await fetchScheduleTracks(id, meta.songs);

    res.status(200).json({
      success: true,
      data: {
        id: item.id,
        station_id: item.station_id,
        station_name: station ? station.name : `Station #${item.station_id}`,
        station_genre: station ? station.genre : 'General',
        title: item.title,
        description: meta.cleanDesc,
        category: item.category || meta.category || 'Music',
        schedule_date: item.schedule_date || meta.date || getTodayDateString(),
        start_time: item.start_time,
        end_time: item.end_time,
        is_published: Boolean(item.is_published),
        status: item.status || (item.is_published ? 'published' : 'draft'),
        songs,
        total_songs: songs.length,
        created_at: item.created_at
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/schedules (and POST /api/admin/stations/:id/schedules)
 * Create program schedule with conflict validation and song assignment
 */
async function adminCreateSchedule(req, res, next) {
  try {
    const stationId = parseInt(req.params.id || req.body.station_id, 10);
    if (isNaN(stationId) || stationId <= 0) {
      return res.status(400).json({ success: false, message: 'Valid target station is required.' });
    }

    // Verify station exists
    const stations = await db.query('SELECT id, name FROM stations WHERE id = ?', [stationId]);
    if (!stations || stations.length === 0) {
      return res.status(404).json({ success: false, message: `Station with ID ${stationId} was not found.` });
    }

    const validation = validateScheduleInput(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: validation.errors
      });
    }

    const { title, description, start_time, end_time, is_published, schedule_date, category, songs } = req.body;
    const published = is_published !== undefined ? Boolean(is_published) : true;
    const scheduleDate = schedule_date ? schedule_date.trim() : getTodayDateString();
    const progCategory = category ? category.trim() : 'Music';

    // Conflict detection: prevent overlapping published schedules on the same station
    if (published) {
      const conflict = await checkScheduleConflict(stationId, scheduleDate, start_time.trim(), end_time.trim());
      if (conflict) {
        return res.status(409).json({
          success: false,
          conflict: true,
          message: `Schedule conflict: Overlaps with existing published programme "${conflict.title}" (${conflict.start_time} - ${conflict.end_time}) on this station.`,
          conflicting_schedule: conflict
        });
      }
    }

    // Package metadata
    const packagedDesc = packageDescription(description, progCategory, scheduleDate, songs || []);

    const result = await db.query(
      `INSERT INTO program_schedules (station_id, title, description, start_time, end_time, is_published)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [stationId, title.trim(), packagedDesc, start_time.trim(), end_time.trim(), published]
    );

    const scheduleId = result.insertId;

    // Save assigned tracks
    if (Array.isArray(songs) && songs.length > 0) {
      await saveScheduleTracks(scheduleId, songs);
    }

    const createdSchedule = {
      id: scheduleId,
      station_id: stationId,
      station_name: stations[0].name,
      title: title.trim(),
      description: description ? description.trim() : '',
      category: progCategory,
      schedule_date: scheduleDate,
      start_time: start_time.trim(),
      end_time: end_time.trim(),
      is_published: published,
      status: published ? 'published' : 'draft',
      songs: songs || []
    };

    res.status(201).json({
      success: true,
      message: 'Program schedule created successfully.',
      data: createdSchedule
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/admin/schedules/:id
 * Update program schedule entry
 */
async function adminUpdateSchedule(req, res, next) {
  try {
    const scheduleId = parseInt(req.params.id, 10);
    if (isNaN(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid schedule ID.' });
    }

    const existingRows = await db.query('SELECT * FROM program_schedules WHERE id = ?', [scheduleId]);
    if (!existingRows || existingRows.length === 0) {
      return res.status(404).json({ success: false, message: `Schedule entry with ID ${scheduleId} was not found.` });
    }

    const current = existingRows[0];
    const meta = extractMetadata(current.description);

    const validation = validateScheduleInput(req.body, true);
    if (!validation.isValid) {
      return res.status(400).json({ success: false, message: 'Validation failed.', errors: validation.errors });
    }

    const stationId = req.body.station_id !== undefined ? parseInt(req.body.station_id, 10) : current.station_id;
    const title = req.body.title !== undefined ? req.body.title.trim() : current.title;
    const desc = req.body.description !== undefined ? req.body.description.trim() : meta.cleanDesc;
    const startTime = req.body.start_time !== undefined ? req.body.start_time.trim() : current.start_time;
    const endTime = req.body.end_time !== undefined ? req.body.end_time.trim() : current.end_time;
    const published = req.body.is_published !== undefined ? Boolean(req.body.is_published) : Boolean(current.is_published);
    const scheduleDate = req.body.schedule_date !== undefined ? req.body.schedule_date.trim() : (meta.date || getTodayDateString());
    const category = req.body.category !== undefined ? req.body.category.trim() : (meta.category || 'Music');
    const songs = req.body.songs !== undefined ? req.body.songs : meta.songs;

    // Conflict check (exclude self)
    if (published) {
      const conflict = await checkScheduleConflict(stationId, scheduleDate, startTime, endTime, scheduleId);
      if (conflict) {
        return res.status(409).json({
          success: false,
          conflict: true,
          message: `Schedule conflict: Overlaps with existing published programme "${conflict.title}" (${conflict.start_time} - ${conflict.end_time}) on this station.`,
          conflicting_schedule: conflict
        });
      }
    }

    const packagedDesc = packageDescription(desc, category, scheduleDate, songs);

    await db.query(
      `UPDATE program_schedules
       SET title = ?, description = ?, start_time = ?, end_time = ?, is_published = ?
       WHERE id = ?`,
      [title, packagedDesc, startTime, endTime, published, scheduleId]
    );

    // Update assigned tracks
    if (Array.isArray(songs)) {
      await saveScheduleTracks(scheduleId, songs);
    }

    res.status(200).json({
      success: true,
      message: 'Program schedule updated successfully.',
      data: {
        id: scheduleId,
        station_id: stationId,
        title,
        description: desc,
        category,
        schedule_date: scheduleDate,
        start_time: startTime,
        end_time: endTime,
        is_published: published,
        status: published ? 'published' : 'draft',
        songs: songs || []
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/admin/schedules/:id
 * Delete program schedule entry
 */
async function adminDeleteSchedule(req, res, next) {
  try {
    const scheduleId = parseInt(req.params.id, 10);
    if (isNaN(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid schedule ID.' });
    }

    const existing = await db.query('SELECT * FROM program_schedules WHERE id = ?', [scheduleId]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ success: false, message: `Schedule entry with ID ${scheduleId} was not found.` });
    }

    // Delete tracks first if present
    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase.from('schedule_tracks').delete().eq('schedule_id', scheduleId);
      } catch {
        // Ignore if table not present
      }
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

/**
 * POST /api/admin/schedules/:id/duplicate
 * Duplicate schedule to a new entry
 */
async function adminDuplicateSchedule(req, res, next) {
  try {
    const scheduleId = parseInt(req.params.id, 10);
    if (isNaN(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid schedule ID.' });
    }

    const existingRows = await db.query('SELECT * FROM program_schedules WHERE id = ?', [scheduleId]);
    if (!existingRows || existingRows.length === 0) {
      return res.status(404).json({ success: false, message: `Schedule #${scheduleId} not found.` });
    }

    const orig = existingRows[0];
    const meta = extractMetadata(orig.description);
    const newTitle = `Copy of ${orig.title}`;
    const newSongs = await fetchScheduleTracks(scheduleId, meta.songs);

    const packagedDesc = packageDescription(meta.cleanDesc, meta.category, meta.date, newSongs);

    // Save as draft to prevent immediate conflict
    const result = await db.query(
      `INSERT INTO program_schedules (station_id, title, description, start_time, end_time, is_published)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [orig.station_id, newTitle, packagedDesc, orig.start_time, orig.end_time, false]
    );

    const newId = result.insertId;
    if (newSongs.length > 0) {
      await saveScheduleTracks(newId, newSongs);
    }

    res.status(201).json({
      success: true,
      message: `Schedule duplicated as "${newTitle}". Saved as Draft.`,
      data: {
        id: newId,
        station_id: orig.station_id,
        title: newTitle,
        description: meta.cleanDesc,
        category: meta.category,
        schedule_date: meta.date || getTodayDateString(),
        start_time: orig.start_time,
        end_time: orig.end_time,
        is_published: false,
        status: 'draft',
        songs: newSongs
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/admin/schedules/:id/publish
 * Toggle publish/unpublish schedule with conflict check
 */
async function adminToggleSchedulePublish(req, res, next) {
  try {
    const scheduleId = parseInt(req.params.id, 10);
    if (isNaN(scheduleId) || scheduleId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid schedule ID.' });
    }

    const existingRows = await db.query('SELECT * FROM program_schedules WHERE id = ?', [scheduleId]);
    if (!existingRows || existingRows.length === 0) {
      return res.status(404).json({ success: false, message: `Schedule #${scheduleId} not found.` });
    }

    const current = existingRows[0];
    const nextPublished = !Boolean(current.is_published);

    if (nextPublished) {
      const meta = extractMetadata(current.description);
      const conflict = await checkScheduleConflict(
        current.station_id,
        meta.date || current.schedule_date,
        current.start_time,
        current.end_time,
        scheduleId
      );

      if (conflict) {
        return res.status(409).json({
          success: false,
          conflict: true,
          message: `Cannot publish: Overlaps with published programme "${conflict.title}" (${conflict.start_time} - ${conflict.end_time}).`,
          conflicting_schedule: conflict
        });
      }
    }

    await db.query(
      'UPDATE program_schedules SET is_published = ? WHERE id = ?',
      [nextPublished ? 1 : 0, scheduleId]
    );

    res.status(200).json({
      success: true,
      message: `Schedule is now ${nextPublished ? 'Published' : 'Draft'}.`,
      is_published: nextPublished
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/songs/search?q=...&source=general|supabase|all
 * Search music library entries categorized by source (General Library vs Supabase Library)
 */
async function adminSearchSongs(req, res, next) {
  try {
    const query = (req.query.q || req.query.search || '').trim();
    const source = (req.query.source || 'all').toLowerCase(); // 'general' | 'supabase' | 'all'

    const seen = new Set();
    const songs = [];

    // 1. Search Supabase Storage Library if requested
    if (source === 'supabase' || source === 'all' || source === 'library') {
      try {
        const libResult = await songService.getSongsList({ search: query, limit: 50, activeOnly: true });
        for (const s of libResult.songs || []) {
          const key = `supabase_${s.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            songs.push({
              id: s.id,
              song_id: s.id,
              track_id: null,
              title: s.title,
              artist: s.artist || 'Unknown Artist',
              album: s.album || '',
              duration: s.duration || '03:45',
              duration_seconds: s.duration_seconds || 225,
              stream_url: null,
              preview_url: `/api/admin/songs/${s.id}/signed-url`,
              source: 'supabase'
            });
          }
        }
      } catch (err) {
        console.warn('[SCHEDULES] Supabase Library search notice:', err.message);
      }
    }

    // 2. Search General Library (upcoming_tracks catalogue) if requested
    if (source === 'general' || source === 'all' || source === 'catalogue') {
      const supabase = getSupabase();
      if (supabase) {
        try {
          let trackQuery = supabase
            .from('upcoming_tracks')
            .select('id, station_id, title, artist, album, duration, stream_url')
            .order('id', { ascending: true });

          if (query) {
            trackQuery = trackQuery.or(`title.ilike.%${query}%,artist.ilike.%${query}%,album.ilike.%${query}%`);
          }

          const { data, error } = await trackQuery.limit(50);
          if (!error && Array.isArray(data)) {
            for (const t of data) {
              const key = `general_${t.id}`;
              if (!seen.has(key)) {
                seen.add(key);
                songs.push({
                  id: t.id,
                  track_id: t.id,
                  song_id: null,
                  title: t.title,
                  artist: t.artist || 'Unknown Artist',
                  album: t.album || '',
                  duration: t.duration || '03:45',
                  duration_seconds: timeToMinutes(t.duration || '03:45') * 60,
                  stream_url: t.stream_url || null,
                  source: 'general'
                });
              }
            }
          }
        } catch (err) {
          console.warn('[SCHEDULES] General Library search notice:', err.message);
        }
      }
    }

    res.status(200).json({
      success: true,
      count: songs.length,
      source,
      data: songs
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSchedulesByStation,
  getAdminSchedules,
  getScheduleById,
  adminCreateSchedule,
  adminUpdateSchedule,
  adminDeleteSchedule,
  adminDuplicateSchedule,
  adminToggleSchedulePublish,
  adminSearchSongs
};
