/**
 * Full-Stack Internet Radio Streaming System
 * Frontend API Client Helper (frontend/js/api.js)
 * Implements centralized HTTP requests with credentials and error handling (FR-15, NFR-02)
 */

// Detect local development environment
const isLocal =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.protocol === 'file:';

// Set production API base URL to Render deployment, while preserving local development support
const API_BASE = isLocal
  ? (window.location.port === '5000' ? '/api' : 'http://localhost:5000/api')
  : 'https://internet-radio-stream.onrender.com/api';

const apiClient = {
  getToken() {
    return localStorage.getItem('pulsecast_token');
  },

  setToken(token) {
    if (token) {
      localStorage.setItem('pulsecast_token', token);
    } else {
      localStorage.removeItem('pulsecast_token');
    }
  },

  async request(endpoint, options = {}) {
    // Avoid double /api prefix if endpoint already includes /api
    let cleanEndpoint = endpoint;
    if (cleanEndpoint.startsWith('/api/')) {
      cleanEndpoint = cleanEndpoint.substring(4);
    }
    const url = `${API_BASE}${cleanEndpoint}`;
    const headers = { ...options.headers };

    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (!isFormData && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
      ...options,
      headers,
      credentials: 'include' // Sends HttpOnly cookie automatically
    };

    if (!isFormData && config.body && typeof config.body === 'object') {
      config.body = jsonSafeStringify(config.body);
    }

    try {
      const response = await fetch(url, config);
      const isJson = (response.headers.get('content-type') || '').includes('application/json');
      const data = isJson ? await response.json() : await response.text();

      if (!response.ok) {
        const errorMsg = data && data.message ? data.message : `HTTP ${response.status}: Request failed`;
        const err = new Error(errorMsg);
        err.status = response.status;
        err.data = data;
        throw err;
      }

      return data;
    } catch (err) {
      console.warn(`[API] Error on ${options.method || 'GET'} ${endpoint}:`, err.message);
      throw err;
    }
  },

  get(endpoint, headers = {}) {
    return this.request(endpoint, { method: 'GET', headers });
  },

  post(endpoint, body = {}, headers = {}) {
    return this.request(endpoint, { method: 'POST', body, headers });
  },

  put(endpoint, body = {}, headers = {}) {
    return this.request(endpoint, { method: 'PUT', body, headers });
  },

  patch(endpoint, body = {}, headers = {}) {
    return this.request(endpoint, { method: 'PATCH', body, headers });
  },

  delete(endpoint, headers = {}) {
    return this.request(endpoint, { method: 'DELETE', headers });
  },

  upload(endpoint, formData, headers = {}) {
    return this.request(endpoint, { method: 'POST', body: formData, headers });
  }
};

function jsonSafeStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return '{}';
  }
}

window.apiClient = apiClient;

