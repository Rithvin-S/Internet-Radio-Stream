const express = require('express');
const router = express.Router();
const { register, login, logout, getMe } = require('../controllers/authController');
const { authenticateUser } = require('../middleware/auth');
const rateLimiter = require('../middleware/rateLimiter');

// Auth routes (FR-07, FR-08)
router.post('/register', rateLimiter, register);
router.post('/login', rateLimiter, login);
router.post('/logout', authenticateUser, logout);
router.get('/me', authenticateUser, getMe);

module.exports = router;

