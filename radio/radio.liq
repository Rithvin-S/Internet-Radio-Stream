settings.log.stdout := true

# ------------------------------------------------------------------------------
# 1. Telnet Control Interface (Secured to localhost port 1234 via Docker port map)
# ------------------------------------------------------------------------------
settings.server.telnet := true
settings.server.telnet.bind_addr := "0.0.0.0"
settings.server.telnet.port := 1234

# ------------------------------------------------------------------------------
# 2. Icecast Credentials & Streaming Configuration (Loaded from Environment)
# ------------------------------------------------------------------------------
icecast_host = environment.get(default="icecast", "ICECAST_HOST")
icecast_port = int_of_string(environment.get(default="8000", "ICECAST_PORT"))
icecast_source_password = environment.get(default="", "ICECAST_SOURCE_PASSWORD")
icecast_mount = environment.get(default="/pulsecast.mp3", "ICECAST_MOUNT")

# ------------------------------------------------------------------------------
# 3. Supabase Storage Dynamic Queue
# Exclusively receives audio downloaded by the PulseCast Python sync daemon
# ------------------------------------------------------------------------------
supabase_queue = request.queue(id="supabase_queue")

# ------------------------------------------------------------------------------
# 4. Failover & Fallback
# When the queue has tracks, streams Supabase audio.
# When empty, emits continuous silence frames (blank()) to keep Icecast connected.
# Never uses local directory playlists or legacy local files.
# ------------------------------------------------------------------------------
radio = fallback(track_sensitive=false, [
  supabase_queue,
  blank()
])

# ------------------------------------------------------------------------------
# 5. Output to Icecast Stream
# ------------------------------------------------------------------------------
output.icecast(
  %mp3(bitrate=128),
  host=icecast_host,
  port=icecast_port,
  password=icecast_source_password,
  mount=icecast_mount,
  name="PulseCast Radio",
  description="PulseCast Supabase-Only Internet Radio Broadcast",
  radio
)
