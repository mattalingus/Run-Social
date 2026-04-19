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
- **Railway** (project: considerate-imagination, service: paceup-backend)
- URL: `https://paceup-backend-production.up.railway.app`
- Deploy: `railway up` from repo root (Dockerfile-based build)
- Env vars managed via `railway variables --set KEY=VALUE`
- `EXPO_PUBLIC_DOMAIN` in eas.json production build points to the live backend

## Object storage
- **Cloudflare R2** bucket `paceup-photos` (public URL: `https://pub-4f021c1a952342f0a5e04581014bfe2e.r2.dev`)
- Server uploads/reads via S3 client in [server/objectStorage.ts](server/objectStorage.ts)
- Keys are stored as `public/photos/<filename>`; photo URLs in DB are absolute R2 URLs
