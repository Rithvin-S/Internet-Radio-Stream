const express = require('express');
const router = express.Router();
const { authenticateUser, requireAdmin } = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
  adminCreateStation,
  adminUpdateStation,
  adminToggleStationStatus,
  adminDeleteStation
} = require('../controllers/stationController');
const {
  getAdminSchedules,
  getScheduleById,
  adminCreateSchedule,
  adminUpdateSchedule,
  adminDeleteSchedule,
  adminDuplicateSchedule,
  adminToggleSchedulePublish,
  adminSearchSongs
} = require('../controllers/scheduleController');
const {
  adminAddTrack,
  adminUpdateTrackStatus,
  adminDeleteTrack
} = require('../controllers/trackController');
const {
  listSongs,
  getSong,
  getStats,
  uploadSong,
  uploadBulk,
  updateSong,
  deleteSong,
  getSignedUrl,
  getScheduleTracks,
  updateScheduleTracks,
  removeScheduleTrack
} = require('../controllers/songController');

// All Admin routes require authentication AND admin role (FR-13, T-07)
router.use(authenticateUser, requireAdmin);

// ----------------------------------------------------------------------------
// 1. Admin Station CRUD (FR-11)
// ----------------------------------------------------------------------------
router.post('/stations', adminCreateStation);
router.put('/stations/:id', adminUpdateStation);
router.patch('/stations/:id/status', adminToggleStationStatus);
router.delete('/stations/:id', adminDeleteStation);

// ----------------------------------------------------------------------------
// 2. Google Calendar-Style Admin Schedule Management (Section 7)
// ----------------------------------------------------------------------------
router.get('/schedules', getAdminSchedules);
router.get('/schedules/:id', getScheduleById);
router.post('/schedules', adminCreateSchedule);
router.post('/stations/:id/schedules', adminCreateSchedule); // Legacy & station-scoped route
router.put('/schedules/:id', adminUpdateSchedule);
router.patch('/schedules/:id', adminUpdateSchedule);
router.delete('/schedules/:id', adminDeleteSchedule);
router.post('/schedules/:id/duplicate', adminDuplicateSchedule);
router.patch('/schedules/:id/publish', adminToggleSchedulePublish);

// ----------------------------------------------------------------------------
// 3. Permanent Song Library & Audio Catalogue (Supabase Storage)
// ----------------------------------------------------------------------------
router.get('/songs/search', adminSearchSongs);
router.get('/songs/stats', getStats);
router.get('/songs', listSongs);
router.post('/songs', upload.single('file'), uploadSong);
router.post('/songs/bulk', upload.array('files', 20), uploadBulk);
router.get('/songs/:id', getSong);
router.patch('/songs/:id', updateSong);
router.delete('/songs/:id', deleteSong);
router.post('/songs/:id/signed-url', getSignedUrl);
router.get('/songs/:id/signed-url', getSignedUrl);

// ----------------------------------------------------------------------------
// 4. Schedule Playlist Management (Song Library Integration)
// ----------------------------------------------------------------------------
router.get('/schedules/:id/tracks', getScheduleTracks);
router.post('/schedules/:id/tracks', updateScheduleTracks);
router.put('/schedules/:id/tracks', updateScheduleTracks);
router.delete('/schedules/:id/tracks/:trackId', removeScheduleTrack);

// ----------------------------------------------------------------------------
// 5. Admin Track / Upcoming Song Queue Management
// ----------------------------------------------------------------------------
router.post('/stations/:id/tracks', adminAddTrack);
router.patch('/tracks/:id/status', adminUpdateTrackStatus);
router.delete('/tracks/:id', adminDeleteTrack);

module.exports = router;
