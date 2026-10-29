/**
 * Full-Stack Internet Radio Streaming System
 * Authentication Controller (src/controllers/authController.js)
 * Implements FR-07, FR-08, T-04, T-05, T-06
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { validateRegisterInput, validateLoginInput } = require('../validators/authValidator');

const JWT_SECRET = process.env.JWT_SECRET || 'pulsecast_dev_secret_key_8492038104810283019283019';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Creates and signs a JWT for a user
 */
function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Sets secure HttpOnly cookie for JWT
 */
function setAuthCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('token', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
}

/**
 * POST /api/auth/register
 * Register a new listener account (FR-07, T-04, T-05)
 */
async function register(req, res, next) {
  try {
    const validation = validateRegisterInput(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: validation.errors
      });
    }

    const name = req.body.name.trim();
    const email = req.body.email.trim().toLowerCase();
    const password = req.body.password;

    // Check duplicate email (T-05)
    const existing = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing && existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists.'
      });
    }

    // Hash password with bcrypt (work factor 10)
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Default role is 'listener'
    const result = await db.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [name, email, passwordHash, 'listener']
    );

    const newUser = {
      id: result.insertId,
      name,
      email,
      role: 'listener',
      created_at: new Date().toISOString()
    };

    // Issue token and cookie
    const token = createToken(newUser);
    setAuthCookie(res, token);

    // Safe response: exclude password_hash (T-04)
    res.status(201).json({
      success: true,
      message: 'Account registered successfully.',
      token,
      user: newUser
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/login
 * Authenticate user with email and password (FR-07, T-06)
 */
async function login(req, res, next) {
  try {
    const validation = validateLoginInput(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed.',
        errors: validation.errors
      });
    }

    const email = req.body.email.trim().toLowerCase();
    const password = req.body.password;

    const users = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (!users || users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }

    const user = users[0];

    // Verify bcrypt password hash
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      created_at: user.created_at
    };

    const token = createToken(safeUser);
    setAuthCookie(res, token);

    res.status(200).json({
      success: true,
      message: 'Signed in successfully.',
      token,
      user: safeUser
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/logout
 * Sign out and clear authentication cookie (FR-08)
 */
async function logout(req, res) {
  res.clearCookie('token');
  res.status(200).json({
    success: true,
    message: 'Signed out successfully.'
  });
}

/**
 * GET /api/auth/me
 * Returns current authenticated user profile
 */
async function getMe(req, res) {
  res.status(200).json({
    success: true,
    user: req.user
  });
}

module.exports = {
  register,
  login,
  logout,
  getMe
};

