/**
 * Full-Stack Internet Radio Streaming System
 * Database Connector & Connection Pool (src/config/db.js)
 * Supports:
 * - Production: Aiven MySQL with SSL enabled (SQLite fallback disabled)
 * - Development/Local: Local MySQL with seamless SQLite fallback
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config();

const mysql = require('mysql2/promise');

let mysqlPool = null;
let sqliteDb = null;
let currentDbType = 'none';
let isInitialized = false;

const isProduction = process.env.NODE_ENV === 'production';

// Configuration for local development
const localDbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'internet_radio',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Configuration for Aiven MySQL (Production)
const aivenDbConfig = {
  host: process.env.AIVEN_DB_HOST || process.env.DB_HOST,
  port: parseInt(process.env.AIVEN_DB_PORT || process.env.DB_PORT || '3306', 10),
  user: process.env.AIVEN_DB_USER || process.env.DB_USER || 'avnadmin',
  password: process.env.AIVEN_DB_PASSWORD || process.env.DB_PASSWORD,
  database: process.env.AIVEN_DB_NAME || process.env.DB_NAME || 'defaultdb',
  ssl: {
    rejectUnauthorized: false // Enables SSL connection required by Aiven
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

/**
 * Connect to Aiven MySQL in production (SSL enabled, direct database connection)
 */
async function connectAivenMySQL() {
  try {
    const config = { ...aivenDbConfig };

    // Support full DATABASE_URL or MYSQL_URL if provided on Render
    const connUri = process.env.AIVEN_DATABASE_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
    if (connUri) {
      mysqlPool = mysql.createPool({
        uri: connUri,
        ssl: { rejectUnauthorized: false },
        waitForConnections: true,
        connectionLimit: 10
      });
    } else {
      mysqlPool = mysql.createPool(config);
    }

    // Verify connection
    const connection = await mysqlPool.getConnection();
    connection.release();

    currentDbType = 'mysql';
    console.log(`[DB] Connected successfully to Aiven MySQL in PRODUCTION (SSL enabled, ${config.user}@${config.host}:${config.port}/${config.database})`);

    // Ensure schema and tables exist in Aiven
    await applyMySQLSchema();
    return true;
  } catch (err) {
    console.error(`[DB] FATAL: Failed to connect to Aiven MySQL in production (${err.message})`);
    return false;
  }
}

/**
 * Initialize Local MySQL connection pool (Development)
 */
async function tryConnectLocalMySQL() {
  try {
    // 1. Ensure local database exists
    const adminConnection = await mysql.createConnection({
      host: localDbConfig.host,
      port: localDbConfig.port,
      user: localDbConfig.user,
      password: localDbConfig.password
    });

    await adminConnection.query(
      `CREATE DATABASE IF NOT EXISTS \`${localDbConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
    await adminConnection.end();

    // 2. Create pool for local MySQL
    mysqlPool = mysql.createPool(localDbConfig);
    const connection = await mysqlPool.getConnection();
    connection.release();

    currentDbType = 'mysql';
    console.log(`[DB] Connected successfully to local MySQL (${localDbConfig.user}@${localDbConfig.host}:${localDbConfig.port}/${localDbConfig.database})`);

    // 3. Apply schema & seed if tables don't exist
    await applyMySQLSchema();
    return true;
  } catch (err) {
    console.warn(`[DB] Notice: Local MySQL connection could not be established (${err.message}).`);
    return false;
  }
}

/**
 * Apply MySQL schema and initial seed data if tables are empty
 */
async function applyMySQLSchema() {
  try {
    const schemaPath = path.join(__dirname, '../../sql/schema.sql');
    if (fs.existsSync(schemaPath)) {
      const sqlContent = fs.readFileSync(schemaPath, 'utf8');
      const statements = sqlContent
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('--') && !s.toLowerCase().startsWith('create database') && !s.toLowerCase().startsWith('use '));

      for (const statement of statements) {
        await mysqlPool.query(statement);
      }
    }

    // Check if stations exist; if not, run seed.sql
    const [rows] = await mysqlPool.query('SELECT COUNT(*) as count FROM stations');
    if (rows[0].count === 0) {
      console.log('[DB] Seeding default stations and admin accounts into MySQL...');
      const seedPath = path.join(__dirname, '../../sql/seed.sql');
      if (fs.existsSync(seedPath)) {
        const seedSql = fs.readFileSync(seedPath, 'utf8');
        const statements = seedSql
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !s.startsWith('--') && !s.toLowerCase().startsWith('use '));

        for (const statement of statements) {
          await mysqlPool.query(statement);
        }
        console.log('[DB] Seed completed successfully in MySQL.');
      }
    }
  } catch (schemaErr) {
    console.error('[DB] Schema application failed:', schemaErr.message);
    if (isProduction) {
      throw schemaErr;
    }
  }
}

/**
 * Initialize SQLite fallback if MySQL is not yet configured or offline (DEVELOPMENT ONLY)
 */
function initSQLiteFallback() {
  try {
    const Database = require('better-sqlite3');
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbFile = path.join(dataDir, 'radio.db');
    sqliteDb = new Database(dbFile);
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('foreign_keys = ON');

    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'listener',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS stations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        genre TEXT,
        stream_url TEXT NOT NULL,
        artwork_url TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS upcoming_tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT,
        duration TEXT DEFAULT '03:45',
        stream_url TEXT,
        play_order INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'queued',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS program_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        is_published INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS favourites (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, station_id)
      );
    `);

    currentDbType = 'sqlite';
    console.log('[DB] Using local SQLite fallback database (data/radio.db). To switch to local MySQL, update DB_PASSWORD in .env.');
    return true;
  } catch (err) {
    console.error('[DB] Failed to initialize SQLite fallback:', err.message);
    return false;
  }
}

/**
 * Universal Query Executor - Uses MySQL if connected, otherwise SQLite
 */
async function query(sql, params = []) {
  if (currentDbType === 'mysql' && mysqlPool) {
    const [rows, fields] = await mysqlPool.execute(sql, params);
    return rows;
  } else if (currentDbType === 'sqlite' && sqliteDb) {
    const normalizedSql = sql.replace(/\bLAST_INSERT_ID\(\)/gi, 'last_insert_rowid()');
    const trimmed = normalizedSql.trim().toUpperCase();
    if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA')) {
      const stmt = sqliteDb.prepare(normalizedSql);
      return stmt.all(params);
    } else {
      const stmt = sqliteDb.prepare(normalizedSql);
      const info = stmt.run(params);
      return {
        insertId: Number(info.lastInsertRowid),
        affectedRows: info.changes
      };
    }
  } else {
    throw new Error('Database is not initialized or unavailable');
  }
}

/**
 * Initialize DB on startup
 * - When NODE_ENV=production: connects to Aiven MySQL with SSL (SQLite fallback disabled)
 * - Otherwise: connects to local MySQL with SQLite fallback
 */
async function initDB() {
  if (isInitialized) return currentDbType;

  if (isProduction) {
    console.log('[DB] Production environment detected (NODE_ENV=production). Initializing Aiven MySQL with SSL...');
    const ok = await connectAivenMySQL();
    if (!ok) {
      // Disable SQLite fallback in production
      throw new Error('[DB] FATAL: Unable to connect to Aiven MySQL in production. SQLite fallback is disabled in production.');
    }
  } else {
    // Local development
    const mysqlOk = await tryConnectLocalMySQL();
    if (!mysqlOk) {
      initSQLiteFallback();
    }
  }

  isInitialized = true;
  return currentDbType;
}

/**
 * Get DB status for /api/health
 */
function getDBStatus() {
  const activeConfig = isProduction ? aivenDbConfig : localDbConfig;
  return {
    type: currentDbType,
    isReady: isInitialized && currentDbType !== 'none',
    mode: isProduction ? 'production (aiven)' : 'development (local)',
    ssl: isProduction,
    host: currentDbType === 'mysql' ? activeConfig.host : 'local_file',
    database: currentDbType === 'mysql' ? activeConfig.database : 'data/radio.db'
  };
}

module.exports = {
  initDB,
  query,
  getDBStatus,
  getPool: () => mysqlPool
};
