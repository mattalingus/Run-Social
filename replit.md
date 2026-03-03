# FARA — Social Running App


## Overview
A mobile-first social running application built with Expo React Native and a Node.js/PostgreSQL backend.

## Architecture

### Frontend (Expo / React Native)
- **Framework**: Expo SDK 54, Expo Router (file-based routing)
- **State**: React Query for server state, React Context for auth
- **Fonts**: @expo-google-fonts/outfit
- **Maps**: react-native-maps@1.18.0

### Backend (Express + PostgreSQL)
- **Server**: Express.js with TypeScript (tsx)
- **Database**: PostgreSQL via `pg` pool (raw SQL, no ORM)
- **Auth**: express-session with connect-pg-simple store, bcryptjs for password hashing
- **Port**: 5000
- **Seed data**: `server/seed.ts` — auto-seeds 15 Houston runs on startup if DB is empty; `POST /api/admin/seed-runs` regenerates 20 runs

## App Structure
```
app/
  _layout.tsx          - Root layout (auth guard, fonts, providers)
  (auth)/
    _layout.tsx        - Auth modal stack
    login.tsx          - Login screen
    register.tsx       - Register screen
  (tabs)/
    _layout.tsx        - Tab bar (Map, Discover, Solo, Profile) with liquid glass
    index.tsx          - Map home screen (Houston default, circular profile markers, glow ring, bounce animation)
    index.web.tsx      - Web fallback (list view, no maps)
    discover.tsx       - Run discovery with search & filter
    solo.tsx           - Solo running: goal tracker, performance rankings, plan runs + local notifications
    crew.tsx           - Crew tab: create/join crews, invite users, view upcoming crew runs filtered by activity type
    profile.tsx        - User profile, goals, achievements, history
  run/
    [id].tsx           - Run detail screen (join, leave, complete, rate, host start/view live)
  run-live/
    [id].tsx           - Live group run screen (GPS tracking, live participant dots on map, present toast)
  run-results/
    [id].tsx           - Post-run leaderboard (ranked by pace, gold/silver/bronze badges)
  create-run/
    index.tsx          - Create run form (host only)
  rate/
    [runId].tsx        - Rate host after completed run
contexts/
  AuthContext.tsx      - Authentication state management
constants/
  colors.ts            - Dark theme color palette
server/
  index.ts             - Express app setup
  routes.ts            - All API routes
  storage.ts           - Database operations
shared/
  schema.ts            - Drizzle schema definitions
```

## Color Palette (Dark Theme)
- Background: `#080F0C` (very dark forest green-black)
- Surface: `#111A15`
- Card: `#1A2E21`
- Primary: `#00D97E` (vibrant mint green)
- Orange: `#FF6B35` (pace indicators)
- Blue: `#4DA6FF` (distance indicators)
- Gold: `#FFB800` (ratings, achievements)

## Key Features
1. **Auth** - Email/password login & registration with session persistence
2. **Map Discovery** - Interactive map with run pins (react-native-maps); LIVE badge + green ring on active runs; "Runs | Paths" mode toggle to switch between run event pins and community route polylines
3. **Run Discovery** - Searchable list; Sort by is inside the filter sheet; header has Filter | Host | Notifications bell
4. **Join Runs** - Eligibility checks based on pace & distance
5. **Host Unlock** - Requires 3 runs with 2+ different hosts
6. **Create Runs** - Host-only form for public/private/solo runs
7. **Run Completion** - Log miles, update stats, check achievements
8. **Achievements** - Badges at 25, 100, 250, 500, 1000 miles
9. **Host Ratings** - 1-5 stars + feedback tags
10. **Mileage Goals** - Monthly & yearly goals with progress bars
11. **Solo Tab** - Personal run tracking: pace/distance goals, performance rankings by distance category (1mi/2mi/5K/5mi/10K), plan future runs with local push notifications
12. **Audio Pace Coach** - TTS announcements during solo runs (expo-speech); configurable interval (0.5/1/2 miles); on/off toggle in pre-run settings; announces distance + pace + elapsed time
13. **Live Group Run Mode** - Host starts run (must be within 1km of pin), runners auto-marked present via GPS ping, live participant dots on shared map (polling every 5s), own path polyline + stats; "Finish My Run" saves final pace & distance, triggers leaderboard ranking; **Map|Chat tab toggle** — participants auto-enrolled in live chat (run_messages table, poll every 5s)
14. **Saved Paths** - After a solo GPS run, save the route as a named path. Saved paths appear in Solo tab with mini-map previews. When starting a new solo run, select a saved path to show as a faint ghost overlay on the live map.
15. **Bookmark & Plan** - Bookmark any run from the map, detail page, or discover list. "Plan to Attend" signals soft interest in future runs. Discover tab shows "Saved Runs" horizontal scroll section. Plan count shown on run detail.
16. **Community Route Library** - First runner to complete a GPS route can publish it with a custom name (POST /api/solo-runs/:id/publish-route). Published routes (is_public=true) appear as green polylines on the map in Paths mode. Tap a polyline to see path details + "Start Run Here".
17. **Crew Chat** - Per-crew persistent group chat (crew_messages table); separate screen app/crew-chat/[id].tsx; inverted FlatList bubbles; 5s polling; accessible via chat icon on each crew card.
18. **Notifications** - Bell icon in discover header; panel shows pending friend requests, crew invites, and join requests to hosted runs; aggregated from existing tables (no new table); 30s polling badge count.
19. **Run Photos** - After completing a solo run (save → optionally add photo before navigating away), or anytime on a past group run detail page. Group run photos are visible to all; solo run photos accessible by tapping any completed run in history. Photos stored in object storage (GCS).

## Database Tables
- `users` - Auth, profile, goals, stats
- `runs` - Group runs with location, pace, distance requirements
- `run_participants` - Who joined each run
- `run_completions` - Confirmed attendance log
- `host_ratings` - Star ratings + feedback for run hosts  
- `solo_runs` - GPS-tracked personal runs with route_path JSONB
- `saved_paths` - Named GPS routes saved by users for future reference
- `community_paths` - User-published GPS routes (is_public=true when first runner publishes via publish-route endpoint)
- `crew_messages` - Per-crew chat messages (crew_id, user_id, sender_name, message, created_at)
- `run_messages` - Live event chat messages (run_id, user_id, sender_name, message, created_at)
- `path_contributions` - Junction: links users/saved_paths to community_paths
- `bookmarked_runs` - User run bookmarks
- `planned_runs` - Soft "planning to attend" commitments
- `achievements` - Milestone badges (25/100/250/500/1000 miles)
- `friends` - Bidirectional friendship graph
- `live_pings` - GPS coords during live group run
- `run_photos` - Photos attached to group runs (user uploaded, multiple per run)
- `solo_run_photos` - Photos attached to solo runs

## Live Run DB Schema
- `runs.is_active` — run has been started by host
- `runs.started_at` — timestamp when host started the run
- `run_participants.is_present` — auto-set when participant pings within 1km of pin while run is active
- `run_participants.final_distance, final_pace, final_rank` — set when runner finishes
- `run_tracking_points` — GPS pings (run_id, user_id, lat/lng, cumulative_distance, pace, recorded_at)

## API Routes
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user
- `PUT /api/users/me` - Update profile (pace, distance, etc.)
- `PUT /api/users/me/goals` - Update mileage goals
- `GET /api/users/me/achievements` - Get user achievements
- `GET /api/users/me/unlock-progress` - Host unlock progress
- `GET /api/runs` - Get public upcoming runs (with filters)
- `GET /api/runs/mine` - Get user's run history
- `POST /api/runs` - Create a run (host only)
- `GET /api/runs/:id` - Get run details
- `GET /api/runs/:id/participants` - Get participants
- `POST /api/runs/:id/join` - Join a run (with eligibility check)
- `POST /api/runs/:id/leave` - Leave a run
- `POST /api/runs/:id/complete` - Log run completion
- `POST /api/runs/:id/rate` - Rate host
- `GET /api/runs/:id/my-rating` - Get user's rating for this run
- `GET /api/solo-runs` - Get user's solo run history (auth required)
- `POST /api/solo-runs` - Create a solo run (planned or completed)
- `PUT /api/solo-runs/:id` - Update a solo run
- `DELETE /api/solo-runs/:id` - Delete a solo run
- `PUT /api/users/me/solo-goals` - Update pace/distance goals + goal period
- `POST /api/runs/:id/start` - Host starts the live run (marks nearby participants present, sets is_active=true)
- `POST /api/runs/:id/ping` - Runner posts GPS location during live run (marks present if within 1km, stores tracking point)
- `GET /api/runs/:id/live` - Get live run state (is_active, present participants + their latest positions)
- `POST /api/runs/:id/runner-finish` - Runner ends their run (stores final_distance, final_pace, recomputes ranks)
- `GET /api/runs/:id/results` - Get leaderboard for completed run (ranked by pace)
- `GET /api/runs/:id/photos` - Get all photos for a group run
- `POST /api/runs/:id/photos` - Upload a photo to a group run (host or participant only, multipart/form-data)
- `DELETE /api/runs/:id/photos/:photoId` - Delete a photo (owner only)
- `GET /api/solo-runs/:id/photos` - Get photos for a solo run (auth required, owner only)
- `POST /api/solo-runs/:id/photos` - Upload a photo to a solo run (auth required, multipart/form-data)
- `DELETE /api/solo-runs/:id/photos/:photoId` - Delete a solo run photo (owner only)

## Audio Pace Coach
- `expo-speech` installed (Expo Go compatible TTS)
- Toggle + interval selector (0.5 mi / 1 mi / 2 mi) in pre-run UI of `app/run-tracking.tsx`
- Persisted via AsyncStorage: `@fara_coach_enabled`, `@fara_coach_interval`
- Fires `Speech.speak()` at each milestone; `Speech.stop()` on pause/stop
- Guarded with `Platform.OS !== 'web'` — no web crash

## Crew Chat
- `crew_messages` table: id, crew_id, user_id, sender_name, sender_photo, message, message_type ('text'|'prompt'|'milestone'), metadata JSONB, created_at
- `GET /api/crews/:id/messages` — members only, newest-first
- `POST /api/crews/:id/messages` — members only
- `app/crew-chat/[id].tsx` — inverted FlatList, prompt bubbles with quick-reply chips, milestone gold cards, 5s polling
- Access via chat icon on each crew card in crew.tsx

## Live Event Chat
- `run_messages` table: id, run_id, user_id, sender_name, sender_photo, message, created_at
- `GET /api/runs/:id/messages` — participants/host only
- `POST /api/runs/:id/messages` — participants/host only
- `app/run-live/[id].tsx` gets "Map | Chat" tab toggle; unread dot badge on Chat tab; presence guard for non-arrived users

## Community Route Library
- `community_paths` table gets: is_public, created_by_user_id, created_by_name, run_count, activity_type
- `GET /api/community-paths` returns `is_public = true` paths
- `POST /api/solo-runs/:id/publish-route` — publish GPS path with custom name
- `app/run-tracking.tsx` — "Publish Route" button in post-run done screen (native only)
- `app/map.tsx` — "Runs | Paths" mode toggle; Paths mode shows green polylines, tappable detail sheet

## Discover Header Redesign + Notifications
- Sort by removed from header → moved into filter sheet (top section with 4 pills: Soonest/Nearest/Distance↑/Distance↓)
- Header order: Filter (sliders) | Host (+) | Notifications Bell
- Bell shows primary-color dot badge when `notifCount > 0`; polls every 30s
- `GET /api/notifications` aggregates: pending friend requests, pending crew invites, pending join requests to user's runs
- Slide-up notification panel groups by type with Accept/Decline/Approve/Deny action buttons
- Mute chat toggle on crew detail modal (bell icon + "Mute chat" text in close-button row)

## Future Integrations (Structured)
Database columns exist for: `strava_id`, `apple_health_id`, `garmin_id`

## Share Activity Feature
- `components/ShareCard.tsx` — always-dark branded card (360×640pt) with FARA branding, SVG GPS route, stats row, group badge, caption, footer strip. forwardRef for captureRef capture. Supports optional photo background for route panel.
- `components/ShareActivityModal.tsx` — full-screen modal: card preview, photo background picker (ImagePicker), caption input (live updates card), Share/Save/Copy actions using captureRef + native Share sheet.
- Integrated in `app/run-tracking.tsx` (solo run post-save) and `app/run-results/[id].tsx` (group results header).

## Metro Config Notes
- `metro.config.js` stubs `expo-sharing` → `stubs/expo-sharing.js` (uses React Native `Share` API) and `expo-media-library` → `stubs/expo-media-library.js` (uses native share sheet for saves). These v55 packages shipped ESM-only builds incompatible with Metro for SDK 54.
- `transformIgnorePatterns` overridden to include `react-native-view-shot` for Babel transpilation (Flow ESM source).
- `react-native-maps` is stubbed on web platform via `stubs/react-native-maps.js`.

## Development Notes
- React Native Maps requires react-native-maps@1.18.0 (Expo Go compatible)
- Session cookies use sameSite: "lax" in development, "none" in production
- All API calls use `credentials: "include"` for session cookies
