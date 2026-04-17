# PaceUp — Cycling Conventions Audit

**Purpose:** run-centric design patterns that shouldn't apply to rides. Cyclists think in different units, different distances, and different goals than runners. This audit lists every place the app forces running conventions onto rides.

---

## Quick primer — how cyclists actually measure rides

| Concept | Runners use | Cyclists use |
|---|---|---|
| Intensity unit | **Pace** (min/mile, e.g. 8:30/mi) | **Speed** (mph or km/h, e.g. 18 mph) |
| Common distances | 5K, 10K, half marathon, marathon | 25 mi, 50 mi (half century), **100 km (metric century)**, 100 mi (century), 200 mi |
| Progression metric | Negative splits, pace PRs | Avg speed, climbing feet, longest ride |
| Callouts during activity | Mile splits | Not really — cyclists care about avg speed and elevation; mile-by-mile audio is not a thing |
| "Fast" benchmark | Sub-7 min/mi (elite) | 18–20+ mph (strong road); 25+ mph (elite) |
| Duration norms | 30 min to 4h | 1h to 6h+ is normal |
| Key environmental metric | Elevation gain (nice-to-have) | **Elevation gain is central** — "how much did I climb" |
| Cadence | Steps/minute (SPM) | Pedal RPM |
| Typical group structure | Pace groups (9:00, 10:00) | "A/B/C ride" by avg speed (A=18+, B=15–17, C=<15) or "drop / no-drop" |

---

## 1. Solo distance presets are running distances — HIGH

**File: `app/(tabs)/solo.tsx:382–388`**

```ts
const DISTANCE_CATEGORIES = [
  { label: "1 Mile", miles: 1.0, tolerance: 0.15 },
  { label: "2 Miles", miles: 2.0, tolerance: 0.2 },
  { label: "5K",      miles: 3.1, tolerance: 0.25 },
  { label: "5 Miles", miles: 5.0, tolerance: 0.3 },
  { label: "10K",     miles: 6.2, tolerance: 0.35 },
];
```

This is used for the personal rankings UI ("your best time at 5K") on the Solo tab. **For a cyclist, "a 5K" is a 10-minute warmup** — it's not a benchmark distance. A cyclist's rankings should be built around 10 mi, 25 mi, 50 mi (half century), 100 km (metric century), 100 mi (century).

**Fix:** the constant should switch by `activityFilter`. Suggested ride presets:

```ts
RIDE_CATEGORIES = [
  { label: "10 mi",  miles: 10 },
  { label: "25 mi",  miles: 25 },
  { label: "50 mi",  miles: 50 },   // Half Century
  { label: "100 km", miles: 62.14 },// Metric Century
  { label: "100 mi", miles: 100 },  // Century
];
```

---

## 2. Personal rankings SQL hardcodes running distances — HIGH

**File: `server/storage.ts:1418–1427`**

The `getPersonalRankings` query buckets all activities into run distance categories:

```sql
SELECT id, '½ mi' AS label ...
UNION ALL SELECT id, '1 mi' ...
UNION ALL SELECT id, '2 mi' ...
UNION ALL SELECT id, '5K' ...
UNION ALL SELECT id, '5 mi' ...
UNION ALL SELECT id, '10K' ...
UNION ALL SELECT id, 'Half' ...      -- 13.1 mi
UNION ALL SELECT id, 'Marathon' ...  -- 26.2 mi
```

And it's ranked by `pace_min_per_mile ASC` (lower pace = better). For rides this is **doubly wrong**: the distance buckets are all <26 mi (tiny for cycling), and ranking by pace gives nonsensical results since a faster ride has a lower min/mi value but the label ("Marathon") is meaningless for a bike.

**Fix:** split the query by activity type or feed `activityType` into it and swap the WITH clauses for ride categories ranked by `avg_speed_mph DESC` (or by `pace_min_per_mile ASC` with ride-appropriate distance buckets).

---

## 3. Marathoner & 5K Crusher achievements fire on rides — HIGH

**File: `server/storage.ts:2824–2825`**

```ts
if (maxMiles >= 13.1) await awardSlug(userId, "half_marathon", db);
if (maxMiles >= 26.2) await awardSlug(userId, "marathoner", db);
```

There's no activity-type guard here. If a user rides >26.2 miles (trivial for a cyclist — that's ~90 minutes of riding) they get awarded the **"Marathoner"** achievement. Check how `maxMiles` is computed — if it's filtered to runs only, great, but the function should explicitly scope to `activity_type = 'run'`.

Same concern applies to any achievement with `activityType: "run"` being awarded off `completed_runs` when the underlying query may include rides or walks. Audit `server/storage.ts` everywhere a `progressKey` like `max_single_run_miles_x10`, `total_miles`, `completed_runs`, `unique_locations` is calculated — make sure they filter by `activity_type = 'run'`.

---

## 4. Ride achievements misuse pace — HIGH

**File: `constants/achievements.ts`**

### 4a. "Speed Demon" — line 615–627

```ts
{
  slug: "speedster_ride",
  name: "Speed Demon",
  desc: "Complete a ride averaging under 20 min/mi pace.",
  progressKey: "has_fast_ride",
},
```

**20 min/mile = 3 mph. Walking speed.** Any bike ride ever qualifies. This is the sole "Speed" achievement for rides and it's meaningless. Real cycling speed benchmarks:

- Casual: 10–13 mph avg
- Fit rider: 15–18 mph avg
- Strong road: 18–22 mph avg
- Racer: 22+ mph avg

Replace with tiered speed achievements (Strong Rider 15+ mph, Fast 18+ mph, Blazing 22+ mph).

### 4b. "Pace Perfect (Ride)" — line 699–712

```ts
desc: "Match the advertised ride pace within ±10 seconds."
```

Cyclists don't join rides with a "pace" target. Group rides are advertised as "avg 16–18 mph" or "B group / no-drop". Either replace with a speed-based equivalent or remove and replace with a climbing/elevation achievement.

### 4c. Missing cycling-native achievements

The ride tree has 18 achievements but no climbing category — which is the **#1 thing cyclists brag about** on Strava. Suggest adding:

- `climbing_1000` — Climb 1,000 ft in a single ride
- `climbing_5000` — Climb 5,000 ft in a single ride
- `everest_challenge` — 29,029 ft total climbed (joke goal)
- `metric_century` — 100 km in one ride (this is THE canonical ride distance and it's missing)
- `long_ride_2h`, `long_ride_4h` — Time-based achievements (cyclists think in ride duration more than runners do)

### 4d. Ride badges use wrong icon — line 504

```ts
{ slug: "ride_crew_builder", ..., icon: "fitness" }
```

Generic dumbbell icon on a cycling achievement. Should be `bicycle` or `bicycle-sharp`.

---

## 5. Audio coach during a ride is pure running speak — HIGH

**File: `app/run-tracking.tsx:130–240`**

Even after fixing the "per mile" language issue from the label audit, the whole coach script is built around running milestones:

### 5a. 5K / 10K milestone callouts (lines 143–152)

```ts
if (is10K) distLine = pick([
  "Ten K done.", "You've hit 10K.", "Ten kilometers.", ...
]);
else if (is5K) distLine = pick(["5K mark.", "Three point one miles.", ...]);
```

On a 40-mile ride the coach will say "5K mark!" at ~15 minutes in. Useless for a cyclist. Ride callouts should be at 10 mi, 25 mi, 50 mi, or more likely time-based (every 15 min).

### 5b. Every mile pace callouts (pace lines 203–240)

Running races are paced by the mile. Cycling isn't — a cyclist checks avg speed occasionally, not every mile. A mile on a bike passes in ~3 minutes so the coach would be talking constantly.

**Fix:** for rides, switch to one of:
- Avg speed callouts every 5 miles or every 15 minutes
- Elevation callouts when a climb is completed
- Elapsed-time callouts (every 30 minutes)

### 5c. Pace context thresholds (lines 244–249) assume running pace

```ts
if (paceMinTotal < 6.5)  paceContext = "That's a quick clip."
else if (paceMinTotal < 7.5) paceContext = "Good speed."
else if (paceMinTotal > 13)  paceContext = "Easy effort."
```

For a ride at 20 mph, `paceMinTotal` is 3.0 — below 6.5 — so every single audio cue will say "That's a quick clip" for any ride going faster than 9 mph. Not broken, just meaningless.

---

## 6. Run-tracking split/milestone config is running-only — HIGH

**File: `app/run-tracking.tsx:383–387`** (already flagged in UI audit, reframing here):

Split triggers are 1 mi / 2 mi / 5K. For a cyclist those fire every 3–10 minutes of riding. The tracker treats every mile on a bike like a track lap. Should switch to ride-appropriate intervals (5 mi / 10 mi / 25 mi) or time-based (every 15 min).

---

## 7. Hosted events — pace group mechanic doesn't fit cycling — HIGH

**File: `app/run/[id].tsx:1750–1760`** + create-run flow

Hosted events have a `pace_groups` structure where runners join a group like "9:00–10:00 min/mi". The sheet title is *"Pick Your Pace Group"* and the explainer says *"Choose the group that best matches your pace."*

**This doesn't map to group rides.** Group rides are organized by:
- **Speed group** ("A ride 18+ mph", "B ride 15–17 mph", "C ride <15 mph")
- **Drop policy** ("drop" / "no-drop" / "regroup at hills")
- **Ride style** ("endurance", "chase", "training")

**Fix:** For ride events, either:
1. Switch the groups UI to speed-based labels (A/B/C or mph ranges), or
2. Replace pace groups with a single "pace" field + a "no-drop" toggle.

At minimum the sheet title should read "Pick Your Speed Group" when `activity_type === "ride"`.

Same issue in create-run flow where a host sets min/max pace — for rides the host is really setting min/max **speed**, and the input format (min/mi) is wrong.

### 7a. Strict pace bounds on ride events — `app/run/[id].tsx:870`

```tsx
<Text style={styles.reqLabel}>{`Pace (min/${unitLabel(distUnit)})`}</Text>
```

For a ride this should read `Speed (mph)` and the underlying values should be speed in mph, not pace in min/mi.

---

## 8. Profile & goals — monthly mile goal is neutral but framing is run-first — MED

**File: `shared/schema.ts:32`** + `app/onboarding.tsx:42`

```ts
monthlyGoal: real("monthly_goal").default(50)
```

50 miles/month is a reasonable running goal and laughably low for cycling (a regular cyclist does 50 miles in one Saturday). The default in `onboarding.tsx` is `"50"` regardless of chosen activity.

**Fix:** onboarding should set a smart default based on the user's selected activity:
- Run: 50 mi/mo
- Walk: 30 mi/mo
- Ride: 200 mi/mo (or more)

Widget plugin (`plugins/with-widget.js:114, with-paceup-widget-extension.js:380`) also hardcodes `monthlyGoal: 50`.

### 8a. `paceGoal` column stores a pace for all activity types

**File: `server/storage.ts:3311–3316`** — `updateGoals` accepts `paceGoal` as a single number and stores it as min/mi. For a cyclist this is the wrong axis entirely (should be a speed goal in mph).

---

## 9. Seed data is all runs — LOW

**File: `server/seed-demo.ts:479, 491, 704, 841, etc.**

Every seeded event is a run (`"Hermann Park 5K"`, `"6×800m at 5K race pace"`, etc.) and every crew message references PRs on runs. Demo / walkthrough data should include at least one ride event so that reviewers/testers see what a cyclist's experience looks like.

**File: `lib/walkthroughConfig.ts:92`**

```ts
description: "See how you stack up! Rankings track your best times across popular distances like 1 Mile, 5K, and 10K."
```

Onboarding walkthrough tells a cyclist their rankings will be at 1 mi / 5K / 10K. Misleading.

**File: `lib/walkthroughConfig.ts:120`**

```ts
description: "Earn badges as you hit milestones — your first run, a 5K PR, a streak, and more. You're all set!"
```

Should adapt: "your first ride, a century, 1000 ft climbed..." for a ride-focused user.

---

## 10. Widgets — "mi/wk" progress is fine, label framing isn't — MED

**File: `plugins/with-widget.js:277`** (iOS), **`with-android-widget.js:425`**

```swift
Text(String(format: "%.0f%% of %.0f mi/wk", ...))
```

The "miles per week" format is fine for any activity — mileage is unit-neutral. But the home widget doesn't indicate whether the numbers reflect runs, rides, walks, or all three. A cyclist will see "25% of 12 mi/wk" based on their running goal and be confused.

---

## 11. Copy that quietly assumes running — MED

Gathered during the audit. Each of these should adapt or be rephrased:

- `app/(tabs)/index.tsx:2421` — onboarding slide: *"Join Hosted Runs and Rides"* (still drops walks)
- `app/(tabs)/index.tsx:3228` — host guidelines fallback: *"No runner should feel unwelcome..."*
- `app/run-tracking.tsx:1574` — onboarding tip: *"Enjoy the pace, the people, and the miles."*
- `server/ai.ts:19` — system prompt: *"You are an elite AI running coach..."*
- `server/ai.ts:43` — crew recap prompt: *"assistant for a running crew"*
- `app/map.tsx:487` — event pin label: *"5K in 30m"* (hardcoded "5K" — shouldn't be shown for ride events)

---

## 12. Things that are actually fine for all activity types

For reference, these work equally well for runs/walks/rides and don't need changes:

- Total miles / weekly miles / monthly miles
- Route map + elevation chart (when elevation is shown)
- Streak counts (day-based, unit-neutral)
- Social features (friends, crews, chat, photos)
- Attendance/reliability achievements (`reliable_50`, `reliable_65`, `reliable_80`, `reliable_90`)

---

## Priority fix order

1. **Solo `DISTANCE_CATEGORIES` + rankings SQL** — switch to ride-appropriate buckets when activity is ride. Same for the Marathoner/Half auto-awards.
2. **Audio coach for rides** — either disable the pace/mile coach entirely for rides, or rewrite with speed + elevation + time callouts.
3. **Hosted event "pace group" for rides** — relabel as Speed Group, store mph, rename create-run fields.
4. **Ride achievements overhaul** — remove "Speed Demon" (3 mph threshold), add climbing tier, add Metric Century. Re-icon "Ride Organizer" and other "fitness"-icon badges.
5. **Pace-per-mile speech phrases** — already flagged in the UI label audit; fix together with coach script rewrite.
6. **Monthly goal default + widget** — make activity-aware default.
7. **Copy cleanups** — AI prompts, walkthrough copy, notifications, onboarding slides.

---

## Summary

PaceUp is a running app that added ride/walk support by mostly swapping nouns. The foundations (units, achievements, distance categories, audio coach, pace-group UX) are still tuned for runners. The biggest tells: a cyclist who rides 100 miles gets awarded "Marathoner," the "Speed Demon" ride badge fires on any ride because it gates on a walking speed, and the audio coach literally shouts "5K mark!" halfway into a bike ride.

The fixes are mostly additive — add ride-specific distance constants, ride-specific achievements, ride-specific coach script — rather than structural rewrites. Do them in the order above and the ride UX stops feeling like a run UX with a bicycle icon.
