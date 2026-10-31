-- ============================================================================
-- PulseCast Internet Radio Streaming System
-- Song Library & Storage Migration (backend/sql/song_library_migration.sql)
-- Target: Supabase PostgreSQL (Postgres 15+)
--
-- Features:
-- 1. Permanent Song Library (public.songs) with Supabase Storage object paths
-- 2. Schedule-to-Song Playlist Association (public.schedule_tracks)
-- 3. Row Level Security & Access Control policies
-- ============================================================================

-- Ensure public schema exists
CREATE SCHEMA IF NOT EXISTS public;

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Table: public.songs
-- Permanent audio metadata catalogue referencing Supabase Storage objects
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.songs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  artist VARCHAR(255),
  album VARCHAR(255),
  duration_seconds INTEGER,
  duration VARCHAR(20) DEFAULT '00:00',
  mime_type VARCHAR(100) NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  file_hash VARCHAR(64),
  storage_bucket VARCHAR(100) NOT NULL DEFAULT 'pulsecast-music-library',
  storage_path VARCHAR(500) NOT NULL,
  original_filename VARCHAR(255),
  created_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_songs_storage_path UNIQUE (storage_path)
);

-- Search and performance indexes
CREATE INDEX IF NOT EXISTS idx_songs_title ON public.songs (LOWER(title));
CREATE INDEX IF NOT EXISTS idx_songs_artist ON public.songs (LOWER(artist));
CREATE INDEX IF NOT EXISTS idx_songs_album ON public.songs (LOWER(album));
CREATE INDEX IF NOT EXISTS idx_songs_active ON public.songs (is_active);
CREATE INDEX IF NOT EXISTS idx_songs_file_hash ON public.songs (file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_songs_normalized_filename ON public.songs (LOWER(TRIM(original_filename)));
CREATE INDEX IF NOT EXISTS idx_songs_created_at ON public.songs (created_at DESC);

-- Trigger function for auto-updating updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-updating updated_at on public.songs
DROP TRIGGER IF EXISTS trigger_songs_updated_at ON public.songs;
CREATE TRIGGER trigger_songs_updated_at
  BEFORE UPDATE ON public.songs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 2. Table: public.schedule_tracks
-- Connects program schedules to assigned songs in playlist playback order
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schedule_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id BIGINT NOT NULL REFERENCES public.program_schedules(id) ON DELETE CASCADE,
  song_id UUID REFERENCES public.songs(id) ON DELETE SET NULL,
  track_id BIGINT,
  source VARCHAR(50) DEFAULT 'general',
  title VARCHAR(200) NOT NULL,
  artist VARCHAR(200),
  album VARCHAR(200),
  duration VARCHAR(20) DEFAULT '03:45',
  duration_seconds INT DEFAULT 225,
  stream_url VARCHAR(500),
  play_order INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add columns if table already existed prior to migration
ALTER TABLE public.schedule_tracks
  ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS track_id BIGINT;

-- Ordering and lookup indexes
CREATE INDEX IF NOT EXISTS idx_schedule_tracks_schedule ON public.schedule_tracks (schedule_id, play_order);
CREATE INDEX IF NOT EXISTS idx_schedule_tracks_song ON public.schedule_tracks (song_id);
CREATE INDEX IF NOT EXISTS idx_schedule_tracks_source ON public.schedule_tracks (source);
CREATE INDEX IF NOT EXISTS idx_schedule_tracks_track_id ON public.schedule_tracks (track_id);

-- ----------------------------------------------------------------------------
-- 3. Row Level Security (RLS) Configuration
-- Strictly prevents anonymous and authenticated clients from directly querying
-- or modifying the Song Library or schedule track assignments.
-- Only the backend service_role key can access and manipulate these tables.
-- ----------------------------------------------------------------------------
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_tracks ENABLE ROW LEVEL SECURITY;

-- Drop any previous public or authenticated SELECT policies
DROP POLICY IF EXISTS "Public can view active songs" ON public.songs;
DROP POLICY IF EXISTS "Public can view schedule tracks" ON public.schedule_tracks;

-- NO SELECT, INSERT, UPDATE, or DELETE policies for anon or authenticated clients.
-- Direct queries via Supabase client without service-role will return empty / denied.

-- ----------------------------------------------------------------------------
-- 4. PostgreSQL Privileges & Access Controls
-- Revoke all table privileges from PUBLIC, anon, and authenticated.
-- Grant full administrative privileges strictly to service_role.
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Revoke all permissions on both tables from PUBLIC, anon, and authenticated
REVOKE ALL ON TABLE public.songs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.schedule_tracks FROM PUBLIC, anon, authenticated;

-- Service role retains full administrative access for Node.js backend
GRANT ALL ON TABLE public.songs TO service_role;
GRANT ALL ON TABLE public.schedule_tracks TO service_role;

