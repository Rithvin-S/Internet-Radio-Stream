-- ============================================================================
-- Full-Stack Internet Radio Streaming System
-- Initial Seed Data (backend/sql/seed.sql)
-- ============================================================================

USE internet_radio;

-- ----------------------------------------------------------------------------
-- Seed Default Users:
-- Admin:    admin@pulsecast.com    / Password: AdminPassword123!
-- Listener: listener@pulsecast.com / Password: ListenerPass123!
-- ----------------------------------------------------------------------------
INSERT INTO users (name, email, password_hash, role) VALUES
('Station Administrator', 'admin@pulsecast.com', '$2a$10$UdPmQuU.nuFRsrWeDszGW.mhlGmFAuPIXwcP//96oLPFmhFU4MXZK', 'admin'),
('Alex Rivera', 'listener@pulsecast.com', '$2a$10$XQEqmAqOwX1yQpm6Oglz.eYuZGG2RZP7OIUxZesATQDFtHGDLgSYi', 'listener')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ----------------------------------------------------------------------------
-- Seed Active Radio Stations (Verified Live Audio Endpoints)
-- ----------------------------------------------------------------------------
INSERT INTO stations (id, name, description, genre, stream_url, artwork_url, is_active) VALUES
(1, 'Radio Paradise (Main Mix)', 'High-fidelity eclectic rock, indie, world and acoustic streaming live 24/7.', 'Eclectic / Rock', 'https://stream.radioparadise.com/mp3-128', 'assets/station-artwork.svg', TRUE),
(2, 'Nightwave Plaza', '24/7 internet radio broadcast dedicated to vaporwave, future funk and ambient electronic soundscapes.', 'Vaporwave / Electronic', 'https://radio.plaza.one/mp3', 'assets/station-artwork.svg', TRUE),
(3, 'CJWF FM / Icecast 2.4 Server', 'Live stream broadcast hosted on a standard Icecast 2.4 streaming server mount.', 'Country / Hits', 'https://live.leanstream.co/CJWFFM-MP3', 'assets/station-artwork.svg', TRUE),
(4, 'KEXP Seattle Independent', 'Curated independent music broadcast from Seattle, Washington.', 'Alternative / Indie', 'https://kexp.streamguys1.com/kexp128.mp3', 'assets/station-artwork.svg', TRUE),
(5, 'SomaFM Groove Salad', 'A nicely chilled plate of ambient/downtempo beats and grooves.', 'Ambient / Downtempo', 'https://ice1.somafm.com/groovesalad-128-mp3', 'assets/station-artwork.svg', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), stream_url = VALUES(stream_url);

-- ----------------------------------------------------------------------------
-- Seed Upcoming Tracks / Songs To Be Played Next (Per Station)
-- ----------------------------------------------------------------------------
INSERT INTO upcoming_tracks (station_id, title, artist, album, duration, play_order, status) VALUES
-- Station 1: Radio Paradise
(1, 'Teardrop', 'Massive Attack', 'Mezzanine', '05:30', 1, 'playing'),
(1, 'Karma Police', 'Radiohead', 'OK Computer', '04:24', 2, 'queued'),
(1, 'Breathe (In the Air)', 'Pink Floyd', 'The Dark Side of the Moon', '03:58', 3, 'queued'),
(1, 'Drive', 'R.E.M.', 'Automatic for the People', '04:31', 4, 'queued'),
(1, 'Heroes', 'David Bowie', 'Heroes', '06:07', 5, 'queued'),

-- Station 2: Nightwave Plaza
(2, 'Private Caller', 'Saint Pepsi', 'Hit Vibes', '03:15', 1, 'playing'),
(2, 'Enjoy Yourself', 'Saint Pepsi', 'Late Night Delight', '02:40', 2, 'queued'),
(2, 'Plastic Love (Vaporwave Edit)', 'Mariya Takeuchi', 'Variety', '04:55', 3, 'queued'),
(2, 'Resonance', 'HOME', 'Odyssey', '03:32', 4, 'queued'),
(2, 'Floral Shoppe', 'Macintosh Plus', 'Floral Shoppe', '03:42', 5, 'queued'),

-- Station 3: CJWF FM (Icecast 2.4)
(3, 'Starting Over', 'Chris Stapleton', 'Starting Over', '04:00', 1, 'playing'),
(3, 'Fast Car', 'Luke Combs', 'Gettin Old', '04:25', 2, 'queued'),
(3, 'Heartache Medication', 'Jon Pardi', 'Heartache Medication', '03:29', 3, 'queued'),
(3, 'Whiskey Glasses', 'Morgan Wallen', 'If I Know Me', '03:54', 4, 'queued'),

-- Station 4: KEXP Seattle
(4, 'Motion Sickness', 'Phoebe Bridgers', 'Stranger in the Alps', '03:49', 1, 'playing'),
(4, 'Seventeen', 'Sharon Van Etten', 'Remind Me Tomorrow', '04:37', 2, 'queued'),
(4, 'Black licorice', 'Peach Pit', 'You and Your Friends', '03:19', 3, 'queued'),

-- Station 5: SomaFM Groove Salad
(5, 'Adrift', 'Tycho', 'Past is Prologue', '04:56', 1, 'playing'),
(5, 'Dayvan Cowboy', 'Boards of Canada', 'The Campfire Headphase', '05:00', 2, 'queued'),
(5, 'Kiara', 'Bonobo', 'Black Sands', '03:50', 3, 'queued')
ON DUPLICATE KEY UPDATE title = VALUES(title);

-- ----------------------------------------------------------------------------
-- Seed Program Schedules
-- ----------------------------------------------------------------------------
INSERT INTO program_schedules (station_id, title, description, start_time, end_time, is_published) VALUES
(1, 'Morning Acoustic Awakening', 'Gentle acoustic melodies, indie folk and morning coffee accompaniment.', '08:00', '11:00', TRUE),
(1, 'World Horizon Beats', 'Eclectic world rhythms, afrobeat and international jazz explorations.', '12:00', '15:00', TRUE),
(1, 'Evening Rock Odyssey', 'Progressive rock, indie anthems and late-night album deep cuts.', '18:00', '22:00', TRUE),
(2, 'Vapor Sunset Neon', 'Chilled vaporwave synthesizers, city pop remixes and VHS aesthetics.', '17:00', '20:00', TRUE),
(2, 'Midnight Mall Grooves', 'Late-night future funk, ambient tape loops and nostalgic beats.', '22:00', '02:00', TRUE),
(3, 'Country Road Drive', 'Top country hits, road trip tracks and listener call-ins.', '09:00', '12:00', TRUE)
ON DUPLICATE KEY UPDATE title = VALUES(title);

-- ----------------------------------------------------------------------------
-- Seed Initial Favourites
-- ----------------------------------------------------------------------------
INSERT INTO favourites (user_id, station_id) VALUES
(2, 1),
(2, 2)
ON DUPLICATE KEY UPDATE created_at = CURRENT_TIMESTAMP;
