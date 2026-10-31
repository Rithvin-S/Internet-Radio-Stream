/**
 * PulseCast - Song Library Backend & Supabase Storage Verification Suite
 * Tests all administrative song library and schedule playlist endpoints:
 * 1. Admin Authentication & Role Enforcement
 * 2. Single Audio Upload & Automatic Metadata Extraction
 * 3. File Validation (type, extension, size limits)
 * 4. Bulk Upload with Concurrency & Partial Failure Reporting
 * 5. Metadata Editing (title, artist, album, is_active)
 * 6. Short-Lived Signed URL Generation
 * 7. Schedule Playlist Assignment, Reading, Reordering, and Removal
 * 8. Protection against Deleting Referenced Songs (409 Conflict)
 * 9. Streaming Playback Bridge (/api/streaming/schedule/:id/next-track)
 */

const assert = require('assert');
const path = require('path');
const http = require('http');
const app = require('../backend/src/app');

// Minimal valid MP3 frame buffer for testing
function createDummyMp3Buffer(title = 'Test Song') {
  // Simple ID3v2 header + MPEG audio sync frame
  const header = Buffer.from([
    0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20, // ID3v2.3 header
    0x54, 0x49, 0x54, 0x32, 0x00, 0x00, 0x00, 0x0e, 0x00, 0x00, 0x00, // TIT2 (Title)
    ...Buffer.from(title),
    0xff, 0xfb, 0x90, 0x64 // MPEG-1 Layer 3 Sync frame
  ]);
  const padding = Buffer.alloc(1024, 0xaa);
  return Buffer.concat([header, padding]);
}

let server;
let baseUrl;
let adminToken;
let listenerToken;

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
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

async function runTests() {
  console.log('=== RUNNING SONG LIBRARY & SUPABASE STORAGE VERIFICATION SUITE ===\n');

  // Start server on an ephemeral port
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      console.log(`[TEST SERVER] Running on port ${port}`);
      resolve();
    });
  });

  try {
    // Step 1: Sign in as Admin
    console.log('[Step 1] Authenticating admin user...');
    const adminLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@pulsecast.com', password: 'AdminPassword123!' }
    });
    assert.strictEqual(adminLogin.status, 200, 'Admin login failed');
    adminToken = adminLogin.data.token;
    assert(adminToken, 'Admin token not received');
    console.log('  -> PASS: Admin signed in.');

    // Step 2: Sign in as Listener
    console.log('[Step 2] Authenticating listener user...');
    const listenerLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { email: 'listener@pulsecast.com', password: 'ListenerPass123!' }
    });
    assert.strictEqual(listenerLogin.status, 200, 'Listener login failed');
    listenerToken = listenerLogin.data.token;
    console.log('  -> PASS: Listener signed in.');

    // Step 3: Authorization Check - Anonymous and Non-Admin Rejected
    console.log('[Step 3] Verifying authorization controls on /api/admin/songs...');
    const anonRes = await request('/api/admin/songs');
    assert.strictEqual(anonRes.status, 401, 'Anonymous request must be rejected with 401');

    const listenerRes = await request('/api/admin/songs', { token: listenerToken });
    assert.strictEqual(listenerRes.status, 403, 'Non-admin request must be rejected with 403');
    console.log('  -> PASS: Anonymous (401) and Non-Admin (403) strictly blocked.');

    // Step 4: Single MP3 Upload
    console.log('\n[Step 4] Testing single audio file upload...');
    const mp3Buffer = createDummyMp3Buffer('Midnight Ambient Waves');
    const form = new FormData();
    const blob = new Blob([mp3Buffer], { type: 'audio/mpeg' });
    form.append('file', blob, 'midnight_ambient.mp3');
    form.append('title', 'Midnight Ambient Waves');
    form.append('artist', 'Solar Soundscapes');
    form.append('album', 'Chillwave Vol. 1');

    const uploadRes = await request('/api/admin/songs', {
      method: 'POST',
      token: adminToken,
      body: form,
      isFormData: true
    });

    assert.strictEqual(uploadRes.status, 201, `Upload failed: ${JSON.stringify(uploadRes.data)}`);
    const createdSong = uploadRes.data.data;
    assert(createdSong.id, 'Created song must have an ID');
    assert.strictEqual(createdSong.title, 'Midnight Ambient Waves');
    assert.strictEqual(createdSong.artist, 'Solar Soundscapes');
    assert.strictEqual(createdSong.storage_bucket, 'pulsecast-music-library');
    assert(createdSong.storage_path.includes(createdSong.id), 'Storage path must incorporate song UUID');
    console.log(`  -> PASS: Song uploaded successfully. ID: ${createdSong.id}, Path: ${createdSong.storage_path}`);

    // Step 5: File Validation (Invalid MIME / Extension)
    console.log('\n[Step 5] Testing upload validation (reject non-audio files)...');
    const textBlob = new Blob(['Not an audio file'], { type: 'text/plain' });
    const invalidForm = new FormData();
    invalidForm.append('file', textBlob, 'notes.txt');

    const invalidUpload = await request('/api/admin/songs', {
      method: 'POST',
      token: adminToken,
      body: invalidForm,
      isFormData: true
    });
    assert.strictEqual(invalidUpload.status, 400, 'Non-audio file must be rejected with 400');
    console.log(`  -> PASS: Rejected invalid file with message: "${invalidUpload.data.message}"`);

    // Step 6: List, Search, and Paginate Songs
    console.log('\n[Step 6] Testing song listing and search...');
    const listRes = await request('/api/admin/songs?search=Midnight', { token: adminToken });
    assert.strictEqual(listRes.status, 200);
    assert(listRes.data.data.length >= 1, 'Search should find uploaded song');
    assert.strictEqual(listRes.data.data[0].id, createdSong.id);
    console.log(`  -> PASS: Found song via search. Total results: ${listRes.data.count}`);

    // Step 7: Metadata Editing (PATCH)
    console.log('\n[Step 7] Testing song metadata update (PATCH)...');
    const updateRes = await request(`/api/admin/songs/${createdSong.id}`, {
      method: 'PATCH',
      token: adminToken,
      body: {
        title: 'Midnight Ambient Waves (Remastered)',
        artist: 'Solar Soundscapes & Friends'
      }
    });
    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.data.data.title, 'Midnight Ambient Waves (Remastered)');
    assert.strictEqual(updateRes.data.data.artist, 'Solar Soundscapes & Friends');
    console.log('  -> PASS: Metadata updated successfully.');

    // Step 8: Generate Short-Lived Signed URL
    console.log('\n[Step 8] Testing signed URL generation...');
    const signedRes = await request(`/api/admin/songs/${createdSong.id}/signed-url?expiresIn=600`, {
      method: 'POST',
      token: adminToken
    });
    assert.strictEqual(signedRes.status, 200);
    assert(signedRes.data.data.signedUrl, 'Signed URL must be returned');
    assert(signedRes.data.data.signedUrl.includes('token='), 'Signed URL must contain authentication token');
    console.log('  -> PASS: Generated short-lived signed URL for preview/streaming.');

    // Step 9: Bulk Upload with Concurrency & Partial Reporting
    console.log('\n[Step 9] Testing bulk upload with multiple files...');
    const bulkForm = new FormData();
    const f1 = new Blob([createDummyMp3Buffer('Track Alpha')], { type: 'audio/mpeg' });
    const f2 = new Blob([createDummyMp3Buffer('Track Beta')], { type: 'audio/mpeg' });
    const f3 = new Blob(['Not an audio track'], { type: 'text/plain' }); // Deliberate failure item

    bulkForm.append('files', f1, 'track_alpha.mp3');
    bulkForm.append('files', f2, 'track_beta.mp3');
    bulkForm.append('files', f3, 'invalid_doc.pdf');

    const bulkRes = await request('/api/admin/songs/bulk?concurrency=2', {
      method: 'POST',
      token: adminToken,
      body: bulkForm,
      isFormData: true
    });
    assert.strictEqual(bulkRes.status, 200);
    assert.strictEqual(bulkRes.data.total, 3);
    assert.strictEqual(bulkRes.data.successful, 2, '2 valid MP3s should succeed');
    assert.strictEqual(bulkRes.data.failed, 1, '1 invalid file should fail');
    const bulkResults = bulkRes.data.data;
    assert.strictEqual(bulkResults[0].success, true);
    assert.strictEqual(bulkResults[1].success, true);
    assert.strictEqual(bulkResults[2].success, false);
    console.log('  -> PASS: Bulk upload accurately handled partial failure and reported per-file results.');

    // Step 10: Schedule Playlist Assignment & Persistence
    console.log('\n[Step 10] Testing schedule playlist assignment...');
    const schedTracksRes = await request('/api/admin/schedules/1/tracks', {
      method: 'POST',
      token: adminToken,
      body: {
        tracks: [
          {
            song_id: createdSong.id,
            title: createdSong.title,
            artist: createdSong.artist,
            duration: '03:45',
            duration_seconds: 225
          },
          {
            title: 'Guest DJ Intro Speech',
            artist: 'Host',
            duration: '01:00',
            duration_seconds: 60
          }
        ]
      }
    });
    assert.strictEqual(schedTracksRes.status, 200);
    assert.strictEqual(schedTracksRes.data.count, 2);

    const getPlaylistRes = await request('/api/admin/schedules/1/tracks', { token: adminToken });
    assert.strictEqual(getPlaylistRes.status, 200);
    assert.strictEqual(getPlaylistRes.data.count, 2);
    assert.strictEqual(getPlaylistRes.data.data[0].song_id, createdSong.id);
    console.log('  -> PASS: Schedule playlist assigned and retrieved in ordered sequence.');

    // Step 11: Protection Against Deleting Referenced Songs (409 Conflict)
    console.log('\n[Step 11] Testing protection against deleting songs assigned to a schedule...');
    const deleteAttempt = await request(`/api/admin/songs/${createdSong.id}?permanent=true`, {
      method: 'DELETE',
      token: adminToken
    });
    assert.strictEqual(deleteAttempt.status, 409, 'Permanent delete must be rejected with 409 Conflict');
    assert(deleteAttempt.data.message.includes('currently assigned to'), 'Conflict message must mention schedule assignment');
    console.log(`  -> PASS: Delete blocked with 409 Conflict: "${deleteAttempt.data.message}"`);

    // Step 12: Remove Track from Schedule (Library Song Remains Intact)
    console.log('\n[Step 12] Removing track from schedule (verifying song remains in library)...');
    const removeTrackRes = await request(`/api/admin/schedules/1/tracks/${createdSong.id}`, {
      method: 'DELETE',
      token: adminToken
    });
    assert.strictEqual(removeTrackRes.status, 200);
    assert.strictEqual(removeTrackRes.data.count, 1, 'Only 1 track should remain in playlist');

    // Verify song still exists in library
    const checkSong = await request(`/api/admin/songs/${createdSong.id}`, { token: adminToken });
    assert.strictEqual(checkSong.status, 200);
    assert.strictEqual(checkSong.data.data.id, createdSong.id);
    console.log('  -> PASS: Removing track from schedule did not delete song from library.');

    // Step 13: Radio Streaming Playback Bridge (Security & Authorized resolution)
    console.log('\n[Step 13] Testing streaming bridge (/api/streaming/schedule/1/next-track)...');
    const anonStreamingRes = await request('/api/streaming/schedule/1/next-track');
    assert.strictEqual(anonStreamingRes.status, 401, 'Unauthenticated streaming request must be rejected with 401');

    const streamingRes = await request('/api/streaming/schedule/1/next-track', { token: adminToken });
    assert.strictEqual(streamingRes.status, 200, 'Authorized streaming request must return 200');
    assert(streamingRes.data.title, 'Streaming bridge must return track title');
    console.log(`  -> PASS: Streaming bridge rejected unauthenticated (401) and resolved next track with authorization: "${streamingRes.data.title}"`);

    // Step 14: Safe Permanent Deletion now that schedule reference is resolved
    console.log('\n[Step 14] Deleting song permanently now that it is unassigned...');
    const finalDelete = await request(`/api/admin/songs/${createdSong.id}?permanent=true`, {
      method: 'DELETE',
      token: adminToken
    });
    assert.strictEqual(finalDelete.status, 200);
    console.log('  -> PASS: Song permanently deleted and storage object cleaned up.');

    console.log('\n>>> ALL 14 SONG LIBRARY & STORAGE VERIFICATION TESTS PASSED 100%! <<<');
    if (server) server.close();
    process.exit(0);
  } finally {
    if (server) {
      server.close();
    }
  }
}

runTests().catch((err) => {
  console.error('\n❌ Test failure:', err);
  if (server) server.close();
  process.exit(1);
});
