# PaceUp — Social Running App


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
    profile.tsx        - User profile, goals, achievements, history
  run/
    [id].tsx           - Run detail screen (join, leave, complete, rate)
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
2. **Map Discovery** - Interactive map with run pins (react-native-maps)
3. **Run Discovery** - Searchable list with tag filtering
4. **Join Runs** - Eligibility checks based on pace & distance
5. **Host Unlock** - Requires 3 runs with 2+ different hosts
6. **Create Runs** - Host-only form for public/private/solo runs
7. **Run Completion** - Log miles, update stats, check achievements
8. **Achievements** - Badges at 25, 100, 250, 500, 1000 miles
9. **Host Ratings** - 1-5 stars + feedback tags
10. **Mileage Goals** - Monthly & yearly goals with progress bars
11. **Solo Tab** - Personal run tracking: pace/distance goals, performance rankings by distance category (1mi/2mi/5K/5mi/10K), plan future runs with local push notifications

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

## Future Integrations (Structured)
Database columns exist for: `strava_id`, `apple_health_id`, `garmin_id`

## Development Notes
- React Native Maps requires react-native-maps@1.18.0 (Expo Go compatible)
- Session cookies use sameSite: "lax" in development, "none" in production
- All API calls use `credentials: "include"` for session cookies
