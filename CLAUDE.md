# PaceUp — Run-Social

Expo (React Native) fitness/social app. Live on App Store (iOS) and in Play Store review (Android).

## Stack
- **Frontend**: Expo SDK 54, expo-router, React 19, TypeScript
- **Backend**: Express server (`server/`) with Postgres via Drizzle ORM
- **OTA updates**: Expo Updates + EAS (`eas update`)
- **Builds**: EAS Build (`eas build`)
- **Storage**: Google Cloud Storage for photos (`server/objectStorage.ts`)

## Key config
- EAS project ID: `650ed19c-3588-4b86-a01e-ae0ec83096c4`
- App Store ID: `6760092871`
- Apple Team: `PX6JG78DT5`
- Bundle ID: `com.paceup` (iOS & Android)

## Local development
```bash
# Mobile app (connects to production backend by default)
npm start

# Backend server (needs .env file — copy .env.example)
npm run server:dev
```

## OTA update (no App Store review needed)
```bash
eas update --branch production --message "fix: description of change"
```

## New build + store submission
```bash
eas build --platform all --profile production
eas submit --platform ios   # uses App Store credentials in eas.json
eas submit --platform android
```

## Backend hosting
- Currently: `PaceUp.replit.app` (Replit) — **needs migration to Railway/Render/Fly**
- `EXPO_PUBLIC_DOMAIN` in eas.json production build points to the live backend URL
- When backend moves, update `EXPO_PUBLIC_DOMAIN` in `eas.json` and redeploy

## Object storage migration (TODO)
`server/objectStorage.ts` currently uses Replit's GCS sidecar for auth.
When migrating off Replit: replace the `credentials` block with a real GCS service account key JSON.
