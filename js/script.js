/**
 * Web-Based Internet Radio Streaming System
 * JavaScript Player Controller (js/script.js)
 * Implements SRS v1.0 specifications and FR-01 through FR-12.
 */

(function () {
  'use strict';

  /* ==========================================================================
     1. Station Configuration & Presets (FR-02, FR-10)
     ========================================================================== */
  const STATION_PRESETS = {
    'radio-paradise': {
      name: 'Radio Paradise (Main Mix)',
      tagline: 'Eclectic Rock, Indie, World & Acoustic Stream',
      description: 'High-fidelity commercial-free streaming audio distributed over internet audio servers.',
      format: '128 kbps MP3',
      protocol: 'HTTPS Direct',
      serverType: 'Icecast / HTTP Stream',
      url: 'https://stream.radioparadise.com/mp3-128',
      artwork: 'assets/station-artwork.svg'
    },
    'nightwave-plaza': {
      name: 'Nightwave Plaza',
      tagline: 'Vaporwave, Future Funk & Nostalgic Beats',
      description: '24/7 internet radio broadcast dedicated to vaporwave and aesthetic electronic soundscapes.',
      format: '128 kbps MP3',
      protocol: 'HTTPS Direct',
      serverType: 'Icecast 2 / Nginx',
      url: 'https://radio.plaza.one/mp3',
      artwork: 'assets/station-artwork.svg'
    },
    'icecast-live': {
      name: 'CJWF FM / Icecast 2.4 Server',
      tagline: 'Official Icecast 2.4 Server Broadcast Mount',
      description: 'Direct live stream demonstration from a standard Icecast 2.4 audio streaming server.',
      format: '128 kbps MP3',
      protocol: 'HTTPS Direct',
      serverType: 'Icecast 2.4.0-kh8',
      url: 'https://live.leanstream.co/CJWFFM-MP3',
      artwork: 'assets/station-artwork.svg'
    },
    'test-invalid': {
      name: 'TC-05 Test Station (Invalid URL)',
      tagline: 'SRS Test Case 05 — Demonstrates Invalid Endpoint Handling',
      description: 'A deliberately broken URL endpoint designed to verify robust error messaging without crashes.',
      format: 'Invalid URL',
      protocol: 'HTTP 404',
      serverType: 'Error Simulation',
      url: 'https://stream.invalid-nonexistent-domain.xyz/broken-radio.mp3',
      artwork: 'assets/station-artwork.svg'
    },
    'test-offline': {
      name: 'TC-06 Test Station (Offline Server)',
      tagline: 'SRS Test Case 06 — Demonstrates Offline Server Handling',
      description: 'Points to an unreachable IP endpoint to verify connection timeout and retry handling.',
      format: 'Unavailable',
      protocol: 'TCP Refused',
      serverType: 'Offline Simulation',
      url: 'http://192.0.2.1:8000/offline-mount.mp3',
      artwork: 'assets/station-artwork.svg'
    }
  };

  const DEFAULT_CONFIG = {
    defaultPresetKey: 'radio-paradise',
    initialVolume: 0.8
  };

  /* ==========================================================================
     2. DOM Elements Cache
     ========================================================================== */
  const elements = {
    // Audio Element
    audio: document.getElementById('audioPlayer'),

    // Station Identity (FR-02)
    stationName: document.getElementById('stationName'),
    stationTagline: document.getElementById('stationTagline'),
    stationDesc: document.getElementById('stationDesc'),
    stationFormat: document.getElementById('stationFormat'),
    stationProtocol: document.getElementById('stationProtocol'),
    serverType: document.getElementById('serverType'),
    stationArtwork: document.getElementById('stationArtwork'),
    streamUrlDisplay: document.getElementById('streamUrlDisplay'),
    equalizer: document.getElementById('equalizer'),

    // Playback Controls (FR-03, FR-04, FR-05, FR-06)
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

    // Status & Error Feedback (FR-07, FR-08)
    statusBanner: document.getElementById('statusBanner'),
    statusTitle: document.getElementById('statusTitle'),
    statusMessage: document.getElementById('statusMessage'),
    retryBtn: document.getElementById('retryBtn'),

    // Presets & Testbench (FR-10, TC-01 to TC-07)
    presetButtons: document.querySelectorAll('.preset-btn'),
    customStreamInput: document.getElementById('customStreamInput'),
    applyCustomStreamBtn: document.getElementById('applyCustomStreamBtn'),

    // Diagnostic Console Log
    logConsole: document.getElementById('logConsole'),
    clearLogBtn: document.getElementById('clearLogBtn'),
    toggleLogDetailsBtn: document.getElementById('toggleLogDetailsBtn'),
    logConsoleContainer: document.getElementById('logConsoleContainer'),

    // Icecast Modal Guide (FR-11, FR-12)
    toggleGuideBtn: document.getElementById('toggleGuideBtn'),
    closeGuideBtn: document.getElementById('closeGuideBtn'),
    modalDismissBtn: document.getElementById('modalDismissBtn'),
    guideModal: document.getElementById('guideModal')
  };

  /* ==========================================================================
     3. State Management
     ========================================================================== */
  const state = {
    currentPresetKey: DEFAULT_CONFIG.defaultPresetKey,
    currentUrl: STATION_PRESETS[DEFAULT_CONFIG.defaultPresetKey].url,
    isPlaying: false,
    isLoading: false,
    isMuted: false,
    previousVolume: DEFAULT_CONFIG.initialVolume,
    currentVolume: DEFAULT_CONFIG.initialVolume,
    lastPlayRequestTime: 0
  };

  /* ==========================================================================
     4. Logging & Diagnostics Utility
     ========================================================================== */
  function logMessage(msg, type = 'sys') {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${timeStr}] ${msg}`;
    
    elements.logConsole.appendChild(entry);
    elements.logConsole.scrollTop = elements.logConsole.scrollHeight;

    // Keep console capped at last 100 entries
    if (elements.logConsole.childElementCount > 100) {
      elements.logConsole.removeChild(elements.logConsole.firstChild);
    }
  }

  /* ==========================================================================
     5. UI State Updaters (FR-07, FR-08)
     ========================================================================== */
  /**
   * Sets the visual and textual state of the player.
   * State names match SRS: Ready, Loading, Playing, Paused, Buffering, Error
   */
  function setPlayerState(statusType, titleText, messageText, showRetry = false) {
    // Remove previous state classes
    elements.statusBanner.className = 'status-banner';
    
    // Add new state class
    if (statusType) {
      elements.statusBanner.classList.add(`state-${statusType}`);
    }

    elements.statusTitle.textContent = titleText;
    elements.statusMessage.textContent = messageText;
    elements.retryBtn.style.display = showRetry ? 'inline-flex' : 'none';

    // Update play button visuals
    if (statusType === 'loading' || statusType === 'buffering') {
      elements.playIcon.style.display = 'none';
      elements.pauseIcon.style.display = 'none';
      elements.loadingSpinner.style.display = 'inline-block';
      elements.playPauseBtn.setAttribute('aria-label', 'Loading audio stream...');
      elements.equalizer.classList.remove('active');
    } else if (statusType === 'playing') {
      elements.loadingSpinner.style.display = 'none';
      elements.playIcon.style.display = 'none';
      elements.pauseIcon.style.display = 'inline-block';
      elements.playPauseBtn.setAttribute('aria-label', 'Pause audio stream');
      elements.equalizer.classList.add('active');
    } else {
      // Paused, Ready, Error
      elements.loadingSpinner.style.display = 'none';
      elements.pauseIcon.style.display = 'none';
      elements.playIcon.style.display = 'inline-block';
      elements.playPauseBtn.setAttribute('aria-label', 'Play audio stream');
      elements.equalizer.classList.remove('active');
    }
  }

  /* ==========================================================================
     6. Station Identity Loading (FR-02)
     ========================================================================== */
  function applyStationDetails(stationConfig) {
    elements.stationName.textContent = stationConfig.name;
    elements.stationTagline.textContent = stationConfig.tagline;
    elements.stationDesc.textContent = stationConfig.description;
    elements.stationFormat.textContent = stationConfig.format;
    elements.stationProtocol.textContent = stationConfig.protocol;
    elements.serverType.textContent = stationConfig.serverType;
    elements.streamUrlDisplay.textContent = stationConfig.url;

    state.currentUrl = stationConfig.url;
    elements.audio.src = stationConfig.url;

    logMessage(`Loaded station configuration: "${stationConfig.name}" -> ${stationConfig.url}`, 'sys');
  }

  /* ==========================================================================
     7. Audio Playback Control (FR-03, FR-04, FR-05, FR-08)
     ========================================================================== */
  function startPlayback() {
    state.isLoading = true;
    state.lastPlayRequestTime = Date.now();

    setPlayerState('loading', 'Connecting', 'Requesting audio stream from server...');
    logMessage(`Initiating playback for URL: ${state.currentUrl}`, 'event');

    // Ensure audio src is correctly set
    if (!elements.audio.src || elements.audio.src === '' || elements.audio.src !== state.currentUrl) {
      elements.audio.src = state.currentUrl;
      elements.audio.load();
    }

    // Call HTML5 Audio play() which returns a Promise
    const playPromise = elements.audio.play();

    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          logMessage('play() promise resolved by browser.', 'play');
          // Actual UI update to "playing" is confirmed by the 'playing' media event below
        })
        .catch((error) => {
          state.isLoading = false;
          state.isPlaying = false;
          logMessage(`Playback promise rejected: ${error.name} - ${error.message}`, 'err');

          if (error.name === 'NotAllowedError') {
            setPlayerState(
              'error',
              'Autoplay Blocked',
              'Browser policy required user gesture. Please click Play to begin listening.',
              false
            );
          } else if (error.name === 'AbortError') {
            setPlayerState(
              'paused',
              'Paused',
              'Playback request was cancelled.',
              false
            );
          } else {
            setPlayerState(
              'error',
              'Stream Unavailable',
              'Failed to load stream. Server may be offline, URL invalid, or codec unsupported.',
              true
            );
          }
        });
    }
  }

  function pausePlayback() {
    logMessage('Pausing audio playback.', 'pause');
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
    logMessage('User triggered stream retry.', 'event');
    // Force reload audio endpoint to flush any stale network buffers
    elements.audio.src = state.currentUrl;
    elements.audio.load();
    startPlayback();
  }

  /* ==========================================================================
     8. Volume Control (FR-06)
     ========================================================================== */
  function updateVolume(newVolume, updateSlider = true) {
    const clampedVolume = Math.max(0, Math.min(1, parseFloat(newVolume)));
    elements.audio.volume = clampedVolume;
    state.currentVolume = clampedVolume;

    const percent = Math.round(clampedVolume * 100);
    elements.volumeReadout.textContent = `${percent}%`;
    elements.volumeSlider.setAttribute('aria-valuenow', percent);
    elements.volumeSlider.setAttribute('aria-valuetext', `${percent} percent`);

    if (updateSlider) {
      elements.volumeSlider.value = clampedVolume;
    }

    // Update mute button icon based on volume level
    if (clampedVolume === 0 || state.isMuted) {
      elements.volIconHigh.style.display = 'none';
      elements.volIconMed.style.display = 'none';
      elements.volIconMuted.style.display = 'inline-block';
      elements.muteBtn.setAttribute('aria-label', 'Unmute audio');
    } else if (clampedVolume < 0.5) {
      elements.volIconHigh.style.display = 'none';
      elements.volIconMed.style.display = 'inline-block';
      elements.volIconMuted.style.display = 'none';
      elements.muteBtn.setAttribute('aria-label', 'Mute audio');
    } else {
      elements.volIconHigh.style.display = 'inline-block';
      elements.volIconMed.style.display = 'none';
      elements.volIconMuted.style.display = 'none';
      elements.muteBtn.setAttribute('aria-label', 'Mute audio');
    }
  }

  function toggleMute() {
    if (state.isMuted) {
      // Unmute: restore previous volume
      state.isMuted = false;
      const restoreVol = state.previousVolume > 0 ? state.previousVolume : 0.8;
      updateVolume(restoreVol);
      logMessage(`Audio unmuted. Restored volume to ${Math.round(restoreVol * 100)}%`, 'sys');
    } else {
      // Mute: save current volume and set to 0
      state.previousVolume = state.currentVolume;
      state.isMuted = true;
      updateVolume(0);
      logMessage('Audio muted.', 'sys');
    }
  }

  /* ==========================================================================
     9. HTML5 Audio Event Listeners (FR-07, FR-08)
     ========================================================================== */
  function setupAudioEventListeners() {
    const audio = elements.audio;

    // Load Start
    audio.addEventListener('loadstart', () => {
      logMessage('Audio event: loadstart (stream request initiated)', 'event');
      state.isLoading = true;
      setPlayerState('loading', 'Connecting', 'Connecting to audio stream endpoint...');
    });

    // Can Play
    audio.addEventListener('canplay', () => {
      logMessage('Audio event: canplay (sufficient stream data received)', 'event');
      state.isLoading = false;
    });

    // Playing (Actual stream audible)
    audio.addEventListener('playing', () => {
      state.isPlaying = true;
      state.isLoading = false;
      logMessage('Audio event: playing (live playback active)', 'play');
      setPlayerState(
        'playing',
        'Live Broadcast',
        `Streaming live audio • ${elements.stationFormat.textContent} • High Quality`,
        false
      );
    });

    // Pause
    audio.addEventListener('pause', () => {
      logMessage('Audio event: pause', 'pause');
      state.isPlaying = false;
      state.isLoading = false;
      setPlayerState('paused', 'Paused', 'Stream paused. Click Play or Resume to continue.', false);
    });

    // Buffering / Waiting
    audio.addEventListener('waiting', () => {
      logMessage('Audio event: waiting (buffering stream data)', 'event');
      setPlayerState('buffering', 'Buffering', 'Network buffer refilling; waiting for audio packets...');
    });

    // Stalled
    audio.addEventListener('stalled', () => {
      logMessage('Audio event: stalled (stream data stalled)', 'event');
      if (state.isPlaying) {
        setPlayerState('buffering', 'Buffering', 'Stream data stalled; waiting for connection...');
      }
    });

    // Stream Error (FR-08)
    audio.addEventListener('error', (e) => {
      state.isPlaying = false;
      state.isLoading = false;

      const mediaError = audio.error;
      let errorDetail = 'Unknown playback error.';

      if (mediaError) {
        switch (mediaError.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            errorDetail = 'Stream playback aborted by user or browser.';
            break;
          case MediaError.MEDIA_ERR_NETWORK:
            errorDetail = 'Network error: Failed to download audio stream. Verify server status or internet connection.';
            break;
          case MediaError.MEDIA_ERR_DECODE:
            errorDetail = 'Audio decode error: Stream data is corrupted or encoded in an unsupported codec.';
            break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            errorDetail = 'Stream URL not supported or server returned 404/403. Check stream address or CORS policy.';
            break;
          default:
            errorDetail = `Error code ${mediaError.code}: ${mediaError.message || 'Stream connection failed.'}`;
            break;
        }
      }

      logMessage(`Audio event: error -> ${errorDetail}`, 'err');
      setPlayerState('error', 'Stream Error', errorDetail, true);
    });
  }

  /* ==========================================================================
     10. Preset Switcher & Custom Stream Handling (FR-10)
     ========================================================================== */
  function selectPreset(presetKey) {
    if (!STATION_PRESETS[presetKey]) return;

    // Update active button state
    elements.presetButtons.forEach((btn) => {
      if (btn.getAttribute('data-preset') === presetKey) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    state.currentPresetKey = presetKey;
    const config = STATION_PRESETS[presetKey];

    // Stop current audio if playing
    if (state.isPlaying || state.isLoading) {
      elements.audio.pause();
    }

    applyStationDetails(config);

    // If switching to test presets, trigger playback immediately to demonstrate error handling
    if (presetKey === 'test-invalid' || presetKey === 'test-offline') {
      startPlayback();
    } else {
      setPlayerState('ready', 'Ready', `Ready to stream "${config.name}". Click Play to start.`, false);
    }
  }

  function applyCustomStream() {
    const rawUrl = elements.customStreamInput.value.trim();

    if (!rawUrl) {
      alert('Please enter a valid HTTP/HTTPS stream URL.');
      elements.customStreamInput.focus();
      return;
    }

    // Unselect preset buttons
    elements.presetButtons.forEach((btn) => btn.classList.remove('active'));

    const customConfig = {
      name: 'Custom Stream Mount',
      tagline: 'User-Configured Audio Endpoint',
      description: 'Custom external stream or self-hosted Icecast server endpoint.',
      format: 'Audio Stream',
      protocol: rawUrl.startsWith('https') ? 'HTTPS Stream' : 'HTTP Stream',
      serverType: 'Custom / Icecast',
      url: rawUrl,
      artwork: 'assets/station-artwork.svg'
    };

    if (state.isPlaying || state.isLoading) {
      elements.audio.pause();
    }

    applyStationDetails(customConfig);
    setPlayerState('ready', 'Ready', 'Custom stream configured. Press Play to start listening.', false);
    startPlayback();
  }

  /* ==========================================================================
     11. Keyboard Accessibility (TC-09, NFR-06)
     ========================================================================== */
  function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Ignore shortcut keys when typing inside an input field
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (activeTag === 'input' || activeTag === 'textarea') {
        return;
      }

      // Spacebar or 'K' -> Play/Pause
      if (e.code === 'Space' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        togglePlayPause();
      }

      // 'M' -> Mute / Unmute
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
      }

      // Arrow Up -> Volume +5%
      if (e.code === 'ArrowUp') {
        e.preventDefault();
        const nextVol = Math.min(1, state.currentVolume + 0.05);
        state.isMuted = false;
        updateVolume(nextVol);
      }

      // Arrow Down -> Volume -5%
      if (e.code === 'ArrowDown') {
        e.preventDefault();
        const nextVol = Math.max(0, state.currentVolume - 0.05);
        state.isMuted = false;
        updateVolume(nextVol);
      }

      // Escape -> Close guide modal
      if (e.code === 'Escape' && elements.guideModal.style.display !== 'none') {
        closeGuideModal();
      }
    });
  }

  /* ==========================================================================
     12. Modal Guide Controller
     ========================================================================== */
  function openGuideModal() {
    elements.guideModal.style.display = 'flex';
    elements.toggleGuideBtn.setAttribute('aria-expanded', 'true');
    elements.closeGuideBtn.focus();
  }

  function closeGuideModal() {
    elements.guideModal.style.display = 'none';
    elements.toggleGuideBtn.setAttribute('aria-expanded', 'false');
    elements.toggleGuideBtn.focus();
  }

  /* ==========================================================================
     13. Diagnostics Console Controller
     ========================================================================== */
  function setupDiagnosticsConsole() {
    elements.clearLogBtn.addEventListener('click', () => {
      elements.logConsole.innerHTML = '';
      logMessage('Diagnostics log cleared by user.', 'sys');
    });

    let isCollapsed = false;
    elements.toggleLogDetailsBtn.addEventListener('click', () => {
      isCollapsed = !isCollapsed;
      if (isCollapsed) {
        elements.logConsoleContainer.style.maxHeight = '0px';
        elements.toggleLogDetailsBtn.textContent = 'Expand';
        elements.toggleLogDetailsBtn.setAttribute('aria-expanded', 'false');
      } else {
        elements.logConsoleContainer.style.maxHeight = '250px';
        elements.toggleLogDetailsBtn.textContent = 'Collapse';
        elements.toggleLogDetailsBtn.setAttribute('aria-expanded', 'true');
      }
    });
  }

  /* ==========================================================================
     14. Initialization (FR-01)
     ========================================================================== */
  function init() {
    logMessage('PulseCast Internet Radio Streaming System initializing...', 'sys');

    // Setup Audio events
    setupAudioEventListeners();

    // Setup Keyboard shortcuts
    setupKeyboardShortcuts();

    // Setup Diagnostics
    setupDiagnosticsConsole();

    // Volume initialization
    updateVolume(DEFAULT_CONFIG.initialVolume);

    // Initial station preset
    const defaultPreset = STATION_PRESETS[DEFAULT_CONFIG.defaultPresetKey];
    applyStationDetails(defaultPreset);
    setPlayerState('ready', 'Ready', `Ready to stream "${defaultPreset.name}". Click Play to listen live.`, false);

    // Attach Event Listeners to UI Elements
    elements.playPauseBtn.addEventListener('click', togglePlayPause);
    elements.retryBtn.addEventListener('click', retryPlayback);
    elements.muteBtn.addEventListener('click', toggleMute);

    elements.volumeSlider.addEventListener('input', (e) => {
      state.isMuted = false;
      updateVolume(e.target.value, false);
    });

    // Preset Buttons
    elements.presetButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-preset');
        selectPreset(key);
      });
    });

    // Custom Stream Apply
    elements.applyCustomStreamBtn.addEventListener('click', applyCustomStream);
    elements.customStreamInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        applyCustomStream();
      }
    });

    // Modal Guide triggers
    elements.toggleGuideBtn.addEventListener('click', openGuideModal);
    elements.closeGuideBtn.addEventListener('click', closeGuideModal);
    elements.modalDismissBtn.addEventListener('click', closeGuideModal);

    elements.guideModal.addEventListener('click', (e) => {
      if (e.target === elements.guideModal) {
        closeGuideModal();
      }
    });

    logMessage('PulseCast Radio initialized successfully. FR-01 verified.', 'sys');
  }

  // Run on DOM Content Loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

