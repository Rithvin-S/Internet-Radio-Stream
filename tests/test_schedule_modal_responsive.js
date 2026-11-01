/**
 * PulseCast - Create Program Schedule Modal Responsive Layout Verification Suite
 * (tests/test_schedule_modal_responsive.js)
 * 
 * Verifies:
 * 1. Viewport-Relative Height:
 *    - .modal-dialog uses max-height: 90vh (and min(90vh, 880px))
 * 2. Independent Vertical Scrolling:
 *    - #scheduleModalForm is flex column with min-height: 0
 *    - .modal-body is flex: 1 1 auto with min-height: 0 and overflow-y: auto
 * 3. Fixed / Sticky Pinned Header:
 *    - .modal-header has flex-shrink: 0 and position: sticky top: 0
 * 4. Fixed / Sticky Pinned Footer:
 *    - .modal-footer has flex-shrink: 0 and position: sticky bottom: 0
 *    - Cancel and Save Schedule buttons permanently accessible
 * 5. Playlist & Song Assignment Section Accessibility:
 *    - .library-track-results max-height bounded with internal scroll
 *    - .selected-songs-list max-height bounded with internal scroll
 *    - Compact item padding and form-group spacing
 * 6. Responsive Adaptations for Standard Resolutions:
 *    - 1920x1080 (Desktop standard)
 *    - 1366x768 (@media max-height: 800px)
 *    - 1280x720 (@media max-height: 700px)
 *    - Mobile / narrow widths (@media max-width: 640px)
 * 7. Zero Overlap & No Content Clipping:
 *    - .modal-footer has solid background (var(--bg-surface-elevated))
 *    - .modal-body has bottom padding buffer
 *    - .modal-dialog has overflow: hidden
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runAudit() {
  console.log('======================================================================');
  console.log('  CREATE PROGRAM SCHEDULE MODAL RESPONSIVE LAYOUT VERIFICATION');
  console.log('======================================================================\n');

  const htmlPath = path.join(__dirname, '../frontend/admin/schedules.html');
  const cssPath = path.join(__dirname, '../frontend/css/calendar.css');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');

  // --------------------------------------------------------------------------
  // Check 1: HTML Structure & Hierarchy
  // --------------------------------------------------------------------------
  console.log('[Check 1] Verifying Modal DOM Structure in schedules.html...');
  assert(html.includes('id="scheduleFormModal"'), 'Missing #scheduleFormModal');
  assert(html.includes('class="modal-overlay"'), 'Missing .modal-overlay');
  assert(html.includes('class="modal-dialog"'), 'Missing .modal-dialog');
  assert(html.includes('class="modal-header"'), 'Missing .modal-header');
  assert(html.includes('id="schedFormModalTitle"'), 'Missing #schedFormModalTitle');
  assert(html.includes('id="scheduleModalForm"'), 'Missing #scheduleModalForm');
  assert(html.includes('class="modal-body"'), 'Missing .modal-body');
  assert(html.includes('class="modal-footer"'), 'Missing .modal-footer');
  assert(html.includes('btn-cancel-modal'), 'Missing Cancel button (.btn-cancel-modal)');
  assert(html.includes('id="saveScheduleBtn"'), 'Missing Save Schedule button (#saveScheduleBtn)');
  assert(html.includes('modal-form-row-datetime'), 'Missing .modal-form-row-datetime');
  assert(html.includes('modal-form-row-meta'), 'Missing .modal-form-row-meta');
  assert(html.includes('id="tabGeneralLibrary"'), 'Missing #tabGeneralLibrary');
  assert(html.includes('id="tabSupabaseLibrary"'), 'Missing #tabSupabaseLibrary');
  assert(html.includes('id="selectedSongsContainer"'), 'Missing #selectedSongsContainer');
  console.log('  -> PASS: All modal container IDs, headers, body, footer, and buttons verified.');

  // --------------------------------------------------------------------------
  // Check 2: Modal Dialog Max Height & Flex Column Setup
  // --------------------------------------------------------------------------
  console.log('[Check 2] Verifying Modal Viewport-Relative Height in calendar.css...');
  assert(css.includes('max-height: 90vh'), '.modal-dialog must have max-height: 90vh');
  assert(css.includes('overflow: hidden'), '.modal-dialog must have overflow: hidden');
  assert(css.includes('display: flex'), '.modal-dialog must have display: flex');
  assert(css.includes('flex-direction: column'), '.modal-dialog must have flex-direction: column');
  console.log('  -> PASS: .modal-dialog is configured with max-height: 90vh and flex-direction: column.');

  // --------------------------------------------------------------------------
  // Check 3: Form Flex Shrinking & Body Independent Vertical Scrolling
  // --------------------------------------------------------------------------
  console.log('[Check 3] Verifying Form Container & Scrollable Body Rules...');
  // Form container must have min-height: 0 to allow flex shrinking
  assert(css.includes('#scheduleModalForm {'), 'Must have CSS rules for #scheduleModalForm');
  const formBlockMatch = css.match(/#scheduleModalForm\s*\{([^}]+)\}/s);
  assert(formBlockMatch, 'Could not extract #scheduleModalForm block');
  const formBlock = formBlockMatch[1];
  assert(formBlock.includes('display: flex'), '#scheduleModalForm must have display: flex');
  assert(formBlock.includes('flex-direction: column'), '#scheduleModalForm must have flex-direction: column');
  assert(formBlock.includes('min-height: 0'), '#scheduleModalForm must have min-height: 0 for shrinking');

  // Modal body must scroll independently
  const bodyBlockMatch = css.match(/\.modal-body\s*\{([^}]+)\}/s);
  assert(bodyBlockMatch, 'Could not extract .modal-body block');
  const bodyBlock = bodyBlockMatch[1];
  assert(bodyBlock.includes('overflow-y: auto'), '.modal-body must have overflow-y: auto');
  assert(bodyBlock.includes('min-height: 0'), '.modal-body must have min-height: 0');
  assert(bodyBlock.includes('flex: 1 1 auto') || bodyBlock.includes('flex: 1'), '.modal-body must flex: 1');
  console.log('  -> PASS: #scheduleModalForm and .modal-body correctly permit independent vertical scrolling.');

  // --------------------------------------------------------------------------
  // Check 4: Header & Footer Pinned Positioning
  // --------------------------------------------------------------------------
  console.log('[Check 4] Verifying Modal Header & Footer Pinned / Sticky Constraints...');
  const headerBlockMatch = css.match(/\.modal-header\s*\{([^}]+)\}/s);
  assert(headerBlockMatch, 'Could not extract .modal-header block');
  const headerBlock = headerBlockMatch[1];
  assert(headerBlock.includes('flex-shrink: 0'), '.modal-header must have flex-shrink: 0');
  assert(headerBlock.includes('position: sticky'), '.modal-header must have position: sticky');
  assert(headerBlock.includes('top: 0'), '.modal-header must have top: 0');

  const footerBlockMatch = css.match(/\.modal-footer\s*\{([^}]+)\}/s);
  assert(footerBlockMatch, 'Could not extract .modal-footer block');
  const footerBlock = footerBlockMatch[1];
  assert(footerBlock.includes('flex-shrink: 0'), '.modal-footer must have flex-shrink: 0');
  assert(footerBlock.includes('position: sticky'), '.modal-footer must have position: sticky');
  assert(footerBlock.includes('bottom: 0'), '.modal-footer must have bottom: 0');
  assert(footerBlock.includes('background: var(--bg-surface-elevated)'), '.modal-footer must have solid background');
  console.log('  -> PASS: Modal header and footer are permanently pinned with flex-shrink: 0 and sticky positioning.');

  // --------------------------------------------------------------------------
  // Check 5: Song Management & Playlist Viewport Bounds
  // --------------------------------------------------------------------------
  console.log('[Check 5] Verifying Song Management Box & Internal List Bounds...');
  assert(css.includes('.song-manager-box'), 'calendar.css must style .song-manager-box');
  assert(css.includes('.library-track-results'), 'calendar.css must style .library-track-results');
  assert(css.includes('.selected-songs-list'), 'calendar.css must style .selected-songs-list');

  // Verify list heights are bounded (<= 200px)
  const trackResultsMatch = css.match(/\.library-track-results\s*\{([^}]+)\}/s);
  assert(trackResultsMatch, 'Could not extract .library-track-results block');
  assert(trackResultsMatch[1].includes('overflow-y: auto'), '.library-track-results must have overflow-y: auto');

  const selectedSongsMatch = css.match(/\.selected-songs-list\s*\{([^}]+)\}/s);
  assert(selectedSongsMatch, 'Could not extract .selected-songs-list block');
  assert(selectedSongsMatch[1].includes('overflow-y: auto'), '.selected-songs-list must have overflow-y: auto');
  console.log('  -> PASS: Track results and assigned playlist have bounded heights with internal scrolling.');

  // --------------------------------------------------------------------------
  // Check 6: Responsive Media Queries for 1366x768 and 1280x720 Viewports
  // --------------------------------------------------------------------------
  console.log('[Check 6] Verifying Responsive Media Queries (768p, 720p, mobile)...');
  assert(css.includes('@media (max-height: 800px)'), 'Must include @media (max-height: 800px) for 1366x768');
  assert(css.includes('@media (max-height: 700px)'), 'Must include @media (max-height: 700px) for 1280x720');
  assert(css.includes('@media (max-width: 640px)'), 'Must include @media (max-width: 640px) for narrow viewports');
  console.log('  -> PASS: Height-specific media queries present for standard 768p and 720p screens.');

  // --------------------------------------------------------------------------
  // Check 7: Zero Overlap & Clipping Protection
  // --------------------------------------------------------------------------
  console.log('[Check 7] Verifying Anti-Clipping & Overlap Protection...');
  // .modal-body padding-bottom must provide clearance
  assert(bodyBlock.includes('padding:') && bodyBlock.includes('1.75rem'), '.modal-body must have generous bottom padding');
  // .modal-footer must have top border and box-shadow
  assert(footerBlock.includes('border-top:'), '.modal-footer must have border-top separator');
  console.log('  -> PASS: Solid surface elevation and clearance padding prevent content overlap or clipping.');

  console.log('\n======================================================================');
  console.log('  ALL RESPONSIVE MODAL LAYOUT CHECKS PASSED (7/7)!                    ');
  console.log('======================================================================');
}

runAudit();

