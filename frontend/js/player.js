/**
 * Full-Stack Internet Radio Streaming System
 * Frontend Player Engine (frontend/js/player.js)
 * Implements HTML5 Audio API controls, event lifecycles, and API station loading (FR-01 to FR-06)
 */

(function () {
  'use strict';

  const elements = {
    audio: document.getElementById('audioPlayer'),
    stationName: document.getElementById('stationName'),
    stationTagline: document.getElementById('stationTagline'),
    stationDesc: document.getElementById('stationDesc'),
    stationFormat: document.getElementById('stationFormat'),
    stationProtocol: document.getElementById('stationProtocol'),
    serverType: document.getElementById('serverType'),
    stationArtwork: document.getElementById('stationArtwork'),
    streamUrlDisplay: document.getElementById('streamUrlDisplay'),
    equalizer: document.getElementById('equalizer'),

    playPauseBtn: document.getElementById('playPauseBtn'),
    playIcon: document.getElementById('playIcon'),
    pauseIcon: document.getElementById('pauseIcon'),
    loadingSpinner: document.getElementById('loadingSpinner'),
    muteBtn: document.getElementById('muteBtn'),
    volIconHigh: document.getElementById('volIconHigh'),
    volIconMed: document.getElementById('volIconMed'),
    volIconMuted: document.getElementById('volIconMuted'),
    volumeSlider: document.getElementById('volumeSlider'),
    volumeReadout: document.getElementById('volumeReadout'),

    statusBanner: document.getElementById('statusBanner'),
    statusTitle: document.getElementById('statusTitle'),
    statusMessage: document.getElementById('statusMessage'),
    retryBtn: document.getElementById('retryBtn'),

    stationSelect: document.getElementById('stationSelect'),
    schedulesContainer: document.getElementById('schedulesContainer'),
    customStreamInput: document.getElementById('customStreamInput'),
    applyCustomStreamBtn: document.getElementById('applyCustomStreamBtn'),

    logConsole: document.getElementById('logConsole'),
    clearLogBtn: document.getElementById('clearLogBtn'),
    toggleLogDetailsBtn: document.getElementById('toggleLogDetailsBtn'),
    logConsoleContainer: document.getElementById('logConsoleContainer'),

    toggleGuideBtn: document.getElementById('toggleGuideBtn'),
    closeGuideBtn: document.getElementById('closeGuideBtn'),
    modalDismissBtn: document.getElementById('modalDismissBtn'),
    guideModal: document.getElementById('guideModal')
  };

  const state = {
    currentStation: null,
    stationsList: [],
    isPlaying: false,
    isLoading: false,
    isMuted: false,
    volume: 0.8,
    previousVolume: 0.8
  };

  function logMessage(msg, type = 'sys') {
    if (!elements.logConsole) return;
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');

    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${timeStr}] ${msg}`;

    elements.logConsole.appendChild(entry);
    elements.logConsole.scrollTop = elements.logConsole.scrollHeight;

    if (elements.logConsole.childElementCount > 100) {
      elements.logConsole.removeChild(elements.logConsole.firstChild);
    }
  }

  function setPlayerState(statusType, titleText, messageText, showRetry = false) {
    if (!elements.statusBanner) return;

    elements.statusBanner.className = 'status-banner';
    if (statusType) {
      elements.statusBanner.classList.add(`state-${statusType}`);
    }

    if (elements.statusTitle) elements.statusTitle.textContent = titleText;
    if (elements.statusMessage) elements.statusMessage.textContent = messageText;
    if (elements.retryBtn) elements.retryBtn.style.display = showRetry ? 'inline-flex' : 'none';

    if (statusType === 'loading' || statusType === 'buffering') {
      if (elements.playIcon) elements.playIcon.style.display = 'none';
      if (elements.pauseIcon) elements.pauseIcon.style.display = 'none';
      if (elements.loadingSpinner) elements.loadingSpinner.style.display = 'inline-block';
      if (elements.equalizer) elements.equalizer.classList.remove('active');
    } else if (statusType === 'playing') {
      if (elements.loadingSpinner) elements.loadingSpinner.style.display = 'none';
      if (elements.playIcon) elements.playIcon.style.display = 'none';
      if (elements.pauseIcon) elements.pauseIcon.style.display = 'inline-block';
      if (elements.equalizer) elements.equalizer.classList.add('active');
    } else {
      if (elements.loadingSpinner) elements.loadingSpinner.style.display = 'none';
      if (elements.pauseIcon) elements.pauseIcon.style.display = 'none';
      if (elements.playIcon) elements.playIcon.style.display = 'inline-block';
      if (elements.equalizer) elements.equalizer.classList.remove('active');
    }
  }

  async function loadStation(station, autoPlay = false) {
    state.currentStation = station;

    if (elements.stationName) elements.stationName.textContent = station.name;
    if (elements.stationTagline) elements.stationTagline.textContent = station.genre || 'Live Internet Broadcast';
    if (elements.stationDesc) elements.stationDesc.textContent = station.description || 'Continuous online streaming audio broadcast.';
    if (elements.streamUrlDisplay) elements.streamUrlDisplay.textContent = station.stream_url;
    if (elements.serverType) elements.serverType.textContent = station.genre || 'Icecast / HTTP Stream';

    logMessage(`Loaded station: "${station.name}" (${station.stream_url})`, 'sys');

    // Load program schedule and upcoming tracks from MySQL
    loadSchedules(station.id);
    loadUpcomingTracks(station.id);

    if (elements.audio.src !== station.stream_url) {
      elements.audio.src = station.stream_url;
      elements.audio.load();
    }

    if (autoPlay) {
      startPlayback();
    } else {
      setPlayerState('ready', 'Ready', `Ready to stream "${station.name}". Click Play to start.`, false);
    }
  }

  async function loadSchedules(stationId) {
    if (!elements.schedulesContainer) return;
    elements.schedulesContainer.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem;">Loading program schedule...</div>';

    try {
      const resp = await apiClient.get(`/stations/${stationId}/schedules`);
      if (resp && resp.data && resp.data.length > 0) {
        elements.schedulesContainer.innerHTML = resp.data
          .map(
            (s) => `
          <div class="schedule-item">
            <div class="schedule-time">${escapeHtml(s.start_time)} - ${escapeHtml(s.end_time)}</div>
            <div class="schedule-info">
              <div class="schedule-title">${escapeHtml(s.title)}</div>
              <div class="schedule-desc">${escapeHtml(s.description || '')}</div>
            </div>
          </div>
        `
          )
          .join('');
      } else {
        elements.schedulesContainer.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem;">No published programs scheduled for today. Continuous music broadcast.</div>';
      }
    } catch (e) {
      elements.schedulesContainer.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem;">Continuous live stream.</div>';
    }
  }

  async function loadUpcomingTracks(stationId) {
    const titleEl = document.getElementById('nowPlayingTrackTitle');
    const artistEl = document.getElementById('nowPlayingTrackArtist');
    const durationEl = document.getElementById('nowPlayingTrackDuration');
    const queueList = document.getElementById('upcomingTracksList');

    if (!queueList) return;

    try {
      const resp = await apiClient.get(`/stations/${stationId}/tracks`);
      const nowPlaying = resp && resp.now_playing ? resp.now_playing : null;
      const upNext = resp && resp.up_next ? resp.up_next : [];

      if (nowPlaying) {
        if (titleEl) titleEl.textContent = nowPlaying.title;
        if (artistEl) artistEl.textContent = `${nowPlaying.artist}${nowPlaying.album ? ' • ' + nowPlaying.album : ''}`;
        if (durationEl) durationEl.textContent = nowPlaying.duration || '03:45';
      } else {
        if (titleEl) titleEl.textContent = 'Live Audio Broadcast';
        if (artistEl) artistEl.textContent = state.currentStation ? state.currentStation.name : '';
        if (durationEl) durationEl.textContent = 'LIVE';
      }

      if (upNext.length > 0) {
        queueList.innerHTML = upNext
          .map(
            (track, idx) => `
          <div class="schedule-item" style="border-left-color: #ec4899;">
            <div class="schedule-time" style="color: #ec4899; min-width: 80px;">
              #${idx + 1} Next
            </div>
            <div class="schedule-info">
              <div class="schedule-title">${escapeHtml(track.title)} <span style="font-size:0.75rem; color:var(--text-muted); font-weight:normal;">by ${escapeHtml(track.artist)}</span></div>
              <div class="schedule-desc">${escapeHtml(track.album ? 'Album: ' + track.album : 'Upcoming stream segment')}</div>
            </div>
            <span class="tag" style="background:rgba(255,255,255,0.06); color:var(--text-secondary);">${escapeHtml(track.duration || '03:30')}</span>
          </div>
        `
          )
          .join('');
      } else {
        queueList.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem;">Continuous live stream. No additional queued songs in MySQL.</div>';
      }
    } catch (e) {
      if (titleEl) titleEl.textContent = 'Live Broadcast';
      if (artistEl) artistEl.textContent = state.currentStation ? state.currentStation.name : '';
      queueList.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem;">Continuous stream.</div>';
    }
  }

  function startPlayback() {
    if (!state.currentStation) return;

    state.isLoading = true;
    setPlayerState('loading', 'Connecting', `Connecting to ${state.currentStation.name}...`);
    logMessage(`Attempting audio playback for ${state.currentStation.stream_url}`, 'event');

    const playPromise = elements.audio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          logMessage('play() promise resolved by browser.', 'play');
        })
        .catch((error) => {
          state.isLoading = false;
          state.isPlaying = false;
          logMessage(`Playback rejected: ${error.name} - ${error.message}`, 'err');

          if (error.name === 'NotAllowedError') {
            setPlayerState('error', 'Autoplay Prevented', 'Browser requires interaction. Click Play to start listening.', false);
          } else {
            setPlayerState('error', 'Stream Unavailable', 'Failed to connect to stream server. Check stream or retry.', true);
          }
        });
    }
  }

  function pausePlayback() {
    logMessage('Audio playback paused.', 'pause');
    elements.audio.pause();
    state.isPlaying = false;
    state.isLoading = false;
    setPlayerState('paused', 'Paused', 'Stream paused. Click Play or Resume to continue.', false);
  }

  function togglePlayPause() {
    if (state.isPlaying || state.isLoading) {
      pausePlayback();
    } else {
      startPlayback();
    }
  }

  function retryPlayback() {
    logMessage('Retrying playback...', 'event');
    if (state.currentStation) {
      elements.audio.src = state.currentStation.stream_url;
      elements.audio.load();
      startPlayback();
    }
  }

  function updateVolume(newVol, updateSlider = true) {
    const clamped = Math.max(0, Math.min(1, parseFloat(newVol)));
    elements.audio.volume = clamped;
    state.volume = clamped;

    const percent = Math.round(clamped * 100);
    if (elements.volumeReadout) elements.volumeReadout.textContent = `${percent}%`;

    if (updateSlider && elements.volumeSlider) {
      elements.volumeSlider.value = clamped;
    }

    if (clamped === 0 || state.isMuted) {
      if (elements.volIconHigh) elements.volIconHigh.style.display = 'none';
      if (elements.volIconMed) elements.volIconMed.style.display = 'none';
      if (elements.volIconMuted) elements.volIconMuted.style.display = 'inline-block';
    } else if (clamped < 0.5) {
      if (elements.volIconHigh) elements.volIconHigh.style.display = 'none';
      if (elements.volIconMed) elements.volIconMed.style.display = 'inline-block';
      if (elements.volIconMuted) elements.volIconMuted.style.display = 'none';
    } else {
      if (elements.volIconHigh) elements.volIconHigh.style.display = 'inline-block';
      if (elements.volIconMed) elements.volIconMed.style.display = 'none';
      if (elements.volIconMuted) elements.volIconMuted.style.display = 'none';
    }
  }

  function toggleMute() {
    if (state.isMuted) {
      state.isMuted = false;
      const restore = state.previousVolume > 0 ? state.previousVolume : 0.8;
      updateVolume(restore);
      logMessage(`Unmuted. Volume restored to ${Math.round(restore * 100)}%`, 'sys');
    } else {
      state.previousVolume = state.volume;
      state.isMuted = true;
      updateVolume(0);
      logMessage('Audio muted.', 'sys');
    }
  }

  function setupAudioEvents() {
    const a = elements.audio;
    if (!a) return;

    a.addEventListener('loadstart', () => {
      logMessage('Audio event: loadstart', 'event');
      setPlayerState('loading', 'Connecting', 'Requesting stream packets from server...');
    });

    a.addEventListener('canplay', () => {
      logMessage('Audio event: canplay', 'event');
      state.isLoading = false;
    });

    a.addEventListener('playing', () => {
      state.isPlaying = true;
      state.isLoading = false;
      logMessage('Audio event: playing', 'play');
      const name = state.currentStation ? state.currentStation.name : 'Live Stream';
      setPlayerState('playing', 'Live Broadcast', `Now streaming: ${name} • High Fidelity`, false);
    });

    a.addEventListener('pause', () => {
      logMessage('Audio event: pause', 'pause');
      state.isPlaying = false;
      state.isLoading = false;
      setPlayerState('paused', 'Paused', 'Stream paused. Click Play or Resume to continue.', false);
    });

    a.addEventListener('waiting', () => {
      logMessage('Audio event: waiting (buffering)', 'event');
      setPlayerState('buffering', 'Buffering', 'Network buffer refilling...');
    });

    a.addEventListener('stalled', () => {
      logMessage('Audio event: stalled', 'event');
      if (state.isPlaying) {
        setPlayerState('buffering', 'Buffering', 'Stream connection stalled; waiting for data...');
      }
    });

    a.addEventListener('error', () => {
      state.isPlaying = false;
      state.isLoading = false;
      const mediaErr = a.error;
      let msg = 'Stream connection failed or unsupported audio codec.';
      if (mediaErr) {
        if (mediaErr.code === 2) msg = 'Network error downloading audio stream.';
        if (mediaErr.code === 3) msg = 'Audio decode error.';
        if (mediaErr.code === 4) msg = 'Stream endpoint unavailable or format not supported.';
      }
      logMessage(`Audio event error: ${msg}`, 'err');
      setPlayerState('error', 'Stream Error', msg, true);
    });
  }

  function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.code === 'Space' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        state.isMuted = false;
        updateVolume(Math.min(1, state.volume + 0.05));
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        state.isMuted = false;
        updateVolume(Math.max(0, state.volume - 0.05));
      } else if (e.code === 'Escape' && elements.guideModal && elements.guideModal.style.display !== 'none') {
        elements.guideModal.style.display = 'none';
      }
    });
  }

  async function fetchStationsAndInit() {
    try {
      logMessage('Fetching stations from /api/stations...', 'sys');
      const response = await apiClient.get('/stations');
      state.stationsList = response && response.data ? response.data : [];

      if (elements.stationSelect) {
        elements.stationSelect.innerHTML = state.stationsList
          .map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.genre || 'Live')})</option>`)
          .join('');

        elements.stationSelect.addEventListener('change', (e) => {
          const selectedId = parseInt(e.target.value, 10);
          const found = state.stationsList.find((s) => s.id === selectedId);
          if (found) loadStation(found, state.isPlaying);
        });
      }

      // Check if URL has station query param ?station=id
      const urlParams = new URLSearchParams(window.location.search);
      const paramId = parseInt(urlParams.get('station'), 10);
      let targetStation = state.stationsList.find((s) => s.id === paramId);

      if (!targetStation && state.stationsList.length > 0) {
        targetStation = state.stationsList[0];
      }

      if (targetStation) {
        if (elements.stationSelect) elements.stationSelect.value = targetStation.id;
        loadStation(targetStation, false);
      }
    } catch (e) {
      logMessage(`Failed to fetch stations from API: ${e.message}`, 'err');
      // Fallback station if API is offline
      loadStation({
        id: 1,
        name: 'Radio Paradise (Main Mix)',
        genre: 'Eclectic Rock & Acoustic',
        description: 'Commercial-free high fidelity streaming audio.',
        stream_url: 'https://stream.radioparadise.com/mp3-128'
      });
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, (t) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[t] || t));
  }

  function init() {
    setupAudioEvents();
    setupKeyboardShortcuts();
    updateVolume(0.8);

    if (elements.playPauseBtn) elements.playPauseBtn.addEventListener('click', togglePlayPause);
    if (elements.retryBtn) elements.retryBtn.addEventListener('click', retryPlayback);
    if (elements.muteBtn) elements.muteBtn.addEventListener('click', toggleMute);

    if (elements.volumeSlider) {
      elements.volumeSlider.addEventListener('input', (e) => {
        state.isMuted = false;
        updateVolume(e.target.value, false);
      });
    }

    // Custom stream button
    if (elements.applyCustomStreamBtn && elements.customStreamInput) {
      elements.applyCustomStreamBtn.addEventListener('click', () => {
        const url = elements.customStreamInput.value.trim();
        if (url) {
          loadStation({
            id: 9999,
            name: 'Custom Stream Mount',
            genre: 'User Stream / Icecast',
            description: 'Custom external stream or self-hosted Icecast server endpoint.',
            stream_url: url
          }, true);
        }
      });
    }

    // Modal Guide triggers
    if (elements.toggleGuideBtn && elements.guideModal) {
      elements.toggleGuideBtn.addEventListener('click', () => { elements.guideModal.style.display = 'flex'; });
    }
    if (elements.closeGuideBtn && elements.guideModal) {
      elements.closeGuideBtn.addEventListener('click', () => { elements.guideModal.style.display = 'none'; });
    }
    if (elements.modalDismissBtn && elements.guideModal) {
      elements.modalDismissBtn.addEventListener('click', () => { elements.guideModal.style.display = 'none'; });
    }

    fetchStationsAndInit();
  }

  document.addEventListener('DOMContentLoaded', init);
  window.radioPlayer = {
    playStation: (station) => loadStation(station, true),
    pause: pausePlayback
  };
})();

