function daysFromNow(d: number, hour = 7, min = 0) {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  dt.setHours(hour, min, 0, 0);
  return dt.toISOString();
}

export interface MockRun {
  id: string;
  title: string;
  host_id: string;
  host_name: string;
  host_rating: number;
  host_rating_count: number;
  date: string;
  location_lat: number;
  location_lng: number;
  location_name: string;
  min_distance: number;
  max_distance: number;
  min_pace: number;
  max_pace: number;
  tags: string[];
  participant_count: number;
  max_participants: number;
  privacy: string;
  host_hosted_runs: number;
  is_active: boolean;
  is_completed: boolean;
  run_style: string;
  activity_type: string;
  plan_count: string;
}

export interface MockCrew {
  id: string;
  name: string;
  description: string;
  emoji: string;
  created_by: string;
  created_at: string;
  member_count: number;
  created_by_name: string;
  run_style: string;
  tags: string[];
}

export const MOCK_EVENT: MockRun = {
  id: "walkthrough-mock-event-1",
  title: "Saturday Morning 5K — City Park",
  host_id: "mock-host-1",
  host_name: "Alex Rivera",
  host_rating: 4.8,
  host_rating_count: 12,
  date: daysFromNow(2, 7, 30),
  location_lat: 29.7604,
  location_lng: -95.3698,
  location_name: "City Park Loop",
  min_distance: 3.0,
  max_distance: 5.0,
  min_pace: 8.5,
  max_pace: 11.0,
  tags: ["Beginner Friendly", "Morning Run", "Social After"],
  participant_count: 6,
  max_participants: 20,
  privacy: "public",
  host_hosted_runs: 15,
  is_active: false,
  is_completed: false,
  run_style: "Easy Pace",
  activity_type: "run",
  plan_count: "6",
};

export const MOCK_CREW: MockCrew = {
  id: "walkthrough-mock-crew-1",
  name: "Morning Movers",
  description: "Early risers who love to start the day with a group run. All paces welcome!",
  emoji: "🌅",
  created_by: "mock-host-1",
  created_at: new Date().toISOString(),
  member_count: 8,
  created_by_name: "Alex Rivera",
  run_style: "Easy Pace",
  tags: ["Beginner Friendly", "Morning Run"],
};
