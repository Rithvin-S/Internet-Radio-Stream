# Full-Stack API Acceptance Test Checklist

**Project:** Full-Stack Internet Radio Streaming System  
**Specification:** SRS v2.0 (Backend-enabled)  
**Date:** 29 October 2026  
**Status:** All Automated & Integration Tests Verified (PASS)

---

## Test Execution Matrix (T-01 through T-16)

| Test ID | SRS Requirement | Test Scenario & Route | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **T-01** | API Health Check | `GET /api/health` | HTTP 200; returns healthy status and DB driver (`mysql` or fallback). | Returns `{ success: true, status: 'healthy', database: {...} }`. | **PASS** |
| **T-02** | Station Listing (Active/Inactive) | `GET /api/stations` | Public returns only active stations (`is_active = 1`). | Returns active catalogue. Inactive stations excluded for guests. | **PASS** |
| **T-03** | Station by ID & Errors | `GET /api/stations/:id` | Valid ID returns 200; missing ID returns 404; malformed ID returns 400. | Valid ID returns station; ID 99999 returns 404; "invalid-id" returns 400. | **PASS** |
| **T-04** | User Registration | `POST /api/auth/register` | Account created; HTTP 201; excludes `password_hash` in response. | Account registered, JWT issued, password hashed with bcrypt. | **PASS** |
| **T-05** | Duplicate Email Rejection | `POST /api/auth/register` | Rejects existing email with HTTP 409 Conflict. | Duplicate email rejected with clear conflict message. | **PASS** |
| **T-06** | User Authentication | `POST /api/auth/login` | Valid credentials return 200 & JWT; wrong password returns 401. | Correct password issues JWT and HttpOnly cookie; invalid fails safely. | **PASS** |
| **T-07** | Role Authorization | `POST /api/admin/stations` with listener token | Rejects non-admin user with HTTP 403 Forbidden. | Server-side role check rejects listener; admin is allowed. | **PASS** |
| **T-08** | Admin Station CRUD | `POST /api/admin/stations` with admin token | Validates fields and persists station record in database. | Station created with ID, retrievable and editable. | **PASS** |
| **T-09** | Favourites Management | `POST`, `GET`, `DELETE /api/favourites/:id` | Adds, lists, and removes user favourites; prevents duplicates. | Scoped strictly to authenticated user's ID via composite key. | **PASS** |
| **T-10** | Schedule Validation | `POST /api/admin/stations/:id/schedules` | Rejects invalid time range where `start_time == end_time` or malformed. | Returns HTTP 400 with specific time-range validation error. | **PASS** |
| **T-11** | Player Valid Stream | Browser audio playback from stream endpoint | Audio plays cleanly; state updates to "Live Broadcast". | HTML5 Audio starts stream and animates equalizer bars. | **PASS** |
| **T-12** | Player Unavailable Stream | Browser connects to offline endpoint | State transitions to "Stream Error" with Retry button. | Graceful error handling; page remains responsive. | **PASS** |
| **T-13** | Mobile Layout & Keyboard | Keyboard nav (<kbd>Space</kbd>, <kbd>M</kbd>, arrows) & responsive widths | All controls visible, focus indicators active, touch targets ≥ 44px. | Fully responsive across mobile, tablet, and desktop viewports. | **PASS** |
| **T-14** | Restart Resilience | Restart API process and query stations | Data persisted in database remains intact after process restart. | SQLite/MySQL stores records persistently across restarts. | **PASS** |
| **T-15** | Database Error Resilience | MySQL temporarily offline or unconfigured | API returns controlled error and falls back gracefully without crash. | Fallback driver initializes automatically; health check reflects status. | **PASS** |
| **T-16** | Icecast Multi-Listener | Connect multiple listener clients to stream | Concurrent clients receive broadcast without contention. | Tested and verified; independent client connections handled. | **PASS** |

---

## Automated Verification Suite

Run the automated API test script at any time:
```powershell
python tests/test_api_endpoints.py
```
Output:
```text
=== RUNNING PULSECAST API VERIFICATION SUITE ===
[T-01] GET /api/health -> Status: 200, DB: {'connected': True, 'driver': 'sqlite', 'target': 'local_file'}
[T-02] GET /api/stations -> Status: 200, Found 5 stations
[T-03] GET /api/stations/1 -> Status: 200, Station: Radio Paradise (Main Mix)
[T-03b] GET /api/stations/99999 -> Status: 404 (Expected 404)
[T-03c] GET /api/stations/invalid-id -> Status: 400 (Expected 400)
[Schedules] GET /api/stations/1/schedules -> Status: 200, Count: 3
[T-04] POST /api/auth/register -> Status: 201
[T-05] POST /api/auth/register (Duplicate) -> Status: 409 (Expected 409)
[T-06a] POST /api/auth/login (Wrong pass) -> Status: 401 (Expected 401)
[T-06b] POST /api/auth/login (Admin) -> Status: 200, Role: admin
[Listener Login] POST /api/auth/login -> Status: 200, Role: listener
[T-07] Listener calling POST /api/admin/stations -> Status: 403 (Expected 403 Forbidden)
[T-08] Admin created station -> Status: 201
[T-09a] Listener added favourite -> Status: 201
[T-09b] Listener listed favourites -> Status: 200
[T-09c] Listener removed favourite -> Status: 200
[T-10] Schedule range validation (12:00 to 12:00) -> Status: 400 (Expected 400)
[Admin PATCH] Toggle station status -> Status: 200
[Admin DELETE] Delete station -> Status: 200

>>> ALL API VERIFICATION TESTS PASSED SUCCESSFULLY! (100% PASS) <<<
```

