import requests
import sys

BASE_URL = "http://localhost:5000/api"

def run_consistency_tests():
    print("=== TESTING CALENDAR CONSISTENCY ACROSS MONTH, WEEK, AND DAY VIEWS ===")
    session = requests.Session()

    # 1. Sign in as Admin
    login_resp = session.post(f"{BASE_URL}/auth/login", json={
        "email": "admin@pulsecast.com",
        "password": "AdminPassword123!"
    })
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
    token = login_resp.json().get("token") or login_resp.json().get("data", {}).get("token")
    headers = {"Authorization": f"Bearer {token}"}
    print("[1] Admin signed in successfully.")

    # 2. Check Month View Query Range (October & November 2026)
    month_resp = session.get(f"{BASE_URL}/admin/schedules?from=2026-10-01&to=2026-10-31", headers=headers)
    assert month_resp.status_code == 200, f"Month query failed: {month_resp.text}"
    month_data = month_resp.json().get("data", [])
    print(f"[2] Month View query (October 2026) returned {len(month_data)} schedule entries.")
    assert len(month_data) >= 6, "Expected at least 6 schedules in Month view"

    # 3. Check Week View Query Range (Current Week: Oct 25 - Nov 1, 2026)
    week_resp = session.get(f"{BASE_URL}/admin/schedules?from=2026-10-25&to=2026-11-01", headers=headers)
    assert week_resp.status_code == 200, f"Week query failed: {week_resp.text}"
    week_data = week_resp.json().get("data", [])
    print(f"[3] Week View query (Oct 25 - Nov 1) returned {len(week_data)} schedule entries.")
    assert len(week_data) >= 6, "Expected at least 6 schedules in Week view"

    # 4. Check Day View Query Range (Single Day: Oct 31, 2026)
    day_resp = session.get(f"{BASE_URL}/admin/schedules?from=2026-10-31&to=2026-10-31", headers=headers)
    assert day_resp.status_code == 200, f"Day query failed: {day_resp.text}"
    day_data = day_resp.json().get("data", [])
    print(f"[4] Day View query (Oct 31) returned {len(day_data)} schedule entries.")
    assert len(day_data) >= 6, "Expected at least 6 schedules in Day view"

    # 5. Check Future Month View Query Range (December 2026)
    # Recurring daily schedules MUST also appear in future months!
    future_month_resp = session.get(f"{BASE_URL}/admin/schedules?from=2026-12-01&to=2026-12-31", headers=headers)
    assert future_month_resp.status_code == 200, f"Future month query failed: {future_month_resp.text}"
    future_month_data = future_month_resp.json().get("data", [])
    print(f"[5] Future Month query (December 2026) returned {len(future_month_data)} schedule entries.")
    assert len(future_month_data) >= 4, "Expected daily recurring schedules to remain accessible in future months"

    # 6. Verify Schedule Details Endpoint (Right-side Drawer data)
    sched_id = day_data[0]["id"]
    details_resp = session.get(f"{BASE_URL}/admin/schedules/{sched_id}", headers=headers)
    assert details_resp.status_code == 200, f"Details query failed: {details_resp.text}"
    d = details_resp.json().get("data", {})
    print(f"[6] Details drawer endpoint returned complete metadata:")
    print(f"    - Title: {d.get('title')}")
    print(f"    - Station: {d.get('station_name')}")
    print(f"    - Category: {d.get('category')}")
    print(f"    - Broadcast Range: {d.get('start_time')} - {d.get('end_time')}")
    print(f"    - Status: {d.get('status')}")
    print(f"    - Songs: {len(d.get('songs', []))} assigned")
    assert d.get("title") and d.get("station_name") and d.get("start_time") and d.get("end_time")

    # 7. Drag-and-Drop Reschedule Simulation
    # Create a test schedule, reschedule it via drag-and-drop (PUT), check conflict validation
    test_sched = {
        "station_id": 1,
        "title": "Drag Drop Test Programme",
        "schedule_date": "2026-10-31",
        "start_time": "05:00",
        "end_time": "06:00",
        "category": "Live DJ",
        "description": "Drag and drop testing",
        "is_published": True,
        "songs": []
    }
    create_r = session.post(f"{BASE_URL}/admin/schedules", json=test_sched, headers=headers)
    assert create_r.status_code == 201, f"Create test sched failed: {create_r.text}"
    test_id = create_r.json()["data"]["id"]
    print(f"[7a] Created test event #{test_id} for drag-and-drop test.")

    # Drag to 06:00 - 07:00 (free slot) -> Must succeed with 200
    reschedule_r = session.put(f"{BASE_URL}/admin/schedules/{test_id}", json={
        "station_id": 1,
        "title": "Drag Drop Test Programme",
        "schedule_date": "2026-10-31",
        "start_time": "06:00",
        "end_time": "07:00",
        "category": "Live DJ",
        "description": "Dragged to 06:00",
        "is_published": True
    }, headers=headers)
    assert reschedule_r.status_code == 200, f"Reschedule failed: {reschedule_r.text}"
    print(f"[7b] Successfully simulated drag-and-drop reschedule to 06:00 - 07:00.")

    # Drag to 08:00 - 09:30 (overlaps Morning Acoustic Awakening 08:00-11:00) -> Must reject with 409 Conflict
    conflict_r = session.put(f"{BASE_URL}/admin/schedules/{test_id}", json={
        "station_id": 1,
        "title": "Drag Drop Test Programme",
        "schedule_date": "2026-10-31",
        "start_time": "08:30",
        "end_time": "09:30",
        "category": "Live DJ",
        "is_published": True
    }, headers=headers)
    assert conflict_r.status_code == 409, f"Expected 409 Conflict on drag overlap, got {conflict_r.status_code}: {conflict_r.text}"
    print(f"[7c] Drag-and-drop into overlapping slot correctly rejected with HTTP 409 Conflict: {conflict_r.json().get('message')}")

    # Clean up test event
    del_r = session.delete(f"{BASE_URL}/admin/schedules/{test_id}", headers=headers)
    assert del_r.status_code == 200, f"Cleanup failed: {del_r.text}"
    print(f"[7d] Cleaned up drag-drop test event.")

    print("\n>>> ALL CALENDAR CONSISTENCY & ENHANCEMENT TESTS PASSED 100%! <<<")

if __name__ == "__main__":
    try:
        run_consistency_tests()
    except Exception as e:
        print(f"\nFAILED: {e}")
        sys.exit(1)

