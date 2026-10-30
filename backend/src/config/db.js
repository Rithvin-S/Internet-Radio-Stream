/**
 * PulseCast Internet Radio Streaming System
 * Database Connector & Query Adapter (src/config/db.js)
 *
 * Dedicated Supabase PostgreSQL Database Connector
 * Uses the official @supabase/supabase-js client for all database operations.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config();

const { getSupabase, isSupabaseConfigured } = require('./supabase');
const { executeSupabaseQuery } = require('./supabaseAdapter');

let isInitialized = false;

/**
 * Initialize and verify Supabase PostgreSQL connection
 */
async function initDB() {
  if (isInitialized) return 'supabase';

  const client = getSupabase();
  if (!client || !isSupabaseConfigured()) {
    throw new Error('[DB] FATAL: Supabase is not configured. SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
  }

  try {
    // Ping check: query active stations from Supabase
    const { error } = await client.from('stations').select('id').limit(1);
    if (error) {
      throw new Error(`Supabase query failed: ${error.message} (${error.code})`);
    }

    isInitialized = true;
    console.log(`[DB] Connected successfully to Supabase PostgreSQL (${process.env.SUPABASE_URL})`);
    return 'supabase';
  } catch (err) {
    console.error(`[DB] FATAL: Failed to connect to Supabase PostgreSQL: ${err.message}`);
    throw err;
  }
}

/**
 * Universal Query Executor - routes all application queries directly to Supabase
 */
async function query(sql, params = []) {
  if (!isInitialized) {
    await initDB();
  }
  return await executeSupabaseQuery(sql, params);
}

/**
 * Get DB status for /api/health
 */
function getDBStatus() {
  return {
    type: 'supabase',
    provider: 'Supabase PostgreSQL',
    isReady: isInitialized,
    mode: process.env.NODE_ENV === 'production' ? 'production (supabase)' : 'development (supabase)',
    host: 'supabase.co',
    url: process.env.SUPABASE_URL || 'https://fzusdbnznnhksvxvylzg.supabase.co',
    ssl: true
  };
}

module.exports = {
  initDB,
  query,
  getDBStatus,
  getPool: () => null, // Deprecated MySQL pool compatibility stub
  supabase: getSupabase(),
  getSupabase
};
