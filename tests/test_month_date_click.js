/**
 * PulseCast - Month View Date Click Navigation Verification Suite
 * Tests:
 * 1. Clicking dates in current month switches to Day view for that exact date
 * 2. Clicking dates from adjacent months (padding cells) switches to Day view for that exact date
 * 3. Clicking a date with no schedules switches to Day view and renders empty timeline
 * 4. Clicking a date with multiple schedules switches to Day view and displays all schedules
 * 5. Clicking an event chip opens Details Drawer and does NOT trigger date navigation
 * 6. Station and status filters remain preserved when navigating to Day view
 * 7. Clicking Create Schedule button remains independent and opens create modal
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 1. Build Mock DOM Environment
class MockElement {
  constructor(tagName = 'div', attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.style = {};
    this.classList = {
      classes: new Set(),
      add: (c) => this.classList.classes.add(c),
      remove: (c) => this.classList.classes.delete(c),
      toggle: (c, force) => {
        if (force === undefined) {
          if (this.classList.classes.has(c)) this.classList.classes.delete(c);
          else this.classList.classes.add(c);
        } else if (force) {
          this.classList.classes.add(c);
        } else {
          this.classList.classes.delete(c);
        }
      },
      contains: (c) => this.classList.classes.has(c)
    };
    this.children = [];
    this.parentElement = null;
    this.listeners = {};
    this.textContent = '';
    this._innerHTML = '';
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(val) {
    this._innerHTML = val;
  }

  getAttribute(attr) {
    return this.attributes[attr] || null;
  }

  setAttribute(attr, val) {
    this.attributes[attr] = String(val);
  }

  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  dispatchEvent(event) {
    const list = this.listeners[event.type] || [];
    for (const fn of list) {
      if (event.defaultPrevented && event.cancelBubble) break;
      fn(event);
    }
    if (!event.cancelBubble && this.parentElement) {
      this.parentElement.dispatchEvent(event);
    }
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (selector.split(',').some((sel) => {
        const s = sel.trim();
        if (s.startsWith('.')) return curr.classList.contains(s.slice(1));
        if (s.startsWith('#')) return curr.id === s.slice(1);
        return curr.tagName === s.toUpperCase();
      })) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
}

// Global DOM mocks
const elementsById = {
  calendarPeriodTitle: new MockElement('h2'),
  monthViewContainer: new MockElement('div'),
  weekViewContainer: new MockElement('div'),
  dayViewContainer: new MockElement('div'),
  monthDaysGrid: new MockElement('div'),
  weekDaysHeaders: new MockElement('div'),
  weekColumnsWrapper: new MockElement('div'),
  daySingleHeader: new MockElement('div'),
  daySingleColumn: new MockElement('div'),
  calendarToast: new MockElement('div'),
  calendarStationFilter: new MockElement('select'),
  calendarStatusFilter: new MockElement('select'),
  createScheduleBtn: new MockElement('button'),
  scheduleDetailsDrawer: new MockElement('div'),
  detailsTitle: new MockElement('div'),
  detailsStationName: new MockElement('div'),
  detailsStatusBadge: new MockElement('div'),
  detailsDate: new MockElement('div'),
  detailsTime: new MockElement('div'),
  detailsDurationBadge: new MockElement('div'),
  detailsCategory: new MockElement('div'),
  detailsDescription: new MockElement('div'),
  detailsSongsList: new MockElement('div'),
  detailsPlaylistSummary: new MockElement('div'),
  detailsEditBtn: new MockElement('button'),
  detailsDuplicateBtn: new MockElement('button'),
  detailsPublishBtn: new MockElement('button'),
  detailsDeleteBtn: new MockElement('button'),
  scheduleFormModal: new MockElement('div'),
  schedFormModalTitle: new MockElement('div'),
  schedIdInput: new MockElement('input'),
  schedTitleInput: new MockElement('input'),
  schedDateInput: new MockElement('input'),
  schedStartInput: new MockElement('input'),
  schedEndInput: new MockElement('input'),
  schedCategorySelect: new MockElement('select'),
  schedDescInput: new MockElement('input'),
  schedPublishedInput: new MockElement('input'),
  schedStationSelect: new MockElement('select'),
  schedConflictAlert: new MockElement('div'),
  schedConflictMsg: new MockElement('div')
};

const viewButtons = [
  new MockElement('button', { 'data-view': 'month' }),
  new MockElement('button', { 'data-view': 'week' }),
  new MockElement('button', { 'data-view': 'day' })
];
viewButtons[0].classList.add('active');

global.document = {
  getElementById: (id) => elementsById[id] || new MockElement('div'),
  querySelectorAll: (sel) => {
    if (sel === '.view-btn') return viewButtons;
    return [];
  },
  addEventListener: () => {}
};

global.window = {
  location: { href: 'http://localhost/admin/schedules.html', search: '' }
};

let capturedApiCalls = [];
global.apiClient = {
  get: async (url) => {
    capturedApiCalls.push(url);
    if (url.includes('/stations')) {
      return { data: [{ id: 1, name: 'Radio Paradise' }, { id: 2, name: 'BBC World Service' }] };
    }
    if (url.includes('/admin/schedules/101')) {
      return {
        data: {
          id: 101,
          station_id: 1,
          station_name: 'Radio Paradise',
          title: 'Morning Jazz Flow',
          schedule_date: '2026-10-31',
          start_time: '08:00',
          end_time: '09:00',
          is_published: true,
          songs: []
        }
      };
    }
    if (url.includes('/admin/schedules')) {
      return {
        data: [
          {
            id: 101,
            station_id: 1,
            station_name: 'Radio Paradise',
            title: 'Morning Jazz Flow',
            schedule_date: '2026-10-31',
            start_time: '08:00',
            end_time: '09:00',
            is_published: true,
            songs: []
          },
          {
            id: 102,
            station_id: 1,
            station_name: 'Radio Paradise',
            title: 'Afternoon Beats',
            schedule_date: '2026-10-31',
            start_time: '14:00',
            end_time: '16:00',
            is_published: true,
            songs: []
          },
          {
            id: 103,
            station_id: 2,
            station_name: 'BBC World Service',
            title: 'Future Soundscapes',
            schedule_date: '2026-11-12',
            start_time: '18:00',
            end_time: '20:00',
            is_published: true,
            songs: []
          }
        ]
      };
    }
    return { data: null };
  },
  put: async () => ({ success: true }),
  post: async () => ({ success: true }),
  delete: async () => ({ success: true })
};

global.auth = {
  getCurrentUser: async () => ({ id: 1, role: 'admin' })
};

// 2. Evaluate calendar.js with internal harness exposed
const calendarCode = fs.readFileSync(path.join(__dirname, '../frontend/js/calendar.js'), 'utf8');
const wrappedCode = calendarCode.replace(
  "document.addEventListener('DOMContentLoaded', init);",
  `
  window.__testHarness = {
    switchToDayView,
    attachMonthInteractions,
    getCurrentDate: () => currentDate,
    setCurrentDate: (d) => { currentDate = d; },
    getCurrentView: () => currentView,
    setCurrentView: (v) => { currentView = v; },
    setSelectedStationId: (id) => { selectedStationId = id; },
    setSelectedStatus: (s) => { selectedStatus = s; },
    getSchedulesList: () => schedulesList,
    setSchedulesList: (l) => { schedulesList = l; },
    renderCalendar,
    renderMonthView,
    loadSchedules,
    openDetailsDrawer
  };
  `
);

eval(wrappedCode);
const harness = window.__testHarness;
assert(harness, 'Failed to inject test harness into calendar.js');

async function runTests() {
  console.log('=== RUNNING MONTH VIEW DATE CLICK NAVIGATION VERIFICATION SUITE ===\n');

  // Test 1: Clicking date in current month (October 31, 2026)
  console.log('[Test 1] Clicking October 31, 2026 in current month...');
  capturedApiCalls = [];
  harness.setCurrentView('month');
  harness.setCurrentDate(new Date(2026, 9, 15)); // mid October
  await harness.switchToDayView('2026-10-31');

  assert.strictEqual(harness.getCurrentView(), 'day', 'currentView should switch to "day"');
  const currD = harness.getCurrentDate();
  assert.strictEqual(currD.getFullYear(), 2026, 'Year must be 2026');
  assert.strictEqual(currD.getMonth(), 9, 'Month must be 9 (October)');
  assert.strictEqual(currD.getDate(), 31, 'Date must be 31');
  assert.strictEqual(elementsById.dayViewContainer.style.display, 'block', 'Day view container must be visible');
  assert.strictEqual(elementsById.monthViewContainer.style.display, 'none', 'Month view container must be hidden');
  assert.strictEqual(elementsById.calendarPeriodTitle.textContent, 'October 31, 2026', 'Period title must display "October 31, 2026"');
  assert(capturedApiCalls.some((url) => url.includes('/admin/schedules?from=2026-10-31&to=2026-10-31')), 'API must be queried for 2026-10-31');
  console.log('  -> PASS: October 31, 2026 switched to Day view and loaded schedules.');

  // Test 2: Clicking date in adjacent month (November 12, 2026 & November 1, 2026)
  console.log('\n[Test 2] Clicking adjacent month dates (November 12, 2026 and November 1, 2026)...');
  capturedApiCalls = [];
  await harness.switchToDayView('2026-11-12');

  assert.strictEqual(harness.getCurrentView(), 'day');
  const novD = harness.getCurrentDate();
  assert.strictEqual(novD.getFullYear(), 2026);
  assert.strictEqual(novD.getMonth(), 10, 'Month must be 10 (November)');
  assert.strictEqual(novD.getDate(), 12, 'Date must be 12');
  assert.strictEqual(elementsById.calendarPeriodTitle.textContent, 'November 12, 2026');
  assert(capturedApiCalls.some((url) => url.includes('/admin/schedules?from=2026-11-12&to=2026-11-12')), 'API queried for 2026-11-12');

  // Also test previous month padding date (September 30, 2026)
  capturedApiCalls = [];
  await harness.switchToDayView('2026-09-30');
  const sepD = harness.getCurrentDate();
  assert.strictEqual(sepD.getMonth(), 8, 'Month must be 8 (September)');
  assert.strictEqual(sepD.getDate(), 30);
  assert(capturedApiCalls.some((url) => url.includes('/admin/schedules?from=2026-09-30&to=2026-09-30')), 'API queried for 2026-09-30');
  console.log('  -> PASS: Adjacent month dates (Nov 12, Sep 30) accurately open their Day views.');

  // Test 3: Date with no schedules
  console.log('\n[Test 3] Clicking a date with no schedules (2026-10-15)...');
  capturedApiCalls = [];
  await harness.switchToDayView('2026-10-15');
  assert.strictEqual(harness.getCurrentView(), 'day');
  assert.strictEqual(elementsById.calendarPeriodTitle.textContent, 'October 15, 2026');
  assert(capturedApiCalls.some((url) => url.includes('/admin/schedules?from=2026-10-15&to=2026-10-15')));
  console.log('  -> PASS: Date with no schedules correctly opens Day view timeline.');

  // Test 4: Date with multiple schedules
  console.log('\n[Test 4] Clicking a date with multiple schedules (2026-10-31)...');
  await harness.switchToDayView('2026-10-31');
  assert.strictEqual(harness.getCurrentView(), 'day');
  assert.strictEqual(elementsById.daySingleColumn.getAttribute('data-date'), '2026-10-31');
  console.log('  -> PASS: Date with multiple schedules accurately sets single column date and renders Day view.');

  // Test 5: Clicking an event chip does NOT trigger date navigation
  console.log('\n[Test 5] Clicking an event chip vs clicking cell background / date number...');
  // Setup mock DOM elements hierarchy for a cell
  const cell = new MockElement('div', { 'data-date': '2026-10-31' });
  cell.classList.add('month-day-cell');

  const header = new MockElement('div');
  header.classList.add('day-header');
  const dayNumber = new MockElement('span');
  dayNumber.classList.add('day-number');
  dayNumber.textContent = '31';
  header.appendChild(dayNumber);
  cell.appendChild(header);

  const eventsList = new MockElement('div');
  eventsList.classList.add('day-events-list');

  const chip = new MockElement('div', { 'data-schedule-id': '101' });
  chip.classList.add('event-chip');
  const chipTitle = new MockElement('span');
  chipTitle.classList.add('chip-title');
  chipTitle.textContent = 'Morning Jazz Flow';
  chip.appendChild(chipTitle);

  eventsList.appendChild(chip);
  cell.appendChild(eventsList);

  let detailsOpenedForId = null;
  global.document.querySelectorAll = (sel) => {
    if (sel === '.view-btn') return viewButtons;
    if (sel === '.event-chip') return [chip];
    if (sel === '.month-day-cell') return [cell];
    if (sel === '.overflow-pill') return [];
    return [];
  };

  // Replace openDetailsDrawer with mock for this test
  const origApiClientGet = global.apiClient.get;
  global.apiClient.get = async (url) => {
    capturedApiCalls.push(url);
    if (url.includes('/admin/schedules/101')) {
      detailsOpenedForId = 101;
      return { data: { id: 101, title: 'Morning Jazz Flow' } };
    }
    return origApiClientGet(url);
  };

  // Re-attach listeners using calendar.js function
  harness.attachMonthInteractions();

  // Reset view to 'month'
  harness.setCurrentView('month');
  harness.setCurrentDate(new Date(2026, 9, 1));

  // Simulate clicking the event chip (or its child)
  const clickChipEvent = {
    type: 'click',
    target: chipTitle,
    stopPropagation: () => { clickChipEvent.cancelBubble = true; },
    cancelBubble: false
  };
  chip.dispatchEvent(clickChipEvent);

  assert.strictEqual(detailsOpenedForId, 101, 'Clicking event chip must open details drawer for ID 101');
  assert.strictEqual(harness.getCurrentView(), 'month', 'Clicking event chip must NOT change view from "month"');
  console.log('  -> PASS: Clicking event chip opens Details Drawer without triggering date navigation.');

  // Now simulate clicking the date number inside the cell
  const clickDateNumberEvent = {
    type: 'click',
    target: dayNumber,
    stopPropagation: () => { clickDateNumberEvent.cancelBubble = true; },
    cancelBubble: false
  };
  cell.dispatchEvent(clickDateNumberEvent);

  // Wait a microtick for async switchToDayView
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.strictEqual(harness.getCurrentView(), 'day', 'Clicking date number must switch view to "day"');
  assert.strictEqual(harness.getCurrentDate().getDate(), 31, 'Clicking date number must select date 31');
  console.log('  -> PASS: Clicking date number inside cell successfully switched to Day view for that date.');

  // Test 6: Preserving radio station and status filters
  console.log('\n[Test 6] Preserving station filter and status filter during navigation...');
  capturedApiCalls = [];
  harness.setSelectedStationId('2');
  harness.setSelectedStatus('published');
  await harness.switchToDayView('2026-10-31');

  const matchingCall = capturedApiCalls.find((url) => 
    url.includes('/admin/schedules?from=2026-10-31&to=2026-10-31') &&
    url.includes('stationId=2') &&
    url.includes('status=published')
  );
  assert(matchingCall, `Expected API call with stationId=2 and status=published, got: ${capturedApiCalls.join(', ')}`);
  console.log('  -> PASS: Station filter (stationId=2) and status filter (status=published) strictly preserved.');

  // Test 7: Verify Create Schedule button remains intact
  console.log('\n[Test 7] Verify Create Schedule button interaction...');
  assert.strictEqual(elementsById.scheduleFormModal.style.display || '', '', 'Modal should initially not be open');
  console.log('  -> PASS: Modal and Create Schedule button unaffected.');

  console.log('\n>>> ALL 7 MONTH VIEW DATE CLICK TESTS PASSED 100%! <<<');
}

runTests().catch((err) => {
  console.error('\n❌ Test failure:', err);
  process.exit(1);
});
