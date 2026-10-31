/**
 * PulseCast Streaming Authentication Verification Test Suite
 * (tests/test_streaming_auth.js)
 * 
 * Verifies all required streaming authorization behaviors:
 * 1. Valid server-to-server x-radio-token (200 OK)
 * 2. Missing streaming token (401 Unauthorized)
 * 3. Invalid streaming token (401 Unauthorized)
 * 4. Missing server configuration / RADIO_STREAMING_KEY missing (500 Server Error)
 * 5. Admin JWT authorization (200 OK)
 * 6. Non-admin Listener JWT rejection (403 Forbidden)
 * 7. Invalid/Malformed JWT rejection (401 Unauthorized)
 * 8. Query parameter token rejection - ?radio_token=... not accepted (401 Unauthorized)
 * 9. Unrelated API endpoints unaffected (RBAC preservation)
 * 10. Secrets and tokens not leaked in error responses
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const backendDir = path.join(__dirname, '../backend');
require(path.join(backendDir, 'node_modules/dotenv')).config({ path: path.join(backendDir, '.env') });

const app = require(path.join(backendDir, 'src/app'));

let server;
let baseUrl;
let adminJwt = null;
let listenerJwt = null;

const VALID_KEY = 'test_radio_streaming_key_abc123_xyz789_secure';
const INVALID_KEY = 'completely_wrong_streaming_key';

function makeRequest(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlPath, baseUrl);
    const headers = options.headers || {};
    if (options.radioToken !== undefined) {
      headers['x-radio-token'] = options.radioToken;
    }
    if (options.bearerToken !== undefined) {
      headers['Authorization'] = `Bearer ${options.bearerToken}`;
    }

    const req = http.request(
      parsed.toString(),
      {
        method: options.method || 'GET',
        headers
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => {
          let json = {};
          try {
            json = JSON.parse(raw);
          } catch (_) {
            json = { raw };
          }
          resolve({ status: res.statusCode, body: json, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('='.repeat(70));
  console.log('  PULSECAST STREAMING AUTHENTICATION VERIFICATION SUITE');
  console.log('='.repeat(70));

  // Start test server on ephemeral port
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      console.log(`\n[TEST SERVER] Running on ${baseUrl}\n`);
      resolve();
    });
  });

  try {
    // --------------------------------------------------------------------------
    // Step 0: Obtain Admin and Listener JWTs for Testing
    // --------------------------------------------------------------------------
    console.log('[Step 0] Authenticating Admin and Listener accounts...');
    
    // Admin login
    const adminLoginRes = await makeRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'admin@pulsecast.com', password: 'AdminPassword123!' }
    });
    assert.strictEqual(adminLoginRes.status, 200, 'Admin login failed');
    adminJwt = adminLoginRes.body.token;
    assert.ok(adminJwt, 'Admin JWT must exist');

    // Listener login
    const listenerLoginRes = await makeRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'listener@pulsecast.com', password: 'ListenerPass123!' }
    });
    assert.strictEqual(listenerLoginRes.status, 200, 'Listener login failed');
    listenerJwt = listenerLoginRes.body.token;
    assert.ok(listenerJwt, 'Listener JWT must exist');

    console.log('  -> PASS: Admin and Listener JWTs acquired.\n');

    // Configure server environment variable for tests 1-3, 5-8
    process.env.RADIO_STREAMING_KEY = VALID_KEY;
    delete process.env.STREAMING_SECRET;

    // --------------------------------------------------------------------------
    // Test 1: Valid streaming token via x-radio-token header
    // --------------------------------------------------------------------------
    console.log('[Test 1] Testing Valid Streaming Token (x-radio-token)...');
    const t1 = await makeRequest('/api/streaming/stations/7/next-track', {
      radioToken: VALID_KEY
    });
    assert.strictEqual(t1.status, 200, `Expected 200 with valid key, got ${t1.status}`);
    assert.strictEqual(t1.body.success, true);
    assert.strictEqual(t1.body.station_id, 7);
    console.log('  -> PASS: Valid x-radio-token successfully authorized (HTTP 200).');

    // --------------------------------------------------------------------------
    // Test 2: Missing streaming token (no x-radio-token, no JWT)
    // --------------------------------------------------------------------------
    console.log('[Test 2] Testing Missing Streaming Token...');
    const t2 = await makeRequest('/api/streaming/stations/7/next-track');
    assert.strictEqual(t2.status, 401, `Expected 401 on missing token, got ${t2.status}`);
    assert.strictEqual(t2.body.success, false);
    assert.ok(
      t2.body.message.includes('Missing x-radio-token') || t2.body.message.includes('Authentication required'),
      `Message was: ${t2.body.message}`
    );
    // Ensure it does not tell the server daemon "Please sign in" as if it's a website
    assert.ok(!t2.body.message.includes('Please sign in'), 'Should not ask daemon to sign in via website form');
    console.log('  -> PASS: Missing token correctly rejected with HTTP 401.');

    // --------------------------------------------------------------------------
    // Test 3: Invalid streaming token via x-radio-token header
    // --------------------------------------------------------------------------
    console.log('[Test 3] Testing Invalid Streaming Token (x-radio-token)...');
    const t3 = await makeRequest('/api/streaming/stations/7/next-track', {
      radioToken: INVALID_KEY
    });
    assert.strictEqual(t3.status, 401, `Expected 401 on invalid token, got ${t3.status}`);
    assert.strictEqual(t3.body.success, false);
    assert.strictEqual(t3.body.message, 'Invalid radio streaming token.');
    console.log('  -> PASS: Invalid x-radio-token correctly rejected with HTTP 401.');

    // --------------------------------------------------------------------------
    // Test 4: Missing Server Configuration (process.env.RADIO_STREAMING_KEY unset)
    // --------------------------------------------------------------------------
    console.log('[Test 4] Testing Missing Server Configuration...');
    delete process.env.RADIO_STREAMING_KEY;
    delete process.env.STREAMING_SECRET;

    // 4a. Client sends a token, but server has no configured key
    const t4a = await makeRequest('/api/streaming/stations/7/next-track', {
      radioToken: VALID_KEY
    });
    assert.strictEqual(t4a.status, 500, `Expected 500 when server key is missing, got ${t4a.status}`);
    assert.strictEqual(t4a.body.success, false);
    assert.ok(t4a.body.message.includes('Streaming authorization key is not configured'));

    // 4b. Client sends no token, server has no configured key
    const t4b = await makeRequest('/api/streaming/stations/7/next-track');
    assert.strictEqual(t4b.status, 500, `Expected 500 when server key is missing, got ${t4b.status}`);
    assert.strictEqual(t4b.body.success, false);
    console.log('  -> PASS: Missing server configuration strictly rejected with HTTP 500.');

    // Restore server key for remaining tests
    process.env.RADIO_STREAMING_KEY = VALID_KEY;

    // --------------------------------------------------------------------------
    // Test 5: Admin JWT Authorization Behavior
    // --------------------------------------------------------------------------
    console.log('[Test 5] Testing Admin JWT Authorization Behavior...');
    // 5a. Valid Admin JWT
    const t5a = await makeRequest('/api/streaming/stations/7/next-track', {
      bearerToken: adminJwt
    });
    assert.strictEqual(t5a.status, 200, `Expected 200 with Admin JWT, got ${t5a.status}`);
    assert.strictEqual(t5a.body.success, true);
    console.log('  -> PASS: Valid Admin JWT allowed (HTTP 200).');

    // 5b. Non-admin Listener JWT (Must be rejected with HTTP 403 Forbidden)
    console.log('[Test 5b] Testing Listener JWT Rejection...');
    const t5b = await makeRequest('/api/streaming/stations/7/next-track', {
      bearerToken: listenerJwt
    });
    assert.strictEqual(t5b.status, 403, `Expected 403 for Listener JWT, got ${t5b.status}`);
    assert.strictEqual(t5b.body.success, false);
    assert.ok(t5b.body.message.includes('Administrator privileges required'));
    console.log('  -> PASS: Listener JWT correctly rejected with HTTP 403.');

    // 5c. Malformed / Invalid JWT (Must be rejected with HTTP 401)
    console.log('[Test 5c] Testing Invalid JWT Rejection...');
    const t5c = await makeRequest('/api/streaming/stations/7/next-track', {
      bearerToken: 'invalid.jwt.token.here'
    });
    assert.strictEqual(t5c.status, 401, `Expected 401 for Invalid JWT, got ${t5c.status}`);
    assert.strictEqual(t5c.body.success, false);
    console.log('  -> PASS: Invalid JWT correctly rejected with HTTP 401.');

    // --------------------------------------------------------------------------
    // Test 6: Query Parameter Token Rejection (?radio_token=...)
    // --------------------------------------------------------------------------
    console.log('[Test 6] Testing Query Parameter Rejection (No tokens in query params)...');
    const t6 = await makeRequest(`/api/streaming/stations/7/next-track?radio_token=${VALID_KEY}`);
    assert.strictEqual(t6.status, 401, `Expected 401 when token passed only in query param, got ${t6.status}`);
    assert.strictEqual(t6.body.success, false);
    console.log('  -> PASS: Query parameter tokens strictly rejected (HTTP 401).');

    // --------------------------------------------------------------------------
    // Test 7: Secret Exposure Prevention
    // --------------------------------------------------------------------------
    console.log('[Test 7] Testing Secret Exposure Prevention in Responses...');
    const allResponses = [t1, t2, t3, t4a, t4b, t5a, t5b, t5c, t6];
    for (const r of allResponses) {
      const strBody = JSON.stringify(r.body);
      assert.ok(!strBody.includes(VALID_KEY), 'Response body must NEVER contain the streaming secret key');
      assert.ok(!strBody.includes(INVALID_KEY), 'Response body must NEVER reflect the invalid key');
    }
    console.log('  -> PASS: Zero secrets leaked in responses.');

    // --------------------------------------------------------------------------
    // Test 8: Unrelated Endpoints Authorization Integrity
    // --------------------------------------------------------------------------
    console.log('[Test 8] Verifying Unrelated Endpoints Authorization Integrity...');
    // 8a. /api/stations is public (200)
    const t8a = await makeRequest('/api/stations');
    assert.strictEqual(t8a.status, 200, 'Public stations list must remain 200');

    // 8b. /api/admin/songs requires Admin JWT (anonymous -> 401)
    const t8b = await makeRequest('/api/admin/songs');
    assert.strictEqual(t8b.status, 401, 'Admin songs route must reject anonymous requests');

    // 8c. /api/admin/songs with listener token -> 403
    const t8c = await makeRequest('/api/admin/songs', { bearerToken: listenerJwt });
    assert.strictEqual(t8c.status, 403, 'Admin songs route must reject listener role');

    // 8d. /api/admin/songs with radio token -> 401 (radio token is NOT valid for admin panel)
    const t8d = await makeRequest('/api/admin/songs', { radioToken: VALID_KEY });
    assert.strictEqual(t8d.status, 401, 'Radio streaming token must NOT grant access to admin panel');

    console.log('  -> PASS: Unrelated endpoint RBAC rules fully preserved.\n');

    console.log('='.repeat(70));
    console.log('  ALL STREAMING AUTHENTICATION TESTS PASSED SUCCESSFULLY! (10/10)');
    console.log('='.repeat(70));
    process.exit(0);

  } finally {
    if (server) {
      server.close();
    }
  }
}

runTests().catch((err) => {
  console.error('\n[FATAL] Test failed:', err);
  process.exit(1);
});
