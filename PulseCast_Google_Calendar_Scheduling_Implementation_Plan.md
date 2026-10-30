# PulseCast -- Google Calendar-Style Admin Scheduling Implementation Plan

## 1. Objective

Redesign the PulseCast Admin Dashboard scheduling experience into a
Google Calendar-style radio programming calendar.

The administrator must be able to: - Choose a date. - Select a start and
end time. - Create and manage programme schedules. - Assign one or more
songs to each programme. - Select the radio station that will broadcast
the programme. - View, edit, reschedule, duplicate, publish, and delete
schedules. - Prevent conflicting schedules on the same station. -
Eventually trigger automated playback through Liquidsoap and Icecast.

This implementation must preserve the existing PulseCast frontend,
backend, authentication, station management, and Supabase integration.

## 2. Existing System Context

Current architecture: - Frontend: React + TypeScript/JavaScript, hosted
on Vercel. - Backend: Node.js + Express, hosted on Render. - Database:
Supabase PostgreSQL. - Streaming: Icecast + Liquidsoap on AWS EC2. -
Existing schedule table: `public.program_schedules`.

Important constraints: - Do not reintroduce MySQL or Aiven
dependencies. - Do not expose the Supabase secret/service-role key in
frontend code. - All database operations must go through the existing
backend API and Supabase adapter. - Keep existing login, JWT,
cookie/token handling, role checks, stations, and radio player behaviour
intact. - EC2 may be stopped during calendar development. Calendar CRUD
must work independently of live audio streaming. - Do not claim a
schedule is playing merely because it is published or saved.

## 3. User Experience and Calendar Layout

### 3.1 Main admin calendar

Replace the current admin scheduling interface with a calendar workspace
containing:

**Header controls** - Previous and Next navigation. - Today button. -
Current date/month/week heading. - View selector: Month, Week, Day. -
Create Schedule button. - Optional station filter. - Optional status
filter: Draft, Published, Completed.

**Month view** - Standard month grid. - Show schedule event chips inside
each date. - Display event title, station and time where space allows. -
Show an overflow indicator when a day contains more events than can
fit. - Clicking a date opens that day's view or starts a new schedule
for that date.

**Week view** - Seven-day time grid. - Time labels down the left side. -
Schedule blocks positioned according to start and end time. - Events for
different stations should be distinguishable using consistent station
colours or labels. - Clicking an empty time range opens the create form
with date and time prefilled.

**Day view** - Detailed hourly timeline for the selected date. - Show
all station schedules. - Allow the admin to filter to one station. -
Clicking an event opens its details.

**Navigation** - Previous/Next changes the visible period based on the
selected view. - Today returns to the current date. - Use the
Asia/Kolkata timezone for the calendar and schedule form unless the
application already has an explicit station timezone setting.

### 3.2 Schedule event display

Each event should show: - Schedule title. - Start and end time. -
Station name. - Publication status. - Optional category or programme
type.

Use consistent colours by station or category. Always include readable
text; colour must not be the only way to distinguish events.

### 3.3 Event actions

When an admin selects an existing event, open an event details panel or
modal with: - Full schedule information. - Assigned songs in playback
order. - Edit. - Reschedule. - Duplicate. - Publish/unpublish. - Delete.

Ask for confirmation before deleting. Warn before navigating away from
an unsaved form.

## 4. Create and Edit Schedule Form

Open the same form for creating and editing schedules.

### Required fields

1.  Schedule/programme name.
2.  Radio station.
3.  Schedule date.
4.  Start time.
5.  End time.
6.  At least one assigned song, if the programme is intended to play
    music.

### Additional fields

-   Description.
-   Category: Music, Talk Show, News, Special Programme, or configurable
    categories.
-   Artwork URL or selected artwork, if supported by the existing
    application.
-   Publication state: Draft or Published.
-   Admin notes.
-   Repeat option: Does not repeat, Daily, Weekly, or Custom (only
    implement recurring rules if the backend design supports them
    safely).

### Song selection

The admin should be able to: - Search songs by title or artist. - Select
from the existing track library or approved audio-source catalogue. -
Add multiple songs. - Reorder songs using drag-and-drop or up/down
controls. - Remove songs. - See title, artist, duration and source
status. - See the total estimated playlist duration.

Do not invent or scrape audio URLs. Use only sources the application is
permitted and configured to play. If the current project does not yet
have a song catalogue, implement the selection interface against a
clearly defined backend catalogue endpoint and document that the
catalogue/source integration is a prerequisite.

### Validation

-   Title is required.
-   Station is required.
-   Date is required.
-   Start and end times are required.
-   End must be later than start.
-   Reject invalid or empty song entries.
-   Validate that each selected song has a usable, permitted playback
    source before publishing a music schedule.
-   Show field-level validation messages.
-   Preserve entered values when the API returns a validation error.

## 5. Database Design

The existing `public.program_schedules` table contains: - `id` -
`station_id` - `title` - `description` - `start_time` - `end_time` -
`is_published` - `created_at`

Inspect the actual Supabase schema before applying migrations. Do not
assume a migration has altered an existing table simply because it uses
`CREATE TABLE IF NOT EXISTS`.

### 5.1 Schedule table additions

Add or confirm the following fields, using appropriate PostgreSQL
types: - `category` -- programme category. - `artwork_url` -- nullable
artwork reference, if required. - `status` --
draft/published/cancelled/completed, if a status model is adopted. -
`updated_at` -- last modification timestamp. - `created_by` -- nullable
or required admin user reference, depending on the existing users/auth
model. - `timezone` -- only if schedules need station-specific
timezones; otherwise use the application timezone consistently.

Store schedule start and end as `timestamptz` instants. The frontend
should display and edit them in the configured application timezone
(initially Asia/Kolkata). If the existing columns are `time` or
`timestamp without time zone`, plan and test a safe data migration
before changing them.

Do not store a date and time in unrelated columns without defining how
timezone conversion works.

### 5.2 New `schedule_tracks` table

Create a table to associate multiple songs with one programme:

  -----------------------------------------------------------------------
  Column                  Suggested type          Purpose
  ----------------------- ----------------------- -----------------------
  `id`                    bigint generated        Unique row
                          identity primary key    

  `schedule_id`           bigint, FK to           Parent programme
                          program_schedules(id)   

  `title`                 text                    Song title snapshot

  `artist`                text, nullable          Artist snapshot

  `album`                 text, nullable          Album snapshot

  `duration_seconds`      integer, nullable       Duration in seconds

  `stream_url`            text                    Approved playback
                                                  source

  `play_order`            integer                 Position in playlist

  `created_at`            timestamptz             Creation time
  -----------------------------------------------------------------------

Recommended constraints: - `schedule_id` references
`program_schedules(id) ON DELETE CASCADE`. - `play_order` must be
positive or zero according to the chosen ordering convention. - Add an
index on `(schedule_id, play_order)`. - Validate stream URLs
server-side. - If the application already has a canonical tracks table,
prefer a foreign key to that table and store only schedule-specific
ordering/metadata. Avoid duplicating canonical track data unnecessarily.

### 5.3 Recurrence (later phase)

Do not implement recurring schedules as a simple repeated event without
a data model. For a later phase, consider: - A recurrence rule or
recurrence series table. - Explicit timezone. - Exceptions/overrides for
individual dates. - A way to edit one occurrence or the entire series.

Deliver one-off schedules first.

## 6. Schedule Conflict Detection

Prevent overlapping schedules for the same station.

For a proposed schedule: - Find existing schedules for the same
`station_id`. - Ignore the current schedule ID during edits. - Treat an
overlap as: existing start is earlier than proposed end AND existing end
is later than proposed start. - Adjacent schedules are allowed. For
example, 09:00--10:00 and 10:00--11:00 do not overlap. - Decide whether
cancelled/deleted/draft schedules block time. Recommended initial rule:
published schedules block time; drafts may overlap but show a warning.
Confirm this product rule before implementation.

Perform conflict validation on the backend, not only in the browser.
Handle concurrent requests safely, ideally with a PostgreSQL exclusion
constraint on station and time range if the chosen schema and status
rules permit it. Otherwise use a transaction/locking strategy to avoid
race conditions.

Return a clear HTTP 409 conflict response with the conflicting
schedule's title and time range.

## 7. Backend API Requirements

Use the existing Express routes, authentication middleware, admin role
middleware and Supabase database adapter. Follow the project's existing
route naming and response conventions.

Suggested endpoints (adapt to existing endpoints rather than creating
duplicates):

  ------------------------------------------------------------------------------------------------------
  Method                  Endpoint                                               Purpose
  ----------------------- ------------------------------------------------------ -----------------------
  GET                     `/api/admin/schedules?from=...&to=...&stationId=...`   Fetch schedules for
                                                                                 visible calendar range

  GET                     `/api/admin/schedules/:id`                             Fetch schedule details
                                                                                 and ordered songs

  POST                    `/api/admin/schedules`                                 Create a schedule

  PUT/PATCH               `/api/admin/schedules/:id`                             Update schedule

  DELETE                  `/api/admin/schedules/:id`                             Delete schedule

  POST                    `/api/admin/schedules/:id/duplicate`                   Duplicate schedule

  PATCH                   `/api/admin/schedules/:id/publish`                     Publish/unpublish
                                                                                 schedule

  GET                     `/api/admin/songs/search?q=...`                        Search selectable
                                                                                 songs, if a catalogue
                                                                                 exists
  ------------------------------------------------------------------------------------------------------

Backend requirements: - Require admin authentication for all admin write
operations. - Validate all request fields and IDs. - Validate station
existence and active status according to product rules. - Validate
start/end ordering. - Validate song references and playback sources. -
Enforce schedule conflict rules. - Save schedule and associated songs
consistently, using a database transaction/RPC where appropriate. -
Return ordered songs by `play_order`. - Never trust frontend-provided
role, status or permission claims. - Do not send Supabase service-role
credentials to the browser. - Add pagination or bounded date ranges to
avoid fetching the entire schedule history.

## 8. Frontend Implementation

Build reusable components that match the current PulseCast design
system:

-   `AdminCalendarPage`
-   `CalendarToolbar`
-   `MonthCalendarView`
-   `WeekCalendarView`
-   `DayCalendarView`
-   `ScheduleEvent`
-   `ScheduleDetailsPanel`
-   `ScheduleFormModal`
-   `SongSearchPicker`
-   `SelectedSongList`
-   `StationFilter`
-   `ScheduleStatusBadge`
-   `DeleteScheduleDialog`

Implementation expectations: - Use the project's existing frontend
framework, router and styling approach. - Reuse the existing API client
and authentication handling. - Keep calendar state (visible date, view
mode, station filter) in the page. - Fetch only the visible date range
and refetch after successful mutations. - Show loading, empty, error and
success states. - Prevent double submissions. - Keep the interface
responsive for desktop and mobile. - Provide keyboard-accessible
controls and labels. - Use a maintained calendar component/library only
if compatible with the existing stack; otherwise implement the views
using the project's current UI conventions. - Avoid rewriting unrelated
player, station, login or user pages.

## 9. Automated Radio Playback -- Separate Phase

Calendar CRUD does not itself play audio. Automated playback is a
separate integration phase.

Target flow:

1.  Admin creates and publishes a schedule.
2.  Backend stores schedule and ordered songs in Supabase.
3.  A reliable scheduler/worker checks for schedules due to start.
4.  At the scheduled start time, the worker sends the playlist to the
    radio playback controller.
5.  Liquidsoap loads and plays the approved audio sources.
6.  Liquidsoap sends audio to Icecast.
7.  Listeners receive the station stream.
8.  Playback state and errors are recorded for admin visibility.

Requirements: - Use a reliable server-side scheduler, not browser
timers. - Avoid running duplicate schedulers across multiple Render
instances. - Use a durable job/claim mechanism so a schedule is not
started twice. - Handle missed starts after downtime according to a
defined policy. - Define what happens if a song URL fails. - Define what
happens when a playlist ends before the schedule end time. - Define
whether a currently playing programme can be interrupted. - Add playback
logs and a visible status such as Scheduled, Starting, Playing,
Completed, Failed. - Do not depend on an admin browser tab being open. -
EC2/Icecast/Liquidsoap must be running for the PulseCast AWS stream to
be audible.

Do not mark a schedule as Playing until the playback service confirms
that it started.

## 10. Security and Reliability

-   Keep Supabase secret/service-role keys only in Render environment
    variables.
-   Keep RLS enabled and review policies for new tables.
-   Allow schedule writes only through authenticated admin backend
    routes.
-   Validate and sanitize all user input.
-   Restrict playable URLs to approved providers/storage domains or an
    explicit allowlist.
-   Avoid arbitrary server-side URL fetching, which can create SSRF
    risk.
-   Use HTTPS for API and stream URLs where supported.
-   Log operational errors without logging passwords, JWTs or secret
    keys.
-   Add tests for authorization, validation, conflicts, timezones and
    schedule/song consistency.

## 11. Testing Checklist

### Calendar UI

-   Month, Week and Day views render.
-   Previous, Next and Today navigation work.
-   Clicking a date/time pre-fills the create form.
-   Existing events display correct title, station and time.
-   Station/status filters work.
-   Layout works on desktop and mobile.

### Schedule CRUD

-   Admin can create, view, edit, duplicate and delete schedules.
-   Non-admin users cannot access admin mutations.
-   Invalid dates/times are rejected.
-   End time must be after start time.
-   Songs are saved in the selected order.
-   Deleting a schedule handles associated schedule_tracks according to
    cascade rules.
-   Publishing/unpublishing works.

### Conflicts and timezones

-   Same-station overlapping published schedules are rejected.
-   Adjacent schedules are accepted.
-   Different stations may have overlapping schedules.
-   Editing does not conflict with itself.
-   Asia/Kolkata display and storage conversions are correct.
-   Daylight-saving edge cases are not relevant to the initial
    India-only timezone, but timezone-aware storage should still be
    used.

### Production integration

-   Render health endpoint remains healthy and reports Supabase.
-   Frontend reads schedules through the Render API.
-   No Supabase secret is present in frontend bundles or Git history.
-   Existing login, stations, favourites and player still work.
-   Calendar CRUD works while EC2 is stopped.
-   Automated playback is tested separately when EC2, Liquidsoap and
    Icecast are running.

## 12. Recommended Delivery Phases

### Phase 1 -- Calendar interface

-   Inspect current admin dashboard and schedule APIs.
-   Implement Month, Week and Day views.
-   Add date navigation, station filter and event display.
-   No database schema change unless required for current schedule data.

### Phase 2 -- Schedule management

-   Build create/edit/details forms.
-   Connect existing schedule CRUD APIs.
-   Add duplicate, publish/unpublish and delete actions.
-   Add frontend and backend validation.

### Phase 3 -- Songs per schedule

-   Inspect existing track model and audio-source workflow.
-   Add `schedule_tracks` or link to the existing canonical track table.
-   Implement song search, selection, ordering and duration display.
-   Add transactional schedule/track persistence.

### Phase 4 -- Conflict protection and hardening

-   Implement server-side overlap checks.
-   Add concurrency-safe protection.
-   Test timezone conversions and permissions.
-   Add audit/error handling.

### Phase 5 -- Automated playback

-   Design and implement durable server-side scheduling.
-   Integrate schedule execution with Liquidsoap.
-   Add playback confirmation, failure handling and logs.
-   Test with the EC2 stream server running.

## 13. Implementation Rules for the Developer / Antigravity

1.  First inspect the existing repository, admin dashboard, routes,
    database adapter, schema and authentication middleware.
2.  Produce a short mapping of existing files and APIs before editing.
3.  Reuse existing working functionality wherever possible.
4.  Do not replace the database or authentication architecture.
5.  Do not introduce MySQL dependencies.
6.  Do not hardcode secrets, credentials, station IDs or stream URLs.
7.  Do not create duplicate API routes or duplicate schedule tables if
    equivalent structures already exist.
8.  Write migrations that safely alter the existing Supabase schema and
    can be applied deliberately.
9.  Implement and test one phase at a time.
10. After each phase, report changed files, database migrations,
    endpoints, tests run and any remaining prerequisites.
11. Do not claim automated playback is implemented until Liquidsoap
    integration has been tested end-to-end.
12. Preserve the existing public radio player and station experience.

## 14. Definition of Done

The calendar redesign is complete when an authenticated admin can: -
Open a Google Calendar-style Month, Week and Day calendar. - Navigate
dates and filter stations. - Create a programme by selecting a date and
time period. - Enter programme details and assign multiple songs in
order. - Save, edit, duplicate, publish/unpublish, reschedule and delete
programmes. - See clear conflict warnings for overlapping schedules on
the same station. - Reliably view saved schedules after refresh and from
another browser.

Automated playback is complete only when a published schedule starts the
correct playlist through Liquidsoap/Icecast at the intended time and the
system records the actual playback result.
