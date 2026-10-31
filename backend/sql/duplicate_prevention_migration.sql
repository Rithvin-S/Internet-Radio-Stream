-- ============================================================================
-- PulseCast Internet Radio Streaming System
-- Duplicate Song Upload Prevention Migration
-- File: backend/sql/duplicate_prevention_migration.sql
-- Target: Supabase PostgreSQL (Postgres 15+)
-- ============================================================================

-- 1. Add file_hash column (SHA-256 64-character hexadecimal digest)
ALTER TABLE public.songs
  ADD COLUMN IF NOT EXISTS file_hash VARCHAR(64);

-- 2. Performance index on file_hash for fast content duplicate lookups
CREATE INDEX IF NOT EXISTS idx_songs_file_hash
  ON public.songs (file_hash)
  WHERE file_hash IS NOT NULL;

-- 3. Functional index on normalized filename for rapid case-insensitive lookups
CREATE INDEX IF NOT EXISTS idx_songs_normalized_filename
  ON public.songs (LOWER(TRIM(original_filename)));

-- ----------------------------------------------------------------------------
-- 4. Backfill Existing Songs with Computed Cryptographic SHA-256 Hashes
-- ----------------------------------------------------------------------------
-- Martin Garrix & Bebe Rexha - In The Name Of Love (Lyrics) (3 copies)
UPDATE public.songs
  SET file_hash = '5ffb16cb0285a508d4a5e80fc0c88e10f328b3f28a9a4c77178790b87767126c'
  WHERE id IN (
    '1a3825f2-1b65-4615-9f03-c42722d73551',
    'fcc125ce-48a7-4b4b-8e88-dea1f7163b93',
    '757758c5-3e4d-4d38-b647-978fe7b124c8'
  );

-- Zara Larsson - Lush Life (Lyrics) (2 copies)
UPDATE public.songs
  SET file_hash = '9678589c145ddcb07eeabd03a4b7517fe0fe7481413eb5793abfe3b2c3747f10'
  WHERE id IN (
    '416f5948-3b51-405c-a16b-d01594d11840',
    'a8abd023-8175-4459-8470-647279902798'
  );

-- Temper City - Self Aware (Lyrics)
UPDATE public.songs
  SET file_hash = 'b29ee2e9abfbd38a962d9a2a0838a4dbe34db6f62649fd714406390b9633d209'
  WHERE id = '0528db8a-f0c4-42d7-8915-223d7f839c93';

-- The Living Tombstone - My Ordinary Life (Lyrics)
UPDATE public.songs
  SET file_hash = '210fb64a586c236f747409743aa01b9a350eb610e6878ee5f55c88146a42c855'
  WHERE id = '670b66e7-3bf6-4d55-b8ac-a65bc09d6160';

-- ----------------------------------------------------------------------------
-- 5. Note on PostgreSQL Uniqueness Constraints & Safe Migration Strategy
-- ----------------------------------------------------------------------------
-- Because existing records contain 3 duplicate uploads (Martin Garrix & Zara Larsson),
-- adding an unconditional UNIQUE(file_hash) constraint will fail until those
-- 3 redundant records are cleaned up or deduplicated.
--
-- The application code strictly checks for duplicates BEFORE uploading or inserting,
-- guaranteeing that NO NEW duplicate hashes or filenames can ever be created.
--
-- Once the administrator approves removing the redundant duplicate copies,
-- execute the following command to enforce hard database-level uniqueness:
--
-- ALTER TABLE public.songs
--   ADD CONSTRAINT uq_songs_file_hash UNIQUE (file_hash);

