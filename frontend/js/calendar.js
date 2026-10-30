/**
 * PulseCast Radio - Enhanced Google Calendar-Style Admin Scheduling Controller
 * (frontend/js/calendar.js)
 * Implements Month, Week, and Day Calendar Views, Right-Side Details Drawer,
 * Current-Time Indicator, Drag-and-Drop Rescheduling, Song Assignment & Conflict Handling
 */

(function () {
  'use strict';

  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------
  let currentDate = new Date();
  let currentView = 'month'; // 'month' | 'week' | 'day'
  let selectedStationId = 'all';
  let selectedStatus = 'all';

  let stationsList = [];
  let schedulesList = [];
  let formSongs = []; // Songs currently in the create/edit modal
  let activeDetailsSchedule = null;

  // Drag-and-drop state
  let draggedEventId = null;
  let draggedDurationMinutes = 60;
  let draggedStationId = null;

  // Harmonious station palette with rich contrast
  const STATION_PALETTE = [
    { border: '#06b6d4', bg: 'rgba(6, 182, 212, 0.15)', text: '#38bdf8' },  // Cyan
    { border: '#a855f7', bg: 'rgba(168, 85, 247, 0.15)', text: '#c084fc' }, // Purple
    { border: '#10b981', bg: 'rgba(16, 185, 129, 0.15)', text: '#34d399' }, // Emerald
    { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', text: '#fbbf24' }, // Amber
    { border: '#ec4899', bg: 'rgba(236, 72, 153, 0.15)', text: '#f472b6' }, // Pink
    { border: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)', text: '#60a5fa' }, // Blue
    { border: '#f97316', bg: 'rgba(249, 115, 22, 0.15)', text: '#fb923c' }  // Orange
  ];

  function getStationColorConfig(stationId) {
    const id = parseInt(stationId, 10) || 1;
    return STATION_PALETTE[(id - 1) % STATION_PALETTE.length];
  }

  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------
  async function checkAdminAuth() {
    try {
      const user = await auth.getCurrentUser();
      if (!user || user.role !== 'admin') {
        alert('Access restricted. Please sign in with an Administrator account.');
        window.location.href = '/login.html';
        return false;
      }
      return true;
    } catch {
      window.location.href = '/login.html';
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Date Helpers (Timezone-Safe Local Parsing & Formatting)
  // --------------------------------------------------------------------------
  function formatDateKey(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseDateKey(str) {
    if (!str) return new Date();
    const parts = str.split('-');
    if (parts.length === 3) {
      const [y, m, d] = parts.map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date();
  }

  function isSameDay(d1, d2) {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  }

  function getStartOfWeek(d) {
    const date = new Date(d);
    const day = date.getDay(); // 0 is Sunday
    const diff = date.getDate() - day;
    return new Date(date.setDate(diff));
  }

  function timeToMinutes(t) {
    if (!t || typeof t !== 'string') return 0;
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  function minutesToTime(min) {
    const bounded = Math.max(0, Math.min(1439, Math.round(min)));
    const h = String(Math.floor(bounded / 60)).padStart(2, '0');
    const m = String(bounded % 60).padStart(2, '0');
    return `${h}:${m}`;
  }

  function formatMinutesToHours(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return `${m}m`;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, (t) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[t] || t));
  }

  function formatReadableDate(dateStr) {
    const d = parseDateKey(dateStr);
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return d.toLocaleDateString('en-US', options);
  }

  /**
   * Universal Schedule Date Matcher
   * Matches if schedule has explicit date matching dateKey OR is a daily recurring show
   */
  function isScheduleActiveOnDate(s, dateKey) {
    if (!s) return false;
    if (s.is_recurring || !s.schedule_date || s.schedule_date === 'daily') {
      return true;
    }
    return s.schedule_date === dateKey;
  }

  // --------------------------------------------------------------------------
  // Toast Notifications
  // --------------------------------------------------------------------------
  function showToast(message, type = 'info') {
    const toast = document.getElementById('calendarToast');
    if (!toast) return;

    toast.textContent = message;
    toast.className = `calendar-toast show ${type}`;

    setTimeout(() => {
      toast.className = 'calendar-toast';
    }, 3500);
  }

  // --------------------------------------------------------------------------
  // Data Fetching
  // --------------------------------------------------------------------------
  async function loadStations() {
    try {
      const resp = await apiClient.get('/stations?all=true');
      stationsList = resp && resp.data ? resp.data : [];

      const filterSelect = document.getElementById('calendarStationFilter');
      const formStationSelect = document.getElementById('schedStationSelect');

      if (filterSelect) {
        filterSelect.innerHTML =
          '<option value="all">All Stations</option>' +
          stationsList
            .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
            .join('');
      }

      if (formStationSelect) {
        formStationSelect.innerHTML = stationsList
          .map((s) => `<option value="${s.id}">#${s.id} - ${escapeHtml(s.name)}</option>`)
          .join('');
      }

      // Check URL query parameters (e.g. ?station=1)
      const urlParams = new URLSearchParams(window.location.search);
      const urlStation = urlParams.get('station');
      if (urlStation && stationsList.some((s) => String(s.id) === String(urlStation))) {
        selectedStationId = urlStation;
        if (filterSelect) filterSelect.value = urlStation;
      }
    } catch (err) {
      console.error('Failed to load stations:', err);
    }
  }

  async function loadSchedules() {
    try {
      // Calculate visible date range based on current view
      let from, to;
      if (currentView === 'month') {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        from = formatDateKey(new Date(year, month - 1, 15));
        to = formatDateKey(new Date(year, month + 2, 15));
      } else if (currentView === 'week') {
        const start = getStartOfWeek(currentDate);
        const end = new Date(start);
        end.setDate(end.getDate() + 7);
        from = formatDateKey(start);
        to = formatDateKey(end);
      } else {
        from = formatDateKey(currentDate);
        to = formatDateKey(currentDate);
      }

      let url = `/admin/schedules?from=${from}&to=${to}`;
      if (selectedStationId !== 'all') {
        url += `&stationId=${selectedStationId}`;
      }
      if (selectedStatus !== 'all') {
        url += `&status=${selectedStatus}`;
      }

      const resp = await apiClient.get(url);
      schedulesList = resp && resp.data ? resp.data : [];
      renderCalendar();
    } catch (err) {
      console.error('Failed to load schedules:', err);
      showToast('Error loading schedule entries', 'error');
    }
  }

  // --------------------------------------------------------------------------
  // Calendar Renderers
  // --------------------------------------------------------------------------
  function updatePeriodTitle() {
    const titleEl = document.getElementById('calendarPeriodTitle');
    if (!titleEl) return;

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    if (currentView === 'month') {
      titleEl.textContent = `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    } else if (currentView === 'week') {
      const start = getStartOfWeek(currentDate);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);

      const sameMonth = start.getMonth() === end.getMonth();
      if (sameMonth) {
        titleEl.textContent = `${monthNames[start.getMonth()]} ${start.getDate()} – ${end.getDate()}, ${start.getFullYear()}`;
      } else {
        titleEl.textContent = `${monthNames[start.getMonth()]} ${start.getDate()} – ${monthNames[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
      }
    } else {
      titleEl.textContent = `${monthNames[currentDate.getMonth()]} ${currentDate.getDate()}, ${currentDate.getFullYear()}`;
    }
  }

  function renderCalendar() {
    updatePeriodTitle();

    const monthContainer = document.getElementById('monthViewContainer');
    const weekContainer = document.getElementById('weekViewContainer');
    const dayContainer = document.getElementById('dayViewContainer');

    if (monthContainer) monthContainer.style.display = currentView === 'month' ? 'block' : 'none';
    if (weekContainer) weekContainer.style.display = currentView === 'week' ? 'block' : 'none';
    if (dayContainer) dayContainer.style.display = currentView === 'day' ? 'block' : 'none';

    if (currentView === 'month') renderMonthView();
    else if (currentView === 'week') renderWeekView();
    else if (currentView === 'day') renderDayView();
  }

  /* 1. Month View */
  function renderMonthView() {
    const grid = document.getElementById('monthDaysGrid');
    if (!grid) return;

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const startDayOfWeek = firstDay.getDay(); // 0 is Sunday
    const totalDays = lastDay.getDate();

    const today = new Date();
    let html = '';

    // Previous month padding
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const padDate = new Date(year, month - 1, prevMonthLastDay - i);
      const dateKey = formatDateKey(padDate);
      html += createMonthCellHtml(padDate, dateKey, true, false);
    }

    // Current month days
    for (let day = 1; day <= totalDays; day++) {
      const thisDate = new Date(year, month, day);
      const dateKey = formatDateKey(thisDate);
      const isToday = isSameDay(thisDate, today);
      html += createMonthCellHtml(thisDate, dateKey, false, isToday);
    }

    // Next month padding to fill complete 7-day rows (up to 42 cells)
    const filledCells = startDayOfWeek + totalDays;
    const remaining = (7 - (filledCells % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      const nextDate = new Date(year, month + 1, i);
      const dateKey = formatDateKey(nextDate);
      html += createMonthCellHtml(nextDate, dateKey, true, false);
    }

    grid.innerHTML = html;
    attachMonthInteractions();
  }

  function createMonthCellHtml(dateObj, dateKey, isOtherMonth, isToday) {
    const daySchedules = schedulesList.filter((s) => isScheduleActiveOnDate(s, dateKey));

    const maxVisible = 3;
    const visibleEvents = daySchedules.slice(0, maxVisible);
    const overflowCount = daySchedules.length - maxVisible;

    const eventsHtml = visibleEvents
      .map((s) => {
        const colorCfg = getStationColorConfig(s.station_id);
        const isDraft = !s.is_published;
        return `
          <div class="event-chip ${isDraft ? 'draft' : ''}" 
               style="border-left-color: ${colorCfg.border};" 
               data-schedule-id="${s.id}" 
               title="${escapeHtml(s.title)} (${escapeHtml(s.start_time)} - ${escapeHtml(s.end_time)})">
            <span class="chip-dot" style="background: ${colorCfg.border};"></span>
            <span class="chip-time">${escapeHtml(s.start_time)}</span>
            <span class="chip-title">${escapeHtml(s.title)}</span>
            ${isDraft ? '<span class="chip-draft-tag">Draft</span>' : ''}
          </div>
        `;
      })
      .join('');

    const overflowHtml = overflowCount > 0 
      ? `<div class="overflow-pill" data-date="${dateKey}">+${overflowCount} more</div>` 
      : '';

    return `
      <div class="month-day-cell ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'is-today' : ''}" data-date="${dateKey}">
        <div class="day-header">
          <span class="day-number">${dateObj.getDate()}</span>
        </div>
        <div class="day-events-list">
          ${eventsHtml}
          ${overflowHtml}
        </div>
      </div>
    `;
  }

  /* 2. Week View */
  function renderWeekView() {
    const headersContainer = document.getElementById('weekDaysHeaders');
    const columnsContainer = document.getElementById('weekColumnsWrapper');
    if (!headersContainer || !columnsContainer) return;

    const startOfWeek = getStartOfWeek(currentDate);
    const today = new Date();
    const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    let headersHtml = '';
    let columnsHtml = '';

    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(startOfWeek);
      dayDate.setDate(dayDate.getDate() + i);
      const dateKey = formatDateKey(dayDate);
      const isToday = isSameDay(dayDate, today);

      headersHtml += `
        <div class="timeline-day-header-cell ${isToday ? 'is-today' : ''}">
          <div class="weekday-name">${weekdayNames[i]}</div>
          <div class="day-badge">${dayDate.getDate()}</div>
        </div>
      `;

      // Filter events for this day
      const dayEvents = schedulesList.filter((s) => isScheduleActiveOnDate(s, dateKey));
      const eventsHtml = dayEvents
        .map((s) => renderTimelineEventBlock(s, dateKey))
        .join('');

      // Add current time indicator if today
      const indicatorHtml = isToday ? renderCurrentTimeIndicator() : '';

      columnsHtml += `
        <div class="timeline-day-column ${isToday ? 'is-today' : ''}" data-date="${dateKey}">
          ${indicatorHtml}
          ${eventsHtml}
        </div>
      `;
    }

    headersContainer.innerHTML = headersHtml;
    columnsContainer.innerHTML = columnsHtml;
    attachTimelineInteractions();
  }

  /* 3. Day View */
  function renderDayView() {
    const headersContainer = document.getElementById('daySingleHeader');
    const columnContainer = document.getElementById('daySingleColumn');
    if (!headersContainer || !columnContainer) return;

    const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dateKey = formatDateKey(currentDate);
    const isToday = isSameDay(currentDate, new Date());

    headersContainer.innerHTML = `
      <div class="timeline-day-header-cell ${isToday ? 'is-today' : ''}" style="width: 100%;">
        <div class="weekday-name">${weekdayNames[currentDate.getDay()]}</div>
        <div class="day-badge" style="display:inline-block;">${currentDate.getDate()}</div>
      </div>
    `;

    columnContainer.setAttribute('data-date', dateKey);

    const dayEvents = schedulesList.filter((s) => isScheduleActiveOnDate(s, dateKey));
    const eventsHtml = dayEvents
      .map((s) => renderTimelineEventBlock(s, dateKey))
      .join('');

    const indicatorHtml = isToday ? renderCurrentTimeIndicator() : '';

    columnContainer.innerHTML = indicatorHtml + eventsHtml;
    attachTimelineInteractions();
  }

  function renderTimelineEventBlock(s, dateKey) {
    const startMin = timeToMinutes(s.start_time);
    let endMin = timeToMinutes(s.end_time);
    if (endMin <= startMin) endMin += 1440; // Midnight span handle

    const duration = Math.max(endMin - startMin, 25);
    const isShort = duration < 45;
    const topPx = startMin;
    const heightPx = Math.min(duration, 1440 - topPx);
    const colorCfg = getStationColorConfig(s.station_id);
    const isDraft = !s.is_published;

    if (isShort) {
      return `
        <div class="timeline-event-block compact ${isDraft ? 'draft' : ''}" 
             draggable="true"
             style="top: ${topPx}px; height: ${heightPx}px; border-left-color: ${colorCfg.border};" 
             data-schedule-id="${s.id}"
             data-duration="${duration}"
             data-station-id="${s.station_id}"
             data-date="${dateKey}"
             title="${escapeHtml(s.title)} · ${escapeHtml(s.start_time)} - ${escapeHtml(s.end_time)} (${escapeHtml(s.station_name)})">
          <div class="event-block-title" style="color: ${colorCfg.text};">${escapeHtml(s.title)}</div>
          <div class="event-block-meta">
            <span>${escapeHtml(s.start_time)}</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="timeline-event-block ${isDraft ? 'draft' : ''}" 
           draggable="true"
           style="top: ${topPx}px; height: ${heightPx}px; border-left-color: ${colorCfg.border};" 
           data-schedule-id="${s.id}"
           data-duration="${duration}"
           data-station-id="${s.station_id}"
           data-date="${dateKey}"
           title="${escapeHtml(s.title)} (${escapeHtml(s.start_time)} - ${escapeHtml(s.end_time)})">
        <div class="event-block-title">${escapeHtml(s.title)}</div>
        <div class="event-block-meta">
          <span class="event-block-station" style="color: ${colorCfg.text};">${escapeHtml(s.station_name)}</span>
          <span>${escapeHtml(s.start_time)} - ${escapeHtml(s.end_time)}</span>
          ${isDraft ? '<span class="badge-status inactive" style="font-size:0.65rem; padding:0.1rem 0.35rem;">Draft</span>' : ''}
        </div>
        ${s.description && duration >= 60 ? `<div style="font-size:0.72rem; color:var(--text-muted); margin-top:0.25rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(s.description)}</div>` : ''}
      </div>
    `;
  }

  function renderCurrentTimeIndicator() {
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    return `
      <div class="current-time-indicator" style="top: ${currentMins}px;">
        <span class="current-time-badge">${timeStr}</span>
      </div>
    `;
  }

  // --------------------------------------------------------------------------
  // Interactions (Month, Timeline, Drag-and-Drop)
  // --------------------------------------------------------------------------
  function attachMonthInteractions() {
    // Click on event chip -> Slide-over Details Drawer
    document.querySelectorAll('.event-chip').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = chip.getAttribute('data-schedule-id');
        openDetailsDrawer(id);
      });
    });

    // Click on empty day cell -> Create Modal with that date
    document.querySelectorAll('.month-day-cell').forEach((cell) => {
      cell.addEventListener('click', () => {
        const dateKey = cell.getAttribute('data-date');
        openCreateModal(dateKey, '09:00', '10:00');
      });
    });

    // Click on overflow pill -> switch to Day view
    document.querySelectorAll('.overflow-pill').forEach((pill) => {
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        const dateKey = pill.getAttribute('data-date');
        currentDate = parseDateKey(dateKey);
        currentView = 'day';
        updateViewButtons();
        renderCalendar();
      });
    });
  }

  function attachTimelineInteractions() {
    // Click on event block -> Open Right-Side Details Drawer
    document.querySelectorAll('.timeline-event-block').forEach((block) => {
      block.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = block.getAttribute('data-schedule-id');
        openDetailsDrawer(id);
      });

      // Drag and Drop support
      block.addEventListener('dragstart', (e) => {
        draggedEventId = block.getAttribute('data-schedule-id');
        draggedDurationMinutes = parseInt(block.getAttribute('data-duration'), 10) || 60;
        draggedStationId = block.getAttribute('data-station-id');
        block.classList.add('dragging');
        e.dataTransfer.setData('text/plain', draggedEventId);
        e.dataTransfer.effectAllowed = 'move';
      });

      block.addEventListener('dragend', () => {
        block.classList.remove('dragging');
        document.querySelectorAll('.drop-preview-indicator').forEach((p) => p.remove());
        document.querySelectorAll('.timeline-day-column').forEach((c) => c.classList.remove('drag-over'));
      });
    });

    // Column click -> Create Modal with clicked hour
    document.querySelectorAll('.timeline-day-column, #daySingleColumn').forEach((col) => {
      col.addEventListener('click', (e) => {
        // Ignore if clicking on an event block
        if (e.target.closest('.timeline-event-block')) return;

        const rect = col.getBoundingClientRect();
        const clickY = e.clientY - rect.top; // pixel offset = minute
        const hour = Math.floor(clickY / 60);
        const minute = Math.floor((clickY % 60) / 15) * 15; // Snap to 15m

        const startHour = String(Math.max(0, Math.min(22, hour))).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
        const endHourVal = Math.min(1439, hour * 60 + minute + 60);
        const endHour = minutesToTime(endHourVal);
        const dateKey = col.getAttribute('data-date') || formatDateKey(currentDate);

        openCreateModal(dateKey, startHour, endHour);
      });

      // Drag Over on Column
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('drag-over');

        const rect = col.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        const snappedMinutes = Math.floor(offsetY / 15) * 15;

        let preview = col.querySelector('.drop-preview-indicator');
        if (!preview) {
          preview = document.createElement('div');
          preview.className = 'drop-preview-indicator';
          col.appendChild(preview);
        }

        const previewHeight = Math.max(30, draggedDurationMinutes);
        preview.style.top = `${snappedMinutes}px`;
        preview.style.height = `${previewHeight}px`;
        preview.textContent = `${minutesToTime(snappedMinutes)} - ${minutesToTime(snappedMinutes + draggedDurationMinutes)}`;
      });

      col.addEventListener('dragleave', (e) => {
        if (!col.contains(e.relatedTarget)) {
          col.classList.remove('drag-over');
          col.querySelector('.drop-preview-indicator')?.remove();
        }
      });

      // Drop on Column
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        col.querySelector('.drop-preview-indicator')?.remove();

        const scheduleId = draggedEventId || e.dataTransfer.getData('text/plain');
        if (!scheduleId) return;

        const rect = col.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        const newStartMinutes = Math.floor(offsetY / 15) * 15;
        const newEndMinutes = newStartMinutes + draggedDurationMinutes;

        const newStartTime = minutesToTime(newStartMinutes);
        const newEndTime = minutesToTime(newEndMinutes);
        const newDate = col.getAttribute('data-date') || formatDateKey(currentDate);

        await rescheduleEvent(scheduleId, newDate, newStartTime, newEndTime);
      });
    });
  }

  // --------------------------------------------------------------------------
  // Drag-and-Drop Reschedule Execution & Conflict Handling
  // --------------------------------------------------------------------------
  async function rescheduleEvent(scheduleId, newDate, newStartTime, newEndTime) {
    try {
      // 1. Fetch current schedule details
      const resp = await apiClient.get(`/admin/schedules/${scheduleId}`);
      const sched = resp && resp.data ? resp.data : null;
      if (!sched) return;

      const payload = {
        station_id: sched.station_id,
        title: sched.title,
        schedule_date: newDate,
        start_time: newStartTime,
        end_time: newEndTime,
        category: sched.category || 'Music',
        description: sched.description || '',
        is_published: sched.is_published,
        songs: sched.songs || []
      };

      // 2. Perform backend update with conflict validation
      await apiClient.put(`/admin/schedules/${scheduleId}`, payload);

      showToast(`Rescheduled "${sched.title}" to ${newStartTime} - ${newEndTime}`, 'success');
      await loadSchedules();
    } catch (err) {
      if (err.status === 409 || err.conflict || (err.message && err.message.toLowerCase().includes('conflict'))) {
        showToast(`Cannot reschedule: ${err.message || 'Overlaps with another programme'}`, 'error');
      } else {
        showToast(err.message || 'Failed to reschedule event', 'error');
      }
      // Re-render to ensure visual consistency
      renderCalendar();
    }
  }

  function updateViewButtons() {
    document.querySelectorAll('.view-btn').forEach((btn) => {
      const view = btn.getAttribute('data-view');
      btn.classList.toggle('active', view === currentView);
    });
  }

  // --------------------------------------------------------------------------
  // Right-Side Details Drawer (Slide-Over Panel)
  // --------------------------------------------------------------------------
  async function openDetailsDrawer(scheduleId) {
    const drawer = document.getElementById('scheduleDetailsDrawer');
    if (!drawer) return;

    try {
      const resp = await apiClient.get(`/admin/schedules/${scheduleId}`);
      const sched = resp && resp.data ? resp.data : null;
      if (!sched) return;

      activeDetailsSchedule = sched;

      document.getElementById('detailsTitle').textContent = sched.title;
      document.getElementById('detailsStationName').textContent = sched.station_name;
      
      const badge = document.getElementById('detailsStatusBadge');
      badge.className = `badge-status ${sched.is_published ? 'active' : 'inactive'}`;
      badge.textContent = sched.is_published ? 'Published' : 'Draft';

      document.getElementById('detailsDate').textContent = formatReadableDate(sched.schedule_date);
      document.getElementById('detailsTime').textContent = `${sched.start_time} - ${sched.end_time}`;

      const durationMin = timeToMinutes(sched.end_time) - timeToMinutes(sched.start_time);
      const displayDuration = durationMin > 0 ? formatMinutesToHours(durationMin) : '24h span';
      document.getElementById('detailsDurationBadge').textContent = displayDuration;

      document.getElementById('detailsCategory').textContent = sched.category || 'Music';
      document.getElementById('detailsDescription').textContent = sched.description || 'No description or DJ host notes provided.';

      // Render songs
      const songsContainer = document.getElementById('detailsSongsList');
      const summaryPill = document.getElementById('detailsPlaylistSummary');
      const songs = sched.songs || [];

      if (summaryPill) {
        summaryPill.textContent = `${songs.length} track${songs.length !== 1 ? 's' : ''}`;
      }

      if (songs.length === 0) {
        songsContainer.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem; padding:0.5rem 0;">No tracks assigned to this broadcast session.</div>';
      } else {
        songsContainer.innerHTML = songs
          .map(
            (s, idx) => `
            <div class="selected-song-item" style="padding:0.45rem 0.65rem;">
              <span class="song-order-num">#${idx + 1}</span>
              <div class="song-info">
                <div class="song-title-text">${escapeHtml(s.title)}</div>
                <div class="song-artist-text">${escapeHtml(s.artist || 'Unknown Artist')}</div>
              </div>
              <span class="song-duration-pill">${escapeHtml(s.duration || '03:45')}</span>
            </div>
          `
          )
          .join('');
      }

      // Actions
      const editBtn = document.getElementById('detailsEditBtn');
      const dupBtn = document.getElementById('detailsDuplicateBtn');
      const pubBtn = document.getElementById('detailsPublishBtn');
      const delBtn = document.getElementById('detailsDeleteBtn');

      editBtn.onclick = () => {
        closeDetailsDrawer();
        openEditModal(sched.id);
      };

      dupBtn.onclick = async () => {
        try {
          await apiClient.post(`/admin/schedules/${sched.id}/duplicate`);
          closeDetailsDrawer();
          showToast(`Created draft duplicate of "${sched.title}"`, 'success');
          await loadSchedules();
        } catch (err) {
          showToast('Failed to duplicate: ' + err.message, 'error');
        }
      };

      pubBtn.textContent = sched.is_published ? 'Unpublish' : 'Publish';
      pubBtn.onclick = async () => {
        try {
          await apiClient.patch(`/admin/schedules/${sched.id}/publish`);
          closeDetailsDrawer();
          showToast(`Updated status for "${sched.title}"`, 'success');
          await loadSchedules();
        } catch (err) {
          if (err.status === 409 || err.conflict) {
            showToast(err.message || 'Cannot publish: Overlaps with existing show', 'error');
          } else {
            showToast('Failed to toggle status: ' + err.message, 'error');
          }
        }
      };

      delBtn.onclick = async () => {
        if (confirm(`Are you sure you want to permanently delete schedule "${sched.title}"?`)) {
          try {
            await apiClient.delete(`/admin/schedules/${sched.id}`);
            closeDetailsDrawer();
            showToast(`Deleted programme "${sched.title}"`, 'info');
            await loadSchedules();
          } catch (err) {
            showToast('Failed to delete schedule: ' + err.message, 'error');
          }
        }
      };

      drawer.classList.add('open');
    } catch (err) {
      showToast('Error loading schedule details: ' + err.message, 'error');
    }
  }

  function closeDetailsDrawer() {
    const drawer = document.getElementById('scheduleDetailsDrawer');
    if (drawer) drawer.classList.remove('open');
    activeDetailsSchedule = null;
  }

  // --------------------------------------------------------------------------
  // Modals (Create & Edit Form)
  // --------------------------------------------------------------------------
  function openCreateModal(dateStr, start = '09:00', end = '10:00') {
    closeDetailsDrawer();
    const modal = document.getElementById('scheduleFormModal');
    if (!modal) return;

    document.getElementById('schedFormModalTitle').textContent = 'Create Program Schedule';
    document.getElementById('schedIdInput').value = '';
    document.getElementById('schedTitleInput').value = '';
    document.getElementById('schedDateInput').value = dateStr || formatDateKey(currentDate);
    document.getElementById('schedStartInput').value = start;
    document.getElementById('schedEndInput').value = end;
    document.getElementById('schedCategorySelect').value = 'Music';
    document.getElementById('schedDescInput').value = '';
    document.getElementById('schedPublishedInput').checked = true;

    if (selectedStationId !== 'all' && stationsList.some((s) => s.id === parseInt(selectedStationId, 10))) {
      document.getElementById('schedStationSelect').value = selectedStationId;
    }

    formSongs = [];
    renderFormSongs();
    hideConflictAlert();

    modal.style.display = 'flex';
  }

  async function openEditModal(scheduleId) {
    closeDetailsDrawer();
    closeModals();

    const modal = document.getElementById('scheduleFormModal');
    if (!modal) return;

    try {
      const resp = await apiClient.get(`/admin/schedules/${scheduleId}`);
      const sched = resp && resp.data ? resp.data : null;
      if (!sched) return;

      document.getElementById('schedFormModalTitle').textContent = 'Edit Program Schedule';
      document.getElementById('schedIdInput').value = sched.id;
      document.getElementById('schedTitleInput').value = sched.title;
      document.getElementById('schedStationSelect').value = sched.station_id;
      document.getElementById('schedDateInput').value = sched.schedule_date;
      document.getElementById('schedStartInput').value = sched.start_time;
      document.getElementById('schedEndInput').value = sched.end_time;
      document.getElementById('schedCategorySelect').value = sched.category || 'Music';
      document.getElementById('schedDescInput').value = sched.description || '';
      document.getElementById('schedPublishedInput').checked = Boolean(sched.is_published);

      formSongs = Array.isArray(sched.songs) ? [...sched.songs] : [];
      renderFormSongs();
      hideConflictAlert();

      modal.style.display = 'flex';
    } catch (err) {
      showToast('Failed to load schedule: ' + err.message, 'error');
    }
  }

  function closeModals() {
    document.querySelectorAll('.modal-overlay').forEach((m) => {
      m.style.display = 'none';
    });
  }

  function showConflictAlert(msg) {
    const box = document.getElementById('schedConflictAlert');
    const msgEl = document.getElementById('schedConflictMsg');
    if (box && msgEl) {
      msgEl.textContent = msg;
      box.style.display = 'flex';
    }
  }

  function hideConflictAlert() {
    const box = document.getElementById('schedConflictAlert');
    if (box) box.style.display = 'none';
  }

  // --------------------------------------------------------------------------
  // Interactive Song Manager & Picker
  // --------------------------------------------------------------------------
  function renderFormSongs() {
    const container = document.getElementById('selectedSongsContainer');
    const summaryCount = document.getElementById('totalSongsCount');
    const summaryDuration = document.getElementById('totalSongsDuration');
    if (!container) return;

    if (formSongs.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted); font-size:0.8rem; text-align:center; padding:1rem;">No tracks assigned. Search tracks above or add custom items.</div>';
      if (summaryCount) summaryCount.textContent = '0 songs';
      if (summaryDuration) summaryDuration.textContent = '0m';
      return;
    }

    let totalSec = 0;
    container.innerHTML = formSongs
      .map((s, idx) => {
        const sec = s.duration_seconds || timeToMinutes(s.duration || '03:45') * 60;
        totalSec += sec;

        return `
        <div class="selected-song-item">
          <span class="song-order-num">#${idx + 1}</span>
          <div class="song-info">
            <div class="song-title-text">${escapeHtml(s.title)}</div>
            <div class="song-artist-text">${escapeHtml(s.artist || 'Unknown Artist')}</div>
          </div>
          <span class="song-duration-pill">${escapeHtml(s.duration || '03:45')}</span>
          <div class="song-actions">
            ${idx > 0 ? `<button type="button" class="btn-icon song-move-up" data-idx="${idx}" title="Move Up">▲</button>` : ''}
            ${idx < formSongs.length - 1 ? `<button type="button" class="btn-icon song-move-down" data-idx="${idx}" title="Move Down">▼</button>` : ''}
            <button type="button" class="btn-icon delete song-remove-btn" data-idx="${idx}" title="Remove">✕</button>
          </div>
        </div>
      `;
      })
      .join('');

    if (summaryCount) summaryCount.textContent = `${formSongs.length} track${formSongs.length > 1 ? 's' : ''}`;
    if (summaryDuration) summaryDuration.textContent = formatMinutesToHours(Math.round(totalSec / 60));

    // Order Handlers
    container.querySelectorAll('.song-move-up').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        if (idx > 0) {
          const temp = formSongs[idx];
          formSongs[idx] = formSongs[idx - 1];
          formSongs[idx - 1] = temp;
          renderFormSongs();
        }
      });
    });

    container.querySelectorAll('.song-move-down').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        if (idx < formSongs.length - 1) {
          const temp = formSongs[idx];
          formSongs[idx] = formSongs[idx + 1];
          formSongs[idx + 1] = temp;
          renderFormSongs();
        }
      });
    });

    container.querySelectorAll('.song-remove-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        formSongs.splice(idx, 1);
        renderFormSongs();
      });
    });
  }

  // Live Track Search
  let searchDebounce = null;
  function setupSongSearch() {
    const input = document.getElementById('songSearchInput');
    const resultsBox = document.getElementById('songSearchResults');
    if (!input || !resultsBox) return;

    input.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      const query = input.value.trim();
      if (query.length < 1) {
        resultsBox.style.display = 'none';
        return;
      }

      searchDebounce = setTimeout(async () => {
        try {
          const resp = await apiClient.get(`/admin/songs/search?q=${encodeURIComponent(query)}`);
          const songs = resp && resp.data ? resp.data : [];

          if (songs.length === 0) {
            resultsBox.innerHTML = '<div style="padding:0.75rem; font-size:0.8rem; color:var(--text-muted);">No songs found in catalogue.</div>';
          } else {
            resultsBox.innerHTML = songs
              .map(
                (s) => `
                <div class="song-result-item" data-song='${JSON.stringify(s).replace(/'/g, "&apos;")}'>
                  <div>
                    <strong style="font-size:0.85rem;">${escapeHtml(s.title)}</strong>
                    <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(s.artist || 'Unknown')}</div>
                  </div>
                  <span class="tag" style="font-size:0.7rem;">+ Add</span>
                </div>
              `
              )
              .join('');

            resultsBox.querySelectorAll('.song-result-item').forEach((item) => {
              item.addEventListener('click', () => {
                const song = JSON.parse(item.getAttribute('data-song').replace(/&apos;/g, "'"));
                formSongs.push(song);
                renderFormSongs();
                resultsBox.style.display = 'none';
                input.value = '';
              });
            });
          }

          resultsBox.style.display = 'block';
        } catch (err) {
          console.error('Song search failed:', err);
        }
      }, 250);
    });

    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !resultsBox.contains(e.target)) {
        resultsBox.style.display = 'none';
      }
    });

    // Custom track button
    const customTrackBtn = document.getElementById('addCustomTrackBtn');
    if (customTrackBtn) {
      customTrackBtn.addEventListener('click', () => {
        const title = prompt('Enter Track / Audio Title:');
        if (!title || !title.trim()) return;
        const artist = prompt('Enter Artist / DJ Name (optional):') || '';
        const duration = prompt('Enter Duration (MM:SS):', '03:45') || '03:45';

        formSongs.push({
          title: title.trim(),
          artist: artist.trim(),
          duration: duration.trim(),
          duration_seconds: timeToMinutes(duration) * 60
        });
        renderFormSongs();
      });
    }
  }

  // --------------------------------------------------------------------------
  // Form Submission
  // --------------------------------------------------------------------------
  function setupFormSubmission() {
    const form = document.getElementById('scheduleModalForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideConflictAlert();

      const id = document.getElementById('schedIdInput').value;
      const stationId = parseInt(document.getElementById('schedStationSelect').value, 10);
      const title = document.getElementById('schedTitleInput').value.trim();
      const scheduleDate = document.getElementById('schedDateInput').value.trim();
      const startTime = document.getElementById('schedStartInput').value.trim();
      const endTime = document.getElementById('schedEndInput').value.trim();
      const category = document.getElementById('schedCategorySelect').value;
      const description = document.getElementById('schedDescInput').value.trim();
      const isPublished = document.getElementById('schedPublishedInput').checked;

      const payload = {
        station_id: stationId,
        title,
        schedule_date: scheduleDate,
        start_time: startTime,
        end_time: endTime,
        category,
        description,
        is_published: isPublished,
        songs: formSongs
      };

      try {
        if (id) {
          await apiClient.put(`/admin/schedules/${id}`, payload);
          showToast(`Updated programme "${title}"`, 'success');
        } else {
          await apiClient.post('/admin/schedules', payload);
          showToast(`Created programme "${title}"`, 'success');
        }

        closeModals();
        await loadSchedules();
      } catch (err) {
        if (err.status === 409 || err.conflict || (err.message && err.message.toLowerCase().includes('conflict'))) {
          showConflictAlert(err.message || 'Schedule conflict: Overlaps with an existing broadcast on this station.');
        } else {
          alert(err.message || 'Failed to save schedule.');
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // Toolbar & Navigation Controls
  // --------------------------------------------------------------------------
  function setupToolbar() {
    // Navigation: Today, Prev, Next
    document.getElementById('calendarTodayBtn')?.addEventListener('click', () => {
      currentDate = new Date();
      loadSchedules();
    });

    document.getElementById('calendarPrevBtn')?.addEventListener('click', () => {
      if (currentView === 'month') {
        currentDate.setMonth(currentDate.getMonth() - 1);
      } else if (currentView === 'week') {
        currentDate.setDate(currentDate.getDate() - 7);
      } else {
        currentDate.setDate(currentDate.getDate() - 1);
      }
      loadSchedules();
    });

    document.getElementById('calendarNextBtn')?.addEventListener('click', () => {
      if (currentView === 'month') {
        currentDate.setMonth(currentDate.getMonth() + 1);
      } else if (currentView === 'week') {
        currentDate.setDate(currentDate.getDate() + 7);
      } else {
        currentDate.setDate(currentDate.getDate() + 1);
      }
      loadSchedules();
    });

    // View Switcher Buttons
    document.querySelectorAll('.view-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentView = btn.getAttribute('data-view');
        updateViewButtons();
        loadSchedules();
      });
    });

    // Filters
    document.getElementById('calendarStationFilter')?.addEventListener('change', (e) => {
      selectedStationId = e.target.value;
      loadSchedules();
    });

    document.getElementById('calendarStatusFilter')?.addEventListener('change', (e) => {
      selectedStatus = e.target.value;
      loadSchedules();
    });

    // Create Schedule Button
    document.getElementById('createScheduleBtn')?.addEventListener('click', () => {
      openCreateModal(formatDateKey(currentDate), '09:00', '10:00');
    });

    // Drawer Close Buttons
    document.getElementById('closeDetailsDrawerBtn')?.addEventListener('click', closeDetailsDrawer);
    document.getElementById('scheduleDetailsDrawer')?.addEventListener('click', (e) => {
      if (e.target.id === 'scheduleDetailsDrawer') closeDetailsDrawer();
    });

    // Modal Close Buttons
    document.querySelectorAll('.btn-close-modal, .btn-cancel-modal').forEach((btn) => {
      btn.addEventListener('click', closeModals);
    });

    // Global Key Listener: Escape closes drawer and modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDetailsDrawer();
        closeModals();
      }
    });

    // Live Current Time Indicator updater
    setInterval(() => {
      if (currentView === 'week' || currentView === 'day') {
        document.querySelectorAll('.current-time-indicator').forEach((indicator) => {
          const now = new Date();
          const currentMins = now.getHours() * 60 + now.getMinutes();
          const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
          indicator.style.top = `${currentMins}px`;
          const badge = indicator.querySelector('.current-time-badge');
          if (badge) badge.textContent = timeStr;
        });
      }
    }, 30000);
  }

  // --------------------------------------------------------------------------
  // Entry Point
  // --------------------------------------------------------------------------
  async function init() {
    const isAuthed = await checkAdminAuth();
    if (!isAuthed) return;

    setupToolbar();
    setupSongSearch();
    setupFormSubmission();

    await loadStations();
    await loadSchedules();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
