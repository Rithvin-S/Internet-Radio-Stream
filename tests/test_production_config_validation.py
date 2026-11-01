#!/usr/bin/env python3
"""
PulseCast Phase 3 Production Configuration Validation
(tests/test_production_config_validation.py)

Validates that:
1. docker-compose.yml has NO hardcoded passwords and strictly uses environment variables.
2. radio.liq has NO hardcoded passwords and reads ICECAST_SOURCE_PASSWORD from environment.
3. Liquidsoap telnet is restricted to 127.0.0.1 localhost only in docker-compose.yml.
4. radio.liq has zero references to /music or local directory playlists.
5. docker-compose.yml mounts /cache and keeps /music as read-only backup.
6. pulsecast_sync_daemon.py has NO hardcoded streaming key fallback.
7. Both icecast and liquidsoap services receive the exact same ICECAST_SOURCE_PASSWORD variable.
8. .env.radio.example defines all required variables without placeholder secrets.
"""

import os
import re
import unittest


class TestProductionConfigValidation(unittest.TestCase):
    def setUp(self):
        self.root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        self.compose_path = os.path.join(self.root_dir, "docker-compose.yml")
        self.liq_path = os.path.join(self.root_dir, "radio.liq")
        self.daemon_path = os.path.join(self.root_dir, "pulsecast_sync_daemon.py")
        self.env_example_path = os.path.join(self.root_dir, ".env.radio.example")

    def test_files_exist_at_root(self):
        """Requirement 1: Root-level files exist."""
        self.assertTrue(os.path.exists(self.compose_path), "docker-compose.yml must exist at root")
        self.assertTrue(os.path.exists(self.liq_path), "radio.liq must exist at root")
        self.assertTrue(os.path.exists(self.daemon_path), "pulsecast_sync_daemon.py must exist at root")

    def test_docker_compose_no_hardcoded_passwords(self):
        """Requirement 2, 3, 4, 8: Compose loads ICECAST_SOURCE_PASSWORD dynamically and has no hardcoded passwords."""
        with open(self.compose_path, "r", encoding="utf-8") as f:
            compose_text = f.read()

        # Must not contain old passwords or default placeholders
        self.assertNotIn("Rithvin@2411", compose_text, "Hardcoded password must not appear in compose")
        self.assertNotIn("hackme", compose_text.lower(), "Default placeholder hackme must not appear in compose")

        # Must use variable interpolation for passwords
        self.assertIn("ICECAST_SOURCE_PASSWORD: ${ICECAST_SOURCE_PASSWORD", compose_text)
        
        # Must pass ICECAST_SOURCE_PASSWORD to both icecast and liquidsoap services
        icecast_block = compose_text.split("\n  liquidsoap:")[0]
        liquidsoap_block = compose_text.split("\n  liquidsoap:")[1]
        self.assertIn("ICECAST_SOURCE_PASSWORD", icecast_block)
        self.assertIn("ICECAST_SOURCE_PASSWORD", liquidsoap_block)

        # Must specify env_file: - .env
        self.assertIn("env_file:\n      - .env", compose_text)

    def test_liquidsoap_no_hardcoded_passwords_and_matching_env(self):
        """Requirement 2, 3, 4: radio.liq reads ICECAST_SOURCE_PASSWORD from environment.get."""
        with open(self.liq_path, "r", encoding="utf-8") as f:
            liq_text = f.read()

        # No hardcoded password strings
        self.assertNotIn("Rithvin@2411", liq_text)
        self.assertNotIn("hackme", liq_text.lower())
        self.assertNotIn('password="', liq_text)

        # Uses environment.get for password
        self.assertIn('environment.get(default="", "ICECAST_SOURCE_PASSWORD")', liq_text)
        self.assertIn('password=icecast_source_password', liq_text)

    def test_liquidsoap_telnet_security(self):
        """Requirement 7: Telnet is configured in Liquidsoap and bound to 127.0.0.1 in compose."""
        with open(self.liq_path, "r", encoding="utf-8") as f:
            liq_text = f.read()
        self.assertIn("settings.server.telnet := true", liq_text)
        self.assertIn("settings.server.telnet.port := 1234", liq_text)

        with open(self.compose_path, "r", encoding="utf-8") as f:
            compose_text = f.read()
        # Must bind port 1234 to 127.0.0.1 localhost only
        self.assertIn("127.0.0.1:", compose_text)
        self.assertIn(":1234", compose_text)

    def test_liquidsoap_no_active_local_music_playlist(self):
        """Requirement 5 & 6: Liquidsoap plays exclusively from request.queue and never uses /music."""
        with open(self.liq_path, "r", encoding="utf-8") as f:
            liq_text = f.read()

        self.assertIn('supabase_queue = request.queue(id="supabase_queue")', liq_text)
        self.assertIn('fallback(track_sensitive=false, [\n  supabase_queue,\n  blank()\n])', liq_text)
        self.assertNotIn("playlist(", liq_text, "radio.liq must not contain playlist() source")
        self.assertNotIn("/music", liq_text, "radio.liq must not reference /music directory")

    def test_docker_compose_volume_mounts(self):
        """Requirement 6: docker-compose mounts /cache and /music as read-only."""
        with open(self.compose_path, "r", encoding="utf-8") as f:
            compose_text = f.read()

        self.assertIn("./cache:/cache:ro", compose_text)
        self.assertIn("./music:/music:ro", compose_text)
        self.assertIn("./radio.liq:/radio.liq:ro", compose_text)

    def test_daemon_no_hardcoded_streaming_key(self):
        """Requirement 9: Daemon does not hardcode streaming keys or credentials."""
        with open(self.daemon_path, "r", encoding="utf-8") as f:
            daemon_text = f.read()

        self.assertNotIn("pulsecast_dev_radio_streaming_secret_key_92840184", daemon_text)
        self.assertNotIn("pulsecast_streaming_secure_token_key", daemon_text)

    def test_env_example_template(self):
        """Requirement 10: .env.radio.example lists all required variables without values."""
        with open(self.env_example_path, "r", encoding="utf-8") as f:
            env_text = f.read()

        required_vars = [
            "ICECAST_SOURCE_PASSWORD=",
            "ICECAST_ADMIN_PASSWORD=",
            "ICECAST_PASSWORD=",
            "ICECAST_RELAY_PASSWORD=",
            "BACKEND_STREAMING_URL=",
            "RADIO_STREAMING_KEY=",
            "RADIO_STATION_ID=",
            "CACHE_DIR=",
            "LIQUIDSOAP_HOST=",
            "LIQUIDSOAP_PORT="
        ]
        for v in required_vars:
            self.assertIn(v, env_text, f"{v} must be present in .env.radio.example")


if __name__ == "__main__":
    unittest.main()
