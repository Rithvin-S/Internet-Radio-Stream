/**
 * PulseCast Internet Radio Streaming System
 * Supabase Query Adapter (src/config/supabaseAdapter.js)
 *
 * Maps application SQL query patterns directly to the official
 * @supabase/supabase-js client, ensuring seamless backward-compatibility
 * with existing controllers, tests, and response payloads.
 */

const { getSupabase } = require('./supabase');

/**
 * Execute query via Supabase JavaScript Client
 * @param {string} sql - SQL string
 * @param {Array} params - Parameter array
 * @returns {Promise<Array|Object>} Array of rows for SELECT, or { insertId, affectedRows } for writes
 */
async function executeSupabaseQuery(sql, params = []) {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('[SUPABASE] Client is not configured. Check SUPABASE_URL and SUPABASE_SECRET_KEY.');
  }

  const raw = sql.trim();
  const normalized = raw.replace(/\s+/g, ' ');
  const upper = normalized.toUpperCase();

  // --------------------------------------------------------------------------
  // 1. Health / Ping Check
  // --------------------------------------------------------------------------
  if (upper === 'SELECT 1' || upper === 'SELECT 1 AS VAL' || upper === 'SELECT 1 FROM DUAL') {
    return [{ val: 1 }];
  }

  // --------------------------------------------------------------------------
  // 2. USERS
  // --------------------------------------------------------------------------
  if (upper.includes('FROM USERS WHERE EMAIL = ?')) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', params[0]);
    if (error) throw new Error(error.message);
    return data || [];
  }

  if (upper.includes('FROM USERS WHERE ID = ?')) {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, email, role, created_at')
      .eq('id', params[0]);
    if (error) throw new Error(error.message);
    return data || [];
  }

  if (upper.startsWith('INSERT INTO USERS')) {
    // (name, email, password_hash, role)
    const payload = {
      name: params[0],
      email: params[1],
      password_hash: params[2],
      role: params[3] || 'listener'
    };
    const { data, error } = await supabase
      .from('users')
      .insert(payload)
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return { insertId: Number(data.id), affectedRows: 1 };
  }

  // --------------------------------------------------------------------------
  // 3. STATIONS
  // --------------------------------------------------------------------------
  if (upper.startsWith('SELECT') && upper.includes('FROM STATIONS')) {
    if (upper.includes('WHERE ID = ?')) {
      const { data, error } = await supabase
        .from('stations')
        .select('*')
        .eq('id', params[0]);
      if (error) throw new Error(error.message);
      return data || [];
    }

    let query = supabase.from('stations').select('*');

    // Active filter
    if (upper.includes('IS_ACTIVE = 1') || upper.includes('IS_ACTIVE = TRUE')) {
      query = query.eq('is_active', true);
    }

    // Genre filter
    if (upper.includes('LOWER(GENRE) LIKE ?')) {
      const genreParam = params.find(p => typeof p === 'string' && p.startsWith('%') && p.endsWith('%'));
      const cleanGenre = genreParam ? genreParam.replace(/%/g, '') : '';
      if (cleanGenre) {
        query = query.ilike('genre', `%${cleanGenre}%`);
      }
    }

    // Search filter
    if (upper.includes('LOWER(NAME) LIKE ?') || upper.includes('LOWER(DESCRIPTION) LIKE ?')) {
      const searchParam = params[params.length - 1];
      const cleanSearch = searchParam ? searchParam.replace(/%/g, '') : '';
      if (cleanSearch) {
        query = query.or(`name.ilike.%${cleanSearch}%,description.ilike.%${cleanSearch}%`);
      }
    }

    query = query.order('id', { ascending: true });
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  }

  if (upper.startsWith('INSERT INTO STATIONS')) {
    // (name, description, genre, stream_url, artwork_url, is_active)
    const payload = {
      name: params[0],
      description: params[1],
      genre: params[2],
      stream_url: params[3],
      artwork_url: params[4],
      is_active: Boolean(params[5])
    };
    const { data, error } = await supabase
      .from('stations')
      .insert(payload)
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return { insertId: Number(data.id), affectedRows: 1 };
  }

  if (upper.startsWith('UPDATE STATIONS SET NAME =')) {
    // name = ?, description = ?, genre = ?, stream_url = ?, artwork_url = ?, is_active = ? WHERE id = ?
    const payload = {
      name: params[0],
      description: params[1],
      genre: params[2],
      stream_url: params[3],
      artwork_url: params[4],
      is_active: Boolean(params[5])
    };
    const id = params[6];
    const { error } = await supabase
      .from('stations')
      .update(payload)
      .eq('id', id);
    if (error) throw new Error(error.message);
    return { affectedRows: 1 };
  }

  if (upper.startsWith('UPDATE STATIONS SET IS_ACTIVE = ? WHERE ID = ?')) {
    const { error } = await supabase
      .from('stations')
      .update({ is_active: Boolean(params[0]) })
      .eq('id', params[1]);
    if (error) throw new Error(error.message);
    return { affectedRows: 1 };
  }

  if (upper.startsWith('DELETE FROM STATIONS WHERE ID = ?')) {
    const { error } = await supabase
      .from('stations')
      .delete()
      .eq('id', params[0]);
    if (error) throw new Error(error.message);
    return { affectedRows: 1 };
  }

  // --------------------------------------------------------------------------
  // 4. UPCOMING TRACKS
  // --------------------------------------------------------------------------
  if (upper.includes('FROM UPCOMING_TRACKS WHERE STATION_ID = ?') && upper.includes('ORDER BY PLAY_ORDER')) {
    const { data, error } = await supabase
      .from('upcoming_tracks')
      .select('*')
      .eq('station_id', params[0])
      .order('play_order', { ascending: true })
      .order('id', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  }

  if (upper.startsWith('SELECT') && upper.includes('FROM UPCOMING_TRACKS WHERE ID = ?')) {
    const { data, error } = await supabase
      .from('upcoming_tracks')
      .select('*')
      .eq('id', params[0]);
    if (error) throw new Error(error.message);
    return data || [];
  }

  if (upper.includes('MAX(PLAY_ORDER)') && upper.includes('FROM UPCOMING_TRACKS WHERE STATION_ID = ?')) {
    const { data, error } = await supabase
      .from('upcoming_tracks')
      .select('play_order')
      .eq('station_id', params[0])
      .order('play_order', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const maxOrder = (data && data.length > 0 && data[0].play_order != null) ? data[0].play_order : 0;
    return [{ max_order: maxOrder, maxOrder }];
  }

  if (upper.startsWith('UPDATE UPCOMING_TRACKS SET STATUS =') && upper.includes('WHERE STATION_ID = ? AND STATUS =')) {
    // Update existing playing tracks to 'played' or 'queued'
    const newStatus = upper.includes("STATUS = 'PLAYED'") ? 'played' : 'queued';
    const { error } = await supabase
      .from('upcoming_tracks')
      .update({ status: newStatus })
      .eq('station_id', params[0])
      .eq('status', 'playing');
    if (error) throw new Error(error.message);
    return { affectedRows: 1 };
  }

  if (upper.startsWith('INSERT INTO UPCOMING_TRACKS')) {
    // (station_id, title, artist, album, duration, stream_url, play_order, status)
    const payload = {
      station_id: params[0],
      title: params[1],
      artist: params[2],
      album: params[3],
      duration: params[4] || '03:45',
      stream_url: params[5],
      play_order: params[6] || 1,
      status: params[7] || 'queued'
    };
    const { data, error } = await supabase
      .from('upcoming_tracks')
      .insert(payload)
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return { insertId: Number(data.id), affectedRows: 1 };
  }

  if (upper.startsWith('UPDATE UPCOMING_TRACKS SET STATUS = ? WHERE ID = ?')) {
    const { error } = await supabase
      .from('upcoming_tracks')
      .update({ status: params[0] })
      .eq('id', params[1]);
    if (error) throw new Error(error.message);
    return { affectedRows: 1 };
  }

  if (upper.startsWith('DELETE FROM UPCOMING_TRACKS WHERE ID = ?')) {
    const { error } = await supabase
      .from('upcoming_tracks')
      .delete()
      .eq('id', params[0]);
    if (error) throw new Error(error.message);
    return { affectedRows: 1 };
  }

  // --------------------------------------------------------------------------
  // 5. PROGRAM SCHEDULES
  // --------------------------------------------------------------------------
  if (upper.includes('FROM PROGRAM_SCHEDULES WHERE STATION_ID = ?')) {
    let query = supabase.from('program_schedules').select('*').eq('station_id', params[0]);
    if (upper.includes('IS_PUBLISHED = 1') || upper.includes('IS_PUBLISHED = TRUE')) {
      query = query.eq('is_published', true);
    }
    query = query.order('start_time', { ascending: true });
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  }

  if (upper.startsWith('SELECT') && upper.includes('FROM PROGRAM_SCHEDULES WHERE ID = ?')) {
    const { data, error } = await supabase
      .from('program_schedules')
      .select('*')
      .eq('id', params[0]);
    if (error) throw new Error(error.message);
    return data || [];
  }

  if (upper.startsWith('INSERT INTO PROGRAM_SCHEDULES')) {
    // (station_id, title, description, start_time, end_time, is_published)
    const payload = {
      station_id: params[0],
      title: params[1],
      description: params[2],
      start_time: params[3],
      end_time: params[4],
      is_published: Boolean(params[5])
    };
    const { data, error } = await supabase
      .from('program_schedules')
      .insert(payload)
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return { insertId: Number(data.id), affectedRows: 1 };
  }

  if (upper.startsWith('UPDATE PROGRAM_SCHEDULES SET TITLE = ?')) {
    // title = ?, description = ?, start_time = ?, end_time = ?, is_published = ? WHERE id = ?
    const payload = {
      title: params[0],
      description: params[1],
      start_time: params[2],
      end_time: params[3],
      is_published: Boolean(params[4])
    };
    const id = params[5];
    const { error } = await supabase
      .from('program_schedules')
      .update(payload)
      .eq('id', id);
    if (error) throw new Error(error.message);
    return { affectedRows: 1 };
  }

  if (upper.startsWith('DELETE FROM PROGRAM_SCHEDULES WHERE ID = ?')) {
    const { error } = await supabase
      .from('program_schedules')
      .delete()
      .eq('id', params[0]);
    if (error) throw new Error(error.message);
    return { affectedRows: 1 };
  }

  // --------------------------------------------------------------------------
  // 6. FAVOURITES
  // --------------------------------------------------------------------------
  if (upper.includes('FROM FAVOURITES F JOIN STATIONS S') || (upper.includes('FROM FAVOURITES') && upper.includes('JOIN STATIONS'))) {
    const userId = params[0];
    const { data, error } = await supabase
      .from('favourites')
      .select('created_at, stations (*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    // Flatten to match MySQL join structure
    const flattened = (data || [])
      .filter(item => item.stations && (item.stations.is_active === true || item.stations.is_active === 1))
      .map(item => ({
        ...item.stations,
        is_active: true,
        favourited_at: item.created_at
      }));

    return flattened;
  }

  if (upper.includes('FROM FAVOURITES WHERE USER_ID = ? AND STATION_ID = ?')) {
    const { data, error } = await supabase
      .from('favourites')
      .select('*')
      .eq('user_id', params[0])
      .eq('station_id', params[1]);
    if (error) throw new Error(error.message);
    return data || [];
  }

  if (upper.startsWith('SELECT STATION_ID FROM FAVOURITES WHERE USER_ID = ?')) {
    const { data, error } = await supabase
      .from('favourites')
      .select('station_id')
      .eq('user_id', params[0]);
    if (error) throw new Error(error.message);
    return data || [];
  }

  if (upper.startsWith('INSERT INTO FAVOURITES')) {
    const { error } = await supabase
      .from('favourites')
      .insert({ user_id: params[0], station_id: params[1] });
    if (error) throw new Error(error.message);
    return { affectedRows: 1 };
  }

  if (upper.startsWith('DELETE FROM FAVOURITES WHERE USER_ID = ? AND STATION_ID = ?')) {
    const { error } = await supabase
      .from('favourites')
      .delete()
      .eq('user_id', params[0])
      .eq('station_id', params[1]);
    if (error) throw new Error(error.message);
    return { affectedRows: 1 };
  }

  // Fallback if not specifically caught
  console.warn(`[SUPABASE] Unmapped SQL pattern encountered: "${sql}"`);
  throw new Error(`Unmapped query pattern for Supabase: ${sql}`);
}

module.exports = {
  executeSupabaseQuery
};
