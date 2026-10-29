/**
 * Full-Stack Internet Radio Streaming System
 * Station Catalogue & Favourites Manager (frontend/js/stations.js)
 * Implements FR-01, FR-09 (Discovery, Filtering & Favourites)
 */

(function () {
  'use strict';

  let stationsData = [];
  let selectedGenre = 'all';
  let searchTerm = '';

  const container = document.getElementById('stationsGrid');
  const searchInput = document.getElementById('searchInput');
  const genreContainer = document.getElementById('genreFilters');

  async function loadStations() {
    if (!container) return;
    container.innerHTML = '<div style="color:var(--text-muted); padding:2rem; grid-column:1/-1; text-align:center;">Loading station catalogue from database...</div>';

    try {
      const response = await apiClient.get('/stations');
      stationsData = response && response.data ? response.data : [];
      renderGenrePills();
      renderStations();
    } catch (e) {
      container.innerHTML = `<div class="form-error-banner" style="grid-column:1/-1;">Failed to load stations: ${escapeHtml(e.message)}</div>`;
    }
  }

  function renderGenrePills() {
    if (!genreContainer) return;
    const genres = new Set();
    stationsData.forEach((s) => {
      if (s.genre) genres.add(s.genre.split('/')[0].trim());
    });

    let html = '<button class="genre-pill active" data-genre="all">All Genres</button>';
    genres.forEach((g) => {
      html += `<button class="genre-pill" data-genre="${escapeHtml(g)}">${escapeHtml(g)}</button>`;
    });

    genreContainer.innerHTML = html;

    genreContainer.querySelectorAll('.genre-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        genreContainer.querySelectorAll('.genre-pill').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        selectedGenre = btn.getAttribute('data-genre');
        renderStations();
      });
    });
  }

  function renderStations() {
    if (!container) return;

    let filtered = stationsData.filter((s) => {
      const matchesSearch =
        !searchTerm ||
        s.name.toLowerCase().includes(searchTerm) ||
        (s.description && s.description.toLowerCase().includes(searchTerm)) ||
        (s.genre && s.genre.toLowerCase().includes(searchTerm));

      const matchesGenre =
        selectedGenre === 'all' ||
        (s.genre && s.genre.toLowerCase().includes(selectedGenre.toLowerCase()));

      return matchesSearch && matchesGenre;
    });

    if (filtered.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted); padding:2rem; grid-column:1/-1; text-align:center;">No matching radio stations found.</div>';
      return;
    }

    container.innerHTML = filtered
      .map(
        (station) => `
      <div class="station-card" id="station-card-${station.id}">
        <div class="card-top">
          <div class="card-title-group">
            <h3>${escapeHtml(station.name)}</h3>
            <span class="card-genre">${escapeHtml(station.genre || 'Live Stream')}</span>
          </div>
          <button class="card-fav-btn ${station.is_favourite ? 'active' : ''}" 
                  data-station-id="${station.id}" 
                  title="${station.is_favourite ? 'Remove from favourites' : 'Add to favourites'}">
            ${station.is_favourite ? '★' : '☆'}
          </button>
        </div>
        <p class="card-desc">${escapeHtml(station.description || 'Continuous online streaming audio broadcast.')}</p>
        <div class="card-actions">
          <a href="/index.html?station=${station.id}" class="btn-sm btn-primary">▶ Tune In</a>
          <a href="/station.html?id=${station.id}" class="btn-sm btn-secondary">Details & Schedule</a>
        </div>
      </div>
    `
      )
      .join('');

    // Attach Favourite click handlers
    container.querySelectorAll('.card-fav-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const stationId = btn.getAttribute('data-station-id');
        await toggleFavourite(stationId, btn);
      });
    });
  }

  async function toggleFavourite(stationId, btn) {
    const user = await auth.getCurrentUser();
    if (!user) {
      alert('Please sign in to add stations to your personal favourites.');
      window.location.href = '/login.html';
      return;
    }

    const isFav = btn.classList.contains('active');

    try {
      if (isFav) {
        await apiClient.delete(`/favourites/${stationId}`);
        btn.classList.remove('active');
        btn.innerHTML = '☆';
        btn.title = 'Add to favourites';
      } else {
        await apiClient.post(`/favourites/${stationId}`);
        btn.classList.add('active');
        btn.innerHTML = '★';
        btn.title = 'Remove from favourites';
      }
    } catch (err) {
      alert(err.message || 'Failed to update favourite.');
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, (t) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[t] || t));
  }

  function init() {
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchTerm = e.target.value.trim().toLowerCase();
        renderStations();
      });
    }

    loadStations();
  }

  document.addEventListener('DOMContentLoaded', init);
})();

