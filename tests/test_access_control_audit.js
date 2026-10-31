/**
 * PulseCast - Song Library & Scheduling Access Control Verification Suite
 * (tests/test_access_control_audit.js)
 *
 * Verifies the complete matrix of access-control requirements:
 * 1. Unauthenticated requests are rejected with HTTP 401 across all admin & streaming endpoints.
 * 2. Authenticated non-admin (listener) requests are rejected with HTTP 403 across all admin & streaming endpoints.
 * 3. Administrator requests are authorized for all song library, scheduling, and streaming operations.
 * 4. Radio playback daemon can access streaming endpoints with valid x-radio-token.
 * 5. Public listener endpoints (stations, published schedules, stream queue) remain operational and NEVER expose private storage paths or signed URLs.
 * 6. Schedule playlist persistence guarantees no temporary signed URLs are stored in stream_url.
 */

const assert = require('assert');
const app = require('../backend/src/app');

// Minimal valid MP3 buffer for tests
function createDummyMp3Buffer(title = 'Audit Track') {
  const header = Buffer.from([
    0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20,
    0x54, 0x49, 0x54, 0x32, 0x00, 0x00, 0x00, 0x0e, 0x00, 0x00, 0x00,
    ...Buffer.from(title),
    0xff, 0xfb, 0x90, 0x64
  ]);
  const padding = Buffer.alloc(1024, 0x55);
  return Buffer.concat([header, padding]);
}

let server;
let baseUrl;
let adminToken;
let listenerToken;

async function request(endpoint, options = {}) {
  const url = `${baseUrl}${endpoint}`;
  const headers = options.headers || {};
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const fetchOptions = {
    method: options.method || 'GET',
    headers
  };

  if (options.body) {
    if (options.isFormData) {
      fetchOptions.body = options.body;
    } else {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(options.body);
    }
  }

  const res = await fetch(url, fetchOptions);
  let json = null;
  const text = await res.text();
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

async function runAudit() {
  console.log('================================================================');
  console.log('   PULSECAST ACCESS-CONTROL & SONG LIBRARY AUDIT SUITE');
  console.log('================================================================\n');

  // Start server on an ephemeral port
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      console.log(`[TEST HARNESS] Ephemeral server listening on port ${port}`);
      resolve();
    });
  });

  try {
    // ------------------------------------------------------------------------
    // Step 1: Establish Sessions
    // ------------------------------------------------------------------------
    console.log('[Step 1] Authenticating Admin & Listener users...');
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
    console.log('  -> PASS: Admin and Listener authenticated successfully.\n');

    // ------------------------------------------------------------------------
    // Step 2: Unauthenticated User Security Verification (Must be 401)
    // ------------------------------------------------------------------------
    console.log('[Step 2] Testing unauthenticated user access (Expect HTTP 401 across all endpoints)...');
    const endpointsToTest = [
      { method: 'GET', path: '/api/admin/songs', desc: 'Browse song library' },
      { method: 'GET', path: '/api/admin/songs/search?q=test', desc: 'Search song library' },
      { method: 'POST', path: '/api/admin/songs', desc: 'Upload individual song' },
      { method: 'POST', path: '/api/admin/songs/bulk', desc: 'Bulk upload songs' },
      { method: 'PATCH', path: '/api/admin/songs/dummy-id', desc: 'Edit song metadata' },
      { method: 'DELETE', path: '/api/admin/songs/dummy-id', desc: 'Archive/delete song' },
      { method: 'POST', path: '/api/admin/songs/dummy-id/signed-url', desc: 'Generate signed URL' },
      { method: 'POST', path: '/api/admin/schedules', desc: 'Create schedule' },
      { method: 'PUT', path: '/api/admin/schedules/1', desc: 'Edit schedule' },
      { method: 'DELETE', path: '/api/admin/schedules/1', desc: 'Delete schedule' },
      { method: 'POST', path: '/api/admin/schedules/1/tracks', desc: 'Assign songs to schedule' },
      { method: 'DELETE', path: '/api/admin/schedules/1/tracks/1', desc: 'Remove track from schedule' },
      { method: 'GET', path: '/api/streaming/schedule/1/next-track', desc: 'Streaming next-track signed URL' }
    ];

    for (const ep of endpointsToTest) {
      const res = await request(ep.path, { method: ep.method });
      assert.strictEqual(res.status, 401, `Expected 401 for unauthenticated ${ep.method} ${ep.path}, got ${res.status}`);
      console.log(`  -> PASS [401]: ${ep.desc} (${ep.method} ${ep.path})`);
    }

    // ------------------------------------------------------------------------
    // Step 3: Authenticated Listener User Security Verification (Must be 403)
    // ------------------------------------------------------------------------
    console.log('\n[Step 3] Testing listener user access (Expect HTTP 403 Forbidden across all endpoints)...');
    for (const ep of endpointsToTest) {
      const res = await request(ep.path, { method: ep.method, token: listenerToken });
      assert.strictEqual(res.status, 403, `Expected 403 for listener ${ep.method} ${ep.path}, got ${res.status}`);
      console.log(`  -> PASS [403]: ${ep.desc} (${ep.method} ${ep.path})`);
    }

    // ------------------------------------------------------------------------
    // Step 4: Full Administrator Lifecycle & Stream URL Persistence Check
    // ------------------------------------------------------------------------
    console.log('\n[Step 4] Testing administrator workflow and verifying no signed URLs are persisted in DB...');

    // 4a. Upload audio file as Admin
    const form = new FormData();
    const blob = new Blob([createDummyMp3Buffer('Audit Song Title')], { type: 'audio/mpeg' });
    form.append('file', blob, 'audit_track.mp3');
    form.append('title', 'Audit Song Title');
    form.append('artist', 'Audit DJ');
    form.append('album', 'Security Album');

    const uploadRes = await request('/api/admin/songs', {
      method: 'POST',
      token: adminToken,
      body: form,
      isFormData: true
    });
    assert.strictEqual(uploadRes.status, 201, `Upload failed: ${JSON.stringify(uploadRes.data)}`);
    const songId = uploadRes.data.data.id;
    console.log(`  -> PASS: Admin uploaded song successfully. ID: ${songId}`);

    // 4b. Generate temporary signed URL
    const signedRes = await request(`/api/admin/songs/${songId}/signed-url?expiresIn=300`, {
      method: 'POST',
      token: adminToken
    });
    assert.strictEqual(signedRes.status, 200);
    const tempSignedUrl = signedRes.data.data.signedUrl;
    assert(tempSignedUrl.includes('token='), 'Signed URL must contain temporary token');
    console.log('  -> PASS: Admin generated temporary signed URL.');

    // 4c. Assign track to schedule 1
    // Deliberately provide a signed URL in stream_url to test database sanitizer!
    const assignRes = await request('/api/admin/schedules/1/tracks', {
      method: 'POST',
      token: adminToken,
      body: {
        tracks: [
          {
            song_id: songId,
            title: 'Audit Song Title',
            artist: 'Audit DJ',
            duration: '03:45',
            stream_url: tempSignedUrl // Must be sanitized to NULL!
          }
        ]
      }
    });
    assert.strictEqual(assignRes.status, 200);

    // 4d. Retrieve saved schedule playlist and verify stream_url was sanitized to NULL!
    const getPlaylist = await request('/api/admin/schedules/1/tracks', { token: adminToken });
    assert.strictEqual(getPlaylist.status, 200);
    const savedTrack = getPlaylist.data.data.find((t) => t.song_id === songId);
    assert(savedTrack, 'Track must be present in saved playlist');
    assert.strictEqual(savedTrack.stream_url, null, 'Temporary signed URL must NEVER be persisted in stream_url');
    console.log('  -> PASS: Verified temporary signed URL was automatically sanitized and NOT persisted in DB.');

    // ------------------------------------------------------------------------
    // Step 5: Radio Daemon Streaming Secret Token Verification
    // ------------------------------------------------------------------------
    console.log('\n[Step 5] Testing radio playback daemon authentication for streaming bridge...');
    // 5a. With invalid radio token
    const invalidDaemon = await request('/api/streaming/schedule/1/next-track', {
      headers: { 'x-radio-token': 'wrong_invalid_secret' }
    });
    assert.strictEqual(invalidDaemon.status, 401, 'Invalid radio token must be rejected with 401');

    // 5b. With valid radio token
    const validDaemon = await request('/api/streaming/schedule/1/next-track', {
      headers: { 'x-radio-token': 'pulsecast_streaming_secure_token_key' }
    });
    assert.strictEqual(validDaemon.status, 200, 'Valid radio token must be allowed');
    assert(validDaemon.data.audio_url, 'Audio URL must be provided to radio daemon');
    console.log('  -> PASS: Radio daemon authenticated via x-radio-token successfully.');

    // 5c. With Admin JWT
    const adminDaemon = await request('/api/streaming/schedule/1/next-track', {
      token: adminToken
    });
    assert.strictEqual(adminDaemon.status, 200, 'Admin JWT must be allowed for streaming');
    console.log('  -> PASS: Admin user authenticated for streaming bridge successfully.');

    // ------------------------------------------------------------------------
    // Step 6: Public API Security & Data Leak Check
    // ------------------------------------------------------------------------
    console.log('\n[Step 6] Auditing public listener-facing endpoints for accidental data exposure...');

    // 6a. Public stations list
    const stationsRes = await request('/api/stations');
    assert.strictEqual(stationsRes.status, 200);
    assert(Array.isArray(stationsRes.data.data), 'Stations data array expected');
    for (const st of stationsRes.data.data) {
      assert.strictEqual(st.storage_path, undefined, 'Public station must not expose storage_path');
      assert.strictEqual(st.storage_bucket, undefined, 'Public station must not expose storage_bucket');
    }
    console.log('  -> PASS: Public station listing (/api/stations) verified clean.');

    // 6b. Public schedules for station
    const schedRes = await request('/api/stations/1/schedules');
    assert.strictEqual(schedRes.status, 200);
    assert(Array.isArray(schedRes.data.data), 'Schedules data array expected');
    for (const sc of schedRes.data.data) {
      assert.strictEqual(sc.songs, undefined, 'Public schedule must not expose song library records');
      assert.strictEqual(sc.storage_path, undefined, 'Public schedule must not expose storage_path');
      assert.strictEqual(sc.storage_bucket, undefined, 'Public schedule must not expose storage_bucket');
      if (sc.description) {
        assert(!sc.description.includes('token='), 'Public schedule description must not expose signed tokens');
        assert(!sc.description.includes('pulsecast-music-library'), 'Public schedule description must not expose private bucket name');
      }
    }
    console.log('  -> PASS: Public schedule listing (/api/stations/1/schedules) verified clean of private metadata.');

    // 6c. Public track queue
    const tracksRes = await request('/api/stations/1/tracks');
    assert.strictEqual(tracksRes.status, 200);
    for (const tr of tracksRes.data.all_tracks || []) {
      assert.strictEqual(tr.storage_path, undefined, 'Public track queue must not expose storage_path');
      if (tr.stream_url) {
        assert(!tr.stream_url.includes('token='), 'Public track stream_url must not expose signed token');
      }
    }
    console.log('  -> PASS: Public station track queue (/api/stations/1/tracks) verified clean.');

    // ------------------------------------------------------------------------
    // Step 7: Deletion Conflict & Cleanup Verification
    // ------------------------------------------------------------------------
    console.log('\n[Step 7] Testing deletion conflict protection and unassignment...');
    // 7a. Verify deletion conflict protection (409)
    const delConflict = await request(`/api/admin/songs/${songId}?permanent=true`, {
      method: 'DELETE',
      token: adminToken
    });
    assert.strictEqual(delConflict.status, 409, 'Expected 409 Conflict when deleting referenced song');
    console.log('  -> PASS: Deleting song referenced by schedule correctly blocked with 409 Conflict.');

    // 7b. Remove track from schedule
    const removeRes = await request(`/api/admin/schedules/1/tracks/${songId}`, {
      method: 'DELETE',
      token: adminToken
    });
    assert.strictEqual(removeRes.status, 200);

    // 7c. Permanent delete now succeeds
    const finalDel = await request(`/api/admin/songs/${songId}?permanent=true`, {
      method: 'DELETE',
      token: adminToken
    });
    assert.strictEqual(finalDel.status, 200);
    console.log('  -> PASS: Song unassigned and permanently removed from library and storage.');

    console.log('\n================================================================');
    console.log('   >>> ALL AUDIT & ACCESS-CONTROL VERIFICATIONS PASSED 100%! <<<');
    console.log('================================================================');
    if (server) server.close();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Audit Failure:', err);
    if (server) server.close();
    process.exit(1);
  }
}

runAudit();
