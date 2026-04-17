# PaceUp — UI Label Audit (Run / Ride / Walk)

**Scope:** verify every user-visible label, unit, icon, and copy string adapts to the activity type. The canonical type is defined in `contexts/ActivityContext.tsx` as `"run" | "ride" | "walk"`, with a helper `activityLabel(type, form)` already available. Most of the app uses it correctly — this report lists the places that don't.

**Convention used throughout:**
- Run / Walk = distance + pace (min/mi or min/km)
- Ride = distance + speed (mph or km/h). Pace-per-mile is not a cyclist metric.
- Icons should visually distinguish the three.

---

## Priority fix order

1. ShareCard pace/unit label — HIGH (every shared ride misbranded publicly)
2. AI summary prompts hardcoding "min/mile" & "run" — HIGH (GPT output leaks "run" and "pace" into rides/walks)
3. Weekly summary push ("X runs · Y mi") — HIGH (cyclists/walkers get wrong noun)
4. Live tracking pace card locked to min/mi — HIGH (during active ride)
5. Audio coach phrases "per mile" for rides — HIGH
6. `run/[id].tsx` results leaderboard "/mi" on ride events — HIGH
7. Cancel Run alert + Rejoin group run alert hardcoded — HIGH (visible strings)
8. `activityIcon()` for run returns "walk" — MED (runs & walks look identical in UI)
9. Join request / map tooltips / onboarding copy — MED
10. MileSplitsChart label adapts but column still says "Pace" with min/mi values — MED

---

## 1. Rides showing pace (min/mi) instead of speed (mph) — HIGH

The biggest systemic bug. Rides get pace-per-mile in multiple high-visibility surfaces.

### 1a. `components/ShareCard.tsx` — ride share cards say "15:00 /mi"

- Props already include `activityType?: "run" | "ride" | "walk"` (line 107) and the card renders a bicycle icon + "Ride" badge, but the stat block never switches units.
- Hardcoded `/mi` label (no activity check):
  - Lines 369, 500, 620 (hero pace display across 3 layout variants)
  - Lines 395, 422, 526, 555, 582, 664, 709, 744 (stat-row variants)
- Root cause: `paceStr` is built once around line 115 as `min/mi` format for every activity.

**Impact:** when a user shares a bike ride to Instagram/social, the card publicly shows e.g. `15:00 /mi` instead of `15.5 mph`. Looks broken.

### 1b. `server/ai.ts` — GPT prompts hardcode run language

- Line 19 — system prompt: *"You are an elite AI running coach. Provide a concise, motivating summary of a **run**..."*
- Line 23 — user prompt: `Stats: Distance ${stats.distanceMiles} miles, Pace ${stats.paceMinPerMile} min/mile, ...`
- Lines 117–121 (`generateSoloActivityPost`) build `paceStr = "X:XX /mi"` then wrap as `"${paceStr} pace"` — sends `"15:00 /mi pace"` for all activities.
- Line 43 — system prompt for crew recap: "assistant for a **running** crew... group **run**."

**Impact:** AI-written post text and crew chat recaps will call a ride a "run" and use "min/mile pace" language. This is what users read in notifications and crew chat.

### 1c. `app/run-tracking.tsx` — live pace card stays on min/mi during rides

- Lines 1656–1659 — main live stat card:
  ```tsx
  {displayPace ? `${paceM}:${paceS.padStart(2,"0")}` : "--"}
  {distUnit === "km" ? "min/km" : "min/mi"}
  ```
  No check on `activityFilter`/`isRide` — same format for rides.
- Lines 1920–1927 — `livePaceStr` helper: only distance-unit-aware, no activity branching.
- Lines 2050–2051 — live pace display in alt tab: same bug.

**Impact:** user starts a ride → the big pace tile shows `4:00 min/mi` instead of `15.0 mph` throughout the workout.

### 1d. `app/run-tracking.tsx` AI voice coach — says "per mile" for rides

Lines 204–237 in `pickCoachPhrase()` / `announcePace` — phrases like *"Current pace, X a mile"*, *"Your pace is X a mile"*, *"Mile pace: X"* are used regardless of whether `isRide` is true. Some branches do check `isRide`, but many pace lines (e.g. 204, 205, 213–219, 222–225, 227) fall through to mile-pace phrasing for rides.

**Impact:** the coach speaks "pace, 4 minutes a mile" to a cyclist.

### 1e. `app/run/[id].tsx` results leaderboard — "/mi" shown for all events

- Line 269 — runner stat row: `{formatPace(runner.final_pace)} /mi`
- Line 871 — pace requirements label: `Pace (min/${unitLabel(distUnit)})`
- Line 1758 — pace group selector copy: *"Choose the group that best matches your pace. This helps the host organize the run."* ("run" hardcoded here too)
- Line 311 of `run-results/[id].tsx` — pace group header: `${minPace}–${maxPace} min/mi`

**Impact:** on a ride event the finisher leaderboard shows times as `4:00 /mi`. Wrong unit and wrong framing.

### 1f. `components/MileSplitsChart.tsx` — partial fix

Line 45 correctly flips the title: `"INTERVAL SPLITS"` for rides, `"MILE SPLITS"` otherwise. **But:**
- Line 53 — column header still says `Pace`
- Line 74 — values still render `fmtPace(split.paceMinPerMile)` (e.g. "4:12")

Rides get a correctly-titled chart with incorrectly-formatted values.

---

## 2. Labels hardcoded to "run" on ride/walk flows — HIGH

### 2a. `app/run/[id].tsx:491–497` — Cancel Run alert

```ts
const label = run?.activity_type === "ride" ? "ride" : ...;   // used in body ✅
Alert.alert(
  "Cancel Run",                                                // ❌ title hardcoded
  `Are you sure you want to cancel this ${label}?`,
  [
    { text: "Keep It", style: "cancel" },
    { text: "Cancel Run", style: "destructive", ... }          // ❌ button label hardcoded
  ]
);
```

The body already derives the label — title and destructive button ignore it.

### 2b. `app/_layout.tsx:171–179` — Rejoin alert ignores its own variable

```ts
const type = data.activityType === "ride" ? "ride" : data.activityType === "walk" ? "walk" : "run";
Alert.alert(
  "Rejoin your group run?",                        // ❌ should be ${type}
  `It looks like PaceUp was closed while you were tracking a group ${type} (${dist} mi, ${mins} min).`,
  ...
);
```

`type` is computed and then ignored for the title.

### 2c. `app/(tabs)/index.tsx:2715` — join-request notification

Push body: `"${name} wants to join your run \"${title}\""` — hardcoded "your run" for rides and walks.

### 2d. `app/(tabs)/index.tsx:2421` — onboarding slide

Heading: `"Join Hosted Runs and Rides"` — omits walks entirely (and the corresponding code comment on 2416).

### 2e. `app/(tabs)/index.tsx:3228` — host guidelines fallback

Lines 3213 and 3220 correctly branch for ride/walk, but the run fallback hardcodes `"No runner should feel unwelcome..."` even when the user is browsing rides (reached via default case).

### 2f. `app/map.tsx:482` — map tooltip

```ts
`${totalRunners} runner${totalRunners !== 1 ? "s" : ""} signed up`
```

Map pins aggregate across mixed event types, but the tooltip always says "runners". At minimum this should say "people" / "participants" when the list is mixed, or the event's type when homogeneous.

### 2g. `components/HostProfileSheet.tsx:30` — host badge

`getHostBadge()` always returns `"1st Run"`, `"5 Runs Hosted"`, etc., regardless of what the host actually ran. A host who only hosts bike rides still gets a "Run" badge on their profile.

### 2h. `app/run-tracking.tsx:1086` — permission alert

`"Enable location access in Settings so PaceUp can track your run."` — shown on rides/walks too.

---

## 3. Weekly summary & streak notifications — HIGH

### 3a. `server/weekly-summary.ts:22–23`

```
`${stats.runs} run${stats.runs !== 1 ? "s" : ""} · ${mi} mi · ${timeLabel} this week — keep it up!`
```

Cyclist who logged 50 miles across 3 rides sees *"3 runs · 50 mi · 4h 12m this week"*. Aggregate stat object is typed as `runs` — either make the field activity-aware or swap to generic noun ("workouts", "sessions").

### 3b. `server/weekly-summary.ts:91` — streak-at-risk message

```
`no run logged this week yet. Schedule one to keep it alive!`
```

A crew whose streak is built on rides gets told to log a "run".

### 3c. `server/ai.ts` — `generateWeeklyInsight` feeds the same prompt

Check line 19/23 — the summary insight the weekly push inserts is produced by the "running coach" system prompt, which means the prose part of the notification will also use "run" language.

---

## 4. Activity icons — MED

`contexts/ActivityContext.tsx:91–101`:

```ts
export function activityIcon(type) {
  if (type === "ride") return "bicycle";
  if (type === "walk") return "footsteps";
  return "walk";                            // ← run uses the SAME icon as walk
}
```

- Runs and walks render with nearly identical icons because `walk` (solid boot) is used for both. Run should use `walk-fast`, `walk-sharp`, or a running-person vector. Users scanning a feed can't tell run vs walk cards apart.
- Same mistake repeats in:
  - `app/onboarding.tsx:30` — `{ type: "run", label: "Running", icon: "walk" }`
  - `constants/achievements.ts:22` — "First Step" run achievement uses `icon: "walk"`
  - `constants/achievements.ts:504` — "Ride Organizer" uses generic `icon: "fitness"` instead of a cycling icon
  - `app/(tabs)/index.tsx:2326` — feed card icon: `name={cr.activity_type === "ride" ? "bicycle" : "walk"}` — walks and runs both get the walk glyph
  - `app/map.tsx:482` — hardcodes `icon: "walk"` for all event pins

---

## 5. Mile-based milestones in the run-tracking screen — MED

`app/run-tracking.tsx:383–387` — split presets:

```ts
[{ label: "1 Mile", miles: 1.0 }, { label: "2 Miles", miles: 2.0 }, { label: "5K", miles: 3.1 }]
```

Used as audio-coach trigger thresholds. Fine for walks & runs; for rides these thresholds fire every few minutes, spamming the user with pointless "1 mile" callouts. Either switch the default ride thresholds (every 5 mi? every 10 min?) or disable mile callouts entirely for rides.

Related copy tip at line 1574: `"...Enjoy the pace, the people, and the miles."` — fine-ish, but "pace" is again a runner metric.

---

## 6. Onboarding tile — MED

`app/onboarding.tsx:30`:

```ts
{ type: "run", label: "Running", icon: "walk", emoji: "🏃" }
```

Emoji is right, icon is wrong (see §4). Label is fine.

---

## 7. Settings variable naming — LOW (developer-facing only)

`components/SettingsModal.tsx:131` — `notifRunReminders` variable controls reminders that fire for all activity types. Rename to `notifActivityReminders` if you ever expose this per-type. Not user-visible; just flagging for when you refactor settings.

---

## Places where the app already handles this correctly (for reference)

Good news — most of the surface area is right. The helper `activityLabel()` is used consistently in:

- `app/create-run/index.tsx:346` — "Host a Ride / Walk / Run"
- `app/run/[id].tsx:820` — "Your Ride / Walk / Run"
- `app/run/[id].tsx:1278` — cancel destructive body text
- `app/run/[id].tsx:1380, 1544` — join CTAs
- `app/run/[id].tsx:3082` — "Max Riders / Walkers / Runners"
- `app/(tabs)/crew.tsx:1441, 1509` — activity toggles
- `app/(tabs)/solo.tsx:1452` — empty state ("No runs/rides/walks yet")
- `app/(tabs)/index.tsx:2332` — verb ("rode" / "walked" / "ran")
- `app/run-tracking.tsx:2005` — status label "Riding" / "Walking" / "Running"

The pattern to follow is already there — the fixes are a matter of routing the same ternary through the remaining places listed above.

---

## One-line summary for Replit

> Audit the files listed above. The activity type (`run | ride | walk`) is known everywhere these strings appear — it's in props, context, or the `run` record. Use `activityLabel(type, form)` from `contexts/ActivityContext.tsx` for nouns/verbs, and gate pace-vs-speed formatting on `type === "ride"`. Fix `ShareCard.tsx`, `server/ai.ts` prompts, `server/weekly-summary.ts`, `app/run-tracking.tsx` live pace card and coach phrases, `app/run/[id].tsx` leaderboard/Cancel alert, `app/_layout.tsx` rejoin alert, and the `activityIcon()` helper first — those are the user-visible ones.
