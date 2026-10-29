/**
 * Full-Stack Internet Radio Streaming System
 * Database Connector & Connection Pool (src/config/db.js)
 * Supports MySQL 8.0+ as Primary (mysql2/promise) with automatic initialization.
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

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'internet_radio',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

/**
 * Initialize MySQL connection pool and auto-apply schema if needed
 */
async function tryConnectMySQL() {
  try {
    // 1. First connect without database to ensure database exists
    const adminConnection = await mysql.createConnection({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password
    });

    await adminConnection.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
    await adminConnection.end();

    // 2. Create the main connection pool
    mysqlPool = mysql.createPool(dbConfig);
    const connection = await mysqlPool.getConnection();
    connection.release();

    currentDbType = 'mysql';
    console.log(`[DB] Connected successfully to MySQL (${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database})`);

    // 3. Apply schema & seed if tables don't exist
    await applyMySQLSchema();
    return true;
  } catch (err) {
    console.warn(`[DB] Notice: MySQL connection could not be established (${err.message}).`);
    return false;
  }
}

/**
 * Apply MySQL schema and initial seed data if tables are empty
 */
async function applyMySQLSchema() {
  try {
    // Read schema.sql
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
    console.error('[DB] Schema application warning:', schemaErr.message);
  }
}

/**
 * Initialize SQLite fallback if MySQL is not yet configured or offline
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

    // Create SQLite schema
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

    // Check seed in SQLite
    const userCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM users').get().count;
    if (userCount === 0) {
      console.log('[DB] Seeding default stations and accounts into local database...');
      
      const insertUser = sqliteDb.prepare(`
        INSERT OR IGNORE INTO users (id, name, email, password_hash, role)
        VALUES (?, ?, ?, ?, ?)
      `);
      insertUser.run(1, 'Station Administrator', 'admin@pulsecast.com', '$2a$10$UdPmQuU.nuFRsrWeDszGW.mhlGmFAuPIXwcP//96oLPFmhFU4MXZK', 'admin');
      insertUser.run(2, 'Alex Rivera', 'listener@pulsecast.com', '$2a$10$XQEqmAqOwX1yQpm6Oglz.eYuZGG2RZP7OIUxZesATQDFtHGDLgSYi', 'listener');

      const insertStation = sqliteDb.prepare(`
        INSERT OR IGNORE INTO stations (id, name, description, genre, stream_url, artwork_url, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insertStation.run(1, 'Radio Paradise (Main Mix)', 'High-fidelity eclectic rock, indie, world and acoustic streaming live 24/7.', 'Eclectic / Rock', 'https://stream.radioparadise.com/mp3-128', 'assets/station-artwork.svg', 1);
      insertStation.run(2, 'Nightwave Plaza', '24/7 internet radio broadcast dedicated to vaporwave, future funk and ambient electronic soundscapes.', 'Vaporwave / Electronic', 'https://radio.plaza.one/mp3', 'assets/station-artwork.svg', 1);
      insertStation.run(3, 'CJWF FM / Icecast 2.4 Server', 'Live stream broadcast hosted on a standard Icecast 2.4 streaming server mount.', 'Country / Hits', 'https://live.leanstream.co/CJWFFM-MP3', 'assets/station-artwork.svg', 1);
      insertStation.run(4, 'KEXP Seattle Independent', 'Curated independent music broadcast from Seattle, Washington.', 'Alternative / Indie', 'https://kexp.streamguys1.com/kexp128.mp3', 'assets/station-artwork.svg', 1);
      insertStation.run(5, 'SomaFM Groove Salad', 'A nicely chilled plate of ambient/downtempo beats and grooves.', 'Ambient / Downtempo', 'https://ice1.somafm.com/groovesalad-128-mp3', 'assets/station-artwork.svg', 1);

      const insertSchedule = sqliteDb.prepare(`
        INSERT OR IGNORE INTO program_schedules (station_id, title, description, start_time, end_time, is_published)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      insertSchedule.run(1, 'Morning Acoustic Awakening', 'Gentle acoustic melodies, indie folk and morning coffee accompaniment.', '08:00', '11:00', 1);
      insertSchedule.run(1, 'World Horizon Beats', 'Eclectic world rhythms, afrobeat and international jazz explorations.', '12:00', '15:00', 1);
      insertSchedule.run(1, 'Evening Rock Odyssey', 'Progressive rock, indie anthems and late-night album deep cuts.', '18:00', '22:00', 1);
      insertSchedule.run(2, 'Vapor Sunset Neon', 'Chilled vaporwave synthesizers, city pop remixes and VHS aesthetics.', '17:00', '20:00', 1);
      insertSchedule.run(2, 'Midnight Mall Grooves', 'Late-night future funk, ambient tape loops and nostalgic beats.', '22:00', '02:00', 1);
      insertSchedule.run(3, 'Country Road Drive', 'Top country hits, road trip tracks and listener call-ins.', '09:00', '12:00', 1);

      const insertFav = sqliteDb.prepare('INSERT OR IGNORE INTO favourites (user_id, station_id) VALUES (?, ?)');
      insertFav.run(2, 1);
      insertFav.run(2, 2);
    }

    currentDbType = 'sqlite';
    console.log('[DB] Using local SQLite fallback database (data/radio.db). To switch to MySQL, update DB_PASSWORD in .env.');
    return true;
  } catch (err) {
    console.error('[DB] Failed to initialize SQLite fallback:', err.message);
    return false;
  }
}

/**
 * Universal Query Executor - Uses MySQL if connected, otherwise SQLite
 * Uses parameterized queries to prevent SQL injection (SRS NFR-02)
 */
async function query(sql, params = []) {
  if (currentDbType === 'mysql' && mysqlPool) {
    const [rows, fields] = await mysqlPool.execute(sql, params);
    return rows;
  } else if (currentDbType === 'sqlite' && sqliteDb) {
    // Translate common MySQL functions if any
    const normalizedSql = sql.replace(/\bLAST_INSERT_ID\(\)/gi, 'last_insert_rowid()');
    
    // Check if query is a SELECT
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
 */
async function initDB() {
  if (isInitialized) return currentDbType;
  
  const mysqlOk = await tryConnectMySQL();
  if (!mysqlOk) {
    initSQLiteFallback();
  }
  
  isInitialized = true;
  return currentDbType;
}

/**
 * Get DB status for /api/health
 */
function getDBStatus() {
  return {
    type: currentDbType,
    isReady: isInitialized && currentDbType !== 'none',
    host: currentDbType === 'mysql' ? dbConfig.host : 'local_file',
    database: currentDbType === 'mysql' ? dbConfig.database : 'data/radio.db'
  };
}

module.exports = {
  initDB,
  query,
  getDBStatus,
  getPool: () => mysqlPool
};

