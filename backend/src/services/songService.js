/**
 * PulseCast Internet Radio Streaming System
 * Song Library & Supabase Storage Service (src/services/songService.js)
 *
 * Implements:
 * - Single and bulk audio uploads to private Supabase Storage
 * - Automatic metadata extraction via music-metadata
 * - Orphaned file cleanup on database failure
 * - Short-lived signed URL generation for playback & previews
 * - Safe soft-deletion and schedule reference checks
 */

const crypto = require('crypto');
const path = require('path');
const { getSupabase } = require('../config/supabase');
const {
  validateAudioFile,
  sanitizeFilename,
  extractAudioMetadata,
  formatDuration
} = require('../utils/audioMetadata');

const BUCKET_NAME = 'pulsecast-music-library';

// In-memory fallback cache when PostgreSQL schema migration has not been run yet
const memorySongs = new Map();
const memoryScheduleTracks = new Map(); // scheduleId -> Array of tracks

/**
 * Check if a Supabase error is caused by missing database table
 */
function isTableMissingError(err) {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    err.code === 'PGRST205' ||
    err.code === '42P01' ||
    msg.includes('schema cache') ||
    msg.includes('relation') ||
    msg.includes('does not exist')
  );
}

/**
 * Retrieve aggregated library statistics (Total Songs, Active Songs, Total Storage, Total Duration)
 */
async function getLibraryStats() {
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('songs')
        .select('id, is_active, file_size_bytes, duration_seconds');

      if (!error && Array.isArray(data)) {
        const totalSongs = data.length;
        const activeSongs = data.filter((s) => s.is_active).length;
        const totalStorageBytes = data.reduce((acc, s) => acc + (Number(s.file_size_bytes) || 0), 0);
        const totalDurationSeconds = data.reduce((acc, s) => acc + (Number(s.duration_seconds) || 0), 0);
        return {
          totalSongs,
          activeSongs,
          totalStorageBytes,
          totalDurationSeconds
        };
      }
    } catch (err) {
      if (!isTableMissingError(err)) {
        console.warn('[SONG_SERVICE] Failed to fetch stats from DB:', err.message);
      }
    }
  }

  // Memory fallback
  const all = Array.from(memorySongs.values());
  return {
    totalSongs: all.length,
    activeSongs: all.filter((s) => s.is_active).length,
    totalStorageBytes: all.reduce((acc, s) => acc + (Number(s.file_size_bytes) || 0), 0),
    totalDurationSeconds: all.reduce((acc, s) => acc + (Number(s.duration_seconds) || 0), 0)
  };
}

/**
 * List, search, filter, and paginate songs from the library
 */
async function getSongsList({ search = '', page = 1, limit = 20, activeOnly = false, sortBy = 'created_at', order = 'desc' } = {}) {
  const supabase = getSupabase();
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const validSortColumns = ['title', 'artist', 'album', 'created_at', 'duration_seconds'];
  const sortCol = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
  const ascending = String(order).toLowerCase() === 'asc';

  if (supabase) {
    try {
      let query = supabase
        .from('songs')
        .select('*', { count: 'exact' });

      if (activeOnly) {
        query = query.eq('is_active', true);
      }

      if (search && search.trim()) {
        const q = search.trim();
        query = query.or(`title.ilike.%${q}%,artist.ilike.%${q}%,album.ilike.%${q}%`);
      }

      query = query
        .order(sortCol, { ascending, nullsFirst: false })
        .range(offset, offset + limitNum - 1);

      const [queryRes, stats] = await Promise.all([
        query,
        getLibraryStats()
      ]);

      const { data, count, error } = queryRes;

      if (!error && data) {
        return {
          total: count !== null && count !== undefined ? count : data.length,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil((count !== null && count !== undefined ? count : data.length) / limitNum) || 1,
          songs: data,
          stats
        };
      }

      if (error && !isTableMissingError(error)) {
        throw new Error(error.message);
      }
    } catch (err) {
      if (!isTableMissingError(err)) {
        console.error('[SONG_SERVICE] Database query error:', err.message);
      }
    }
  }

  // In-Memory Fallback
  let all = Array.from(memorySongs.values());
  if (activeOnly) {
    all = all.filter((s) => s.is_active);
  }
  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    all = all.filter(
      (s) =>
        (s.title && s.title.toLowerCase().includes(q)) ||
        (s.artist && s.artist.toLowerCase().includes(q)) ||
        (s.album && s.album.toLowerCase().includes(q))
    );
  }

  all.sort((a, b) => {
    let valA = a[sortCol];
    let valB = b[sortCol];
    if (sortCol === 'created_at') {
      return ascending ? new Date(valA) - new Date(valB) : new Date(valB) - new Date(valA);
    }
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    if (valA < valB) return ascending ? -1 : 1;
    if (valA > valB) return ascending ? 1 : -1;
    return 0;
  });

  const total = all.length;
  const paginated = all.slice(offset, offset + limitNum);
  const memoryStats = {
    totalSongs: memorySongs.size,
    activeSongs: Array.from(memorySongs.values()).filter((s) => s.is_active).length,
    totalStorageBytes: Array.from(memorySongs.values()).reduce((acc, s) => acc + (Number(s.file_size_bytes) || 0), 0),
    totalDurationSeconds: Array.from(memorySongs.values()).reduce((acc, s) => acc + (Number(s.duration_seconds) || 0), 0)
  };

  return {
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 1,
    songs: paginated,
    stats: memoryStats
  };
}

/**
 * Fetch a single song by UUID
 */
async function getSongById(id) {
  if (!id) return null;
  const supabase = getSupabase();

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('songs')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (!error && data) return data;
      if (error && !isTableMissingError(error)) throw new Error(error.message);
    } catch (err) {
      if (!isTableMissingError(err)) {
        console.error('[SONG_SERVICE] getSongById error:', err.message);
      }
    }
  }

  return memorySongs.get(id) || null;
}

/**
 * Upload a single song to Supabase Storage and register metadata row
 */
async function uploadSingleSong({ file, title, artist, album, userId = null }) {
  // 1. Validation
  const validation = validateAudioFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Supabase client is not configured.');
  }

  // 2. Prepare paths and identifiers
  const songId = crypto.randomUUID();
  const safeFilename = sanitizeFilename(file.originalname);
  const storagePath = `library/${songId}/${safeFilename}`;
  const mimeType = file.mimetype || 'audio/mpeg';
  const sizeBytes = file.size || file.buffer.length;

  // 3. Extract audio metadata (ID3 tags / duration)
  const extracted = await extractAudioMetadata(file.buffer, file.originalname, mimeType);

  const finalTitle = (title && title.trim()) || extracted.title || 'Untitled Track';
  const finalArtist = (artist && artist.trim()) || extracted.artist || null;
  const finalAlbum = (album && album.trim()) || extracted.album || null;
  const durationSeconds = extracted.durationSeconds || 0;
  const duration = extracted.duration || formatDuration(durationSeconds);

  // 4. Upload binary audio to Supabase Storage (private bucket)
  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, file.buffer, {
      contentType: mimeType,
      upsert: false
    });

  if (uploadError) {
    console.error('[SONG_SERVICE] Supabase Storage upload failed:', uploadError.message);
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  // 5. Insert metadata into public.songs
  const songRecord = {
    id: songId,
    title: finalTitle,
    artist: finalArtist,
    album: finalAlbum,
    duration_seconds: durationSeconds,
    duration,
    mime_type: mimeType,
    file_size_bytes: sizeBytes,
    storage_bucket: BUCKET_NAME,
    storage_path: storagePath,
    original_filename: file.originalname,
    created_by: userId ? Number(userId) : null,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  try {
    const { data, error: insertError } = await supabase
      .from('songs')
      .insert(songRecord)
      .select('*')
      .single();

    if (insertError) {
      if (!isTableMissingError(insertError)) {
        // Rollback uploaded object immediately to avoid orphaned storage files
        console.warn(`[SONG_SERVICE] Rolling back orphaned object "${storagePath}" due to DB error: ${insertError.message}`);
        await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
        throw new Error(`Database record creation failed: ${insertError.message}`);
      }
      // If table is missing, store in memory fallback
      memorySongs.set(songId, songRecord);
      return songRecord;
    }

    // Also update in-memory cache
    memorySongs.set(songId, data || songRecord);
    return data || songRecord;
  } catch (err) {
    if (isTableMissingError(err)) {
      memorySongs.set(songId, songRecord);
      return songRecord;
    }
    // Clean up uploaded object on error
    await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
    throw err;
  }
}

/**
 * Bulk upload multiple audio files with limited concurrency
 */
async function uploadBulkSongs({ files = [], userId = null, concurrency = 3 }) {
  if (!Array.isArray(files) || files.length === 0) {
    return { total: 0, successful: 0, failed: 0, results: [] };
  }

  const results = [];
  const limit = Math.max(1, Math.min(5, concurrency));

  // Process files using a bounded concurrency queue
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < files.length) {
      const idx = currentIndex++;
      const file = files[idx];
      try {
        const song = await uploadSingleSong({ file, userId });
        results[idx] = {
          filename: file.originalname,
          success: true,
          song
        };
      } catch (err) {
        results[idx] = {
          filename: file.originalname,
          success: false,
          error: err.message || 'Upload failed'
        };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, files.length) }, () => worker());
  await Promise.all(workers);

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return {
    total: files.length,
    successful,
    failed,
    results
  };
}

/**
 * Update song metadata (title, artist, album, is_active)
 */
async function updateSongMetadata(id, updates = {}) {
  const song = await getSongById(id);
  if (!song) {
    throw new Error('Song not found');
  }

  const patch = {
    updated_at: new Date().toISOString()
  };

  if (updates.title !== undefined) patch.title = String(updates.title).trim();
  if (updates.artist !== undefined) patch.artist = updates.artist ? String(updates.artist).trim() : null;
  if (updates.album !== undefined) patch.album = updates.album ? String(updates.album).trim() : null;
  if (updates.is_active !== undefined) patch.is_active = Boolean(updates.is_active);

  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('songs')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single();

      if (!error && data) {
        memorySongs.set(id, data);
        return data;
      }
      if (error && !isTableMissingError(error)) {
        throw new Error(error.message);
      }
    } catch (err) {
      if (!isTableMissingError(err)) throw err;
    }
  }

  // Update memory store
  const updated = { ...song, ...patch };
  memorySongs.set(id, updated);
  return updated;
}

/**
 * Delete or archive a song
 * Permanent deletion checks for schedule references
 */
async function deleteSong(id, { permanent = false, force = false } = {}) {
  const song = await getSongById(id);
  if (!song) {
    throw new Error('Song not found');
  }

  // 1. Soft delete (archive)
  if (!permanent) {
    return await updateSongMetadata(id, { is_active: false });
  }

  // 2. Permanent delete: check if assigned to any schedule
  const supabase = getSupabase();
  let assignedCount = 0;

  if (supabase) {
    try {
      const { count, error } = await supabase
        .from('schedule_tracks')
        .select('*', { count: 'exact', head: true })
        .eq('song_id', id);

      if (!error && count !== null) {
        assignedCount = count;
      }
    } catch {
      // Table may not exist yet
    }
  }

  // Check in-memory schedule tracks
  for (const tracks of memoryScheduleTracks.values()) {
    assignedCount += tracks.filter((t) => t.song_id === id).length;
  }

  if (assignedCount > 0 && !force) {
    const error = new Error(`Cannot delete song: currently assigned to ${assignedCount} program schedule(s). Archive it instead or remove it from schedules first.`);
    error.status = 409;
    error.conflict = true;
    error.assignedCount = assignedCount;
    throw error;
  }

  // 3. Remove from storage
  if (supabase && song.storage_path) {
    try {
      await supabase.storage.from(song.storage_bucket || BUCKET_NAME).remove([song.storage_path]);
    } catch (err) {
      console.warn(`[SONG_SERVICE] Failed to remove object "${song.storage_path}": ${err.message}`);
    }
  }

  // 4. Remove from database
  if (supabase) {
    try {
      await supabase.from('schedule_tracks').delete().eq('song_id', id);
      await supabase.from('songs').delete().eq('id', id);
    } catch (err) {
      if (!isTableMissingError(err)) {
        console.error('[SONG_SERVICE] DB delete error:', err.message);
      }
    }
  }

  // Remove from memory
  memorySongs.delete(id);
  return { success: true, message: `Song "${song.title}" permanently deleted.` };
}

/**
 * Generate a short-lived signed URL for preview or playback
 */
async function generateSignedUrl(id, expiresInSeconds = 300) {
  const song = await getSongById(id);
  if (!song) {
    throw new Error('Song not found');
  }

  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Supabase client is not configured.');
  }

  const bucket = song.storage_bucket || BUCKET_NAME;
  const path = song.storage_path;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data || !data.signedUrl) {
    throw new Error(`Failed to generate signed URL: ${error ? error.message : 'Unknown error'}`);
  }

  return {
    songId: song.id,
    title: song.title,
    artist: song.artist,
    signedUrl: data.signedUrl,
    expiresIn: expiresInSeconds
  };
}

/**
 * Schedule Playlist Operations
 */
async function getSchedulePlaylist(scheduleId) {
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('schedule_tracks')
        .select('*')
        .eq('schedule_id', scheduleId)
        .order('play_order', { ascending: true });

      if (!error && Array.isArray(data)) {
        return data;
      }
    } catch {
      // Fall through to memory
    }
  }
  return memoryScheduleTracks.get(String(scheduleId)) || [];
}

async function saveSchedulePlaylist(scheduleId, songs) {
  if (!Array.isArray(songs)) return [];
  const supabase = getSupabase();

  const formattedRows = songs.map((s, idx) => {
    // Never persist temporary signed URLs or internal signed endpoints in stream_url
    let safeStreamUrl = s.stream_url || null;
    if (safeStreamUrl && (safeStreamUrl.includes('token=') || safeStreamUrl.includes('/signed-url') || s.song_id)) {
      safeStreamUrl = null;
    }

    return {
      id: s.id && s.id.length > 20 ? s.id : crypto.randomUUID(),
      schedule_id: Number(scheduleId),
      song_id: s.song_id || (s.id && isNaN(Number(s.id)) ? s.id : null),
      title: s.title ? s.title.trim() : 'Untitled Track',
      artist: s.artist ? s.artist.trim() : null,
      album: s.album ? s.album.trim() : null,
      duration: s.duration || '03:45',
      duration_seconds: s.duration_seconds || 225,
      stream_url: safeStreamUrl,
      play_order: idx + 1,
      created_at: new Date().toISOString()
    };
  });

  if (supabase) {
    try {
      await supabase.from('schedule_tracks').delete().eq('schedule_id', scheduleId);
      if (formattedRows.length > 0) {
        await supabase.from('schedule_tracks').insert(formattedRows);
      }
    } catch {
      // Table may not exist yet, cache in memory
    }
  }

  memoryScheduleTracks.set(String(scheduleId), formattedRows);
  return formattedRows;
}

module.exports = {
  BUCKET_NAME,
  getLibraryStats,
  getSongsList,
  getSongById,
  uploadSingleSong,
  uploadBulkSongs,
  updateSongMetadata,
  deleteSong,
  generateSignedUrl,
  getSchedulePlaylist,
  saveSchedulePlaylist
};

