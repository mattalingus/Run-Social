# PaceUp — Social Running App

## Overview
PaceUp is a mobile-first social running application designed to connect runners, facilitate group runs, and track personal fitness goals. It aims to foster a vibrant community by offering features like interactive run discovery, live group tracking, personalized solo run coaching, and social engagement through crews and shared achievements. The project's vision is to become a leading platform for runners to organize, participate in, and celebrate their running journeys together.

## User Preferences
I prefer that the agent focuses on iterative development, delivering functional components rather than extensive, perfect solutions from the start. Prioritize clear, concise communication, and ask clarifying questions if anything is unclear. I also prefer that the agent provides regular updates on progress and potential challenges.

## System Architecture

### Frontend
The application is built using Expo React Native (SDK 54) with Expo Router for file-based navigation. Server state is managed with React Query, while user authentication state uses React Context. Custom fonts are sourced from `@expo-google-fonts/outfit`. Mapping functionalities are handled by `react-native-maps`. The UI/UX features a dark theme with a specific color palette (`#080F0C` for background, `#00D97E` for primary actions) and includes liquid glass effects for tab bars. Key UI elements include circular profile markers with glow rings on maps, and a "Runs | Paths" mode toggle for map views.

### Backend
The backend is an Express.js application written in TypeScript, using `tsx` for execution. PostgreSQL is the chosen database, accessed directly via the `pg` pool without an ORM. Authentication is managed using `express-session` with `connect-pg-simple` for session storage and `bcryptjs` for password hashing. The server operates on port 5000.

### Core Features
1.  **Authentication:** Standard email/password login and registration with session persistence.
2.  **Run Management:** Users can discover, join, create, and complete runs. Eligibility checks apply for joining. Hosts require prior activity to unlock hosting capabilities.
3.  **Mapping & Discovery:** Interactive map displays run pins, live run indicators, and community-contributed route polylines. A comprehensive run discovery list supports searching and filtering.
4.  **Solo Running:** Features personal pace/distance goal tracking, performance rankings, planned runs with local notifications, and an audio pace coach using TTS. Users can save GPS-tracked routes and use them as ghost overlays for future runs.
5.  **Live Group Runs:** Hosts can start runs, enabling real-time GPS tracking of participants, live map updates, and an integrated chat system. Post-run, a leaderboard ranks participants by pace.
6.  **Social Features:**
    *   **Crews:** Create/join crews, invite users, view crew-specific runs, and engage in persistent crew chats.
    *   **Achievements:** Personal mileage badges and collective crew achievements with progress tracking and in-chat milestone announcements.
    *   **Ratings:** Participants can rate run hosts.
    *   **Friendships:** Bidirectional friend management.
    *   **Notifications:** Aggregated system for friend requests, crew invites, and run join requests.
7.  **Content Sharing:** Users can share run activities (solo or group) via branded cards with optional photo backgrounds and captions, utilizing native sharing sheets.
8.  **Photos:** Users can add photos to both solo and group runs, which are stored in object storage and displayed within the app.

### Data Model
The database schema includes tables for `users`, `runs`, `run_participants`, `run_completions`, `host_ratings`, `solo_runs`, `saved_paths`, `community_paths`, `crews`, `crew_members`, `crew_messages`, `run_messages`, `achievements`, `friends`, `live_pings`, and `run_photos`.

### API
A RESTful API provides endpoints for user authentication, profile management, run creation and participation, solo run tracking, crew management, messaging, and fetching various app data.

## External Dependencies
-   **PostgreSQL:** Primary database for all application data.
-   **Google Cloud Storage (GCS) / Object Storage:** Used for storing run photos.
-   **expo-speech:** For text-to-speech functionality in the audio pace coach.
-   **react-native-maps:** For interactive map functionalities.
-   **@expo-google-fonts/outfit:** For custom font assets.