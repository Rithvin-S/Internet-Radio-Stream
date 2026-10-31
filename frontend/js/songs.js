/**
 * PulseCast Internet Radio Streaming System
 * Song Library Frontend Controller (frontend/js/songs.js)
 *
 * Implements:
 * - Spotify-inspired full-width music catalogue dashboard (Aurora Light Theme)
 * - 4 live library KPI statistics (Total Songs, Active Songs, Total Storage, Total Playing Duration)
 * - In-page Quick Upload drag-and-drop hero zone
 * - Search by title, artist, album, with instant clear button
 * - Advanced sorting (Recently Added, Title A-Z, Title Z-A, Artist A-Z, Duration)
 * - Configurable page sizes (10, 15, 25, 50) and pagination
 * - Single and bulk audio uploads with progress tracking and bounded concurrency
 * - Metadata editing, safe archiving, and deletion with schedule conflict validation
 * - In-browser audio preview player using ephemeral Supabase Storage signed URLs
 * - Robust error handling with user-friendly recovery actions
 */

(function () {
  'use strict';

  // --------------------------------------------------------------------------
  // Application State
  // --------------------------------------------------------------------------
  let currentPage = 1;
  let pageLimit = 15;
  let totalSongsCount = 0;
  let totalPages = 1;
  let searchQuery = '';
  let statusFilter = 'active'; // 'all' | 'active' | 'archived'
  let sortBy = 'created_at';
  let sortOrder = 'desc';

  let songsList = [];
  let singleSelectedFile = null;
  let bulkQueue = []; // Array of { id, file, status: 'pending'|'uploading'|'success'|'error', error?: string }
  let currentPreviewSong = null;
  let songPendingDelete = null;

  let searchDebounceTimer = null;
  let toastTimer = null;

  // --------------------------------------------------------------------------
  // Utility Functions
  // --------------------------------------------------------------------------
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, (t) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[t] || t));
  }

  function formatBytes(bytes) {
    const num = Number(bytes);
    if (!num || isNaN(num) || num <= 0) return '0 B';
    const mb = num / (1024 * 1024);
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(2)} GB`;
    }
    if (mb >= 1) {
      return `${mb.toFixed(1)} MB`;
    }
    const kb = num / 1024;
    return `${kb.toFixed(0)} KB`;
  }

  function formatDurationSeconds(totalSeconds) {
    const sec = Math.max(0, parseInt(totalSeconds, 10) || 0);
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = sec % 60;

    if (hrs > 0) {
      return `${hrs}h ${mins}m ${secs}s`;
    }
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  }

  function formatUploadDate(isoString) {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return isoString;
    }
  }

  function showToast(message, type = 'info') {
    const toast = document.getElementById('libraryToast');
    if (!toast) return;

    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }

    toast.textContent = message;
    toast.className = `calendar-toast show ${type}`;

    toastTimer = setTimeout(() => {
      toast.className = 'calendar-toast';
      toastTimer = null;
    }, 4000);
  }

  // --------------------------------------------------------------------------
  // Authentication Guard
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
  // Statistics Update
  // --------------------------------------------------------------------------
  function updateStatistics(stats) {
    if (!stats) return;

    const totalEl = document.getElementById('statTotalSongs');
    const activeEl = document.getElementById('statActiveSongs');
    const activeSubEl = document.getElementById('statActiveSub');
    const storageEl = document.getElementById('statStorageUsed');
    const durationEl = document.getElementById('statTotalDuration');

    const total = Number(stats.totalSongs) || 0;
    const active = Number(stats.activeSongs) || 0;
    const storageBytes = Number(stats.totalStorageBytes) || 0;
    const durationSec = Number(stats.totalDurationSeconds) || 0;

    if (totalEl) totalEl.textContent = total.toLocaleString();
    if (activeEl) activeEl.textContent = active.toLocaleString();

    if (activeSubEl) {
      if (total > 0) {
        const pct = Math.round((active / total) * 100);
        activeSubEl.textContent = `${pct}% available in rotation`;
      } else {
        activeSubEl.textContent = 'Ready for broadcast';
      }
    }

    if (storageEl) storageEl.textContent = formatBytes(storageBytes);
    if (durationEl) durationEl.textContent = formatDurationSeconds(durationSec);
  }

  // --------------------------------------------------------------------------
  // Data Loading & Table Rendering
  // --------------------------------------------------------------------------
  async function loadSongs(page = 1) {
    currentPage = page;
    const tableBody = document.getElementById('songsTableBody');
    const errorBox = document.getElementById('libraryErrorState');
    const emptyBox = document.getElementById('libraryEmptyState');

    if (errorBox) errorBox.style.display = 'none';

    if (tableBody) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 3rem; color: var(--text-secondary);">
            <div class="spin-icon" style="font-size: 1.5rem; margin-bottom: 0.5rem; color: var(--primary);">↻</div>
            <div style="font-weight: 600;">Loading music library...</div>
          </td>
        </tr>
      `;
    }

    try {
      let url = `/admin/songs?page=${currentPage}&limit=${pageLimit}&sortBy=${encodeURIComponent(sortBy)}&order=${encodeURIComponent(sortOrder)}`;
      if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
      if (statusFilter === 'active') url += '&activeOnly=true';
      if (statusFilter === 'archived') url += '&activeOnly=false';

      const resp = await apiClient.get(url);
      songsList = resp && resp.data ? resp.data : [];

      if (statusFilter === 'archived') {
        songsList = songsList.filter((s) => !s.is_active);
      }

      totalSongsCount = resp && resp.total !== undefined ? resp.total : songsList.length;
      totalPages = resp && resp.totalPages ? resp.totalPages : Math.ceil(totalSongsCount / pageLimit) || 1;

      // Update statistics
      if (resp && resp.stats) {
        updateStatistics(resp.stats);
      }

      renderSongsTable();
      renderPagination();
    } catch (err) {
      console.error('Failed to load songs:', err);
      handleLoadError(err);
    }
  }

  function handleLoadError(err) {
    const tableBody = document.getElementById('songsTableBody');
    const errorBox = document.getElementById('libraryErrorState');
    const errorTitle = document.getElementById('libraryErrorTitle');
    const errorMessage = document.getElementById('libraryErrorMessage');
    const emptyBox = document.getElementById('libraryEmptyState');

    if (emptyBox) emptyBox.style.display = 'none';
    if (tableBody) tableBody.innerHTML = '';

    if (errorBox) {
      errorBox.style.display = 'block';

      if (err.status === 401) {
        if (errorTitle) errorTitle.textContent = 'Session Expired';
        if (errorMessage) errorMessage.textContent = 'Your login session has expired. Please sign in again with your administrator account.';
      } else if (err.status === 403) {
        if (errorTitle) errorTitle.textContent = 'Administrator Access Required';
        if (errorMessage) errorMessage.textContent = 'You do not have administrative privileges to manage the song library.';
      } else if (err.status === 404) {
        if (errorTitle) errorTitle.textContent = 'Service Endpoint Not Found';
        if (errorMessage) errorMessage.textContent = 'The backend song library service was not found. Please verify the backend server is running on http://localhost:5000.';
      } else {
        if (errorTitle) errorTitle.textContent = 'Unable to Connect to Music Library';
        if (errorMessage) errorMessage.textContent = err.message || 'Could not communicate with the PulseCast server. Please check your network connection and retry.';
      }
    }

    showToast('Failed to load song catalogue', 'error');
  }

  function renderSongsTable() {
    const tableBody = document.getElementById('songsTableBody');
    const emptyBox = document.getElementById('libraryEmptyState');
    const summary = document.getElementById('songsCountSummary');

    if (!tableBody) return;

    if (summary) {
      const start = (currentPage - 1) * pageLimit + (songsList.length > 0 ? 1 : 0);
      const end = (currentPage - 1) * pageLimit + songsList.length;
      summary.textContent = `Showing ${start} – ${end} of ${totalSongsCount} songs`;
    }

    if (songsList.length === 0) {
      tableBody.innerHTML = '';
      if (emptyBox) {
        emptyBox.style.display = 'block';
        const titleEl = document.getElementById('emptyStateTitle');
        const descEl = document.getElementById('emptyStateDesc');

        if (searchQuery) {
          if (titleEl) titleEl.textContent = `No tracks matching "${escapeHtml(searchQuery)}"`;
          if (descEl) descEl.textContent = 'Try searching with different keywords, artist names, or album titles.';
        } else if (statusFilter === 'archived') {
          if (titleEl) titleEl.textContent = 'No archived tracks';
          if (descEl) descEl.textContent = 'Archived tracks will appear here when you hide songs from the active scheduling catalogue.';
        } else {
          if (titleEl) titleEl.textContent = 'Your music library is empty';
          if (descEl) descEl.textContent = 'Upload your first audio tracks to start building your PulseCast radio catalogue.';
        }
      }
      return;
    }

    if (emptyBox) emptyBox.style.display = 'none';

    tableBody.innerHTML = songsList
      .map((song, idx) => {
        const isActive = song.is_active;
        const isCurrentlyPlaying = currentPreviewSong && currentPreviewSong.id === song.id;
        const rowNumber = (currentPage - 1) * pageLimit + idx + 1;

        return `
          <tr data-song-id="${song.id}" class="${isCurrentlyPlaying ? 'is-playing' : ''}">
            <td class="col-song">
              <div class="song-cell-flex">
                <span style="font-size: 0.82rem; font-weight: 600; color: var(--text-muted); width: 20px; text-align: center;">
                  ${isCurrentlyPlaying ? '▶' : rowNumber}
                </span>

                <!-- Gradient Artwork Thumbnail with Play Overlay -->
                <div class="song-artwork-thumb ${isCurrentlyPlaying ? 'playing' : ''}" data-id="${song.id}" title="Play preview">
                  ♫
                  <div class="artwork-overlay-play">
                    ${isCurrentlyPlaying ? '■' : '▶'}
                  </div>
                </div>

                <div class="song-meta-text">
                  <div class="song-title-heading" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div>
                  <div class="song-artist-sub" title="${escapeHtml(song.artist || 'Unknown Artist')}">${escapeHtml(song.artist || 'Unknown Artist')}</div>
                </div>
              </div>
            </td>

            <td class="col-album">
              <span style="color: var(--text-secondary); font-size: 0.88rem;" title="${escapeHtml(song.album || '')}">
                ${escapeHtml(song.album || '—')}
              </span>
            </td>

            <td class="col-duration">
              <span class="font-mono-duration">${escapeHtml(song.duration || '00:00')}</span>
            </td>

            <td class="col-size">
              <span style="font-size: 0.82rem; color: var(--text-secondary);">${formatBytes(song.file_size_bytes)}</span>
            </td>

            <td class="col-date">
              <span style="font-size: 0.82rem; color: var(--text-secondary);">${formatUploadDate(song.created_at)}</span>
            </td>

            <td class="col-status">
              <span class="badge-status ${isActive ? 'badge-status-active' : 'badge-status-archived'}">
                ${isActive ? 'Active' : 'Archived'}
              </span>
            </td>

            <td class="col-actions">
              <div class="table-action-btns">
                <button type="button" class="btn-row-action action-play btn-play-song" data-id="${song.id}" title="${isCurrentlyPlaying ? 'Stop Preview' : 'Listen / Preview'}">
                  ${isCurrentlyPlaying ? '■' : '▶'}
                </button>
                <button type="button" class="btn-row-action btn-edit-song" data-id="${song.id}" title="Edit Metadata">
                  ✎
                </button>
                <button type="button" class="btn-row-action btn-toggle-active" data-id="${song.id}" data-active="${isActive}" title="${isActive ? 'Archive Track' : 'Restore Track'}">
                  ${isActive ? '📁' : '↺'}
                </button>
                <button type="button" class="btn-row-action action-delete btn-delete-song" data-id="${song.id}" title="Remove Song">
                  🗑
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    attachTableActions();
  }

  function renderPagination() {
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    const indicator = document.getElementById('pageIndicator');

    if (indicator) indicator.textContent = `Page ${currentPage} of ${totalPages || 1}`;
    if (prevBtn) prevBtn.disabled = currentPage <= 1;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
  }

  // --------------------------------------------------------------------------
  // Table Action Handlers
  // --------------------------------------------------------------------------
  function attachTableActions() {
    // 1. Play / Preview triggers (both button and artwork thumbnail)
    document.querySelectorAll('.btn-play-song, .song-artwork-thumb').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.getAttribute('data-id');
        if (currentPreviewSong && currentPreviewSong.id === id) {
          closePreviewPlayer();
        } else {
          playSongPreview(id);
        }
      });
    });

    // 2. Edit Metadata
    document.querySelectorAll('.btn-edit-song').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        openEditModal(id);
      });
    });

    // 3. Toggle Archive / Active
    document.querySelectorAll('.btn-toggle-active').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const currentActive = btn.getAttribute('data-active') === 'true';
        try {
          await apiClient.patch(`/admin/songs/${id}`, { is_active: !currentActive });
          showToast(`Song ${!currentActive ? 'restored to active rotation' : 'archived'}`, 'success');
          loadSongs(currentPage);
        } catch (err) {
          showToast(`Failed to update status: ${err.message}`, 'error');
        }
      });
    });

    // 4. Delete / Remove
    document.querySelectorAll('.btn-delete-song').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const song = songsList.find((s) => s.id === id);
        if (song) {
          openDeleteModal(song);
        }
      });
    });
  }

  // --------------------------------------------------------------------------
  // Floating Preview Audio Player
  // --------------------------------------------------------------------------
  async function playSongPreview(songId) {
    const song = songsList.find((s) => s.id === songId);
    if (!song) return;

    try {
      showToast(`Loading preview for "${song.title}"...`, 'info');
      const resp = await apiClient.post(`/admin/songs/${songId}/signed-url?expiresIn=600`);
      const signedUrl = resp && resp.data ? resp.data.signedUrl : null;

      if (!signedUrl) throw new Error('Signed URL could not be generated.');

      currentPreviewSong = song;
      renderSongsTable();

      const playerBar = document.getElementById('previewPlayerBar');
      const audioEl = document.getElementById('previewAudioElement');
      const titleEl = document.getElementById('previewPlayerTitle');
      const artistEl = document.getElementById('previewPlayerArtist');

      if (titleEl) titleEl.textContent = song.title;
      if (artistEl) artistEl.textContent = song.artist || 'Unknown Artist';

      if (audioEl) {
        audioEl.src = signedUrl;
        audioEl.play().catch((e) => console.warn('Autoplay prevented:', e));
      }

      if (playerBar) playerBar.classList.add('active');
    } catch (err) {
      showToast(`Preview failed: ${err.message}`, 'error');
    }
  }

  function closePreviewPlayer() {
    const playerBar = document.getElementById('previewPlayerBar');
    const audioEl = document.getElementById('previewAudioElement');
    if (audioEl) {
      audioEl.pause();
      audioEl.src = '';
    }
    if (playerBar) playerBar.classList.remove('active');
    currentPreviewSong = null;
    renderSongsTable();
  }

  // --------------------------------------------------------------------------
  // Hero Drag-and-Drop Area Handlers
  // --------------------------------------------------------------------------
  function setupHeroDropzone() {
    const heroDropzone = document.getElementById('heroDropzone');
    const heroInput = document.getElementById('heroFileInput');
    const browseBtn = document.getElementById('browseHeroFilesBtn');

    browseBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      heroInput?.click();
    });

    heroDropzone?.addEventListener('click', () => {
      heroInput?.click();
    });

    heroDropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      heroDropzone.classList.add('drag-over');
    });

    heroDropzone?.addEventListener('dragleave', () => {
      heroDropzone.classList.remove('drag-over');
    });

    heroDropzone?.addEventListener('drop', (e) => {
      e.preventDefault();
      heroDropzone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length > 0) {
        routeDroppedFiles(files);
      }
    });

    heroInput?.addEventListener('change', () => {
      const files = Array.from(heroInput.files || []);
      if (files.length > 0) {
        routeDroppedFiles(files);
        heroInput.value = '';
      }
    });

    function routeDroppedFiles(files) {
      if (files.length === 1) {
        // Open single upload modal with prefilled file
        const openSingleBtn = document.getElementById('openSingleUploadBtn');
        openSingleBtn?.click();
        const singleInput = document.getElementById('singleFileInput');
        if (window.handleSingleFileSelect) {
          window.handleSingleFileSelect(files[0]);
        }
      } else {
        // Open bulk upload modal with files added to queue
        const openBulkBtn = document.getElementById('openBulkUploadBtn');
        openBulkBtn?.click();
        if (window.addFilesToBulkQueue) {
          window.addFilesToBulkQueue(files);
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Single Audio Upload Modal
  // --------------------------------------------------------------------------
  function setupSingleUpload() {
    const modal = document.getElementById('singleUploadModal');
    const openBtn = document.getElementById('openSingleUploadBtn');
    const closeBtn = document.getElementById('closeSingleModalBtn');
    const cancelBtn = document.getElementById('cancelSingleModalBtn');
    const dropzone = document.getElementById('singleModalDropzone');
    const fileInput = document.getElementById('singleFileInput');
    const form = document.getElementById('singleUploadForm');
    const startBtn = document.getElementById('startSingleUploadBtn');

    const fileInfoBox = document.getElementById('singleFileSelectedInfo');
    const fileNameEl = document.getElementById('selectedFileName');
    const fileSizeEl = document.getElementById('selectedFileSize');
    const clearFileBtn = document.getElementById('clearSingleSelectedFile');
    const dupAlert = document.getElementById('singleUploadDuplicateAlert');
    const dupTitle = document.getElementById('singleDupTitle');
    const dupMsg = document.getElementById('singleDupMsg');

    const progressBox = document.getElementById('singleUploadProgressContainer');
    const progressBar = document.getElementById('singleProgressBar');
    const progressPercent = document.getElementById('uploadProgressPercent');

    function resetModal() {
      singleSelectedFile = null;
      if (fileInput) fileInput.value = '';
      if (form) form.reset();
      if (fileInfoBox) fileInfoBox.style.display = 'none';
      if (dupAlert) dupAlert.style.display = 'none';
      if (progressBox) progressBox.style.display = 'none';
      if (progressBar) progressBar.style.width = '0%';
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.textContent = 'Upload to Library';
      }
    }

    openBtn?.addEventListener('click', () => {
      resetModal();
      modal.style.display = 'flex';
    });

    closeBtn?.addEventListener('click', () => (modal.style.display = 'none'));
    cancelBtn?.addEventListener('click', () => (modal.style.display = 'none'));

    dropzone?.addEventListener('click', () => fileInput?.click());

    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });

    dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));

    dropzone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFileSelection(e.dataTransfer.files[0]);
      }
    });

    fileInput?.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) {
        handleFileSelection(fileInput.files[0]);
      }
    });

    clearFileBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      resetModal();
    });

    function handleFileSelection(file) {
      if (file.size > 50 * 1024 * 1024) {
        alert(`Selected file exceeds the 50 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB).`);
        return;
      }
      singleSelectedFile = file;

      if (fileNameEl) fileNameEl.textContent = file.name;
      if (fileSizeEl) fileSizeEl.textContent = formatBytes(file.size);
      if (fileInfoBox) fileInfoBox.style.display = 'block';

      // Duplicate pre-detection against loaded catalogue
      const normInput = file.name.trim().toLowerCase();
      const existing = songsList.find((s) => s.original_filename && s.original_filename.trim().toLowerCase() === normInput);
      if (existing) {
        if (dupTitle) dupTitle.textContent = 'Duplicate detected – this filename is already in your library.';
        if (dupMsg) dupMsg.textContent = `Existing song: "${existing.title}" by ${existing.artist || 'Unknown Artist'} (uploaded on ${formatUploadDate(existing.created_at)}).`;
        if (dupAlert) dupAlert.style.display = 'block';
      } else {
        if (dupAlert) dupAlert.style.display = 'none';
      }

      // Pre-fill Title from filename if empty
      const titleInput = document.getElementById('uploadSongTitle');
      if (titleInput && !titleInput.value) {
        const rawName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
        titleInput.value = rawName.replace(/[_\-]+/g, ' ').trim();
      }

      if (startBtn) startBtn.disabled = false;
    }

    // Expose for hero dropzone routing
    window.handleSingleFileSelect = handleFileSelection;

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!singleSelectedFile) return;

      const title = document.getElementById('uploadSongTitle').value.trim();
      const artist = document.getElementById('uploadSongArtist').value.trim();
      const album = document.getElementById('uploadSongAlbum').value.trim();

      const formData = new FormData();
      formData.append('file', singleSelectedFile);
      if (title) formData.append('title', title);
      if (artist) formData.append('artist', artist);
      if (album) formData.append('album', album);

      if (progressBox) progressBox.style.display = 'block';
      if (progressBar) progressBar.style.width = '60%';
      if (progressPercent) progressPercent.textContent = '60%';
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.textContent = 'Uploading to Storage...';
      }

      try {
        const resp = await apiClient.upload('/admin/songs', formData);
        if (progressBar) progressBar.style.width = '100%';
        if (progressPercent) progressPercent.textContent = '100%';

        showToast(`Successfully uploaded "${resp.data ? resp.data.title : singleSelectedFile.name}"`, 'success');
        modal.style.display = 'none';
        resetModal();
        loadSongs(1);
      } catch (err) {
        if (err.status === 409 || err.conflict) {
          if (dupTitle) dupTitle.textContent = 'Duplicate Song Detected';
          let detail = err.message || 'This song already exists in your library.';
          if (err.existing_song) {
            detail += `\nExisting: "${err.existing_song.title}" (${err.existing_song.original_filename}).`;
          }
          if (dupMsg) dupMsg.textContent = detail;
          if (dupAlert) dupAlert.style.display = 'block';
          showToast(`Duplicate: ${err.message}`, 'error');
        } else {
          alert(`Upload failed: ${err.message}`);
        }

        if (startBtn) {
          startBtn.disabled = false;
          startBtn.textContent = 'Upload to Library';
        }
        if (progressBox) progressBox.style.display = 'none';
      }
    });
  }

  // --------------------------------------------------------------------------
  // Bulk Upload Modal (Queue, Concurrency & Retry)
  // --------------------------------------------------------------------------
  function setupBulkUpload() {
    const modal = document.getElementById('bulkUploadModal');
    const openBtn = document.getElementById('openBulkUploadBtn');
    const closeBtn = document.getElementById('closeBulkModalBtn');
    const cancelBtn = document.getElementById('cancelBulkModalBtn');
    const dropzone = document.getElementById('bulkModalDropzone');
    const fileInput = document.getElementById('bulkFileInput');
    const startBtn = document.getElementById('startBulkUploadBtn');
    const retryBtn = document.getElementById('retryFailedBtn');
    const queueContainer = document.getElementById('bulkQueueContainer');
    const summaryBanner = document.getElementById('bulkSummaryBanner');

    function resetBulkModal() {
      bulkQueue = [];
      if (fileInput) fileInput.value = '';
      if (queueContainer) queueContainer.innerHTML = '';
      if (summaryBanner) summaryBanner.style.display = 'none';
      if (retryBtn) retryBtn.style.display = 'none';
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.textContent = 'Start Bulk Upload';
      }
    }

    openBtn?.addEventListener('click', () => {
      resetBulkModal();
      modal.style.display = 'flex';
    });

    closeBtn?.addEventListener('click', () => (modal.style.display = 'none'));
    cancelBtn?.addEventListener('click', () => (modal.style.display = 'none'));

    dropzone?.addEventListener('click', () => fileInput?.click());

    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });

    dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));

    dropzone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer.files) {
        addFilesToBulkQueue(Array.from(e.dataTransfer.files));
      }
    });

    fileInput?.addEventListener('change', () => {
      if (fileInput.files) {
        addFilesToBulkQueue(Array.from(fileInput.files));
      }
    });

    function addFilesToBulkQueue(files) {
      files.forEach((file) => {
        if (bulkQueue.length < 20) {
          const normInput = file.name.trim().toLowerCase();
          const inLibrary = songsList.some((s) => s.original_filename && s.original_filename.trim().toLowerCase() === normInput);
          const inQueue = bulkQueue.some((b) => b.file.name.trim().toLowerCase() === normInput);

          bulkQueue.push({
            id: 'bq_' + Math.random().toString(36).substring(2, 9),
            file,
            status: 'pending',
            warning: inLibrary ? 'Filename already in library' : (inQueue ? 'Duplicate filename in batch' : null),
            error: null
          });
        }
      });
      renderBulkQueue();
      if (startBtn) startBtn.disabled = bulkQueue.length === 0;
    }

    window.addFilesToBulkQueue = addFilesToBulkQueue;

    function renderBulkQueue() {
      if (!queueContainer) return;
      if (bulkQueue.length === 0) {
        queueContainer.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No files selected yet.</div>';
        return;
      }

      queueContainer.innerHTML = bulkQueue
        .map((item) => {
          let badgeColor = 'var(--text-muted)';
          let badgeText = item.warning ? `⚠️ ${item.warning}` : 'Pending';

          if (item.status === 'uploading') {
            badgeColor = 'var(--primary)';
            badgeText = 'Uploading...';
          } else if (item.status === 'success') {
            badgeColor = '#059669';
            badgeText = '✓ Uploaded';
          } else if (item.status === 'duplicate_filename') {
            badgeColor = '#D97706';
            badgeText = `⚠️ Duplicate Filename: ${escapeHtml(item.error || 'Already in library')}`;
          } else if (item.status === 'duplicate_content') {
            badgeColor = '#D97706';
            badgeText = `⚠️ Duplicate Audio: ${escapeHtml(item.error || 'Identical content')}`;
          } else if (item.status === 'error') {
            badgeColor = '#DC2626';
            badgeText = `✕ ${escapeHtml(item.error || 'Failed')}`;
          }

          return `
            <div class="upload-queue-card" id="${item.id}">
              <div class="upload-queue-icon">♫</div>
              <div class="upload-queue-info">
                <div class="upload-queue-filename">${escapeHtml(item.file.name)}</div>
                <div class="upload-queue-meta">
                  <span>${formatBytes(item.file.size)}</span>
                  <span>•</span>
                  <span style="font-weight: 700; color: ${badgeColor}; font-size: 0.78rem;">${badgeText}</span>
                </div>
              </div>
            </div>
          `;
        })
        .join('');
    }

    startBtn?.addEventListener('click', async () => {
      const pendingItems = bulkQueue.filter((item) => item.status === 'pending' || item.status === 'error');
      if (pendingItems.length === 0) return;

      startBtn.disabled = true;
      startBtn.textContent = 'Uploading Queue...';
      if (retryBtn) retryBtn.style.display = 'none';

      const formData = new FormData();
      pendingItems.forEach((item) => {
        formData.append('files', item.file);
        item.status = 'uploading';
      });
      renderBulkQueue();

      try {
        const resp = await apiClient.upload('/admin/songs/bulk?concurrency=3', formData);
        const results = resp && resp.data ? resp.data : [];

        // Map results back to queue items
        pendingItems.forEach((item, idx) => {
          const res = results[idx];
          if (res && res.success) {
            item.status = 'success';
          } else if (res && (res.status === 'duplicate_filename' || res.duplicateType === 'filename')) {
            item.status = 'duplicate_filename';
            item.error = res.message || 'Duplicate filename';
          } else if (res && (res.status === 'duplicate_content' || res.duplicateType === 'content')) {
            item.status = 'duplicate_content';
            item.error = res.message || 'Duplicate audio content';
          } else {
            item.status = 'error';
            item.error = res ? (res.error || res.message) : 'Failed to upload';
          }
        });

        renderBulkQueue();

        const successful = resp.successful || 0;
        const duplicates = (resp.duplicates !== undefined) ? resp.duplicates : ((resp.duplicate_filename || 0) + (resp.duplicate_content || 0));
        const failed = resp.failed || 0;

        if (summaryBanner) {
          summaryBanner.style.display = 'block';
          if (failed === 0 && duplicates === 0) {
            summaryBanner.style.background = 'rgba(16, 185, 129, 0.12)';
            summaryBanner.style.color = '#047857';
            summaryBanner.textContent = `All ${successful} songs uploaded successfully to library.`;
          } else {
            const isWarning = failed === 0 && duplicates > 0;
            summaryBanner.style.background = isWarning ? 'rgba(245, 158, 11, 0.12)' : 'rgba(239, 68, 68, 0.12)';
            summaryBanner.style.color = isWarning ? '#B45309' : '#b91c1c';
            summaryBanner.textContent = `${successful} uploaded, ${duplicates} duplicate(s) prevented, ${failed} failed.${failed > 0 ? ' Click "Retry Failed" to try again.' : ''}`;
            if (retryBtn) retryBtn.style.display = failed > 0 ? 'inline-block' : 'none';
          }
        }

        showToast(`Bulk upload complete: ${successful} uploaded, ${duplicates} duplicate(s), ${failed} failed`, failed === 0 ? 'success' : 'error');
        loadSongs(1);
      } catch (err) {
        alert(`Bulk upload encountered error: ${err.message}`);
      } finally {
        startBtn.textContent = 'Upload Finished';
      }
    });

    retryBtn?.addEventListener('click', () => {
      bulkQueue.forEach((item) => {
        if (item.status === 'error') item.status = 'pending';
      });
      renderBulkQueue();
      startBtn.click();
    });
  }

  // --------------------------------------------------------------------------
  // Edit Metadata Modal
  // --------------------------------------------------------------------------
  function openEditModal(songId) {
    const song = songsList.find((s) => s.id === songId);
    if (!song) return;

    const modal = document.getElementById('editMetadataModal');
    document.getElementById('editSongId').value = song.id;
    document.getElementById('editTitleInput').value = song.title || '';
    document.getElementById('editArtistInput').value = song.artist || '';
    document.getElementById('editAlbumInput').value = song.album || '';
    document.getElementById('editActiveInput').checked = Boolean(song.is_active);

    modal.style.display = 'flex';
  }

  function setupEditModal() {
    const modal = document.getElementById('editMetadataModal');
    const closeBtn = document.getElementById('closeEditModalBtn');
    const cancelBtn = document.getElementById('cancelEditModalBtn');
    const form = document.getElementById('editMetadataForm');

    closeBtn?.addEventListener('click', () => (modal.style.display = 'none'));
    cancelBtn?.addEventListener('click', () => (modal.style.display = 'none'));

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('editSongId').value;
      const title = document.getElementById('editTitleInput').value.trim();
      const artist = document.getElementById('editArtistInput').value.trim();
      const album = document.getElementById('editAlbumInput').value.trim();
      const isActive = document.getElementById('editActiveInput').checked;

      try {
        await apiClient.patch(`/admin/songs/${id}`, {
          title,
          artist,
          album,
          is_active: isActive
        });

        modal.style.display = 'none';
        showToast('Song metadata saved successfully', 'success');
        loadSongs(currentPage);
      } catch (err) {
        alert(`Failed to update metadata: ${err.message}`);
      }
    });
  }

  // --------------------------------------------------------------------------
  // Delete / Archive Confirmation Modal
  // --------------------------------------------------------------------------
  function openDeleteModal(song) {
    songPendingDelete = song;
    const modal = document.getElementById('deleteConfirmModal');
    const nameEl = document.getElementById('deleteTrackName');
    const warningEl = document.getElementById('deleteConflictWarning');

    if (nameEl) nameEl.textContent = `"${song.title}" by ${song.artist || 'Unknown Artist'}`;
    if (warningEl) warningEl.style.display = 'none';

    modal.style.display = 'flex';
  }

  function setupDeleteModal() {
    const modal = document.getElementById('deleteConfirmModal');
    const closeBtn = document.getElementById('closeDeleteModalBtn');
    const cancelBtn = document.getElementById('cancelDeleteModalBtn');
    const archiveBtn = document.getElementById('confirmArchiveBtn');
    const permanentBtn = document.getElementById('confirmPermanentDeleteBtn');
    const warningEl = document.getElementById('deleteConflictWarning');

    closeBtn?.addEventListener('click', () => (modal.style.display = 'none'));
    cancelBtn?.addEventListener('click', () => (modal.style.display = 'none'));

    archiveBtn?.addEventListener('click', async () => {
      if (!songPendingDelete) return;
      try {
        await apiClient.patch(`/admin/songs/${songPendingDelete.id}`, { is_active: false });
        modal.style.display = 'none';
        showToast(`Archived "${songPendingDelete.title}"`, 'success');
        loadSongs(currentPage);
      } catch (err) {
        showToast(`Failed to archive: ${err.message}`, 'error');
      }
    });

    permanentBtn?.addEventListener('click', async () => {
      if (!songPendingDelete) return;
      try {
        await apiClient.delete(`/admin/songs/${songPendingDelete.id}?permanent=true`);
        modal.style.display = 'none';
        showToast(`Permanently deleted "${songPendingDelete.title}"`, 'info');
        loadSongs(currentPage);
      } catch (err) {
        if (err.status === 409 || err.conflict) {
          if (warningEl) {
            warningEl.style.display = 'block';
            warningEl.textContent = err.message || 'Cannot delete song: it is currently assigned to program schedules. Archive it instead or remove it from schedules first.';
          }
        } else {
          showToast(`Delete failed: ${err.message}`, 'error');
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // Search, Filters, Sorting & Pagination Toolbar
  // --------------------------------------------------------------------------
  function setupToolbar() {
    const searchInput = document.getElementById('songLibrarySearch');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    const statusSelect = document.getElementById('songStatusFilter');
    const sortSelect = document.getElementById('songSortSelect');
    const pageSizeSelect = document.getElementById('pageSizeSelect');
    const refreshBtn = document.getElementById('refreshSongsBtn');
    const retryLoadBtn = document.getElementById('retryLoadBtn');

    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    const closePreviewBtn = document.getElementById('closePreviewPlayerBtn');

    // Search input with debounce
    searchInput?.addEventListener('input', () => {
      const val = searchInput.value.trim();
      if (clearSearchBtn) clearSearchBtn.style.display = val ? 'inline-block' : 'none';

      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        searchQuery = val;
        loadSongs(1);
      }, 300);
    });

    clearSearchBtn?.addEventListener('click', () => {
      searchInput.value = '';
      clearSearchBtn.style.display = 'none';
      searchQuery = '';
      loadSongs(1);
    });

    // Filter by status
    statusSelect?.addEventListener('change', (e) => {
      statusFilter = e.target.value;
      loadSongs(1);
    });

    // Sort selection (parses column-direction e.g. "title-asc")
    sortSelect?.addEventListener('change', (e) => {
      const parts = e.target.value.split('-');
      sortBy = parts[0] || 'created_at';
      sortOrder = parts[1] || 'desc';
      loadSongs(1);
    });

    // Page size selection
    pageSizeSelect?.addEventListener('change', (e) => {
      pageLimit = parseInt(e.target.value, 10) || 15;
      loadSongs(1);
    });

    // Refresh button
    refreshBtn?.addEventListener('click', () => {
      refreshBtn.classList.add('spin-icon');
      loadSongs(currentPage).finally(() => {
        setTimeout(() => refreshBtn.classList.remove('spin-icon'), 500);
      });
    });

    // Recoverable retry button
    retryLoadBtn?.addEventListener('click', () => {
      loadSongs(currentPage);
    });

    // Pagination buttons
    prevBtn?.addEventListener('click', () => {
      if (currentPage > 1) loadSongs(currentPage - 1);
    });

    nextBtn?.addEventListener('click', () => {
      if (currentPage < totalPages) loadSongs(currentPage + 1);
    });

    // Preview close button
    closePreviewBtn?.addEventListener('click', closePreviewPlayer);
  }

  // --------------------------------------------------------------------------
  // Controller Initialization
  // --------------------------------------------------------------------------
  async function init() {
    const isAuthed = await checkAdminAuth();
    if (!isAuthed) return;

    setupHeroDropzone();
    setupToolbar();
    setupSingleUpload();
    setupBulkUpload();
    setupEditModal();
    setupDeleteModal();

    await loadSongs(1);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
