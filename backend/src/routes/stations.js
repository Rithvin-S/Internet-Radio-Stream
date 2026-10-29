const express = require('express');
const router = express.Router();
const { getStations, getStationById } = require('../controllers/stationController');
const { getSchedulesByStation } = require('../controllers/scheduleController');
const { getStationTracks } = require('../controllers/trackController');
const { optionalAuth } = require('../middleware/auth');

// Public Station Routes (FR-01, FR-02, FR-10)
router.get('/', optionalAuth, getStations);
router.get('/:id', optionalAuth, getStationById);
router.get('/:id/schedules', optionalAuth, getSchedulesByStation);
router.get('/:id/tracks', optionalAuth, getStationTracks);

module.exports = router;
