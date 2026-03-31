# PaceUp — Social Running App

## Overview
PaceUp is a mobile-first social running application designed to connect runners, facilitate group runs, and track personal fitness goals. It aims to foster a vibrant community by offering features like interactive run discovery, live group tracking, personalized solo run coaching, and social engagement through crews and shared achievements. The project's vision is to become a leading platform for runners to organize, participate in, and celebrate their running journeys together.

## User Preferences
I prefer that the agent focuses on iterative development, delivering functional components rather than extensive, perfect solutions from the start. Prioritize clear, concise communication, and ask clarifying questions if anything is unclear. I also prefer that the agent provides regular updates on progress and potential challenges.

**Always push an OTA update (`CI=1 EAS_SKIP_AUTO_FINGERPRINT=1 EXPO_TOKEN=$EXPO_TOKEN npx eas-cli@latest update --channel production --message "..."`) at the end of every completed task, before marking it done.** The user uses the App Store version of PaceUp and relies on OTA updates to see changes.

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
    *   **Friend Discovery:** Find friends via contacts (phone hash matching with SHA-256, `lib/contactsDiscovery.ts`). Facebook friend discovery shown as "Coming soon". Accessible from profile "Find Friends" button.
    *   **Notifications:** Aggregated system for friend requests, crew invites, and run join requests.
8.  **Event Photos:** Participants can add photos to both solo and group runs (via `expo-image-picker`). Photos shown in a horizontal scroll gallery in the run detail screen and the run-results screen. Full-screen modal viewer. Stored in object storage.
9.  **Mile Splits:** Auto-recorded per-mile splits shown as a chart on the done screen and in run history.
10. **Content Sharing:** Users can share run/ride activities via branded cards with optional photo backgrounds and captions, utilizing native sharing sheets. Screenshot detection triggers the share sheet automatically.
11. **Garmin Connect OAuth:** Users can link their Garmin account from the profile screen.
12. **Apple Health Integration:** Users can connect Apple Health from Settings to import runs, rides, and walks. The HealthKit module (`lib/healthKit.ts`) requests workout permissions and fetches activities. Backend endpoint `POST /api/health/import` deduplicates via `apple_health_id` on `solo_runs`. Requires native rebuild for HealthKit native module to function; frontend gracefully falls back with an "update required" message in Expo Go/web.
13. **Activity Source Tracking:** `solo_runs.source` column tracks origin ('manual', 'garmin', 'apple_health'). Source badges (Garmin satellite dish / Apple Health heart) shown in solo history alongside run titles.

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

Key columns: `runs.activity_type` ("run" | "ride"), `runs.is_active`, `runs.is_completed`, `runs.host_id`, `runs.location_lat/lng`. `solo_runs.step_count`, `solo_runs.move_time_seconds`, `solo_runs.elevation_gain`, `solo_runs.ai_summary`.

`users.phone_hash` — SHA-256 hash of normalized phone number for contacts-based friend discovery.
`users.facebook_id` — reserved for future Facebook friend discovery integration.
`users.gender` ("Man" | "Woman" | "Prefer not to say") — controls buddy-finder visibility.
`crews.current_streak_weeks`, `crews.last_run_week`, `crews.home_metro`, `crews.home_state`, `crews.last_overtake_notif_at` — for competitive crew features.

### Buddy Finder
- Gender field on users: Man / Woman / Prefer not to say (registered or edited in profile)
- `GET /api/users/buddy-suggestions` — returns up to 10 same-gender users to connect with
- "Find a Buddy" horizontal scroll section on Solo tab (hidden for non-Man/Woman users)
- "Find a Training Partner" card on Discover empty state (same gender gate)

### Crew Competitive Features
- Weekly activity streak tracked per crew; milestone system messages at 4/8/12/26/52 weeks
- Crew Rankings modal with National / State / Local tabs (`GET /api/crews/rankings?type=national|state|metro`)
- Metro area lookup in `server/metro-areas.ts`; crews optionally set `home_metro` + `home_state`
- Overtake notifications: when a crew improves rank, the overtaken crew gets a PaceUp Bot message (1hr cooldown)

### Crew Subscriptions & Discovery Boost
- Two paid tiers via RevenueCat: `crew_growth_monthly` ($1.99) and `crew_discovery_boost_monthly` ($4.99)
- `crews.subscription_tier` column: `none` | `growth` | `discovery_boost` | `both`
- Free crews capped at 100 members; Growth tier removes cap (enforced in join-request accept + invite accept)
- Discovery Boost gives ~30% score lift in suggested crews algorithm
- `PurchasesContext` (`contexts/PurchasesContext.tsx`) provides `purchasePackage`, `restorePurchases`, `hasEntitlement` — currently stubbed (needs real RevenueCat API keys + `react-native-purchases` installed for native builds)
- Crew Plans UI in CrewDetailSheet (crew chief only): shows plan cards with subscribe buttons
- Member cap upsell modal (`MemberCapUpsell`) triggered when crew chief hits MEMBER_CAP_REACHED
- Suggested Crews section: horizontal scroll on crew screen for users with <3 crews (`GET /api/crews/suggested`)
- Public crew events visible on discover page with crew badges (emoji + name)
- RevenueCat webhook endpoint: `POST /api/webhooks/revenuecat`
- Subscription management: `GET/POST /api/crews/:id/subscription`

### OpenAI AI Features (requires OPENAI_API_KEY secret)
- `server/ai.ts` — typed helpers: `generateRunSummary`, `generateCrewRecap`, `generateSearchFilters`, `generateWeeklyInsight`, `generateTTS`
- Post-run AI summary card on solo results screen (`POST /api/solo-runs/:id/ai-summary`)
- Audio coach TTS: `POST /api/tts` → OpenAI alloy voice → saved to device cache, played via expo-av; fallback to expo-speech
- Natural language search on Discover (`POST /api/runs/search-ai`) — overlays AI-derived pace/distance/tag filters
- AI pace group suggestion badge on run detail screen (frontend-only)
- Weekly summary insight uses `generateWeeklyInsight`

### API — Key Endpoints
- `GET /api/runs/:id/live` — live participant positions + stats (no auth required)
- `GET /api/runs/:id/host-route` — host's GPS breadcrumbs for polyline (no auth required)
- `GET /api/runs/:id/results` — post-run leaderboard
- `GET /api/runs/:id/photos` — event photos
- `POST /api/runs/:id/runner-finish` — finalizes participant result + triggers crew achievement check
- `GET /api/crews/:id/achievements` — crew milestone badges + stats
- `POST /api/solo-runs` — saves solo run, returns `prTiers` for PR banner

### Onboarding Walkthrough
- Full 16-step tap-through onboarding walkthrough for new users (`contexts/WalkthroughContext.tsx`, `components/WalkthroughOverlay.tsx`)
- Auto-triggers on first login; persisted via AsyncStorage (`@paceup_walkthrough_completed`)
- Step 1 is a full-screen branded welcome card; steps 2-16 are tooltip overlays with semi-transparent backdrop
- Each step auto-navigates to the correct tab (Discover/Solo/Crew/Profile) via `router.replace`
- Skip available at every step; Done button on final step
- Step config defined in `lib/walkthroughConfig.ts`; mock data stubs in `lib/walkthroughMockData.ts`

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
