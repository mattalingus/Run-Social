# PaceUp Public Routes & Global Map — Implementation Framework

**Date:** 2026-04-17
**Purpose:** Complete spec for Replit to build the public route-sharing system and the global PaceUp map. This replaces M3 in `PACEUP_DEEP_AUDIT.md` with a positive framework instead of just a bug note.

---

## Product summary

Users can save a run/ride/walk route, optionally make it public. The public route map is a global, pannable map behind the login wall, showing:

- Individual polylines (no heatmap overlay) for every public route, colored by activity type.
- Live event pings (running now) that animate.
- Upcoming event pins.
- When a user taps a saved route polyline, an info card opens showing distance, elevation gain, activity type, busyness indicator, and a "busiest times" mini-chart (Google Maps style).

Routes are anonymized — shape only, no runner name attached on the public map.

---

## Decisions locked in

| # | Decision | Value |
|---|---|---|
| 1 | Sharing unit | Polyline + distance + elevation only. No runner identity on the map. |
| 2 | Density visual | No heatmap. Color-coded info card badge instead: green (light), yellow (moderate), orange (sort of busy), red (packed). Plus a Google Maps-style "busiest times" bar chart inside the card. |
| 3 | Privacy zone | Not needed at launch — users who care pick a start point away from their house. |
| 4 | Access | Public map behind login wall. Map is global, pannable, anyone logged in can see all of it. |
| 5 | Scope | Global, not per-city. |
| 6 | Edit after save | Public ↔ private toggle allowed any time. |
| 7 | Activity layers | Runs + walks share one layer, cycling gets its own. Toggleable layer control. |
| 8 | Live events | Animated ping on map when an event is live; tap = live-stats panel. |
| 9 | Upcoming events | Pin on map; tap = event card. Scales concern deferred — fine at launch volume. |

---

## Data model

### New table: `public_routes`

```sql
CREATE TABLE public_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_run_id UUID NOT NULL REFERENCES solo_runs(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('run','walk','ride')),
  layer TEXT NOT NULL CHECK (layer IN ('foot','ride')), -- derived: run+walk→'foot', ride→'ride'
  distance_miles NUMERIC(6,2) NOT NULL,
  elevation_gain_ft INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL, -- from source run, for busyness/time-of-day stats only
  polyline_geom GEOMETRY(LINESTRING, 4326) NOT NULL, -- downsampled, PostGIS
  polyline_length_m NUMERIC(10,2) NOT NULL, -- ST_Length for sanity checks
  start_point GEOGRAPHY(POINT, 4326) NOT NULL, -- for "near me" queries
  bbox GEOMETRY(POLYGON, 4326) NOT NULL, -- for viewport queries
  hash TEXT NOT NULL, -- dedupe near-identical routes (see "Dedupe")
  times_completed INTEGER NOT NULL DEFAULT 1, -- incremented when a new run matches this route
  last_completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_visible BOOLEAN NOT NULL DEFAULT true -- user can toggle off without deleting
);

CREATE INDEX public_routes_bbox_gist ON public_routes USING GIST (bbox);
CREATE INDEX public_routes_start_gist ON public_routes USING GIST (start_point);
CREATE INDEX public_routes_layer_vis ON public_routes (layer, is_visible);
CREATE INDEX public_routes_hash ON public_routes (hash);
```

**Why PostGIS:** Viewport queries (`give me routes whose bbox intersects the user's current map view`) are the hottest query path. A GIST index on `bbox` makes this O(log n). Requires enabling the extension: `CREATE EXTENSION IF NOT EXISTS postgis;`

### New table: `public_route_completions`

Tracks *when* routes get run, so we can show busiest days/times per route. Anonymous — stores no user ID. (That's the privacy promise.)

```sql
CREATE TABLE public_route_completions (
  id BIGSERIAL PRIMARY KEY,
  public_route_id UUID NOT NULL REFERENCES public_routes(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sun
  hour_of_day SMALLINT NOT NULL CHECK (hour_of_day BETWEEN 0 AND 23),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX public_route_completions_route ON public_route_completions (public_route_id);
CREATE INDEX public_route_completions_time ON public_route_completions (public_route_id, day_of_week, hour_of_day);
```

When a user opts-in-public at save time, insert one row here with the *current* run's day-of-week + hour-of-day (in the route's local timezone, which we derive from start_point using `tzdata`-style lookup — or just use the user's device time at save for simplicity at launch).

### Extend `solo_runs`

```sql
ALTER TABLE solo_runs ADD COLUMN is_route_public BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE solo_runs ADD COLUMN public_route_id UUID NULL REFERENCES public_routes(id) ON DELETE SET NULL;
```

Flag on the run so the user's own copy is never lost when they flip to private.

---

## Polyline processing pipeline

**Input:** Raw GPS track, 1 Hz sampling, possibly noisy (see C1 elevation algo fix).

**Processing order (server-side on save):**

### Step 1 — Clean
- Drop any point with `horizontalAccuracy > 20 m`.
- Drop any point whose implied speed vs. previous point exceeds activity ceiling (50 mph run/walk, 60 mph ride) — GPS teleport.
- Drop any point inside a 10m radius of the previous point if there are more than 3 such points in a row (standing still; reduces noise pile-up).

### Step 2 — Downsample
Use **Ramer-Douglas-Peucker (RDP)** with a tolerance that adapts to route length:
- ≤ 3 mi → 3 m tolerance
- 3 – 10 mi → 5 m tolerance
- 10 – 26 mi → 8 m tolerance
- ≥ 26 mi → 12 m tolerance

Target: ≤ 1,000 points per route. Map rendering doesn't benefit from more and the DB bloat savings are massive (500 KB → ~30 KB per route).

Node implementation: `@turf/simplify` with `highQuality: true`.

### Step 3 — Hash for dedupe
Compute a `hash` that identifies "the same route" regardless of which direction someone ran it or slight GPS variation:

```
1. Simplify to ~50 anchor points with heavier RDP.
2. Round each (lat, lng) to 4 decimals (~11 m grid).
3. Sort the 50 points (so direction doesn't matter).
4. Concat → SHA-256 → first 16 hex chars.
```

When a user saves a public route, compute hash. If a row with the same hash + same `layer` exists, **don't create a new `public_routes` row** — instead:
- `UPDATE public_routes SET times_completed = times_completed + 1, last_completed_at = now() WHERE hash = $1 AND layer = $2`
- Insert the `public_route_completions` row pointing at the existing `public_route_id`.
- Point the `solo_runs.public_route_id` at the existing route.

This is what powers the busyness score: the same popular park loop gets run by hundreds of people and `times_completed` climbs. An obscure route stays at 1.

### Step 4 — Bounding box + start point
- `bbox` = ST_Envelope of the simplified linestring.
- `start_point` = first coordinate of the simplified linestring.

---

## Busyness color code

Server-derived at read time (not stored — it drifts), based on `times_completed` in the trailing 90 days:

| Runs in 90d | Color | Label |
|---|---|---|
| 1–4 | 🟢 Green | Light |
| 5–19 | 🟡 Yellow | Moderate |
| 20–74 | 🟠 Orange | Sort of busy |
| ≥ 75 | 🔴 Red | Packed |

Adjust the thresholds after launch based on real data. Expose this as a single field `busyness: 'light' | 'moderate' | 'busy' | 'packed'` on the API response so the client doesn't do math.

For the "busiest times" chart, bucket `public_route_completions` rows by `day_of_week × hour_of_day` in the trailing 90 days, return a 7 × 24 matrix of counts. Client renders as the Google Maps-style vertical bar chart per day.

---

## API endpoints

### `GET /api/map/routes?layer=foot|ride&bbox=sw_lat,sw_lng,ne_lat,ne_lng&limit=500`
Returns public routes whose `bbox` intersects the query bbox. Limit cap at 500 routes per request; client requests more tiles as user pans. Response:
```json
{
  "routes": [
    {
      "id": "...",
      "layer": "foot",
      "activity_type": "run",
      "distance_miles": 4.2,
      "elevation_gain_ft": 85,
      "busyness": "busy",
      "times_completed_90d": 34,
      "polyline": [[lat,lng], ...] // simplified further for initial render
    }
  ]
}
```

**Progressive loading:** At zoomed-out levels (zoom < 12), return a further-simplified polyline (~50 points) so payload stays small. On route tap → fetch full polyline.

### `GET /api/map/routes/:id`
Full route detail: unabridged polyline, elevation profile, busyness matrix (7×24), times_completed 90d, first_seen_at.

### `GET /api/map/events?bbox=...`
Upcoming events + live events whose start point is in the bbox. For live events include a `live: true` flag and `event_id` so the client can link to `/live/:eventId`.

### `POST /api/runs/:id/publish-route`
Body: `{ isPublic: boolean }`
- If `true` and `is_route_public = false`: run the pipeline, insert/dedupe into `public_routes`, flip the flag, return `public_route_id`.
- If `false`: flip `is_route_public = false`. If this was the only run pointing at the public route (`times_completed = 1`), delete the row. Otherwise just decrement `times_completed` and remove the matching completion row (by timestamp of this run).

### `PATCH /api/public-routes/:id/visibility`
Owner-only. Body: `{ visible: boolean }`. Soft-hide without deleting.

---

## Client (React Native / Expo)

Use **`react-native-maps`** (already likely in the project) with a custom tile provider. For polylines, use `<Polyline>` components with:

- Foot layer (run+walk): stroke color `#FF6B35` (orange-red)
- Ride layer: stroke color `#2E86AB` (cycling blue)
- Stroke width: 2.5 at zoom < 14, 4 at zoom ≥ 14
- Opacity scales with `times_completed_90d` — opaque for busy, faded for rare

**Viewport fetching:** Debounce the map's `onRegionChangeComplete` by 300 ms, call `/api/map/routes` with the current bbox + layer toggle state. Cache responses by bbox tile (e.g., snap bbox to 0.05° grid) so panning doesn't refetch the same area.

**Tap handler:** On polyline tap, fetch `/api/map/routes/:id`, open a bottom sheet (`@gorhom/bottom-sheet`):

```
┌──────────────────────────────────┐
│ 🟠 Sort of busy                  │
│                                  │
│ 4.2 mi · 85 ft elev · Run        │
│ Completed 34 times in last 90d   │
│                                  │
│ Busiest times:                   │
│ M  T  W  T  F  S  S              │
│ ▂▄▅▃▂▁▁                          │ (one bar per day, or 24-hr chart)
│                                  │
│ [ Save to My Routes ]            │
│ [ Start a run on this route ]    │
└──────────────────────────────────┘
```

**Live-event ping:** Render as an animated `<Marker>` with a pulsing ring (RN Animated API, infinite loop, scale 1 → 1.5, opacity 0.8 → 0, 1.5s period). Tap routes to `/live/:eventId`.

**Layer toggle:** Simple segmented control top-right of map: `Foot | Ride | Events`. Multi-select, persisted in AsyncStorage.

---

## Save-flow UX

After a run completes and the user hits Save:

```
┌──────────────────────────────────┐
│ Run saved! 🎉                    │
│                                  │
│ Share your route to the public   │
│ PaceUp map?                      │
│                                  │
│ Others can see the path, but     │
│ not your name or pace.           │
│                                  │
│ [ No thanks ]   [ Share route ]  │
└──────────────────────────────────┘
```

If the user taps Share → POST `/api/runs/:id/publish-route`. If pipeline detects a duplicate route, show "Added to a popular route! 34 people have run this." If new, "Your route is now on the map."

On any saved run's detail screen, surface a subtle toggle: `Route is public · tap to make private`.

---

## Scale & performance notes

- At 10k MAU running 4× weekly = 40k runs/week = 2M/year. Most will dedupe; unique routes will plateau in the low tens of thousands per city. PostGIS with GIST index handles 1M+ rows comfortably.
- Viewport query with bbox index typically returns in < 20 ms for 500 routes.
- Simplified polylines average ~200 points × 16 bytes = ~3 KB per route. 500 routes per viewport = 1.5 MB response — compress with gzip (standard Express middleware) → ~300 KB over the wire. Acceptable.
- If/when it becomes a problem, move to vector tiles (Mapbox GL / MapLibre) and generate pre-rendered tile sets with `tippecanoe`. That's a future optimization — don't premature-optimize.

---

## What NOT to build at launch (explicit descope)

- No heatmap overlay.
- No privacy zones (per your decision).
- No segments/KOM-style leaderboards on route segments. (Huge feature, build separately later.)
- No off-map route creation ("draw a route to run later"). Only routes derived from completed runs for v1.
- No directionality indicators on routes. (The dedupe treats A→B and B→A as the same route on purpose.)
- No clusters/super-markers at very zoomed-out levels. If the map gets too dense, just increase the minimum zoom level at which polylines render (e.g., zoom ≥ 10); show only event pins at country-level zoom.

---

## Build order for Replit

**Phase 1 — Core shape (1–2 weeks of work):**
1. Enable PostGIS, create tables, indexes.
2. Build the save-pipeline: clean → RDP simplify → hash → insert/dedupe.
3. Build `POST /api/runs/:id/publish-route` and the save-flow modal.
4. Build `GET /api/map/routes?bbox=...&layer=...`.
5. Client map screen with layer toggle, polyline rendering, viewport fetching with debounce.
6. Tap → bottom sheet with distance/elevation/busyness badge (busiest-times chart deferred).

**Phase 2 — Busyness depth (1 week):**
7. `public_route_completions` busyness matrix endpoint.
8. Busiest-times chart in bottom sheet.
9. Further-simplified polylines for zoomed-out views.

**Phase 3 — Events on map (1 week):**
10. `GET /api/map/events?bbox=...`.
11. Event pins + live pulsing markers.
12. Tap live pin → link to `/live/:eventId`.

**Phase 4 — Polish:**
13. Owner visibility toggle on run detail.
14. Response caching by bbox tile on the client.
15. Gzip middleware if not enabled.

---

## Open questions for Matthew

1. **Elevation profile in the bottom sheet** — want a mini elevation chart (x = distance, y = elevation) rendered too? It's ~20 extra lines of client code and uses data we're already storing.
2. **"Run this route" button** — when tapped, should it pre-load the polyline into the run-tracking screen as a guide overlay so the user can follow it? (This is ~1 week of extra work but is a killer feature Strava charges for.)
3. **Downvote / report a bad route** — some routes will get saved accidentally (GPS garbage, run through a building, etc.). Should there be a "this route looks wrong" report button tied to the same report system we're adding for users/comments? Three reports auto-hides it from the public map. Recommended yes, cheap to add.

Let me know and I'll fold those into the spec.
