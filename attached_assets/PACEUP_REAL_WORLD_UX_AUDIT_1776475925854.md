# PaceUp Real-World UX Audit — Usage-Flow Failures

**Date:** 2026-04-17
**Scope:** Real-world user-flow failures. These are bugs where a normal user does a normal thing and the app misbehaves. Not backend safety, not abstract security — actual usage bugs like the live-event participant dropout Matthew hit, and the overlapping-route distance-doubling bug he already fixed.

> **For Replit:** Every finding below was verified against the actual codebase (specific file + line references). Prioritize CRITICAL items before launch promotion; they are the ones most likely to turn into support tickets.

---

## CRITICAL — silent data loss or data fabrication

### R1. Weekly summary notifications never send (broken SQL, silently caught)
**Real-world scenario:** User signs up expecting the Sunday weekly recap ("You ran 12.4 miles this week"). They never receive a single one. From the outside the feature looks "off" or "coming soon"; internally the job is running and failing per-user.

**What goes wrong:** Query reads `SUM(distance_mi)` and `WHERE completed_at >= $2` from `solo_runs`. Actual columns are `final_distance` (miles) and `created_at` / `ended_at`. Postgres throws "column does not exist" per user, the `catch {}` block swallows it, job logs look healthy.

**File + line:** `server/storage.ts` `getWeeklyStatsForUser` lines 4780–4786; called from `server/weekly-summary.ts`.

**Root cause:** Schema drift + swallowed exception. (This is the same root class as the original C2 in audit 2, confirmed here with concrete line numbers.)

**Fix:** Update SQL to `SUM(final_distance)` and `WHERE created_at >= $2`. Log per-user errors to Sentry/logs instead of `catch {}`. Add a startup schema assertion (`SELECT column_name FROM information_schema.columns WHERE table_name='solo_runs'`) that throws if expected columns are missing.

---

### R2. Blocking a user does NOT unfriend them (wrong table name in DELETE)
**Real-world scenario:** User is being harassed. They open the harasser's profile → Block. They close the app assuming the harasser can no longer DM them, see their runs, or show up in shared crews. In reality, **nothing happened** — they are still friends, the harasser can still DM, see every run, and still appears in their friends list.

**What goes wrong:** Block endpoint runs `DELETE FROM friendships WHERE ...`. The real table name is `friends`. Postgres throws "relation friendships does not exist", the endpoint's outer try/catch logs it, block row gets inserted successfully, but the friendship row stays. User believes they're safe.

**File + line:** `server/routes.ts` block endpoint lines 666–669. Schema reference: `server/storage.ts` line 212 uses `friends`.

**Root cause:** Table was renamed `friends` at some point; block code was never updated. Silent failure because the outer error handler only returns 500, which the client ignores if the block row insert succeeded.

**Fix:** Change to `DELETE FROM friends WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)`. Also delete any pending `friend_requests` rows in either direction. Same transaction as the block insert so either all succeeds or none.

**Priority note:** This is the one Matthew should fix tonight. 3-line change, safety impact is highest of any bug in the app.

---

### R3. Blocked users still appear everywhere they shouldn't
**Real-world scenario:** Even once R2 is fixed and the block-unfriend works, the blocked user still shows up in: friend search, "People you may know," activity feed, crew member lists, run participants, and pending friend-request lists.

**What goes wrong:** `getFriends`, `getFriendRequests`, `searchUsers`, feed queries — none of them JOIN or anti-join against `user_blocks`.

**File + line:** `server/storage.ts` block functions 4923–4958 and every `getFriends` / `searchUsers` caller.

**Root cause:** Block feature was bolted on after the social read paths existed; nothing was retrofitted.

**Fix:** Add a reusable helper:
```ts
async function isBlockedEitherWay(a: string, b: string): Promise<boolean>
```
Filter all social read paths: friends list, friend requests inbox/outbox, user search, feed, crew members, run participants view, DM thread list, notifications. Simplest pattern: an always-applied `AND NOT EXISTS (SELECT 1 FROM user_blocks WHERE (blocker_id=$me AND blocked_id=other_id) OR (blocker_id=other_id AND blocked_id=$me))` appended to every query.

---

### R4. Ghost-run cleanup closes runs with ZERO stats — zombie completed runs in history
**Real-world scenario:** Host's phone crashes mid-group-run. Four hours later the automated ghost-run cleanup closes the run. The host opens the app the next morning and sees a "completed" run in their history with **0.00 mi, no pace, no rank, no participant credits.** The three friends who were running with them also have corrupted weekly totals because their runs got zombie-closed too.

**What goes wrong:** `closeGhostRuns` only sets `is_active=false, is_completed=true`. It does **not** compute `final_distance` / `final_pace` / `final_rank` from `run_tracking_points`, and does not call the participant stat-crediting path.

**File + line:** `server/ghost-run-cleanup.ts` lines 7–20.

**Root cause:** The cleanup job was designed to close the zombie, not reconcile its data.

**Fix:** On close, for each participant, compute distance/duration from their last-known `run_tracking_points`, and call the same finalization logic that `finishRunnerRun` uses. If no tracking points exist at all (phone crashed before any GPS fix), mark the run `abandoned=true` instead of `is_completed=true` so it doesn't pollute history, leaderboards, or streaks.

---

### R5. Stale-run reaper fabricates 3 fake miles out of thin air
**Real-world scenario:** User taps Start, realizes they forgot their headphones, force-closes the app within 30 seconds (before any GPS fix). Next day the nightly stale-run reaper processes the orphaned run and **credits them with 3 miles.** Their weekly total jumps, their friends see "Matthew ran 3.0 miles" in the feed, leaderboard position bumps.

**What goes wrong:** One line of JavaScript:
```ts
const miles = parseFloat(p.final_distance) || 3;
```
When `final_distance` is null or 0, `||` treats both as falsy and defaults to the literal `3`. This is almost certainly a placeholder left over from development that shipped.

**File + line:** `server/late-start-monitor.ts` `cleanupStaleActiveRuns` line 107.

**Root cause:** Dev placeholder (`|| 3` for testing) was never removed.

**Fix:** If `final_distance` is null or 0, **don't credit stats at all** — mark the run `abandoned` so it's invisible from leaderboards, profile, and weekly totals but still audit-trailed. The literal `3` must go.

---

### R6. Silent host auto-promotion — the new host has no idea they're the host
**Real-world scenario:** Host's battery dies mid-group-run. The backend silently promotes the participant with the most miles to "new host." That user has no idea they're now hosting — they weren't warned, they don't see the host-only UI, and they may have already dropped off or be in the middle of a sprint interval. The "host" role effectively doesn't exist for the rest of the run.

**What goes wrong:** `checkAndPromoteHost` swaps the `host_id` based on `cumulative_distance` with no push, no banner, no confirmation.

**File + line:** `server/late-start-monitor.ts` `checkAndPromoteHost` lines 302–348.

**Root cause:** Designed as a silent failover; UX was never considered.

**Fix:** Send a push ("You're now the host of X — tap to take over") AND show a banner in `app/run-live/[id].tsx` when the current user becomes host. Offer a "Decline host" action that either picks the next candidate by cumulative distance or ends the group run gracefully.

---

## HIGH — regularly-hit friction for normal users

### R7. Event-time notifications use the wrong timezone in three different places
**Real-world scenario:** User in Pacific time creates a 7:00 PM event. Push goes out saying "starts at 02:00 AM." Friend in Eastern time joins, gets a different (also wrong) time. Both miss the run.

**What goes wrong:** Three notification branches serialize the event date differently — one uses server-local TZ, one forces UTC, one strips the zone entirely. None use the user's stored timezone.

**File + line:** `server/routes.ts` lines 1170, 1215–1216, 1697.

**Root cause:** Code was written across multiple sessions with copy-paste, before `users.timezone` was stored.

**Fix:** Pass canonical UTC ISO string + `users.timezone` into one shared notification builder. Format with `Intl.DateTimeFormat(user.timezone, { timeStyle: 'short', dateStyle: 'medium' })` at send time. Audit all three call sites to share the helper.

(Related to H4 in deep audit 2 — `events` should also store IANA timezone of the organizer. This fix depends on that.)

---

### R8. DM and crew-chat push notifications don't deep-link anywhere
**Real-world scenario:** User gets a DM push notification. Taps it. App opens to the home tab. User has to manually navigate to Messages, find the thread. Same for crew-chat notifications.

**What goes wrong:** The root notification response handler only branches on `runId` and on specific screen values (`"live-tracking"`, `"notifications"`, `"run-live"`). DM payloads (`{ screen: "dm", friendId }`) and crew-chat payloads (`{ crewId }`) fall through to the `if (!runId) return;` early-return and go nowhere.

**File + line:** `app/_layout.tsx` lines 187–223.

**Root cause:** Deep-link handler grew incrementally; DM/crew were added server-side but never wired client-side.

**Fix:**
```ts
if (data?.screen === "dm" && data?.friendId) {
  router.push(`/dm/${data.friendId}`);
  return;
}
if (data?.screen === "crew-chat" && data?.crewId) {
  router.push(`/crew-chat/${data.crewId}`);
  return;
}
```
Ensure sending side (server/notifications.ts) populates these fields consistently for DM and crew-chat payloads.

---

### R9. Live group tracking is missing the GPS accuracy + vehicle-speed filters that solo tracking has
**Real-world scenario:** Group-run participant accidentally opens Maps driving-directions in the background, or drives their car a block to a better parking spot before the run starts. Their "run" path jumps 100+ ft along a road, and the live leaderboard briefly shows them in first place at a 2:00/mi pace. The rest of the group thinks something is broken or the user is cheating.

**What goes wrong:** Solo tracking (`app/run-tracking.tsx` lines 786–794) drops GPS points with `accuracy > threshold` AND drops points where implied speed exceeds an activity-appropriate vehicle threshold. `contexts/LiveTrackingContext.tsx` `handleCoord` (lines 132–183) has **neither** guard — every GPS point is accepted as-is.

**File + line:** `contexts/LiveTrackingContext.tsx` 132–183 (missing) vs `app/run-tracking.tsx` 786–794 (present).

**Root cause:** Solo code was hardened after a prior bug report; the live-group path was never updated to match.

**Fix:** Extract the filter into a shared helper: `shouldAcceptCoord(coord, activityType)`. Call it from both the solo tracker and the live tracker. Same helper also applies the accuracy threshold. One source of truth prevents future drift.

---

### R10. GPS gap reconciliation inflates elapsed time without adding distance
**Real-world scenario:** User's foreground-only location permission means iOS kills location updates when the app backgrounds. User leaves the app (say, to reply to a text), goes inside a building for 12 minutes, comes back out, keeps running. Current code adds the **full 12 minutes of wall-clock time** to elapsed with **zero distance**, dragging their average pace from 9:00/mi to 14:00/mi. They feel cheated and think the app is broken.

**What goes wrong:** Gap reconciliation currently assumes the user kept running through the gap at their last-known pace (adds wall-clock to elapsed). But it's equally likely they paused.

**File + line:** `app/run-tracking.tsx` lines 845–856 and `contexts/LiveTrackingContext.tsx` lines 138–148.

**Root cause:** Reconciliation was written to fix the opposite bug (missing distance after a gap) and overcorrected.

**Fix:** On gap resume, compare the first post-gap GPS point to the last pre-gap point:
- If `straight_line_distance < 50 m` AND `gap > 60 s` → **assume paused**. Don't add elapsed time or distance for the gap.
- Otherwise → interpolate distance proportionally to last-known pace, capped at a reasonable delta (e.g., max 0.25 mi per reconciled gap).

Show a small toast: "Detected pause — resumed tracking" or "Filled in GPS gap — 0.15 mi added."

---

### R11. No minimum-distance / minimum-duration guard — accidental 30-second runs pollute profile
**Real-world scenario:** User taps Start, realizes they haven't tied their shoes, stops 40 seconds later. A "0.03 mi, 1-min run" is saved to their profile, counts toward their weekly mileage, affects streak calculation, and bumps leaderboards. Their profile fills up with accidental sub-minute runs from pocket-taps and forgotten cancels.

**What goes wrong:** `POST /solo-runs` and group-run confirmation accept any `final_distance ≥ 0`.

**File + line:** `server/routes.ts` line 1928 (`POST /solo-runs`); `server/storage.ts` `confirmRunCompletion` ~lines 2008–2091.

**Root cause:** No business-rule validation for trivial runs.

**Fix:** Server-side: reject or silently discard runs with `final_distance < 0.1 mi` OR `duration < 60 s`. Client-side: before submit, if distance/duration is below the threshold, show "This run is very short — save anyway?" with Save / Discard. Default to Discard on the confirmation dialog.

---

### R12. No email verification — typo'd emails silently lock users out of recovery
**Real-world scenario:** User types `jane@gmial.com` at signup (typo). Onboarding proceeds fine. Weeks later they forget their password, tap Reset, the email goes to Gmail's typo-protection void, they can never recover the account. They assume the app is broken and uninstall.

**What goes wrong:** No confirmation email is sent on register. Nothing proves the user owns the address.

**File + line:** `server/routes.ts` register handler lines 145–168; `app/onboarding.tsx` signup step lines 1–100.

**Root cause:** Verification flow was never built.

**Fix:** Send a 6-digit verification code on register (SendGrid/Resend/Postmark). Show an email-verification screen immediately after signup asking for the code. Allow the user to **change the email before verification** (grace window — handles the "oh I typo'd that" case on the spot). Gate password-reset flows on verified emails.

(This is L5 in deep audit 2, elevated here because it's a much larger real-world pain than the audit made it sound. Many users will never make it to their second session because of lost passwords.)

---

### R13. Plan-to-go / RSVP is allowed on past events and cancelled events
**Real-world scenario A:** User finds an old event in search (perhaps via a stale link), taps "I'm going." Gets "Your event starts in 15 minutes!" push fires immediately because the cron job sees a past-time row with RSVPs.

**Scenario B:** User RSVPs to a run that was cancelled hours earlier. They show up to an empty trailhead.

**What goes wrong:** `/plan` endpoint does not check `date > NOW()` or `is_cancelled = false`.

**File + line:** `server/routes.ts` `/plan` handler lines 1496–1520.

**Root cause:** Missing validation.

**Fix:**
```ts
const { rows } = await pool.query(
  'SELECT date, is_cancelled, is_completed FROM runs WHERE id=$1',
  [runId]
);
if (!rows.length) return res.status(404).json({ error: 'Event not found' });
const event = rows[0];
if (event.is_cancelled) return res.status(400).json({ error: 'Event cancelled' });
if (event.is_completed) return res.status(400).json({ error: 'Event already happened' });
if (new Date(event.date) < new Date()) return res.status(400).json({ error: 'Event has passed' });
```
Also: on event UI, grey out the "I'm going" button (and show "This event has ended" / "This event was cancelled") when past or cancelled.

---

### R14. HEIC photos from iPhone aren't converted — Android viewers see broken images
**Real-world scenario:** iPhone user sets their profile photo (iOS saves it as HEIC by default). Upload succeeds, iPhone user sees their photo fine. Every Android friend viewing their profile or their run posts sees a **broken-image icon.** Same for run post photos. About half of PaceUp's users are affected by half of the other half's uploads.

**What goes wrong:** Multer accepts `.heic` extension, server stores the file unchanged. React Native `<Image>` on Android has no HEIC decoder. (iOS does, which is why the iPhone owner doesn't see the problem on their own device.)

**File + line:** `server/routes.ts` line 59 (`ALLOWED_IMAGE_EXTENSIONS`) and upload handlers lines 2488–2556.

**Root cause:** Format acceptance was added without a conversion step.

**Fix:** On upload, if the detected MIME type is HEIC/HEIF, convert to JPEG server-side with `sharp`:
```ts
if (mime === 'image/heic' || mime === 'image/heif') {
  await sharp(tmpPath).toFormat('jpeg', { quality: 85 }).toFile(finalPath);
} else {
  await sharp(tmpPath).rotate().withMetadata({ exif: {} }).toFile(finalPath);
}
```
Store only JPEG/PNG/WEBP in object storage. Same pass strips EXIF (kills the H6 doxing issue in one shot).

---

## MEDIUM — affects some users, degrades polish

### R15. Silent crew-chief transfer when the creator leaves
**Real-world scenario:** Crew creator (chief) leaves the crew. The next-oldest member is silently auto-promoted to chief. That user doesn't know they now control membership, settings, and streaks until they happen to open the crew settings screen weeks later.

**File + line:** `server/storage.ts` `leaveCrewById` lines 4292–4320.

**Root cause:** Silent failover, no UX layer.

**Fix:** Send a push + in-app banner: "You're now chief of [Crew Name]." Offer a "Decline" action that picks the next candidate, or dissolves the crew if no other active members.

---

### R16. Expo push notifications aren't batched or receipt-processed
**Real-world scenario:** A popular host runs a 150-participant event. Expo's `/send` endpoint caps at 100 tokens per request — the extra 50 are silently dropped and never receive the "Event starting in 15 min" push. Additionally, users who uninstalled months ago still have stale tokens that never get cleaned up, so every future notification wastes bandwidth and time.

**File + line:** `server/notifications.ts` (whole file, 60 lines).

**Root cause:** Treated as fire-and-forget.

**Fix:** Chunk tokens into batches of ≤100. After send, fetch receipts after a 5-second delay. Mark and delete tokens that return `DeviceNotRegistered` or `InvalidCredentials`. Retry `MessageRateExceeded` with backoff.

---

### R17. Walk vehicle-filter threshold drops legitimate vigorous walkers
**Real-world scenario:** A fast walker going downhill briefly hits 4.5 m/s (~10 mph). The vehicle-speed filter discards those GPS points. Their walk distance comes out short and their pace looks slower than they actually walked. They blame the app.

**File + line:** `app/run-tracking.tsx` vehicle-filter near lines 786–794.

**Root cause:** Threshold set once, tuned for averages, not downhill peaks.

**Fix:** Require **sustained** over-threshold speed (e.g., >4 m/s for 20+ consecutive seconds AND near-straight geometry = `bearing variance < 5°`) before classifying as vehicle. Or raise the walk threshold to 5 m/s (11 mph). Current naive one-sample trigger is too aggressive.

---

### R18. Canceling a run leaves orphaned messages + scheduled push notifications
**Real-world scenario:** Host cancels a run at 2 PM. Five minutes before the original start time (say 5:55 PM), all invitees get a "Your run starts in 15 minutes!" push, because `scheduled_run_notifications` rows were never cleaned up. They show up to a cancelled run. Run messages from the cancelled run also linger in invitees' inboxes.

**File + line:** `server/storage.ts` `cancelRun` lines 1977–1988.

**Root cause:** `DELETE FROM runs WHERE id=$1` doesn't cascade; `run_messages`, `scheduled_run_notifications`, `run_invitations`, and `run_participants` don't have `ON DELETE CASCADE` on their FK to `runs`.

**Fix:** Either add `ON DELETE CASCADE` at the schema level (simplest, one migration), or wrap `cancelRun` in a transaction that explicitly deletes from `run_messages`, `scheduled_run_notifications`, `run_invitations`, `run_participants`, *then* the `runs` row. Also send a cancellation push to everyone who was planned-to-go: "The run [X] was cancelled by the host."

---

## Severity summary

| # | Severity | Title | File |
|---|---|---|---|
| R1 | CRITICAL | Weekly summary never sends (broken SQL) | server/storage.ts:4780 |
| R2 | CRITICAL | Block doesn't unfriend (wrong table) | server/routes.ts:666 |
| R3 | CRITICAL | Blocked users still appear everywhere | server/storage.ts:4923 |
| R4 | CRITICAL | Ghost cleanup creates zombie completed runs | server/ghost-run-cleanup.ts:7 |
| R5 | CRITICAL | Stale-run reaper fabricates 3 miles | server/late-start-monitor.ts:107 |
| R6 | CRITICAL | Silent host auto-promotion | server/late-start-monitor.ts:302 |
| R7 | HIGH | Three timezone bugs in event notifications | server/routes.ts:1170,1215,1697 |
| R8 | HIGH | DM/crew push notifications don't deep-link | app/_layout.tsx:187 |
| R9 | HIGH | Live tracking missing accuracy/vehicle filters | contexts/LiveTrackingContext.tsx:132 |
| R10 | HIGH | GPS gap reconciliation inflates paused time | app/run-tracking.tsx:845 |
| R11 | HIGH | No min-distance guard; accidental 30s runs pollute profile | server/routes.ts:1928 |
| R12 | HIGH | No email verification — typo'd emails lock out | server/routes.ts:145 |
| R13 | HIGH | RSVP allowed on past/cancelled events | server/routes.ts:1496 |
| R14 | HIGH | HEIC uploads not converted — broken on Android | server/routes.ts:59 |
| R15 | MED | Silent crew-chief transfer | server/storage.ts:4292 |
| R16 | MED | Push not batched/receipt-processed | server/notifications.ts |
| R17 | MED | Walk vehicle-filter drops fast walkers | app/run-tracking.tsx:786 |
| R18 | MED | Cancel run leaves orphan messages/pushes | server/storage.ts:1977 |

---

## Recommended fix order (for Replit)

**Tonight / Day 1 (3-line fixes with huge impact):**
- R2 (block doesn't unfriend) — rename `friendships` → `friends`
- R5 (|| 3 fake miles) — remove the literal
- R13 (RSVP on past/cancelled events) — add 3-line validation

**Before any promotion:**
- R1, R3, R4, R6, R9, R11, R14, R18

**Launch month:**
- R7, R8, R10, R12, R15, R16, R17

---

*End of real-world UX audit. Combined with `PACEUP_UI_LABEL_AUDIT.md`, `PACEUP_CYCLING_CONVENTIONS_AUDIT.md`, `PACEUP_DEEP_AUDIT_2.md`, and `PACEUP_PUBLIC_ROUTES_FRAMEWORK.md`, this is the complete pre-launch fix package.*
