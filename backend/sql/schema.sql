-- ============================================================================
-- Full-Stack Internet Radio Streaming System
-- Database Schema (backend/sql/schema.sql)
-- MySQL 8.0+ Compatible - SRS v2.0 Compliant
-- ============================================================================

CREATE DATABASE IF NOT EXISTS internet_radio
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE internet_radio;

-- ----------------------------------------------------------------------------
-- Table: users
-- Roles: 'listener', 'admin'
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(191) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('listener', 'admin') NOT NULL DEFAULT 'listener',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_email (email),
  INDEX idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Table: stations
-- Radio station catalogue with stream endpoints and active state
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  genre VARCHAR(80),
  stream_url VARCHAR(500) NOT NULL,
  artwork_url VARCHAR(500),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_stations_active (is_active),
  INDEX idx_stations_genre (genre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Table: upcoming_tracks
-- Stores songs, audio segments or stream details to be played next
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS upcoming_tracks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  station_id INT NOT NULL,
  title VARCHAR(200) NOT NULL,
  artist VARCHAR(200) NOT NULL,
  album VARCHAR(200),
  duration VARCHAR(20) DEFAULT '03:45',
  stream_url VARCHAR(500),
  play_order INT NOT NULL DEFAULT 1,
  status ENUM('playing', 'queued', 'played') NOT NULL DEFAULT 'queued',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE,
  INDEX idx_tracks_station (station_id, play_order),
  INDEX idx_tracks_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Table: program_schedules
-- Station program schedules with start and end times
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS program_schedules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  station_id INT NOT NULL,
  title VARCHAR(150) NOT NULL,
  description TEXT,
  start_time VARCHAR(10) NOT NULL, -- Format: "HH:MM" (e.g. "09:00")
  end_time VARCHAR(10) NOT NULL,   -- Format: "HH:MM" (e.g. "12:00")
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE,
  INDEX idx_schedules_station_time (station_id, start_time),
  INDEX idx_schedules_published (is_published)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Table: favourites
-- Composite join table between users and stations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS favourites (
  user_id INT NOT NULL,
  station_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, station_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE,
  INDEX idx_favourites_user (user_id),
  INDEX idx_favourites_station (station_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
