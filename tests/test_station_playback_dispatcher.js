/**
 * PulseCast - Phase 2: Station-Aware Playback Dispatcher Verification Suite
 * 
 * Verifies all 20 required test criteria:
 * 1. Valid active station and schedule
 * 2. No active schedule
 * 3. Inactive station
 * 4. Unknown station
 * 5. Unpublished schedule
 * 6. Schedule before its start time
 * 7. Schedule after its end time
 * 8. Schedule crossing midnight
 * 9. Correct playlist ordering
 * 10. General Library track resolution
 * 11. Supabase Library track resolution
 * 12. Signed URL generation & fetch verification
 * 13. Expired or missing Storage objects
 * 14. Invalid streaming token (401)
 * 15. Missing streaming token (401) & Listener token (403)
 * 16. Independent station playback progression
 * 17. Repeated polling and cursor consistency (no skipping)
 * 18. Empty playlist handling (safe fallback)
 * 19. Schedule transition progression reset
 * 20. Asia/Kolkata timezone boundary cases
 */

const assert = require('assert');
const path = require('path');
const backendDir = path.join(__dirname, '../backend');
require(path.join(backendDir, 'node_modules/dotenv')).config({ path: path.join(backendDir, '.env') });
const { getSupabase } = require(path.join(backendDir, 'src/config/supabase'));
const streamingService = require(path.join(backendDir, 'src/services/streamingService'));

const BASE_URL = 'http://localhost:5000';
const STREAMING_KEY = process.env.RADIO_STREAMING_KEY || 'pulsecast_dev_radio_streaming_secret_key_92840184';

let adminToken = null;
let listenerToken = null;
const createdScheduleIds = [];

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = options.headers || {};
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  if (options.radioToken) {
    headers['x-radio-token'] = options.radioToken;
  }

  const fetchOptions = {
    method: options.method || 'GET',
    headers
  };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(options.body);
  }

  const res = await fetch(url, fetchOptions);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return {
    status: res.status,
    headers: res.headers,
    data: json
  };
}

async function runSuite() {
  console.log('======================================================================');
  console.log('  PULSECAST - STATION-AWARE PLAYBACK DISPATCHER VERIFICATION SUITE');
  console.log('  Target: ' + BASE_URL);
  console.log('======================================================================\n');

  const supabase = getSupabase();
  assert(supabase, 'Supabase client must be available.');

  try {
    // ------------------------------------------------------------------------
    // Step 0: Authenticate Admin & Listener
    // ------------------------------------------------------------------------
    console.log('[Step 0] Authenticating test accounts...');
    const adminLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@pulsecast.com', password: 'AdminPassword123!' }
    });
    assert.strictEqual(adminLogin.status, 200, 'Admin login failed');
    adminToken = adminLogin.data.token;

    const listenerLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'listener@pulsecast.com', password: 'ListenerPass123!' }
    });
    assert.strictEqual(listenerLogin.status, 200, 'Listener login failed');
    listenerToken = listenerLogin.data.token;
    console.log('  -> PASS: Admin and Listener authenticated.\n');

    // Fetch existing songs for test fixtures
    const { data: existingSongs } = await supabase.from('songs').select('id, title, artist, storage_path');
    assert(existingSongs && existingSongs.length >= 2, 'Must have at least 2 existing songs.');
    const songA = existingSongs[0];
    const songB = existingSongs[1];

    // Current Kolkata date for schedule creation
    const kolkataNow = streamingService.getKolkataDateTime();
    const todayKolkata = kolkataNow.dateStr;

    // ------------------------------------------------------------------------
    // Test 1: Valid Active Station and Schedule
    // ------------------------------------------------------------------------
    console.log('[Test 1] Valid active station and active schedule resolution...');
    // Create an all-day published schedule on Station 7 with mixed tracks
    const sched1Payload = {
      title: 'Phase 2 Station 7 Primary Schedule',
      station_id: 7,
      start_time: '00:00',
      end_time: '23:59',
      is_published: true,
      category: 'Music',
      schedule_date: todayKolkata,
      songs: [
        {
          id: songA.id,
          song_id: songA.id,
          source: 'supabase',
          title: songA.title,
          artist: songA.artist,
          duration: '03:01',
          duration_seconds: 181
        },
        {
          id: 9991,
          track_id: 9991,
          source: 'general',
          title: 'General Electronic Beat',
          artist: 'Aura',
          duration: '04:00',
          duration_seconds: 240,
          stream_url: 'https://cdn.example.com/audio/track_aura.mp3'
        }
      ]
    };

    const sched1Res = await request('/api/admin/schedules', {
      method: 'POST',
      token: adminToken,
      body: sched1Payload
    });
    assert.strictEqual(sched1Res.status, 201, 'Failed to create test schedule 1');
    const sched1Id = sched1Res.data.data.id;
    createdScheduleIds.push(sched1Id);

    const t1Res = await request('/api/streaming/stations/7/next-track', {
      radioToken: STREAMING_KEY
    });
    assert.strictEqual(t1Res.status, 200, 'Station 7 next-track query failed');
    assert.strictEqual(t1Res.data.success, true);
    assert.strictEqual(t1Res.data.has_schedule, true);
    assert.strictEqual(t1Res.data.fallback, false);
    assert.strictEqual(t1Res.data.station_id, 7);
    assert.strictEqual(t1Res.data.schedule_id, sched1Id);
    assert.strictEqual(t1Res.data.source, 'supabase');
    assert.strictEqual(t1Res.data.is_signed_url, true);
    assert.strictEqual(t1Res.data.expires_in, 300);
    assert(t1Res.data.audio_url && t1Res.data.audio_url.includes('token='), 'Must include Supabase signed token');
    console.log(`  -> PASS: Station 7 active schedule #${sched1Id} resolved track 0 (${t1Res.data.title}).\n`);

    // ------------------------------------------------------------------------
    // Test 2: No Active Schedule
    // ------------------------------------------------------------------------
    console.log('[Test 2] No active schedule fallback test...');
    // Query Station 6 (or time window when no schedule is active)
    const t2Res = await request('/api/streaming/stations/6/next-track?simulated_time=2026-10-31T04:00:00Z', {
      radioToken: STREAMING_KEY
    });
    assert.strictEqual(t2Res.status, 200);
    assert.strictEqual(t2Res.data.success, true);
    assert.strictEqual(t2Res.data.has_schedule, false);
    assert.strictEqual(t2Res.data.fallback, true);
    assert.strictEqual(t2Res.data.message, 'No active schedule');
    console.log('  -> PASS: Station with no active schedule cleanly returns fallback: true.\n');

    // ------------------------------------------------------------------------
    // Test 3: Inactive Station
    // ------------------------------------------------------------------------
    console.log('[Test 3] Inactive station rejection...');
    // Station 3 is inactive in DB
    const t3Res = await request('/api/streaming/stations/3/next-track', {
      radioToken: STREAMING_KEY
    });
    assert.strictEqual(t3Res.status, 400, 'Inactive station should return 400');
    assert.strictEqual(t3Res.data.success, false);
    assert(t3Res.data.message.toLowerCase().includes('inactive'), 'Message should indicate inactive status');
    console.log(`  -> PASS: Inactive station rejected (HTTP 400: ${t3Res.data.message}).\n`);

    // ------------------------------------------------------------------------
    // Test 4: Unknown Station
    // ------------------------------------------------------------------------
    console.log('[Test 4] Unknown station 404 test...');
    const t4Res = await request('/api/streaming/stations/99999/next-track', {
      radioToken: STREAMING_KEY
    });
    assert.strictEqual(t4Res.status, 404, 'Unknown station should return 404');
    assert.strictEqual(t4Res.data.success, false);
    assert(t4Res.data.message.includes('not found'), 'Message should indicate station not found');
    console.log('  -> PASS: Unknown station rejected with HTTP 404.\n');

    // ------------------------------------------------------------------------
    // Test 5: Unpublished Schedule
    // ------------------------------------------------------------------------
    console.log('[Test 5] Unpublished schedule exclusion test...');
    const schedUnpublished = await request('/api/admin/schedules', {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Draft Unpublished Schedule',
        station_id: 7,
        start_time: '00:00',
        end_time: '23:59',
        is_published: false,
        schedule_date: '2026-11-15',
        songs: [{ id: songA.id, song_id: songA.id, source: 'supabase', title: songA.title }]
      }
    });
    const unpubId = schedUnpublished.data.data.id;
    createdScheduleIds.push(unpubId);

    const t5Res = await request(`/api/streaming/stations/7/next-track?simulated_time=${encodeURIComponent('2026-11-15T12:00:00+05:30')}`, {
      radioToken: STREAMING_KEY
    });
    assert.strictEqual(t5Res.status, 200);
    // Should NOT pick the unpublished schedule
    assert.strictEqual(t5Res.data.has_schedule, false);
    assert.strictEqual(t5Res.data.fallback, true);
    console.log('  -> PASS: Unpublished schedule safely ignored by dispatcher.\n');

    // ------------------------------------------------------------------------
    // Test 6: Schedule Before Its Start Time
    // ------------------------------------------------------------------------
    console.log('[Test 6] Schedule query before start time...');
    const schedTimeBound = await request('/api/admin/schedules', {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Afternoon Window 14:00-16:00',
        station_id: 7,
        start_time: '14:00',
        end_time: '16:00',
        is_published: true,
        schedule_date: '2026-11-20',
        songs: [{ id: songA.id, song_id: songA.id, source: 'supabase', title: songA.title }]
      }
    });
    const timeBoundId = schedTimeBound.data.data.id;
    createdScheduleIds.push(timeBoundId);

    // Query at 13:30 (before start)
    const t6Res = await request(`/api/streaming/stations/7/next-track?simulated_time=${encodeURIComponent('2026-11-20T13:30:00+05:30')}`, {
      radioToken: STREAMING_KEY
    });
    assert.strictEqual(t6Res.status, 200);
    assert.strictEqual(t6Res.data.has_schedule, false);
    assert.strictEqual(t6Res.data.fallback, true);
    console.log('  -> PASS: Query before schedule start time returns fallback: true.\n');

    // ------------------------------------------------------------------------
    // Test 7: Schedule After Its End Time
    // ------------------------------------------------------------------------
    console.log('[Test 7] Schedule query after end time...');
    // Query at 16:30 (after end)
    const t7Res = await request(`/api/streaming/stations/7/next-track?simulated_time=${encodeURIComponent('2026-11-20T16:30:00+05:30')}`, {
      radioToken: STREAMING_KEY
    });
    assert.strictEqual(t7Res.status, 200);
    assert.strictEqual(t7Res.data.has_schedule, false);
    assert.strictEqual(t7Res.data.fallback, true);
    console.log('  -> PASS: Query after schedule end time returns fallback: true.\n');

    // ------------------------------------------------------------------------
    // Test 8: Schedule Crossing Midnight
    // ------------------------------------------------------------------------
    console.log('[Test 8] Schedule crossing midnight evaluation (22:00 to 02:00)...');
    const schedMidnight = await request('/api/admin/schedules', {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Midnight Crossing Show',
        station_id: 7,
        start_time: '22:00',
        end_time: '02:00',
        is_published: true,
        schedule_date: '2026-11-25',
        songs: [{ id: songA.id, song_id: songA.id, source: 'supabase', title: 'Late Night Anthem' }]
      }
    });
    const midId = schedMidnight.data.data.id;
    createdScheduleIds.push(midId);

    // Case 8A: 2026-11-25 at 23:15 IST (Night of start date) -> Active
    const t8aRes = await request(`/api/streaming/stations/7/next-track?simulated_time=${encodeURIComponent('2026-11-25T23:15:00+05:30')}`, {
      radioToken: STREAMING_KEY
    });
    assert.strictEqual(t8aRes.status, 200);
    assert.strictEqual(t8aRes.data.has_schedule, true);
    assert.strictEqual(t8aRes.data.schedule_id, midId);

    // Case 8B: 2026-11-26 at 01:15 IST (Early morning next day) -> Still Active
    const t8bRes = await request(`/api/streaming/stations/7/next-track?simulated_time=${encodeURIComponent('2026-11-26T01:15:00+05:30')}`, {
      radioToken: STREAMING_KEY
    });
    assert.strictEqual(t8bRes.status, 200);
    assert.strictEqual(t8bRes.data.has_schedule, true);
    assert.strictEqual(t8bRes.data.schedule_id, midId);

    // Case 8C: 2026-11-26 at 02:30 IST (Past end time) -> Inactive
    const t8cRes = await request(`/api/streaming/stations/7/next-track?simulated_time=${encodeURIComponent('2026-11-26T02:30:00+05:30')}`, {
      radioToken: STREAMING_KEY
    });
    assert.strictEqual(t8cRes.status, 200);
    assert.strictEqual(t8cRes.data.has_schedule, false);
    assert.strictEqual(t8cRes.data.fallback, true);
    console.log('  -> PASS: Midnight crossing evaluated accurately on both legs.\n');

    // ------------------------------------------------------------------------
    // Test 9: Correct Playlist Ordering
    // ------------------------------------------------------------------------
    console.log('[Test 9] Playlist ordering verification (index 0 and index 1)...');
    const t9Track0 = await request('/api/streaming/stations/7/next-track?index=0', {
      radioToken: STREAMING_KEY
    });
    assert.strictEqual(t9Track0.status, 200);
    assert.strictEqual(t9Track0.data.play_order, 1);
    assert.strictEqual(t9Track0.data.index, 0);

    const t9Track1 = await request('/api/streaming/stations/7/next-track?index=1', {
      radioToken: STREAMING_KEY
    });
    assert.strictEqual(t9Track1.status, 200);
    assert.strictEqual(t9Track1.data.play_order, 2);
    assert.strictEqual(t9Track1.data.index, 1);
    console.log('  -> PASS: Play order 1 and 2 returned in strict playlist sequence.\n');

    // ------------------------------------------------------------------------
    // Test 10: General Library Track Resolution
    // ------------------------------------------------------------------------
    console.log('[Test 10] General Library track resolution...');
    assert.strictEqual(t9Track1.data.source, 'general');
    assert.strictEqual(t9Track1.data.is_signed_url, false);
    assert.strictEqual(t9Track1.data.expires_in, null);
    assert.strictEqual(t9Track1.data.audio_url, 'https://cdn.example.com/audio/track_aura.mp3');
    console.log('  -> PASS: General track resolved with direct audio URL and is_signed_url: false.\n');

    // ------------------------------------------------------------------------
    // Test 11: Supabase Library Track Resolution
    // ------------------------------------------------------------------------
    console.log('[Test 11] Supabase Library track resolution...');
    assert.strictEqual(t9Track0.data.source, 'supabase');
    assert.strictEqual(t9Track0.data.is_signed_url, true);
    assert.strictEqual(t9Track0.data.expires_in, 300);
    assert(t9Track0.data.audio_url.includes('pulsecast-music-library'), 'Must point to private bucket');
    console.log('  -> PASS: Supabase track resolved with is_signed_url: true and 300s expiration.\n');

    // ------------------------------------------------------------------------
    // Test 12: Signed URL Generation & Fetch
    // ------------------------------------------------------------------------
    console.log('[Test 12] Fetching generated Supabase signed URL...');
    const signedFetch = await fetch(t9Track0.data.audio_url);
    assert.strictEqual(signedFetch.status, 200, 'Signed URL audio fetch must return 200 OK');
    const contentType = signedFetch.headers.get('content-type');
    assert(contentType && contentType.includes('audio'), `Expected audio content-type, got: ${contentType}`);
    console.log(`  -> PASS: Signed URL verified readable with HTTP 200 OK (${contentType}).\n`);

    // ------------------------------------------------------------------------
    // Test 13: Expired or Missing Storage Object Handling
    // ------------------------------------------------------------------------
    console.log('[Test 13] Graceful handling of missing Storage object...');
    const schedMissingStorage = await request('/api/admin/schedules', {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Missing Storage Track Schedule',
        station_id: 7,
        start_time: '00:00',
        end_time: '23:59',
        is_published: true,
        schedule_date: '2026-11-28',
        songs: [
          {
            id: '00000000-0000-0000-0000-000000000000',
            song_id: '00000000-0000-0000-0000-000000000000',
            source: 'supabase',
            title: 'Ghost Audio File'
          }
        ]
      }
    });
    const missingSchedId = schedMissingStorage.data.data.id;
    createdScheduleIds.push(missingSchedId);

    const t13Res = await request(`/api/streaming/stations/7/next-track?simulated_time=${encodeURIComponent('2026-11-28T10:00:00+05:30')}`, {
      radioToken: STREAMING_KEY
    });
    assert.strictEqual(t13Res.status, 200);
    assert.strictEqual(t13Res.data.has_schedule, true);
    assert.strictEqual(t13Res.data.audio_url, null);
    assert(t13Res.data.error, 'Should capture storage resolution notice');
    console.log('  -> PASS: Missing audio handled safely without crashing (audio_url: null, error captured).\n');

    // ------------------------------------------------------------------------
    // Test 14: Invalid Streaming Token
    // ------------------------------------------------------------------------
    console.log('[Test 14] Invalid streaming token rejection (401)...');
    const t14Res = await request('/api/streaming/stations/7/next-track', {
      radioToken: 'wrong_streaming_token_abc123'
    });
    assert.strictEqual(t14Res.status, 401);
    assert.strictEqual(t14Res.data.success, false);
    assert(t14Res.data.message.includes('Invalid radio streaming token'));
    console.log('  -> PASS: Invalid radio token correctly rejected with 401 Unauthorized.\n');

    // ------------------------------------------------------------------------
    // Test 15: Missing Streaming Token & Listener JWT Rejection
    // ------------------------------------------------------------------------
    console.log('[Test 15] Missing token and Listener token rejection...');
    // Anonymous call (no token)
    const t15Anon = await request('/api/streaming/stations/7/next-track');
    assert.strictEqual(t15Anon.status, 401);

    // Listener JWT call
    const t15Listener = await request('/api/streaming/stations/7/next-track', {
      token: listenerToken
    });
    assert.strictEqual(t15Listener.status, 403, 'Listener role should be rejected with 403');
    console.log('  -> PASS: Anonymous rejected with 401; Listener rejected with 403 Forbidden.\n');

    // ------------------------------------------------------------------------
    // Test 16: Independent Station Playback Progression
    // ------------------------------------------------------------------------
    console.log('[Test 16] Independent station playback progression...');
    // Initialize Station 7 at index 0
    const st7Init = await request('/api/streaming/stations/7/next-track?index=0', { radioToken: STREAMING_KEY });
    assert.strictEqual(st7Init.data.index, 0);

    // Advance station 7
    const st7Adv = await request('/api/streaming/stations/7/next-track?advance=true', { radioToken: STREAMING_KEY });
    assert.strictEqual(st7Adv.data.index, 1);

    // Create a schedule on Station 6 for today to test independent state
    const schedSt6 = await request('/api/admin/schedules', {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Station 6 Independent Schedule',
        station_id: 6,
        start_time: '00:00',
        end_time: '23:59',
        is_published: true,
        schedule_date: todayKolkata,
        songs: [
          { id: songB.id, song_id: songB.id, source: 'supabase', title: songB.title },
          { id: songA.id, song_id: songA.id, source: 'supabase', title: songA.title }
        ]
      }
    });
    const st6SchedId = schedSt6.data.data.id;
    createdScheduleIds.push(st6SchedId);

    // Query station 6: should be at index 0 independently
    const st6Res = await request('/api/streaming/stations/6/next-track', { radioToken: STREAMING_KEY });
    assert.strictEqual(st6Res.data.station_id, 6);
    assert.strictEqual(st6Res.data.index, 0, 'Station 6 index must remain 0 while Station 7 is at index 1');

    // Query station 7: should still be at index 1
    const st7Check = await request('/api/streaming/stations/7/next-track', { radioToken: STREAMING_KEY });
    assert.strictEqual(st7Check.data.index, 1, 'Station 7 index must remain 1');
    console.log('  -> PASS: Station 7 at index 1 while Station 6 index operates independently at index 0.\n');

    // ------------------------------------------------------------------------
    // Test 17: Repeated Polling and Cursor Consistency (No skipping)
    // ------------------------------------------------------------------------
    console.log('[Test 17] Repeated polling cursor consistency (no accidental skipping)...');
    // Calling 3 times without advance should return the exact same track index
    const poll1 = await request('/api/streaming/stations/7/next-track', { radioToken: STREAMING_KEY });
    const poll2 = await request('/api/streaming/stations/7/next-track', { radioToken: STREAMING_KEY });
    const poll3 = await request('/api/streaming/stations/7/next-track', { radioToken: STREAMING_KEY });

    assert.strictEqual(poll1.data.index, poll2.data.index);
    assert.strictEqual(poll2.data.index, poll3.data.index);
    assert.strictEqual(poll1.data.track_id, poll3.data.track_id);
    console.log(`  -> PASS: 3 consecutive polls returned identical track (index ${poll1.data.index}). No skipping.\n`);

    // ------------------------------------------------------------------------
    // Test 18: Empty Playlist Handling
    // ------------------------------------------------------------------------
    console.log('[Test 18] Empty playlist safe fallback...');
    const schedEmpty = await request('/api/admin/schedules', {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Empty Playlist Schedule',
        station_id: 7,
        start_time: '00:00',
        end_time: '23:59',
        is_published: true,
        schedule_date: '2026-11-30',
        songs: []
      }
    });
    const emptySchedId = schedEmpty.data.data.id;
    createdScheduleIds.push(emptySchedId);

    const t18Res = await request(`/api/streaming/stations/7/next-track?simulated_time=${encodeURIComponent('2026-11-30T15:00:00+05:30')}`, {
      radioToken: STREAMING_KEY
    });
    assert.strictEqual(t18Res.status, 200);
    assert.strictEqual(t18Res.data.has_schedule, true);
    assert.strictEqual(t18Res.data.fallback, true);
    assert.strictEqual(t18Res.data.total_tracks, 0);
    assert(t18Res.data.message.includes('no assigned tracks'));
    console.log('  -> PASS: Empty playlist returns fallback: true with total_tracks: 0.\n');

    // ------------------------------------------------------------------------
    // Test 19: Schedule Transition Progression Reset
    // ------------------------------------------------------------------------
    console.log('[Test 19] Progression reset on schedule transition...');
    // Advance Station 7 to index 1 on today's schedule
    const resAdvance = await request('/api/streaming/stations/7/next-track?index=1', { radioToken: STREAMING_KEY });
    assert.strictEqual(resAdvance.data.index, 1);

    // Create another schedule at a different time
    const schedNextShow = await request('/api/admin/schedules', {
      method: 'POST',
      token: adminToken,
      body: {
        title: 'Next Show After Transition',
        station_id: 7,
        start_time: '18:00',
        end_time: '20:00',
        is_published: true,
        schedule_date: '2026-12-05',
        songs: [
          { id: songB.id, song_id: songB.id, source: 'supabase', title: songB.title },
          { id: songA.id, song_id: songA.id, source: 'supabase', title: songA.title }
        ]
      }
    });
    const nextShowId = schedNextShow.data.data.id;
    createdScheduleIds.push(nextShowId);

    // Simulate transition to the new schedule
    const t19Res = await request(`/api/streaming/stations/7/next-track?simulated_time=${encodeURIComponent('2026-12-05T18:30:00+05:30')}`, {
      radioToken: STREAMING_KEY
    });
    assert.strictEqual(t19Res.status, 200);
    assert.strictEqual(t19Res.data.schedule_id, nextShowId);
    assert.strictEqual(t19Res.data.index, 0, 'New schedule must reset playback index to 0');
    assert.strictEqual(t19Res.data.title, songB.title);
    console.log('  -> PASS: New schedule automatically reset playback progression to index 0.\n');

    // ------------------------------------------------------------------------
    // Test 20: Asia/Kolkata Timezone Boundary Cases
    // ------------------------------------------------------------------------
    console.log('[Test 20] Asia/Kolkata timezone boundary verification...');
    // When UTC is 2026-10-31 18:30:00Z:
    // IST (+5:30) is 2026-11-01 00:00:00 (Midnight, next day)
    const utcDate = new Date('2026-10-31T18:30:00Z');
    const kolkataBreakdown = streamingService.getKolkataDateTime(utcDate);
    assert.strictEqual(kolkataBreakdown.dateStr, '2026-11-01', 'UTC 18:30 must be next calendar date in Kolkata');
    assert.strictEqual(kolkataBreakdown.timeStr, '00:00', 'UTC 18:30 must be 00:00 IST midnight');
    assert.strictEqual(kolkataBreakdown.timeMinutes, 0);

    // When UTC is 2026-10-31 18:29:59Z:
    // IST is 2026-10-31 23:59:59 (Same day)
    const prevUtc = new Date('2026-10-31T18:29:59Z');
    const prevBreakdown = streamingService.getKolkataDateTime(prevUtc);
    assert.strictEqual(prevBreakdown.dateStr, '2026-10-31');
    assert.strictEqual(prevBreakdown.timeStr, '23:59');
    console.log('  -> PASS: Exact UTC 18:30:00 boundary verified as Kolkata 00:00:00 next day.\n');

    console.log('======================================================================');
    console.log('  ALL 20 AUTOMATED TEST SCENARIOS PASSED WITH 100% SUCCESS!');
    console.log('======================================================================\n');
  } finally {
    // Clean up created schedule fixtures from database
    console.log(`[CLEANUP] Cleaning up ${createdScheduleIds.length} test schedule fixtures...`);
    for (const sid of createdScheduleIds) {
      try {
        await request(`/api/admin/schedules/${sid}`, {
          method: 'DELETE',
          token: adminToken
        });
      } catch (err) {
        console.warn(`  Cleanup notice for schedule #${sid}: ${err.message}`);
      }
    }
    console.log('[CLEANUP] Test fixtures successfully cleaned up.\n');
  }
}

runSuite().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
