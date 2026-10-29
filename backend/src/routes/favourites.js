const express = require('express');
const router = express.Router();
const { listUserFavourites, addFavourite, removeFavourite } = require('../controllers/favouriteController');
const { authenticateUser } = require('../middleware/auth');

// Protected favourite routes (FR-09)
router.use(authenticateUser);

router.get('/', listUserFavourites);
router.post('/:stationId', addFavourite);
router.delete('/:stationId', removeFavourite);

module.exports = router;

