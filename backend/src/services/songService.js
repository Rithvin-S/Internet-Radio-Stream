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

// Pre-calculated hashes for existing 7 library songs (SHA-256)
const KNOWN_EXISTING_HASHES = new Map([
  ['1a3825f2-1b65-4615-9f03-c42722d73551', '5ffb16cb0285a508d4a5e80fc0c88e10f328b3f28a9a4c77178790b87767126c'],
  ['fcc125ce-48a7-4b4b-8e88-dea1f7163b93', '5ffb16cb0285a508d4a5e80fc0c88e10f328b3f28a9a4c77178790b87767126c'],
  ['757758c5-3e4d-4d38-b647-978fe7b124c8', '5ffb16cb0285a508d4a5e80fc0c88e10f328b3f28a9a4c77178790b87767126c'],
  ['416f5948-3b51-405c-a16b-d01594d11840', '9678589c145ddcb07eeabd03a4b7517fe0fe7481413eb5793abfe3b2c3747f10'],
  ['a8abd023-8175-4459-8470-647279902798', '9678589c145ddcb07eeabd03a4b7517fe0fe7481413eb5793abfe3b2c3747f10'],
  ['0528db8a-f0c4-42d7-8915-223d7f839c93', 'b29ee2e9abfbd38a962d9a2a0838a4dbe34db6f62649fd714406390b9633d209'],
  ['670b66e7-3bf6-4d55-b8ac-a65bc09d6160', '210fb64a586c236f747409743aa01b9a350eb610e6878ee5f55c88146a42c855']
]);

// Track in-flight uploads to prevent concurrent race conditions
const inFlightUploads = new Set();

/**
 * Normalize filename for consistent case-insensitive and trimmed comparison
 */
function normalizeFilename(filename) {
  if (!filename || typeof filename !== 'string') return '';
  return filename
    .trim()
    .toLowerCase()
    .normalize('NFC')
    .replace(/\s+/g, ' ');
}

/**
 * Calculate SHA-256 cryptographic hash of audio buffer
 */
function calculateFileHash(buffer) {
  if (!buffer) return null;
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Check whether a song with the same normalized filename or SHA-256 content hash exists
 * Checks both active and archived songs across the database and in-memory fallback.
 */
async function checkDuplicateSong({ filename, hash, excludeId = null }) {
  const supabase = getSupabase();
  const normName = normalizeFilename(filename);

  if (supabase) {
    try {
      // Query all songs (active AND archived)
      const { data: allSongs, error } = await supabase
        .from('songs')
        .select('*');

      if (!error && Array.isArray(allSongs)) {
        // 1. Filename duplicate check (case-insensitive, trimmed, normalized)
        if (normName) {
          const filenameMatch = allSongs.find((s) => {
            if (excludeId && s.id === excludeId) return false;
            return normalizeFilename(s.original_filename) === normName;
          });

          if (filenameMatch) {
            return {
              isDuplicate: true,
              type: 'filename',
              message: 'This song already exists in your library.',
              existingSong: {
                id: filenameMatch.id,
                title: filenameMatch.title,
                artist: filenameMatch.artist || 'Unknown Artist',
                album: filenameMatch.album || '',
                original_filename: filenameMatch.original_filename,
                created_at: filenameMatch.created_at,
                is_active: filenameMatch.is_active
              }
            };
          }
        }

        // 2. Content hash duplicate check (SHA-256)
        if (hash) {
          const targetHash = hash.toLowerCase();
          const hashMatch = allSongs.find((s) => {
            if (excludeId && s.id === excludeId) return false;
            const songHash = (s.file_hash || KNOWN_EXISTING_HASHES.get(s.id) || '').toLowerCase();
            return songHash === targetHash;
          });

          if (hashMatch) {
            return {
              isDuplicate: true,
              type: 'content',
              message: `This audio content already exists in your library as "${hashMatch.title}" (${hashMatch.original_filename}).`,
              existingSong: {
                id: hashMatch.id,
                title: hashMatch.title,
                artist: hashMatch.artist || 'Unknown Artist',
                album: hashMatch.album || '',
                original_filename: hashMatch.original_filename,
                created_at: hashMatch.created_at,
                is_active: hashMatch.is_active
              }
            };
          }
        }
      }
    } catch (err) {
      console.warn('[SONG_SERVICE] checkDuplicateSong DB check notice:', err.message);
    }
  }

  // Also check memorySongs fallback
  for (const s of memorySongs.values()) {
    if (excludeId && s.id === excludeId) continue;
    if (normName && normalizeFilename(s.original_filename) === normName) {
      return {
        isDuplicate: true,
        type: 'filename',
        message: 'This song already exists in your library.',
        existingSong: s
      };
    }
    if (hash && s.file_hash && s.file_hash.toLowerCase() === hash.toLowerCase()) {
      return {
        isDuplicate: true,
        type: 'content',
        message: `This audio content already exists in your library as "${s.title}" (${s.original_filename}).`,
        existingSong: s
      };
    }
  }

  return { isDuplicate: false };
}

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
 * Enforces pre-upload duplicate checks (normalized filename and SHA-256 hash)
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

  // 2. Content Hashing & Filename Normalization
  const normName = normalizeFilename(file.originalname);
  const fileHash = calculateFileHash(file.buffer);

  // 3. Concurrency / In-Flight Race Condition Protection
  const nameLock = `name:${normName}`;
  const hashLock = `hash:${fileHash}`;

  if (inFlightUploads.has(nameLock) || inFlightUploads.has(hashLock)) {
    const error = new Error('Another upload with identical filename or audio content is currently in progress.');
    error.status = 409;
    error.conflict = true;
    error.duplicateType = inFlightUploads.has(nameLock) ? 'filename' : 'content';
    throw error;
  }

  inFlightUploads.add(nameLock);
  inFlightUploads.add(hashLock);

  try {
    // 4. Pre-upload Duplicate Checks (Never touches Storage if duplicate)
    const dupCheck = await checkDuplicateSong({ filename: file.originalname, hash: fileHash });
    if (dupCheck.isDuplicate) {
      const error = new Error(dupCheck.message);
      error.status = 409;
      error.conflict = true;
      error.duplicateType = dupCheck.type;
      error.existingSong = dupCheck.existingSong;
      throw error;
    }

    // 5. Prepare paths and identifiers
    const songId = crypto.randomUUID();
    const safeFilename = sanitizeFilename(file.originalname);
    const storagePath = `library/${songId}/${safeFilename}`;
    const mimeType = file.mimetype || 'audio/mpeg';
    const sizeBytes = file.size || file.buffer.length;

    // 6. Extract audio metadata (ID3 tags / duration)
    const extracted = await extractAudioMetadata(file.buffer, file.originalname, mimeType);

    const finalTitle = (title && title.trim()) || extracted.title || 'Untitled Track';
    const finalArtist = (artist && artist.trim()) || extracted.artist || null;
    const finalAlbum = (album && album.trim()) || extracted.album || null;
    const durationSeconds = extracted.durationSeconds || 0;
    const duration = extracted.duration || formatDuration(durationSeconds);

    // 7. Upload binary audio to Supabase Storage (private bucket)
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

    // 8. Insert metadata into public.songs
    const songRecord = {
      id: songId,
      title: finalTitle,
      artist: finalArtist,
      album: finalAlbum,
      duration_seconds: durationSeconds,
      duration,
      mime_type: mimeType,
      file_size_bytes: sizeBytes,
      file_hash: fileHash,
      storage_bucket: BUCKET_NAME,
      storage_path: storagePath,
      original_filename: file.originalname.trim(),
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
        // If error is schema cache missing file_hash column (PGRST204), retry insert without file_hash
        if (insertError.code === 'PGRST204' || (insertError.message && insertError.message.includes('file_hash'))) {
          const { file_hash, ...legacyRecord } = songRecord;
          const { data: retryData, error: retryErr } = await supabase
            .from('songs')
            .insert(legacyRecord)
            .select('*')
            .single();

          if (!retryErr) {
            KNOWN_EXISTING_HASHES.set(songId, fileHash);
            memorySongs.set(songId, retryData || songRecord);
            return retryData || songRecord;
          }
        }

        // Rollback uploaded object immediately to avoid orphaned storage files
        console.warn(`[SONG_SERVICE] Rolling back uploaded object "${storagePath}" due to DB error: ${insertError.message}`);
        await supabase.storage.from(BUCKET_NAME).remove([storagePath]);

        // Handle PostgreSQL unique-violation error (23505) safely
        if (insertError.code === '23505' || (insertError.message && insertError.message.toLowerCase().includes('unique'))) {
          const err = new Error('This song or audio content already exists in your library.');
          err.status = 409;
          err.conflict = true;
          err.duplicateType = 'content';
          throw err;
        }

        if (isTableMissingError(insertError)) {
          KNOWN_EXISTING_HASHES.set(songId, fileHash);
          memorySongs.set(songId, songRecord);
          return songRecord;
        }

        throw new Error(`Database record creation failed: ${insertError.message}`);
      }

      KNOWN_EXISTING_HASHES.set(songId, fileHash);
      memorySongs.set(songId, data || songRecord);
      return data || songRecord;
    } catch (dbErr) {
      // Ensure storage object is always cleaned up on DB failure
      await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
      throw dbErr;
    }
  } finally {
    inFlightUploads.delete(nameLock);
    inFlightUploads.delete(hashLock);
  }
}

/**
 * Bulk upload multiple audio files with limited concurrency and in-batch duplicate detection
 */
async function uploadBulkSongs({ files = [], userId = null, concurrency = 3 }) {
  if (!Array.isArray(files) || files.length === 0) {
    return {
      total: 0,
      successful: 0,
      duplicates: 0,
      duplicate_filename: 0,
      duplicate_content: 0,
      failed: 0,
      results: []
    };
  }

  const results = new Array(files.length);
  const batchFilenames = new Map(); // normName -> { index, filename }
  const batchHashes = new Map();    // hash -> { index, filename }

  // 1. Pre-process batch: validate format and detect duplicates within the same batch
  const toUpload = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const validation = validateAudioFile(file);
    if (!validation.valid) {
      results[i] = {
        filename: file.originalname,
        success: false,
        status: 'failed',
        error: validation.error
      };
      continue;
    }

    const normName = normalizeFilename(file.originalname);
    const hash = calculateFileHash(file.buffer);

    // Check duplicate filename within the same batch
    if (batchFilenames.has(normName)) {
      const prior = batchFilenames.get(normName);
      results[i] = {
        filename: file.originalname,
        success: false,
        status: 'duplicate_filename',
        duplicateType: 'filename',
        message: `Duplicate filename within batch: already included as "${prior.filename}".`,
        existing_song: {
          original_filename: prior.filename,
          title: prior.filename
        }
      };
      continue;
    }

    // Check duplicate content within the same batch (even with different filename!)
    if (batchHashes.has(hash)) {
      const prior = batchHashes.get(hash);
      results[i] = {
        filename: file.originalname,
        success: false,
        status: 'duplicate_content',
        duplicateType: 'content',
        message: `Duplicate audio content within batch: identical audio to "${prior.filename}".`,
        existing_song: {
          original_filename: prior.filename,
          title: prior.filename
        }
      };
      continue;
    }

    batchFilenames.set(normName, { index: i, filename: file.originalname });
    batchHashes.set(hash, { index: i, filename: file.originalname });

    toUpload.push({ index: i, file, normName, hash });
  }

  // 2. Upload candidates with bounded concurrency
  let currentIdx = 0;
  async function worker() {
    while (currentIdx < toUpload.length) {
      const task = toUpload[currentIdx++];
      try {
        const song = await uploadSingleSong({
          file: task.file,
          userId
        });
        results[task.index] = {
          filename: task.file.originalname,
          success: true,
          status: 'uploaded',
          song
        };
      } catch (err) {
        if (err.status === 409 || err.conflict) {
          const status = err.duplicateType === 'content' ? 'duplicate_content' : 'duplicate_filename';
          results[task.index] = {
            filename: task.file.originalname,
            success: false,
            status,
            duplicateType: err.duplicateType || 'filename',
            message: err.message,
            existing_song: err.existingSong || null
          };
        } else {
          results[task.index] = {
            filename: task.file.originalname,
            success: false,
            status: 'failed',
            error: err.message || 'Upload failed'
          };
        }
      }
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), toUpload.length || 1);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  const successful = results.filter((r) => r && r.success).length;
  const duplicate_filename = results.filter((r) => r && r.status === 'duplicate_filename').length;
  const duplicate_content = results.filter((r) => r && r.status === 'duplicate_content').length;
  const failed = results.filter((r) => r && r.status === 'failed').length;

  return {
    total: files.length,
    successful,
    duplicates: duplicate_filename + duplicate_content,
    duplicate_filename,
    duplicate_content,
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
        return data.map((t) => ({
          ...t,
          source: t.source || (t.song_id ? 'supabase' : 'general'),
          track_id: t.track_id || (t.song_id ? null : (!isNaN(Number(t.id)) ? Number(t.id) : null))
        }));
      }
    } catch {
      // Fall through to memory
    }
  }
  const cached = memoryScheduleTracks.get(String(scheduleId)) || [];
  return cached.map((t) => ({
    ...t,
    source: t.source || (t.song_id ? 'supabase' : 'general'),
    track_id: t.track_id || (t.song_id ? null : (!isNaN(Number(t.id)) ? Number(t.id) : null))
  }));
}

async function saveSchedulePlaylist(scheduleId, songs) {
  if (!Array.isArray(songs)) return [];
  const supabase = getSupabase();

  const formattedRows = songs.map((s, idx) => {
    const isSupabase = s.source === 'supabase' || Boolean(s.song_id);
    const songId = isSupabase ? (s.song_id || (s.id && isNaN(Number(s.id)) ? s.id : null)) : null;
    const trackId = !isSupabase ? (s.track_id || (!isNaN(Number(s.id)) ? Number(s.id) : null)) : null;
    const source = isSupabase ? 'supabase' : 'general';

    // Never persist temporary signed URLs or internal signed endpoints in stream_url
    let safeStreamUrl = s.stream_url || null;
    if (safeStreamUrl && (safeStreamUrl.includes('token=') || safeStreamUrl.includes('/signed-url') || isSupabase)) {
      safeStreamUrl = null;
    }

    return {
      id: s.id && s.id.length > 20 ? s.id : crypto.randomUUID(),
      schedule_id: Number(scheduleId),
      song_id: songId,
      track_id: trackId,
      source,
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
        const { error: insertErr } = await supabase.from('schedule_tracks').insert(formattedRows);
        if (insertErr && (insertErr.code === 'PGRST204' || (insertErr.message && insertErr.message.includes('schema cache')))) {
          // If source or track_id column is not in schema cache, strip them and insert core columns
          const legacyRows = formattedRows.map(({ source, track_id, ...rest }) => rest);
          await supabase.from('schedule_tracks').insert(legacyRows);
        }
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
  saveSchedulePlaylist,
  normalizeFilename,
  calculateFileHash,
  checkDuplicateSong
};

