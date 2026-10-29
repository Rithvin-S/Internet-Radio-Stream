# Acceptance Test Checklist & Verification Matrix

**Project:** Web-Based Internet Radio Streaming System  
**Specification:** SRS v1.0 & Implementation Plan Baseline  
**Date:** 29 October 2026  
**Status:** All Core Tests Verified (Pass)

---

## Test Execution Matrix (TC-01 through TC-12)

| Test ID | SRS Feature Area | Test Procedure | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TC-01** | Page Load & Access (FR-01) | Open `index.html` in target browser. Check console and UI rendering. | Station identity, branding, player card, and controls render without blocking errors. | Controls and metadata load cleanly; ready status displayed; no JavaScript errors. | **PASS** |
| **TC-02** | Valid Stream Play (FR-03) | Click the central Play button with a valid HTTPS stream (e.g. Radio Paradise). | State changes to "Connecting", audio begins streaming, status becomes "Live Broadcast", equalizer animates. | Audio starts smoothly, state changes to playing, play button switches to pause icon. | **PASS** |
| **TC-03** | Pause & Resume (FR-04, FR-05) | 1. Click Pause during active playback.<br>2. Click Play/Resume to continue. | 1. Audio stops immediately; state changes to "Paused".<br>2. Playback resumes cleanly and state returns to "Live Broadcast". | Audio cleanly pauses and resumes without audio drift or clipping. | **PASS** |
| **TC-04** | Volume Adjustment (FR-06) | 1. Drag volume slider across 0% to 100%.<br>2. Click Mute button.<br>3. Click Unmute button. | Audible volume follows slider; percentage updates in real-time. Muting silences audio; unmuting restores prior level. | Volume scales smoothly from 0.0 to 1.0; mute toggle restores previous level accurately. | **PASS** |
| **TC-05** | Invalid URL Feedback (FR-08) | Select the "Test Invalid URL (TC-05)" preset or input an invalid stream address. | Audio element encounters error; status banner displays clear "Stream Error" feedback; Retry button appears. | Clean error message shown ("Stream URL not supported or server returned 404/403"); page does not crash. | **PASS** |
| **TC-06** | Unavailable Stream (FR-08) | Select "Test Offline Server (TC-06)" preset pointing to an unreachable IP endpoint. | System reports connection timeout or unreachable server; clear user-friendly error message presented with Retry option. | Error handled gracefully; user can switch stations or retry. | **PASS** |
| **TC-07** | Buffering Feedback (FR-07) | Monitor audio events during network throttle or initial connection. | "Connecting" or "Buffering" status displayed; equalizer pauses; Playing status only appears once media actually streams. | Buffering/loading states transition accurately with `waiting` and `canplay` events. | **PASS** |
| **TC-08** | Mobile & Responsive Layout (FR-09, NFR-03) | Test on viewport widths: 360px (mobile), 768px (tablet), 1024px (desktop), 1440px (wide). | Layout adapts dynamically without horizontal scrollbars; tap targets exceed 44x44px; text remains legible. | Fully responsive card and grid layout; touch targets optimized for mobile use. | **PASS** |
| **TC-09** | Keyboard & Accessibility (NFR-06) | Navigate using <kbd>Tab</kbd>, <kbd>Shift + Tab</kbd>, <kbd>Space</kbd>, <kbd>M</kbd>, <kbd>&uarr;</kbd>, <kbd>&darr;</kbd>. | Focus ring is prominently visible; Space/K toggles play; M toggles mute; Arrow keys adjust volume by 5%. | Full keyboard navigation works smoothly; ARIA live regions announce state changes. | **PASS** |
| **TC-10** | Browser Compatibility (NFR-02) | Test on Google Chrome, Microsoft Edge, Mozilla Firefox, and Apple Safari. | Core audio playback, HTML5 Audio events, and UI controls function consistently across engines. | Compatible with Chromium, Gecko, and WebKit browser engines. | **PASS** |
| **TC-11** | HTTPS / Mixed Content (NFR-08) | Serve website over HTTPS and test playback of HTTPS audio streams. | Browser does not block audio; no mixed-content security warnings in browser console. | Direct HTTPS streams play with full security compliance. | **PASS** |
| **TC-12** | Multi-Listener Icecast Check (FR-11, FR-12) | Connect two independent browser client instances to the Icecast server mount. | Both listener clients receive audio concurrently without dropping or causing server resource contention. | Multiple clients can connect simultaneously within configured Icecast listener limits. | **PASS** |

---

## Detailed Acceptance Checklist Items

- [x] **Semantic HTML5 Structure**: Proper semantic markup (`<header>`, `<main>`, `<section>`, `<aside>`, `<footer>`, `<audio>`).
- [x] **No Unnecessary External Dependencies**: 100% vanilla HTML5, CSS3, and modern JavaScript without bloated heavy frameworks.
- [x] **Audio Event Handling**: Complete coverage of `loadstart`, `canplay`, `playing`, `pause`, `waiting`, `stalled`, and `error`.
- [x] **Play Promise Safety**: Handles `audio.play()` Promise rejection (handling browser autoplay policies like `NotAllowedError` and `AbortError`).
- [x] **Volume Control**: Slider range input + numeric percentage readout + mute button toggle with state restoration.
- [x] **State Feedback**: Ready, Connecting/Loading, Playing, Paused, Buffering, and Stream Error clearly presented in text AND visual indicator (never color alone).
- [x] **Retry Action**: Clear Retry button provided when connection fails or times out.
- [x] **Dynamic Station Presets**: Radio Paradise, Nightwave Plaza, CJWF Icecast Live, plus TC-05 and TC-06 test buttons.
- [x] **Custom Stream Input**: Allows inputting any user-defined Icecast mount or HTTP/HTTPS stream URL.
- [x] **Diagnostics Console**: Real-time logging of audio events with timestamps and classification for verification and supervisor evaluation.
- [x] **Accessibility**: WCAG AA contrast, 44px+ touch targets, visible `:focus-visible` outline, `@media (prefers-reduced-motion)` support.
- [x] **Icecast Architecture Documentation**: In-app modal guide with topology diagram, OBS/BUTT setup instructions, and multi-listener procedures.

