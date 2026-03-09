# PaceUp — Social Running App

## Overview
PaceUp is a mobile-first social running application designed to connect runners, facilitate group runs, and track personal fitness goals. It aims to foster a vibrant community by offering features like interactive run discovery, live group tracking, personalized solo run coaching, and social engagement through crews and shared achievements. The project's vision is to become a leading platform for runners to organize, participate in, and celebrate their running journeys together.

## User Preferences
I prefer that the agent focuses on iterative development, delivering functional components rather than extensive, perfect solutions from the start. Prioritize clear, concise communication, and ask clarifying questions if anything is unclear. I also prefer that the agent provides regular updates on progress and potential challenges.

## System Architecture

### Frontend
The application is built using Expo React Native (SDK 54) with Expo Router for file-based navigation. Server state is managed with React Query, while user authentication state uses React Context. Custom fonts are sourced from `@expo-google-fonts/outfit`. Mapping functionalities are handled by `react-native-maps` (pinned to 1.18.0). The UI/UX supports both dark and light themes via `ThemeContext` + `makeStyles(C)` pattern throughout all screens. Key constants: primary `#00D97E`, bg `#050C09`, surface `#0D1510`, card `#132019`, gold `#FFB800`.

### Backend
The backend is an Express.js application written in TypeScript, using `tsx` for execution. PostgreSQL is the chosen database, accessed directly via the `pg` pool without an ORM. Authentication is managed using `express-session` with `connect-pg-simple` for session storage and `bcryptjs` for password hashing. The server operates on port 5000.

### Core Features
1.  **Authentication:** Standard email/password login and registration with session persistence.
2.  **Run & Ride Management:** Users can discover, join, create, and complete group runs and rides. Eligibility checks apply for joining. Hosts require prior activity to unlock hosting capabilities.
3.  **Mapping & Discovery:** Interactive map displays run pins, live run indicators, and community-contributed route polylines. A comprehensive run discovery list supports searching and filtering.
4.  **Solo Running/Riding:** Features personal pace/distance goal tracking, performance rankings (gold/silver/bronze PR tiers), planned runs with local notifications, and an audio pace coach using TTS (with ride-aware phrases). Users can save GPS-tracked routes and use them as ghost overlays for future runs. Done screen shows PR banner, elevation gain, move time, and step count.
5.  **Live Group Runs:** Hosts can start runs, enabling real-time GPS tracking of participants, live map updates, and an integrated chat system. Post-run, a leaderboard ranks participants by pace.
6.  **Live Spectator View (`app/run-spectate/[id].tsx`):** Tapping a LIVE event card in the discover feed opens a read-only full-screen map showing the host's route polyline (from `GET /api/runs/:id/host-route`), colored participant dots at their current positions, and a floating stats panel (# in, avg distance, lead pace). Polls every 5–10s. Shows ended state / pre-start state. Web shows a placeholder.
7.  **Social Features:**
    *   **Crews:** Create/join crews, invite users, view crew-specific runs, and engage in persistent crew chats.
    *   **Crew Achievements:** Milestone badges (miles/events/members) tracked at the crew level. Auto-post system messages to crew chat when a milestone is crossed. Shown as colored badge tiles with progress bars in the crew detail panel (`crew_achievements` table).
    *   **Personal Achievements:** Personal mileage badges.
    *   **Ratings:** Participants can rate run hosts.
    *   **Friendships:** Bidirectional friend management with 1:1 DMs.
    *   **Notifications:** Aggregated system for friend requests, crew invites, and run join requests.
8.  **Event Photos:** Participants can add photos to both solo and group runs (via `expo-image-picker`). Photos shown in a horizontal scroll gallery in the run detail screen and the run-results screen. Full-screen modal viewer. Stored in object storage.
9.  **Mile Splits:** Auto-recorded per-mile splits shown as a chart on the done screen and in run history.
10. **Content Sharing:** Users can share run/ride activities via branded cards with optional photo backgrounds and captions, utilizing native sharing sheets. Screenshot detection triggers the share sheet automatically.
11. **Garmin Connect OAuth:** Users can link their Garmin account from the profile screen.

### Theming Pattern
All screens use `useTheme()` → `const { C } = useTheme()` → `const s = useMemo(() => makeStyles(C), [C])` where `makeStyles` is a module-level function taking `ColorScheme`. The `constants/colors.ts` default export is `lightColors`; `darkColors` is the dark variant. Both are typed as `ColorScheme`.

### Run vs Ride Awareness
- `activityFilter` from `useActivity()` drives run/ride mode in tracking screens
- Audio coach phrases adapt to "Riding" / "ridden" / "ride" for ride mode
- UI labels throughout the app check `activity_type === "ride"` for display strings
- PR tiers say "Longest Ride" / "Longest Run" appropriately
- Screenshot share emoji is 🚴 for rides, 🏃 for runs

### Data Model
The database schema includes tables for: `users`, `runs`, `run_participants`, `run_completions`, `run_tracking_points`, `host_ratings`, `solo_runs`, `saved_paths`, `community_paths`, `crews`, `crew_members`, `crew_messages` (user_id nullable for system posts), `run_messages`, `achievements`, `friends`, `live_pings`, `run_photos`, `crew_achievements`.

Key columns: `runs.activity_type` ("run" | "ride"), `runs.is_active`, `runs.is_completed`, `runs.host_id`, `runs.location_lat/lng`. `solo_runs.step_count`, `solo_runs.move_time_seconds`, `solo_runs.elevation_gain`.

### API — Key Endpoints
- `GET /api/runs/:id/live` — live participant positions + stats (no auth required)
- `GET /api/runs/:id/host-route` — host's GPS breadcrumbs for polyline (no auth required)
- `GET /api/runs/:id/results` — post-run leaderboard
- `GET /api/runs/:id/photos` — event photos
- `POST /api/runs/:id/runner-finish` — finalizes participant result + triggers crew achievement check
- `GET /api/crews/:id/achievements` — crew milestone badges + stats
- `POST /api/solo-runs` — saves solo run, returns `prTiers` for PR banner

### Recent Bug Fixes (Session March 2026)
- `app/(tabs)/index.tsx`: `Run` interface now includes `is_completed: boolean` and `plan_count: string`; `notifications` query typed as `any[]`
- `app/run-live/[id].tsx`: Moved `liveState` useQuery declaration above the `useEffect` that depends on it (fixes TDZ/used-before-declaration runtime error)
- `app/_layout.tsx`: Added `as any` cast to notification handler return to fix type mismatch with expo-notifications v5
- `app/run-tracking.tsx`: Fixed vehicle notification ID capture to handle `string | undefined` return
- `app/create-run/index.tsx`: Removed duplicate function declarations (`autoFormatTime`, `handleDateChange`, `handleTimeChange`); fixed router.replace type
- `app/run/[id].tsx`: Fixed router.replace type cast for `"/(tabs)/"`
- `app/(tabs)/crew.tsx`: Fixed `removeMemberMutation` to invalidate `["/api/crews", crew?.id]` (the actual cache key) instead of the non-existent `[..., "members"]` sub-key

## External Dependencies
-   **PostgreSQL:** Primary database for all application data.
-   **Google Cloud Storage (GCS) / Object Storage:** Used for storing run photos.
-   **expo-speech:** For text-to-speech functionality in the audio pace coach.
-   **react-native-maps:** For interactive map functionalities (pinned to 1.18.0).
-   **@expo-google-fonts/outfit:** For custom font assets.
