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

    if (user) {
      const isAdmin = user.role === 'admin';
      navContainer.innerHTML = `
        <a href="/index.html" class="nav-link">Live Player</a>
        <a href="/stations.html" class="nav-link">Stations</a>
        <a href="/favourites.html" class="nav-link">★ Favourites</a>
        ${isAdmin ? '<a href="/admin/stations.html" class="nav-link admin-link">⚙ Admin Panel</a>' : ''}
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
        <a href="/index.html" class="nav-link">Live Player</a>
        <a href="/stations.html" class="nav-link">Stations</a>
        <a href="/login.html" class="nav-link">Sign In</a>
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

