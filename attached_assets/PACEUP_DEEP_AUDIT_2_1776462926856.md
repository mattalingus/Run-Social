# PaceUp Deep-Dive Audit v2 — Pre-Launch Nitty Gritty (revised)

**Date:** 2026-04-17
**Scope:** Revised version of `PACEUP_DEEP_AUDIT.md` after walkthrough with Matthew. Items he confirmed as intentional design choices are now explicitly marked `⚠ DESIGN CHOICE — DO NOT FIX`. Everything else is a real bug to fix.

> **Important for whoever fixes this (Replit):**
> This report excludes findings already delivered in:
> - `PACEUP_UI_LABEL_AUDIT.md` — run/ride/walk label consistency (ShareCard /mi, AI coach copy, live pace card units, Cancel/Rejoin alerts, weekly push copy, `activityIcon()` bug).
> - `PACEUP_CYCLING_CONVENTIONS_AUDIT.md` — cycling conventions (DISTANCE_CATEGORIES all running, personal ranking SQL, Marathoner awards on rides, Speed Demon threshold, pace groups, 50 mi monthly goal, audio "5K mark", climbing achievements).
> - `PACEUP_PUBLIC_ROUTES_FRAMEWORK.md` — full framework for public routes / global map / busyness card. This supersedes the old M3 route-bloat note below.
>
> **Anything below marked `⚠ DESIGN CHOICE` is intentional — skip it.**

---

## CRITICAL — fix before public launch

### C1. Elevation algorithm produces phantom gain on flat routes
**File:** `app/run-tracking.tsx` (~L797–831)
**Symptom Matthew observed:** Flat route showing **15 ft on PaceUp vs 1 ft on Strava**.
**Root cause:** Threshold for counting a rise is **2.0 m (≈ 6.5 ft)** with only **3 consecutive upward readings**. Consumer-grade phone GPS altitude has **±5–10 m noise per reading** — so random walk noise easily clears the bar and gets counted as gain. On a 30-minute run the noise integrates to roughly the 10–20 ft of phantom elevation the user is seeing.

**Fix:**
1. Raise the sustained-rise threshold to **≥ 3.0 m** AND require **≥ 5 consecutive** upward smoothed readings (not 3).
2. Add a **hysteresis band**: once rising, only keep accumulating while the smoothed altitude stays above `lastSmoothedAlt + 1.0 m`; reset the "rising" streak as soon as it dips back.
3. Use `Barometer` from `expo-sensors` when available on iOS (iPhone 6+) / modern Android — barometric altitude is an order of magnitude more accurate than GPS for relative gain. Fall back to GPS only when the barometer isn't present.
4. Discard GPS altitude readings with `verticalAccuracy > 10 m` (expo-location exposes this on `Location.LocationObject.coords.altitudeAccuracy`).
5. Clamp the per-sample delta to a sane max (e.g., ignore any single-step rise > 20 m — those are GPS glitches, not a user teleporting up a cliff).

Expected result: flat route will register **0–2 ft** like Strava.

---

### C2. Weekly summary push notifications always show "0 runs · 0.0 mi"
**File:** `server/storage.ts` (~L4782, L4785)
**Issue:** The weekly stats SQL references columns that **don't exist on `solo_runs`**:
- Uses `distance_mi` — the actual column is `distance_miles`.
- Uses `completed_at` — that column doesn't exist; the timestamp column is `created_at` (or `ended_at` depending on the table).

This means every weekly summary push goes out saying the user did 0 runs, which looks broken and actively demotivates re-engagement during the launch window.

**Fix:** Replace with the real column names and verify the query returns the expected rows for a test user:
```sql
SELECT COUNT(*) AS runs, COALESCE(SUM(distance_miles), 0) AS miles
FROM solo_runs
WHERE user_id = $1
  AND created_at >= $2  -- start of week
  AND created_at <  $3  -- start of next week
  AND activity_type = $4;
```
Then add an automated integration test that inserts one run in the current week and asserts the weekly-summary query returns `runs=1`.

---

### C3. Delete Account is not a cascade delete — orphaned rows everywhere
**File:** `server/storage.ts:~L4765` (`deleteUser`)
**Issue:** The implementation only runs `DELETE FROM users WHERE id = $1`. All of the following keep rows pointing to a nonexistent user:
- `solo_runs`, `events`, `event_participants`, `crews`, `crew_members`, `friends`, `friend_requests`, `posts`, `comments`, `likes`, `notifications`, `achievements`, `messages`, `remember_tokens`, `reports`, `blocks`.

Real-world consequences: (a) deleted users keep appearing in friends' feeds and leaderboards, (b) GDPR/CCPA "right to delete" obligation is unmet, (c) foreign-key queries throw or return nulls that crash the mobile client.

**Fix:** Either add `ON DELETE CASCADE` to every FK that references `users.id`, or wrap the delete in a transaction that explicitly removes child rows in FK-safe order. Transaction approach is safer because it's auditable:
```ts
await pool.query('BEGIN');
try {
  await pool.query('DELETE FROM remember_tokens WHERE user_id = $1', [id]);
  await pool.query('DELETE FROM likes WHERE user_id = $1', [id]);
  // ... every child table ...
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
  await pool.query('COMMIT');
} catch (e) { await pool.query('ROLLBACK'); throw e; }
```

---

### C4. Friend search must be username-only (user-requested)
**File:** `server/storage.ts:~L1103–1111` (`searchUsers`)
**Current:**
```sql
WHERE id != $1 AND (username ILIKE $2 OR name ILIKE $2)
```
**Fix:** Drop the name clause:
```sql
WHERE id != $1 AND username ILIKE $2
```
Also verify the client-side search screen title reads "Search by username" so users know what to type.

---

### C5. `POST /api/runs` accepts arbitrary client-provided pace/distance/route with no validation
**File:** `server/routes.ts:~L1928–1950`
**Issue:** The handler trusts client-provided `paceMinPerMile`, `distanceMiles`, `durationSeconds`, and `routePath` with no checks. A malicious or buggy client can submit:
- `distanceMiles: -5`, `paceMinPerMile: 0`, `durationSeconds: -1`
- `distanceMiles: 999999`, `paceMinPerMile: 0.1` (14,400 mph run)
- `routePath: [{lat: 9999, lng: -9999}]` (off-Earth coordinates)
- Pace that doesn't match distance/duration (you can log a 1-hour run over 1 mile at 3 min/mi pace)

Once leaderboards are public, someone *will* submit fake records. They already can, with `curl`.

**Fix:** Validate server-side:
- `distanceMiles` between 0 and 200 (marathon + buffer; reject otherwise).
- `durationSeconds` between 30 and 86,400 (one day).
- `paceMinPerMile` within 3.0–60.0 (world-record-pace to walking-pace).
- **Consistency check:** `abs(paceMinPerMile - (durationSeconds/60)/distanceMiles) < 0.2` — if not, recompute pace server-side from duration/distance and ignore the client value.
- Every `routePath` point: `lat ∈ [-90, 90]`, `lng ∈ [-180, 180]`, and consecutive-point distance implies speed < 50 mph for runs / 60 mph for rides (anything faster is GPS teleport or cheating).

---

### C6. Double-tap on "Save Run" creates duplicate runs
**File:** `app/run-tracking.tsx` Save button handler; `server/routes.ts` POST /api/runs
**Issue:** The save button has no in-flight lock. On a laggy connection a double-tap fires two identical POSTs and two rows are inserted — the user then sees their run twice in the feed and gets double achievement credit. This is easy to reproduce on cell networks mid-run.

**Fix (two layers):**
1. Client: disable the Save button and set a `savingRef.current = true` guard on first tap; only re-enable on success or explicit error.
2. Server: require the client to send a `clientRunId` (UUID generated when the run started) and add `UNIQUE INDEX ON solo_runs (user_id, client_run_id)`. Duplicate POST returns the already-saved row instead of creating a new one.

---

### C7. Tapping a notification for a deleted run crashes the app
**File:** `app/(tabs)/notifications.tsx` → navigates to `/run/[id]`; `app/run/[id].tsx` doesn't handle the 404 case.
**Issue:** If someone deletes a run that another user liked, the notification still exists and routing to the detail screen shows a white screen / throws on `run.distance_miles` access.

**Fix:** In the run-detail screen, handle `fetch returned null` by rendering "This run was deleted by the runner" and a button back to the feed. Additionally, when a run is deleted, soft-delete the related like/comment notifications (`UPDATE notifications SET hidden=true WHERE run_id=$1`).

---

### C8. Photo upload silently fails on flaky networks
**Files:** `app/components/PhotoUpload.tsx`, `server/routes.ts` POST /api/uploads
**Issue:** The upload is fire-and-forget — on a timeout or 500 the file is gone, the user sees no error, and their profile or run has no photo. No retry, no queue.

**Fix:** Wrap uploads in `p-retry` with 3 attempts and exponential backoff. If all retries fail, persist the local URI in AsyncStorage under `@paceup_pending_uploads` and retry on next app open with an NetInfo online-check. Show a small "Photo pending upload" chip on affected items until success.

---

## HIGH — launch-week quality bugs

### H1. Deleting a run doesn't decrement `users.total_miles` or `completed_runs`
**File:** `server/storage.ts` `deleteSoloRun`
**Issue:** The totals are stored on the `users` row and incremented when a run is saved, but the delete path doesn't decrement. Users who delete a mistaken or duplicate run permanently overstate their miles on their profile and leaderboards.

**Fix:** In the same transaction that deletes the run, `UPDATE users SET total_miles = total_miles - $distance, completed_runs = GREATEST(completed_runs - 1, 0) WHERE id = $user_id`. Ideally, derive these from `SUM(distance_miles) FROM solo_runs` on read rather than caching on the user row — that removes the whole class of drift bug.

---

### H2. Distance-units setting (mi/km) is not fully respected throughout the app
**Files:** `contexts/UnitsContext.tsx` (if present) + every screen rendering distances
**Issue:** The setting toggle persists to AsyncStorage, but several places still hardcode `mi`:
- ShareCard (already noted in UI label audit).
- Weekly summary text.
- Achievement unlock toasts ("You ran 5 miles!").
- Leaderboard labels.
- Event detail screens.

Users in the UK/EU flip to km, finish a run, and see mixed mi/km output — looks amateurish.

**Fix:** Centralize distance formatting in one `formatDistance(meters, unit)` helper and enforce via lint that raw strings like `" mi"`, `"miles"`, `" km"` never appear in view files. Grep the repo for `" mi"` / `"miles"` / `" km"` and route them through the helper.

---

### H3. ⚠ DESIGN CHOICE — DO NOT FIX
**Original concern:** Dark-mode / theme toggle not persisted to backend.
**Matthew's decision:** User selects default workout type at signup (most people are just runners or just cyclists), and theme defaults to light mode with in-settings override. Device-local theme is the intent. Default activity is already synced to backend. **No change needed.**

---

### H4. Events schema has no timezone — scheduled start times drift for traveling users
**File:** `server/schema.sql` or migrations for `events` table; `app/events/...`
**Issue:** Event `start_time` is stored as a naive `timestamp` (or `timestamptz` but no `timezone` column capturing the organizer's intent). A NYC-organized 7 AM group run shows at 4 AM for a user flying to LA, or 1 PM for a UK user. This is going to bite on the first cross-city event.

**Fix:** Store `start_time timestamptz` AND add `timezone text` (IANA, e.g. `America/New_York`) captured from the organizer's device at creation time. Render using `date-fns-tz` with the event's timezone. Show both local and event TZ ("7:00 AM EDT · 4:00 AM your time").

---

### H5. GPS drift accumulates distance while the run is paused
**File:** `app/run-tracking.tsx`
**Issue:** When paused, the location subscription may still be receiving updates (depending on how pause is implemented). If the `onLocation` handler checks `isPaused` *after* pushing to `routePath` or computing delta, the next resume step jumps by a few meters of noise and those meters get counted. Even if pause does guard, standing still at a red light with GPS bouncing accumulates ~0.02 mi/min of phantom distance.

**Fix:**
1. On pause, unsubscribe from `Location.watchPositionAsync` (don't just set a flag).
2. Add a minimum-speed gate: discard any step where computed speed < 0.5 m/s (1.1 mph) — at that speed the user is either stopped or the reading is noise.
3. Add a maximum single-step distance gate (e.g., 60 m between consecutive 1-Hz samples = 134 mph = GPS glitch, drop it).

---

### H6. Strip EXIF GPS from uploaded photos (narrowed scope)
**File:** `server/routes.ts` POST /api/uploads
**Issue:** Profile photos being public is intentional (confirmed — that's the whole point of a profile photo). **The remaining real bug** is that user-uploaded images often carry embedded EXIF metadata with the exact GPS coordinates where the photo was taken — which for casual selfies is often the user's home. When the file is public, anyone who downloads it can read those coordinates.

Different from event-location (which the user sets deliberately). This is the invisible metadata that rides along inside JPEG/HEIC files.

**Fix:** One-liner on the server using `sharp`:
```ts
await sharp(input).rotate().withMetadata({ exif: {} }).toFile(output);
```
Or `exifr.remove()`. Runs in ~10 ms, zero UX impact, closes a doxing vector.

Predictable-URL concern (original scope of H6) — dropped per Matthew. Photos are supposed to be public.

---

### H7. Remember-me cookie stays valid after password change
**File:** `server/routes.ts` change-password handler; `server/storage.ts` remember_tokens table
**Issue:** Changing the password doesn't invalidate existing remember-me tokens. An attacker with a stolen device cookie keeps access even after the user rotates their password in response to suspicion of compromise.

**Fix:** On password change, `DELETE FROM remember_tokens WHERE user_id = $1` except (optionally) the current session's token. Display "You've been signed out of other devices" confirmation.

---

### H8. No rate limit on login or signup endpoints
**File:** `server/routes.ts` POST /api/auth/login, POST /api/auth/signup
**Issue:** Credential-stuffing and username-enumeration are open. Attackers can brute-force passwords and test whether email addresses are registered.

**Fix:** Add `express-rate-limit` with 5 attempts per IP per 15 minutes on login, 3 per hour on signup. Return identical error messages for "user not found" and "wrong password" (currently they likely differ, which enables enumeration).

---

## MEDIUM — polish-pass

### M1. ⚠ DESIGN CHOICE — DO NOT FIX
**Original concern:** Crew weekly streak uses Sunday-start (non-ISO) week.
**Matthew's decision:** US convention, leave it. **No change needed.**

---

### M2. Per-mile split data is accepted server-side without validation
**File:** `server/routes.ts` POST /api/runs, `splits` field
**Issue:** Related to C5 but specifically for splits: a client can submit `splits: [{mile: 1, time: -30}]` and it lands in the DB. Splits are shown on the run-detail screen, so bad data breaks the UI.

**Fix:** Validate each split: `time > 0`, `mile ∈ [1, Math.ceil(distanceMiles)]`, splits are strictly increasing in `mile`.

---

### M3. ✅ REPLACED BY SEPARATE FRAMEWORK
**Original concern:** `route_path` JSONB unbounded.
**Replaced by:** `PACEUP_PUBLIC_ROUTES_FRAMEWORK.md` — full spec for public routes, global map, busyness card, Ramer-Douglas-Peucker downsampling to ≤ 1,000 points, PostGIS-backed viewport queries. Replit: implement that framework instead of a narrow "just downsample" fix.

---

### M4. Blocked users still show in feed and leaderboards
**Files:** feed and leaderboard queries in `server/storage.ts`
**Issue:** The block relationship exists but most feed queries don't `LEFT JOIN blocks` to exclude them. A user who blocked someone still sees their runs and comments.

**Fix:** Every feed/leaderboard/search/event-participants query must filter:
```sql
AND NOT EXISTS (
  SELECT 1 FROM blocks
  WHERE (blocker_id = $me AND blocked_id = other.id)
     OR (blocker_id = other.id AND blocked_id = $me)
)
```
Audit every SELECT that returns user-generated content.

---

### M5. ⚠ DESIGN CHOICE — DO NOT FIX
**Original concern:** No CSRF protection on state-changing endpoints.
**Matthew's decision:** PaceUp is mobile-only. CSRF is a browser-cookie attack vector that doesn't apply to React Native clients. **No change needed.** If a web client is ever added, revisit.

---

### M6. No per-account login lockout
**File:** `server/routes.ts` login handler
**Issue:** IP-based rate limiting (recommended in H8) doesn't stop a distributed attack. Add a per-account counter that locks the account for 15 minutes after 10 failed attempts.

**Fix:** Add `failed_login_attempts int`, `locked_until timestamptz` to `users`. Increment on wrong password, clear on success, reject login when `locked_until > now()`.

---

### M7. Event capacity can be exceeded on race conditions
**File:** `server/routes.ts` POST /api/events/:id/join
**Issue:** Classic TOCTOU: two simultaneous joins both see `count < capacity` and both insert. Result: event is over-subscribed.

**Fix:** Use a transactional `INSERT ... WHERE (SELECT COUNT(*) FROM event_participants WHERE event_id=$1) < (SELECT capacity FROM events WHERE id=$1)` pattern, OR `SELECT ... FOR UPDATE` the events row before inserting the participant. Return 409 if full.

---

### M8. ⚠ DESIGN CHOICE — DO NOT FIX
**Original concern:** Notifications not de-duplicated (like/unlike/re-like makes three).
**Matthew's decision:** Not necessary. Leave as-is. **No change needed.**

---

### M9. ⚠ DESIGN CHOICE — DO NOT FIX
**Original concern:** Push-notification preferences are a single boolean, not per-channel.
**Matthew's decision:** Simple toggle is fine for v1. **No change needed.**

---

### M10. Profile photo change doesn't invalidate cached URLs
**File:** profile screen
**Issue:** If the client caches images by URL and the URL stays the same after upload (same path, overwritten), the old photo keeps showing due to cache. Common symptom: user changes avatar and it still looks old for hours.

**Fix:** Either use UUID filenames per upload, or append a `?v=<updated_at>` query-string cache-buster when rendering the photo URL.

---

## LOW — not launch-blocking, but file them

### L1. Run titles allow arbitrary length — long titles break feed cards.
Add `CHECK (length(title) <= 80)` on `solo_runs.title`.

### L2. Bio field isn't length-limited server-side.
Add `CHECK (length(bio) <= 300)` on `users.bio`.

### L3. Report system for bad actors (reframed from profanity filter)
**Matthew's direction:** Profanity fine (most crews know each other). GIFs in chat are URLs so a blanket URL strip would break chat. Instead, build a report-and-ban system.

**Fix:**
- `POST /api/reports` endpoint. Body: `{ targetType: 'user'|'comment'|'route'|'post', targetId, reason }`.
- New `reports` table: `id`, `reporter_id`, `target_type`, `target_id`, `reason`, `created_at`, `resolved` boolean.
- Trigger: when `COUNT(DISTINCT reporter_id) >= 3` for the same `(target_type, target_id)` within the last 30 days, auto-action:
  - `user` target: set `users.suspended_until = now() + interval '7 days'`.
  - `comment` / `post` / `route` target: hide from feeds (`hidden = true`).
- Report button in: user profile (⋯ menu), comment long-press, run-detail (for routes once public-routes ships).
- Admin dashboard (basic): list un-resolved reports, ability to restore or permaban.

This gives self-moderation during launch without needing a full trust-and-safety team.

### L4. Logout doesn't clear local cached run state.
Clear AsyncStorage `@paceup_*` keys on logout. (Shared-device scenario.)

### L5. Email verification is not enforced.
`users.email_verified` exists (presumably) but nothing gates functionality behind it. At minimum, gate public events/leaderboards until email verified so spam accounts can't pollute rankings.

### L6. No audit log for admin/moderator actions.
When content is removed or a user banned (via L3 above), there's no record. Add `audit_logs` table — cheap insurance.

### L7. ⚠ DESIGN CHOICE — DO NOT FIX
**Original concern:** Password policy weak.
**Matthew's decision:** Less friction is better. Leave as-is. **No change needed.**

### L8. `achievements` table has no uniqueness constraint.
Additionally to the cycling-audit note, a user can receive the same achievement twice if two runs cross the threshold in the same save batch. Add `UNIQUE (user_id, achievement_type)`.

### L9. ⚠ DESIGN CHOICE — DO NOT FIX
**Original concern:** Time-of-day stats use device local time instead of a home-timezone setting.
**Matthew's decision:** Leave as-is. **No change needed.**

### L10. No graceful offline mode for runs.
If the phone loses connection mid-run, saving at the end with no retry loses the entire run. Adopt an offline queue for runs (same pattern as C8 for photos).

---

## Settings screen specific review (updated)

1. **Default activity switcher** — works. Good.
2. **Distance units (mi/km)** — local-only persistence. Fix via H2 (centralized formatter); consider also persisting server-side so changing phones keeps the setting.
3. **Theme (light/dark/system)** — ⚠ intentional device-local per H3. No change.
4. **Push notifications toggle** — ⚠ single boolean intentional per M9. No change.
5. **Block list** — viewable, but unblock action doesn't refresh feed (stale data until app reopen). Force-refresh feed on unblock.
6. **Delete account** — works, but doesn't cascade (see C3). Add a second confirmation step ("Type DELETE to confirm") before firing.
7. **Logout** — works, but doesn't clear local caches (see L4).
8. **Change password** — works, but doesn't revoke remember-me tokens (see H7).
9. **Change email** — needs re-verification flow; current implementation (if any) appears to just update the column without verifying the new address is owned by the user.
10. **Export my data** (GDPR) — **not implemented**. You will need this before launching in EU. Can be a deferred notification ("We'll email your export within 30 days") but there must be *something*.

---

## Recommended fix order (for Replit)

**Day 1 (must-do before any public promotion):**
C1 (elevation), C2 (broken weekly SQL), C4 (friend search username-only), C5 (run validation), C6 (duplicate saves), C7 (deleted-run crash).

**Week 1:**
C3 (cascade delete), C8 (photo upload retry), H1 (delete decrement), H2 (units consistency), H4 (event timezone), H5 (paused-GPS drift), H6 (EXIF strip), H7 (revoke sessions on password change), H8 (auth rate limit).

**Launch month:**
M2 (splits validation), M4 (block filtering), M6 (account lockout), M7 (event capacity race), M10 (avatar cache), L1 (title length), L2 (bio length), L3 (report system), L4 (logout clears cache), L5 (email verification gate), L8 (achievement uniqueness), L10 (offline run queue).

**Separate track:**
- Public routes & global map per `PACEUP_PUBLIC_ROUTES_FRAMEWORK.md`.
- Cycling fixes per `PACEUP_CYCLING_CONVENTIONS_AUDIT.md`.
- UI label fixes per `PACEUP_UI_LABEL_AUDIT.md`.

**Do NOT touch (design choices):** H3, M1, M5, M8, M9, L7, L9.

---

*End of deep-dive audit v2. Combined with the UI Label audit, Cycling Conventions audit, and Public Routes framework, this is the complete pre-launch fix list.*
