settings.log.stdout := true
settings.server.telnet := true
settings.server.telnet.bind_addr := "0.0.0.0"
settings.server.telnet.port := 1234

# 1. Supabase Storage playback queue (only audio downloaded from Supabase Storage)
supabase_queue = request.queue(id="supabase_queue")

# 2. Output continuous silence when no scheduled Supabase track is queued
# track_sensitive=false ensures immediate transition from silence when a track is pushed
radio = fallback(track_sensitive=false, [
  supabase_queue,
  blank()
])

# 3. Icecast output stream (128 kbps MP3 to mount /pulsecast.mp3)
output.icecast(
  %mp3(bitrate=128),
  host="icecast",
  port=8000,
  password="Rithvin@2411",
  mount="/pulsecast.mp3",
  name="PulseCast Radio",
  description="Automated Supabase music radio",
  radio
)
