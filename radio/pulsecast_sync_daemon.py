#!/usr/bin/env python3
"""
PulseCast - Supabase-Only EC2 Radio Playback Sync Daemon
(pulsecast_sync_daemon.py)

Responsibilities:
1. Polls the station-aware playback dispatcher (Phase 2).
2. Enforces Supabase Storage as the ONLY audio source.
3. Downloads signed audio payloads atomically to temporary cache.
4. Validates HTTP status, byte size, audio MIME type, MP3 headers, and SHA-256.
5. Pushes validated local file paths to Liquidsoap v2.3.3 request.queue via telnet.
6. Advances backend progression cursor only after successful enqueue.
7. Periodically cleans up completed audio files from cache.
8. Ensures zero dead air (Liquidsoap falls back to continuous silence, never dropping Icecast).
"""

import os
import sys
import time
import json
import socket
import logging
import hashlib
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime

# ==============================================================================
# Protected Environment Loading (.env)
# ==============================================================================
def load_dotenv(env_path=None):
    """Loads environment variables from an adjacent protected .env file if not already set."""
    if env_path is None:
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'\"")
                    if k and k not in os.environ:
                        os.environ[k] = v
        except Exception:
            pass

load_dotenv()

# ==============================================================================
# Configuration & Environment Variables
# ==============================================================================
CONFIG = {
    "BACKEND_STREAMING_URL": os.getenv("BACKEND_STREAMING_URL", "https://internet-radio-stream.onrender.com/api/streaming/stations"),
    "RADIO_STREAMING_KEY": os.getenv("RADIO_STREAMING_KEY", "").strip() or None,
    "RADIO_STATION_ID": int(os.getenv("RADIO_STATION_ID", "7")),
    "CACHE_DIR": os.getenv("CACHE_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")),
    "CONTAINER_CACHE_DIR": os.getenv("CONTAINER_CACHE_DIR", "/cache"),
    "CACHE_MAX_MB": int(os.getenv("CACHE_MAX_MB", "500")),
    "LIQUIDSOAP_HOST": os.getenv("LIQUIDSOAP_HOST", "127.0.0.1"),
    "LIQUIDSOAP_PORT": int(os.getenv("LIQUIDSOAP_PORT", "1234")),
    "POLL_INTERVAL_SECONDS": int(os.getenv("POLL_INTERVAL_SECONDS", "5")),
    "PRE_BUFFER_SECONDS": int(os.getenv("PRE_BUFFER_SECONDS", "25")),
    "MAX_RETRY_BACKOFF": 60,
    "QUEUE_NAME": "supabase_queue"
}

# ==============================================================================
# Logging Configuration (Never log sensitive tokens or signed URLs)
# ==============================================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [SYNC_DAEMON] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("pulsecast_sync")


def sanitize_url(url: str) -> str:
    """Mask tokens or signatures from URLs for safe logging."""
    if not url:
        return ""
    if "token=" in url:
        parsed = urllib.parse.urlparse(url)
        return f"{parsed.scheme}://{parsed.netloc}{parsed.path}?token=[REDACTED]"
    return url


# ==============================================================================
# Liquidsoap Telnet Client
# ==============================================================================
class LiquidsoapClient:
    def __init__(self, host: str, port: int, timeout: float = 4.0):
        self.host = host
        self.port = port
        self.timeout = timeout

    def send_command(self, cmd: str) -> str:
        """Sends an interactive command to Liquidsoap and returns response text."""
        cmd_clean = cmd.strip()
        payload = f"{cmd_clean}\nquit\n".encode("utf-8")
        
        with socket.create_connection((self.host, self.port), timeout=self.timeout) as s:
            s.settimeout(self.timeout)
            s.sendall(payload)
            chunks = []
            while True:
                try:
                    data = s.recv(4096)
                    if not data:
                        break
                    chunks.append(data.decode("utf-8", errors="replace"))
                except socket.timeout:
                    break
        
        raw = "".join(chunks)
        # Strip trailing END and Bye!
        lines = [line.strip() for line in raw.splitlines() if line.strip() not in ("END", "Bye!", "")]
        return "\n".join(lines)

    def is_connected(self) -> bool:
        """Checks if Liquidsoap telnet port is responsive."""
        try:
            resp = self.send_command("version")
            return "Liquidsoap" in resp or len(resp) > 0
        except Exception:
            return False

    def push_track(self, container_path: str, queue_name: str = "supabase_queue") -> str:
        """Pushes a file path into Liquidsoap's request queue."""
        resp = self.send_command(f"{queue_name}.push {container_path}")
        return resp.strip()

    def get_remaining_seconds(self) -> float:
        """
        Returns estimated remaining playback seconds.
        Returns -1.0 if silence/blank is currently playing.
        """
        try:
            resp = self.send_command("output.icecast.remaining").strip()
            if not resp or resp == "(undef)":
                return -1.0
            return float(resp)
        except Exception:
            return -1.0

    def get_queue_contents(self, queue_name: str = "supabase_queue") -> list:
        """Returns list of pending requests in the queue."""
        try:
            resp = self.send_command(f"{queue_name}.queue").strip()
            if not resp or resp == "(empty)":
                return []
            return [line.strip() for line in resp.splitlines() if line.strip()]
        except Exception:
            return []


# ==============================================================================
# Audio Validator
# ==============================================================================
class AudioValidator:
    @staticmethod
    def validate_mp3_header(file_path: str) -> bool:
        """Verifies that the downloaded file begins with an ID3 tag or valid MPEG sync frame."""
        if not os.path.exists(file_path):
            return False
        
        size = os.path.getsize(file_path)
        if size < 5000:  # Valid audio files are substantially larger than 5KB
            return False

        with open(file_path, "rb") as f:
            header = f.read(10)

        if len(header) < 4:
            return False

        # ID3v2 header: "ID3"
        if header.startswith(b"ID3"):
            return True

        # MPEG Audio Frame Header (Sync word: 11 bits set = 0xFF 0xE0 to 0xFF 0xFF)
        b0 = header[0]
        b1 = header[1]
        if b0 == 0xFF and (b1 & 0xE0) == 0xE0:
            return True

        return False

    @staticmethod
    def compute_sha256(file_path: str) -> str:
        """Calculates SHA-256 hash of audio file."""
        hasher = hashlib.sha256()
        with open(file_path, "rb") as f:
            while chunk := f.read(65536):
                hasher.update(chunk)
        return hasher.hexdigest()


# ==============================================================================
# PulseCast EC2 Sync Daemon
# ==============================================================================
class PulseCastSyncDaemon:
    def __init__(self, config=None):
        self.config = config or CONFIG
        self.station_id = int(self.config["RADIO_STATION_ID"])
        self.cache_dir = self.config["CACHE_DIR"]
        self.container_cache_dir = self.config["CONTAINER_CACHE_DIR"]

        raw_key = self.config.get("RADIO_STREAMING_KEY")
        self.streaming_key = raw_key.strip() if isinstance(raw_key, str) and raw_key.strip() else None
        if not self.streaming_key:
            logger.critical("FATAL: RADIO_STREAMING_KEY is missing or empty. Server-to-server authentication requires a valid key.")
            raise ValueError("RADIO_STREAMING_KEY environment variable is required and must not be empty.")

        self.backend_base = self.config["BACKEND_STREAMING_URL"].rstrip("/")
        self.liquidsoap = LiquidsoapClient(
            self.config["LIQUIDSOAP_HOST"],
            self.config["LIQUIDSOAP_PORT"]
        )
        self.is_running = False
        self.current_schedule_id = None
        self.enqueued_tracks = {}  # track_id -> { local_path, container_path, enqueued_at, duration_seconds }
        self.retry_delay = 5

        os.makedirs(self.cache_dir, exist_ok=True)
        self.cleanup_abandoned_tmp_files()

    def cleanup_abandoned_tmp_files(self):
        """Cleans up leftover .tmp_* files from previous daemon crashes or reboots."""
        try:
            for item in os.listdir(self.cache_dir):
                if item.startswith(".tmp_"):
                    p = os.path.join(self.cache_dir, item)
                    try:
                        os.remove(p)
                        logger.info("Cleaned up abandoned temporary download: %s", item)
                    except OSError:
                        pass
        except Exception as e:
            logger.warning("Error scanning cache dir for tmp cleanup: %s", e)

    def fetch_next_track_metadata(self, advance: bool = False, sim_time: str = None) -> dict:
        """
        Calls the station-aware playback dispatcher.
        If advance=False, idempotently retrieves the track for current progression cursor.
        If advance=True, increments the server cursor.
        """
        params = []
        if advance:
            params.append("advance=true")
        if sim_time:
            params.append(f"simulated_time={urllib.parse.quote(sim_time)}")

        query_str = f"?{'&'.join(params)}" if params else ""
        url = f"{self.backend_base}/{self.station_id}/next-track{query_str}"

        req = urllib.request.Request(
            url,
            headers={
                "x-radio-token": self.streaming_key,
                "User-Agent": "PulseCast-EC2-Daemon/1.0"
            }
        )

        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read().decode("utf-8")
            return json.loads(data)

    def download_audio_atomically(self, signed_url: str, track_id: str, expected_hash: str = None) -> str:
        """
        Downloads the audio stream to a temporary file, validates format & checksum,
        and atomically renames to final destination.
        """
        tmp_filename = f".tmp_{track_id}_{int(time.time())}.mp3"
        tmp_path = os.path.join(self.cache_dir, tmp_filename)
        final_filename = f"{track_id}.mp3"
        final_path = os.path.join(self.cache_dir, final_filename)

        # If file is already cached and valid, reuse it
        if os.path.exists(final_path) and os.path.getsize(final_path) > 10000:
            if AudioValidator.validate_mp3_header(final_path):
                return final_path

        req = urllib.request.Request(
            signed_url,
            headers={"User-Agent": "PulseCast-Radio-Downloader/1.0"}
        )

        logger.info("Downloading Supabase audio for track %s...", track_id)
        start_t = time.time()

        with urllib.request.urlopen(req, timeout=30) as response:
            if response.status != 200:
                raise ValueError(f"Download failed with HTTP status: {response.status}")
            
            content_type = response.headers.get("Content-Type", "")
            if not ("audio" in content_type or "octet-stream" in content_type):
                raise ValueError(f"Invalid Content-Type for audio payload: {content_type}")

            bytes_written = 0
            with open(tmp_path, "wb") as f:
                while chunk := response.read(65536):
                    f.write(chunk)
                    bytes_written += len(chunk)

        download_dur = time.time() - start_t
        logger.info("Downloaded %d bytes in %.2fs (%.1f KB/s). Validating...",
                    bytes_written, download_dur, (bytes_written / 1024) / max(download_dur, 0.01))

        # Format validation
        if not AudioValidator.validate_mp3_header(tmp_path):
            os.remove(tmp_path)
            raise ValueError(f"Downloaded file failed MP3 header verification: {tmp_path}")

        # Checksum validation if available
        if expected_hash:
            actual_hash = AudioValidator.compute_sha256(tmp_path)
            if actual_hash.lower() != expected_hash.lower():
                os.remove(tmp_path)
                raise ValueError(f"SHA-256 hash mismatch! Expected: {expected_hash}, Actual: {actual_hash}")

        # Atomic rename
        os.replace(tmp_path, final_path)
        logger.info("Successfully validated and cached: %s", final_filename)
        return final_path

    def prune_cache(self):
        """
        Cleans up played tracks and maintains cache under CACHE_MAX_MB.
        Never deletes a track currently playing or enqueued.
        """
        now = time.time()
        # Find finished tracks
        completed_ids = []
        for tid, meta in list(self.enqueued_tracks.items()):
            dur = meta.get("duration_seconds", 225)
            elapsed = now - meta.get("enqueued_at", now)
            # If elapsed time exceeds duration + 60s buffer, consider track played
            if elapsed > (dur + 60):
                completed_ids.append(tid)

        for tid in completed_ids:
            meta = self.enqueued_tracks.pop(tid, None)
            if meta:
                lp = meta.get("local_path")
                if lp and os.path.exists(lp):
                    try:
                        os.remove(lp)
                        logger.info("Pruned played track from cache: %s", os.path.basename(lp))
                    except OSError as e:
                        logger.warning("Failed to remove played file %s: %s", lp, e)

        # Enforce max disk limit
        try:
            total_bytes = sum(
                os.path.getsize(os.path.join(self.cache_dir, f))
                for f in os.listdir(self.cache_dir)
                if os.path.isfile(os.path.join(self.cache_dir, f))
            )
            max_bytes = self.config["CACHE_MAX_MB"] * 1024 * 1024
            if total_bytes > max_bytes:
                logger.warning("Cache size (%d MB) exceeds limit (%d MB). Pruning unreferenced files...",
                               total_bytes // (1024 * 1024), self.config["CACHE_MAX_MB"])
                # List candidate files
                active_files = {os.path.basename(m["local_path"]) for m in self.enqueued_tracks.values()}
                for f in sorted(os.listdir(self.cache_dir), key=lambda x: os.path.getmtime(os.path.join(self.cache_dir, x))):
                    if f not in active_files and not f.startswith(".tmp_"):
                        fp = os.path.join(self.cache_dir, f)
                        try:
                            os.remove(fp)
                            logger.info("Removed LRU cached audio: %s", f)
                        except OSError:
                            pass
        except Exception as e:
            logger.warning("Error enforcing cache limit: %s", e)

    def process_playback_cycle(self, sim_time: str = None) -> bool:
        """
        Executes a single sync cycle:
        1. Checks Liquidsoap remaining playback time.
        2. If pre-buffering is required:
           - Fetches active schedule & next track metadata.
           - Enforces Supabase-only source rule.
           - Downloads & verifies MP3.
           - Pushes path to Liquidsoap queue.
           - Advances backend progression cursor.
        """
        # Check Liquidsoap status
        rem = self.liquidsoap.get_remaining_seconds()
        queued = self.liquidsoap.get_queue_contents(self.config["QUEUE_NAME"])

        # Decide whether we need to push a new track:
        # We need a track if:
        # 1. No track is playing (rem == -1.0) and queue is empty (len == 0).
        # 2. Track is playing and remaining time <= PRE_BUFFER_SECONDS, and queue has 0 tracks buffered ahead.
        needs_track = False
        if rem == -1.0 and len(queued) == 0:
            needs_track = True
        elif rem > 0 and rem <= self.config["PRE_BUFFER_SECONDS"] and len(queued) == 0:
            needs_track = True

        if not needs_track:
            # Queue is adequately populated; prune played tracks and idle
            self.prune_cache()
            return True

        # Fetch metadata for next track from dispatcher (idempotent poll)
        metadata = self.fetch_next_track_metadata(advance=False, sim_time=sim_time)

        if not metadata.get("success"):
            logger.warning("Dispatcher returned failure: %s", metadata.get("message"))
            return False

        if not metadata.get("has_schedule") or metadata.get("fallback"):
            # No active schedule -> output silence, idle
            if self.current_schedule_id is not None:
                logger.info("Active schedule #%s ended. Returning to scheduled silence.", self.current_schedule_id)
                self.current_schedule_id = None
            self.prune_cache()
            return False

        # Schedule is active
        sched_id = metadata.get("schedule_id")
        if self.current_schedule_id != sched_id:
            logger.info("Transitioned to active schedule #%s: '%s'",
                        sched_id, metadata.get("schedule_title"))
            self.current_schedule_id = sched_id

        # ----------------------------------------------------------------------
        # CRITICAL ENFORCEMENT: ONLY SUPABASE AUDIO SOURCE PERMITTED
        # ----------------------------------------------------------------------
        track_source = metadata.get("source")
        if track_source != "supabase":
            logger.error("NON-SUPABASE TRACK REJECTED: Track %s has source '%s'. EC2 accepts ONLY 'supabase'.",
                         metadata.get("track_id"), track_source)
            # Advance cursor so the station does not stall indefinitely on non-Supabase catalogue tracks
            self.fetch_next_track_metadata(advance=True, sim_time=sim_time)
            return False

        audio_url = metadata.get("audio_url")
        if not audio_url or not metadata.get("is_signed_url"):
            logger.error("Track %s missing signed audio URL. Skipping.", metadata.get("track_id"))
            self.fetch_next_track_metadata(advance=True, sim_time=sim_time)
            return False

        track_id = str(metadata.get("track_id"))
        duration_sec = int(metadata.get("duration_seconds", 225))
        file_hash = metadata.get("file_hash")

        # Download audio atomically
        local_path = self.download_audio_atomically(audio_url, track_id, expected_hash=file_hash)
        
        # Build path as viewed by Liquidsoap in Docker container
        container_path = f"{self.container_cache_dir}/{os.path.basename(local_path)}"

        # Push to Liquidsoap queue via telnet
        push_res = self.liquidsoap.push_track(container_path, queue_name=self.config["QUEUE_NAME"])
        logger.info("Pushed track '%s' (RID %s) to Liquidsoap queue: %s",
                    metadata.get("title"), push_res, container_path)

        # Record enqueued track for lifecycle management
        self.enqueued_tracks[track_id] = {
            "local_path": local_path,
            "container_path": container_path,
            "enqueued_at": time.time(),
            "duration_seconds": duration_sec,
            "title": metadata.get("title")
        }

        # ONLY NOW: Advance progression cursor on backend!
        self.fetch_next_track_metadata(advance=True, sim_time=sim_time)
        logger.info("Advanced backend cursor for station %s.", self.station_id)

        self.retry_delay = 5
        return True

    def run(self):
        """Main daemon loop."""
        self.is_running = True
        logger.info("PulseCast EC2 Sync Daemon started for Station ID: %s", self.station_id)
        logger.info("Cache directory: %s | Max Size: %d MB", self.cache_dir, self.config["CACHE_MAX_MB"])
        logger.info("Backend URL: %s", self.backend_base)

        while self.is_running:
            try:
                # Check Liquidsoap connectivity
                if not self.liquidsoap.is_connected():
                    logger.warning("Liquidsoap telnet port %s:%s unavailable. Retrying in %ds...",
                                   self.config["LIQUIDSOAP_HOST"], self.config["LIQUIDSOAP_PORT"], self.retry_delay)
                    time.sleep(self.retry_delay)
                    self.retry_delay = min(self.retry_delay * 2, self.config["MAX_RETRY_BACKOFF"])
                    continue

                self.process_playback_cycle()
                time.sleep(self.config["POLL_INTERVAL_SECONDS"])

            except urllib.error.HTTPError as he:
                logger.error("Backend HTTP Error (%d): %s. Backoff %ds...", he.code, he.reason, self.retry_delay)
                time.sleep(self.retry_delay)
                self.retry_delay = min(self.retry_delay * 2, self.config["MAX_RETRY_BACKOFF"])
            except urllib.error.URLError as ue:
                logger.error("Backend Network Error: %s. Backoff %ds...", ue.reason, self.retry_delay)
                time.sleep(self.retry_delay)
                self.retry_delay = min(self.retry_delay * 2, self.config["MAX_RETRY_BACKOFF"])
            except Exception as e:
                logger.error("Unexpected error in sync daemon loop: %s", e, exc_info=True)
                time.sleep(self.config["POLL_INTERVAL_SECONDS"])


if __name__ == "__main__":
    try:
        daemon = PulseCastSyncDaemon()
        daemon.run()
    except (ValueError, KeyError) as e:
        logger.critical("Daemon startup aborted due to configuration error: %s", e)
        sys.exit(1)
    except KeyboardInterrupt:
        logger.info("Sync daemon stopped by administrator.")
        sys.exit(0)
