import urllib.request
import urllib.error
import json
import http.cookiejar

BASE_URL = 'http://localhost:5000/api'
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def request(method, path, body=None, token=None):
    url = f"{BASE_URL}{path}"
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f"Bearer {token}"
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with opener.open(req) as resp:
            status = resp.status
            content = resp.read().decode('utf-8')
            return status, json.loads(content) if content else {}
    except urllib.error.HTTPError as e:
        content = e.read().decode('utf-8')
        try:
            parsed = json.loads(content)
        except:
            parsed = {'raw': content}
        return e.code, parsed

def run_tests():
    print("=== RUNNING PULSECAST API VERIFICATION SUITE ===")
    
    # T-01: Health Check
    status, data = request('GET', '/health')
    print(f"[T-01] GET /api/health -> Status: {status}, DB: {data.get('database')}")
    assert status == 200 and data.get('success') is True, "T-01 Failed"

    # T-02: Station Listing
    status, data = request('GET', '/stations')
    print(f"[T-02] GET /api/stations -> Status: {status}, Found {data.get('count')} stations")
    assert status == 200 and data.get('count') > 0, "T-02 Failed"

    # T-03: Single Station & 404 test
    status, data = request('GET', '/stations/1')
    print(f"[T-03] GET /api/stations/1 -> Status: {status}, Station: {data.get('data', {}).get('name')}")
    assert status == 200, "T-03 Valid ID Failed"

    status, data = request('GET', '/stations/99999')
    print(f"[T-03b] GET /api/stations/99999 -> Status: {status} (Expected 404)")
    assert status == 404, "T-03 Missing ID Failed"

    status, data = request('GET', '/stations/invalid-id')
    print(f"[T-03c] GET /api/stations/invalid-id -> Status: {status} (Expected 400)")
    assert status == 400, "T-03 Malformed ID Failed"

    # Schedules
    status, data = request('GET', '/stations/1/schedules')
    print(f"[Schedules] GET /api/stations/1/schedules -> Status: {status}, Count: {data.get('count')}")
    assert status == 200, "Schedules failed"

    # MySQL Upcoming Songs / Queue Verification
    status, data = request('GET', '/stations/1/tracks')
    now_p = data.get('now_playing', {})
    up_n = data.get('up_next', [])
    print(f"[Tracks] GET /api/stations/1/tracks -> Status: {status}, Playing: {now_p.get('title')}, Up Next: {len(up_n)} songs")
    assert status == 200 and now_p and len(up_n) > 0, "Tracks API failed"

    # T-04: Listener Registration
    import time
    test_email = f"listener_{int(time.time())}@example.com"
    status, data = request('POST', '/auth/register', {
        'name': 'Test New Listener',
        'email': test_email,
        'password': 'SecurePassword123!'
    })
    print(f"[T-04] POST /api/auth/register -> Status: {status}, User: {data.get('user', {}).get('email')}")
    assert status == 201 and 'password_hash' not in data.get('user', {}), "T-04 Failed"

    # T-05: Duplicate Email Rejection
    status, data = request('POST', '/auth/register', {
        'name': 'Duplicate Person',
        'email': test_email,
        'password': 'SecurePassword123!'
    })
    print(f"[T-05] POST /api/auth/register (Duplicate) -> Status: {status} (Expected 409)")
    assert status == 409, "T-05 Failed"

    # T-06: Login Valid & Invalid
    status, data = request('POST', '/auth/login', {
        'email': 'admin@pulsecast.com',
        'password': 'WrongPassword!'
    })
    print(f"[T-06a] POST /api/auth/login (Wrong pass) -> Status: {status} (Expected 401)")
    assert status == 401, "T-06a Failed"

    status, data = request('POST', '/auth/login', {
        'email': 'admin@pulsecast.com',
        'password': 'AdminPassword123!'
    })
    admin_token = data.get('token')
    print(f"[T-06b] POST /api/auth/login (Admin) -> Status: {status}, Role: {data.get('user', {}).get('role')}")
    assert status == 200 and admin_token, "T-06b Failed"

    # Listener Login
    status, data = request('POST', '/auth/login', {
        'email': 'listener@pulsecast.com',
        'password': 'ListenerPass123!'
    })
    listener_token = data.get('token')
    print(f"[Listener Login] POST /api/auth/login -> Status: {status}, Role: {data.get('user', {}).get('role')}")
    assert status == 200 and listener_token, "Listener Login Failed"

    # T-07: Listener Calling Admin Endpoint (Forbidden)
    status, data = request('POST', '/admin/stations', {
        'name': 'Hacker Radio',
        'stream_url': 'https://stream.example.com/live'
    }, token=listener_token)
    print(f"[T-07] Listener calling POST /api/admin/stations -> Status: {status} (Expected 403 Forbidden)")
    assert status == 403, "T-07 Negative Authorization Failed"

    # T-08: Admin Creating Station
    status, data = request('POST', '/admin/stations', {
        'name': 'Aether Chillout FM',
        'description': 'Lofi ambient and chillout beats broadcast',
        'genre': 'Lofi / Ambient',
        'stream_url': 'https://stream.radioparadise.com/mellow-128'
    }, token=admin_token)
    created_station_id = data.get('data', {}).get('id')
    print(f"[T-08] Admin created station -> Status: {status}, ID: {created_station_id}")
    assert status == 201 and created_station_id, "T-08 Failed"

    # T-09: Favourites Add/Remove
    status, data = request('POST', f'/favourites/{created_station_id}', token=listener_token)
    print(f"[T-09a] Listener added favourite -> Status: {status}")
    assert status in (200, 201), "T-09a Failed"

    status, data = request('GET', '/favourites', token=listener_token)
    print(f"[T-09b] Listener listed favourites -> Status: {status}, Count: {data.get('count')}")
    assert status == 200 and data.get('count') > 0, "T-09b Failed"

    status, data = request('DELETE', f'/favourites/{created_station_id}', token=listener_token)
    print(f"[T-09c] Listener removed favourite -> Status: {status}")
    assert status == 200, "T-09c Failed"

    # T-10: Schedule Validation (Invalid range end == start)
    status, data = request('POST', f'/admin/stations/{created_station_id}/schedules', {
        'title': 'Broken Show',
        'start_time': '12:00',
        'end_time': '12:00'
    }, token=admin_token)
    print(f"[T-10] Schedule range validation (12:00 to 12:00) -> Status: {status} (Expected 400)")
    assert status == 400, "T-10 Schedule validation failed"

    # Admin updates and cleans up station
    status, data = request('PATCH', f'/admin/stations/{created_station_id}/status', {
        'is_active': False
    }, token=admin_token)
    print(f"[Admin PATCH] Toggle station status -> Status: {status}, Active: {data.get('data', {}).get('is_active')}")
    assert status == 200, "Admin patch failed"

    status, data = request('DELETE', f'/admin/stations/{created_station_id}', token=admin_token)
    print(f"[Admin DELETE] Delete station -> Status: {status}")
    assert status == 200, "Admin delete failed"

    print("\n>>> ALL API VERIFICATION TESTS PASSED SUCCESSFULLY! (100% PASS) <<<")

if __name__ == '__main__':
    run_tests()

