const express = require('express');
const router = express.Router();
const { authenticateUser, requireAdmin } = require('../middleware/auth');
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
// 3. Audio Catalogue / Track Search for Calendar Song Assignment
// ----------------------------------------------------------------------------
router.get('/songs/search', adminSearchSongs);

// ----------------------------------------------------------------------------
// 4. Admin Track / Upcoming Song Queue Management
// ----------------------------------------------------------------------------
router.post('/stations/:id/tracks', adminAddTrack);
router.patch('/tracks/:id/status', adminUpdateTrackStatus);
router.delete('/tracks/:id', adminDeleteTrack);

module.exports = router;
