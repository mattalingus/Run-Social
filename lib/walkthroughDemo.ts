/**
 * Seeded walkthrough demo data. Only injected while the tour is active so
 * new users can see the full flow (event cards, crew, history, map pins)
 * even before they have any real data. Every demo item has `__demo: true`
 * so code paths can skip mutations / real navigation.
 */

import type { ActivityType } from "@/contexts/ActivityContext";

export const DEMO_USER_ID = "demo-host-pace-up";
export const DEMO_EVENT_ID = "demo-event-sunrise";
export const DEMO_CREW_ID = "demo-crew-morning-milers";
export const DEMO_SOLO_RUN_ID = "demo-solo-weekend-loop";

const now = () => new Date();
const inHours = (h: number) => {
  const d = now();
  d.setHours(d.getHours() + h);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
};
const daysAgo = (d: number) => {
  const x = now();
  x.setDate(x.getDate() - d);
  return x.toISOString();
};

function activityLabel(a: ActivityType) {
  if (a === "ride") return { noun: "Ride", distance: 18, pace: 3.5, paceMax: 3.2, title: "Sunrise Harbor Loop" };
  if (a === "walk") return { noun: "Walk", distance: 3.5, pace: 14.5, paceMax: 13.5, title: "Sunrise Park Loop" };
  return { noun: "Run", distance: 5.0, pace: 9.0, paceMax: 8.0, title: "Sunrise Park Loop" };
}

/** Nice demo route path — a small oval loop, used for mini-map thumbnails. */
const DEMO_ROUTE_PATH = [
  { latitude: 37.7849, longitude: -122.4094 },
  { latitude: 37.7852, longitude: -122.4088 },
  { latitude: 37.7858, longitude: -122.4082 },
  { latitude: 37.7863, longitude: -122.4075 },
  { latitude: 37.7866, longitude: -122.4068 },
  { latitude: 37.7868, longitude: -122.4060 },
  { latitude: 37.7867, longitude: -122.4052 },
  { latitude: 37.7863, longitude: -122.4046 },
  { latitude: 37.7857, longitude: -122.4044 },
  { latitude: 37.7850, longitude: -122.4046 },
  { latitude: 37.7845, longitude: -122.4052 },
  { latitude: 37.7842, longitude: -122.4060 },
  { latitude: 37.7842, longitude: -122.4068 },
  { latitude: 37.7843, longitude: -122.4076 },
  { latitude: 37.7846, longitude: -122.4084 },
  { latitude: 37.7849, longitude: -122.4094 },
];

export function getDemoEventCard(activity: ActivityType, userLat?: number, userLng?: number): any {
  const L = activityLabel(activity);
  // Place pin ~0.3 mi from the user if we have their location, else SF fallback.
  const lat = (userLat ?? 37.7849) + 0.004;
  const lng = (userLng ?? -122.4094) + 0.004;
  return {
    __demo: true,
    id: DEMO_EVENT_ID,
    title: `${L.title}`,
    host_id: DEMO_USER_ID,
    host_name: "PaceUp Demo Host",
    host_rating: 4.9,
    host_rating_count: 42,
    host_hosted_runs: 12,
    host_photo: undefined,
    date: inHours(2),
    location_lat: lat,
    location_lng: lng,
    location_name: "Marina Green Park",
    min_distance: L.distance,
    max_distance: L.distance,
    min_pace: L.paceMax,
    max_pace: L.pace,
    tags: ["Social", "Beginners Welcome", "Scenic"],
    participant_count: 8,
    max_participants: 20,
    privacy: "public",
    crew_photo_url: null,
    is_active: false,
    is_completed: false,
    run_style: "Social",
    activity_type: activity,
    crew_id: null,
    crew_name: null,
    crew_emoji: null,
    pace_groups: null,
    plan_count: "8",
    user_is_crew_member: false,
    timezone: null,
    route_path: DEMO_ROUTE_PATH,
  };
}

export function getDemoCrew(activity: ActivityType): any {
  const isRide = activity === "ride";
  const isWalk = activity === "walk";
  return {
    __demo: true,
    id: DEMO_CREW_ID,
    name: isRide ? "Weekend Warriors Cycling" : isWalk ? "Sunset Striders" : "Morning Milers",
    description: isRide
      ? "Saturday group rides, coffee after. All levels welcome."
      : isWalk
      ? "Evening strolls with good company — no pace pressure."
      : "Dawn patrol. We run before the rest of the world wakes up.",
    emoji: isRide ? "🚴" : isWalk ? "🚶" : "🏃",
    image_url: undefined,
    created_by: DEMO_USER_ID,
    created_at: daysAgo(120),
    member_count: 24,
    created_by_name: "PaceUp Demo Host",
    run_style: "Social",
    tags: isRide
      ? ["Road Cycling", "Social", "No Drop"]
      : isWalk
      ? ["Social", "Chill Pace", "Co-Ed"]
      : ["Morning Runs", "Social", "Beginners Welcome"],
    pending_request_count: 0,
    chat_muted: false,
    subscription_tier: "community",
  };
}

export function getDemoHistoryRun(activity: ActivityType): any {
  const L = activityLabel(activity);
  const dist = activity === "ride" ? 22.4 : activity === "walk" ? 3.1 : 5.2;
  const pace = activity === "ride" ? 3.3 : activity === "walk" ? 14.2 : 8.45;
  const dur = Math.round(dist * pace * 60);
  return {
    __demo: true,
    id: DEMO_SOLO_RUN_ID,
    type: "solo",
    title: `Saturday ${L.noun}`,
    date: daysAgo(2),
    distance_miles: dist,
    pace_min_per_mile: pace,
    duration_seconds: dur,
    elevation_gain_ft: 142,
    step_count: activity === "ride" ? null : Math.round(dist * 2100),
    move_time_seconds: dur - 30,
    distance_tier: 1,
    route_path: DEMO_ROUTE_PATH,
    mile_splits: [
      { label: "Mile 1", paceMinPerMile: pace + 0.3, isPartial: false },
      { label: "Mile 2", paceMinPerMile: pace + 0.1, isPartial: false },
      { label: "Mile 3", paceMinPerMile: pace - 0.1, isPartial: false },
      { label: "Mile 4", paceMinPerMile: pace - 0.2, isPartial: false },
      { label: "Mile 5", paceMinPerMile: pace - 0.4, isPartial: false },
    ],
    activity_type: activity,
    is_starred: true,
    host_name: undefined,
    is_host: false,
  };
}

export const DEMO_SAVED_PATH_ID = "demo-saved-path";

export function getDemoSavedPath(activity: ActivityType): any {
  const L = activityLabel(activity);
  return {
    __demo: true,
    id: DEMO_SAVED_PATH_ID,
    name: activity === "ride" ? "Marina Loop" : activity === "walk" ? "Park Loop" : "Neighborhood Loop",
    distance_miles: L.distance * 0.6,
    activity_type: activity,
    route_path: DEMO_ROUTE_PATH,
    created_at: daysAgo(10),
  };
}

export function isDemoId(id: string | undefined | null): boolean {
  if (!id) return false;
  return id === DEMO_EVENT_ID || id === DEMO_CREW_ID || id === DEMO_SOLO_RUN_ID || id.startsWith("demo-");
}
