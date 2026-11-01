/**
 * Full-Stack Internet Radio Streaming System
 * Frontend Authentication Helper (frontend/js/auth.js)
 * Implements user session management and dynamic navigation updates (FR-07, FR-08, FR-13)
 */

const auth = {
  currentUser: null,

  async getCurrentUser() {
    if (this.currentUser) return this.currentUser;

    try {
      const response = await apiClient.get('/auth/me');
      if (response && response.success && response.user) {
        this.currentUser = response.user;
        return this.currentUser;
      }
    } catch (e) {
      this.currentUser = null;
    }
    return null;
  },

  async logout() {
    try {
      await apiClient.post('/auth/logout');
    } catch (e) {
      console.warn('Logout request warning:', e);
    }
    apiClient.setToken(null);
    this.currentUser = null;
    window.location.href = '/login.html';
  },

  updateNavbar(user) {
    const navContainer = document.getElementById('siteNav');
    if (!navContainer) return;

    const path = window.location.pathname || '';
    const isPlayer = path === '/' || path === '/index.html' || path.endsWith('/index.html');
    const isLibrary = path === '/admin/songs.html' || path.endsWith('/admin/songs.html') || path === '/library' || path === '/library.html';
    const isStations = path === '/stations.html' || path.startsWith('/station.html');
    const isFavourites = path === '/favourites.html';
    const isAdminPanel = (path.startsWith('/admin/') && !isLibrary) || path === '/admin';

    if (user) {
      const isAdmin = user.role === 'admin';
      navContainer.innerHTML = `
        <a href="/index.html" class="nav-link ${isPlayer ? 'active' : ''}">Live Player</a>
        ${isAdmin ? `<a href="/admin/songs.html" class="nav-link ${isLibrary ? 'active' : ''}">Library</a>` : ''}
        <a href="/stations.html" class="nav-link ${isStations ? 'active' : ''}">Stations</a>
        <a href="/favourites.html" class="nav-link ${isFavourites ? 'active' : ''}">★ Favourites</a>
        ${isAdmin ? `<a href="/admin/stations.html" class="nav-link admin-link ${isAdminPanel ? 'active' : ''}">⚙ Admin Panel</a>` : ''}
        <div class="user-badge">
          <span>${escapeHtml(user.name)}</span>
          <span class="badge-status active" style="font-size:0.65rem;">${user.role.toUpperCase()}</span>
        </div>
        <button id="logoutBtn" class="btn-sm btn-secondary">Sign Out</button>
      `;

      const logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', () => this.logout());
      }
    } else {
      navContainer.innerHTML = `
        <a href="/index.html" class="nav-link ${isPlayer ? 'active' : ''}">Live Player</a>
        <a href="/stations.html" class="nav-link ${isStations ? 'active' : ''}">Stations</a>
        <a href="/login.html" class="nav-link ${path.includes('login') ? 'active' : ''}">Sign In</a>
        <a href="/register.html" class="btn-sm btn-primary">Create Account</a>
      `;
    }
  },

  async initNavbar() {
    const user = await this.getCurrentUser();
    this.updateNavbar(user);
  }
};

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, (tag) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

window.auth = auth;

document.addEventListener('DOMContentLoaded', () => {
  auth.initNavbar();
});

