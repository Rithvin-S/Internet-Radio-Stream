/**
 * Full-Stack Internet Radio Streaming System
 * Admin Dashboard Controller (frontend/js/admin.js)
 * Implements FR-11, FR-12, FR-13 (Station and Schedule Administration)
 */

(function () {
  'use strict';

  let stationsList = [];
  let currentStationId = null;

  async function checkAdminAuth() {
    const user = await auth.getCurrentUser();
    if (!user || user.role !== 'admin') {
      alert('Access restricted. Please sign in with an Administrator account.');
      window.location.href = '/login.html';
      return false;
    }
    return true;
  }

  /* ==========================================================================
     1. Station Management (admin/stations.html)
     ========================================================================== */
  async function loadAdminStations() {
    const tableBody = document.getElementById('adminStationsTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--text-muted);">Loading stations...</td></tr>';

    try {
      const response = await apiClient.get('/stations?all=true');
      stationsList = response && response.data ? response.data : [];

      if (stationsList.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--text-muted);">No stations registered. Click "Add Station" to create one.</td></tr>';
        return;
      }

      tableBody.innerHTML = stationsList
        .map(
          (s) => `
        <tr>
          <td><strong>#${s.id}</strong></td>
          <td>
            <strong>${escapeHtml(s.name)}</strong>
            <div style="font-size:0.75rem; color:var(--text-secondary);">${escapeHtml(s.description || '')}</div>
          </td>
          <td><span class="tag">${escapeHtml(s.genre || 'General')}</span></td>
          <td><code style="font-size:0.75rem; color:#38bdf8;">${escapeHtml(s.stream_url)}</code></td>
          <td>
            <span class="badge-status ${s.is_active ? 'active' : 'inactive'}">
              ${s.is_active ? 'Active' : 'Inactive'}
            </span>
          </td>
          <td>
            <div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
              <button class="btn-sm btn-secondary toggle-status-btn" data-id="${s.id}" data-active="${s.is_active}">
                ${s.is_active ? 'Deactivate' : 'Activate'}
              </button>
              <button class="btn-sm btn-secondary edit-station-btn" data-id="${s.id}">Edit</button>
              <a href="/admin/schedules.html?station=${s.id}" class="btn-sm btn-secondary">Schedules</a>
              <button class="btn-sm btn-danger delete-station-btn" data-id="${s.id}">Delete</button>
            </div>
          </td>
        </tr>
      `
        )
        .join('');

      attachStationActionHandlers();
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="6" style="color:#f87171; padding:1.5rem;">Error loading stations: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function attachStationActionHandlers() {
    // Toggle Status
    document.querySelectorAll('.toggle-status-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        try {
          await apiClient.patch(`/admin/stations/${id}/status`);
          await loadAdminStations();
        } catch (e) {
          alert(e.message || 'Failed to toggle station status.');
        }
      });
    });

    // Delete Station
    document.querySelectorAll('.delete-station-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (confirm(`Are you sure you want to delete station #${id}? This will also remove associated schedules and favourites.`)) {
          try {
            await apiClient.delete(`/admin/stations/${id}`);
            await loadAdminStations();
          } catch (e) {
            alert(e.message || 'Failed to delete station.');
          }
        }
      });
    });

    // Edit Station
    document.querySelectorAll('.edit-station-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-id'), 10);
        const station = stationsList.find((s) => s.id === id);
        if (station) openEditModal(station);
      });
    });
  }

  function openEditModal(station) {
    const modal = document.getElementById('stationModal');
    if (!modal) return;

    document.getElementById('modalTitle').textContent = 'Edit Radio Station';
    document.getElementById('stationIdInput').value = station.id;
    document.getElementById('stationNameInput').value = station.name;
    document.getElementById('stationGenreInput').value = station.genre || '';
    document.getElementById('stationUrlInput').value = station.stream_url;
    document.getElementById('stationDescInput').value = station.description || '';
    document.getElementById('stationActiveInput').checked = station.is_active;

    modal.style.display = 'flex';
  }

  /* ==========================================================================
     2. Schedule Management (admin/schedules.html)
     ========================================================================== */
  async function loadAdminSchedules() {
    const select = document.getElementById('scheduleStationSelect');
    const tableBody = document.getElementById('adminSchedulesTableBody');
    if (!select || !tableBody) return;

    try {
      const response = await apiClient.get('/stations?all=true');
      stationsList = response && response.data ? response.data : [];

      select.innerHTML = stationsList
        .map((s) => `<option value="${s.id}">#${s.id} - ${escapeHtml(s.name)}</option>`)
        .join('');

      // Check url param
      const urlParams = new URLSearchParams(window.location.search);
      const urlStationId = parseInt(urlParams.get('station'), 10);

      if (urlStationId && stationsList.some((s) => s.id === urlStationId)) {
        select.value = urlStationId;
        currentStationId = urlStationId;
      } else if (stationsList.length > 0) {
        currentStationId = stationsList[0].id;
        select.value = currentStationId;
      }

      select.addEventListener('change', (e) => {
        currentStationId = parseInt(e.target.value, 10);
        fetchAndRenderStationSchedules(currentStationId);
      });

      if (currentStationId) {
        fetchAndRenderStationSchedules(currentStationId);
      }
    } catch (e) {
      alert('Failed to load stations for schedule manager.');
    }
  }

  async function fetchAndRenderStationSchedules(stationId) {
    const tableBody = document.getElementById('adminSchedulesTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:1.5rem; color:var(--text-muted);">Loading schedules...</td></tr>';

    try {
      const resp = await apiClient.get(`/stations/${stationId}/schedules?all=true`);
      const schedules = resp && resp.data ? resp.data : [];

      if (schedules.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:1.5rem; color:var(--text-muted);">No programs scheduled for this station. Add one below.</td></tr>';
        return;
      }

      tableBody.innerHTML = schedules
        .map(
          (s) => `
        <tr>
          <td><strong style="color:var(--accent-cyan);">${escapeHtml(s.start_time)} - ${escapeHtml(s.end_time)}</strong></td>
          <td><strong>${escapeHtml(s.title)}</strong></td>
          <td>${escapeHtml(s.description || '—')}</td>
          <td>
            <span class="badge-status ${s.is_published ? 'active' : 'inactive'}">
              ${s.is_published ? 'Published' : 'Draft'}
            </span>
          </td>
          <td>
            <button class="btn-sm btn-danger delete-schedule-btn" data-id="${s.id}">Delete</button>
          </td>
        </tr>
      `
        )
        .join('');

      tableBody.querySelectorAll('.delete-schedule-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const scheduleId = btn.getAttribute('data-id');
          if (confirm('Delete this program schedule entry?')) {
            try {
              await apiClient.delete(`/admin/schedules/${scheduleId}`);
              fetchAndRenderStationSchedules(currentStationId);
            } catch (err) {
              alert(err.message || 'Failed to delete schedule.');
            }
          }
        });
      });
    } catch (e) {
      tableBody.innerHTML = `<tr><td colspan="5" style="color:#f87171; padding:1.5rem;">Error: ${escapeHtml(e.message)}</td></tr>`;
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, (t) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[t] || t));
  }

  async function init() {
    const isAuthed = await checkAdminAuth();
    if (!isAuthed) return;

    // Station management page
    if (document.getElementById('adminStationsTableBody')) {
      loadAdminStations();

      const newBtn = document.getElementById('newStationBtn');
      const modal = document.getElementById('stationModal');
      const closeModalBtn = document.getElementById('closeModalBtn');
      const stationForm = document.getElementById('stationForm');

      if (newBtn && modal) {
        newBtn.addEventListener('click', () => {
          document.getElementById('modalTitle').textContent = 'Add New Radio Station';
          stationForm.reset();
          document.getElementById('stationIdInput').value = '';
          document.getElementById('stationActiveInput').checked = true;
          modal.style.display = 'flex';
        });
      }

      if (closeModalBtn && modal) {
        closeModalBtn.addEventListener('click', () => { modal.style.display = 'none'; });
      }

      if (stationForm) {
        stationForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const id = document.getElementById('stationIdInput').value;
          const payload = {
            name: document.getElementById('stationNameInput').value.trim(),
            genre: document.getElementById('stationGenreInput').value.trim(),
            stream_url: document.getElementById('stationUrlInput').value.trim(),
            description: document.getElementById('stationDescInput').value.trim(),
            is_active: document.getElementById('stationActiveInput').checked
          };

          try {
            if (id) {
              await apiClient.put(`/admin/stations/${id}`, payload);
            } else {
              await apiClient.post('/admin/stations', payload);
            }
            modal.style.display = 'none';
            await loadAdminStations();
          } catch (err) {
            alert(err.message || 'Failed to save station.');
          }
        });
      }
    }

    // Schedule management page
    if (document.getElementById('adminSchedulesTableBody')) {
      loadAdminSchedules();

      const addScheduleForm = document.getElementById('addScheduleForm');
      if (addScheduleForm) {
        addScheduleForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!currentStationId) {
            alert('Please select a station first.');
            return;
          }

          const payload = {
            title: document.getElementById('showTitleInput').value.trim(),
            start_time: document.getElementById('showStartInput').value.trim(),
            end_time: document.getElementById('showEndInput').value.trim(),
            description: document.getElementById('showDescInput').value.trim(),
            is_published: document.getElementById('showPublishedInput').checked
          };

          try {
            await apiClient.post(`/admin/stations/${currentStationId}/schedules`, payload);
            addScheduleForm.reset();
            document.getElementById('showPublishedInput').checked = true;
            fetchAndRenderStationSchedules(currentStationId);
          } catch (err) {
            alert(err.message || 'Failed to add schedule entry.');
          }
        });
      }
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();

