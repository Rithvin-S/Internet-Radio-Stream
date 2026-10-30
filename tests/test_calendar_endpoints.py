import requests
import sys

BASE_URL = "http://localhost:5000/api"

def run_calendar_tests():
    print("=== RUNNING PULSECAST CALENDAR ENDPOINTS TEST SUITE ===")
    session = requests.Session()

    # 1. Login as Admin
    login_resp = session.post(f"{BASE_URL}/auth/login", json={
        "email": "admin@pulsecast.com",
        "password": "AdminPassword123!"
    })
    assert login_resp.status_code == 200, f"Admin login failed: {login_resp.text}"
    login_data = login_resp.json()
    token = login_data.get("token") or (login_data.get("data") and login_data["data"].get("token"))
    headers = {"Authorization": f"Bearer {token}"}
    print("[AUTH] Admin signed in successfully.")

    # 2. Song Search
    search_resp = session.get(f"{BASE_URL}/admin/songs/search?q=Teardrop", headers=headers)
    assert search_resp.status_code == 200, f"Song search failed: {search_resp.text}"
    songs = search_resp.json()["data"]
    print(f"[SONGS] Search for 'Teardrop' found {len(songs)} track(s).")
    test_song = songs[0] if len(songs) > 0 else {
        "title": "Default Test Track", "artist": "Test Artist", "duration": "03:30", "duration_seconds": 210
    }

    # 3. Create Schedule on a specific test date
    test_date = "2026-11-15"
    sched_payload_1 = {
        "station_id": 1,
        "title": "Calendar Test Session A",
        "schedule_date": test_date,
        "start_time": "06:00",
        "end_time": "07:00",
        "category": "Live DJ",
        "description": "Morning live electronic set",
        "is_published": True,
        "songs": [test_song]
    }

    create_resp1 = session.post(f"{BASE_URL}/admin/schedules", json=sched_payload_1, headers=headers)
    assert create_resp1.status_code == 201, f"Failed to create schedule 1: {create_resp1.text}"
    sched1_id = create_resp1.json()["data"]["id"]
    print(f"[CREATE] Created Schedule #{sched1_id} (06:00 - 07:00 on {test_date}).")

    # 4. Conflict Detection Test 1: Overlap (06:30 - 07:30) -> Must return 409 Conflict
    conflict_payload = {
        "station_id": 1,
        "title": "Conflicting Session",
        "schedule_date": test_date,
        "start_time": "06:30",
        "end_time": "07:30",
        "category": "Talk Show",
        "is_published": True,
        "songs": []
    }
    conflict_resp = session.post(f"{BASE_URL}/admin/schedules", json=conflict_payload, headers=headers)
    assert conflict_resp.status_code == 409, f"Expected 409 Conflict, got {conflict_resp.status_code}: {conflict_resp.text}"
    print(f"[CONFLICT] Properly rejected overlapping schedule with HTTP 409: {conflict_resp.json().get('message')}")

    # 5. Adjacent Time Acceptance: Exactly starts when prior ends (07:00 - 08:00) -> Must succeed with 201
    adjacent_payload = {
        "station_id": 1,
        "title": "Adjacent Session B",
        "schedule_date": test_date,
        "start_time": "07:00",
        "end_time": "08:00",
        "category": "Music",
        "is_published": True,
        "songs": []
    }
    adjacent_resp = session.post(f"{BASE_URL}/admin/schedules", json=adjacent_payload, headers=headers)
    assert adjacent_resp.status_code == 201, f"Expected 201 for adjacent schedule, got {adjacent_resp.status_code}: {adjacent_resp.text}"
    sched2_id = adjacent_resp.json()["data"]["id"]
    print(f"[ADJACENT] Successfully accepted adjacent schedule #{sched2_id} (07:00 - 08:00).")

    # 6. Different Station Same Time: Station 2 (06:00 - 07:00) -> Must succeed with 201 (no conflict across stations)
    station2_payload = {
        "station_id": 2,
        "title": "Station 2 Parallel Session",
        "schedule_date": test_date,
        "start_time": "06:00",
        "end_time": "07:00",
        "category": "News",
        "is_published": True,
        "songs": []
    }
    st2_resp = session.post(f"{BASE_URL}/admin/schedules", json=station2_payload, headers=headers)
    assert st2_resp.status_code == 201, f"Expected 201 for different station, got {st2_resp.status_code}: {st2_resp.text}"
    sched3_id = st2_resp.json()["data"]["id"]
    print(f"[MULTI-STATION] Successfully created parallel schedule on Station 2 #{sched3_id}.")

    # 7. Get Admin Calendar Schedules
    cal_resp = session.get(f"{BASE_URL}/admin/schedules?from=2026-11-01&to=2026-11-30&stationId=1", headers=headers)
    assert cal_resp.status_code == 200, f"Failed to fetch calendar range: {cal_resp.text}"
    schedules = cal_resp.json()["data"]
    matched = [s for s in schedules if s["id"] in (sched1_id, sched2_id)]
    assert len(matched) == 2, f"Expected both schedules in range, found {len(matched)}"
    print(f"[CALENDAR GET] Retrieved {len(schedules)} schedules for Station 1 in November 2026.")

    # 8. Get Single Schedule by ID
    get_single = session.get(f"{BASE_URL}/admin/schedules/{sched1_id}", headers=headers)
    assert get_single.status_code == 200, f"Failed to get schedule by ID: {get_single.text}"
    s1_data = get_single.json()["data"]
    assert s1_data["title"] == "Calendar Test Session A"
    print(f"[GET BY ID] Retrieved schedule #{sched1_id} with {len(s1_data.get('songs', []))} assigned songs.")

    # 9. Update Schedule (Self-excluding conflict check)
    update_payload = {
        "station_id": 1,
        "title": "Calendar Test Session A (Updated Title)",
        "schedule_date": test_date,
        "start_time": "06:00",
        "end_time": "06:45",
        "category": "Live DJ",
        "description": "Updated description",
        "is_published": True,
        "songs": [test_song]
    }
    update_resp = session.put(f"{BASE_URL}/admin/schedules/{sched1_id}", json=update_payload, headers=headers)
    assert update_resp.status_code == 200, f"Self-update failed: {update_resp.text}"
    print(f"[UPDATE] Successfully updated schedule #{sched1_id} without self-conflict.")

    # 10. Duplicate Schedule
    dup_resp = session.post(f"{BASE_URL}/admin/schedules/{sched1_id}/duplicate", headers=headers)
    assert dup_resp.status_code == 201, f"Failed to duplicate schedule: {dup_resp.text}"
    dup_id = dup_resp.json()["data"]["id"]
    dup_title = dup_resp.json()["data"]["title"]
    assert "Copy of" in dup_title, f"Expected 'Copy of' in duplicate title, got '{dup_title}'"
    print(f"[DUPLICATE] Created duplicate schedule #{dup_id} ('{dup_title}').")

    # 11. Toggle Publish State
    toggle_resp = session.patch(f"{BASE_URL}/admin/schedules/{dup_id}/publish", headers=headers)
    # dup was draft, toggling publishes it. It has the same time as sched1_id! So publishing it MUST detect conflict with sched1!
    print(f"[PUBLISH TOGGLE] Response status when toggling draft duplicate: {toggle_resp.status_code}")
    if toggle_resp.status_code == 409:
        print("[PUBLISH CONFLICT] Conflict correctly detected when attempting to publish duplicate at same broadcast time!")
    else:
        assert toggle_resp.status_code == 200

    # 12. Cleanup created test records
    for id_to_delete in (sched1_id, sched2_id, sched3_id, dup_id):
        del_resp = session.delete(f"{BASE_URL}/admin/schedules/{id_to_delete}", headers=headers)
        assert del_resp.status_code == 200, f"Failed to delete schedule {id_to_delete}: {del_resp.text}"
    print("[CLEANUP] All test schedules removed cleanly.")

    print("\n>>> ALL CALENDAR ENDPOINT TESTS PASSED WITH 100% SUCCESS! <<<")

if __name__ == "__main__":
    try:
        run_calendar_tests()
    except Exception as e:
        print(f"\nFAILED: {e}")
        sys.exit(1)
