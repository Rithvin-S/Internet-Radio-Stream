# PulseCast Song Library --- Supabase Storage Implementation Plan

## 1. Goal

Add a permanent music library to the PulseCast admin dashboard. Admins
must be able to:

-   Upload one song at a time.
-   Bulk-upload multiple songs in one operation.
-   Browse, search, filter, and inspect uploaded songs.
-   Edit song metadata.
-   Select songs from the library while creating or editing a program
    schedule.
-   Arrange playlist order and remove songs from a schedule without
    deleting them from the library.

Keep the existing PulseCast radio stations, calendar, schedule workflow,
listener frontend, and Icecast/Liquidsoap streaming setup working.

## 2. Existing architecture

-   Frontend: React + TypeScript on Vercel.
-   Backend: Node.js + Express on Render.
-   Database: Supabase PostgreSQL.
-   Radio server: Icecast + Liquidsoap on AWS EC2.
-   Public stream: `https://pulsecast.duckdns.org/pulsecast.mp3`

The EC2 instance may be stopped during development. Build and test the
library, upload, metadata, and schedule-assignment workflows without
requiring the radio server to be running. Test actual playback only
after EC2 is started.

## 3. Storage decision

Use **Supabase Storage** in the existing Supabase project.

Create a private bucket:

`pulsecast-music-library`

Store the actual audio files in this bucket. Store only metadata and the
Storage object path in PostgreSQL. Do not store MP3/WAV file contents or
binary blobs in database rows.

Suggested object path:

`library/<song-uuid>/<sanitized-filename>`

Do not make the bucket public. Do not expose the Supabase
service-role/secret key in React, browser requests, GitHub, or
client-side environment variables.

### Free-plan constraints to account for

Supabase Free has limited storage and bandwidth, and a 50 MB per-file
upload limit. Validate file size before upload and show a clear error
when a file exceeds the configured limit. Recheck the current Supabase
dashboard quotas before production use because plan limits can change.

For typical MP3 files, storage capacity depends on bitrate and duration.
Show used storage and remaining quota where available; do not hardcode
an assumed number of songs.

## 4. Database design

First inspect the current Supabase schema and existing schedule/playlist
API. Reuse existing conventions and avoid breaking existing records.

Create a `songs` table for permanent library entries. Suggested fields:

-   `id` UUID primary key.
-   `title` text, required.
-   `artist` text, nullable.
-   `album` text, nullable.
-   `duration_seconds` integer, nullable.
-   `mime_type` text, required.
-   `file_size_bytes` bigint, required.
-   `storage_bucket` text, required.
-   `storage_path` text, required and unique.
-   `original_filename` text.
-   `created_by` UUID, nullable or linked to the existing user model as
    appropriate.
-   `created_at` timestamptz.
-   `updated_at` timestamptz.
-   `is_active` boolean, default true.

Add indexes for title, artist, and created_at as appropriate. Use
case-insensitive search where supported.

For schedule assignment, inspect the current `program_schedules` and
`upcoming_tracks` structures before deciding how to connect songs.
Prefer a dedicated join table such as `schedule_tracks` with:

-   `id` UUID primary key.
-   `schedule_id` referencing the existing schedule primary key.
-   `song_id` referencing `songs.id`.
-   `position` integer for playlist ordering.
-   `created_at` timestamptz.

Add appropriate foreign keys, uniqueness rules, and indexes. If the
current application already has a reliable playlist association model,
extend it rather than creating a duplicate system. Do not repurpose or
delete existing `upcoming_tracks` data without confirming its current
use.

## 5. Storage security

-   Keep the bucket private.
-   The backend must authenticate the user and verify that the user has
    an admin/authorized role before upload, bulk upload, metadata
    editing, deletion, or schedule management.
-   Use the Supabase service-role/secret key only on Render, stored as a
    protected environment variable.
-   Never return the service-role key to the frontend.
-   Generate short-lived signed URLs only when a file needs to be
    previewed or fetched.
-   Apply Storage policies that prevent anonymous users from listing,
    uploading, replacing, or deleting library files.
-   Keep existing public access to stations, published schedules, and
    other existing data unchanged.

Do not assume that hiding an admin button is sufficient authorization.
Enforce permissions in backend routes.

## 6. Backend implementation

Add authenticated admin endpoints following the existing Express
route/controller conventions.

Suggested endpoints:

-   `GET /api/admin/songs`
    -   Search by title/artist/album.
    -   Support pagination and optional filters.
-   `POST /api/admin/songs`
    -   Upload one audio file.
    -   Validate authorization, MIME type, extension, size, and
        metadata.
    -   Upload the file to the private bucket.
    -   Insert the metadata row.
    -   If database insertion fails, remove the uploaded object to avoid
        orphaned files.
-   `POST /api/admin/songs/bulk`
    -   Accept multiple files.
    -   Process with a small concurrency limit rather than uploading
        every file simultaneously.
    -   Return a per-file result: success or failure, filename, and
        reason.
    -   Do not roll back successful files just because another file
        failed.
    -   Allow failed files to be retried.
-   `PATCH /api/admin/songs/:id`
    -   Edit title, artist, album, and other editable metadata.
-   `DELETE /api/admin/songs/:id`
    -   Prefer soft-delete/archive by default.
    -   Before permanent deletion, check whether the song is assigned to
        any schedules.
    -   Do not delete a song that is still referenced by a schedule
        unless the admin explicitly resolves those references.
-   `POST /api/admin/songs/:id/signed-url`
    -   Verify authorization and return a short-lived signed URL for
        preview/playback.
-   Schedule playlist endpoints:
    -   Read, add, remove, and reorder songs for a schedule.
    -   Preserve the existing schedule create/update behavior.

Use the project's existing validation, error response, logging, and
authentication middleware. Do not introduce a second authentication
system.

## 7. Audio metadata and validation

Start with MP3 support. Add other formats only after verifying that the
deployed Liquidsoap version can decode them reliably.

-   Validate both MIME type and file extension; do not trust the
    browser-provided MIME type alone.
-   Enforce the configured maximum file size.
-   Use a server-side metadata library such as `music-metadata` to read
    title, artist, album, and duration when tags are present.
-   If metadata is missing, derive a reasonable initial title from the
    filename and let the admin edit it.
-   Do not reject a valid file solely because its ID3 tags are absent.
-   Prevent path traversal and sanitize filenames. Generate UUID-based
    object paths rather than trusting user filenames.

## 8. Frontend implementation

Add a **Song Library** page/section to the admin dashboard.

### Library page

Include:

-   Search input for title, artist, and album.
-   Upload Song action.
-   Bulk Upload action.
-   Song list/table with title, artist, album, duration, file size,
    upload date, and status.
-   Pagination or incremental loading.
-   Edit metadata action.
-   Preview action using a short-lived signed URL.
-   Archive/delete action with confirmation.
-   Upload progress and clear success/failure messages.

### Individual upload

-   File picker for one audio file.
-   Display filename and size before upload.
-   Allow title, artist, and album to be edited before or after upload.
-   Show progress and the final result.

### Bulk upload

-   Allow selecting multiple audio files.
-   Show a queue with each filename, size, progress, and status.
-   Upload with limited concurrency.
-   Show successful and failed files separately.
-   Provide retry for failed files.
-   Do not silently discard files that fail.

### Schedule modal integration

In the existing Create/Edit Schedule modal, replace or extend the
current track-search source so admins can browse the permanent Song
Library.

-   Search the library by title/artist.
-   Add one or more songs to the schedule playlist.
-   Display selected songs in playlist order.
-   Support reorder and remove.
-   Save assignments using the backend schedule playlist API.
-   Reopen the schedule and verify the saved playlist is restored.
-   Removing a song from a schedule must not delete it from the library.
-   Preserve current calendar month/week/day behavior, station
    selection, status filters, drag/drop rescheduling, and existing
    schedule fields.

## 9. Streaming integration: important design requirement

Do not assume a temporary signed URL is a permanent audio source. Signed
URLs expire.

Implement the library and schedule management first. Then inspect the
current Liquidsoap configuration and how it receives scheduled tracks.

Preferred playback flow:

1.  The scheduler identifies the next scheduled song.
2.  The backend verifies the song and creates a short-lived signed URL
    immediately before playback.
3.  The radio-side playback process fetches the file while the URL is
    valid.
4.  Liquidsoap plays the audio and sends the stream to Icecast.
5.  The next track is resolved in the same way.

If the current Liquidsoap setup cannot reliably fetch a signed URL at
the required time, implement a small authenticated sync/download service
on the EC2 radio host. It should fetch only the next required songs from
the backend, save them to a controlled local music directory, and let
Liquidsoap play local files. Do not make the bucket public merely to
work around URL expiry.

Account for the fact that EC2 may be stopped. The backend and admin
library must continue to work while EC2 is offline; playback resumes
when the radio host is running.

Do not implement YouTube scraping, unauthorized music downloading, or a
public unrestricted upload endpoint. Admins must upload audio they are
authorized to use.

## 10. Testing checklist

### Database and storage

-   [ ] Migration works against the existing Supabase project.
-   [ ] Existing users, stations, schedules, and tracks remain intact.
-   [ ] Bucket is private.
-   [ ] Audio files are stored in Supabase Storage, not PostgreSQL.
-   [ ] No secret key appears in frontend bundles or Git history.

### Uploads

-   [ ] One MP3 uploads successfully.
-   [ ] Multiple MP3s upload successfully.
-   [ ] Invalid type and oversized file are rejected with clear
    messages.
-   [ ] A failed metadata insert cleans up its uploaded object.
-   [ ] Bulk upload reports partial failures and supports retry.
-   [ ] Metadata can be edited and persists after refresh.

### Permissions

-   [ ] Anonymous/non-admin users cannot upload, edit, archive, or
    delete.
-   [ ] Admin routes validate role on the backend.
-   [ ] Signed URLs are short-lived and generated only after
    authorization.

### Schedule integration

-   [ ] Admin can search and select library songs.
-   [ ] Playlist order persists.
-   [ ] Removing a song from a schedule leaves the library entry intact.
-   [ ] Existing schedule creation/editing and calendar navigation still
    work.

### Streaming

-   [ ] Playback process can retrieve a private audio object without
    exposing permanent credentials.
-   [ ] Signed URL expiry is handled safely.
-   [ ] Liquidsoap decodes and plays supported formats.
-   [ ] Icecast listener stream continues across track changes.

## 11. Environment variables

Keep the existing production Supabase configuration. The backend should
use the already configured:

-   `SUPABASE_URL`
-   `SUPABASE_SECRET_KEY` (backend only)

Do not add these values to source code or Vercel frontend variables. If
the project uses a different established secret variable name, preserve
that existing name instead of creating a duplicate.

## 12. Recommended implementation order

1.  Inspect the repository, current Supabase schema, authentication
    middleware, schedule APIs, and Liquidsoap configuration.
2.  Write a migration for `songs` and the schedule-song association,
    adapted to the real schema.
3.  Create and secure the private Supabase Storage bucket.
4.  Implement backend single-upload, bulk-upload, browse, edit, archive,
    and signed-URL endpoints.
5.  Test backend endpoints and permissions.
6.  Build the Song Library admin page and upload experiences.
7.  Integrate library search and playlist assignment into the existing
    schedule modal.
8.  Test schedule persistence and regression-test the calendar.
9.  Implement the private-file-to-Liquidsoap playback bridge, explicitly
    handling signed URL expiry.
10. Test end-to-end playback after starting the EC2 radio instance.

## 13. Antigravity implementation prompt

You are working on the existing PulseCast repository. Implement the Song
Library feature described below using **Supabase Storage**, not
Cloudflare R2.

### Critical instructions

-   Inspect the existing repository before editing.
-   Read the current Supabase schema, Express authentication and
    authorization middleware, admin dashboard components, schedule APIs,
    `program_schedules`, `upcoming_tracks`, and the current
    Liquidsoap/Icecast configuration.
-   Do not assume table names, primary-key types, role names, or API
    response formats. Adapt to the actual code.
-   Preserve all existing features and records. Do not rewrite the
    project or replace the current authentication system.
-   Do not put any Supabase secret/service-role key in frontend code,
    Vercel variables, source files, or logs.
-   Do not use Cloudflare R2.
-   Do not store audio binaries in PostgreSQL. Store audio objects in a
    private Supabase Storage bucket and metadata in PostgreSQL.
-   Do not make the bucket public to avoid signed URL expiry.
-   Do not claim streaming integration is complete until the Liquidsoap
    playback path has been tested.

### Feature requirements

1.  Create a private Supabase Storage bucket named
    `pulsecast-music-library`.
2.  Add a permanent `songs` metadata table with a Storage object path.
3.  Add a schedule-song association using the existing playlist model if
    one exists; otherwise create a suitable join table with playlist
    position.
4.  Build backend admin endpoints for:
    -   Listing/searching/paginating songs.
    -   Uploading one song.
    -   Bulk uploading multiple songs with limited concurrency and
        per-file results.
    -   Editing metadata.
    -   Archiving/deleting safely.
    -   Generating short-lived signed URLs.
    -   Adding, removing, reading, and reordering schedule playlist
        entries.
5.  Validate file type, extension, and size on the backend. Start with
    MP3. Enforce the current Supabase upload size limit.
6.  Extract available audio tags and duration using a server-side
    metadata parser. Allow manual metadata editing when tags are absent.
7.  Build the admin Song Library UI with search, single upload, bulk
    upload, progress, partial-failure reporting, retry, metadata
    editing, preview, and archive.
8.  Integrate the library into the existing Create/Edit Schedule modal.
    Admins must be able to search, select, reorder, and remove songs.
    Removing a playlist entry must not remove the library object.
9.  Preserve the existing calendar, station filters, schedule fields,
    drag/drop rescheduling, theme, and listener-facing station/stream
    behavior.
10. Implement a secure playback bridge from private Supabase Storage to
    the existing Liquidsoap/Icecast system. Signed URLs are temporary:
    resolve them immediately before playback or implement an
    authenticated EC2-side downloader/cache. Never expose service-role
    credentials to Liquidsoap clients or listeners.
11. Ensure the admin library works while the EC2 instance is stopped.
    Only end-to-end radio playback tests require EC2 to be running.

### Deliverables

-   Database migration SQL.
-   Storage bucket/policy setup instructions or migration where
    supported.
-   Backend routes/controllers/services and validation.
-   Frontend Song Library page/components.
-   Schedule modal integration.
-   Tests for uploads, permissions, metadata, and playlist persistence.
-   Updated environment-variable documentation without secrets.
-   A concise implementation summary listing changed files, migration
    steps, environment variables, tests run, and any remaining streaming
    limitation.

### Execution approach

Implement in small, verifiable stages. After each stage, run relevant
tests/builds and fix errors before continuing. Before changing existing
schedule behavior, explain the exact compatibility approach in code
comments or the implementation summary. If a required assumption cannot
be verified from the repository, stop and report the missing detail
rather than inventing a schema or silently changing existing behavior.
