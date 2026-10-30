/**
 * PulseCast Internet Radio Streaming System
 * Centralized Supabase Client Configuration (src/config/supabase.js)
 *
 * Uses official @supabase/supabase-js client with the backend secret key.
 * Never expose SUPABASE_SECRET_KEY to client-side code or public variables.
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

let supabase = null;

if (supabaseUrl && supabaseSecretKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    console.log('[SUPABASE] Centralized client initialized successfully.');
  } catch (err) {
    console.error('[SUPABASE] Initialization failed:', err.message);
  }
} else {
  console.warn('[SUPABASE] Warning: SUPABASE_URL or SUPABASE_SECRET_KEY not set.');
}

/**
 * Get the Supabase client instance
 */
function getSupabase() {
  return supabase;
}

/**
 * Check if Supabase client is configured and ready
 */
function isSupabaseConfigured() {
  return Boolean(supabase);
}

module.exports = {
  supabase,
  getSupabase,
  isSupabaseConfigured
};

