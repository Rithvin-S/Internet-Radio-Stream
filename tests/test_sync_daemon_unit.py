#!/usr/bin/env python3
"""
PulseCast Sync Daemon Unit Verification Suite
(tests/test_sync_daemon_unit.py)

Tests daemon logic in isolation:
1. Safe failure when RADIO_STREAMING_KEY is missing.
2. Clean initialization when RADIO_STREAMING_KEY is provided.
3. Server-to-server authentication headers (x-radio-token).
4. Strict Supabase-only source filter (General Library tracks rejected).
5. Ephemeral signed URL handling & logging sanitization.
6. Audio format validation (ID3 / MPEG frame sync).
7. Abandoned temporary download (.tmp_*) cleanup.
8. Two-phase cursor progression (advance=False on poll, advance=True after push).
9. Cache LRU limit pruning.
"""

import os
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

# Add radio directory to path
radio_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "radio"))
sys.path.insert(0, radio_dir)

from pulsecast_sync_daemon import (
    PulseCastSyncDaemon,
    AudioValidator,
    sanitize_url
)


class TestPulseCastSyncDaemon(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.valid_config = {
            "BACKEND_STREAMING_URL": "http://localhost:5000/api/streaming/stations",
            "RADIO_STREAMING_KEY": "valid_secure_streaming_key_12345",
            "RADIO_STATION_ID": 7,
            "CACHE_DIR": self.temp_dir.name,
            "CONTAINER_CACHE_DIR": "/cache",
            "CACHE_MAX_MB": 10,
            "LIQUIDSOAP_HOST": "127.0.0.1",
            "LIQUIDSOAP_PORT": 1234,
            "POLL_INTERVAL_SECONDS": 5,
            "PRE_BUFFER_SECONDS": 25,
            "MAX_RETRY_BACKOFF": 30,
            "QUEUE_NAME": "supabase_queue"
        }

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_missing_streaming_key_fails_safely(self):
        """Requirement 3: Daemon must fail safely if RADIO_STREAMING_KEY is missing or blank."""
        # None key
        cfg_none = self.valid_config.copy()
        cfg_none["RADIO_STREAMING_KEY"] = None
        with self.assertRaises(ValueError) as ctx:
            PulseCastSyncDaemon(cfg_none)
        self.assertIn("RADIO_STREAMING_KEY environment variable is required", str(ctx.exception))

        # Empty string key
        cfg_empty = self.valid_config.copy()
        cfg_empty["RADIO_STREAMING_KEY"] = "   "
        with self.assertRaises(ValueError) as ctx:
            PulseCastSyncDaemon(cfg_empty)
        self.assertIn("RADIO_STREAMING_KEY environment variable is required", str(ctx.exception))

    def test_valid_streaming_key_initializes(self):
        """Requirement 1 & 4: Daemon initializes when key is provided."""
        daemon = PulseCastSyncDaemon(self.valid_config)
        self.assertEqual(daemon.streaming_key, "valid_secure_streaming_key_12345")
        self.assertEqual(daemon.station_id, 7)

    def test_auth_header_x_radio_token(self):
        """Requirement 4: Daemon must authenticate using x-radio-token header."""
        daemon = PulseCastSyncDaemon(self.valid_config)
        with patch("urllib.request.urlopen") as mock_urlopen:
            mock_resp = MagicMock()
            mock_resp.read.return_value = b'{"success": true, "has_schedule": false}'
            mock_urlopen.return_value.__enter__.return_value = mock_resp

            daemon.fetch_next_track_metadata(advance=False)
            
            # Verify the request header passed to urlopen
            args, kwargs = mock_urlopen.call_args
            req = args[0]
            self.assertEqual(req.headers.get("X-radio-token"), "valid_secure_streaming_key_12345")
            self.assertFalse("radio_token" in req.full_url)  # No token in query params

    def test_strictly_supabase_only_source_enforcement(self):
        """Requirement 5: Ensure only tracks with source == 'supabase' are processed."""
        daemon = PulseCastSyncDaemon(self.valid_config)
        daemon.liquidsoap = MagicMock()
        daemon.liquidsoap.get_remaining_seconds.return_value = -1.0
        daemon.liquidsoap.get_queue_contents.return_value = []

        # Case 1: General Library track (source == 'general')
        general_metadata = {
            "success": True,
            "has_schedule": True,
            "fallback": False,
            "schedule_id": 10,
            "track_id": 9991,
            "source": "general",
            "audio_url": "https://cdn.example.com/song.mp3",
            "is_signed_url": False
        }

        with patch.object(daemon, "fetch_next_track_metadata") as mock_fetch:
            mock_fetch.side_effect = [general_metadata, None]
            result = daemon.process_playback_cycle()
            # Must reject track
            self.assertFalse(result)
            # Must advance past non-Supabase track so station does not hang
            mock_fetch.assert_any_call(advance=True, sim_time=None)
            # Liquidsoap queue push must NEVER be called
            daemon.liquidsoap.push_track.assert_not_called()

    def test_signed_url_sanitization(self):
        """Requirement 6: Signed URLs must be sanitized in logs (never log tokens)."""
        raw_signed_url = "https://fzusdbnznnhksvxvylzg.supabase.co/storage/v1/object/sign/pulsecast-music-library/library/test.mp3?token=secret_token_abc_123"
        sanitized = sanitize_url(raw_signed_url)
        self.assertNotIn("secret_token_abc_123", sanitized)
        self.assertIn("token=[REDACTED]", sanitized)

    def test_audio_validator(self):
        """Requirement 9: Validates MP3 integrity (ID3 and MPEG frame sync)."""
        # Valid ID3 MP3 file
        valid_id3 = os.path.join(self.temp_dir.name, "valid.mp3")
        with open(valid_id3, "wb") as f:
            f.write(b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\xFF\xFB\x90\x00" * 2000)
        self.assertTrue(AudioValidator.validate_mp3_header(valid_id3))

        # Valid MPEG frame sync without ID3
        valid_sync = os.path.join(self.temp_dir.name, "valid_sync.mp3")
        with open(valid_sync, "wb") as f:
            f.write(b"\xFF\xFB\x90\x00" * 2000)
        self.assertTrue(AudioValidator.validate_mp3_header(valid_sync))

        # Corrupted / Too short
        corrupt = os.path.join(self.temp_dir.name, "corrupt.mp3")
        with open(corrupt, "wb") as f:
            f.write(b"NOT_AUDIO_DATA")
        self.assertFalse(AudioValidator.validate_mp3_header(corrupt))

    def test_abandoned_tmp_file_cleanup(self):
        """Requirement 9: Leftover .tmp_* files from crashes are purged on startup."""
        stale_tmp = os.path.join(self.temp_dir.name, ".tmp_track_123_1710000000.mp3")
        valid_cached = os.path.join(self.temp_dir.name, "track_456.mp3")
        with open(stale_tmp, "wb") as f:
            f.write(b"incomplete")
        with open(valid_cached, "wb") as f:
            f.write(b"valid_data")

        daemon = PulseCastSyncDaemon(self.valid_config)
        self.assertFalse(os.path.exists(stale_tmp), "Stale .tmp_* file must be deleted")
        self.assertTrue(os.path.exists(valid_cached), "Valid cached MP3 must be retained")

    def test_lru_cache_pruning(self):
        """Requirement 9: Cache pruning bounds disk usage below CACHE_MAX_MB."""
        daemon = PulseCastSyncDaemon(self.valid_config)
        # Create an old unreferenced file
        old_file = os.path.join(self.temp_dir.name, "old_played.mp3")
        with open(old_file, "wb") as f:
            f.write(b"0" * (12 * 1024 * 1024))  # 12 MB (exceeds CACHE_MAX_MB = 10 MB)

        daemon.prune_cache()
        self.assertFalse(os.path.exists(old_file), "Exceeding cache file must be pruned")


if __name__ == "__main__":
    unittest.main()

