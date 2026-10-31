/**
 * PulseCast - Optimistic UI Drag-and-Drop Rescheduling Verification Suite
 * Tests immediate UI updates, async background persistence, success toast confirmation,
 * failure rollback to original state, and rapid-drag concurrency control.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 1. Build Mock Browser DOM Environment
const mockElements = {
  calendarToast: { className: '', textContent: '' },
  calendarPeriodTitle: { textContent: '' },
  monthViewContainer: { style: {} },
  weekViewContainer: { style: {} },
  dayViewContainer: { style: {} },
  monthDaysGrid: { innerHTML: '' },
  weekDaysHeaders: { innerHTML: '' },
  weekColumnsWrapper: { innerHTML: '' },
  daySingleHeader: { innerHTML: '' },
  daySingleColumn: { innerHTML: '', setAttribute: () => {} },
  detailsDate: { textContent: '' },
  detailsTime: { textContent: '' },
  scheduleDetailsDrawer: { classList: { add: () => {}, remove: () => {} } }
};

global.document = {
  getElementById: (id) => mockElements[id] || { style: {}, addEventListener: () => {} },
  querySelectorAll: () => [],
  addEventListener: () => {}
};
global.window = { location: { href: '', search: '' } };

// Mock auth
global.auth = {
  getCurrentUser: async () => ({ id: 1, email: 'admin@pulsecast.com', role: 'admin' })
};

// Mock apiClient with controllable delays and responses
let mockPutHandler = null;
global.apiClient = {
  get: async (url) => {
    if (url.includes('/stations')) {
      return { data: [{ id: 1, name: 'Radio Paradise' }] };
    }
    if (url.includes('/admin/schedules')) {
      return {
        data: [
          {
            id: 101,
            station_id: 1,
            station_name: 'Radio Paradise',
            title: 'Morning Jazz Flow',
            description: 'Smooth coffee jazz',
            category: 'Music',
            schedule_date: '2026-10-31',
            start_time: '08:00',
            end_time: '09:00',
            is_published: true,
            status: 'published',
            songs: []
          }
        ]
      };
    }
    return { data: null };
  },
  put: (url, payload) => {
    if (mockPutHandler) {
      return mockPutHandler(url, payload);
    }
    return Promise.resolve({ success: true, data: payload });
  }
};

// 2. Load calendar.js script
const calendarJsCode = fs.readFileSync(path.join(__dirname, '../frontend/js/calendar.js'), 'utf8');

// Wrap and evaluate inside a function that exposes internal state for test verification
const wrappedCode = calendarJsCode.replace(
  "document.addEventListener('DOMContentLoaded', init);",
  `
  window.__testHarness = {
    rescheduleEvent,
    showToast,
    getSchedulesList: () => schedulesList,
    setSchedulesList: (list) => { schedulesList = list; },
    getMutationVersions: () => scheduleMutationVersions,
    getOriginalSnapshots: () => originalScheduleSnapshots,
    getActiveRequests: () => activeRescheduleRequests,
    renderCalendar
  };
  `
);

eval(wrappedCode);

const harness = window.__testHarness;
assert(harness, 'Test harness failed to attach to calendar.js');

async function runTests() {
  console.log('=== RUNNING OPTIMISTIC UI VERIFICATION SUITE ===\n');

  // Test 1: Immediate Frontend Update & Pending Toast
  console.log('[Test 1] Verifying Immediate Frontend Update & Pending Notification...');
  harness.setSchedulesList([
    {
      id: 101,
      station_id: 1,
      station_name: 'Radio Paradise',
      title: 'Morning Jazz Flow',
      description: 'Smooth coffee jazz',
      category: 'Music',
      schedule_date: '2026-10-31',
      start_time: '08:00',
      end_time: '09:00',
      is_published: true,
      status: 'published',
      songs: []
    }
  ]);

  let putCalled = false;
  let putResolve = null;
  mockPutHandler = (url, payload) => {
    putCalled = true;
    return new Promise((resolve) => {
      putResolve = () => resolve({ success: true, data: payload });
    });
  };

  // Trigger reschedule to 10:00 - 11:00
  harness.rescheduleEvent(101, '2026-10-31', '10:00', '11:00');

  // Verify schedule state in memory updated IMMEDIATELY (synchronously)
  const schedImmediate = harness.getSchedulesList()[0];
  assert.strictEqual(schedImmediate.start_time, '10:00', 'start_time should update immediately to 10:00');
  assert.strictEqual(schedImmediate.end_time, '11:00', 'end_time should update immediately to 11:00');
  assert.strictEqual(schedImmediate.is_optimistic, true, 'is_optimistic flag should be true while pending');

  // Verify toast notification is displayed immediately
  assert.strictEqual(mockElements.calendarToast.textContent, 'Rescheduling...', 'Toast should say "Rescheduling..." immediately');
  assert(mockElements.calendarToast.className.includes('pending'), 'Toast should have pending class');
  assert(putCalled, 'Asynchronous PUT request must be initiated in background');
  console.log('  -> PASS: Frontend state and toast updated immediately before API response.');

  // Test 2: Success Confirmation & Pending Indicator Removal
  console.log('\n[Test 2] Verifying Backend Confirmation & Toast Success Update...');
  putResolve(); // Backend confirms
  await new Promise((r) => setTimeout(r, 20)); // Wait for microtask tick

  const schedConfirmed = harness.getSchedulesList()[0];
  assert.strictEqual(schedConfirmed.start_time, '10:00', 'start_time should remain at 10:00');
  assert.strictEqual(schedConfirmed.is_optimistic, false, 'is_optimistic should be false on success');
  assert.strictEqual(mockElements.calendarToast.textContent, 'Schedule rescheduled successfully!', 'Toast should say "Schedule rescheduled successfully!"');
  assert(mockElements.calendarToast.className.includes('success'), 'Toast should have success class');
  assert.strictEqual(harness.getOriginalSnapshots().has(101), false, 'Original snapshot should be cleared after success');
  console.log('  -> PASS: Backend confirmation retained new position and updated toast to success.');

  // Test 3: Failure Rollback to Original State
  console.log('\n[Test 3] Verifying Failure Rollback to Original State & Error Notification...');
  let putReject = null;
  mockPutHandler = (url, payload) => {
    return new Promise((resolve, reject) => {
      putReject = () => reject({ status: 409, message: 'Schedule conflict: Overlaps with an existing broadcast' });
    });
  };

  // Drag from 10:00 to 14:00 (which will fail with 409 conflict)
  harness.rescheduleEvent(101, '2026-10-31', '14:00', '15:00');

  // Verify immediate optimistic update to 14:00
  assert.strictEqual(harness.getSchedulesList()[0].start_time, '14:00');
  assert.strictEqual(mockElements.calendarToast.textContent, 'Rescheduling...');

  // Backend rejects with conflict
  putReject();
  await new Promise((r) => setTimeout(r, 20));

  // Verify schedule restored to original 10:00 slot
  const schedRolledBack = harness.getSchedulesList()[0];
  assert.strictEqual(schedRolledBack.start_time, '10:00', 'start_time must be restored to original 10:00');
  assert.strictEqual(schedRolledBack.end_time, '11:00', 'end_time must be restored to original 11:00');
  assert.strictEqual(schedRolledBack.is_optimistic, false, 'is_optimistic should be cleared');
  assert.strictEqual(mockElements.calendarToast.textContent, 'Failed to reschedule. Your previous schedule has been restored.', 'Error toast message must match');
  assert(mockElements.calendarToast.className.includes('error'), 'Toast should have error class');
  console.log('  -> PASS: Failed request restored schedule to previous state and displayed exact error toast.');

  // Test 4: Concurrency & Multiple Rapid Drags Protection
  console.log('\n[Test 4] Verifying Rapid Drag Sequence (A failed old update cannot overwrite newer update)...');
  // Scenario:
  // User drags to 12:00 (Request A)
  // User immediately drags to 16:00 (Request B) before Request A finishes
  // Request A fails later, but Request B succeeds.
  // The schedule must stay at 16:00 and NOT be rolled back by Request A's failure!

  let resolveRequestB = null;
  let rejectRequestA = null;

  mockPutHandler = (url, payload) => {
    if (payload.start_time === '12:00') {
      return new Promise((resolve, reject) => {
        rejectRequestA = () => reject({ status: 500, message: 'Network timeout' });
      });
    }
    if (payload.start_time === '16:00') {
      return new Promise((resolve) => {
        resolveRequestB = () => resolve({ success: true, data: payload });
      });
    }
    return Promise.resolve({ success: true, data: payload });
  };

  // Drag 1 -> 12:00
  harness.rescheduleEvent(101, '2026-10-31', '12:00', '13:00');
  assert.strictEqual(harness.getSchedulesList()[0].start_time, '12:00');

  // Drag 2 -> 16:00 immediately
  harness.rescheduleEvent(101, '2026-10-31', '16:00', '17:00');
  assert.strictEqual(harness.getSchedulesList()[0].start_time, '16:00');

  // Now Request A fails
  rejectRequestA();
  await new Promise((r) => setTimeout(r, 20));

  // Verify that the schedule DID NOT revert to 10:00 because Request B is newer!
  assert.strictEqual(harness.getSchedulesList()[0].start_time, '16:00', 'Schedule must remain at 16:00 despite Request A failure');

  // Now Request B succeeds
  resolveRequestB();
  await new Promise((r) => setTimeout(r, 20));

  assert.strictEqual(harness.getSchedulesList()[0].start_time, '16:00');
  assert.strictEqual(mockElements.calendarToast.textContent, 'Schedule rescheduled successfully!');
  console.log('  -> PASS: Newer drag state was preserved and not corrupted by older failed request.');

  // Test 5: Prevention of Duplicate Requests
  console.log('\n[Test 5] Verifying Prevention of Duplicate Rescheduling Requests...');
  let putCount = 0;
  mockPutHandler = () => {
    putCount++;
    return new Promise(() => {}); // Keep in-flight
  };

  // First drag to 18:00
  harness.rescheduleEvent(101, '2026-10-31', '18:00', '19:00');
  assert.strictEqual(putCount, 1, 'Initial request should be sent');

  // Rapid identical drag to same 18:00 slot while first is in-flight
  harness.rescheduleEvent(101, '2026-10-31', '18:00', '19:00');
  assert.strictEqual(putCount, 1, 'Duplicate identical request must NOT be sent');
  console.log('  -> PASS: Duplicate in-flight requests were successfully blocked.');

  console.log('\n>>> ALL 5 OPTIMISTIC UI SUITE TESTS PASSED 100%! <<<');
}

runTests().catch((err) => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
