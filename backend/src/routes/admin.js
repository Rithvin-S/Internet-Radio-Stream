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
  adminCreateSchedule,
  adminUpdateSchedule,
  adminDeleteSchedule
} = require('../controllers/scheduleController');
const {
  adminAddTrack,
  adminUpdateTrackStatus,
  adminDeleteTrack
} = require('../controllers/trackController');

// All Admin routes require authentication AND admin role (FR-13, T-07)
router.use(authenticateUser, requireAdmin);

// Admin Station CRUD (FR-11)
router.post('/stations', adminCreateStation);
router.put('/stations/:id', adminUpdateStation);
router.patch('/stations/:id/status', adminToggleStationStatus);
router.delete('/stations/:id', adminDeleteStation);

// Admin Schedule CRUD (FR-12)
router.post('/stations/:id/schedules', adminCreateSchedule);
router.put('/schedules/:id', adminUpdateSchedule);
router.delete('/schedules/:id', adminDeleteSchedule);

// Admin Track / Upcoming Song Queue Management
router.post('/stations/:id/tracks', adminAddTrack);
router.patch('/tracks/:id/status', adminUpdateTrackStatus);
router.delete('/tracks/:id', adminDeleteTrack);

module.exports = router;
