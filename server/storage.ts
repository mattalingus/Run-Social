import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computePathDistanceKm(coords: Array<{ latitude: number; longitude: number }>): number {
  let dist = 0;
  for (let i = 1; i < coords.length; i++) {
    dist += haversineKm(coords[i - 1].latitude, coords[i - 1].longitude, coords[i].latitude, coords[i].longitude);
  }
  return dist;
}

function deduplicateRoutePath(coords: Array<{ latitude: number; longitude: number }>): {
  path: Array<{ latitude: number; longitude: number }>;
  distanceMiles: number;
  loopDetected: boolean;
} {
  const totalDistKm = computePathDistanceKm(coords);
  const distanceMiles = totalDistKm / 1.60934;

  if (coords.length < 6 || totalDistKm < 0.3) {
    return { path: coords, distanceMiles, loopDetected: false };
  }

  // Build cumulative distance array so we can compute gap between any two points efficiently
  const cumDist: number[] = [0];
  for (let k = 1; k < coords.length; k++) {
    cumDist.push(
      cumDist[k - 1] + haversineKm(
        coords[k - 1].latitude, coords[k - 1].longitude,
        coords[k].latitude, coords[k].longitude
      )
    );
  }

  const THRESHOLD_KM = 0.012; // 12 m proximity (consumer GPS jitter) to call it a "return"
  const MIN_GAP_KM = 0.3;     // must have traveled ≥300m since the anchor point
  const START_WINDOW = Math.min(10, coords.length); // only treat closure against the actual start

  // Find the earliest i where point i returns within THRESHOLD_KM of one of the first START_WINDOW points.
  let closureAt = -1; // index i where closure first occurs
  let closureAnchor = -1; // index j of the anchor point

  outer:
  for (let i = 3; i < coords.length; i++) {
    for (let j = 0; j < Math.min(START_WINDOW, i); j++) {
      const gap = cumDist[i] - cumDist[j];
      if (gap < MIN_GAP_KM) continue;
      const d = haversineKm(
        coords[i].latitude, coords[i].longitude,
        coords[j].latitude, coords[j].longitude
      );
      if (d < THRESHOLD_KM) {
        closureAt = i;
        closureAnchor = j;
        break outer;
      }
    }
  }

  if (closureAt < 0) {
    return { path: coords, distanceMiles, loopDetected: false };
  }

  // Trim to the first non-repeating portion: from start up to and including the closure point.
  // Then append the anchor coordinate so the route closes cleanly without a visible gap.
  const trimmed = coords.slice(0, closureAt + 1);
  trimmed.push({ latitude: coords[closureAnchor].latitude, longitude: coords[closureAnchor].longitude });
  const trimmedMiles = computePathDistanceKm(trimmed) / 1.60934;

  // Safety floor: if we trimmed more than 5% of the route, likely GPS noise, not a real loop.
  if (trimmedMiles < distanceMiles * 0.95) {
    return { path: coords, distanceMiles, loopDetected: false };
  }

  return { path: trimmed, distanceMiles: trimmedMiles, loopDetected: true };
}

export async function initDb() {
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'run_privacy') THEN
        CREATE TYPE run_privacy AS ENUM ('public', 'private', 'solo');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('runner', 'host');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'participant_status') THEN
        CREATE TYPE participant_status AS ENUM ('joined', 'confirmed', 'cancelled', 'pending');
      END IF;
    END $$;

    ALTER TYPE participant_status ADD VALUE IF NOT EXISTS 'pending';
    ALTER TYPE participant_status ADD VALUE IF NOT EXISTS 'dnf';

    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      username TEXT UNIQUE,
      photo_url TEXT,
      avg_pace REAL DEFAULT 10,
      avg_distance REAL DEFAULT 3,
      total_miles REAL DEFAULT 0,
      miles_this_year REAL DEFAULT 0,
      miles_this_month REAL DEFAULT 0,
      monthly_goal REAL DEFAULT 50,
      yearly_goal REAL DEFAULT 500,
      completed_runs INTEGER DEFAULT 0,
      hosted_runs INTEGER DEFAULT 0,
      host_unlocked BOOLEAN DEFAULT false,
      role user_role DEFAULT 'runner',
      avg_rating REAL DEFAULT 0,
      rating_count INTEGER DEFAULT 0,
      notifications_enabled BOOLEAN DEFAULT true,
      strava_id TEXT,
      apple_health_id TEXT,
      garmin_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS runs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      host_id VARCHAR NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      description TEXT,
      privacy run_privacy DEFAULT 'public',
      date TIMESTAMP NOT NULL,
      location_lat REAL NOT NULL,
      location_lng REAL NOT NULL,
      location_name TEXT NOT NULL,
      min_distance REAL NOT NULL,
      max_distance REAL NOT NULL,
      min_pace REAL NOT NULL,
      max_pace REAL NOT NULL,
      tags TEXT[] DEFAULT '{}',
      is_completed BOOLEAN DEFAULT false,
      max_participants INTEGER DEFAULT 20,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS run_participants (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id VARCHAR NOT NULL REFERENCES runs(id),
      user_id VARCHAR NOT NULL REFERENCES users(id),
      status participant_status DEFAULT 'joined',
      joined_at TIMESTAMP DEFAULT NOW(),
      miles_logged REAL
    );

    CREATE TABLE IF NOT EXISTS host_ratings (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id VARCHAR NOT NULL REFERENCES runs(id),
      host_id VARCHAR NOT NULL REFERENCES users(id),
      rater_id VARCHAR NOT NULL REFERENCES users(id),
      stars INTEGER NOT NULL,
      tags TEXT[] DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT DEFAULT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS marker_icon TEXT DEFAULT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS pace_goal REAL DEFAULT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS distance_goal REAL DEFAULT 100;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS goal_period VARCHAR DEFAULT 'monthly';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT DEFAULT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS name_changed_at TIMESTAMPTZ DEFAULT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS username_change_count INT DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS distance_unit VARCHAR DEFAULT 'miles';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_privacy VARCHAR DEFAULT 'public';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_run_reminders BOOLEAN DEFAULT true;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_friend_requests BOOLEAN DEFAULT true;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_crew_activity BOOLEAN DEFAULT true;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_weekly_summary BOOLEAN DEFAULT true;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS show_run_routes BOOLEAN DEFAULT true;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT DEFAULT NULL;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS is_strict BOOLEAN DEFAULT false;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS run_style TEXT DEFAULT NULL;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS activity_type TEXT DEFAULT 'run';
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS notif_late_start_sent BOOLEAN DEFAULT false;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS notif_pre_run_sent BOOLEAN DEFAULT false;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
    ALTER TABLE users ALTER COLUMN avg_pace SET DEFAULT NULL;
    ALTER TABLE users ALTER COLUMN avg_distance SET DEFAULT NULL;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS mile_splits JSONB DEFAULT NULL;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS client_run_id TEXT DEFAULT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_solo_runs_client_run_id ON solo_runs (user_id, client_run_id) WHERE client_run_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS run_notification_hidden (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL,
      hidden_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, run_id)
    );

    CREATE TABLE IF NOT EXISTS solo_runs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT,
      date TIMESTAMP NOT NULL,
      distance_miles REAL NOT NULL,
      pace_min_per_mile REAL,
      duration_seconds INTEGER,
      completed BOOLEAN DEFAULT false,
      planned BOOLEAN DEFAULT false,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS route_path JSONB DEFAULT NULL;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS activity_type TEXT DEFAULT 'run';
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS is_starred BOOLEAN DEFAULT false;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS elevation_gain_ft REAL;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS ai_summary TEXT;

    CREATE TABLE IF NOT EXISTS friends (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      requester_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(requester_id, addressee_id)
    );
    ALTER TABLE friends ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP DEFAULT NULL;

    CREATE TABLE IF NOT EXISTS run_invites (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id VARCHAR NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      invitee_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invited_by VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(run_id, invitee_id)
    );

    ALTER TABLE runs ADD COLUMN IF NOT EXISTS invite_token TEXT DEFAULT NULL;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS invite_password TEXT DEFAULT NULL;

    ALTER TABLE achievements ADD COLUMN IF NOT EXISTS slug VARCHAR DEFAULT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_read_at TIMESTAMP DEFAULT NULL;

    ALTER TABLE runs ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;
    ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS is_present BOOLEAN DEFAULT false;
    ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS final_distance REAL;
    ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS final_pace REAL;
    ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS final_rank INTEGER;
    ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS abandoned BOOLEAN DEFAULT false;
    CREATE UNIQUE INDEX IF NOT EXISTS run_participants_run_user_unique ON run_participants (run_id, user_id);
    CREATE INDEX IF NOT EXISTS run_participants_abandoned_idx ON run_participants (abandoned);

    CREATE TABLE IF NOT EXISTS run_tracking_points (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id VARCHAR NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      cumulative_distance REAL DEFAULT 0,
      pace REAL DEFAULT 0,
      recorded_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS saved_paths (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      route_path JSONB NOT NULL,
      distance_miles REAL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS saved_path_id VARCHAR REFERENCES saved_paths(id) ON DELETE SET NULL;
    ALTER TABLE saved_paths ADD COLUMN IF NOT EXISTS activity_type TEXT DEFAULT 'run';
    ALTER TABLE saved_paths ADD COLUMN IF NOT EXISTS activity_types TEXT[];

    CREATE TABLE IF NOT EXISTS bookmarked_runs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      run_id VARCHAR NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, run_id)
    );

    CREATE TABLE IF NOT EXISTS planned_runs (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      run_id VARCHAR NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, run_id)
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL REFERENCES users(id),
      milestone INTEGER NOT NULL,
      earned_at TIMESTAMP DEFAULT NOW(),
      reward_eligible BOOLEAN DEFAULT true,
      reward_claimed BOOLEAN DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS community_paths (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      route_path JSONB NOT NULL,
      distance_miles REAL,
      contributor_count INTEGER DEFAULT 1,
      start_lat REAL NOT NULL,
      start_lng REAL NOT NULL,
      end_lat REAL NOT NULL,
      end_lng REAL NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS path_contributions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      community_path_id VARCHAR NOT NULL REFERENCES community_paths(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      saved_path_id VARCHAR REFERENCES saved_paths(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(community_path_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS run_photos (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id VARCHAR NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      photo_url TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS solo_run_photos (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      solo_run_id VARCHAR NOT NULL REFERENCES solo_runs(id) ON DELETE CASCADE,
      photo_url TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE runs ADD COLUMN IF NOT EXISTS crew_id VARCHAR REFERENCES crews(id) ON DELETE SET NULL;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS crew_vibe VARCHAR(30) DEFAULT NULL;
    ALTER TABLE crews ADD COLUMN IF NOT EXISTS run_style TEXT DEFAULT NULL;
    ALTER TABLE crews ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

    CREATE TABLE IF NOT EXISTS crews (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT,
      emoji TEXT DEFAULT '🏃',
      created_by VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS crew_members (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      crew_id VARCHAR NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'pending',
      invited_by VARCHAR REFERENCES users(id),
      joined_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(crew_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS crew_goals (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      crew_id VARCHAR NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
      activity_type TEXT NOT NULL DEFAULT 'all',
      weekly_target_miles REAL,
      monthly_target_miles REAL,
      updated_by VARCHAR REFERENCES users(id),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(crew_id, activity_type)
    );
    CREATE INDEX IF NOT EXISTS idx_crew_goals_crew ON crew_goals(crew_id);

    CREATE TABLE IF NOT EXISTS crew_messages (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      crew_id VARCHAR NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_name TEXT NOT NULL,
      sender_photo TEXT,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_crew_messages_crew_created ON crew_messages(crew_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS run_messages (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id VARCHAR NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sender_name TEXT NOT NULL,
      sender_photo TEXT,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_run_messages_run_created ON run_messages(run_id, created_at DESC);

    ALTER TABLE community_paths ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false;
    ALTER TABLE community_paths ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE community_paths ADD COLUMN IF NOT EXISTS created_by_name TEXT;
    ALTER TABLE community_paths ADD COLUMN IF NOT EXISTS run_count INTEGER DEFAULT 1;
    ALTER TABLE community_paths ADD COLUMN IF NOT EXISTS activity_type TEXT DEFAULT 'run';
    ALTER TABLE community_paths ADD COLUMN IF NOT EXISTS osm_way_id BIGINT;
    ALTER TABLE community_paths ADD COLUMN IF NOT EXISTS activity_types TEXT[];
    CREATE UNIQUE INDEX IF NOT EXISTS idx_community_paths_osm_way_id ON community_paths(osm_way_id) WHERE osm_way_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS path_variants (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_path_id VARCHAR NOT NULL REFERENCES community_paths(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      route_path JSONB NOT NULL,
      distance_miles REAL NOT NULL,
      activity_types TEXT[],
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_path_variants_parent ON path_variants(parent_path_id);

    ALTER TABLE crew_messages ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text';
    ALTER TABLE crew_messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;
    ALTER TABLE crew_members ADD COLUMN IF NOT EXISTS chat_muted BOOLEAN DEFAULT false;
    ALTER TABLE crew_members ADD COLUMN IF NOT EXISTS chat_last_read_at TIMESTAMPTZ DEFAULT NULL;
    ALTER TABLE crew_members ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'member';
    ALTER TABLE crews ADD COLUMN IF NOT EXISTS streak_risk_notif_week INTEGER DEFAULT NULL;
    -- Promote existing crew creators to crew_chief
    UPDATE crew_members cm SET role = 'crew_chief'
      FROM crews c
      WHERE c.id = cm.crew_id AND c.created_by = cm.user_id AND cm.role = 'member';

    CREATE TABLE IF NOT EXISTS direct_messages (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      sender_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      read_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_dm_sender_recipient ON direct_messages(sender_id, recipient_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_dm_recipient ON direct_messages(recipient_id, created_at DESC);
    ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text';
    ALTER TABLE direct_messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_hash TEXT DEFAULT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_id TEXT DEFAULT NULL;
    CREATE TABLE IF NOT EXISTS facebook_friends (
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      fb_friend_id VARCHAR NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY(user_id, fb_friend_id)
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS garmin_access_token TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS garmin_token_secret TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS strava_athlete_id TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS strava_access_token TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS strava_refresh_token TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS strava_expires_at TIMESTAMPTZ;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS strava_activity_id TEXT UNIQUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_health_connected BOOLEAN DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS health_connect_connected BOOLEAN DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT true;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS default_activity TEXT DEFAULT 'run';
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS garmin_activity_id TEXT UNIQUE;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS apple_health_id TEXT UNIQUE;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS health_connect_id TEXT UNIQUE;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS step_count INTEGER;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS move_time_seconds INTEGER;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS tag_along_source_run_id VARCHAR REFERENCES runs(id) ON DELETE SET NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_solo_runs_tag_along ON solo_runs(user_id, tag_along_source_run_id) WHERE tag_along_source_run_id IS NOT NULL;
    ALTER TABLE crew_messages ALTER COLUMN user_id DROP NOT NULL;

    CREATE TABLE IF NOT EXISTS crew_achievements (
      id SERIAL PRIMARY KEY,
      crew_id VARCHAR NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
      achievement_key TEXT NOT NULL,
      achieved_at TIMESTAMP DEFAULT NOW(),
      achieved_value NUMERIC,
      UNIQUE(crew_id, achievement_key)
    );
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS saved_path_id VARCHAR REFERENCES saved_paths(id) ON DELETE SET NULL;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS pace_groups JSONB DEFAULT NULL;
    ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS pace_group_label VARCHAR DEFAULT NULL;

    CREATE TABLE IF NOT EXISTS remember_tokens (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_remember_tokens_user ON remember_tokens(user_id);
    ALTER TABLE crews ADD COLUMN IF NOT EXISTS current_streak_weeks INTEGER DEFAULT 0;
        ALTER TABLE crews ADD COLUMN IF NOT EXISTS last_run_week TIMESTAMP DEFAULT NULL;
        ALTER TABLE crews ADD COLUMN IF NOT EXISTS home_metro TEXT DEFAULT NULL;
        ALTER TABLE crews ADD COLUMN IF NOT EXISTS home_state TEXT DEFAULT NULL;
        -- getSuggestedCrews reads these off the users row to weight metro/state matches.
        -- Without the migration, /api/crews/suggested throws "column home_metro does not exist"
        -- and the Discover/Crews feed silently shows empty to the user.
        ALTER TABLE users ADD COLUMN IF NOT EXISTS home_metro TEXT DEFAULT NULL;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS home_state TEXT DEFAULT NULL;
        ALTER TABLE crews ADD COLUMN IF NOT EXISTS last_overtake_notif_at TIMESTAMP DEFAULT NULL;
        ALTER TABLE crews ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'none';
        ALTER TABLE crews ADD COLUMN IF NOT EXISTS member_cap_override INTEGER DEFAULT NULL;
        -- Soft-delete safeguard. Crews are NEVER hard-deleted anymore — three paths
        -- (leave-as-last-member, chief-cascade-empty, explicit-disband) previously
        -- ran a hard DELETE on crews with no audit trail or restore path, which is how
        -- the "Founders" crew vanished during a failed hosted-start flow. A row with
        -- disbanded_at IS NOT NULL is hidden from every query but can be recovered.
        ALTER TABLE crews ADD COLUMN IF NOT EXISTS disbanded_at TIMESTAMPTZ DEFAULT NULL;
        ALTER TABLE crews ADD COLUMN IF NOT EXISTS disbanded_by VARCHAR REFERENCES users(id) ON DELETE SET NULL;
        ALTER TABLE crews ADD COLUMN IF NOT EXISTS disbanded_reason TEXT DEFAULT NULL;
        CREATE INDEX IF NOT EXISTS idx_crews_not_disbanded ON crews(id) WHERE disbanded_at IS NULL;

        -- One-time crew name change for the chief. Image edits are unlimited;
        -- name edits are gated by name_change_count < 1 in the PATCH route.
        ALTER TABLE crews ADD COLUMN IF NOT EXISTS name_change_count INTEGER DEFAULT 0;

        -- Multi-sport events: a single event card can be both a Run AND a Walk
        -- (or any combination of run/ride/walk). The legacy single activity_type
        -- column stays as the primary for back-compat; the activity_types array
        -- is the canonical multi-value field used for filtering, card icon
        -- stack, and per-activity pace groups.
        ALTER TABLE runs ADD COLUMN IF NOT EXISTS activity_types TEXT[];
        ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS activity_type TEXT;

        -- T2.14: host-end grace period. When the host taps "End for Everyone",
        -- we set this timestamp 60s in the future. Until then, runner-finish
        -- calls are still accepted; the late-start monitor picks up runs with
        -- pending_end_at < NOW() and seals them via forceCompleteRun.
        ALTER TABLE runs ADD COLUMN IF NOT EXISTS pending_end_at TIMESTAMPTZ;

        -- T3.10: second pre-run reminder, 5 min out (the 30-min reminder uses
        -- the existing notif_pre_run_sent flag).
        ALTER TABLE runs ADD COLUMN IF NOT EXISTS notif_pre_run_5_sent BOOLEAN DEFAULT FALSE;

        -- T2.2 Mode B (chain/stages multi-sport). When set, the event is a
        -- sequence of stages each participant runs through manually
        -- ("Start Run" → finish → "Start Ride" → finish → ...). Schema:
        --   stages: [{activityType:'run'|'ride'|'walk', distanceMiles:num, minPace:num, maxPace:num}]
        -- Single shared pace-group set still applies (runs.pace_groups).
        -- Stage 0 is the first; participants advance manually.
        ALTER TABLE runs ADD COLUMN IF NOT EXISTS stages JSONB;
        ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS stage_splits JSONB;

        -- Persisted pace-group labels per crew. When the chief renames "Group A"
        -- to "Chill" on an event, the label is remembered and pre-fills the next
        -- event's create form for that crew (position 0 = first group, etc.).
        CREATE TABLE IF NOT EXISTS crew_pace_group_labels (
          crew_id      VARCHAR NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
          position     INTEGER NOT NULL,
          label        TEXT NOT NULL,
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (crew_id, position)
        );

        -- Soft-delete safeguard for user accounts. Same reasoning as crews —
        -- a year's worth of runs, friendships, achievements, crew chat, hosted
        -- events cannot be un-done if deleteUser() cascades. We now scrub login
        -- PII (email, password, push_token, oauth subs) but keep the row +
        -- every relational record (runs, participants, messages, memberships)
        -- intact. A row with deleted_at IS NOT NULL is treated as non-existent
        -- by auth lookups (getUserByEmail/Username/Id) so the account cannot
        -- sign back in, but restoreUser(userId) can reattach everything within
        -- the retention window.
        ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_reason TEXT DEFAULT NULL;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS pre_delete_email TEXT DEFAULT NULL;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS pre_delete_username TEXT DEFAULT NULL;
        CREATE INDEX IF NOT EXISTS idx_users_not_deleted ON users(id) WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token VARCHAR NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP DEFAULT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens(token);

    ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS tag_along_of_user_id VARCHAR DEFAULT NULL;

    CREATE TABLE IF NOT EXISTS tag_along_requests (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id VARCHAR NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      requester_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(run_id, requester_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tag_along_run ON tag_along_requests(run_id, status);

    CREATE TABLE IF NOT EXISTS user_blocks (
      blocker_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (blocker_id, blocked_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_id);
    CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);

    -- Hot-path index for live-run state. The lateral subquery in
    -- getLiveRunState() filters by (run_id, user_id) and orders by
    -- recorded_at DESC; without this composite index Postgres falls
    -- back to a sort over the entire run's points. Becomes the
    -- difference between sub-100ms and multi-second response times
    -- once a run has 50k+ tracking points (e.g. 200-person events).
    CREATE INDEX IF NOT EXISTS idx_run_tracking_points_run_user_recorded
      ON run_tracking_points (run_id, user_id, recorded_at DESC);

    CREATE TABLE IF NOT EXISTS path_shares (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      from_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      saved_path_id VARCHAR NOT NULL REFERENCES saved_paths(id) ON DELETE CASCADE,
      path_name TEXT NOT NULL,
      path_distance_miles REAL,
      activity_type TEXT DEFAULT 'run',
      created_at TIMESTAMP DEFAULT NOW(),
      cloned BOOLEAN DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS idx_path_shares_to ON path_shares(to_user_id);
    ALTER TABLE saved_paths ADD COLUMN IF NOT EXISTS community_path_id VARCHAR REFERENCES community_paths(id) ON DELETE SET NULL;
    ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS mile_splits JSONB DEFAULT NULL;

    CREATE TABLE IF NOT EXISTS public_routes (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      route_hash VARCHAR NOT NULL UNIQUE,
      activity_type TEXT NOT NULL DEFAULT 'run',
      path JSONB NOT NULL,
      distance_miles REAL,
      elevation_gain_ft REAL,
      bbox_sw_lat REAL NOT NULL,
      bbox_sw_lng REAL NOT NULL,
      bbox_ne_lat REAL NOT NULL,
      bbox_ne_lng REAL NOT NULL,
      start_lat REAL NOT NULL,
      start_lng REAL NOT NULL,
      times_completed INTEGER NOT NULL DEFAULT 1,
      is_hidden BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_public_routes_hash ON public_routes(route_hash);
    CREATE INDEX IF NOT EXISTS idx_public_routes_bbox ON public_routes(bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng);
    CREATE INDEX IF NOT EXISTS idx_public_routes_activity ON public_routes(activity_type);

    CREATE TABLE IF NOT EXISTS public_route_completions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      public_route_id VARCHAR NOT NULL REFERENCES public_routes(id) ON DELETE CASCADE,
      solo_run_id VARCHAR NOT NULL REFERENCES solo_runs(id) ON DELETE CASCADE,
      completed_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(solo_run_id)
    );
    CREATE INDEX IF NOT EXISTS idx_prc_route ON public_route_completions(public_route_id, completed_at DESC);

    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS is_route_public BOOLEAN DEFAULT false;
    ALTER TABLE solo_runs ADD COLUMN IF NOT EXISTS public_route_id VARCHAR REFERENCES public_routes(id) ON DELETE SET NULL;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT NULL;

    -- Login lockout
    ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INT DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ DEFAULT NULL;

    -- Profile bio
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT NULL;

    -- Email verification (existing users are considered pre-verified since they registered with email)
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
    UPDATE users SET email_verified = TRUE WHERE email_verified = FALSE AND created_at < NOW() - INTERVAL '1 minute';
    -- Safety net: any row where email_verified is NULL should be treated as verified (legacy accounts)
    UPDATE users SET email_verified = TRUE WHERE email_verified IS NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email TEXT DEFAULT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email_token TEXT DEFAULT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email_token_at TIMESTAMPTZ DEFAULT NULL;

    -- Suspension (auto-moderation)
    ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ DEFAULT NULL;

    -- Reports table
    CREATE TABLE IF NOT EXISTS reports (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      reporter_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('user', 'comment', 'run', 'crew_message')),
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      resolved BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);

    -- Audit logs (moderation actions)
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'system',
      target_type TEXT,
      target_id TEXT,
      detail JSONB DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- DB-level length constraints (idempotent via named constraint check)
    DO $chk_solo_runs$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_solo_runs_title_len'
      ) THEN
        ALTER TABLE solo_runs ADD CONSTRAINT chk_solo_runs_title_len CHECK (length(title) <= 80);
      END IF;
    END $chk_solo_runs$;

    DO $chk_users_bio$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_bio_len'
      ) THEN
        ALTER TABLE users ADD CONSTRAINT chk_users_bio_len CHECK (bio IS NULL OR length(bio) <= 300);
      END IF;
    END $chk_users_bio$;

    -- Achievements uniqueness: remove duplicate slug rows then add unique constraint
    DO $ach_uniq$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'achievements_user_slug_unique'
      ) THEN
        DELETE FROM achievements a1
          USING achievements a2
          WHERE a1.ctid > a2.ctid
            AND a1.user_id = a2.user_id
            AND a1.slug IS NOT NULL
            AND a1.slug = a2.slug;
        ALTER TABLE achievements ADD CONSTRAINT achievements_user_slug_unique UNIQUE (user_id, slug);
      END IF;
    END $ach_uniq$;

    -- Abandoned runs (stale with no real GPS distance — excluded from profile/leaderboard/totals)
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS is_abandoned BOOLEAN DEFAULT false;

    -- Email verification codes (6-digit, 30-min TTL; sent immediately after registration)
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_code TEXT DEFAULT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMPTZ DEFAULT NULL;

    -- Crew chief promotion tracking (so newly-promoted chiefs can Accept or Decline)
    CREATE TABLE IF NOT EXISTS crew_chief_promotions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      crew_id VARCHAR NOT NULL,
      user_id VARCHAR NOT NULL,
      crew_name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      declined BOOLEAN DEFAULT FALSE
    );
    CREATE INDEX IF NOT EXISTS idx_ccp_user ON crew_chief_promotions(user_id, declined, created_at DESC);

    -- Migration tracking table (append-only; each row records a named migration)
    CREATE TABLE IF NOT EXISTS db_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- One-time backfill: recalculate completed_runs and total_miles for all users
    -- to strip out abandoned ghost runs counted before Task #203's query filters.
    -- Uses the same logic as getPublicUserProfile so the cached counters on the
    -- users table match what profile and achievement screens display.
    -- Guarded by db_migrations so it only executes once per environment.
    DO $backfill_ghost_runs$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM db_migrations WHERE name = 'backfill_ghost_run_totals_v1') THEN
        UPDATE users u
        SET
          completed_runs = (
            COALESCE(
              (SELECT COUNT(*) FROM solo_runs sr
               WHERE sr.user_id = u.id AND sr.completed = true AND sr.is_deleted IS NOT TRUE),
              0
            ) + COALESCE(
              (SELECT COUNT(*) FROM run_participants rp
               WHERE rp.user_id = u.id
                 AND rp.final_distance IS NOT NULL AND rp.final_distance > 0
                 AND (rp.abandoned IS NULL OR rp.abandoned = false)),
              0
            )
          ),
          total_miles = (
            COALESCE(
              (SELECT SUM(sr.distance_miles) FROM solo_runs sr
               WHERE sr.user_id = u.id AND sr.completed = true AND sr.is_deleted IS NOT TRUE),
              0
            ) + COALESCE(
              (SELECT SUM(rp.final_distance) FROM run_participants rp
               WHERE rp.user_id = u.id
                 AND rp.final_distance IS NOT NULL AND rp.final_distance > 0
                 AND (rp.abandoned IS NULL OR rp.abandoned = false)),
              0
            )
          );
        INSERT INTO db_migrations (name) VALUES ('backfill_ghost_run_totals_v1');
        RAISE NOTICE 'backfill_ghost_run_totals_v1: recalculated run totals for all users';
      END IF;
    END $backfill_ghost_runs$;
  `);

  // Allow crews.created_by to be NULL so a leaderless state can be represented safely
  // (in practice last-resort assignment prevents this, but the schema should permit it)
  await pool.query(`
    ALTER TABLE crews ALTER COLUMN created_by DROP NOT NULL;
    ALTER TABLE crew_chief_promotions ADD COLUMN IF NOT EXISTS cycle_id VARCHAR DEFAULT NULL;
  `).catch(() => {
    // DROP NOT NULL is idempotent on Postgres >= 14 — swallow if already nullable
  });

  const dummyCheck = await pool.query(`SELECT COUNT(*) FROM users WHERE email LIKE 'dummy-%@paceup.dev'`);
  if (parseInt(dummyCheck.rows[0].count) > 0) {
    await pool.query(`DELETE FROM run_participants WHERE run_id IN (SELECT id FROM runs WHERE host_id IN (SELECT id FROM users WHERE email LIKE 'dummy-%@paceup.dev'))`);
    await pool.query(`DELETE FROM bookmarked_runs WHERE run_id IN (SELECT id FROM runs WHERE host_id IN (SELECT id FROM users WHERE email LIKE 'dummy-%@paceup.dev'))`);
    await pool.query(`DELETE FROM planned_runs WHERE run_id IN (SELECT id FROM runs WHERE host_id IN (SELECT id FROM users WHERE email LIKE 'dummy-%@paceup.dev'))`);
    await pool.query(`DELETE FROM runs WHERE host_id IN (SELECT id FROM users WHERE email LIKE 'dummy-%@paceup.dev')`);
    await pool.query(`DELETE FROM users WHERE email LIKE 'dummy-%@paceup.dev'`);
    console.log("[cleanup] Removed dummy seed accounts and their runs");
  }

  // ── Idempotent one-time migrations ──────────────────────────────────────────
  // migration_flags table acts as a changelog — each migration inserts a row
  // with its unique name so it is never re-executed after the first run.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migration_flags (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ghost_run_stat_recalc_v1
  // Recalculates users.total_miles and users.completed_runs from the
  // authoritative source (solo_runs + run_participants) so that abandoned ghost
  // runs — which were marked is_abandoned = true by Task #203 — no longer inflate
  // user totals. Safe to run even on a fresh DB (values will already be correct).
  //
  // Concurrency safety: the INSERT ... ON CONFLICT DO NOTHING is atomic; only the
  // instance that successfully inserts the flag row (rowCount = 1) runs the UPDATE,
  // preventing duplicate execution on concurrent server startups.
  const flagInsert = await pool.query(
    `INSERT INTO migration_flags (name) VALUES ('ghost_run_stat_recalc_v1') ON CONFLICT DO NOTHING`
  );
  if ((flagInsert.rowCount ?? 0) > 0) {
    await pool.query(`
      UPDATE users u SET
        total_miles = GREATEST(0, COALESCE((
          SELECT SUM(distance_miles) FROM solo_runs
          WHERE user_id = u.id
            AND completed = true
            AND (is_deleted IS NULL OR is_deleted = false)
        ), 0) + COALESCE((
          SELECT SUM(rp.final_distance) FROM run_participants rp
          JOIN runs r ON r.id = rp.run_id
          WHERE rp.user_id = u.id
            AND r.is_completed = true
            AND (r.is_abandoned IS NULL OR r.is_abandoned = false)
            AND (rp.abandoned IS NULL OR rp.abandoned = false)
            AND rp.final_distance > 0
        ), 0)),
        completed_runs = GREATEST(0, COALESCE((
          SELECT COUNT(*) FROM solo_runs
          WHERE user_id = u.id
            AND completed = true
            AND (is_deleted IS NULL OR is_deleted = false)
        ), 0) + COALESCE((
          SELECT COUNT(*) FROM run_participants rp
          JOIN runs r ON r.id = rp.run_id
          WHERE rp.user_id = u.id
            AND r.is_completed = true
            AND (r.is_abandoned IS NULL OR r.is_abandoned = false)
            AND (rp.abandoned IS NULL OR rp.abandoned = false)
            AND rp.final_distance > 0
        ), 0))
    `);
    console.log("[migration] ghost_run_stat_recalc_v1 applied — user stats recalculated from authoritative sources");
  }
}

export async function cleanupStalePlannedRuns() {
  const result = await pool.query(`
    DELETE FROM planned_runs
    WHERE run_id IN (
      SELECT id FROM runs
      WHERE is_completed = true
         OR is_deleted = true
         OR date < NOW() - INTERVAL '24 hours'
    )
    RETURNING run_id
  `);
  // Note: uses 24h threshold (vs getPlannedRuns' 3h display cutoff) to give
  // a generous buffer for long or delayed runs before hard-deleting the intent row.
  if (result.rowCount && result.rowCount > 0) {
    console.log(`[startup-cleanup] Removed ${result.rowCount} stale planned_runs row(s)`);
  }

  // Remove planned_runs entries for users who have already joined — prevents double-counting
  const dedupe = await pool.query(`
    DELETE FROM planned_runs pr
    WHERE EXISTS (
      SELECT 1 FROM run_participants rp
      WHERE rp.run_id = pr.run_id
        AND rp.user_id = pr.user_id
        AND rp.status IS DISTINCT FROM 'cancelled'
    )
    RETURNING pr.run_id
  `);
  if (dedupe.rowCount && dedupe.rowCount > 0) {
    console.log(`[startup-cleanup] Removed ${dedupe.rowCount} duplicate planned_runs row(s) for already-joined users`);
  }
}

export async function getBuddyEligibility(userId: string) {
  // Count group runs user completed where total completions >= 2
  const groupRes = await pool.query(
    `SELECT COUNT(DISTINCT rc.run_id) as count
     FROM run_completions rc
     WHERE rc.user_id = $1
       AND (SELECT COUNT(*) FROM run_completions rc2 WHERE rc2.run_id = rc.run_id) >= 2`,
    [userId]
  );
  // Count solo runs
  const soloRes = await pool.query(
    `SELECT COUNT(*) as count FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE`,
    [userId]
  );
  const groupRuns = parseInt(groupRes.rows[0]?.count ?? "0");
  const soloRuns = parseInt(soloRes.rows[0]?.count ?? "0");
  const eligible = groupRuns >= 1 && soloRuns >= 3;
  return { eligible, groupRuns, soloRuns };
}

export async function getBuddySuggestions(userId: string, gender: string) {
  const res = await pool.query(
    `SELECT id, name, username, photo_url, avg_pace, avg_distance, total_miles
     FROM users
     WHERE gender = $1 AND id != $2
       AND id NOT IN (
         SELECT CASE WHEN requester_id = $2 THEN addressee_id ELSE requester_id END
         FROM friends
         WHERE requester_id = $2 OR addressee_id = $2
       )
     ORDER BY RANDOM()
     LIMIT 10`,
    [gender, userId]
  );
  return res.rows;
}

export async function getNotifications(userId: string) {
  const crewChiefPromotions = await pool.query(
    `SELECT ccp.id, ccp.crew_id, ccp.crew_name, ccp.created_at
     FROM crew_chief_promotions ccp
     WHERE ccp.user_id = $1 AND ccp.declined = false
     ORDER BY ccp.created_at DESC LIMIT 5`,
    [userId]
  );

  const friendRequests = await pool.query(
    `SELECT fr.id, 'friend_request' as type, u.name as from_name, u.photo_url as from_photo, u.id as from_id, fr.created_at
     FROM friends fr
     JOIN users u ON u.id = fr.requester_id
     WHERE fr.addressee_id = $1 AND fr.status = 'pending'`,
    [userId]
  );

  const crewInvites = await pool.query(
    `SELECT cm.id, cm.crew_id, 'crew_invite' as type, c.name as crew_name, c.emoji,
            u.name as invited_by_name, cm.joined_at as created_at
     FROM crew_members cm
     JOIN crews c ON c.id = cm.crew_id
     JOIN users u ON u.id = cm.invited_by
     WHERE cm.user_id = $1 AND cm.status = 'pending' AND cm.invited_by != $1`,
    [userId]
  );

  const joinRequests = await pool.query(
    `SELECT rp.id, 'join_request' as type, u.name as from_name, r.title as run_title, rp.joined_at as created_at
     FROM run_participants rp
     JOIN runs r ON r.id = rp.run_id
     JOIN users u ON u.id = rp.user_id
     WHERE r.host_id = $1 AND rp.status = 'pending'
       AND (r.is_deleted IS NOT TRUE)`,
    [userId]
  );

  // Upcoming confirmed runs within the next 24 hours
  const eventReminders = await pool.query(
    `SELECT r.id, r.title, r.date, r.location_name, r.timezone, u.name as host_name, r.activity_type
     FROM run_participants rp
     JOIN runs r ON r.id = rp.run_id
     JOIN users u ON u.id = r.host_id
     WHERE rp.user_id = $1
       AND rp.status = 'confirmed'
       AND r.host_id != $1
       AND r.date BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
       AND (r.is_active = false OR r.is_active IS NULL)
       AND (r.is_deleted IS NOT TRUE)
     ORDER BY r.date ASC`,
    [userId]
  );

  // Runs that just went active (host started) where user is a confirmed participant
  const hostArrivals = await pool.query(
    `SELECT r.id, r.title, r.started_at, r.location_name, u.name as host_name, r.activity_type
     FROM run_participants rp
     JOIN runs r ON r.id = rp.run_id
     JOIN users u ON u.id = r.host_id
     WHERE rp.user_id = $1
       AND rp.status = 'confirmed'
       AND r.host_id != $1
       AND r.is_active = true
       AND r.started_at >= NOW() - INTERVAL '4 hours'
       AND (r.is_deleted IS NOT TRUE)
     ORDER BY r.started_at DESC`,
    [userId]
  );

  // T1.4: PRs sourced from BOTH solo runs and group-run participations.
  // We build a combined view of (id, distance, pace, activity_type, date)
  // and run the existing PR logic against it.
  // Distance PRs (within 72h, must beat a prior run of any type)
  const distPRs = await pool.query(
    `WITH all_runs AS (
       SELECT sr.id::text AS id, sr.distance_miles AS dist, sr.pace_min_per_mile AS pace, sr.activity_type, sr.date
         FROM solo_runs sr
        WHERE sr.user_id = $1 AND sr.completed = true AND sr.is_deleted IS NOT TRUE
       UNION ALL
       SELECT rp.id::text AS id, rp.final_distance AS dist, rp.final_pace AS pace, r.activity_type, COALESCE(r.started_at, r.date) AS date
         FROM run_participants rp
         JOIN runs r ON r.id = rp.run_id
        WHERE rp.user_id = $1 AND rp.final_distance IS NOT NULL AND rp.final_distance > 0
          AND r.is_completed = true AND r.is_deleted IS NOT TRUE
     )
     SELECT a.id, a.dist AS distance_miles, a.date, a.activity_type
       FROM all_runs a
      WHERE a.date >= NOW() - INTERVAL '72 hours'
        AND a.dist IS NOT NULL
        AND EXISTS (SELECT 1 FROM all_runs b WHERE b.id != a.id AND b.date < a.date)
        AND a.dist > COALESCE((SELECT MAX(b.dist) FROM all_runs b WHERE b.id != a.id AND b.date < a.date), 0)
        AND NOT EXISTS (
          SELECT 1 FROM run_notification_hidden rnh
           WHERE rnh.user_id = $1 AND rnh.run_id = a.id
        )
      ORDER BY a.date DESC
      LIMIT 1`,
    [userId]
  );

  // Pace PRs (within 72h, must beat a prior qualifying run; ≥0.5mi, ≥2.0min/mi)
  const pacePRs = await pool.query(
    `WITH all_runs AS (
       SELECT sr.id::text AS id, sr.distance_miles AS dist, sr.pace_min_per_mile AS pace, sr.activity_type, sr.date
         FROM solo_runs sr
        WHERE sr.user_id = $1 AND sr.completed = true AND sr.is_deleted IS NOT TRUE
       UNION ALL
       SELECT rp.id::text AS id, rp.final_distance AS dist, rp.final_pace AS pace, r.activity_type, COALESCE(r.started_at, r.date) AS date
         FROM run_participants rp
         JOIN runs r ON r.id = rp.run_id
        WHERE rp.user_id = $1 AND rp.final_distance IS NOT NULL AND rp.final_distance > 0
          AND r.is_completed = true AND r.is_deleted IS NOT TRUE
     )
     SELECT a.id, a.pace AS pace_min_per_mile, a.date, a.activity_type
       FROM all_runs a
      WHERE a.date >= NOW() - INTERVAL '72 hours'
        AND a.pace IS NOT NULL AND a.pace >= 2.0 AND a.dist > 0.5
        AND EXISTS (
          SELECT 1 FROM all_runs b
           WHERE b.id != a.id AND b.date < a.date
             AND b.dist > 0.5 AND b.pace >= 2.0
        )
        AND a.pace < COALESCE((
          SELECT MIN(b.pace) FROM all_runs b
           WHERE b.id != a.id AND b.date < a.date
             AND b.dist > 0.5 AND b.pace >= 2.0
        ), 999)
        AND NOT EXISTS (
          SELECT 1 FROM run_notification_hidden rnh
           WHERE rnh.user_id = $1 AND rnh.run_id = a.id
        )
      ORDER BY a.date DESC
      LIMIT 1`,
    [userId]
  );

  const crewJoinRequests = await pool.query(
    `SELECT cm.crew_id, cm.user_id as requester_id, u.name as requester_name, u.photo_url as requester_photo,
            c.name as crew_name, c.emoji, cm.joined_at as created_at
     FROM crew_members cm
     JOIN users u ON u.id = cm.user_id
     JOIN crews c ON c.id = cm.crew_id
     WHERE c.created_by = $1 AND cm.status = 'pending' AND cm.user_id != $1
       AND (cm.invited_by IS NULL OR cm.invited_by = cm.user_id)`,
    [userId]
  );

  const milestoneAchievements = await pool.query(
    `SELECT a.id, a.milestone, a.slug, a.earned_at
     FROM achievements a
     WHERE a.user_id = $1
       AND a.earned_at >= NOW() - INTERVAL '7 days'
     ORDER BY a.earned_at DESC
     LIMIT 10`,
    [userId]
  );

  const friendAccepted = await pool.query(
    `SELECT fr.id, 'friend_accepted' as type, u.name as friend_name, u.photo_url as friend_photo, u.id as friend_id, fr.accepted_at
     FROM friends fr
     JOIN users u ON u.id = fr.addressee_id
     WHERE fr.requester_id = $1 AND fr.status = 'accepted'
       AND fr.accepted_at IS NOT NULL
       AND fr.accepted_at >= NOW() - INTERVAL '48 hours'`,
    [userId]
  );

  const friendRunPosted = await pool.query(
    `SELECT r.id as run_id, r.title, r.activity_type, r.created_at, u.name as friend_name, u.photo_url as friend_photo, u.id as friend_id
     FROM runs r
     JOIN users u ON u.id = r.host_id
     WHERE r.created_at >= NOW() - INTERVAL '24 hours'
       AND r.host_id != $1
       AND (r.is_deleted IS NOT TRUE)
       AND r.host_id IN (
         SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END
         FROM friends
         WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'
       )
       AND NOT EXISTS (
         SELECT 1 FROM run_participants rp WHERE rp.run_id = r.id AND rp.user_id = $1
       )
     ORDER BY r.created_at DESC`,
    [userId]
  );

  const pathSharesNotifs = await pool.query(
    `SELECT ps.id, ps.path_name, ps.path_distance_miles, ps.activity_type, ps.cloned, ps.created_at,
            u.name as from_name, u.photo_url as from_photo
     FROM path_shares ps
     JOIN users u ON u.id = ps.from_user_id
     WHERE ps.to_user_id = $1
       AND ps.created_at >= NOW() - INTERVAL '14 days'
     ORDER BY ps.created_at DESC
     LIMIT 10`,
    [userId]
  );

  // Deduplicate PR notifications by run id (a run could be both a dist and pace PR)
  const prRunIds = new Set<string>();
  const prRows: any[] = [];
  for (const row of [...distPRs.rows, ...pacePRs.rows]) {
    if (!prRunIds.has(row.id)) {
      prRunIds.add(row.id);
      prRows.push(row);
    }
  }

  function fmtPace(p: number) {
    let m = Math.floor(p);
    let s = Math.round((p - m) * 60);
    if (s === 60) { s = 0; m += 1; }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  const now = new Date();

  const notifications = [
    ...hostArrivals.rows.map(r => ({
      id: `ha_${r.id}`,
      type: 'host_arrived',
      title: 'Host Has Arrived',
      body: `${r.host_name} just started "${r.title}" — head over!`,
      data: { run_id: r.id, host_name: r.host_name, location_name: r.location_name, activity_type: r.activity_type },
      created_at: r.started_at,
    })),
    ...friendRequests.rows.map(r => ({
      id: r.id,
      type: 'friend_request',
      title: 'Friend Request',
      body: `${r.from_name} wants to connect on PaceUp`,
      from_name: r.from_name,
      from_photo: r.from_photo,
      data: { from_name: r.from_name, from_photo: r.from_photo, from_id: r.from_id },
      created_at: r.created_at,
    })),
    ...crewInvites.rows.map(r => ({
      id: r.id,
      type: 'crew_invite',
      title: 'Crew Invite',
      body: `${r.invited_by_name} invited you to join ${r.emoji ?? ''} ${r.crew_name}`,
      crew_id: r.crew_id,
      crew_name: r.crew_name,
      emoji: r.emoji,
      invited_by_name: r.invited_by_name,
      data: { crew_id: r.crew_id, crew_name: r.crew_name, emoji: r.emoji },
      created_at: r.created_at,
    })),
    ...joinRequests.rows.map(r => ({
      id: r.id,
      type: 'join_request',
      title: 'Join Request',
      body: `${r.from_name} wants to join "${r.run_title}"`,
      data: { participant_id: r.id, from_name: r.from_name, run_title: r.run_title },
      created_at: r.created_at,
    })),
    ...crewJoinRequests.rows.map(r => ({
      id: `cjr_${r.crew_id}_${r.requester_id}`,
      type: 'crew_join_request',
      title: 'Crew Join Request',
      body: `${r.requester_name} wants to join ${r.emoji ?? ''} ${r.crew_name}`,
      data: { crew_id: r.crew_id, requester_id: r.requester_id, requester_name: r.requester_name, requester_photo: r.requester_photo, crew_name: r.crew_name },
      created_at: r.created_at,
    })),
    ...eventReminders.rows.map(r => {
      const diffMs = new Date(r.date).getTime() - now.getTime();
      const diffH = Math.floor(diffMs / 3600000);
      const diffM = Math.floor((diffMs % 3600000) / 60000);
      const timeStr = diffH > 0 ? `${diffH}h ${diffM}m` : `${diffM}m`;
      const actLabel = r.activity_type === 'ride' ? 'ride' : r.activity_type === 'walk' ? 'walk' : 'run';
      return {
        id: `er_${r.id}`,
        type: 'event_reminder',
        title: `Upcoming ${actLabel === 'ride' ? 'Ride' : actLabel === 'walk' ? 'Walk' : 'Run'}`,
        body: `"${r.title}" with ${r.host_name} starts in ${timeStr}${r.location_name ? ` · ${r.location_name}` : ''}`,
        data: { run_id: r.id, host_name: r.host_name, location_name: r.location_name, date: r.date, timezone: r.timezone ?? null, activity_type: r.activity_type },
        created_at: now.toISOString(),
      };
    }),
    ...friendAccepted.rows.map(r => ({
      id: `fa_${r.id}`,
      type: 'friend_accepted',
      title: 'Friend Request Accepted',
      body: `${r.friend_name} accepted your friend request`,
      data: { friend_id: r.friend_id, friend_name: r.friend_name, friend_photo: r.friend_photo },
      created_at: r.accepted_at,
    })),
    ...friendRunPosted.rows.map(r => {
      const actLabel = r.activity_type === 'ride' ? 'ride' : r.activity_type === 'walk' ? 'walk' : 'run';
      return {
        id: `frp_${r.run_id}`,
        type: 'friend_run_posted',
        title: `Friend Posted a ${actLabel === 'ride' ? 'Ride' : actLabel === 'walk' ? 'Walk' : 'Run'}`,
        body: `${r.friend_name} posted "${r.title}"`,
        data: { run_id: r.run_id, friend_id: r.friend_id, friend_name: r.friend_name, friend_photo: r.friend_photo, activity_type: r.activity_type },
        created_at: r.created_at,
      };
    }),
    ...milestoneAchievements.rows.map(r => ({
      id: `ach_${r.id}`,
      type: 'milestone_achievement',
      title: 'Achievement Unlocked',
      body: r.slug ? `You earned the "${r.slug}" achievement!` : `You reached milestone ${r.milestone}!`,
      data: { achievement_id: r.id, milestone: r.milestone, slug: r.slug },
      created_at: r.earned_at,
    })),
    ...prRows.map(r => {
      const isPacePR = distPRs.rows.find((d: any) => d.id === r.id) == null;
      const isDistPR = distPRs.rows.find((d: any) => d.id === r.id) != null;
      const isPPR = pacePRs.rows.find((p: any) => p.id === r.id) != null;
      const parts: string[] = [];
      if (isDistPR && r.distance_miles) parts.push(`${Math.round(r.distance_miles * 100) / 100} mi longest run`);
      if (isPPR && r.pace_min_per_mile) parts.push(`${fmtPace(r.pace_min_per_mile)}/mi fastest pace`);
      return {
        id: `pr_${r.id}`,
        type: 'pr_notification',
        title: '🏆 New Personal Record',
        body: parts.length ? parts.join(' · ') : 'You set a new personal record!',
        data: { run_id: r.id, activity_type: r.activity_type },
        created_at: r.date,
      };
    }),
    ...pathSharesNotifs.rows.map(r => ({
      id: `ps_${r.id}`,
      type: 'path_shared',
      title: 'Route Shared With You',
      body: `${r.from_name} shared "${r.path_name}" with you`,
      from_name: r.from_name,
      from_photo: r.from_photo,
      share_id: r.id,
      path_name: r.path_name,
      path_distance_miles: r.path_distance_miles,
      cloned: r.cloned,
      created_at: r.created_at,
    })),
    ...crewChiefPromotions.rows.map(r => ({
      id: `ccp_${r.id}`,
      type: 'crew_chief_promoted',
      title: "You're now Crew Chief",
      body: `You've been promoted to chief of ${r.crew_name}`,
      crew_id: r.crew_id,
      crew_name: r.crew_name,
      promotion_id: r.id,
      data: { crew_id: r.crew_id, crew_name: r.crew_name, promotion_id: r.id },
      created_at: r.created_at,
    })),
  ];

  return notifications.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function respondToFriendRequest(friendshipId: string, userId: string, action: 'accept' | 'decline') {
  if (action === 'accept') {
    return pool.query(`UPDATE friends SET status = 'accepted', accepted_at = NOW() WHERE id = $1 AND addressee_id = $2`, [friendshipId, userId]);
  } else {
    return pool.query(`DELETE FROM friends WHERE id = $1 AND addressee_id = $2`, [friendshipId, userId]);
  }
}

export async function respondToCrewInvite(crewId: string, userId: string, action: 'accept' | 'decline') {
  if (action === 'accept') {
    if (await hasCrewBlockConflict(crewId, userId)) {
      throw Object.assign(new Error("Can't join this crew due to a block between you and a member."), { code: "BLOCK_CONFLICT" });
    }
    const memberCount = await getCrewMemberCount(crewId);
    const cap = await getCrewMemberCap(crewId);
    if (memberCount >= cap) {
      throw Object.assign(new Error("This crew has reached its member cap. The crew chief needs to upgrade to the Crew Growth plan."), { code: "MEMBER_CAP_REACHED" });
    }
    return pool.query(`UPDATE crew_members SET status = 'member', joined_at = NOW() WHERE crew_id = $1 AND user_id = $2`, [crewId, userId]);
  } else {
    return pool.query(`DELETE FROM crew_members WHERE crew_id = $1 AND user_id = $2`, [crewId, userId]);
  }
}

export async function getParticipantById(participantId: string) {
  const res = await pool.query(`SELECT * FROM run_participants WHERE id = $1`, [participantId]);
  return res.rows[0] || null;
}

export async function respondToJoinRequest(participantId: string, hostId: string, action: 'approve' | 'deny') {
  if (action === 'approve') {
    return pool.query(
      `UPDATE run_participants SET status = 'joined' 
       WHERE id = $1 AND run_id IN (SELECT id FROM runs WHERE host_id = $2)`, 
      [participantId, hostId]
    );
  } else {
    return pool.query(
      `DELETE FROM run_participants 
       WHERE id = $1 AND run_id IN (SELECT id FROM runs WHERE host_id = $2)`, 
      [participantId, hostId]
    );
  }
}

export async function getRunMessages(runId: string, limit = 50) {
  const res = await pool.query(
    `SELECT * FROM run_messages WHERE run_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [runId, limit]
  );
  return res.rows;
}

export async function createRunMessage(runId: string, userId: string, senderName: string, senderPhoto: string | null, message: string) {
  const res = await pool.query(
    `INSERT INTO run_messages (run_id, user_id, sender_name, sender_photo, message) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [runId, userId, senderName, senderPhoto, message]
  );
  return res.rows[0];
}

export async function isRunParticipant(runId: string, userId: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM run_participants WHERE run_id = $1 AND user_id = $2 AND status != 'cancelled'`,
    [runId, userId]
  );
  return res.rows.length > 0;
}

export async function getUserByUsername(username: string) {
  const res = await pool.query(`SELECT * FROM users WHERE LOWER(username) = LOWER($1) AND deleted_at IS NULL`, [username]);
  return res.rows[0] || null;
}

export async function getUserByEmailOrUsername(identifier: string) {
  const byEmail = await getUserByEmail(identifier);
  if (byEmail) return byEmail;
  return getUserByUsername(identifier);
}

export async function createUser(data: { email: string; password: string; name: string; username?: string; gender?: string | null }) {
  const hashedPassword = await bcrypt.hash(data.password, 10);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, username, avg_pace, avg_distance, gender, onboarding_complete) VALUES ($1, $2, $3, $4, NULL, NULL, $5, false) RETURNING *`,
    [data.email.toLowerCase(), hashedPassword, data.name, data.username?.toLowerCase() ?? null, data.gender ?? null]
  );
  return result.rows[0];
}

export async function getUserByEmail(email: string) {
  const result = await pool.query(`SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL`, [email.toLowerCase()]);
  return result.rows[0] || null;
}

export async function getUserById(id: string) {
  // Auth/identity lookup — soft-deleted users are treated as non-existent so
  // they cannot resume a session or be fetched by any caller that relies on
  // this function. Past content they authored stays in the DB and is still
  // readable via direct JOINs (e.g. run participants, crew messages) — we
  // just don't resolve the user row through the identity path anymore.
  const result = await pool.query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
  return result.rows[0] || null;
}

export async function verifyPassword(plain: string, hashed: string) {
  return bcrypt.compare(plain, hashed);
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
    [userId, token, expiresAt]
  );
  return token;
}

export async function consumePasswordResetToken(token: string): Promise<string | null> {
  const res = await pool.query(
    `UPDATE password_reset_tokens SET used_at = NOW() WHERE token = $1 AND used_at IS NULL AND expires_at > NOW() RETURNING user_id`,
    [token]
  );
  return res.rows[0]?.user_id ?? null;
}

export async function updateUserPassword(userId: string, newPassword: string) {
  const hashed = await bcrypt.hash(newPassword, 10);
  await pool.query(`UPDATE users SET password = $1 WHERE id = $2`, [hashed, userId]);
}

export async function updateUserPasswordAndInvalidateTokens(userId: string, newPassword: string, currentTokenRaw?: string) {
  const hashed = await bcrypt.hash(newPassword, 10);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE users SET password = $1 WHERE id = $2`, [hashed, userId]);
    if (currentTokenRaw) {
      const currentHash = createHash("sha256").update(currentTokenRaw).digest("hex");
      await client.query(`DELETE FROM remember_tokens WHERE user_id = $1 AND token_hash != $2`, [userId, currentHash]);
    } else {
      await client.query(`DELETE FROM remember_tokens WHERE user_id = $1`, [userId]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function updateUser(id: string, updates: Record<string, any>) {
  const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
  if (!entries.length) return null;
  const fields = entries.map(([k, ], i) => `${toSnake(k)} = $${i + 2}`).join(", ");
  const values = entries.map(([, v]) => v);
  const result = await pool.query(`UPDATE users SET ${fields} WHERE id = $1 RETURNING *`, [id, ...values]);
  return result.rows[0];
}

function toSnake(s: string) {
  return s.replace(/([A-Z])/g, "_$1").toLowerCase();
}

export async function updatePushToken(userId: string, token: string | null) {
  await pool.query(`UPDATE users SET push_token = $2 WHERE id = $1`, [userId, token]);
}

export async function getFriendsWithPushTokens(userId: string): Promise<{ id: string; name: string; push_token: string }[]> {
  const result = await pool.query(
    `SELECT u.id, u.name, u.push_token
     FROM friends f
     JOIN users u ON (CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END) = u.id
     WHERE (f.requester_id = $1 OR f.addressee_id = $1)
       AND f.status = 'accepted'
       AND u.push_token IS NOT NULL`,
    [userId]
  );
  return result.rows;
}

export async function createRun(data: {
  hostId: string;
  title: string;
  description?: string;
  privacy: string;
  date: string;
  locationLat: number;
  locationLng: number;
  locationName: string;
  minDistance: number;
  maxDistance: number;
  minPace: number;
  maxPace: number;
  tags: string[];
  maxParticipants: number;
  invitePassword?: string;
  isStrict?: boolean;
  runStyle?: string;
  activityType?: string;
  crewId?: string;
  crewVibe?: string | null;
  savedPathId?: string | null;
  paceGroups?: { label: string; minPace: number; maxPace: number }[] | null;
  timezone?: string;
  activityTypes?: string[] | null;
  stages?: { activityType: string; distanceMiles?: number; minPace?: number; maxPace?: number }[] | null;
}) {
  const inviteToken = data.privacy === "private"
    ? Math.random().toString(36).substring(2, 10).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase()
    : null;
  const activityType = data.activityType === "ride" ? "ride" : data.activityType === "walk" ? "walk" : "run";
  // Sanitize activity_types: only allow run/walk/ride, dedupe, ensure primary is included.
  const validTypes = ["run", "walk", "ride"];
  const incomingTypes = Array.isArray(data.activityTypes) ? data.activityTypes : [];
  const cleaned = Array.from(new Set([activityType, ...incomingTypes.filter((t) => validTypes.includes(t))]));
  // Only persist activity_types if it's truly multi-type; single-type events keep activity_types NULL for back-compat.
  const activityTypesArr = cleaned.length > 1 ? cleaned : null;
  const paceGroupsJson = data.paceGroups && data.paceGroups.length > 0 ? JSON.stringify(data.paceGroups) : null;
  const timezone = typeof data.timezone === "string" && data.timezone.length > 0 ? data.timezone : null;
  // Sanitize stages: capped at 3, must have valid activityType
  let stagesJson: string | null = null;
  if (Array.isArray(data.stages) && data.stages.length > 0) {
    const stagesClean = data.stages
      .filter((s) => validTypes.includes(s?.activityType))
      .slice(0, 3)
      .map((s) => ({
        activityType: s.activityType,
        distanceMiles: typeof s.distanceMiles === "number" && s.distanceMiles > 0 ? s.distanceMiles : null,
        minPace: typeof s.minPace === "number" && s.minPace > 0 ? s.minPace : null,
        maxPace: typeof s.maxPace === "number" && s.maxPace > 0 ? s.maxPace : null,
      }));
    if (stagesClean.length > 0) stagesJson = JSON.stringify(stagesClean);
  }
  const result = await pool.query(
    `INSERT INTO runs (host_id, title, description, privacy, date, location_lat, location_lng, location_name, min_distance, max_distance, min_pace, max_pace, tags, max_participants, invite_token, invite_password, is_strict, run_style, activity_type, crew_id, saved_path_id, pace_groups, timezone, crew_vibe, activity_types, stages)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING *`,
    [data.hostId, data.title, data.description || null, data.privacy, data.date, data.locationLat, data.locationLng, data.locationName, data.minDistance, data.maxDistance, data.minPace, data.maxPace, data.tags, data.maxParticipants, inviteToken, data.invitePassword || null, data.isStrict ?? false, data.runStyle || null, activityType, data.crewId || null, data.savedPathId || null, paceGroupsJson, timezone, data.crewId ? (data.crewVibe && data.crewVibe.trim() ? data.crewVibe.trim().slice(0, 30) : null) : null, activityTypesArr, stagesJson]
  );
  return result.rows[0];
}

export async function getUserRecentDistances(userId: string, limit = 10): Promise<number[]> {
  const result = await pool.query(
    `SELECT distance FROM (
       SELECT distance_miles AS distance, date FROM solo_runs
       WHERE user_id = $1 AND completed = true AND distance_miles IS NOT NULL
       UNION ALL
       SELECT rp.final_distance AS distance, r.date FROM run_participants rp
       JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.final_distance IS NOT NULL
         AND (rp.abandoned IS NULL OR rp.abandoned = false)
     ) combined
     ORDER BY date DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows.map((r: any) => r.distance as number);
}

export async function searchUsers(query: string, currentUserId: string) {
  const result = await pool.query(
    `SELECT id, name, username, photo_url, completed_runs, total_miles FROM users
     WHERE id != $1 AND username ILIKE $2
       AND id NOT IN (
         SELECT blocked_id FROM user_blocks WHERE blocker_id = $1
         UNION
         SELECT blocker_id FROM user_blocks WHERE blocked_id = $1
       )
       AND (suspended_until IS NULL OR suspended_until < NOW())
     LIMIT 20`,
    [currentUserId, `%${query}%`]
  );
  return result.rows;
}

export async function getFriends(userId: string) {
  const result = await pool.query(
    `SELECT u.id, u.name, u.username, u.photo_url, u.completed_runs, u.total_miles,
       f.id as friendship_id, f.status, f.created_at as friends_since
     FROM friends f
     JOIN users u ON (CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END) = u.id
     WHERE (f.requester_id = $1 OR f.addressee_id = $1) AND f.status = 'accepted'
     ORDER BY u.name ASC`,
    [userId]
  );
  return result.rows;
}

export async function getSentRequests(userId: string) {
  const result = await pool.query(
    `SELECT u.id, u.name, u.photo_url, f.id as friendship_id, f.created_at
     FROM friends f JOIN users u ON f.addressee_id = u.id
     WHERE f.requester_id = $1 AND f.status = 'pending'`,
    [userId]
  );
  return result.rows;
}

export async function getPendingRequests(userId: string) {
  const result = await pool.query(
    `SELECT u.id, u.name, u.photo_url, f.id as friendship_id, f.created_at
     FROM friends f JOIN users u ON f.requester_id = u.id
     WHERE f.addressee_id = $1 AND f.status = 'pending'
     ORDER BY f.created_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function sendFriendRequest(requesterId: string, addresseeId: string) {
  const existing = await pool.query(
    `SELECT id, status FROM friends WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
    [requesterId, addresseeId]
  );
  if (existing.rows.length > 0) return { error: existing.rows[0].status === "accepted" ? "already_friends" : "already_requested" };
  const result = await pool.query(
    `INSERT INTO friends (requester_id, addressee_id, status) VALUES ($1, $2, 'pending') RETURNING *`,
    [requesterId, addresseeId]
  );
  return { data: result.rows[0] };
}

export async function acceptFriendRequest(friendshipId: string, userId: string) {
  const result = await pool.query(
    `UPDATE friends SET status = 'accepted', accepted_at = NOW() WHERE id = $1 AND addressee_id = $2 RETURNING *`,
    [friendshipId, userId]
  );
  return result.rows[0] || null;
}

export async function removeFriend(friendshipId: string, userId: string) {
  await pool.query(
    `DELETE FROM friends WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2)`,
    [friendshipId, userId]
  );
}

export async function getFriendIds(userId: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END as friend_id
     FROM friends WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'`,
    [userId]
  );
  return result.rows.map((r: any) => r.friend_id);
}

export async function areFriends(userA: string, userB: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM friends WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)) AND status = 'accepted'`,
    [userA, userB]
  );
  return res.rows.length > 0;
}

export async function createRememberToken(userId: string): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(raw).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO remember_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hash, expiresAt]
  );
  return raw;
}

export async function validateRememberToken(raw: string): Promise<string | null> {
  const hash = createHash("sha256").update(raw).digest("hex");
  const res = await pool.query(
    `SELECT user_id FROM remember_tokens WHERE token_hash = $1 AND expires_at > NOW()`,
    [hash]
  );
  return res.rows[0]?.user_id ?? null;
}

export async function deleteRememberToken(raw: string): Promise<void> {
  const hash = createHash("sha256").update(raw).digest("hex");
  await pool.query(`DELETE FROM remember_tokens WHERE token_hash = $1`, [hash]);
}

export async function deleteUserRememberTokens(userId: string): Promise<void> {
  await pool.query(`DELETE FROM remember_tokens WHERE user_id = $1`, [userId]);
}

export async function getFriendPrivateRuns(userId: string, bounds?: { swLat: number; neLat: number; swLng: number; neLng: number }) {
  let query = `SELECT r.id, r.title, r.date, r.timezone, r.location_lat, r.location_lng, r.location_name,
    r.min_pace, r.max_pace, r.min_distance, r.max_distance, r.max_participants, r.privacy,
    u.name as host_name, u.photo_url as host_photo, u.marker_icon as host_marker_icon, u.avg_rating as host_rating, u.rating_count as host_rating_count, u.hosted_runs as host_hosted_runs,
    (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) as participant_count,
    (SELECT COUNT(*) FROM planned_runs pr WHERE pr.run_id = r.id) as plan_count,
    true as is_locked
  FROM runs r
  JOIN users u ON u.id = r.host_id
  JOIN friends f ON ((f.requester_id = $1 AND f.addressee_id = r.host_id) OR (f.addressee_id = $1 AND f.requester_id = r.host_id))
  WHERE r.privacy = 'private' AND r.date > NOW() AND r.is_completed = false
    AND f.status = 'accepted' AND r.host_id != $1
    AND r.id NOT IN (SELECT run_id FROM run_invites WHERE invitee_id = $1)
    AND r.crew_id IS NULL
    AND r.host_id NOT IN (
      SELECT blocked_id FROM user_blocks WHERE blocker_id = $1
      UNION
      SELECT blocker_id FROM user_blocks WHERE blocked_id = $1
    )`;
  const params: any[] = [userId];
  let idx = 2;
  if (bounds) {
    query += ` AND r.location_lat BETWEEN $${idx++} AND $${idx++} AND r.location_lng BETWEEN $${idx++} AND $${idx++}`;
    params.push(bounds.swLat, bounds.neLat, bounds.swLng, bounds.neLng);
  }
  query += ` ORDER BY r.date ASC LIMIT 50`;
  const result = await pool.query(query, params);
  return result.rows;
}

export async function getInvitedPrivateRuns(userId: string, bounds?: { swLat: number; neLat: number; swLng: number; neLng: number }) {
  let query = `SELECT r.*, u.name as host_name, u.username as host_username, u.avg_rating as host_rating, u.rating_count as host_rating_count, u.photo_url as host_photo, u.marker_icon as host_marker_icon, u.hosted_runs as host_hosted_runs,
    (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) as participant_count,
    (SELECT COUNT(*) FROM planned_runs pr WHERE pr.run_id = r.id) as plan_count,
    false as is_locked
  FROM runs r
  JOIN users u ON u.id = r.host_id
  JOIN run_invites ri ON ri.run_id = r.id AND ri.invitee_id = $1
  WHERE r.privacy = 'private' AND r.date > NOW() AND r.is_completed = false AND r.crew_id IS NULL
    AND r.host_id NOT IN (
      SELECT blocked_id FROM user_blocks WHERE blocker_id = $1
      UNION
      SELECT blocker_id FROM user_blocks WHERE blocked_id = $1
    )`;
  const params: any[] = [userId];
  let idx = 2;
  if (bounds) {
    query += ` AND r.location_lat BETWEEN $${idx++} AND $${idx++} AND r.location_lng BETWEEN $${idx++} AND $${idx++}`;
    params.push(bounds.swLat, bounds.neLat, bounds.swLng, bounds.neLng);
  }
  query += ` ORDER BY r.date ASC LIMIT 50`;
  const result = await pool.query(query, params);
  return result.rows;
}

export async function hasRunAccess(runId: string, userId: string): Promise<boolean> {
  const hostCheck = await pool.query(`SELECT id FROM runs WHERE id = $1 AND host_id = $2`, [runId, userId]);
  if (hostCheck.rows.length > 0) return true;
  const inviteCheck = await pool.query(`SELECT id FROM run_invites WHERE run_id = $1 AND invitee_id = $2`, [runId, userId]);
  return inviteCheck.rows.length > 0;
}

export async function grantRunAccess(runId: string, userId: string) {
  await pool.query(
    `INSERT INTO run_invites (run_id, invitee_id, invited_by) SELECT $1, $2, host_id FROM runs WHERE id = $1 ON CONFLICT (run_id, invitee_id) DO NOTHING`,
    [runId, userId]
  );
}

export async function isCrewMember(crewId: string, userId: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM crew_members WHERE crew_id = $1 AND user_id = $2 AND status = 'member'`,
    [crewId, userId]
  );
  return res.rows.length > 0;
}

export async function getUserCrewIds(userId: string): Promise<Array<{ crew_id: string }>> {
  const res = await pool.query(
    `SELECT crew_id FROM crew_members WHERE user_id = $1 AND status = 'member'`,
    [userId]
  );
  return res.rows;
}

export async function getCrewVisibleRuns(userId: string, bounds?: { swLat: number; neLat: number; swLng: number; neLng: number }) {
  let query = `SELECT r.*, u.name as host_name, u.username as host_username, u.avg_rating as host_rating, u.rating_count as host_rating_count, u.photo_url as host_photo,
      u.marker_icon as host_marker_icon, u.hosted_runs as host_hosted_runs,
      (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) as participant_count,
      false as is_locked,
      c.image_url as crew_photo_url
    FROM runs r
    JOIN users u ON u.id = r.host_id
    JOIN crew_members cm ON cm.crew_id = r.crew_id AND cm.user_id = $1 AND cm.status = 'member'
    LEFT JOIN crews c ON c.id = r.crew_id
    WHERE r.crew_id IS NOT NULL AND (r.is_active = true OR r.date > NOW() - INTERVAL '90 minutes') AND r.is_completed = false
      AND r.host_id NOT IN (
        SELECT blocked_id FROM user_blocks WHERE blocker_id = $1
        UNION
        SELECT blocker_id FROM user_blocks WHERE blocked_id = $1
      )`;
  const params: any[] = [userId];
  query += ` ORDER BY r.date ASC LIMIT 100`;
  const result = await pool.query(query, params);
  return result.rows;
}

export async function getCrewMemberPushTokens(crewId: string): Promise<string[]> {
  const res = await pool.query(
    `SELECT u.push_token FROM users u
     JOIN crew_members cm ON cm.user_id = u.id
     WHERE cm.crew_id = $1 AND cm.status = 'member' AND u.push_token IS NOT NULL`,
    [crewId]
  );
  return res.rows.map((r: any) => r.push_token);
}

export async function verifyAndJoinPrivateRun(runId: string, userId: string, password?: string, token?: string) {
  const run = await pool.query(`SELECT host_id, invite_password, invite_token FROM runs WHERE id = $1 AND privacy = 'private'`, [runId]);
  if (!run.rows[0]) return { error: "run_not_found" };
  const r = run.rows[0];
  if (password && r.invite_password && r.invite_password === password) {
    await grantRunAccess(runId, userId);
    return { success: true };
  }
  if (token && r.invite_token && r.invite_token.toUpperCase() === token.toUpperCase()) {
    await grantRunAccess(runId, userId);
    return { success: true };
  }
  return { error: "invalid_credentials" };
}

export async function getRunByInviteToken(token: string) {
  const result = await pool.query(
    `SELECT r.*, u.name as host_name, u.username as host_username FROM runs r JOIN users u ON u.id = r.host_id WHERE r.invite_token = $1`,
    [token]
  );
  return result.rows[0] || null;
}

export async function inviteToRun(runId: string, inviteeId: string, hostId: string) {
  await pool.query(
    `INSERT INTO run_invites (run_id, invitee_id, invited_by) VALUES ($1, $2, $3) ON CONFLICT (run_id, invitee_id) DO NOTHING`,
    [runId, inviteeId, hostId]
  );
}

export async function updateMarkerIcon(userId: string, icon: string | null) {
  await pool.query(`UPDATE users SET marker_icon = $2 WHERE id = $1`, [userId, icon]);
}

export async function getSoloRuns(userId: string) {
  const result = await pool.query(
    `SELECT * FROM solo_runs WHERE user_id = $1 AND is_deleted IS NOT TRUE ORDER BY date DESC`,
    [userId]
  );
  return result.rows;
}

export async function getSoloRunAchievements(userId: string): Promise<Record<string, Array<{ label: string; rank: 1 | 2 | 3 }>>> {
  const result = await pool.query(
    `WITH
      half_mi AS (
        SELECT id, RANK() OVER (ORDER BY pace_min_per_mile ASC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
          AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0 AND distance_miles >= 0.5
      ),
      one_mi AS (
        SELECT id, RANK() OVER (ORDER BY pace_min_per_mile ASC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
          AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0 AND distance_miles >= 0.9
      ),
      two_mi AS (
        SELECT id, RANK() OVER (ORDER BY pace_min_per_mile ASC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
          AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0 AND distance_miles >= 1.9
      ),
      five_k AS (
        SELECT id, RANK() OVER (ORDER BY pace_min_per_mile ASC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
          AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0 AND distance_miles >= 3.0
      ),
      five_mi AS (
        SELECT id, RANK() OVER (ORDER BY pace_min_per_mile ASC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
          AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0 AND distance_miles >= 4.8
      ),
      ten_k AS (
        SELECT id, RANK() OVER (ORDER BY pace_min_per_mile ASC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
          AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0 AND distance_miles >= 6.0
      ),
      half_mara AS (
        SELECT id, RANK() OVER (ORDER BY pace_min_per_mile ASC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
          AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0 AND distance_miles >= 13.0
      ),
      full_mara AS (
        SELECT id, RANK() OVER (ORDER BY pace_min_per_mile ASC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
          AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0 AND distance_miles >= 26.0
      ),
      longest AS (
        SELECT id, RANK() OVER (ORDER BY distance_miles DESC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
      ),
      fastest AS (
        SELECT id, RANK() OVER (ORDER BY pace_min_per_mile ASC) AS rnk
        FROM solo_runs WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE
          AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0
      ),
      all_achievements AS (
        SELECT id, '½ mi' AS label, rnk FROM half_mi WHERE rnk <= 3
        UNION ALL SELECT id, '1 mi', rnk FROM one_mi WHERE rnk <= 3
        UNION ALL SELECT id, '2 mi', rnk FROM two_mi WHERE rnk <= 3
        UNION ALL SELECT id, '5K', rnk FROM five_k WHERE rnk <= 3
        UNION ALL SELECT id, '5 mi', rnk FROM five_mi WHERE rnk <= 3
        UNION ALL SELECT id, '10K', rnk FROM ten_k WHERE rnk <= 3
        UNION ALL SELECT id, 'Half', rnk FROM half_mara WHERE rnk <= 3
        UNION ALL SELECT id, 'Marathon', rnk FROM full_mara WHERE rnk <= 3
        UNION ALL SELECT id, 'Longest', rnk FROM longest WHERE rnk <= 3
        UNION ALL SELECT id, 'Fastest', rnk FROM fastest WHERE rnk <= 3
      )
    SELECT id, label, rnk FROM all_achievements ORDER BY id, rnk`,
    [userId]
  );

  const map: Record<string, Array<{ label: string; rank: 1 | 2 | 3 }>> = {};
  for (const row of result.rows) {
    if (!map[row.id]) map[row.id] = [];
    map[row.id].push({ label: row.label, rank: Math.min(row.rnk, 3) as 1 | 2 | 3 });
  }
  return map;
}

export async function getSoloRunById(id: string) {
  const result = await pool.query(`SELECT * FROM solo_runs WHERE id = $1`, [id]);
  if (!result.rows.length) return null;
  const row = result.rows[0];
  return { ...row, userId: row.user_id, distanceMiles: row.distance_miles, paceMinPerMile: row.pace_min_per_mile, durationSeconds: row.duration_seconds, elevationGainFt: row.elevation_gain_ft };
}

export async function createSoloRun(data: {
  userId: string;
  title?: string;
  date: string;
  distanceMiles: number;
  paceMinPerMile?: number | null;
  durationSeconds?: number | null;
  completed?: boolean;
  planned?: boolean;
  notes?: string;
  routePath?: Array<{ latitude: number; longitude: number }> | null;
  activityType?: string;
  savedPathId?: string | null;
  mileSplits?: Array<{ label: string; paceMinPerMile: number; isPartial: boolean }> | null;
  elevationGainFt?: number | null;
  stepCount?: number | null;
  moveTimeSeconds?: number | null;
  clientRunId?: string | null;
}) {
  const result = await pool.query(
    `INSERT INTO solo_runs (user_id, title, date, distance_miles, pace_min_per_mile, duration_seconds, completed, planned, notes, route_path, activity_type, saved_path_id, mile_splits, elevation_gain_ft, step_count, move_time_seconds, client_run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (user_id, client_run_id) WHERE client_run_id IS NOT NULL
     DO UPDATE SET title = solo_runs.title
     RETURNING *`,
    [
      data.userId,
      data.title ?? null,
      data.date,
      data.distanceMiles,
      data.paceMinPerMile ?? null,
      data.durationSeconds ?? null,
      data.completed ?? false,
      data.planned ?? false,
      data.notes ?? null,
      data.routePath ? JSON.stringify(data.routePath) : null,
      data.activityType ?? "run",
      data.savedPathId ?? null,
      data.mileSplits ? JSON.stringify(data.mileSplits) : null,
      data.elevationGainFt ?? null,
      data.stepCount ?? null,
      data.moveTimeSeconds ?? null,
      data.clientRunId ?? null,
    ]
  );
  return result.rows[0];
}

export async function getSoloRunPrTiers(userId: string, runId: string): Promise<{
  distanceTier: 1 | 2 | 3 | null;
  paceTier: 1 | 2 | 3 | null;
}> {
  const runRes = await pool.query(
    `SELECT distance_miles, pace_min_per_mile FROM solo_runs WHERE id = $1 AND user_id = $2 AND completed = true`,
    [runId, userId]
  );
  if (!runRes.rows[0]) return { distanceTier: null, paceTier: null };
  const { distance_miles, pace_min_per_mile } = runRes.rows[0];

  // Distance tier: count how many prior runs have greater distance
  const distCountRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM solo_runs
     WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE AND id != $2
       AND distance_miles > $3`,
    [userId, runId, distance_miles]
  );
  const distRank = parseInt(distCountRes.rows[0]?.cnt ?? "0") + 1;
  const distanceTier = distRank <= 3 ? (distRank as 1 | 2 | 3) : null;

  // Pace tier: rank among runs within ±25% of this distance (lower pace = faster = better)
  let paceTier: 1 | 2 | 3 | null = null;
  if (pace_min_per_mile && pace_min_per_mile > 0) {
    const paceCountRes = await pool.query(
      `SELECT COUNT(*) AS cnt FROM solo_runs
       WHERE user_id = $1 AND completed = true AND is_deleted IS NOT TRUE AND id != $2
         AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0
         AND distance_miles BETWEEN $3 * 0.75 AND $3 * 1.25
         AND pace_min_per_mile < $4`,
      [userId, runId, distance_miles, pace_min_per_mile]
    );
    const paceRank = parseInt(paceCountRes.rows[0]?.cnt ?? "0") + 1;
    paceTier = paceRank <= 3 ? (paceRank as 1 | 2 | 3) : null;
  }

  return { distanceTier, paceTier };
}

export async function getSoloRunsByPathId(userId: string, pathId: string) {
  const res = await pool.query(
    `SELECT * FROM solo_runs WHERE user_id = $1 AND saved_path_id = $2 AND completed = true AND is_deleted IS NOT TRUE ORDER BY date DESC`,
    [userId, pathId]
  );
  return res.rows;
}

export async function getStarredSoloRuns(userId: string) {
  const result = await pool.query(
    `SELECT * FROM solo_runs WHERE user_id = $1 AND is_starred = true AND completed = true AND is_deleted IS NOT TRUE ORDER BY date DESC`,
    [userId]
  );
  return result.rows;
}

export async function getUserPrContext(userId: string, excludeRunId: string): Promise<{
  maxDistance: number | null;
  bestPace: number | null;
  totalRuns: number;
}> {
  const res = await pool.query(
    `SELECT
       MAX(distance_miles) AS max_distance,
       MIN(CASE WHEN pace_min_per_mile > 0 THEN pace_min_per_mile END) AS best_pace,
       COUNT(*) AS total_runs
     FROM solo_runs
     WHERE user_id = $1
       AND completed = true
       AND is_deleted IS NOT TRUE
       AND id != $2`,
    [userId, excludeRunId]
  );
  const row = res.rows[0];
  return {
    maxDistance: row.max_distance != null ? parseFloat(row.max_distance) : null,
    bestPace: row.best_pace != null ? parseFloat(row.best_pace) : null,
    totalRuns: parseInt(row.total_runs ?? "0"),
  };
}

export async function toggleStarSoloRun(id: string, userId: string) {
  const result = await pool.query(
    `UPDATE solo_runs SET is_starred = NOT is_starred WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId]
  );
  return result.rows[0] || null;
}

export async function updateSoloRun(id: string, userId: string, updates: Record<string, any>) {
  const allowed = ["title", "date", "distance_miles", "pace_min_per_mile", "duration_seconds", "completed", "planned", "notes", "route_path", "is_starred", "elevation_gain_ft", "saved_path_id", "ai_summary"];
  const entries = Object.entries(updates).filter(([k]) => allowed.includes(k));
  if (!entries.length) return null;
  const fields = entries.map(([k], i) => `${k} = $${i + 3}`).join(", ");
  const values = entries.map(([, v]) => v);
  const result = await pool.query(
    `UPDATE solo_runs SET ${fields} WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId, ...values]
  );
  return result.rows[0] || null;
}

export async function deleteSoloRun(id: string, userId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const runRes = await client.query(
      `SELECT distance_miles, completed FROM solo_runs WHERE id = $1 AND user_id = $2 AND is_deleted = false`,
      [id, userId]
    );
    await client.query(
      `UPDATE solo_runs SET is_deleted = true WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (runRes.rows.length > 0 && runRes.rows[0].completed) {
      const distanceMiles = parseFloat(runRes.rows[0].distance_miles ?? "0") || 0;
      await client.query(
        `UPDATE users SET
           total_miles = GREATEST(total_miles - $2, 0),
           completed_runs = GREATEST(completed_runs - 1, 0)
         WHERE id = $1`,
        [userId, distanceMiles]
      );
    }
    // Suppress any notifications linked to this run so they are hidden immediately
    await client.query(
      `INSERT INTO run_notification_hidden (user_id, run_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, id]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function recomputeUserAvgPace(userId: string): Promise<void> {
  const paceRes = await pool.query(
    `SELECT AVG(pace_min_per_mile) AS avg_pace
     FROM solo_runs
     WHERE user_id = $1
       AND completed = true
       AND distance_miles > 0.5
       AND pace_min_per_mile IS NOT NULL
       AND pace_min_per_mile >= 2.0`,
    [userId]
  );
  const distRes = await pool.query(
    `SELECT AVG(distance_miles) AS avg_dist
     FROM solo_runs
     WHERE user_id = $1
       AND completed = true
       AND distance_miles > 0.1`,
    [userId]
  );
  const computedPace = paceRes.rows[0]?.avg_pace != null ? parseFloat(paceRes.rows[0].avg_pace) : null;
  const computedDist = distRes.rows[0]?.avg_dist != null ? parseFloat(distRes.rows[0].avg_dist) : null;
  await pool.query(`UPDATE users SET avg_pace = $2, avg_distance = $3 WHERE id = $1`, [userId, computedPace, computedDist]);
}

export async function updateSoloGoals(
  userId: string,
  paceGoal: number | null,
  distanceGoal: number,
  goalPeriod: string
) {
  await pool.query(
    `UPDATE users SET pace_goal = $2, distance_goal = $3, goal_period = $4 WHERE id = $1`,
    [userId, paceGoal, distanceGoal, goalPeriod]
  );
}

export async function getPublicRuns(filters?: {
  minPace?: number;
  maxPace?: number;
  minDistance?: number;
  maxDistance?: number;
  tag?: string;
  styles?: string[];
  swLat?: number;
  swLng?: number;
  neLat?: number;
  neLng?: number;
  currentUserId?: string;
}) {
  let query = `SELECT r.*, u.name as host_name, u.username as host_username, u.avg_rating as host_rating, u.rating_count as host_rating_count, u.photo_url as host_photo, u.marker_icon as host_marker_icon, u.hosted_runs as host_hosted_runs,
    (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) as participant_count,
    (SELECT COUNT(*) FROM planned_runs pr WHERE pr.run_id = r.id) as plan_count
    FROM runs r JOIN users u ON u.id = r.host_id
    WHERE r.privacy = 'public' AND (r.is_active = true OR r.date > NOW() - INTERVAL '90 minutes') AND r.is_completed = false AND r.crew_id IS NULL AND r.is_deleted IS NOT TRUE
    AND (u.suspended_until IS NULL OR u.suspended_until < NOW())`;
  const params: any[] = [];
  let idx = 1;
  if (filters?.minPace !== undefined) { query += ` AND r.max_pace >= $${idx++}`; params.push(filters.minPace); }
  if (filters?.maxPace !== undefined) { query += ` AND r.min_pace <= $${idx++}`; params.push(filters.maxPace); }
  if (filters?.minDistance !== undefined) { query += ` AND r.max_distance >= $${idx++}`; params.push(filters.minDistance); }
  if (filters?.maxDistance !== undefined) { query += ` AND r.min_distance <= $${idx++}`; params.push(filters.maxDistance); }
  if (filters?.tag) { query += ` AND $${idx++} = ANY(r.tags)`; params.push(filters.tag); }
  if (filters?.styles && filters.styles.length > 0) {
    query += ` AND r.tags && $${idx++}`;
    params.push(filters.styles);
  }
  if (filters?.swLat !== undefined && filters.neLat !== undefined) {
    query += ` AND r.location_lat BETWEEN $${idx++} AND $${idx++}`;
    params.push(filters.swLat, filters.neLat);
  }
  if (filters?.swLng !== undefined && filters.neLng !== undefined) {
    query += ` AND r.location_lng BETWEEN $${idx++} AND $${idx++}`;
    params.push(filters.swLng, filters.neLng);
  }
  if (filters?.currentUserId) {
    query += ` AND r.host_id NOT IN (
      SELECT blocked_id FROM user_blocks WHERE blocker_id = $${idx}
      UNION
      SELECT blocker_id FROM user_blocks WHERE blocked_id = $${idx}
    )`;
    params.push(filters.currentUserId);
    idx++;
  }
  query += ` ORDER BY r.date ASC LIMIT 200`;
  const result = await pool.query(query, params);
  return result.rows;
}

export async function getRunById(id: string) {
  const result = await pool.query(
    `SELECT r.*, u.name as host_name, u.username as host_username, u.avg_rating as host_rating, u.rating_count as host_rating_count,
      u.photo_url as host_photo, u.avg_pace as host_avg_pace, u.hosted_runs as host_hosted_runs,
      c.name as crew_name,
      sp.name as saved_path_name,
      sp.route_path as saved_path_route,
      (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) as participant_count,
      (SELECT COUNT(*) FROM planned_runs pr WHERE pr.run_id = r.id) as plan_count
     FROM runs r
     JOIN users u ON u.id = r.host_id
     LEFT JOIN crews c ON c.id = r.crew_id
     LEFT JOIN saved_paths sp ON sp.id = r.saved_path_id
     WHERE r.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

export async function getUserRuns(userId: string) {
  const result = await pool.query(
    `SELECT r.*, u.name as host_name, u.username as host_username,
      (SELECT rp2.status FROM run_participants rp2 WHERE rp2.run_id = r.id AND rp2.user_id = $1 LIMIT 1) as my_status,
      CASE WHEN r.host_id = $1 THEN true ELSE false END as is_host,
      COALESCE((SELECT rp3.is_present FROM run_participants rp3 WHERE rp3.run_id = r.id AND rp3.user_id = $1 LIMIT 1), false) as my_is_present,
      (SELECT rp5.final_distance FROM run_participants rp5 WHERE rp5.run_id = r.id AND rp5.user_id = $1 LIMIT 1) as my_final_distance,
      (SELECT rp6.final_pace FROM run_participants rp6 WHERE rp6.run_id = r.id AND rp6.user_id = $1 LIMIT 1) as my_final_pace,
      (SELECT rp7.mile_splits FROM run_participants rp7 WHERE rp7.run_id = r.id AND rp7.user_id = $1 LIMIT 1) as my_mile_splits,
      (SELECT json_agg(pt ORDER BY pt.recorded_at)
         FROM (
           SELECT latitude, longitude, recorded_at
           FROM run_tracking_points
           WHERE run_id = r.id AND user_id = $1
           ORDER BY recorded_at
           LIMIT 200
         ) pt
      ) as my_route_path
     FROM runs r
     JOIN users u ON u.id = r.host_id
     WHERE (r.host_id = $1 OR r.id IN (SELECT run_id FROM run_participants WHERE user_id = $1 AND status != 'cancelled' AND (abandoned IS NULL OR abandoned = false)))
       AND r.is_deleted IS NOT TRUE
       AND r.is_abandoned IS NOT TRUE
       AND (
         r.date > NOW()
         OR r.host_id = $1
         OR EXISTS (SELECT 1 FROM run_participants rp4 WHERE rp4.run_id = r.id AND rp4.user_id = $1 AND rp4.status != 'cancelled' AND (rp4.abandoned IS NULL OR rp4.abandoned = false))
       )
     ORDER BY r.date DESC`,
    [userId]
  );
  return result.rows;
}


export async function joinRun(runId: string, userId: string, paceGroupLabel?: string | null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock the run row first to serialize concurrent join attempts
    const runStateRes = await client.query(
      `SELECT id, is_deleted, is_completed, is_active, max_participants FROM runs WHERE id = $1 FOR UPDATE`,
      [runId]
    );
    if (!runStateRes.rows.length) {
      await client.query('ROLLBACK');
      throw new Error("RUN_NOT_FOUND");
    }
    const runState = runStateRes.rows[0];
    if (runState.is_deleted) {
      await client.query('ROLLBACK');
      throw new Error("RUN_CANCELLED");
    }
    if (runState.is_completed) {
      await client.query('ROLLBACK');
      throw new Error("RUN_COMPLETED");
    }
    const maxP: number | null = runState.max_participants ?? null;

    const existing = await client.query(
      `SELECT * FROM run_participants WHERE run_id = $1 AND user_id = $2`,
      [runId, userId]
    );
    if (existing.rows.length > 0) {
      if (existing.rows[0].status === "cancelled") {
        // T1.5: max_participants is a suggestion, NOT a hard ceiling. People bring
        // friends, walk-ins happen, RSVP overshoot is fine. We let the host see
        // "X going" possibly above the planned cap and decide for themselves.
        await client.query(
          `UPDATE run_participants SET status = 'joined', pace_group_label = $3, is_present = $4
           WHERE run_id = $1 AND user_id = $2`,
          [runId, userId, paceGroupLabel || null, !!runState.is_active]
        );
      } else if (paceGroupLabel) {
        await client.query(
          `UPDATE run_participants SET pace_group_label = $3 WHERE run_id = $1 AND user_id = $2`,
          [runId, userId, paceGroupLabel]
        );
      }
      const updated = await client.query(
        `SELECT * FROM run_participants WHERE run_id = $1 AND user_id = $2`,
        [runId, userId]
      );
      await client.query(`DELETE FROM planned_runs WHERE user_id = $1 AND run_id = $2`, [userId, runId]);
      await client.query('COMMIT');
      return updated.rows[0];
    }

    // New participant. T1.5: capacity is a suggestion, never a wall.
    const insertRes = await client.query(
      `INSERT INTO run_participants (run_id, user_id, pace_group_label, is_present)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [runId, userId, paceGroupLabel || null, !!runState.is_active]
    );
    if (!insertRes.rows.length) {
      await client.query('ROLLBACK');
      throw new Error("RUN_NOT_FOUND");
    }
    await client.query(`DELETE FROM planned_runs WHERE user_id = $1 AND run_id = $2`, [userId, runId]);
    await client.query('COMMIT');
    return insertRes.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function requestJoinRun(runId: string, userId: string) {
  const existing = await pool.query(
    `SELECT * FROM run_participants WHERE run_id = $1 AND user_id = $2`,
    [runId, userId]
  );
  if (existing.rows.length > 0) {
    return { alreadyExists: true, row: existing.rows[0] };
  }
  const result = await pool.query(
    `INSERT INTO run_participants (run_id, user_id, status) VALUES ($1, $2, 'pending') RETURNING *`,
    [runId, userId]
  );
  return { alreadyExists: false, row: result.rows[0] };
}

export async function leaveRun(runId: string, userId: string) {
  await pool.query(
    `UPDATE run_participants SET status = 'cancelled' WHERE run_id = $1 AND user_id = $2`,
    [runId, userId]
  );
}

export async function getParticipantStatus(runId: string, userId: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT status FROM run_participants WHERE run_id = $1 AND user_id = $2`,
    [runId, userId]
  );
  return result.rows[0]?.status ?? null;
}

export async function getRunParticipantCount(runId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*) FROM run_participants WHERE run_id = $1 AND status IN ('joined', 'confirmed')`,
    [runId]
  );
  return parseInt(result.rows[0].count, 10);
}

export async function decrementCompletedRuns(userId: string): Promise<void> {
  await pool.query(
    `UPDATE users SET completed_runs = GREATEST(0, completed_runs - 1) WHERE id = $1`,
    [userId]
  );
}

export async function getGarminToken(userId: string): Promise<{ access_token: string; token_secret: string } | null> {
  const result = await pool.query(
    `SELECT garmin_access_token as access_token, garmin_token_secret as token_secret FROM users WHERE id = $1`,
    [userId]
  );
  if (!result.rows[0]?.access_token) return null;
  return result.rows[0];
}

export async function getGarminLastSync(userId: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT MAX(created_at) as last_sync FROM solo_runs WHERE user_id = $1 AND garmin_activity_id IS NOT NULL`,
    [userId]
  );
  return result.rows[0]?.last_sync?.toISOString() ?? null;
}

export async function saveGarminToken(userId: string, accessToken: string, tokenSecret: string): Promise<void> {
  await pool.query(
    `UPDATE users SET garmin_access_token = $1, garmin_token_secret = $2 WHERE id = $3`,
    [accessToken, tokenSecret, userId]
  );
}

export async function saveGarminActivity(userId: string, garminActivityId: string, data: {
  title: string;
  date: Date;
  distanceMiles: number;
  paceMinPerMile: number | null;
  durationSeconds: number | null;
  activityType: string;
}): Promise<boolean> {
  const existing = await pool.query(
    `SELECT id FROM solo_runs WHERE garmin_activity_id = $1`,
    [garminActivityId]
  );
  if (existing.rows.length > 0) return false;
  await pool.query(
    `INSERT INTO solo_runs (user_id, garmin_activity_id, source, title, date, distance_miles, pace_min_per_mile, duration_seconds, activity_type, completed, planned)
     VALUES ($1, $2, 'garmin', $3, $4, $5, $6, $7, $8, true, false)`,
    [userId, garminActivityId, data.title, data.date, data.distanceMiles, data.paceMinPerMile, data.durationSeconds, data.activityType]
  );
  return true;
}

// ─── Strava (OAuth 2.0) ──────────────────────────────────────────────────────

export async function getStravaTokens(userId: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  athlete_id: string;
} | null> {
  const result = await pool.query(
    `SELECT strava_access_token AS access_token,
            strava_refresh_token AS refresh_token,
            strava_expires_at AS expires_at,
            strava_athlete_id AS athlete_id
     FROM users WHERE id = $1`,
    [userId]
  );
  const row = result.rows[0];
  if (!row?.access_token) return null;
  return row;
}

export async function saveStravaTokens(
  userId: string,
  athleteId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: Date
): Promise<void> {
  await pool.query(
    `UPDATE users
       SET strava_athlete_id = $1,
           strava_access_token = $2,
           strava_refresh_token = $3,
           strava_expires_at = $4
     WHERE id = $5`,
    [athleteId, accessToken, refreshToken, expiresAt, userId]
  );
}

export async function clearStravaTokens(userId: string): Promise<void> {
  await pool.query(
    `UPDATE users
       SET strava_athlete_id = NULL,
           strava_access_token = NULL,
           strava_refresh_token = NULL,
           strava_expires_at = NULL
     WHERE id = $1`,
    [userId]
  );
}

export async function getStravaLastSync(userId: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT MAX(created_at) as last_sync
       FROM solo_runs
      WHERE user_id = $1 AND strava_activity_id IS NOT NULL`,
    [userId]
  );
  return result.rows[0]?.last_sync?.toISOString() ?? null;
}

export async function saveStravaActivity(userId: string, stravaActivityId: string, data: {
  title: string;
  date: Date;
  distanceMiles: number;
  paceMinPerMile: number | null;
  durationSeconds: number | null;
  activityType: string;
}): Promise<boolean> {
  const existing = await pool.query(
    `SELECT id FROM solo_runs WHERE strava_activity_id = $1`,
    [stravaActivityId]
  );
  if (existing.rows.length > 0) return false;
  await pool.query(
    `INSERT INTO solo_runs (user_id, strava_activity_id, source, title, date, distance_miles, pace_min_per_mile, duration_seconds, activity_type, completed, planned)
     VALUES ($1, $2, 'strava', $3, $4, $5, $6, $7, $8, true, false)`,
    [userId, stravaActivityId, data.title, data.date, data.distanceMiles, data.paceMinPerMile, data.durationSeconds, data.activityType]
  );
  return true;
}

// ─── User Streaks ──────────────────────────────────────────────────────────

export interface UserStreakInfo {
  current_streak_days: number;
  longest_streak_days: number;
  last_run_date: string | null;
  at_risk: boolean;
  ran_today: boolean;
}

/**
 * Compute current + longest streak of consecutive days on which the user
 * logged at least one completed activity. Uses UTC day boundaries (good enough
 * for MVP; edge cases near midnight can be off by a day).
 */
export async function getUserStreaks(userId: string): Promise<UserStreakInfo> {
  const { rows } = await pool.query(
    `SELECT DISTINCT DATE(date) AS day
       FROM solo_runs
      WHERE user_id = $1
        AND completed = true
        AND COALESCE(is_deleted, false) = false
      ORDER BY day DESC
      LIMIT 800`,
    [userId]
  );

  if (!rows.length) {
    return { current_streak_days: 0, longest_streak_days: 0, last_run_date: null, at_risk: false, ran_today: false };
  }

  const days: Date[] = rows.map((r: any) => {
    const d = r.day instanceof Date ? r.day : new Date(r.day);
    // Normalize to UTC midnight
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  });

  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const oneDayMs = 24 * 60 * 60 * 1000;

  const ranToday = days[0].getTime() === todayUtc.getTime();

  // Current streak: count consecutive days ending today or yesterday
  let currentStreak = 0;
  const yesterdayUtc = new Date(todayUtc.getTime() - oneDayMs);
  let expected: Date;
  if (ranToday) {
    expected = todayUtc;
  } else if (days[0].getTime() === yesterdayUtc.getTime()) {
    expected = yesterdayUtc;
  } else {
    // Streak already broken
    expected = new Date(0);
  }

  if (expected.getTime() > 0) {
    for (const d of days) {
      if (d.getTime() === expected.getTime()) {
        currentStreak += 1;
        expected = new Date(expected.getTime() - oneDayMs);
      } else if (d.getTime() < expected.getTime()) {
        break;
      }
    }
  }

  // Longest streak (simple walk)
  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    const gap = (days[i - 1].getTime() - days[i].getTime()) / oneDayMs;
    if (gap === 1) {
      run += 1;
      if (run > longest) longest = run;
    } else if (gap > 1) {
      run = 1;
    }
  }
  if (currentStreak > longest) longest = currentStreak;

  // "At risk" = streak is alive but user hasn't run today yet
  const atRisk = currentStreak > 0 && !ranToday;

  return {
    current_streak_days: currentStreak,
    longest_streak_days: longest,
    last_run_date: days[0].toISOString().slice(0, 10),
    at_risk: atRisk,
    ran_today: ranToday,
  };
}

// ─── Crew Goals ────────────────────────────────────────────────────────────

export type CrewGoalActivityType = "run" | "ride" | "walk" | "all";

export interface CrewGoalRow {
  activity_type: CrewGoalActivityType;
  weekly_target_miles: number | null;
  monthly_target_miles: number | null;
  updated_by: string | null;
  updated_at: string | null;
}

export async function getCrewGoal(
  crewId: string,
  activityType: CrewGoalActivityType
): Promise<CrewGoalRow | null> {
  const { rows } = await pool.query(
    `SELECT activity_type, weekly_target_miles, monthly_target_miles, updated_by, updated_at
       FROM crew_goals
      WHERE crew_id = $1 AND activity_type = $2`,
    [crewId, activityType]
  );
  if (!rows.length) return null;
  return {
    activity_type: rows[0].activity_type,
    weekly_target_miles: rows[0].weekly_target_miles,
    monthly_target_miles: rows[0].monthly_target_miles,
    updated_by: rows[0].updated_by,
    updated_at: rows[0].updated_at?.toISOString?.() ?? null,
  };
}

export async function getAllCrewGoals(crewId: string): Promise<CrewGoalRow[]> {
  const { rows } = await pool.query(
    `SELECT activity_type, weekly_target_miles, monthly_target_miles, updated_by, updated_at
       FROM crew_goals
      WHERE crew_id = $1`,
    [crewId]
  );
  return rows.map((r: any) => ({
    activity_type: r.activity_type,
    weekly_target_miles: r.weekly_target_miles,
    monthly_target_miles: r.monthly_target_miles,
    updated_by: r.updated_by,
    updated_at: r.updated_at?.toISOString?.() ?? null,
  }));
}

export async function saveCrewGoal(
  crewId: string,
  activityType: CrewGoalActivityType,
  weeklyTargetMiles: number | null,
  monthlyTargetMiles: number | null,
  updatedBy: string
): Promise<void> {
  await pool.query(
    `INSERT INTO crew_goals (crew_id, activity_type, weekly_target_miles, monthly_target_miles, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (crew_id, activity_type) DO UPDATE
       SET weekly_target_miles = EXCLUDED.weekly_target_miles,
           monthly_target_miles = EXCLUDED.monthly_target_miles,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
    [crewId, activityType, weeklyTargetMiles, monthlyTargetMiles, updatedBy]
  );
}

/**
 * Aggregate miles across all active crew members for the current week (Mon-based)
 * and current month. Filtered by activity_type ('all' = run+ride+walk).
 */
export async function getCrewGoalProgress(
  crewId: string,
  activityType: CrewGoalActivityType
): Promise<{ weekly_miles: number; monthly_miles: number }> {
  // Start of current week (Monday 00:00 local/UTC — using UTC for consistency)
  const now = new Date();
  const weekStart = new Date(now);
  const day = weekStart.getUTCDay(); // 0=Sun ... 6=Sat
  const diff = (day === 0 ? -6 : 1 - day); // back to Monday
  weekStart.setUTCDate(weekStart.getUTCDate() + diff);
  weekStart.setUTCHours(0, 0, 0, 0);

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));

  const params: any[] = [crewId, monthStart.toISOString(), weekStart.toISOString()];
  let activityFilter = "";
  if (activityType !== "all") {
    params.push(activityType);
    activityFilter = `AND sr.activity_type = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN sr.date >= $3 THEN sr.distance_miles ELSE 0 END), 0) AS weekly_miles,
       COALESCE(SUM(sr.distance_miles), 0) AS monthly_miles
       FROM solo_runs sr
       JOIN crew_members cm ON cm.user_id = sr.user_id
      WHERE cm.crew_id = $1
        AND cm.status = 'member'
        AND sr.completed = true
        AND COALESCE(sr.is_deleted, false) = false
        AND sr.date >= $2
        ${activityFilter}`,
    params
  );

  return {
    weekly_miles: Number(rows[0]?.weekly_miles ?? 0),
    monthly_miles: Number(rows[0]?.monthly_miles ?? 0),
  };
}

export async function saveHealthKitActivity(userId: string, healthKitId: string, data: {
  title: string;
  date: Date;
  distanceMiles: number;
  paceMinPerMile: number | null;
  durationSeconds: number | null;
  activityType: string;
}): Promise<boolean> {
  const existing = await pool.query(
    `SELECT id FROM solo_runs WHERE apple_health_id = $1`,
    [healthKitId]
  );
  if (existing.rows.length > 0) return false;
  await pool.query(
    `INSERT INTO solo_runs (user_id, apple_health_id, source, title, date, distance_miles, pace_min_per_mile, duration_seconds, activity_type, completed, planned)
     VALUES ($1, $2, 'apple_health', $3, $4, $5, $6, $7, $8, true, false)`,
    [userId, healthKitId, data.title, data.date, data.distanceMiles, data.paceMinPerMile, data.durationSeconds, data.activityType]
  );
  return true;
}

export async function saveHealthConnectActivity(userId: string, hcId: string, data: {
  title: string;
  date: Date;
  distanceMiles: number;
  paceMinPerMile: number | null;
  durationSeconds: number | null;
  activityType: string;
}): Promise<boolean> {
  const byId = await pool.query(
    `SELECT id FROM solo_runs WHERE health_connect_id = $1`,
    [hcId]
  );
  if (byId.rows.length > 0) return false;

  const windowStart = new Date(data.date.getTime() - 60000);
  const windowEnd = new Date(data.date.getTime() + 60000);
  const byTime = await pool.query(
    `SELECT id FROM solo_runs WHERE user_id = $1 AND date >= $2 AND date <= $3 AND completed = true`,
    [userId, windowStart, windowEnd]
  );
  if (byTime.rows.length > 0) return false;

  await pool.query(
    `INSERT INTO solo_runs (user_id, health_connect_id, source, title, date, distance_miles, pace_min_per_mile, duration_seconds, activity_type, completed, planned)
     VALUES ($1, $2, 'health_connect', $3, $4, $5, $6, $7, $8, true, false)`,
    [userId, hcId, data.title, data.date, data.distanceMiles, data.paceMinPerMile, data.durationSeconds, data.activityType]
  );
  return true;
}

export async function getRunParticipantTokens(runId: string): Promise<{ name: string; push_token: string }[]> {
  const result = await pool.query(
    `SELECT u.name, u.push_token
     FROM run_participants rp
     JOIN users u ON u.id = rp.user_id
     WHERE rp.run_id = $1 AND rp.status != 'cancelled' AND u.push_token IS NOT NULL`,
    [runId]
  );
  return result.rows;
}

export async function updateRunDateTime(runId: string, userId: string, newDate: string) {
  const run = await pool.query(`SELECT * FROM runs WHERE id = $1`, [runId]);
  if (!run.rows.length) throw new Error("Run not found");
  if (run.rows[0].host_id !== userId) throw new Error("Only the host can edit this run");
  const updated = await pool.query(
    `UPDATE runs SET date = $2, notif_late_start_sent = false, notif_pre_run_sent = false WHERE id = $1 RETURNING *`,
    [runId, newDate]
  );
  return updated.rows[0];
}

// Generalized host-edit for a scheduled event. Accepts any subset of editable
// fields, validates ownership, builds an UPDATE dynamically, and returns
// { before, after, changedFields } so the route layer can notify participants
// with a readable diff.
export type RunEditableFields = Partial<{
  date: string;            // ISO string
  title: string;
  description: string | null;
  locationName: string;
  locationLat: number;
  locationLng: number;
  minDistance: number;
  maxDistance: number;
  minPace: number;
  maxPace: number;
  maxParticipants: number;
  paceGroups: { label: string; minPace: number; maxPace: number }[] | null;
}>;

export async function updateRun(runId: string, userId: string, patch: RunEditableFields) {
  const prev = await pool.query(`SELECT * FROM runs WHERE id = $1`, [runId]);
  if (!prev.rows.length) throw new Error("Run not found");
  const before = prev.rows[0];
  if (before.host_id !== userId) throw new Error("Only the host can edit this run");

  // Whitelist → db-column mapping. Keys in patch that aren't here are ignored.
  const map: Record<Exclude<keyof RunEditableFields, "paceGroups">, string> = {
    date: "date",
    title: "title",
    description: "description",
    locationName: "location_name",
    locationLat: "location_lat",
    locationLng: "location_lng",
    minDistance: "min_distance",
    maxDistance: "max_distance",
    minPace: "min_pace",
    maxPace: "max_pace",
    maxParticipants: "max_participants",
  };
  const sets: string[] = [];
  const values: any[] = [runId];
  const changedFields: string[] = [];
  for (const [k, col] of Object.entries(map) as [Exclude<keyof RunEditableFields, "paceGroups">, string][]) {
    if (patch[k] === undefined) continue;
    const v = patch[k];
    const cur = before[col];
    // Coerce dates to comparable ISO
    const norm = (x: any) => (x instanceof Date ? x.toISOString() : (col === "date" && typeof x === "string") ? new Date(x).toISOString() : x);
    if (norm(cur) === norm(v)) continue;
    values.push(v);
    sets.push(`${col} = $${values.length}`);
    changedFields.push(k);
  }
  // pace_groups is JSONB — serialize the array (or null to clear).
  if (patch.paceGroups !== undefined) {
    const nextJson = patch.paceGroups === null || patch.paceGroups.length === 0
      ? null
      : JSON.stringify(patch.paceGroups);
    const curJson = before.pace_groups == null ? null : JSON.stringify(before.pace_groups);
    if (nextJson !== curJson) {
      values.push(nextJson);
      sets.push(`pace_groups = $${values.length}`);
      changedFields.push("paceGroups");
    }
  }
  if (sets.length === 0) {
    return { before, after: before, changedFields: [] };
  }
  // Reset late-start / pre-run notifications when the date changes so they refire
  if (changedFields.includes("date")) {
    sets.push(`notif_late_start_sent = false`, `notif_pre_run_sent = false`);
  }
  const res = await pool.query(
    `UPDATE runs SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
    values
  );
  return { before, after: res.rows[0], changedFields };
}

export async function cancelRun(runId: string, userId: string) {
  const run = await pool.query(`SELECT * FROM runs WHERE id = $1`, [runId]);
  if (!run.rows.length) throw new Error("Run not found");
  if (run.rows[0].host_id !== userId) throw new Error("Only the host can cancel this run");
  const tokens = await getRunParticipantTokens(runId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM run_tracking_points WHERE run_id = $1`, [runId]);
    await client.query(`DELETE FROM run_messages WHERE run_id = $1`, [runId]);
    // scheduled_run_notifications — only delete if the table exists (may not be provisioned yet)
    const hasScheduledTable = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'scheduled_run_notifications' LIMIT 1`
    );
    if (hasScheduledTable.rows.length > 0) {
      await client.query(`DELETE FROM scheduled_run_notifications WHERE run_id = $1`, [runId]);
    }
    await client.query(`DELETE FROM planned_runs WHERE run_id = $1`, [runId]);
    await client.query(`DELETE FROM run_participants WHERE run_id = $1`, [runId]);
    await client.query(`DELETE FROM run_invites WHERE run_id = $1`, [runId]);
    await client.query(`DELETE FROM bookmarked_runs WHERE run_id = $1`, [runId]);
    await client.query(`DELETE FROM run_photos WHERE run_id = $1`, [runId]);
    await client.query(`DELETE FROM runs WHERE id = $1`, [runId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { title: run.rows[0].title, tokens };
}

export async function getRunParticipants(runId: string) {
  const result = await pool.query(
    `SELECT u.id, u.name, u.photo_url, u.avg_pace, u.avg_distance, rp.status, rp.joined_at, rp.id as participation_id, rp.pace_group_label,
       (SELECT a.slug FROM achievements a
        WHERE a.user_id = u.id AND a.slug IN ('reliable_90','reliable_80','reliable_65','reliable_50')
        ORDER BY CASE a.slug
          WHEN 'reliable_90' THEN 1
          WHEN 'reliable_80' THEN 2
          WHEN 'reliable_65' THEN 3
          WHEN 'reliable_50' THEN 4
        END LIMIT 1) AS reliability_slug
     FROM run_participants rp JOIN users u ON u.id = rp.user_id
     WHERE rp.run_id = $1 AND rp.status != 'cancelled' ORDER BY rp.pace_group_label ASC NULLS LAST, rp.joined_at ASC`,
    [runId]
  );
  return result.rows;
}

export async function confirmRunCompletion(runId: string, userId: string, milesLogged: number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE run_participants SET status = 'confirmed', miles_logged = $3 WHERE run_id = $1 AND user_id = $2`,
      [runId, userId, milesLogged]
    );
    const userResult = await client.query(
      `UPDATE users SET
        completed_runs = completed_runs + 1,
        total_miles = total_miles + $2,
        miles_this_year = miles_this_year + $2,
        miles_this_month = miles_this_month + $2
       WHERE id = $1 RETURNING total_miles`,
      [userId, milesLogged]
    );
    const totalMiles = userResult.rows[0]?.total_miles;

    const runRes = await client.query(`SELECT host_id FROM runs WHERE id = $1`, [runId]);
    const hostId = runRes.rows[0]?.host_id;
    if (hostId && userId !== hostId) {
      const confirmedNonHost = await client.query(
        `SELECT COUNT(*) as cnt FROM run_participants WHERE run_id = $1 AND status = 'confirmed' AND user_id != $2`,
        [runId, hostId]
      );
      if (parseInt(confirmedNonHost.rows[0]?.cnt) === 1) {
        await client.query(`UPDATE users SET hosted_runs = hosted_runs + 1 WHERE id = $1`, [hostId]);
      }
    }

    if (totalMiles !== undefined) {
      await checkAndAwardAchievements(userId, totalMiles, client);
    }
    await checkHostUnlock(userId, client);

    const runData = await client.query(`SELECT crew_id FROM runs WHERE id = $1`, [runId]);
    let crewStreakUpdated: { crewId: string; newStreak: number } | null = null;
    if (runData.rows[0]?.crew_id) {
      const crewId = runData.rows[0].crew_id;
      const crewRes = await client.query(
        `SELECT id, name, current_streak_weeks, last_run_week FROM crews WHERE id = $1 FOR UPDATE`,
        [crewId]
      );
      if (crewRes.rows[0]) {
        const crew = crewRes.rows[0];
        const now = new Date();
        const lastRun = crew.last_run_week ? new Date(crew.last_run_week) : null;
        const getWeekNumber = (d: Date) => {
          const onejan = new Date(d.getFullYear(), 0, 1);
          return Math.ceil((((d.getTime() - onejan.getTime()) / 86400000) + onejan.getDay() + 1) / 7);
        };
        const currentWeek = getWeekNumber(now);
        const currentYear = now.getFullYear();
        const lastWeek = lastRun ? getWeekNumber(lastRun) : -1;
        const lastYear = lastRun ? lastRun.getFullYear() : -1;
        let newStreak = crew.current_streak_weeks || 0;
        if (lastYear === currentYear && lastWeek === currentWeek) {
        } else if (lastYear === currentYear && lastWeek === currentWeek - 1) {
          newStreak++;
        } else if (lastYear === currentYear - 1 && lastWeek >= 52 && currentWeek === 1) {
          newStreak++;
        } else {
          newStreak = 1;
        }
        await client.query(
          `UPDATE crews SET current_streak_weeks = $2, last_run_week = $3 WHERE id = $1`,
          [crewId, newStreak, now]
        );
        crewStreakUpdated = { crewId, newStreak };
      }
    }

    await client.query('COMMIT');

    return { success: true, crewStreakUpdated };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Credit stats and personal achievements for a single ghost-run participant.
 * Mirrors confirmRunCompletion but intentionally omits the crew-streak update
 * so that the caller can perform a single streak update per run after all
 * participants have been processed.
 */
export async function creditGhostParticipant(
  runId: string,
  userId: string,
  milesLogged: number
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE run_participants SET status = 'confirmed', miles_logged = $3
       WHERE run_id = $1 AND user_id = $2`,
      [runId, userId, milesLogged]
    );
    const userResult = await client.query(
      `UPDATE users SET
         completed_runs = completed_runs + 1,
         total_miles    = total_miles    + $2,
         miles_this_year  = miles_this_year  + $2,
         miles_this_month = miles_this_month + $2
       WHERE id = $1 RETURNING total_miles`,
      [userId, milesLogged]
    );
    const totalMiles = userResult.rows[0]?.total_miles;

    const runRes = await client.query(`SELECT host_id FROM runs WHERE id = $1`, [runId]);
    const hostId = runRes.rows[0]?.host_id;
    if (hostId && userId !== hostId) {
      const confirmedNonHost = await client.query(
        `SELECT COUNT(*) as cnt FROM run_participants
         WHERE run_id = $1 AND status = 'confirmed' AND user_id != $2`,
        [runId, hostId]
      );
      if (parseInt(confirmedNonHost.rows[0]?.cnt) === 1) {
        await client.query(`UPDATE users SET hosted_runs = hosted_runs + 1 WHERE id = $1`, [hostId]);
      }
    }

    if (totalMiles !== undefined) {
      await checkAndAwardAchievements(userId, totalMiles, client);
    }
    await checkHostUnlock(userId, client);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Advance the crew streak for a given crew — called once per run after all
 * ghost participants have been credited so the streak ticks exactly once.
 */
export async function updateCrewStreakForRun(crewId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const crewRes = await client.query(
      `SELECT id, current_streak_weeks, last_run_week FROM crews WHERE id = $1 FOR UPDATE`,
      [crewId]
    );
    if (!crewRes.rows[0]) {
      await client.query("ROLLBACK");
      return;
    }
    const crew = crewRes.rows[0];
    const now = new Date();
    const lastRun = crew.last_run_week ? new Date(crew.last_run_week) : null;
    const getWeekNumber = (d: Date) => {
      const onejan = new Date(d.getFullYear(), 0, 1);
      return Math.ceil((((d.getTime() - onejan.getTime()) / 86400000) + onejan.getDay() + 1) / 7);
    };
    const currentWeek = getWeekNumber(now);
    const currentYear = now.getFullYear();
    const lastWeek = lastRun ? getWeekNumber(lastRun) : -1;
    const lastYear = lastRun ? lastRun.getFullYear() : -1;
    let newStreak = crew.current_streak_weeks || 0;
    let sameWeek = false;
    if (lastYear === currentYear && lastWeek === currentWeek) {
      // Same week — already credited, idempotent no-op
      sameWeek = true;
    } else if (
      (lastYear === currentYear && lastWeek === currentWeek - 1) ||
      (lastYear === currentYear - 1 && lastWeek >= 52 && currentWeek === 1)
    ) {
      newStreak++;
    } else {
      newStreak = 1;
    }
    // T3.8: skip UPDATE entirely on same-week re-runs so we don't churn
    // last_run_week for no reason. Otherwise we get noisy writes if the
    // late-start monitor processes the same crew twice in a tick.
    if (!sameWeek) {
      await client.query(
        `UPDATE crews SET current_streak_weeks = $2, last_run_week = $3 WHERE id = $1`,
        [crewId, newStreak, now]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// ─── Live Group Run ───────────────────────────────────────────────────────────

export async function startGroupRun(runId: string, hostId: string) {
  const runRes = await pool.query(`SELECT * FROM runs WHERE id = $1`, [runId]);
  if (!runRes.rows.length) throw new Error("Run not found");
  const run = runRes.rows[0];
  if (run.host_id !== hostId) throw new Error("Only the host can start the run");
  if (run.is_active) throw new Error("Run already started");

  await pool.query(`UPDATE runs SET is_active = true, started_at = NOW() WHERE id = $1`, [runId]);

  // Mark ALL joined/confirmed participants as present immediately — so nobody is silently dropped
  // at start just because they haven't opened the tracking screen yet.
  // NOTE: $1 is explicitly cast to text because Postgres can't deduce a single type
  // when the same parameter appears in both the SELECT projection (insert value)
  // and a WHERE comparison — throws "inconsistent types deduced for parameter $1".
  await pool.query(
    `INSERT INTO run_participants (run_id, user_id, status, is_present)
     SELECT $1::text, user_id, status, true
     FROM run_participants
     WHERE run_id = $1::text AND status IN ('joined', 'confirmed')
     ON CONFLICT (run_id, user_id) DO UPDATE SET is_present = true`,
    [runId]
  );

  // Also mark the host present (in case they don't have a participant row yet).
  await pool.query(
    `INSERT INTO run_participants (run_id, user_id, status, is_present)
     VALUES ($1, $2, 'joined', true)
     ON CONFLICT (run_id, user_id) DO UPDATE SET is_present = true`,
    [runId, hostId]
  );

  // Proximity-only fallback: mark any nearby users with pre-existing pings as present,
  // even if they're not on the RSVP list (walk-ins who pinged before the host started).
  const latestPings = await pool.query(
    `SELECT DISTINCT ON (user_id) user_id, latitude, longitude
     FROM run_tracking_points WHERE run_id = $1 ORDER BY user_id, recorded_at DESC`,
    [runId]
  );
  for (const ping of latestPings.rows) {
    const dist = haversineKm(ping.latitude, ping.longitude, run.location_lat, run.location_lng);
    if (dist <= 0.1524) {
      // Upsert so this also creates a participant row for walk-ins not on the RSVP list.
      await pool.query(
        `INSERT INTO run_participants (run_id, user_id, status, is_present)
         VALUES ($1, $2, 'joined', true)
         ON CONFLICT (run_id, user_id) DO UPDATE
           SET is_present = true
           WHERE run_participants.status != 'cancelled'`,
        [runId, ping.user_id]
      );
    }
  }
  return getRunById(runId);
}

/**
 * Stages (chain multi-sport): each participant manually advances through the
 * configured stages. start/end-stage write into run_participants.stage_splits
 * which is a JSONB array of:
 *   { stageIdx, activityType, startedAt, finishedAt?, distance?, pace? }
 * Indexed by stageIdx. start replaces existing entry if any (idempotent
 * "I started stage 1 again" UX). end fills finishedAt + stats; throws if
 * no startedAt yet for that stage.
 */
export async function startParticipantStage(
  runId: string, userId: string, stageIdx: number, activityType: string
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock + read existing stage_splits
    const cur = await client.query(
      `SELECT stage_splits FROM run_participants WHERE run_id = $1 AND user_id = $2 FOR UPDATE`,
      [runId, userId]
    );
    if (!cur.rows.length) throw new Error("PARTICIPANT_NOT_FOUND");
    const splits: any[] = Array.isArray(cur.rows[0].stage_splits) ? cur.rows[0].stage_splits : [];
    const existing = splits.findIndex((s: any) => s?.stageIdx === stageIdx);
    const entry = {
      stageIdx,
      activityType,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      distance: null,
      pace: null,
    };
    if (existing >= 0) splits[existing] = entry;
    else splits.push(entry);
    await client.query(
      `UPDATE run_participants SET stage_splits = $3 WHERE run_id = $1 AND user_id = $2`,
      [runId, userId, JSON.stringify(splits)]
    );
    await client.query("COMMIT");
    return splits;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function endParticipantStage(
  runId: string, userId: string, stageIdx: number, distance: number, pace: number
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(
      `SELECT stage_splits FROM run_participants WHERE run_id = $1 AND user_id = $2 FOR UPDATE`,
      [runId, userId]
    );
    if (!cur.rows.length) throw new Error("PARTICIPANT_NOT_FOUND");
    const splits: any[] = Array.isArray(cur.rows[0].stage_splits) ? cur.rows[0].stage_splits : [];
    const idx = splits.findIndex((s: any) => s?.stageIdx === stageIdx);
    if (idx < 0) throw new Error("STAGE_NOT_STARTED");
    splits[idx] = {
      ...splits[idx],
      finishedAt: new Date().toISOString(),
      distance: distance || 0,
      pace: pace || 0,
    };
    await client.query(
      `UPDATE run_participants SET stage_splits = $3 WHERE run_id = $1 AND user_id = $2`,
      [runId, userId, JSON.stringify(splits)]
    );
    await client.query("COMMIT");
    return splits;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function pingRunLocation(
  runId: string, userId: string,
  latitude: number, longitude: number,
  cumulativeDistance: number, pace: number
) {
  await pool.query(
    `INSERT INTO run_tracking_points (run_id, user_id, latitude, longitude, cumulative_distance, pace)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [runId, userId, latitude, longitude, cumulativeDistance, pace]
  );

  const runRes = await pool.query(`SELECT host_id, location_lat, location_lng, is_active, started_at FROM runs WHERE id = $1`, [runId]);
  if (!runRes.rows.length) return { isPresent: false, isActive: false };
  const run = runRes.rows[0];

  // Ensure the host has a participant row so they appear in live state and results
  if (userId === run.host_id) {
    await pool.query(
      `INSERT INTO run_participants (run_id, user_id, status, is_present)
       SELECT $1, $2, 'joined', true
       WHERE NOT EXISTS (SELECT 1 FROM run_participants WHERE run_id = $1 AND user_id = $2)`,
      [runId, userId]
    );
  }

  let isPresent = false;
  if (run.is_active) {
    const distKm = haversineKm(latitude, longitude, run.location_lat, run.location_lng);
    const within500ft = distKm <= 0.1524;
    const isHost = userId === run.host_id;

    // 2-minute grace window: if the run started recently, mark any RSVP'd participant
    // present on their first ping regardless of proximity — covers "late tappers" who open
    // the app moments after start but are still walking to the start line.
    const startedAt = run.started_at ? new Date(run.started_at).getTime() : 0;
    const withinGraceWindow = startedAt > 0 && (Date.now() - startedAt) < 2 * 60 * 1000;

    if (within500ft || isHost) {
      // Proximity / host: upsert regardless (handles walkins too).
      const upsertRes = await pool.query(
        `INSERT INTO run_participants (run_id, user_id, status, is_present)
         VALUES ($1, $2, 'joined', true)
         ON CONFLICT (run_id, user_id) DO UPDATE SET is_present = true
         WHERE run_participants.status != 'cancelled'
         RETURNING run_id`,
        [runId, userId]
      );
      isPresent = (upsertRes.rowCount ?? 0) > 0;
    } else if (withinGraceWindow) {
      // Grace window: only mark present if the user was already RSVP'd — don't create
      // new participant rows for non-RSVP'd users.
      const graceRes = await pool.query(
        `UPDATE run_participants SET is_present = true
         WHERE run_id = $1 AND user_id = $2 AND status != 'cancelled'
         RETURNING run_id`,
        [runId, userId]
      );
      isPresent = (graceRes.rowCount ?? 0) > 0;
    } else {
      const presRes = await pool.query(
        `SELECT is_present FROM run_participants WHERE run_id = $1 AND user_id = $2 AND status != 'cancelled'`,
        [runId, userId]
      );
      isPresent = presRes.rows[0]?.is_present ?? false;
    }
  }
  return { isPresent, isActive: run.is_active };
}

// In-memory cache for getLiveRunState. The /api/runs/:id/live endpoint is
// polled by every active participant (every 5s) and every spectator on the
// home screen. For a 200-person event with 50 spectators that's ~50 reads/s
// hitting two big DB queries. Cache the result for 2.5s — clients still see
// fresh-feeling data (their own polling is 5s) and DB load drops by ~10×.
//
// Single-process cache is fine here: Railway runs one Node container, and
// invalidation isn't critical because the TTL is short. If we ever scale
// horizontally, replace with Redis SETEX.
const _liveStateCache = new Map<string, { ts: number; data: any }>();
const LIVE_STATE_TTL_MS = 2500;

// Periodic GC so the cache doesn't grow unbounded. Runs at most once a minute
// regardless of how many runs are active.
let _liveStateLastGc = 0;
function _gcLiveStateCache() {
  const now = Date.now();
  if (now - _liveStateLastGc < 60_000) return;
  _liveStateLastGc = now;
  for (const [k, v] of _liveStateCache.entries()) {
    if (now - v.ts > LIVE_STATE_TTL_MS * 4) _liveStateCache.delete(k);
  }
}

/** Public hook for routes that mutate run state (ping, end, decline-host)
 * to drop the cached entry so the very next read sees the new value. */
export function invalidateLiveRunStateCache(runId: string) {
  _liveStateCache.delete(runId);
}

export async function getLiveRunState(runId: string) {
  _gcLiveStateCache();
  const cached = _liveStateCache.get(runId);
  if (cached && Date.now() - cached.ts < LIVE_STATE_TTL_MS) {
    return cached.data;
  }
  const fresh = await _computeLiveRunState(runId);
  _liveStateCache.set(runId, { ts: Date.now(), data: fresh });
  return fresh;
}

async function _computeLiveRunState(runId: string) {
  const runRes = await pool.query(`SELECT * FROM runs WHERE id = $1`, [runId]);
  if (!runRes.rows.length) return null;
  const run = runRes.rows[0];

  const participantsRes = await pool.query(
    `SELECT rp.user_id, u.name, u.photo_url, rp.is_present, rp.final_distance, rp.final_pace, rp.final_rank,
       rp.tag_along_of_user_id,
       tp.latitude, tp.longitude, tp.cumulative_distance, tp.pace as current_pace, tp.recorded_at
     FROM run_participants rp
     JOIN users u ON u.id = rp.user_id
     LEFT JOIN LATERAL (
       SELECT * FROM run_tracking_points
       WHERE run_id = $1 AND user_id = rp.user_id
       ORDER BY recorded_at DESC LIMIT 1
     ) tp ON true
     WHERE rp.run_id = $1 AND rp.status != 'cancelled'
     ORDER BY rp.joined_at ASC`,
    [runId]
  );

  const tagAlongRes = await pool.query(
    `SELECT tar.*, ru.name as requester_name, tu.name as target_name
     FROM tag_along_requests tar
     JOIN users ru ON ru.id = tar.requester_id
     JOIN users tu ON tu.id = tar.target_id
     WHERE tar.run_id = $1 AND tar.status IN ('pending', 'accepted')`,
    [runId]
  );

  const STALE_THRESHOLD_MS = 90 * 1000;
  const now = Date.now();
  const participants = participantsRes.rows.map((r: any) => {
    const isFinished = r.final_pace != null;
    const lastPingAge = r.recorded_at ? now - new Date(r.recorded_at).getTime() : null;
    // Stale only applies to runners still actively tracking (not yet finished)
    const isStale = r.is_present && !isFinished && lastPingAge != null && lastPingAge > STALE_THRESHOLD_MS;
    // For finished runners: override cumulative_distance with final_distance so clients
    // use authoritative totals; preserve lat/lng so the finished marker renders on map.
    const cumulative_distance = isFinished ? r.final_distance : r.cumulative_distance;
    return { ...r, cumulative_distance, isStale: !!isStale, isFinished };
  });

  const activeCount = participants.filter((r: any) => r.is_present && !r.isStale && r.final_pace == null).length;
  const staleCount = participants.filter((r: any) => r.isStale).length;
  const presentCount = participants.filter((r: any) => r.is_present).length;

  return {
    isActive: run.is_active,
    isCompleted: run.is_completed,
    startedAt: run.started_at,
    hostId: run.host_id,
    presentCount,
    activeCount,
    staleCount,
    participants,
    tagAlongRequests: tagAlongRes.rows,
  };
}

// ─── Tag-Along ────────────────────────────────────────────────────────────────

export async function createTagAlongRequest(runId: string, requesterId: string, targetId: string) {
  // Validate run exists and is a group run (not solo)
  const runRes = await pool.query(
    `SELECT privacy, is_active, is_completed, host_id FROM runs WHERE id = $1`,
    [runId]
  );
  if (!runRes.rows.length) throw new Error('Run not found');
  const run = runRes.rows[0];
  if (run.privacy === 'solo') throw new Error('Cannot tag along on a solo run');
  if (!run.is_active || run.is_completed) throw new Error('Tag-along requests can only be sent during an active run');
  if (run.host_id === requesterId) throw new Error('Host cannot tag along');

  // Validate requester is an active participant
  const reqParticipant = await pool.query(
    `SELECT 1 FROM run_participants WHERE run_id = $1 AND user_id = $2 AND status != 'cancelled'`,
    [runId, requesterId]
  );
  if (!reqParticipant.rows.length) throw new Error('You are not a participant in this run');

  // Validate target is an active participant (not host)
  const tgtParticipant = await pool.query(
    `SELECT 1 FROM run_participants WHERE run_id = $1 AND user_id = $2 AND status != 'cancelled'`,
    [runId, targetId]
  );
  if (!tgtParticipant.rows.length) throw new Error('Target is not a participant in this run');
  if (run.host_id === targetId) throw new Error('Cannot tag along with the host');

  // Neither requester nor target can already be in any accepted tag-along link for this run
  // (covers requester-as-requester, requester-as-target, target-as-requester, target-as-target)
  const acceptedCheck = await pool.query(
    `SELECT 1 FROM tag_along_requests
     WHERE run_id = $1 AND status = 'accepted'
       AND (requester_id = $2 OR target_id = $2 OR requester_id = $3 OR target_id = $3)`,
    [runId, requesterId, targetId]
  );
  if (acceptedCheck.rows.length) throw new Error('One of these participants is already in an accepted tag-along for this run');

  const existing = await pool.query(
    `SELECT id, status FROM tag_along_requests WHERE run_id = $1 AND requester_id = $2`,
    [runId, requesterId]
  );
  if (existing.rows.length > 0) {
    const ex = existing.rows[0];
    await pool.query(
      `UPDATE tag_along_requests SET target_id = $2, status = 'pending', created_at = NOW() WHERE id = $1`,
      [ex.id, targetId]
    );
    const res = await pool.query(`SELECT * FROM tag_along_requests WHERE id = $1`, [ex.id]);
    return res.rows[0];
  }
  const res = await pool.query(
    `INSERT INTO tag_along_requests (run_id, requester_id, target_id, status)
     VALUES ($1, $2, $3, 'pending') RETURNING *`,
    [runId, requesterId, targetId]
  );
  return res.rows[0];
}

export async function acceptTagAlongRequest(requestId: string, targetId: string, runId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Guard: run must still be active and not completed (no retroactive tag-along)
    const runCheck = await client.query(
      `SELECT is_active, is_completed FROM runs WHERE id = $1`,
      [runId]
    );
    if (!runCheck.rows.length || !runCheck.rows[0].is_active || runCheck.rows[0].is_completed) {
      await client.query('ROLLBACK');
      throw new Error('Tag-along can only be accepted during an active run');
    }

    // Validate the request belongs to the run and is pending for this target
    const reqRes = await client.query(
      `SELECT * FROM tag_along_requests WHERE id = $1 AND target_id = $2 AND run_id = $3 AND status = 'pending'`,
      [requestId, targetId, runId]
    );
    if (!reqRes.rows.length) {
      await client.query('ROLLBACK');
      return null;
    }
    const req = reqRes.rows[0];

    // Enforce single-link invariant: neither target nor requester may be in any accepted link for this run
    // (either as requester OR as target — prevents A→B and C→A multi-hop chains)
    const existingAccepted = await client.query(
      `SELECT 1 FROM tag_along_requests
       WHERE run_id = $1 AND status = 'accepted'
         AND (requester_id = $2 OR target_id = $2 OR requester_id = $3 OR target_id = $3)`,
      [runId, targetId, req.requester_id]
    );
    if (existingAccepted.rows.length) {
      await client.query('ROLLBACK');
      throw new Error('One of these participants is already in an accepted tag-along for this run');
    }

    const updated = await client.query(
      `UPDATE tag_along_requests SET status = 'accepted' WHERE id = $1 RETURNING *`,
      [requestId]
    );
    await client.query(
      `UPDATE run_participants SET tag_along_of_user_id = $3 WHERE run_id = $1 AND user_id = $2`,
      [runId, req.requester_id, targetId]
    );
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function declineTagAlongRequest(requestId: string, targetId: string, runId: string) {
  const res = await pool.query(
    `UPDATE tag_along_requests SET status = 'declined'
     WHERE id = $1 AND target_id = $2 AND run_id = $3 AND status = 'pending' RETURNING *`,
    [requestId, targetId, runId]
  );
  return res.rows.length > 0 ? res.rows[0] : null;
}

export async function cancelTagAlongRequest(requestId: string, requesterId: string, runId: string) {
  const res = await pool.query(
    `UPDATE tag_along_requests SET status = 'declined'
     WHERE id = $1 AND requester_id = $2 AND run_id = $3 AND status = 'pending' RETURNING *`,
    [requestId, requesterId, runId]
  );
  return res.rows.length > 0 ? res.rows[0] : null;
}

export async function finalizeTagAlongsForRun(runId: string): Promise<void> {
  // Find all accepted tag-along requests for this run
  const tagRes = await pool.query(
    `SELECT requester_id, target_id FROM tag_along_requests WHERE run_id = $1 AND status = 'accepted'`,
    [runId]
  );
  for (const row of tagRes.rows) {
    try {
      await createSoloRunForTagAlong(runId, row.requester_id, row.target_id);
    } catch (e: any) {
      console.error('[tag-along] finalizeTagAlongsForRun error for', row.requester_id, e?.message);
    }
  }
}

function haversineDistMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function createSoloRunForTagAlong(runId: string, tagAlongUserId: string, acceptorUserId: string): Promise<boolean> {
  const runRes = await pool.query(`SELECT * FROM runs WHERE id = $1`, [runId]);
  if (!runRes.rows.length) return false;
  const run = runRes.rows[0];

  // Idempotency: stable key — one tag-along solo run per (user, source_run_id)
  const existingCheck = await pool.query(
    `SELECT 1 FROM solo_runs WHERE user_id = $1 AND tag_along_source_run_id = $2 LIMIT 1`,
    [tagAlongUserId, runId]
  );
  if (existingCheck.rows.length > 0) return false;

  // Fetch route points from acceptor (used for both distance fallback and route path)
  const routeRes = await pool.query(
    `SELECT latitude, longitude, recorded_at FROM run_tracking_points
     WHERE run_id = $1 AND user_id = $2 ORDER BY recorded_at ASC`,
    [runId, acceptorUserId]
  );
  const pts = routeRes.rows;

  // Prefer formally-submitted final_distance / final_pace; fall back to GPS-derived values
  const partRes = await pool.query(
    `SELECT final_distance, final_pace FROM run_participants WHERE run_id = $1 AND user_id = $2`,
    [runId, acceptorUserId]
  );
  let finalDist: number | null = partRes.rows[0]?.final_distance ?? null;
  let finalPace: number | null = partRes.rows[0]?.final_pace ?? null;

  // GPS-derived fallback: compute from tracking points when formal finish data is absent
  if ((!finalDist || finalDist <= 0) && pts.length >= 2) {
    let gpsDist = 0;
    for (let i = 1; i < pts.length; i++) {
      gpsDist += haversineDistMi(
        parseFloat(pts[i - 1].latitude), parseFloat(pts[i - 1].longitude),
        parseFloat(pts[i].latitude), parseFloat(pts[i].longitude)
      );
    }
    if (gpsDist > 0.01) {
      finalDist = gpsDist;
      const firstTs = new Date(pts[0].recorded_at).getTime();
      const lastTs = new Date(pts[pts.length - 1].recorded_at).getTime();
      const elapsedMin = (lastTs - firstTs) / 60000;
      finalPace = elapsedMin > 0 && gpsDist > 0 ? elapsedMin / gpsDist : null;
    }
  }

  if (!finalDist || finalDist <= 0) return false;

  const routePath = pts.length > 0
    ? JSON.stringify(pts.map((r: any) => ({ latitude: r.latitude, longitude: r.longitude })))
    : null;

  const duration = finalPace && finalPace > 0 && finalDist > 0
    ? Math.round(finalPace * 60 * finalDist)
    : null;

  const actType = run.activity_type || 'run';
  const label = actType === 'ride' ? 'Ride' : actType === 'walk' ? 'Walk' : 'Run';
  const title = `${run.title} (Tag-Along ${label})`;

  await pool.query(
    `INSERT INTO solo_runs (user_id, title, date, distance_miles, pace_min_per_mile, duration_seconds, completed, route_path, activity_type, tag_along_source_run_id)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7::jsonb, $8, $9)`,
    [tagAlongUserId, title, run.date, finalDist, finalPace, duration, routePath, actType, runId]
  );
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────

export async function finishRunnerRun(runId: string, userId: string, finalDistance: number, finalPace: number, mileSplits?: any[] | null, isDnf?: boolean) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert participant, preserving any pre-existing status (e.g., 'joined'); only set 'joined' for new rows
    await client.query(
      `INSERT INTO run_participants (run_id, user_id, status, is_present)
       VALUES ($1, $2, 'joined', true)
       ON CONFLICT (run_id, user_id) DO UPDATE SET is_present = true`,
      [runId, userId]
    );

    // DNF: distance <0.1 mi with no pings — mark status as 'dnf', store sentinel values (0,0)
    // so the runner is counted as "finished" (final_pace NOT NULL) but excluded from leaderboard
    // rankings and final_rank (computeLeaderboardRanks filters final_pace > 0)
    if (isDnf) {
      await client.query(
        `UPDATE run_participants SET final_distance = 0, final_pace = 0, mile_splits = NULL, status = 'dnf', final_rank = NULL WHERE run_id = $1 AND user_id = $2`,
        [runId, userId]
      );
    } else {
      // T1.3 + T2.16: credit user stats and set miles_logged the first time the
      // participant finishes. Idempotent — second finish just refreshes
      // distance/pace/splits without double-counting (miles_logged IS NOT NULL guard).
      const priorRes = await client.query(
        `SELECT miles_logged FROM run_participants WHERE run_id = $1 AND user_id = $2`,
        [runId, userId]
      );
      const alreadyCredited = priorRes.rows[0]?.miles_logged != null;

      await client.query(
        `UPDATE run_participants
            SET final_distance = $3,
                final_pace = $4,
                mile_splits = $5,
                miles_logged = COALESCE(miles_logged, $3)
         WHERE run_id = $1 AND user_id = $2`,
        [runId, userId, finalDistance, finalPace, mileSplits && mileSplits.length > 0 ? JSON.stringify(mileSplits) : null]
      );

      if (!alreadyCredited && finalDistance > 0) {
        const userResult = await client.query(
          `UPDATE users SET
             completed_runs   = completed_runs   + 1,
             total_miles      = total_miles      + $2,
             miles_this_year  = miles_this_year  + $2,
             miles_this_month = miles_this_month + $2
           WHERE id = $1 RETURNING total_miles`,
          [userId, finalDistance]
        );
        const totalMiles = userResult.rows[0]?.total_miles;

        // T1.4: same-transaction achievement check (covers distance + count milestones).
        // Pace PRs surface via the bell-feed query which now includes
        // run_participants final_pace too — see getNotifications.
        if (totalMiles !== undefined) {
          await checkAndAwardAchievements(userId, totalMiles, client);
        }

        // Bump host_count exactly once per run on the host's first credited finisher
        const runRes = await client.query(`SELECT host_id FROM runs WHERE id = $1`, [runId]);
        const hostId = runRes.rows[0]?.host_id;
        if (hostId && userId !== hostId) {
          const confirmedNonHost = await client.query(
            `SELECT COUNT(*) as cnt FROM run_participants
             WHERE run_id = $1 AND miles_logged IS NOT NULL AND user_id != $2`,
            [runId, hostId]
          );
          if (parseInt(confirmedNonHost.rows[0]?.cnt) === 1) {
            await client.query(`UPDATE users SET hosted_runs = hosted_runs + 1 WHERE id = $1`, [hostId]);
          }
        }
      }
    }

    const runRes = await client.query(`SELECT host_id FROM runs WHERE id = $1`, [runId]);
    let shouldComplete = false;
    if (runRes.rows.length) {
      // Run auto-completes when ALL is_present participants have finished (host no longer
      // immediately ends the run — they stay on the live screen and can "End for Everyone")
      const remaining = await client.query(
        `SELECT COUNT(*) FROM run_participants
         WHERE run_id = $1 AND is_present = true AND final_pace IS NULL AND status != 'cancelled'`,
        [runId]
      );
      shouldComplete = parseInt(remaining.rows[0].count) === 0;
      if (shouldComplete) {
        await client.query(
          `UPDATE runs SET is_completed = true, is_active = false WHERE id = $1`,
          [runId]
        );
        await computeLeaderboardRanksWithClient(runId, client);
        await client.query(
          `DELETE FROM planned_runs WHERE run_id = $1`,
          [runId]
        );
      }
    }

    await client.query('COMMIT');

    // Fire-and-forget: create solo runs for tag-along participants
    if (shouldComplete) {
      // Run completed — handle ALL accepted tag-alongs (covers acceptors who never called finish)
      finalizeTagAlongsForRun(runId).catch((e: any) =>
        console.error('[tag-along] finalizeTagAlongsForRun error', e?.message)
      );
    } else if (finalDistance > 0 && finalPace > 0) {
      // Acceptor finished early — create solo runs for their tag-along requesters now
      // finalizeTagAlongsForRun will cover any missed ones when the run completes
      pool.query(
        `SELECT requester_id FROM tag_along_requests
         WHERE run_id = $1 AND target_id = $2 AND status = 'accepted'`,
        [runId, userId]
      ).then(async (tagRes: any) => {
        for (const row of tagRes.rows) {
          try {
            await createSoloRunForTagAlong(runId, row.requester_id, userId);
          } catch (e: any) {
            console.error('[tag-along] Failed to create solo run for', row.requester_id, e?.message);
          }
        }
      }).catch((e: any) => console.error('[tag-along] query error', e?.message));
    }

    return { success: true, shouldComplete };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function computeLeaderboardRanksWithClient(runId: string, db: any) {
  const runInfoRes = await db.query(`SELECT crew_id FROM runs WHERE id = $1`, [runId]);
  const isCrewRun = runInfoRes.rows.length > 0 && !!runInfoRes.rows[0].crew_id;

  if (isCrewRun) {
    const groupsRes = await db.query(
      `SELECT DISTINCT pace_group_label FROM run_participants
       WHERE run_id = $1 AND final_pace IS NOT NULL AND final_pace > 0
         AND (abandoned IS NULL OR abandoned = false)`,
      [runId]
    );
    for (const groupRow of groupsRes.rows) {
      const label = groupRow.pace_group_label;
      // T2.12: tied paces should share a rank. Use RANK() window — two runners
      // at exactly 7:30 /mi both get rank 1; the next rank is 3.
      await db.query(
        `WITH ranked AS (
           SELECT user_id, RANK() OVER (ORDER BY final_pace ASC) AS rk
           FROM run_participants
           WHERE run_id = $1 AND final_pace IS NOT NULL AND final_pace > 0
             AND (abandoned IS NULL OR abandoned = false)
             AND (pace_group_label = $2 OR ($2::text IS NULL AND pace_group_label IS NULL))
         )
         UPDATE run_participants rp
         SET final_rank = ranked.rk
         FROM ranked
         WHERE rp.run_id = $1 AND rp.user_id = ranked.user_id`,
        [runId, label]
      );
    }
  } else {
    await db.query(
      `WITH ranked AS (
         SELECT user_id, RANK() OVER (ORDER BY final_pace ASC) AS rk
         FROM run_participants
         WHERE run_id = $1 AND final_pace IS NOT NULL AND final_pace > 0
           AND (abandoned IS NULL OR abandoned = false)
       )
       UPDATE run_participants rp
       SET final_rank = ranked.rk
       FROM ranked
       WHERE rp.run_id = $1 AND rp.user_id = ranked.user_id`,
      [runId]
    );
  }
}

export async function computeLeaderboardRanks(runId: string) {
  await computeLeaderboardRanksWithClient(runId, pool);
}

export async function forceCompleteRun(runId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Final reconciliation: any RSVP'd participant who slipped through the start-snapshot
    // (e.g. joined moments before start, force-complete called very quickly) but has actual
    // GPS data recorded between started_at and now gets marked present so they appear in results.
    await client.query(
      `UPDATE run_participants rp
       SET is_present = true
       FROM runs r
       WHERE rp.run_id = $1
         AND r.id = $1
         AND rp.status IN ('joined', 'confirmed')
         AND rp.is_present = false
         AND EXISTS (
           SELECT 1 FROM run_tracking_points tp
           WHERE tp.run_id = $1
             AND tp.user_id = rp.user_id
             AND tp.recorded_at >= COALESCE(r.started_at, NOW() - INTERVAL '2 hours')
             AND tp.recorded_at <= NOW()
         )`,
      [runId]
    );

    // Finalize stats for any is_present participants who haven't finished yet.
    // We derive their final_distance and final_pace from their latest tracking point.
    const unfinished = await client.query(
      `SELECT rp.user_id
       FROM run_participants rp
       WHERE rp.run_id = $1 AND rp.is_present = true
         AND rp.final_pace IS NULL AND rp.status != 'cancelled'`,
      [runId]
    );
    for (const row of unfinished.rows) {
      // Get latest tracking point for distance, and latest non-zero pace as fallback
      const tpRes = await client.query(
        `SELECT cumulative_distance,
                COALESCE(
                  (SELECT pace FROM run_tracking_points
                   WHERE run_id = $1 AND user_id = $2 AND pace > 0
                   ORDER BY recorded_at DESC LIMIT 1),
                  pace
                ) AS pace
         FROM run_tracking_points
         WHERE run_id = $1 AND user_id = $2
         ORDER BY recorded_at DESC LIMIT 1`,
        [runId, row.user_id]
      );
      if (tpRes.rows.length > 0) {
        const safeDist = parseFloat(tpRes.rows[0].cumulative_distance) || 0;
        const safePace = parseFloat(tpRes.rows[0].pace) || 0;
        if (safeDist > 0) {
          // Idempotent stats credit — same pattern as finishRunnerRun. Without
          // this, participants finalized by host-end (or the late-start
          // monitor sweep) get their leaderboard rank set but no profile
          // total_miles bump. T1.3 finishRunnerRun added the credit; this
          // closes the symmetric gap.
          const priorRes = await client.query(
            `SELECT miles_logged FROM run_participants WHERE run_id = $1 AND user_id = $2`,
            [runId, row.user_id]
          );
          const alreadyCredited = priorRes.rows[0]?.miles_logged != null;
          await client.query(
            `UPDATE run_participants
                SET final_distance = $3,
                    final_pace = $4,
                    status = 'confirmed',
                    miles_logged = COALESCE(miles_logged, $3)
             WHERE run_id = $1 AND user_id = $2`,
            [runId, row.user_id, safeDist, safePace]
          );
          if (!alreadyCredited) {
            const userResult = await client.query(
              `UPDATE users SET
                 completed_runs   = completed_runs   + 1,
                 total_miles      = total_miles      + $2,
                 miles_this_year  = miles_this_year  + $2,
                 miles_this_month = miles_this_month + $2
               WHERE id = $1 RETURNING total_miles`,
              [row.user_id, safeDist]
            );
            const totalMiles = userResult.rows[0]?.total_miles;
            if (totalMiles !== undefined) {
              await checkAndAwardAchievements(row.user_id, totalMiles, client);
            }
          }
        } else {
          // Present but no tracking data — mark confirmed so they show "Done"
          await client.query(
            `UPDATE run_participants SET status = 'confirmed'
             WHERE run_id = $1 AND user_id = $2`,
            [runId, row.user_id]
          );
        }
      } else {
        // No tracking points at all — still present, mark confirmed
        await client.query(
          `UPDATE run_participants SET status = 'confirmed'
           WHERE run_id = $1 AND user_id = $2`,
          [runId, row.user_id]
        );
      }
    }

    await client.query(
      `UPDATE runs SET is_completed = true, is_active = false WHERE id = $1`,
      [runId]
    );
    await computeLeaderboardRanksWithClient(runId, client);
    await client.query(
      `DELETE FROM planned_runs WHERE run_id = $1`,
      [runId]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function getRunResults(runId: string) {
  const result = await pool.query(
    `SELECT rp.user_id, u.name, u.photo_url, rp.final_distance, rp.final_pace, rp.final_rank, rp.is_present, rp.pace_group_label, rp.stage_splits
     FROM run_participants rp
     JOIN users u ON u.id = rp.user_id
     WHERE rp.run_id = $1
       AND rp.status != 'cancelled'
       AND (rp.abandoned IS NULL OR rp.abandoned = false)
       AND (rp.is_present = true OR rp.final_distance IS NOT NULL)
     ORDER BY rp.pace_group_label ASC NULLS LAST, rp.final_rank ASC NULLS LAST, rp.joined_at ASC`,
    [runId]
  );
  return result.rows;
}

export async function getHostRoutePath(runId: string): Promise<{ latitude: number; longitude: number }[]> {
  const runRes = await pool.query(`SELECT host_id FROM runs WHERE id = $1`, [runId]);
  if (!runRes.rows.length) return [];
  const hostId = runRes.rows[0].host_id;
  const result = await pool.query(
    `SELECT latitude, longitude FROM run_tracking_points
     WHERE run_id = $1 AND user_id = $2
     ORDER BY recorded_at ASC`,
    [runId, hostId]
  );
  return result.rows;
}

export async function checkHostUnlock(userId: string, db: any = pool) {
  const result = await db.query(
    `SELECT COUNT(DISTINCT r.host_id) as unique_hosts, COUNT(*) as total_runs
     FROM run_participants rp
     JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.host_id != $1`,
    [userId]
  );
  const { unique_hosts, total_runs } = result.rows[0];
  if (parseInt(total_runs) >= 3 && parseInt(unique_hosts) >= 2) {
    await db.query(
      `UPDATE users SET host_unlocked = true, role = 'host' WHERE id = $1`,
      [userId]
    );
    return true;
  }
  return false;
}

export async function getHostUnlockProgress(userId: string) {
  const result = await pool.query(
    `SELECT COUNT(DISTINCT r.host_id) as unique_hosts, COUNT(*) as total_runs
     FROM run_participants rp
     JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.host_id != $1`,
    [userId]
  );
  return { unique_hosts: parseInt(result.rows[0].unique_hosts), total_runs: parseInt(result.rows[0].total_runs) };
}

async function awardSlug(userId: string, slug: string, db: any = pool): Promise<boolean> {
  const res = await db.query(
    `INSERT INTO achievements (user_id, milestone, slug) VALUES ($1, 0, $2) ON CONFLICT (user_id, slug) DO NOTHING RETURNING id`,
    [userId, slug]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function postMilestoneToAllCrews(userId: string, milestoneMessage: string): Promise<void> {
  try {
    const userRes = await pool.query(`SELECT name, photo_url FROM users WHERE id = $1`, [userId]);
    const user = userRes.rows[0];
    if (!user) return;
    const crewsRes = await pool.query(
      `SELECT crew_id FROM crew_members WHERE user_id = $1 AND status = 'member'`,
      [userId]
    );
    for (const row of crewsRes.rows) {
      await pool.query(
        `INSERT INTO crew_messages (crew_id, user_id, sender_name, sender_photo, message, message_type)
         VALUES ($1, $2, $3, $4, $5, 'milestone')`,
        [row.crew_id, userId, user.name, user.photo_url, milestoneMessage]
      );
    }
  } catch (_) {}
}

export async function checkSoloRunPRs(
  userId: string,
  newRunId: string,
  distanceMiles: number | null,
  paceMinPerMile: number | null
): Promise<string[]> {
  const messages: string[] = [];
  const userRes = await pool.query(`SELECT name FROM users WHERE id = $1`, [userId]);
  const userName = userRes.rows[0]?.name ?? 'Someone';
  if (distanceMiles && distanceMiles > 0) {
    const prevBest = await pool.query(
      `SELECT COALESCE(MAX(distance_miles), 0) as best FROM solo_runs
       WHERE user_id = $1 AND completed = true AND distance_miles IS NOT NULL AND id != $2`,
      [userId, newRunId]
    );
    const bestDist = parseFloat(prevBest.rows[0]?.best ?? 0);
    if (bestDist > 0 && distanceMiles > bestDist) {
      const rounded = Math.round(distanceMiles * 100) / 100;
      messages.push(`🎉 ${userName} just ran their longest distance ever — ${rounded} miles!`);
    }
  }
  if (paceMinPerMile && paceMinPerMile > 0) {
    const prevBest = await pool.query(
      `SELECT COALESCE(MIN(pace_min_per_mile), 999) as best FROM solo_runs
       WHERE user_id = $1 AND completed = true AND pace_min_per_mile IS NOT NULL AND id != $2`,
      [userId, newRunId]
    );
    const bestPace = parseFloat(prevBest.rows[0]?.best ?? 999);
    if (bestPace < 900 && paceMinPerMile < bestPace) {
      let mins = Math.floor(paceMinPerMile);
      let secsNum = Math.round((paceMinPerMile - mins) * 60);
      if (secsNum === 60) { secsNum = 0; mins += 1; }
      const secs = secsNum.toString().padStart(2, '0');
      messages.push(`⚡ ${userName} just set a new pace PR — ${mins}:${secs} /mi!`);
    }
  }
  return messages;
}

export async function toggleCrewChatMute(crewId: string, userId: string): Promise<boolean> {
  const current = await pool.query(
    `SELECT chat_muted FROM crew_members WHERE crew_id = $1 AND user_id = $2`,
    [crewId, userId]
  );
  if (!current.rows.length) throw new Error("Not a crew member");
  const newMuted = !current.rows[0].chat_muted;
  await pool.query(
    `UPDATE crew_members SET chat_muted = $3 WHERE crew_id = $1 AND user_id = $2`,
    [crewId, userId, newMuted]
  );
  return newMuted;
}

export async function checkAndAwardAchievements(userId: string, totalMiles: number, db: any = pool) {
  const user = await db.query(`SELECT hosted_runs FROM users WHERE id = $1`, [userId]);
  const { hosted_runs } = user.rows[0] ?? {};

  // Count run-only completions to guard run-labeled badges from rides/walks
  const runOnlyRes = await db.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp
     JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'run'`,
    [userId]
  );
  const run_only_count = parseInt(runOnlyRes.rows[0]?.cnt ?? 0);

  // Count run-only hosted events
  const hostedRunOnlyRes = await db.query(
    `SELECT COUNT(*) as cnt FROM runs WHERE host_id = $1 AND activity_type = 'run'`,
    [userId]
  );
  const hosted_runs_only = parseInt(hostedRunOnlyRes.rows[0]?.cnt ?? 0);

  if (totalMiles >= 25) await awardSlug(userId, "miles_25", db);
  if (totalMiles >= 100) {
    await awardSlug(userId, "miles_100", db);
  }
  if (totalMiles >= 250) {
    await awardSlug(userId, "miles_250", db);
  }
  if (run_only_count >= 1) await awardSlug(userId, "first_step", db);
  if (run_only_count >= 5) await awardSlug(userId, "five_alive", db);
  if (run_only_count >= 10) await awardSlug(userId, "ten_toes_down", db);
  if (hosted_runs_only >= 1) await awardSlug(userId, "host_in_making", db);
  if (hosted_runs_only >= 5) await awardSlug(userId, "crew_builder", db);

  const maxSingleRun = await db.query(
    `SELECT COALESCE(MAX(rp.miles_logged), 0) as max FROM run_participants rp
     JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND rp.miles_logged > 0 AND r.activity_type = 'run'`,
    [userId]
  );
  const maxMiles = parseFloat(maxSingleRun.rows[0]?.max ?? 0);
  if (maxMiles >= 13.1) await awardSlug(userId, "half_marathon", db);
  if (maxMiles >= 26.2) await awardSlug(userId, "marathoner", db);

  const publicJoined = await db.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.privacy = 'public' AND r.host_id != $1`,
    [userId]
  );
  if (parseInt(publicJoined.rows[0]?.cnt) >= 1) await awardSlug(userId, "social_starter", db);

  const squadRuns = await db.query(
    `SELECT COUNT(DISTINCT rp.run_id) as cnt FROM run_participants rp WHERE rp.user_id = $1 AND rp.status = 'confirmed'
     AND (SELECT COUNT(*) FROM run_participants rp2 WHERE rp2.run_id = rp.run_id AND rp2.status != 'cancelled') >= 3`,
    [userId]
  );
  if (parseInt(squadRuns.rows[0]?.cnt) >= 1) await awardSlug(userId, "squad_runner", db);

  const monthlyMax = await db.query(
    `SELECT COALESCE(MAX(cnt), 0) as max FROM (
       SELECT DATE_TRUNC('month', r.date) as m, COUNT(*) as cnt
       FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed'
       GROUP BY m
     ) sub`,
    [userId]
  );
  if (parseInt(monthlyMax.rows[0]?.max) >= 8) await awardSlug(userId, "monthly_grinder", db);

  const streakResult = await db.query(
    `WITH dates AS (
       SELECT DISTINCT DATE_TRUNC('day', r.date)::date AS d
       FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed'
       ORDER BY d
     ), gaps AS (
       SELECT d, d - LAG(d) OVER (ORDER BY d) AS gap FROM dates
     ), groups AS (
       SELECT d, SUM(CASE WHEN gap IS NULL OR gap != 1 THEN 1 ELSE 0 END) OVER (ORDER BY d) AS grp FROM gaps
     )
     SELECT COALESCE(MAX(cnt), 0) AS max FROM (SELECT grp, COUNT(*) AS cnt FROM groups GROUP BY grp) sub`,
    [userId]
  );
  if (parseInt(streakResult.rows[0]?.max) >= 3) await awardSlug(userId, "streak_week", db);

  const nightRuns = await db.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND EXTRACT(HOUR FROM r.date AT TIME ZONE 'UTC') >= 20`,
    [userId]
  );
  if (parseInt(nightRuns.rows[0]?.cnt) >= 5) await awardSlug(userId, "night_owl", db);

  const morningRuns = await db.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND EXTRACT(HOUR FROM r.date AT TIME ZONE 'UTC') < 7`,
    [userId]
  );
  if (parseInt(morningRuns.rows[0]?.cnt) >= 10) await awardSlug(userId, "morning_warrior", db);

  const communityLeader = await db.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE r.host_id = $1 AND rp.user_id != $1 AND rp.status = 'confirmed'`,
    [userId]
  );
  if (parseInt(communityLeader.rows[0]?.cnt) >= 20) await awardSlug(userId, "community_leader", db);

  const committedRes = await db.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status != 'cancelled' AND r.date < NOW()
       AND (rp.abandoned IS NULL OR rp.abandoned = false)`,
    [userId]
  );
  const committedCount = parseInt(committedRes.rows[0]?.cnt ?? 0);
  if (committedCount >= 5) {
    const presentRes = await db.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status != 'cancelled' AND rp.is_present = true AND r.date < NOW()
         AND (rp.abandoned IS NULL OR rp.abandoned = false)`,
      [userId]
    );
    const presentCount = parseInt(presentRes.rows[0]?.cnt ?? 0);
    const rate = (presentCount / committedCount) * 100;
    if (rate >= 50) await awardSlug(userId, "reliable_50", db);
    if (rate >= 65) await awardSlug(userId, "reliable_65", db);
    if (rate >= 80) await awardSlug(userId, "reliable_80", db);
    if (rate >= 90) await awardSlug(userId, "reliable_90", db);
  }
}

export async function checkFriendAchievements(userId: string) {
  const friends = await pool.query(
    `SELECT COUNT(*) as cnt FROM friends WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'`,
    [userId]
  );
  if (parseInt(friends.rows[0]?.cnt) >= 1) await awardSlug(userId, "connected");
}

export async function getUserAchievements(userId: string) {
  const result = await pool.query(
    `SELECT * FROM achievements WHERE user_id = $1 ORDER BY earned_at ASC`,
    [userId]
  );
  return result.rows;
}

export async function getAchievementStats(userId: string) {
  const user = await pool.query(
    `SELECT completed_runs, total_miles, hosted_runs, avg_pace FROM users WHERE id = $1`,
    [userId]
  );
  const u = user.rows[0] ?? {};

  const [
    friendsRes, publicJoinedRes, squadRunsRes, maxSingleRunRes,
    monthlyMaxRes, streakRes, nightRunsRes, morningRunsRes,
    communityLeaderRes, uniqueLocRes, twoWeekRes, comebackRes,
    // Ride-specific
    completedRidesRes, publicRidesJoinedRes, squadRidesRes, rideTotalMilesRes,
    rideMaxSingleRes, rideMonthlyMaxRes, rideStreakRes, nightRidesRes,
    morningRidesRes, rideCommunityRes, rideUniqueLocRes, rideTwoWeekRes,
    rideComebackRes, rideHostedRes,
  ] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) as cnt FROM friends WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.privacy = 'public' AND r.host_id != $1`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(DISTINCT rp.run_id) as cnt FROM run_participants rp
       WHERE rp.user_id = $1 AND rp.status = 'confirmed'
       AND (SELECT COUNT(*) FROM run_participants rp2 WHERE rp2.run_id = rp.run_id AND rp2.status != 'cancelled') >= 3`,
      [userId]
    ),
    pool.query(
      `SELECT COALESCE(MAX(miles_logged), 0) as max FROM run_participants WHERE user_id = $1 AND status = 'confirmed' AND miles_logged > 0`,
      [userId]
    ),
    pool.query(
      `SELECT COALESCE(MAX(cnt), 0) as max FROM (
         SELECT DATE_TRUNC('month', r.date) as m, COUNT(*) as cnt
         FROM run_participants rp JOIN runs r ON r.id = rp.run_id
         WHERE rp.user_id = $1 AND rp.status = 'confirmed'
         GROUP BY m
       ) sub`,
      [userId]
    ),
    pool.query(
      `WITH dates AS (
         SELECT DISTINCT DATE_TRUNC('day', r.date)::date AS d
         FROM run_participants rp JOIN runs r ON r.id = rp.run_id
         WHERE rp.user_id = $1 AND rp.status = 'confirmed'
         ORDER BY d
       ), gaps AS (
         SELECT d, d - LAG(d) OVER (ORDER BY d) AS gap FROM dates
       ), groups AS (
         SELECT d, SUM(CASE WHEN gap IS NULL OR gap != 1 THEN 1 ELSE 0 END) OVER (ORDER BY d) AS grp FROM gaps
       )
       SELECT COALESCE(MAX(cnt), 0) AS max FROM (SELECT grp, COUNT(*) AS cnt FROM groups GROUP BY grp) sub`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND EXTRACT(HOUR FROM r.date AT TIME ZONE 'UTC') >= 20`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND EXTRACT(HOUR FROM r.date AT TIME ZONE 'UTC') < 7`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE r.host_id = $1 AND rp.user_id != $1 AND rp.status = 'confirmed'`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(DISTINCT r.location_name) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed'`,
      [userId]
    ),
    pool.query(
      `WITH run_dates AS (
         SELECT r.date FROM run_participants rp JOIN runs r ON r.id = rp.run_id
         WHERE rp.user_id = $1 AND rp.status = 'confirmed'
         ORDER BY r.date
       )
       SELECT COALESCE(MAX(cnt), 0) AS max FROM (
         SELECT r1.date, COUNT(*) as cnt FROM run_dates r1
         JOIN run_dates r2 ON r2.date BETWEEN r1.date AND r1.date + INTERVAL '14 days'
         GROUP BY r1.date
       ) sub`,
      [userId]
    ),
    pool.query(
      `WITH run_dates AS (
         SELECT r.date FROM run_participants rp JOIN runs r ON r.id = rp.run_id
         WHERE rp.user_id = $1 AND rp.status = 'confirmed'
         ORDER BY r.date
       ), gaps AS (
         SELECT date, LAG(date) OVER (ORDER BY date) AS prev_date,
           date - LAG(date) OVER (ORDER BY date) AS gap FROM run_dates
       )
       SELECT COUNT(*) > 0 AS had_gap FROM gaps WHERE gap > INTERVAL '30 days'`,
      [userId]
    ),
    // ── Ride stats ──────────────────────────────────────────────────────────
    pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.privacy = 'public' AND r.host_id != $1 AND r.activity_type = 'ride'`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(DISTINCT rp.run_id) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
       AND (SELECT COUNT(*) FROM run_participants rp2 WHERE rp2.run_id = rp.run_id AND rp2.status != 'cancelled') >= 3`,
      [userId]
    ),
    pool.query(
      `SELECT COALESCE(SUM(rp.miles_logged), 0) as total FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND rp.miles_logged > 0 AND r.activity_type = 'ride'`,
      [userId]
    ),
    pool.query(
      `SELECT COALESCE(MAX(rp.miles_logged), 0) as max FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND rp.miles_logged > 0 AND r.activity_type = 'ride'`,
      [userId]
    ),
    pool.query(
      `SELECT COALESCE(MAX(cnt), 0) as max FROM (
         SELECT DATE_TRUNC('month', r.date) as m, COUNT(*) as cnt
         FROM run_participants rp JOIN runs r ON r.id = rp.run_id
         WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
         GROUP BY m
       ) sub`,
      [userId]
    ),
    pool.query(
      `WITH dates AS (
         SELECT DISTINCT DATE_TRUNC('day', r.date)::date AS d
         FROM run_participants rp JOIN runs r ON r.id = rp.run_id
         WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
         ORDER BY d
       ), gaps AS (
         SELECT d, d - LAG(d) OVER (ORDER BY d) AS gap FROM dates
       ), groups AS (
         SELECT d, SUM(CASE WHEN gap IS NULL OR gap != 1 THEN 1 ELSE 0 END) OVER (ORDER BY d) AS grp FROM gaps
       )
       SELECT COALESCE(MAX(cnt), 0) AS max FROM (SELECT grp, COUNT(*) AS cnt FROM groups GROUP BY grp) sub`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
       AND EXTRACT(HOUR FROM r.date AT TIME ZONE 'UTC') >= 20`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
       AND EXTRACT(HOUR FROM r.date AT TIME ZONE 'UTC') < 7`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE r.host_id = $1 AND rp.user_id != $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(DISTINCT r.location_name) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'`,
      [userId]
    ),
    pool.query(
      `WITH run_dates AS (
         SELECT r.date FROM run_participants rp JOIN runs r ON r.id = rp.run_id
         WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
         ORDER BY r.date
       )
       SELECT COALESCE(MAX(cnt), 0) AS max FROM (
         SELECT r1.date, COUNT(*) as cnt FROM run_dates r1
         JOIN run_dates r2 ON r2.date BETWEEN r1.date AND r1.date + INTERVAL '14 days'
         GROUP BY r1.date
       ) sub`,
      [userId]
    ),
    pool.query(
      `WITH run_dates AS (
         SELECT r.date FROM run_participants rp JOIN runs r ON r.id = rp.run_id
         WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
         ORDER BY r.date
       ), gaps AS (
         SELECT date, LAG(date) OVER (ORDER BY date) AS prev_date,
           date - LAG(date) OVER (ORDER BY date) AS gap FROM run_dates
       )
       SELECT COUNT(*) > 0 AS had_gap FROM gaps WHERE gap > INTERVAL '30 days'`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM runs WHERE host_id = $1 AND activity_type = 'ride'`,
      [userId]
    ),
  ]);

  const maxSingleMiles = parseFloat(maxSingleRunRes.rows[0]?.max ?? 0);

  const rideTotalMiles = parseFloat(rideTotalMilesRes.rows[0]?.total ?? 0);
  const rideMaxSingle = parseFloat(rideMaxSingleRes.rows[0]?.max ?? 0);

  const bestRidePaceRes = await pool.query(
    `SELECT COALESCE(MIN(rp.final_pace), 999) as best_pace FROM run_participants rp
     JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
     AND rp.final_pace IS NOT NULL AND rp.final_pace > 0`,
    [userId]
  );
  const bestRidePace = parseFloat(bestRidePaceRes.rows[0]?.best_pace ?? 999);
  // Convert min/mi pace to mph: mph = 60 / pace_min_per_mile
  const bestRideSpeedMph = bestRidePace < 999 ? 60 / bestRidePace : 0;

  const committedStatRes = await pool.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status != 'cancelled' AND r.date < NOW()
       AND (rp.abandoned IS NULL OR rp.abandoned = false)`,
    [userId]
  );
  const committedStatCount = parseInt(committedStatRes.rows[0]?.cnt ?? 0);
  let attendanceRatePct: number | null = null;
  if (committedStatCount >= 5) {
    const presentStatRes = await pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status != 'cancelled' AND rp.is_present = true AND r.date < NOW()
         AND (rp.abandoned IS NULL OR rp.abandoned = false)`,
      [userId]
    );
    const presentStatCount = parseInt(presentStatRes.rows[0]?.cnt ?? 0);
    attendanceRatePct = Math.round((presentStatCount / committedStatCount) * 100);
  }

  return {
    completed_runs: parseInt(u.completed_runs ?? 0),
    total_miles: parseFloat(u.total_miles ?? 0),
    hosted_runs: parseInt(u.hosted_runs ?? 0),
    avg_pace: parseFloat(u.avg_pace ?? 10),
    friends_count: parseInt(friendsRes.rows[0]?.cnt ?? 0),
    public_runs_joined: parseInt(publicJoinedRes.rows[0]?.cnt ?? 0),
    squad_runs_count: parseInt(squadRunsRes.rows[0]?.cnt ?? 0),
    max_single_run_miles: maxSingleMiles,
    max_single_run_miles_x10: Math.round(maxSingleMiles * 10),
    monthly_max_runs: parseInt(monthlyMaxRes.rows[0]?.max ?? 0),
    max_streak_days: parseInt(streakRes.rows[0]?.max ?? 0),
    night_runs_count: parseInt(nightRunsRes.rows[0]?.cnt ?? 0),
    morning_runs_count: parseInt(morningRunsRes.rows[0]?.cnt ?? 0),
    participants_hosted_total: parseInt(communityLeaderRes.rows[0]?.cnt ?? 0),
    unique_locations: parseInt(uniqueLocRes.rows[0]?.cnt ?? 0),
    max_runs_in_14_days: parseInt(twoWeekRes.rows[0]?.max ?? 0),
    had_comeback: comebackRes.rows[0]?.had_gap === true ? 1 : 0,
    has_sub7_pace: parseFloat(u.avg_pace ?? 10) < 7 ? 1 : 0,
    negative_split_count: 0,
    five_k_crusher_count: 0,
    pace_perfect_count: 0,
    // Ride stats
    completed_rides: parseInt(completedRidesRes.rows[0]?.cnt ?? 0),
    public_rides_joined: parseInt(publicRidesJoinedRes.rows[0]?.cnt ?? 0),
    squad_rides_count: parseInt(squadRidesRes.rows[0]?.cnt ?? 0),
    ride_total_miles: rideTotalMiles,
    ride_max_single_miles: rideMaxSingle,
    ride_monthly_max: parseInt(rideMonthlyMaxRes.rows[0]?.max ?? 0),
    ride_max_streak_days: parseInt(rideStreakRes.rows[0]?.max ?? 0),
    night_rides_count: parseInt(nightRidesRes.rows[0]?.cnt ?? 0),
    morning_rides_count: parseInt(morningRidesRes.rows[0]?.cnt ?? 0),
    ride_participants_hosted: parseInt(rideCommunityRes.rows[0]?.cnt ?? 0),
    ride_unique_locations: parseInt(rideUniqueLocRes.rows[0]?.cnt ?? 0),
    ride_max_in_14_days: parseInt(rideTwoWeekRes.rows[0]?.max ?? 0),
    had_ride_comeback: rideComebackRes.rows[0]?.had_gap === true ? 1 : 0,
    ride_hosted_count: parseInt(rideHostedRes.rows[0]?.cnt ?? 0),
    has_fast_ride: rideMaxSingle >= 20 ? 1 : 0,
    ride_pace_perfect_count: 0,
    attendance_rate_pct: attendanceRatePct,
    has_metric_century: rideMaxSingle >= 62.1 ? 1 : 0,
    ride_total_elevation_ft: 0,
    has_strong_ride: bestRideSpeedMph >= 15 ? 1 : 0,
    has_fast_ride_18: bestRideSpeedMph >= 18 ? 1 : 0,
    has_blazing_ride: bestRideSpeedMph >= 22 ? 1 : 0,
  };
}

export async function checkAndAwardRideAchievements(userId: string) {
  const ridesRes = await pool.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'`,
    [userId]
  );
  const hostedRes = await pool.query(
    `SELECT COUNT(*) as cnt FROM runs WHERE host_id = $1 AND activity_type = 'ride'`,
    [userId]
  );
  const completedRides = parseInt(ridesRes.rows[0]?.cnt ?? 0);
  const hostedRides = parseInt(hostedRes.rows[0]?.cnt ?? 0);

  if (completedRides >= 1) await awardSlug(userId, "first_ride");
  if (completedRides >= 5) await awardSlug(userId, "five_rides");
  if (completedRides >= 10) await awardSlug(userId, "ten_rides");
  if (completedRides >= 25) await awardSlug(userId, "ride_grinder");
  if (hostedRides >= 1) await awardSlug(userId, "ride_host_debut");
  if (hostedRides >= 5) await awardSlug(userId, "ride_crew_builder");

  const rideMilesRes = await pool.query(
    `SELECT COALESCE(SUM(rp.miles_logged), 0) as total FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND rp.miles_logged > 0 AND r.activity_type = 'ride'`,
    [userId]
  );
  const totalRideMiles = parseFloat(rideMilesRes.rows[0]?.total ?? 0);
  if (totalRideMiles >= 25) await awardSlug(userId, "ride_miles_25");
  if (totalRideMiles >= 100) await awardSlug(userId, "ride_miles_100");
  if (totalRideMiles >= 250) await awardSlug(userId, "ride_miles_250");
  if (totalRideMiles >= 500) await awardSlug(userId, "ride_miles_500");

  const maxSingleRide = await pool.query(
    `SELECT COALESCE(MAX(rp.miles_logged), 0) as max FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND rp.miles_logged > 0 AND r.activity_type = 'ride'`,
    [userId]
  );
  const maxRideMiles = parseFloat(maxSingleRide.rows[0]?.max ?? 0);
  if (maxRideMiles >= 50) await awardSlug(userId, "half_century");
  if (maxRideMiles >= 62.1) await awardSlug(userId, "metric_century");
  if (maxRideMiles >= 100) await awardSlug(userId, "century_ride");

  // Speed-based ride achievements: avg speed = 60 / pace_min_per_mile (mph)
  const fastRideRes = await pool.query(
    `SELECT COALESCE(MIN(rp.final_pace), 999) as best_pace FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
     AND rp.final_pace IS NOT NULL AND rp.final_pace > 0`,
    [userId]
  );
  const bestRidePace = parseFloat(fastRideRes.rows[0]?.best_pace ?? 999);
  // pace in min/mi; mph = 60 / pace_min_per_mile
  if (bestRidePace < 999 && (60 / bestRidePace) >= 15) await awardSlug(userId, "strong_rider");
  if (bestRidePace < 999 && (60 / bestRidePace) >= 18) await awardSlug(userId, "fast_rider");
  if (bestRidePace < 999 && (60 / bestRidePace) >= 22) await awardSlug(userId, "blazing_rider");

  const publicRideRes = await pool.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.privacy = 'public' AND r.host_id != $1 AND r.activity_type = 'ride'`,
    [userId]
  );
  if (parseInt(publicRideRes.rows[0]?.cnt) >= 1) await awardSlug(userId, "social_cyclist");

  const squadRideRes = await pool.query(
    `SELECT COUNT(DISTINCT rp.run_id) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
     AND (SELECT COUNT(*) FROM run_participants rp2 WHERE rp2.run_id = rp.run_id AND rp2.status != 'cancelled') >= 3`,
    [userId]
  );
  if (parseInt(squadRideRes.rows[0]?.cnt) >= 1) await awardSlug(userId, "squad_rider");

  const rideParticipants = await pool.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE r.host_id = $1 AND rp.user_id != $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'`,
    [userId]
  );
  if (parseInt(rideParticipants.rows[0]?.cnt) >= 20) await awardSlug(userId, "ride_community_leader");

  const nightRideRes = await pool.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
     AND EXTRACT(HOUR FROM r.date AT TIME ZONE 'UTC') >= 20`,
    [userId]
  );
  if (parseInt(nightRideRes.rows[0]?.cnt) >= 5) await awardSlug(userId, "night_rider");

  const morningRideRes = await pool.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'
     AND EXTRACT(HOUR FROM r.date AT TIME ZONE 'UTC') < 7`,
    [userId]
  );
  if (parseInt(morningRideRes.rows[0]?.cnt) >= 10) await awardSlug(userId, "morning_cyclist");
}

export async function rateHost(data: {
  runId: string;
  hostId: string;
  raterId: string;
  stars: number;
  tags: string[];
}) {
  const existing = await pool.query(
    `SELECT id FROM host_ratings WHERE run_id = $1 AND rater_id = $2`,
    [data.runId, data.raterId]
  );
  if (existing.rows.length > 0) throw new Error("Already rated this run");
  await pool.query(
    `INSERT INTO host_ratings (run_id, host_id, rater_id, stars, tags) VALUES ($1,$2,$3,$4,$5)`,
    [data.runId, data.hostId, data.raterId, data.stars, data.tags]
  );
  const avg = await pool.query(
    `SELECT AVG(stars) as avg, COUNT(*) as count FROM host_ratings WHERE host_id = $1`,
    [data.hostId]
  );
  await pool.query(
    `UPDATE users SET avg_rating = $2, rating_count = $3 WHERE id = $1`,
    [data.hostId, parseFloat(avg.rows[0].avg).toFixed(1), parseInt(avg.rows[0].count)]
  );
  return { success: true };
}

export async function getUserRatingForRun(runId: string, raterId: string) {
  const result = await pool.query(
    `SELECT * FROM host_ratings WHERE run_id = $1 AND rater_id = $2`,
    [runId, raterId]
  );
  return result.rows[0] || null;
}

export async function updateGoals(userId: string, monthlyGoal?: number, yearlyGoal?: number, paceGoal?: number | null) {
  const updates: string[] = [];
  const values: any[] = [userId];
  if (monthlyGoal !== undefined) { updates.push(`monthly_goal = $${values.length + 1}`); values.push(monthlyGoal); }
  if (yearlyGoal !== undefined) { updates.push(`yearly_goal = $${values.length + 1}`); values.push(yearlyGoal); }
  if (paceGoal !== undefined) { updates.push(`pace_goal = $${values.length + 1}`); values.push(paceGoal); }
  if (!updates.length) return;
  await pool.query(`UPDATE users SET ${updates.join(", ")} WHERE id = $1`, values);
}

// ─── Saved Paths ───────────────────────────────────────────────────────────────

export async function getSavedPaths(userId: string) {
  const res = await pool.query(
    `SELECT * FROM saved_paths WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return res.rows;
}

export async function createSavedPath(
  userId: string,
  data: { name: string; routePath: Array<{ latitude: number; longitude: number }>; distanceMiles?: number; activityType?: string; activityTypes?: string[]; soloRunId?: string | null }
) {
  const { path: dedupedPath, distanceMiles: computedDist, loopDetected } = deduplicateRoutePath(data.routePath);
  // When a loop closure was detected, use the trimmed GPS distance.
  // When no loop, keep the full path but prefer the run's recorded distance over recomputed GPS.
  const finalDist = loopDetected
    ? computedDist
    : (data.distanceMiles != null && data.distanceMiles > 0 ? data.distanceMiles : (computedDist > 0 ? computedDist : null));

  // Sanitize activityTypes: only allow run/walk/ride, dedupe, keep null if empty
  const validTypes = ["run", "walk", "ride"];
  const types = Array.isArray(data.activityTypes)
    ? Array.from(new Set(data.activityTypes.filter((t) => validTypes.includes(t))))
    : [];
  const primary = types[0] ?? data.activityType ?? "run";
  const typesOrNull = types.length > 0 ? types : null;

  const res = await pool.query(
    `INSERT INTO saved_paths (user_id, name, route_path, distance_miles, activity_type, activity_types)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [userId, data.name, JSON.stringify(dedupedPath), finalDist, primary, typesOrNull]
  );
  const newPath = res.rows[0];

  if (data.soloRunId) {
    await pool.query(
      `UPDATE solo_runs SET saved_path_id = $1 WHERE id = $2 AND user_id = $3`,
      [newPath.id, data.soloRunId, userId]
    );
  }

  return newPath;
}

export async function updateSavedPath(id: string, userId: string, name: string) {
  const res = await pool.query(
    `UPDATE saved_paths SET name = $3 WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId, name]
  );
  return res.rows[0] || null;
}

export async function deleteSavedPath(id: string, userId: string) {
  const res = await pool.query(
    `DELETE FROM saved_paths WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId]
  );
  if (!res.rows.length) throw new Error("Not found or not authorized");
  return { success: true };
}

export async function sharePathWithFriend(fromUserId: string, pathId: string, toUserId: string) {
  const pathRes = await pool.query(`SELECT * FROM saved_paths WHERE id = $1 AND user_id = $2`, [pathId, fromUserId]);
  const path = pathRes.rows[0];
  if (!path) throw new Error("Path not found");
  // Enforce friendship — only allow sharing with accepted friends
  const friendRes = await pool.query(
    `SELECT 1 FROM friends
     WHERE status = 'accepted'
       AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
    [fromUserId, toUserId]
  );
  if (!friendRes.rows.length) throw new Error("You can only share routes with friends");
  const res = await pool.query(
    `INSERT INTO path_shares (from_user_id, to_user_id, saved_path_id, path_name, path_distance_miles, activity_type)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [fromUserId, toUserId, pathId, path.name, path.distance_miles, path.activity_type ?? "run"]
  );
  return res.rows[0];
}

export async function cloneSharedPath(shareId: string, toUserId: string) {
  const shareRes = await pool.query(`SELECT * FROM path_shares WHERE id = $1 AND to_user_id = $2`, [shareId, toUserId]);
  const share = shareRes.rows[0];
  if (!share) throw new Error("Share not found");
  const pathRes = await pool.query(`SELECT * FROM saved_paths WHERE id = $1`, [share.saved_path_id]);
  const path = pathRes.rows[0];
  if (!path) throw new Error("Path no longer exists");
  const newRes = await pool.query(
    `INSERT INTO saved_paths (user_id, name, route_path, distance_miles, activity_type)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [toUserId, path.name, JSON.stringify(typeof path.route_path === "string" ? JSON.parse(path.route_path) : path.route_path), path.distance_miles, path.activity_type ?? "run"]
  );
  await pool.query(`UPDATE path_shares SET cloned = true WHERE id = $1`, [shareId]);
  return newRes.rows[0];
}

export async function getPathShares(userId: string) {
  const res = await pool.query(
    `SELECT ps.*, u.name as from_name, u.photo_url as from_photo
     FROM path_shares ps
     JOIN users u ON u.id = ps.from_user_id
     WHERE ps.to_user_id = $1
     ORDER BY ps.created_at DESC
     LIMIT 30`,
    [userId]
  );
  return res.rows;
}

export async function getSavedPathStats(pathId: string, userId: string) {
  const owner = await pool.query(`SELECT id FROM saved_paths WHERE id = $1 AND user_id = $2`, [pathId, userId]);
  if (!owner.rows.length) throw new Error("Path not found");
  // Solo runs that used this path
  const soloRes = await pool.query(
    `SELECT distance_miles, pace_min_per_mile FROM solo_runs
     WHERE saved_path_id = $1 AND user_id = $2 AND completed = true AND is_deleted IS NOT TRUE`,
    [pathId, userId]
  );
  // Group runs (crew/discover) tagged with this saved_path_id where this user participated
  const partRes = await pool.query(
    `SELECT rp.final_distance AS distance_miles, rp.final_pace AS pace_min_per_mile
       FROM run_participants rp
       JOIN runs r ON r.id = rp.run_id
      WHERE r.saved_path_id = $1 AND rp.user_id = $2
        AND rp.final_distance IS NOT NULL`,
    [pathId, userId]
  );
  const rows = [...soloRes.rows, ...partRes.rows];
  const dists = rows.map(r => Number(r.distance_miles)).filter(n => Number.isFinite(n) && n > 0);
  const paces = rows.map(r => Number(r.pace_min_per_mile)).filter(n => Number.isFinite(n) && n > 0);
  const avg = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  return {
    timesUsed: rows.length,
    avgDistanceMiles: avg(dists),
    avgPaceMinPerMile: avg(paces),
  };
}

async function userCanAccessSavedPath(pathId: string, userId: string): Promise<boolean> {
  const ownRes = await pool.query(
    `SELECT 1 FROM saved_paths WHERE id = $1 AND user_id = $2`,
    [pathId, userId]
  );
  if (ownRes.rows.length) return true;

  const publicRes = await pool.query(
    `SELECT 1 FROM saved_paths sp
       JOIN community_paths cp ON cp.id = sp.community_path_id
      WHERE sp.id = $1 AND cp.is_public = true`,
    [pathId]
  );
  if (publicRes.rows.length) return true;

  const shareRes = await pool.query(
    `SELECT 1 FROM path_shares WHERE saved_path_id = $1 AND to_user_id = $2`,
    [pathId, userId]
  );
  if (shareRes.rows.length) return true;

  return false;
}

export async function getSavedPathPublicPreview(pathId: string, viewerId: string) {
  const allowed = await userCanAccessSavedPath(pathId, viewerId);
  if (!allowed) throw new Error("Route not found");
  const res = await pool.query(
    `SELECT sp.id AS path_id, sp.name, sp.distance_miles, sp.activity_type, sp.route_path,
            sp.community_path_id, u.name AS owner_name, u.photo_url AS owner_photo
       FROM saved_paths sp
       JOIN users u ON u.id = sp.user_id
      WHERE sp.id = $1`,
    [pathId]
  );
  const row = res.rows[0];
  if (!row) throw new Error("Route not found");
  if (typeof row.route_path === "string") {
    try { row.route_path = JSON.parse(row.route_path); } catch { row.route_path = []; }
  }
  return row;
}

export async function clonePathDirect(pathId: string, toUserId: string) {
  const allowed = await userCanAccessSavedPath(pathId, toUserId);
  if (!allowed) throw new Error("Route not found");
  const pathRes = await pool.query(`SELECT * FROM saved_paths WHERE id = $1`, [pathId]);
  const path = pathRes.rows[0];
  if (!path) throw new Error("Route not found");
  if (path.user_id === toUserId) {
    return path;
  }
  const dupe = await pool.query(
    `SELECT id FROM saved_paths WHERE user_id = $1 AND name = $2`,
    [toUserId, path.name]
  );
  if (dupe.rows.length) return dupe.rows[0];
  const newRes = await pool.query(
    `INSERT INTO saved_paths (user_id, name, route_path, distance_miles, activity_type)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [toUserId, path.name, JSON.stringify(typeof path.route_path === "string" ? JSON.parse(path.route_path) : path.route_path), path.distance_miles, path.activity_type ?? "run"]
  );
  return newRes.rows[0];
}

export async function getPathSharePreview(shareId: string, userId: string) {
  const res = await pool.query(
    `SELECT ps.id AS share_id, ps.cloned, ps.from_user_id, ps.to_user_id,
            sp.id AS path_id, sp.name, sp.distance_miles, sp.activity_type, sp.route_path,
            u.name AS from_name, u.photo_url AS from_photo
       FROM path_shares ps
       JOIN saved_paths sp ON sp.id = ps.saved_path_id
       JOIN users u ON u.id = ps.from_user_id
      WHERE ps.id = $1 AND ps.to_user_id = $2`,
    [shareId, userId]
  );
  const row = res.rows[0];
  if (!row) throw new Error("Share not found");
  if (typeof row.route_path === "string") {
    try { row.route_path = JSON.parse(row.route_path); } catch { row.route_path = []; }
  }
  return row;
}

export async function publishSavedPath(pathId: string, userId: string) {
  const pathRes = await pool.query(`SELECT * FROM saved_paths WHERE id = $1 AND user_id = $2`, [pathId, userId]);
  const path = pathRes.rows[0];
  if (!path) throw new Error("Path not found");

  if (path.community_path_id) {
    const existing = await pool.query(`SELECT * FROM community_paths WHERE id = $1`, [path.community_path_id]);
    if (existing.rows[0]) return { alreadyPublished: true, communityPath: existing.rows[0] };
  }

  const user = await getUserById(userId);
  if (!user) throw new Error("User not found");

  const routePath = typeof path.route_path === "string" ? JSON.parse(path.route_path) : path.route_path;
  if (!routePath || routePath.length < 2) throw new Error("Route must have at least 2 points");

  const startLat = routePath[0].latitude;
  const startLng = routePath[0].longitude;
  const endLat = routePath[routePath.length - 1].latitude;
  const endLng = routePath[routePath.length - 1].longitude;

  const cpRes = await pool.query(
    `INSERT INTO community_paths (name, route_path, distance_miles, is_public, created_by_user_id, created_by_name, start_lat, start_lng, end_lat, end_lng, activity_type, activity_types, run_count)
     VALUES ($1, $2, $3, true, $4, $5, $6, $7, $8, $9, $10, $11, 0) RETURNING *`,
    [path.name, JSON.stringify(routePath), path.distance_miles, userId, user.name, startLat, startLng, endLat, endLng, path.activity_type ?? "run", path.activity_types ?? null]
  );
  const communityPath = cpRes.rows[0];

  await pool.query(`UPDATE saved_paths SET community_path_id = $1 WHERE id = $2`, [communityPath.id, pathId]);
  await pool.query(
    `INSERT INTO path_contributions (community_path_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [communityPath.id, userId]
  );

  return { alreadyPublished: false, communityPath };
}

// ─── Community Paths ───────────────────────────────────────────────────────────

export async function getCommunityPaths(bounds?: { swLat: number; neLat: number; swLng: number; neLng: number }) {
  let query = `SELECT *,
    (SELECT COUNT(*) FROM path_contributions WHERE community_path_id = cp.id) as contribution_count,
    (osm_way_id IS NOT NULL) as is_osm,
    CASE WHEN osm_way_id IS NOT NULL THEN 'osm' ELSE 'user' END as source
    FROM community_paths cp WHERE is_public = true`;
  const params: any[] = [];
  if (bounds) {
    params.push(bounds.swLat, bounds.neLat, bounds.swLng, bounds.neLng);
    query += ` AND start_lat >= $1 AND start_lat <= $2 AND start_lng >= $3 AND start_lng <= $4`;
  }
  query += ` ORDER BY run_count DESC, updated_at DESC LIMIT 200`;
  const res = await pool.query(query, params);
  const rows = res.rows;
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.id);
  const variants = await pool.query(
    `SELECT id, parent_path_id, name, route_path, distance_miles, activity_types
       FROM path_variants WHERE parent_path_id = ANY($1::varchar[])`,
    [ids]
  );
  const byParent = new Map<string, any[]>();
  for (const v of variants.rows) {
    const arr = byParent.get(v.parent_path_id) ?? [];
    arr.push(v);
    byParent.set(v.parent_path_id, arr);
  }
  for (const r of rows) r.variants = byParent.get(r.id) ?? [];
  return rows;
}

export async function addPathVariant(parentId: string, variant: { name: string; route_path: any; distance_miles: number; activity_types: string[] }) {
  const r = await pool.query(
    `INSERT INTO path_variants (parent_path_id, name, route_path, distance_miles, activity_types)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, parent_path_id, name, route_path, distance_miles, activity_types`,
    [parentId, variant.name, JSON.stringify(variant.route_path), variant.distance_miles, variant.activity_types]
  );
  return r.rows[0];
}

export async function replacePathVariants(parentId: string, variants: Array<{ name: string; route_path: any; distance_miles: number; activity_types: string[] }>) {
  await pool.query(`DELETE FROM path_variants WHERE parent_path_id = $1`, [parentId]);
  for (const v of variants) {
    await pool.query(
      `INSERT INTO path_variants (parent_path_id, name, route_path, distance_miles, activity_types)
         VALUES ($1, $2, $3, $4, $5)`,
      [parentId, v.name, JSON.stringify(v.route_path), v.distance_miles, v.activity_types]
    );
  }
}

export async function publishSoloRunRoute(soloRunId: string, userId: string, routeName: string) {
  const soloRes = await pool.query(`SELECT * FROM solo_runs WHERE id = $1 AND user_id = $2`, [soloRunId, userId]);
  const soloRun = soloRes.rows[0];
  if (!soloRun) throw new Error("Solo run not found");
  
  const routePath = soloRun.route_path;
  if (!routePath || !Array.isArray(routePath) || routePath.length < 2) {
    throw new Error("Route must have at least 2 points to publish");
  }

  const user = await getUserById(userId);
  if (!user) throw new Error("User not found");

  const startLat = routePath[0].latitude;
  const startLng = routePath[0].longitude;
  const endLat = routePath[routePath.length - 1].latitude;
  const endLng = routePath[routePath.length - 1].longitude;

  const result = await pool.query(
    `INSERT INTO community_paths (name, route_path, distance_miles, is_public, created_by_user_id, created_by_name, start_lat, start_lng, end_lat, end_lng, activity_type, run_count)
     VALUES ($1, $2, $3, true, $4, $5, $6, $7, $8, $9, $10, 1) RETURNING *`,
    [routeName, JSON.stringify(routePath), soloRun.distance_miles, userId, user.name, startLat, startLng, endLat, endLng, soloRun.activity_type || 'run']
  );
  
  const newPath = result.rows[0];
  await pool.query(
    `INSERT INTO path_contributions (community_path_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [newPath.id, userId]
  );
  
  return newPath;
}

export async function getCrewMessages(crewId: string, limit = 50) {
  const result = await pool.query(
    `SELECT * FROM crew_messages WHERE crew_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [crewId, limit]
  );
  return result.rows;
}

export async function markCrewChatRead(crewId: string, userId: string) {
  await pool.query(
    `UPDATE crew_members SET chat_last_read_at = NOW()
     WHERE crew_id = $1 AND user_id = $2 AND status = 'member'`,
    [crewId, userId]
  );
}

export async function createCrewMessage(
  crewId: string,
  userId: string,
  senderName: string,
  senderPhoto: string | null,
  message: string,
  messageType: string = 'text',
  metadata: any = null
) {
  const result = await pool.query(
    `INSERT INTO crew_messages (crew_id, user_id, sender_name, sender_photo, message, message_type, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [crewId, userId, senderName, senderPhoto, message, messageType, metadata ? JSON.stringify(metadata) : null]
  );
  return result.rows[0];
}

export async function isParticipant(runId: string, userId: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM run_participants WHERE run_id = $1 AND user_id = $2 AND status != 'cancelled'`,
    [runId, userId]
  );
  return res.rows.length > 0;
}

export async function matchCommunityPath(
  userId: string,
  savedPathId: string,
  routePath: Array<{ latitude: number; longitude: number }>,
  distanceMiles: number | null
) {
  if (routePath.length < 2) return;

  const start = routePath[0];
  const end = routePath[routePath.length - 1];
  const dist = distanceMiles ?? 0;

  const existing = await pool.query(
    `SELECT cp.*,
       (SELECT COUNT(*) FROM path_contributions pc WHERE pc.community_path_id = cp.id AND pc.user_id = $1) as already_contributed
     FROM community_paths cp
     WHERE ABS(cp.start_lat - $2) < 0.005
       AND ABS(cp.start_lng - $3) < 0.005
       AND ABS(cp.end_lat - $4) < 0.005
       AND ABS(cp.end_lng - $5) < 0.005
       AND ($6::float = 0 OR cp.distance_miles IS NULL OR ABS(cp.distance_miles - $6::float) / GREATEST($6::float, 0.1) < 0.35)
     ORDER BY cp.contributor_count DESC LIMIT 1`,
    [userId, start.latitude, start.longitude, end.latitude, end.longitude, dist]
  );

  if (existing.rows.length > 0) {
    const cp = existing.rows[0];
    if (parseInt(cp.already_contributed) > 0) return;
    await pool.query(
      `INSERT INTO path_contributions (community_path_id, user_id, saved_path_id)
       VALUES ($1, $2, $3) ON CONFLICT (community_path_id, user_id) DO NOTHING`,
      [cp.id, userId, savedPathId]
    );
    await pool.query(
      `UPDATE community_paths
       SET contributor_count = (SELECT COUNT(DISTINCT user_id) FROM path_contributions WHERE community_path_id = $1),
           updated_at = NOW()
       WHERE id = $1`,
      [cp.id]
    );
  } else {
    const distLabel = dist > 0 ? `${dist.toFixed(1)} mi Route` : "Running Route";
    const cpRes = await pool.query(
      `INSERT INTO community_paths (name, route_path, distance_miles, contributor_count, start_lat, start_lng, end_lat, end_lng)
       VALUES ($1, $2, $3, 1, $4, $5, $6, $7) RETURNING id`,
      [distLabel, JSON.stringify(routePath), distanceMiles ?? null, start.latitude, start.longitude, end.latitude, end.longitude]
    );
    await pool.query(
      `INSERT INTO path_contributions (community_path_id, user_id, saved_path_id) VALUES ($1, $2, $3)`,
      [cpRes.rows[0].id, userId, savedPathId]
    );
  }
}

// ─── Bookmarks & Plans ─────────────────────────────────────────────────────────

export async function toggleBookmark(userId: string, runId: string) {
  const existing = await pool.query(
    `SELECT id FROM bookmarked_runs WHERE user_id = $1 AND run_id = $2`,
    [userId, runId]
  );
  if (existing.rows.length > 0) {
    await pool.query(`DELETE FROM bookmarked_runs WHERE user_id = $1 AND run_id = $2`, [userId, runId]);
    return { bookmarked: false };
  } else {
    await pool.query(
      `INSERT INTO bookmarked_runs (user_id, run_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, runId]
    );
    return { bookmarked: true };
  }
}

export async function togglePlan(userId: string, runId: string) {
  // T2.3: idempotent — single atomic DELETE then conditional INSERT. Two rapid
  // taps no longer race: the second tap sees the row deleted and re-inserts,
  // ending in a deterministic state (planned=true after odd taps, false after even).
  const del = await pool.query(
    `DELETE FROM planned_runs WHERE user_id = $1 AND run_id = $2 RETURNING id`,
    [userId, runId]
  );
  if (del.rowCount && del.rowCount > 0) return { planned: false };
  await pool.query(
    `INSERT INTO planned_runs (user_id, run_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, runId]
  );
  return { planned: true };
}

export async function getRunStatus(userId: string, runId: string) {
  const [bRes, pRes] = await Promise.all([
    pool.query(`SELECT id FROM bookmarked_runs WHERE user_id = $1 AND run_id = $2`, [userId, runId]),
    pool.query(`SELECT id FROM planned_runs WHERE user_id = $1 AND run_id = $2`, [userId, runId]),
  ]);
  return {
    is_bookmarked: bRes.rows.length > 0,
    is_planned: pRes.rows.length > 0,
  };
}

export async function getPlannedRuns(userId: string) {
  const result = await pool.query(
    `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.rating_count as host_rating_count, u.photo_url as host_photo,
      u.marker_icon as host_marker_icon,
      (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) as participant_count,
      pr.created_at as planned_at
     FROM planned_runs pr
     JOIN runs r ON r.id = pr.run_id
     JOIN users u ON u.id = r.host_id
     WHERE pr.user_id = $1
       -- T3.11: was a 3-hour past-floor that hid still-pending events the
       -- user planned for. Now: keep planned events in the list as long as
       -- they haven't been completed/cancelled, regardless of how late.
       AND r.is_completed = false
       AND r.is_deleted IS NOT TRUE
       AND (r.is_abandoned IS NOT TRUE)
       AND NOT EXISTS (
         SELECT 1 FROM run_participants rp2
         WHERE rp2.run_id = r.id AND rp2.user_id = $1 AND rp2.status = 'confirmed'
       )
     ORDER BY r.date ASC`,
    [userId]
  );
  return result.rows;
}

export async function getBookmarkedRuns(userId: string) {
  const result = await pool.query(
    `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.rating_count as host_rating_count, u.photo_url as host_photo,
      u.marker_icon as host_marker_icon,
      (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) as participant_count,
      b.created_at as bookmarked_at
     FROM bookmarked_runs b
     JOIN runs r ON r.id = b.run_id
     JOIN users u ON u.id = r.host_id
     WHERE b.user_id = $1
     ORDER BY b.created_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function getStarredRunsForUser(userId: string, limit = 3) {
  const result = await pool.query(
    `SELECT r.id, r.title, r.date, r.location, r.distance_miles, r.activity_type, r.min_pace, r.max_pace
     FROM bookmarked_runs b
     JOIN runs r ON r.id = b.run_id
     WHERE b.user_id = $1
     ORDER BY b.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

// ─── Run Photos ───────────────────────────────────────────────────────────────

export async function getRunPhotos(runId: string) {
  const res = await pool.query(
    `SELECT rp.*, u.name as uploader_name, u.photo_url as uploader_avatar
     FROM run_photos rp
     JOIN users u ON u.id = rp.user_id
     WHERE rp.run_id = $1
     ORDER BY rp.created_at ASC`,
    [runId]
  );
  return res.rows;
}

export async function addRunPhoto(runId: string, userId: string, photoUrl: string) {
  const res = await pool.query(
    `INSERT INTO run_photos (run_id, user_id, photo_url) VALUES ($1, $2, $3) RETURNING *`,
    [runId, userId, photoUrl]
  );
  return res.rows[0];
}

export async function deleteRunPhoto(photoId: string, userId: string) {
  // T2.13: photographer OR host can delete (host needs moderation power).
  await pool.query(
    `DELETE FROM run_photos
     WHERE id = $1
       AND (
         user_id = $2
         OR run_id IN (SELECT id FROM runs WHERE host_id = $2)
       )`,
    [photoId, userId]
  );
}

// ─── Solo Run Photos ──────────────────────────────────────────────────────────

export async function getSoloRunPhotos(soloRunId: string, userId: string) {
  const res = await pool.query(
    `SELECT srp.* FROM solo_run_photos srp
     JOIN solo_runs sr ON sr.id = srp.solo_run_id
     WHERE srp.solo_run_id = $1 AND sr.user_id = $2
     ORDER BY srp.created_at ASC`,
    [soloRunId, userId]
  );
  return res.rows;
}

export async function addSoloRunPhoto(soloRunId: string, userId: string, photoUrl: string) {
  const check = await pool.query(`SELECT id FROM solo_runs WHERE id = $1 AND user_id = $2`, [soloRunId, userId]);
  if (!check.rows[0]) throw new Error("Solo run not found");
  const res = await pool.query(
    `INSERT INTO solo_run_photos (solo_run_id, photo_url) VALUES ($1, $2) RETURNING *`,
    [soloRunId, photoUrl]
  );
  return res.rows[0];
}

export async function deleteSoloRunPhoto(photoId: string, userId: string) {
  await pool.query(
    `DELETE FROM solo_run_photos WHERE id = $1
     AND solo_run_id IN (SELECT id FROM solo_runs WHERE user_id = $2)`,
    [photoId, userId]
  );
}

export async function getPublicUserProfile(userId: string) {
  const userRes = await pool.query(
    `SELECT id, name, photo_url, avg_rating FROM users WHERE id = $1`,
    [userId]
  );
  if (!userRes.rows.length) return null;
  const u = userRes.rows[0];

  const [friendsRes, achievementsRes, liveStatsRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) as cnt FROM friends
       WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'`,
      [userId]
    ),
    pool.query(`SELECT slug FROM achievements WHERE user_id = $1`, [userId]),
    pool.query(`
      SELECT
        COALESCE(
          (SELECT SUM(sr.distance_miles) FROM solo_runs sr
           WHERE sr.user_id = $1 AND sr.completed = true AND sr.is_deleted IS NOT TRUE),
          0
        ) + COALESCE(
          (SELECT SUM(rp.final_distance) FROM run_participants rp
           WHERE rp.user_id = $1 AND rp.final_distance IS NOT NULL AND rp.final_distance > 0
             AND (rp.abandoned IS NULL OR rp.abandoned = false)),
          0
        ) AS total_miles,
        COALESCE(
          (SELECT COUNT(*) FROM solo_runs sr
           WHERE sr.user_id = $1 AND sr.completed = true AND sr.is_deleted IS NOT TRUE),
          0
        ) + COALESCE(
          (SELECT COUNT(*) FROM run_participants rp
           WHERE rp.user_id = $1 AND rp.final_distance IS NOT NULL AND rp.final_distance > 0
             AND (rp.abandoned IS NULL OR rp.abandoned = false)),
          0
        ) AS completed_runs,
        COALESCE(
          (SELECT COUNT(*) FROM runs r
           WHERE r.host_id = $1 AND r.is_completed = true AND r.is_deleted IS NOT TRUE),
          0
        ) AS hosted_runs,
        COALESCE(
          (SELECT AVG(NULLIF(sr.pace_min_per_mile, 0)) FROM solo_runs sr
           WHERE sr.user_id = $1 AND sr.completed = true AND sr.is_deleted IS NOT TRUE),
          0
        ) AS avg_pace
    `, [userId]),
  ]);

  const live = liveStatsRes.rows[0];

  return {
    id: u.id,
    name: u.name,
    photo_url: u.photo_url,
    avg_pace: parseFloat(live?.avg_pace ?? 0),
    hosted_runs: parseInt(live?.hosted_runs ?? 0),
    completed_runs: parseInt(live?.completed_runs ?? 0),
    total_miles: parseFloat(live?.total_miles ?? 0),
    avg_rating: parseFloat(u.avg_rating ?? 0),
    friends_count: parseInt(friendsRes.rows[0]?.cnt ?? "0"),
    earned_slugs: achievementsRes.rows.map((r: any) => r.slug as string),
  };
}

export async function getFriendshipStatus(currentUserId: string, targetUserId: string) {
  const res = await pool.query(
    `SELECT id, status, requester_id FROM friends
     WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
    [currentUserId, targetUserId]
  );
  if (!res.rows.length) return { status: "none" as const, friendshipId: null };
  const row = res.rows[0];
  if (row.status === "accepted") return { status: "friends" as const, friendshipId: row.id };
  if (row.requester_id === currentUserId) return { status: "pending_sent" as const, friendshipId: row.id };
  return { status: "pending_received" as const, friendshipId: row.id };
}

export async function getUserTopRuns(userId: string) {
  const longestRes = await pool.query(
    `SELECT dist, date, pace, title, run_type FROM (
       SELECT distance_miles as dist, date, pace_min_per_mile as pace, title, 'solo' as run_type
       FROM solo_runs WHERE user_id = $1 AND completed = true AND distance_miles IS NOT NULL
       UNION ALL
       SELECT rp.final_distance as dist, r.date, rp.final_pace as pace, r.title, 'group' as run_type
       FROM run_participants rp
       JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.final_distance IS NOT NULL AND rp.final_distance > 0
         AND (rp.abandoned IS NULL OR rp.abandoned = false)
     ) combined
     ORDER BY dist DESC LIMIT 5`,
    [userId]
  );

  const fastestRes = await pool.query(
    `SELECT dist, date, pace, title, run_type FROM (
       SELECT distance_miles as dist, date, pace_min_per_mile as pace, title, 'solo' as run_type
       FROM solo_runs WHERE user_id = $1 AND completed = true
         AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0
       UNION ALL
       SELECT rp.final_distance as dist, r.date, rp.final_pace as pace, r.title, 'group' as run_type
       FROM run_participants rp
       JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.final_pace IS NOT NULL AND rp.final_pace > 0
         AND (rp.abandoned IS NULL OR rp.abandoned = false)
     ) combined
     ORDER BY pace ASC LIMIT 5`,
    [userId]
  );

  const parse = (r: any) => ({
    dist: r.dist ? parseFloat(r.dist) : null,
    date: r.date as string,
    pace: r.pace ? parseFloat(r.pace) : null,
    title: r.title as string | null,
    run_type: r.run_type as "solo" | "group",
  });

  return {
    longestRuns: longestRes.rows.map(parse),
    fastestRuns: fastestRes.rows.map(parse),
  };
}

export async function getUserRunRecords(userId: string) {
  const longestRes = await pool.query(
    `SELECT MAX(dist) as longest FROM (
       SELECT distance_miles as dist FROM solo_runs WHERE user_id = $1 AND completed = true
       UNION ALL
       SELECT final_distance as dist FROM run_participants WHERE user_id = $1 AND final_distance IS NOT NULL AND final_distance > 0
         AND (abandoned IS NULL OR abandoned = false)
     ) combined`,
    [userId]
  );

  const fastestRes = await pool.query(
    `SELECT MIN(pace_min_per_mile) as fastest_pace FROM solo_runs
     WHERE user_id = $1 AND completed = true AND pace_min_per_mile IS NOT NULL AND pace_min_per_mile > 0`,
    [userId]
  );

  return {
    longest_run: longestRes.rows[0]?.longest ? parseFloat(longestRes.rows[0].longest) : null,
    fastest_pace: fastestRes.rows[0]?.fastest_pace ? parseFloat(fastestRes.rows[0].fastest_pace) : null,
  };
}

// ─── Crew Storage ─────────────────────────────────────────────────────────────

export async function createCrew(data: { name: string; description?: string; emoji: string; createdBy: string; runStyle?: string; tags?: string[]; imageUrl?: string; homeMetro?: string; homeState?: string }) {
  const existing = await pool.query(`SELECT id FROM crews WHERE LOWER(name) = LOWER($1)`, [data.name]);
  if (existing.rows.length > 0) {
    throw Object.assign(new Error("A crew with that name already exists. Please choose a different name."), { code: "DUPLICATE_CREW_NAME" });
  }
  const res = await pool.query(
    `INSERT INTO crews (name, description, emoji, created_by, run_style, tags, image_url, home_metro, home_state) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [data.name, data.description ?? null, data.emoji, data.createdBy, data.runStyle ?? null, data.tags ?? [], data.imageUrl ?? null, data.homeMetro ?? null, data.homeState ?? null]
  );
  const crew = res.rows[0];
  await pool.query(
    `INSERT INTO crew_members (crew_id, user_id, status, invited_by) VALUES ($1, $2, 'member', $3)`,
    [crew.id, data.createdBy, data.createdBy]
  );
  return crew;
}

export async function updateCrew(crewId: string, data: Partial<{ name: string; description: string; emoji: string; run_style: string; tags: string[]; image_url: string; current_streak_weeks: number; last_run_week: Date; home_metro: string; home_state: string; last_overtake_notif_at: Date; streak_risk_notif_week: number }>) {
  const keys = Object.keys(data);
  if (keys.length === 0) return null;
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const res = await pool.query(
    `UPDATE crews SET ${sets} WHERE id = $${keys.length + 1} RETURNING *`,
    [...Object.values(data), crewId]
  );
  return res.rows[0];
}

export async function getCrewRankings(type: 'national' | 'state' | 'metro', value?: string) {
  let filterClause = "";
  const params: any[] = [];
  if (type === 'state' && value) {
    filterClause = "AND c.home_state = $1";
    params.push(value);
  } else if (type === 'metro' && value) {
    filterClause = "AND c.home_metro = $1";
    params.push(value);
  }

  const res = await pool.query(
    `WITH active_members AS (
       -- Members who completed a group or solo run in the last 30 days
       SELECT DISTINCT cm.crew_id, cm.user_id
       FROM crew_members cm
       WHERE cm.status = 'member'
         AND (
           EXISTS (
             SELECT 1 FROM run_completions rc
             JOIN runs r ON r.id = rc.run_id
             WHERE rc.user_id = cm.user_id AND r.crew_id = cm.crew_id
               AND rc.created_at > NOW() - INTERVAL '30 days'
           )
           OR EXISTS (
             SELECT 1 FROM solo_runs sr
             WHERE sr.user_id = cm.user_id AND sr.completed = true
               AND sr.created_at > NOW() - INTERVAL '30 days'
           )
         )
     ),
     qualifying_events AS (
       -- Crew runs with 3+ participant completions
       SELECT r.crew_id, r.id as run_id, COUNT(rc.user_id) as completion_count,
              COALESCE(SUM(rc.distance_miles), 0) as event_miles
       FROM runs r
       JOIN run_completions rc ON rc.run_id = r.id
       WHERE r.crew_id IS NOT NULL
       GROUP BY r.crew_id, r.id
       HAVING COUNT(rc.user_id) >= 3
     ),
     crew_stats AS (
       SELECT
         c.id as crew_id,
         GREATEST(COUNT(DISTINCT am.user_id), 1) as active_members,
         COUNT(DISTINCT qe.run_id) as qualifying_events,
         COALESCE(SUM(qe.completion_count), 0) as total_participants,
         COALESCE(SUM(qe.event_miles), 0) as total_miles,
         GREATEST(EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 86400, 7) as days_active
       FROM crews c
       LEFT JOIN active_members am ON am.crew_id = c.id
       LEFT JOIN qualifying_events qe ON qe.crew_id = c.id
       GROUP BY c.id, c.created_at
     )
     SELECT c.*,
       u.name as created_by_name,
       cs.active_members,
       cs.qualifying_events,
       cs.total_miles,
       (SELECT COUNT(*) FROM crew_members cm2 WHERE cm2.crew_id = c.id AND cm2.status = 'member') as member_count,
       ROUND(CAST(cs.total_participants AS NUMERIC) / cs.active_members, 4) as participation_rate,
       ROUND(CAST(cs.total_miles AS NUMERIC) / cs.active_members, 2) as miles_per_member,
       ROUND(CAST(cs.qualifying_events AS NUMERIC) / (cs.days_active / 7), 2) as events_per_week,
       ROUND(
         (CAST(cs.total_participants AS NUMERIC) / cs.active_members * 50) +
         (CAST(cs.total_miles AS NUMERIC) / cs.active_members * 30) +
         (CAST(cs.qualifying_events AS NUMERIC) / (cs.days_active / 7) * 20),
         1
       ) as crew_score
     FROM crews c
     LEFT JOIN users u ON u.id = c.created_by
     JOIN crew_stats cs ON cs.crew_id = c.id
     WHERE 1=1 ${filterClause}
     ORDER BY crew_score DESC
     LIMIT 50`,
    params
  );
  return res.rows;
}

export async function getCrewMemberRole(crewId: string, userId: string): Promise<string> {
  const res = await pool.query(
    `SELECT role FROM crew_members WHERE crew_id = $1 AND user_id = $2 AND status = 'member'`,
    [crewId, userId]
  );
  return res.rows[0]?.role ?? 'member';
}

export async function getCrewPaceGroupLabels(crewId: string): Promise<{ position: number; label: string }[]> {
  const res = await pool.query(
    `SELECT position, label FROM crew_pace_group_labels WHERE crew_id = $1 ORDER BY position ASC`,
    [crewId]
  );
  return res.rows;
}

export async function setCrewPaceGroupLabels(crewId: string, labels: { position: number; label: string }[]) {
  // Replace the full set in one transaction so deletes (e.g. shrinking from 4 → 2 groups) take effect.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM crew_pace_group_labels WHERE crew_id = $1`, [crewId]);
    for (const { position, label } of labels) {
      const trimmed = (label ?? "").trim().slice(0, 30);
      if (!trimmed) continue;
      await client.query(
        `INSERT INTO crew_pace_group_labels (crew_id, position, label) VALUES ($1, $2, $3)`,
        [crewId, position, trimmed]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function setCrewMemberRole(crewId: string, targetUserId: string, newRole: string, callerUserId: string) {
  // Promoting to crew_chief: demote current caller to officer first
  if (newRole === 'crew_chief') {
    await pool.query(
      `UPDATE crew_members SET role = 'officer' WHERE crew_id = $1 AND user_id = $2`,
      [crewId, callerUserId]
    );
  }
  await pool.query(
    `UPDATE crew_members SET role = $3 WHERE crew_id = $1 AND user_id = $2`,
    [crewId, targetUserId, newRole]
  );
}

export async function getCrewsAtStreakRisk() {
  // Crews with active streak where no run is scheduled in the current ISO week
  // and streak_risk_notif_week != current ISO week number
  const currentWeek = getISOWeek(new Date());
  const res = await pool.query(
    `SELECT c.id, c.name, c.current_streak_weeks, c.streak_risk_notif_week
     FROM crews c
     WHERE c.current_streak_weeks > 0
       AND (c.streak_risk_notif_week IS NULL OR c.streak_risk_notif_week != $1)
       AND NOT EXISTS (
         SELECT 1 FROM runs r
         WHERE r.crew_id = c.id
           AND r.is_deleted IS NOT TRUE
           AND r.date >= date_trunc('week', NOW())
           AND r.date < date_trunc('week', NOW()) + INTERVAL '7 days'
       )`,
    [currentWeek]
  );
  return res.rows;
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export async function getCrewsByUser(userId: string) {
  const res = await pool.query(
    `SELECT c.*, cm.status, cm.chat_muted,
       (SELECT COUNT(*) FROM crew_members WHERE crew_id = c.id AND status = 'member') AS member_count,
       u.name AS created_by_name,
       CASE WHEN c.created_by = $1
         THEN (SELECT COUNT(*) FROM crew_members WHERE crew_id = c.id AND status = 'pending' AND invited_by = user_id)
         ELSE 0
       END AS pending_request_count,
       last_msg.message AS last_message,
       last_msg.created_at AS last_message_at,
       last_msg.sender_name AS last_sender_name,
       (SELECT COUNT(*) FROM crew_messages cm2
          WHERE cm2.crew_id = c.id
            AND cm2.created_at > COALESCE(cm.chat_last_read_at, 'epoch'::timestamp)
            AND cm2.user_id != $1
       ) AS unread_count
     FROM crews c
     JOIN crew_members cm ON cm.crew_id = c.id AND cm.user_id = $1 AND cm.status = 'member'
     LEFT JOIN users u ON u.id = c.created_by
     LEFT JOIN LATERAL (
       SELECT message, created_at, sender_name
       FROM crew_messages
       WHERE crew_id = c.id
       ORDER BY created_at DESC
       LIMIT 1
     ) last_msg ON true
     WHERE c.disbanded_at IS NULL
     ORDER BY COALESCE(last_msg.created_at, c.created_at) DESC`,
    [userId]
  );
  return res.rows;
}

export async function getCrewJoinRequests(crewId: string) {
  const res = await pool.query(
    `SELECT cm.user_id, cm.joined_at AS requested_at, u.name, u.username, u.photo_url, u.avg_pace, u.completed_runs
     FROM crew_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.crew_id = $1 AND cm.status = 'pending' AND cm.invited_by = cm.user_id
     ORDER BY cm.joined_at ASC`,
    [crewId]
  );
  return res.rows;
}

export async function respondToCrewJoinRequest(crewId: string, requesterId: string, accept: boolean) {
  if (accept) {
    if (await hasCrewBlockConflict(crewId, requesterId)) {
      throw Object.assign(new Error("Can't approve — requester has a block with an existing crew member."), { code: "BLOCK_CONFLICT" });
    }
    const memberCount = await getCrewMemberCount(crewId);
    const cap = await getCrewMemberCap(crewId);
    if (memberCount >= cap) {
      throw Object.assign(new Error("This crew has reached its member cap. Upgrade to the Crew Growth plan to add more members."), { code: "MEMBER_CAP_REACHED" });
    }
    await pool.query(
      `UPDATE crew_members SET status = 'member', invited_by = invited_by WHERE crew_id = $1 AND user_id = $2 AND status = 'pending'`,
      [crewId, requesterId]
    );
  } else {
    await pool.query(
      `DELETE FROM crew_members WHERE crew_id = $1 AND user_id = $2 AND status = 'pending'`,
      [crewId, requesterId]
    );
  }
}

export async function getCrewById(crewId: string, activityType: string = 'run') {
  const crew = await pool.query(
    `SELECT c.*, u.name AS created_by_name,
       (SELECT COUNT(*) FROM crew_members WHERE crew_id = c.id AND status = 'member') AS member_count
     FROM crews c
     LEFT JOIN users u ON u.id = c.created_by
     WHERE c.id = $1`,
    [crewId]
  );
  if (!crew.rows[0]) return null;
  const row = crew.rows[0];
  // Avg pace matches profile's algorithm exactly: solo runs only, filtered by
  // the viewer's currently-selected activity, pace >= 2.0, distance > 0.5 mi.
  // Returns null when the member has no qualifying runs for the activity —
  // client hides the pill via `avg_pace > 0` check.
  const members = await pool.query(
    `SELECT cm.*, u.name, u.username, u.photo_url, u.hosted_runs, u.default_activity,
       (
         SELECT AVG(sr.pace_min_per_mile)
         FROM solo_runs sr
         WHERE sr.user_id = u.id
           AND sr.completed = true
           AND sr.is_deleted IS NOT TRUE
           AND sr.activity_type = $2
           AND sr.pace_min_per_mile IS NOT NULL
           AND sr.pace_min_per_mile >= 2.0
           AND sr.distance_miles > 0.5
       ) AS avg_pace,
       -- Weekly (last 7 days) stats for top performers
       (SELECT COUNT(*) FROM solo_runs sr WHERE sr.user_id = u.id AND sr.completed = true
         AND sr.is_deleted IS NOT TRUE AND sr.activity_type = $2
         AND sr.date >= NOW() - INTERVAL '7 days') AS weekly_runs,
       (SELECT COALESCE(SUM(sr.distance_miles), 0) FROM solo_runs sr WHERE sr.user_id = u.id AND sr.completed = true
         AND sr.is_deleted IS NOT TRUE AND sr.activity_type = $2
         AND sr.date >= NOW() - INTERVAL '7 days') AS weekly_miles,
       (SELECT AVG(sr.pace_min_per_mile) FROM solo_runs sr WHERE sr.user_id = u.id AND sr.completed = true
         AND sr.is_deleted IS NOT TRUE AND sr.activity_type = $2
         AND sr.pace_min_per_mile IS NOT NULL AND sr.pace_min_per_mile >= 2.0 AND sr.distance_miles > 0.5
         AND sr.date >= NOW() - INTERVAL '7 days') AS weekly_pace,
       -- Monthly (last 30 days) stats for top performers
       (SELECT COUNT(*) FROM solo_runs sr WHERE sr.user_id = u.id AND sr.completed = true
         AND sr.is_deleted IS NOT TRUE AND sr.activity_type = $2
         AND sr.date >= NOW() - INTERVAL '30 days') AS monthly_runs,
       (SELECT COALESCE(SUM(sr.distance_miles), 0) FROM solo_runs sr WHERE sr.user_id = u.id AND sr.completed = true
         AND sr.is_deleted IS NOT TRUE AND sr.activity_type = $2
         AND sr.date >= NOW() - INTERVAL '30 days') AS monthly_miles,
       (SELECT AVG(sr.pace_min_per_mile) FROM solo_runs sr WHERE sr.user_id = u.id AND sr.completed = true
         AND sr.is_deleted IS NOT TRUE AND sr.activity_type = $2
         AND sr.pace_min_per_mile IS NOT NULL AND sr.pace_min_per_mile >= 2.0 AND sr.distance_miles > 0.5
         AND sr.date >= NOW() - INTERVAL '30 days') AS monthly_pace
     FROM crew_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.crew_id = $1 AND cm.status = 'member'
     ORDER BY cm.joined_at ASC`,
    [crewId, activityType]
  );
  return { ...row, member_count: parseInt(row.member_count ?? "0"), members: members.rows };
}

export async function getCrewInvites(userId: string) {
  const res = await pool.query(
    `SELECT cm.*, c.name AS crew_name, c.emoji, c.description,
       (SELECT COUNT(*) FROM crew_members WHERE crew_id = c.id AND status = 'member') AS member_count,
       u.name AS invited_by_name
     FROM crew_members cm
     JOIN crews c ON c.id = cm.crew_id
     JOIN users u ON u.id = cm.invited_by
     WHERE cm.user_id = $1 AND cm.status = 'pending'
     ORDER BY cm.joined_at DESC`,
    [userId]
  );
  return res.rows;
}

export async function inviteUserToCrew(crewId: string, userId: string, invitedBy: string) {
  if (await hasCrewBlockConflict(crewId, userId)) {
    throw Object.assign(new Error("Can't invite this user — a block exists between them and an existing crew member."), { code: "BLOCK_CONFLICT" });
  }
  await pool.query(
    `INSERT INTO crew_members (crew_id, user_id, status, invited_by)
     VALUES ($1, $2, 'pending', $3)
     ON CONFLICT (crew_id, user_id) DO NOTHING`,
    [crewId, userId, invitedBy]
  );
}

export async function removeCrewMember(crewId: string, requesterId: string, targetUserId: string) {
  const crew = await pool.query(`SELECT created_by FROM crews WHERE id = $1`, [crewId]);
  if (!crew.rows[0]) throw new Error("Crew not found");
  if (crew.rows[0].created_by !== requesterId) throw new Error("Only the Crew Chief can remove members");
  if (targetUserId === requesterId) throw new Error("You cannot remove yourself — use Leave Crew instead");
  await pool.query(
    `DELETE FROM crew_members WHERE crew_id = $1 AND user_id = $2`,
    [crewId, targetUserId]
  );
}

export async function leaveCrewById(crewId: string, userId: string) {
  const countRes = await pool.query(
    `SELECT COUNT(*) as cnt FROM crew_members WHERE crew_id = $1 AND status = 'member' AND user_id != $2`,
    [crewId, userId]
  );
  const remaining = parseInt(countRes.rows[0]?.cnt ?? 0);

  if (remaining === 0) {
    // Soft-disband. Row is retained so it can be restored if this fires by mistake.
    await pool.query(
      `UPDATE crews SET disbanded_at = NOW(), disbanded_by = $2, disbanded_reason = 'last_member_left' WHERE id = $1 AND disbanded_at IS NULL`,
      [crewId, userId]
    );
    return { disbanded: true, newOwnerId: null, crewName: null };
  }

  const crewRes = await pool.query(`SELECT created_by, name FROM crews WHERE id = $1`, [crewId]);
  const isCreator = crewRes.rows[0]?.created_by === userId;
  const crewName: string = crewRes.rows[0]?.name ?? "Crew";

  let newOwnerId: string | null = null;
  if (isCreator) {
    const nextRes = await pool.query(
      `SELECT user_id FROM crew_members WHERE crew_id = $1 AND user_id != $2 AND status = 'member' ORDER BY joined_at ASC LIMIT 1`,
      [crewId, userId]
    );
    newOwnerId = nextRes.rows[0]?.user_id ?? null;
    if (newOwnerId) {
      await pool.query(`UPDATE crews SET created_by = $1 WHERE id = $2`, [newOwnerId, crewId]);
      // Generate a new cycle_id so subsequent declines in this cycle are scoped correctly
      await pool.query(
        `INSERT INTO crew_chief_promotions (crew_id, user_id, crew_name, cycle_id)
         VALUES ($1, $2, $3, gen_random_uuid())`,
        [crewId, newOwnerId, crewName]
      );
    }
  }

  await pool.query(`DELETE FROM crew_members WHERE crew_id = $1 AND user_id = $2`, [crewId, userId]);
  return { disbanded: false, newOwnerId, crewName };
}

export async function declineCrewChiefPromotion(
  crewId: string,
  userId: string
): Promise<{ newOwnerId: string | null; disbanded: boolean; forced: boolean; noOp: boolean }> {
  // Mark current promotion as declined and retrieve the cycle_id so we scope the
  // decline cap and exclusion list to this promotion cycle only.
  const updateRes = await pool.query<{ cycle_id: string | null }>(
    `UPDATE crew_chief_promotions
     SET declined = true
     WHERE crew_id = $1 AND user_id = $2 AND declined = false
     RETURNING cycle_id`,
    [crewId, userId]
  );

  // Idempotency: if no row was updated, this user had no pending promotion.
  // Return noOp=true so the route skips notification side-effects.
  if (updateRes.rowCount === 0) {
    const crewCurrent = await pool.query<{ created_by: string | null }>(
      `SELECT created_by FROM crews WHERE id = $1`,
      [crewId]
    );
    if (!crewCurrent.rows[0]) return { newOwnerId: null, disbanded: true, forced: false, noOp: true };
    return { newOwnerId: crewCurrent.rows[0].created_by ?? null, disbanded: false, forced: false, noOp: true };
  }

  const cycleId: string | null = updateRes.rows[0]?.cycle_id ?? null;

  // Count declines within this cycle (cap at 5). When cycleId is known, scope by it.
  const declineCountRes = cycleId
    ? await pool.query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM crew_chief_promotions
         WHERE crew_id = $1 AND declined = true AND cycle_id = $2`,
        [crewId, cycleId]
      )
    : await pool.query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM crew_chief_promotions
         WHERE crew_id = $1 AND declined = true`,
        [crewId]
      );
  const declineCount = parseInt(declineCountRes.rows[0]?.cnt ?? "0") || 0;

  // Collect all user_ids that have already declined in this cycle
  const declinedRes = cycleId
    ? await pool.query<{ user_id: string }>(
        `SELECT user_id FROM crew_chief_promotions
         WHERE crew_id = $1 AND declined = true AND cycle_id = $2`,
        [crewId, cycleId]
      )
    : await pool.query<{ user_id: string }>(
        `SELECT user_id FROM crew_chief_promotions
         WHERE crew_id = $1 AND declined = true`,
        [crewId]
      );
  const declinedUserIds: string[] = declinedRes.rows.map((r) => r.user_id);

  // Get crew name
  const crewRes = await pool.query<{ name: string; created_by: string | null }>(
    `SELECT name, created_by FROM crews WHERE id = $1`,
    [crewId]
  );
  if (!crewRes.rows[0]) return { newOwnerId: null, disbanded: true, forced: false, noOp: false };
  const crewName: string = crewRes.rows[0].name ?? "Crew";

  // All current members ordered by seniority (used for last-resort assignment)
  const membersRes = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM crew_members WHERE crew_id = $1 AND status = 'member' ORDER BY joined_at ASC`,
    [crewId]
  );
  const allMembers: string[] = membersRes.rows.map((r) => r.user_id);

  if (allMembers.length === 0) {
    // Soft-disband so an empty-members race (e.g. the hosted-start crash that caused
    // this migration) can never silently annihilate a crew.
    await pool.query(
      `UPDATE crews SET disbanded_at = NOW(), disbanded_reason = 'chief_cascade_empty' WHERE id = $1 AND disbanded_at IS NULL`,
      [crewId]
    );
    return { newOwnerId: null, disbanded: true, forced: false, noOp: false };
  }

  // When decline cap (5) is reached OR no eligible candidates remain, force-assign
  const eligibleMembers = allMembers.filter((id) => !declinedUserIds.includes(id));
  const forceAssign = declineCount >= 5 || eligibleMembers.length === 0;

  if (forceAssign) {
    // Assign the longest-standing member unconditionally (no promotion row = no accept/decline prompt)
    const assignee = allMembers[0];
    await pool.query(`UPDATE crews SET created_by = $1 WHERE id = $2`, [assignee, crewId]);
    return { newOwnerId: assignee, disbanded: false, forced: true, noOp: false };
  }

  // Pick the best candidate by total miles_logged in crew-associated runs, then fall back to seniority
  const candidateIdsParam = eligibleMembers.map((_, i) => `$${i + 2}`).join(", ");
  const runCandidateRes = await pool.query<{ user_id: string }>(
    `SELECT rp.user_id, COALESCE(SUM(rp.miles_logged), 0) AS total_miles
     FROM run_participants rp
     JOIN runs r ON r.id = rp.run_id
     WHERE r.crew_id = $1
       AND rp.user_id IN (${candidateIdsParam})
       AND rp.status IS DISTINCT FROM 'cancelled'
     GROUP BY rp.user_id
     ORDER BY total_miles DESC
     LIMIT 1`,
    [crewId, ...eligibleMembers]
  );

  // Use run-distance winner if available; fall back to longest-standing member among eligible
  const nextOwnerId: string =
    runCandidateRes.rows[0]?.user_id ?? eligibleMembers[0];

  await pool.query(`UPDATE crews SET created_by = $1 WHERE id = $2`, [nextOwnerId, crewId]);
  await pool.query(
    `INSERT INTO crew_chief_promotions (crew_id, user_id, crew_name, cycle_id)
     VALUES ($1, $2, $3, $4)`,
    [crewId, nextOwnerId, crewName, cycleId]
  );
  return { newOwnerId: nextOwnerId, disbanded: false, forced: false, noOp: false };
}

export async function storeEmailVerificationCode(userId: string, code: string) {
  const expires = new Date(Date.now() + 30 * 60 * 1000); // 30 min
  await pool.query(
    `UPDATE users SET email_verification_code = $1, email_verification_expires = $2 WHERE id = $3`,
    [code, expires, userId]
  );
}

export async function verifyEmailCode(userId: string, code: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT email_verification_code, email_verification_expires FROM users WHERE id = $1`,
    [userId]
  );
  const row = res.rows[0];
  if (!row) return false;
  if (row.email_verification_code !== code) return false;
  if (!row.email_verification_expires || new Date(row.email_verification_expires) < new Date()) return false;
  await pool.query(
    `UPDATE users SET email_verified = true, email_verification_code = NULL, email_verification_expires = NULL WHERE id = $1`,
    [userId]
  );
  return true;
}

export async function updateUserEmailForVerification(userId: string, newEmail: string) {
  const existing = await pool.query(`SELECT id FROM users WHERE email = $1 AND id != $2`, [newEmail, userId]);
  if (existing.rows.length > 0) throw new Error("Email already in use");
  await pool.query(`UPDATE users SET email = $1 WHERE id = $2`, [newEmail, userId]);
}

export async function disbandCrewById(crewId: string, userId: string) {
  const crewRes = await pool.query(`SELECT created_by FROM crews WHERE id = $1 AND disbanded_at IS NULL`, [crewId]);
  if (!crewRes.rows[0]) throw new Error("Crew not found");
  if (crewRes.rows[0].created_by !== userId) throw new Error("Only the creator can disband this crew");
  // Soft-disband — row retained for audit + restore.
  await pool.query(
    `UPDATE crews SET disbanded_at = NOW(), disbanded_by = $2, disbanded_reason = 'owner_disband' WHERE id = $1 AND disbanded_at IS NULL`,
    [crewId, userId]
  );
}

// Admin / ops: restore a soft-disbanded crew. Idempotent.
export async function restoreDisbandedCrew(crewId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE crews SET disbanded_at = NULL, disbanded_by = NULL, disbanded_reason = NULL
     WHERE id = $1 AND disbanded_at IS NOT NULL RETURNING id`,
    [crewId]
  );
  return r.rows.length > 0;
}

export async function getCrewRuns(crewId: string) {
  const res = await pool.query(
    `SELECT r.*, u.name AS host_name, u.photo_url AS host_photo,
       (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) AS participant_count
     FROM runs r
     JOIN users u ON u.id = r.host_id
     WHERE r.crew_id = $1
       AND r.date > NOW()
     ORDER BY r.date ASC`,
    [crewId]
  );
  return res.rows;
}

export async function getCrewRunHistory(crewId: string) {
  const res = await pool.query(
    `SELECT r.id, r.title, r.date, r.timezone, r.min_distance, r.activity_type, r.host_id,
            u.name AS host_name,
            COALESCE(
              AVG(rp.final_pace) FILTER (WHERE rp.is_present = true AND rp.final_pace IS NOT NULL AND (rp.abandoned IS NULL OR rp.abandoned = false)),
              0
            ) AS avg_attendee_pace,
            COUNT(rp.user_id) FILTER (WHERE rp.is_present = true AND (rp.abandoned IS NULL OR rp.abandoned = false)) AS attendee_count
     FROM runs r
     JOIN users u ON u.id = r.host_id
     LEFT JOIN run_participants rp ON rp.run_id = r.id
     WHERE r.crew_id = $1
       AND r.date < NOW()
     GROUP BY r.id, r.timezone, u.name
     ORDER BY r.date DESC
     LIMIT 20`,
    [crewId]
  );
  return res.rows;
}

// ─── Crew Achievements ────────────────────────────────────────────────────────

export async function getCrewStats(crewId: string) {
  const res = await pool.query(
    `SELECT
       COALESCE(SUM(rp.final_distance), 0) AS total_miles,
       COUNT(DISTINCT r.id) FILTER (WHERE EXISTS (
         SELECT 1 FROM run_participants rp2
         WHERE rp2.run_id = r.id AND rp2.is_present = true
       )) AS total_events,
       (SELECT COUNT(*) FROM crew_members WHERE crew_id = $1 AND status = 'member') AS total_members
     FROM runs r
     LEFT JOIN run_participants rp ON rp.run_id = r.id AND rp.final_distance IS NOT NULL AND rp.final_distance > 0
       AND (rp.abandoned IS NULL OR rp.abandoned = false)
     WHERE r.crew_id = $1 AND r.date < NOW()`,
    [crewId]
  );
  return {
    totalMiles: parseFloat(res.rows[0]?.total_miles ?? "0"),
    totalEvents: parseInt(res.rows[0]?.total_events ?? "0", 10),
    totalMembers: parseInt(res.rows[0]?.total_members ?? "0", 10),
  };
}

export async function getCrewAchievements(crewId: string) {
  const [achievements, stats] = await Promise.all([
    pool.query(
      `SELECT * FROM crew_achievements WHERE crew_id = $1 ORDER BY achieved_at ASC`,
      [crewId]
    ),
    getCrewStats(crewId),
  ]);
  return { achievements: achievements.rows, stats };
}

export async function checkAndAwardCrewAchievements(crewId: string): Promise<string[]> {
  try {
    const stats = await getCrewStats(crewId);
    const newKeys: string[] = [];

    const MILESTONES = [
      { key: "miles_50", category: "miles", threshold: 50, label: "50 Miles", msg: "🏅 The crew just hit 50 miles together! Keep running!" },
      { key: "miles_100", category: "miles", threshold: 100, label: "100 Miles", msg: "🏅 100 miles together — incredible!" },
      { key: "miles_250", category: "miles", threshold: 250, label: "250 Miles", msg: "🏅 250 miles as a crew. Unstoppable!" },
      { key: "miles_500", category: "miles", threshold: 500, label: "500 Miles", msg: "🔥 500 miles! The crew is on fire!" },
      { key: "miles_1000", category: "miles", threshold: 1000, label: "1,000 Miles", msg: "🏆 1,000 crew miles! Legendary!" },
      { key: "miles_2500", category: "miles", threshold: 2500, label: "2,500 Miles", msg: "🏆 2,500 crew miles. Elite status!" },
      { key: "miles_5000", category: "miles", threshold: 5000, label: "5,000 Miles", msg: "🏆 5,000 miles together — you're history!" },
      { key: "events_1", category: "events", threshold: 1, label: "First Run", msg: "🎯 First crew event complete! The journey begins." },
      { key: "events_5", category: "events", threshold: 5, label: "5 Events", msg: "🎉 5 events completed as a crew!" },
      { key: "events_10", category: "events", threshold: 10, label: "10 Events", msg: "🎉 10 crew events! You're building something special." },
      { key: "events_25", category: "events", threshold: 25, label: "25 Events", msg: "🎉 25 crew events — keep the streak alive!" },
      { key: "events_50", category: "events", threshold: 50, label: "50 Events", msg: "🏆 50 events as a crew. Legendary dedication!" },
      { key: "events_100", category: "events", threshold: 100, label: "100 Events", msg: "🏆 100 crew events! Hall of fame crew!" },
      { key: "members_5", category: "members", threshold: 5, label: "5 Members", msg: "👥 5 members strong! The squad is growing." },
      { key: "members_10", category: "members", threshold: 10, label: "10 Members", msg: "👥 10 crew members! Squad goals achieved." },
      { key: "members_25", category: "members", threshold: 25, label: "25 Members", msg: "👥 25 members! You're building a real community." },
      { key: "members_50", category: "members", threshold: 50, label: "50 Members", msg: "👥 50 crew members — that's a movement!" },
    ];

    // T2.11: batch new unlocks into a single milestone message instead of one
    // crew_message (and one push) per milestone. 5 unlocks at once = 1 push.
    const unlockedMessages: string[] = [];
    for (const m of MILESTONES) {
      const value =
        m.category === "miles" ? stats.totalMiles :
        m.category === "events" ? stats.totalEvents :
        stats.totalMembers;

      if (value < m.threshold) continue;

      const existing = await pool.query(
        `SELECT id FROM crew_achievements WHERE crew_id = $1 AND achievement_key = $2`,
        [crewId, m.key]
      );
      if (existing.rows.length > 0) continue;

      await pool.query(
        `INSERT INTO crew_achievements (crew_id, achievement_key, achieved_value) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [crewId, m.key, value]
      );
      unlockedMessages.push(m.msg);
      newKeys.push(m.key);
    }

    if (unlockedMessages.length > 0) {
      const combined = unlockedMessages.length === 1
        ? unlockedMessages[0]
        : `🏆 ${unlockedMessages.length} crew milestones unlocked!\n\n${unlockedMessages.map((s) => `• ${s.replace(/^[^\s]+ /, "")}`).join("\n")}`;
      await pool.query(
        `INSERT INTO crew_messages (crew_id, sender_name, message, message_type)
         VALUES ($1, 'PaceUp', $2, 'milestone')`,
        [crewId, combined]
      );
    }

    return newKeys;
  } catch (_) {
    return [];
  }
}

export async function searchCrews(userId: string, query: string, friendsOnly: boolean) {
  if (friendsOnly) {
    const res = await pool.query(
      `SELECT DISTINCT c.*,
         (SELECT COUNT(*) FROM crew_members WHERE crew_id = c.id AND status = 'member') AS member_count,
         u.name AS created_by_name,
         EXISTS(SELECT 1 FROM crew_members WHERE crew_id = c.id AND user_id = $1 AND status = 'member') AS is_member,
         EXISTS(SELECT 1 FROM crew_members WHERE crew_id = c.id AND user_id = $1 AND status = 'pending') AS has_requested
       FROM crews c
       JOIN crew_members cm2 ON cm2.crew_id = c.id AND cm2.status = 'member'
       JOIN friends f ON (
         (f.requester_id = $1 AND f.addressee_id = cm2.user_id) OR
         (f.addressee_id = $1 AND f.requester_id = cm2.user_id)
       )
       LEFT JOIN users u ON u.id = c.created_by
       WHERE f.status = 'accepted'
         AND cm2.user_id != $1
         ${query ? "AND LOWER(c.name) LIKE $2" : ""}
       ORDER BY member_count DESC
       LIMIT 30`,
      query ? [userId, `%${query.toLowerCase()}%`] : [userId]
    );
    return res.rows;
  }
  if (!query.trim()) return [];
  const res = await pool.query(
    `SELECT c.*,
       (SELECT COUNT(*) FROM crew_members WHERE crew_id = c.id AND status = 'member') AS member_count,
       u.name AS created_by_name,
       EXISTS(SELECT 1 FROM crew_members WHERE crew_id = c.id AND user_id = $1 AND status = 'member') AS is_member,
       EXISTS(SELECT 1 FROM crew_members WHERE crew_id = c.id AND user_id = $1 AND status = 'pending') AS has_requested
     FROM crews c
     LEFT JOIN users u ON u.id = c.created_by
     WHERE LOWER(c.name) LIKE $2
     ORDER BY member_count DESC
     LIMIT 30`,
    [userId, `%${query.toLowerCase()}%`]
  );
  return res.rows;
}

export async function getCrewMemberCount(crewId: string): Promise<number> {
  const res = await pool.query(
    `SELECT COUNT(*) as cnt FROM crew_members WHERE crew_id = $1 AND status = 'member'`,
    [crewId]
  );
  return parseInt(res.rows[0].cnt, 10);
}

export async function getCrewMemberCap(crewId: string): Promise<number> {
  const res = await pool.query(
    `SELECT subscription_tier, member_cap_override FROM crews WHERE id = $1`,
    [crewId]
  );
  if (!res.rows[0]) return 100;
  const { subscription_tier, member_cap_override } = res.rows[0];
  if (member_cap_override) return member_cap_override;
  if (subscription_tier === 'growth' || subscription_tier === 'both') return 999999;
  return 100;
}

export async function updateCrewSubscription(crewId: string, tier: string) {
  await pool.query(
    `UPDATE crews SET subscription_tier = $2 WHERE id = $1`,
    [crewId, tier]
  );
}

export async function getCrewSubscriptionStatus(crewId: string) {
  const res = await pool.query(
    `SELECT subscription_tier, member_cap_override FROM crews WHERE id = $1`,
    [crewId]
  );
  if (!res.rows[0]) return null;
  const memberCount = await getCrewMemberCount(crewId);
  const cap = await getCrewMemberCap(crewId);
  return {
    subscription_tier: res.rows[0].subscription_tier || 'none',
    member_cap_override: res.rows[0].member_cap_override,
    member_count: memberCount,
    member_cap: cap,
    at_cap: memberCount >= cap,
  };
}

interface SuggestedCrewRow {
  id: string;
  name: string;
  emoji: string;
  description: string | null;
  run_style: string | null;
  home_metro: string | null;
  home_state: string | null;
  image_url: string | null;
  member_count: string;
  created_by_name: string;
  recent_activity: string;
  is_boosted: boolean;
  boost_factor: string;
  metro_bonus: string;
  state_bonus: string;
  run_style_bonus: string;
  sub_tier: string;
}

export async function getSuggestedCrews(userId: string, limit = 10): Promise<SuggestedCrewRow[]> {
  const userRes = await pool.query(
    `SELECT home_metro, home_state,
       (SELECT r.run_style FROM runs r WHERE r.host_id = $1 AND r.run_style IS NOT NULL GROUP BY r.run_style ORDER BY COUNT(*) DESC LIMIT 1) AS preferred_run_style
     FROM users WHERE id = $1`,
    [userId]
  );
  const userMetro = userRes.rows[0]?.home_metro || null;
  const userState = userRes.rows[0]?.home_state || null;
  const userRunStyle = userRes.rows[0]?.preferred_run_style || null;

  const fetchLimit = limit * 3;
  const res = await pool.query(
    `SELECT c.*,
       (SELECT COUNT(*) FROM crew_members WHERE crew_id = c.id AND status = 'member') AS member_count,
       u.name AS created_by_name,
       c.image_url,
       (SELECT COUNT(DISTINCT r.id) FROM runs r WHERE r.crew_id = c.id AND r.is_completed = true AND r.date > NOW() - INTERVAL '30 days') AS recent_activity,
       CASE WHEN c.subscription_tier IN ('discovery_boost', 'both') THEN true ELSE false END AS is_boosted,
       CASE WHEN c.subscription_tier IN ('discovery_boost', 'both') THEN 1.3 ELSE 1.0 END AS boost_factor,
       CASE WHEN c.home_metro = $2 AND $2 IS NOT NULL THEN 20 ELSE 0 END AS metro_bonus,
       CASE WHEN c.home_state = $3 AND $3 IS NOT NULL THEN 10 ELSE 0 END AS state_bonus,
       CASE WHEN c.run_style = $4 AND $4 IS NOT NULL THEN 15 ELSE 0 END AS run_style_bonus,
       COALESCE(c.subscription_tier, 'none') AS sub_tier
     FROM crews c
     LEFT JOIN users u ON u.id = c.created_by
     WHERE c.disbanded_at IS NULL
       AND NOT EXISTS (
       SELECT 1 FROM crew_members cm WHERE cm.crew_id = c.id AND cm.user_id = $1
     )
     ORDER BY
       (CASE WHEN c.subscription_tier IN ('discovery_boost', 'both') THEN 1.3 ELSE 1.0 END) *
       (
         (SELECT COUNT(DISTINCT r.id) FROM runs r WHERE r.crew_id = c.id AND r.is_completed = true AND r.date > NOW() - INTERVAL '30 days') * 10 +
         (SELECT COUNT(*) FROM crew_members WHERE crew_id = c.id AND status = 'member') * 2 +
         CASE WHEN c.home_metro = $2 AND $2 IS NOT NULL THEN 20 ELSE 0 END +
         CASE WHEN c.home_state = $3 AND $3 IS NOT NULL THEN 10 ELSE 0 END +
         CASE WHEN c.run_style = $4 AND $4 IS NOT NULL THEN 15 ELSE 0 END
       ) DESC
     LIMIT $5`,
    [userId, userMetro, userState, userRunStyle, fetchLimit]
  );

  const rows: SuggestedCrewRow[] = res.rows;
  const boostedTiers = ['discovery_boost', 'both'];
  const freeCrews = rows.filter(r => !boostedTiers.includes(r.sub_tier));
  const boostedCrews = rows.filter(r => boostedTiers.includes(r.sub_tier));

  const minFreeSlots = Math.ceil(limit / 2);
  const freeToAdd = freeCrews.slice(0, Math.max(minFreeSlots, limit - boostedCrews.length));
  const boostedToAdd = boostedCrews.slice(0, limit - freeToAdd.length);

  const result: SuggestedCrewRow[] = [];
  let fi = 0, bi = 0;
  for (let i = 0; i < limit && (fi < freeToAdd.length || bi < boostedToAdd.length); i++) {
    if (bi < boostedToAdd.length && fi >= minFreeSlots) {
      result.push(boostedToAdd[bi++]);
    } else if (fi < freeToAdd.length) {
      result.push(freeToAdd[fi++]);
    } else if (bi < boostedToAdd.length) {
      result.push(boostedToAdd[bi++]);
    }
  }

  return result;
}

export async function getPublicCrewRuns(filters?: {
  swLat?: number; swLng?: number; neLat?: number; neLng?: number;
}, currentUserId?: string) {
  let query = `SELECT r.*, u.name as host_name, u.username as host_username, u.avg_rating as host_rating, u.rating_count as host_rating_count, u.photo_url as host_photo,
      u.marker_icon as host_marker_icon, u.hosted_runs as host_hosted_runs,
      (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) as participant_count,
      (SELECT COUNT(*) FROM planned_runs pr WHERE pr.run_id = r.id) as plan_count,
      c.name as crew_name, c.emoji as crew_emoji, c.image_url as crew_photo_url
    FROM runs r
    JOIN users u ON u.id = r.host_id
    JOIN crews c ON c.id = r.crew_id
    WHERE r.crew_id IS NOT NULL
      AND r.privacy = 'public'
      AND (r.is_active = true OR r.date > NOW() - INTERVAL '90 minutes')
      AND r.is_completed = false
      AND r.is_deleted IS NOT TRUE`;
  const params: any[] = [];
  let idx = 1;
  if (filters?.swLat !== undefined && filters.neLat !== undefined) {
    query += ` AND r.location_lat BETWEEN $${idx++} AND $${idx++}`;
    params.push(filters.swLat, filters.neLat);
  }
  if (filters?.swLng !== undefined && filters.neLng !== undefined) {
    query += ` AND r.location_lng BETWEEN $${idx++} AND $${idx++}`;
    params.push(filters.swLng, filters.neLng);
  }
  if (currentUserId) {
    query += ` AND r.host_id NOT IN (
      SELECT blocked_id FROM user_blocks WHERE blocker_id = $${idx}
      UNION
      SELECT blocker_id FROM user_blocks WHERE blocked_id = $${idx}
    )`;
    idx++;
    params.push(currentUserId);
  }
  query += ` ORDER BY r.date ASC LIMIT 100`;
  const result = await pool.query(query, params);
  return result.rows;
}

export async function requestToJoinCrew(crewId: string, userId: string) {
  const existing = await pool.query(
    `SELECT status FROM crew_members WHERE crew_id = $1 AND user_id = $2`,
    [crewId, userId]
  );
  if (existing.rows.length > 0) {
    return { error: existing.rows[0].status === "member" ? "already_member" : "already_requested" };
  }
  if (await hasCrewBlockConflict(crewId, userId)) {
    return { error: "block_conflict" };
  }
  const memberCount = await getCrewMemberCount(crewId);
  const cap = await getCrewMemberCap(crewId);
  if (memberCount >= cap) {
    return { error: "member_cap_reached" };
  }
  await pool.query(
    `INSERT INTO crew_members (crew_id, user_id, status, invited_by) VALUES ($1, $2, 'pending', $2)`,
    [crewId, userId]
  );
  return { ok: true };
}

export async function searchUsersForInvite(query: string, excludeIds: string[]) {
  const res = await pool.query(
    `SELECT id, name, username, photo_url, hosted_runs FROM users
     WHERE username ILIKE $1
       AND id != ALL($2::varchar[])
     LIMIT 10`,
    [`%${query}%`, excludeIds]
  );
  return res.rows;
}

export async function getCrewMemberPushTokensFiltered(crewId: string, notifField: string): Promise<string[]> {
  const res = await pool.query(
    `SELECT u.push_token FROM users u
     JOIN crew_members cm ON cm.user_id = u.id
     WHERE cm.crew_id = $1 AND cm.status = 'member'
       AND u.push_token IS NOT NULL
       AND u.notifications_enabled = true
       AND u.${notifField} = true`,
    [crewId]
  );
  return res.rows.map((r: any) => r.push_token);
}

export async function getFriendsWithPushTokensFiltered(userId: string, notifField: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT u.push_token
     FROM friends f
     JOIN users u ON (CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END) = u.id
     WHERE (f.requester_id = $1 OR f.addressee_id = $1)
       AND f.status = 'accepted'
       AND u.push_token IS NOT NULL
       AND u.notifications_enabled = true
       AND u.${notifField} = true`,
    [userId]
  );
  return result.rows.map((r: any) => r.push_token);
}

export async function getRunParticipantTokensFiltered(runId: string, notifField: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT u.push_token
     FROM run_participants rp
     JOIN users u ON rp.user_id = u.id
     WHERE rp.run_id = $1 AND rp.status != 'cancelled'
       AND u.push_token IS NOT NULL
       AND u.notifications_enabled = true
       AND u.${notifField} = true`,
    [runId]
  );
  return result.rows.map((r: any) => r.push_token);
}

export async function getRunPresentParticipantTokensFiltered(runId: string, notifField: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT u.push_token
     FROM run_participants rp
     JOIN users u ON rp.user_id = u.id
     WHERE rp.run_id = $1 AND rp.status != 'cancelled'
       AND rp.is_present = true
       AND u.push_token IS NOT NULL
       AND u.notifications_enabled = true
       AND u.${notifField} = true`,
    [runId]
  );
  return result.rows.map((r: any) => r.push_token);
}

export async function getRunBroadcastTokens(runId: string): Promise<string[]> {
  // T3.4 + T3.5: dedupe by user_id (one push per person even if they're both
  // RSVP'd and planned), and cap to 100 tokens to avoid blast notifications
  // for very large events. Apple/Expo throttle past ~100 anyway.
  const result = await pool.query(
    `SELECT DISTINCT ON (u.id) u.push_token
       FROM (
         SELECT user_id FROM run_participants
          WHERE run_id = $1 AND status != 'cancelled'
         UNION
         SELECT user_id FROM planned_runs WHERE run_id = $1
       ) sub
       JOIN users u ON u.id = sub.user_id
      WHERE u.push_token IS NOT NULL AND u.notifications_enabled = true
      LIMIT 100`,
    [runId]
  );
  return result.rows.map((r: any) => r.push_token);
}

export async function deleteUser(userId: string, reason: string = "user_initiated"): Promise<void> {
  // SOFT DELETE. We never hard-delete user rows or their content anymore.
  //
  // Why: a year-old account holds runs, crew memberships, chat history,
  // achievements, hosted events, friendships, saved routes — blowing all of
  // that away on a single tap (or a single bug that invokes this function)
  // is unrecoverable. The earlier hard-delete also cascaded into `crews`
  // (owner FK), which is how the Founders crew disappeared.
  //
  // New behavior:
  //   1. Stash the user's email + username into pre_delete_* columns so we
  //      can restore them exactly.
  //   2. Scrub the live email / username to `deleted-<id>@paceup.deleted` /
  //      `deleted-<short>` so the old ones are freed up for a new signup
  //      AND so nothing can match them via auth lookup.
  //   3. Clear push_token + facebook_id + phone_hash so no notification /
  //      oauth / contact-match paths treat this account as live.
  //   4. Remove remember/reset tokens so active sessions can't resume.
  //   5. Mark deleted_at = NOW() + deleted_reason. That's the only filter
  //      used by getUserBy{Id,Email,Username} — row is effectively invisible.
  //
  // Everything else (runs, crew_members, messages, host_ratings, solo_runs,
  // friends, achievements, etc.) stays on disk. restoreUser(userId) can
  // flip deleted_at back to NULL and rehydrate email/username from the
  // pre_delete_* columns, reattaching every historical record untouched.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(
      `SELECT email, username FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    if (cur.rowCount === 0) {
      await client.query("ROLLBACK");
      return;
    }
    const { email: liveEmail, username: liveUsername } = cur.rows[0];
    const short = userId.slice(0, 8);
    await client.query(
      `UPDATE users
         SET deleted_at = NOW(),
             deleted_reason = $2,
             pre_delete_email = COALESCE(pre_delete_email, $3),
             pre_delete_username = COALESCE(pre_delete_username, $4),
             email = 'deleted-' || id || '@paceup.deleted',
             username = 'deleted-' || $5,
             push_token = NULL,
             notifications_enabled = false,
             facebook_id = NULL,
             phone_hash = NULL
       WHERE id = $1`,
      [userId, reason, liveEmail, liveUsername, short]
    );
    // Kill any active session primitives so a stolen cookie or a cached
    // remember-token can't keep the account alive after delete.
    await client.query(`DELETE FROM remember_tokens WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [userId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function restoreUser(userId: string): Promise<{ restored: boolean; email?: string; username?: string }> {
  // Reverses deleteUser: flip deleted_at back to NULL and rehydrate the
  // pre_delete_* values if the original email/username aren't now in use
  // by another (new) account. If they are, we hand back control to the
  // caller so an admin can choose a new handle for the restored user.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await client.query(
      `SELECT pre_delete_email, pre_delete_username FROM users
        WHERE id = $1 AND deleted_at IS NOT NULL FOR UPDATE`,
      [userId]
    );
    if (row.rowCount === 0) {
      await client.query("ROLLBACK");
      return { restored: false };
    }
    const { pre_delete_email: email, pre_delete_username: username } = row.rows[0];
    const emailTaken = email
      ? (await client.query(`SELECT 1 FROM users WHERE email = $1 AND id <> $2 AND deleted_at IS NULL`, [email, userId])).rowCount! > 0
      : false;
    const usernameTaken = username
      ? (await client.query(`SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) AND id <> $2 AND deleted_at IS NULL`, [username, userId])).rowCount! > 0
      : false;
    if (emailTaken || usernameTaken) {
      await client.query("ROLLBACK");
      return { restored: false, email, username };
    }
    await client.query(
      `UPDATE users
         SET deleted_at = NULL,
             deleted_reason = NULL,
             email = COALESCE($2, email),
             username = COALESCE($3, username),
             pre_delete_email = NULL,
             pre_delete_username = NULL
       WHERE id = $1`,
      [userId, email, username]
    );
    await client.query("COMMIT");
    return { restored: true, email, username };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function getUsersForWeeklySummary(): Promise<{ id: string; name: string; push_token: string }[]> {
  const res = await pool.query(
    `SELECT id, name, push_token FROM users
     WHERE notifications_enabled = true
       AND notif_weekly_summary = true
       AND push_token IS NOT NULL`
  );
  return res.rows;
}

export async function getWeeklyStatsForUser(userId: string): Promise<{ runs: number; totalMi: number; totalSeconds: number }> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [soloRes, groupRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) as runs,
              COALESCE(SUM(distance_miles), 0) as total_mi,
              COALESCE(SUM(duration_seconds), 0) as total_seconds
       FROM solo_runs
       WHERE user_id = $1 AND completed = true AND created_at >= $2 AND is_deleted IS NOT TRUE`,
      [userId, since]
    ),
    pool.query(
      `SELECT COUNT(*) as runs,
              COALESCE(SUM(rp.final_distance), 0) as total_mi
       FROM run_participants rp
       JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.final_distance IS NOT NULL AND rp.final_distance > 0
         AND r.date >= $2 AND r.is_deleted IS NOT TRUE`,
      [userId, since]
    ),
  ]);
  return {
    runs: parseInt(soloRes.rows[0].runs, 10) + parseInt(groupRes.rows[0].runs, 10),
    totalMi: parseFloat(soloRes.rows[0].total_mi) + parseFloat(groupRes.rows[0].total_mi),
    totalSeconds: parseInt(soloRes.rows[0].total_seconds, 10),
  };
}

export async function getDmConversations(userId: string) {
  const res = await pool.query(
    `SELECT
       other_user.id as friend_id,
       other_user.name as friend_name,
       other_user.username as friend_username,
       other_user.photo_url as friend_photo,
       last_msg.message as last_message,
       last_msg.created_at as last_message_at,
       last_msg.sender_id as last_sender_id,
       COUNT(unread.id) as unread_count
     FROM (
       SELECT DISTINCT
         CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END as other_id
       FROM direct_messages
       WHERE sender_id = $1 OR recipient_id = $1
     ) pairs
     JOIN users other_user ON other_user.id = pairs.other_id
       AND other_user.id NOT IN (
         SELECT blocked_id FROM user_blocks WHERE blocker_id = $1
         UNION
         SELECT blocker_id FROM user_blocks WHERE blocked_id = $1
       )
     JOIN LATERAL (
       SELECT message, created_at, sender_id
       FROM direct_messages
       WHERE (sender_id = $1 AND recipient_id = pairs.other_id)
          OR (sender_id = pairs.other_id AND recipient_id = $1)
       ORDER BY created_at DESC
       LIMIT 1
     ) last_msg ON true
     LEFT JOIN direct_messages unread
       ON unread.recipient_id = $1
      AND unread.sender_id = pairs.other_id
      AND unread.read_at IS NULL
     GROUP BY other_user.id, other_user.name, other_user.username, other_user.photo_url,
              last_msg.message, last_msg.created_at, last_msg.sender_id
     ORDER BY last_msg.created_at DESC`,
    [userId]
  );
  return res.rows;
}

export async function getDmThread(userId: string, friendId: string, limit = 50) {
  const res = await pool.query(
    `SELECT dm.*, 
       sender.name as sender_name,
       sender.photo_url as sender_photo
     FROM direct_messages dm
     JOIN users sender ON sender.id = dm.sender_id
     WHERE (dm.sender_id = $1 AND dm.recipient_id = $2)
        OR (dm.sender_id = $2 AND dm.recipient_id = $1)
     ORDER BY dm.created_at DESC
     LIMIT $3`,
    [userId, friendId, limit]
  );
  return res.rows;
}

export async function sendDm(
  senderId: string,
  recipientId: string,
  message: string,
  messageType = "text",
  metadata?: Record<string, any>
) {
  const friendCheck = await pool.query(
    `SELECT id FROM friends
     WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
       AND status = 'accepted'`,
    [senderId, recipientId]
  );
  if (friendCheck.rows.length === 0) throw new Error("Not friends");
  const res = await pool.query(
    `INSERT INTO direct_messages (sender_id, recipient_id, message, message_type, metadata)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [senderId, recipientId, message, messageType, metadata ? JSON.stringify(metadata) : null]
  );
  return res.rows[0];
}

export async function markDmRead(userId: string, friendId: string) {
  await pool.query(
    `UPDATE direct_messages SET read_at = NOW()
     WHERE recipient_id = $1 AND sender_id = $2 AND read_at IS NULL`,
    [userId, friendId]
  );
}

export async function deleteDmThread(userId: string, friendId: string) {
  await pool.query(
    `DELETE FROM direct_messages
     WHERE (sender_id = $1 AND recipient_id = $2)
        OR (sender_id = $2 AND recipient_id = $1)`,
    [userId, friendId]
  );
}

export async function getDmUnreadCount(userId: string): Promise<number> {
  const res = await pool.query(
    `SELECT COUNT(*) as cnt FROM direct_messages
     WHERE recipient_id = $1 AND read_at IS NULL`,
    [userId]
  );
  return parseInt(res.rows[0].cnt, 10);
}

export async function getRecentCommunityActivity() {
  // Ladder the lookback window so the section isn't empty in quiet areas:
  // 7d → 14d → 30d → 90d → all-time. First tier with ≥6 rows wins.
  const windows: Array<{ interval: string | null; tier: string }> = [
    { interval: "7 days", tier: "recent" },
    { interval: "14 days", tier: "recent" },
    { interval: "30 days", tier: "recent" },
    { interval: "90 days", tier: "recent" },
    { interval: null, tier: "popular" },
  ];

  for (const { interval, tier } of windows) {
    const whereClause = interval
      ? `WHERE r.is_completed = true AND COALESCE(r.started_at, r.date) >= NOW() - INTERVAL '${interval}'`
      : `WHERE r.is_completed = true`;
    const res = await pool.query(`
      SELECT r.id, r.title, r.location_name, r.activity_type,
             COALESCE(r.started_at, r.date) AS completed_at,
             u.name AS host_name,
             COALESCE(r.max_distance, 0) AS max_distance,
             COUNT(DISTINCT rp.user_id) AS participant_count
      FROM runs r
      JOIN users u ON u.id = r.host_id
      LEFT JOIN run_participants rp
        ON rp.run_id = r.id AND rp.status IN ('confirmed', 'joined')
      ${whereClause}
      GROUP BY r.id, u.name
      ORDER BY (COUNT(DISTINCT rp.user_id) * 2 + COALESCE(r.max_distance, 0)) DESC,
               COALESCE(r.started_at, r.date) DESC
      LIMIT 12
    `);
    if (res.rows.length >= 6 || interval === null) {
      return {
        tier,
        window: interval ?? "all-time",
        rows: res.rows.map((row) => ({
          ...row,
          participant_count: parseInt(row.participant_count, 10),
        })),
      };
    }
  }
  return { tier: "popular", window: "all-time", rows: [] };
}

// ─── User Blocks ──────────────────────────────────────────────────────────────

export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  await pool.query(
    `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [blockerId, blockedId]
  );
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  await pool.query(
    `DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`,
    [blockerId, blockedId]
  );
}

export async function isBlockedBy(requesterId: string, targetId: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`,
    [targetId, requesterId]
  );
  return res.rows.length > 0;
}

export async function isBlocking(requesterId: string, targetId: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2`,
    [requesterId, targetId]
  );
  return res.rows.length > 0;
}

// Returns true if any existing crew member has blocked `userId`, or `userId` has blocked any existing crew member.
// Used to prevent blocked users from becoming co-members of a crew via invite or join request.
export async function hasCrewBlockConflict(crewId: string, userId: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM user_blocks ub
     JOIN crew_members cm ON (cm.user_id = ub.blocker_id OR cm.user_id = ub.blocked_id)
     WHERE cm.crew_id = $1
       AND cm.status = 'member'
       AND (ub.blocker_id = $2 OR ub.blocked_id = $2)
     LIMIT 1`,
    [crewId, userId]
  );
  return res.rows.length > 0;
}

export async function getBlockList(userId: string): Promise<string[]> {
  const res = await pool.query(
    `SELECT blocked_id FROM user_blocks WHERE blocker_id = $1`,
    [userId]
  );
  return res.rows.map((r: any) => r.blocked_id);
}

// ─── Reports & Auto-Moderation ────────────────────────────────────────────────

export async function createReport(
  reporterId: string,
  targetType: string,
  targetId: string,
  reason: string
): Promise<{ id: string; alreadyReported: boolean }> {
  // Prevent duplicate reports from same reporter
  const dup = await pool.query(
    `SELECT id FROM reports WHERE reporter_id = $1 AND target_type = $2 AND target_id = $3`,
    [reporterId, targetType, targetId]
  );
  if (dup.rows.length > 0) return { id: dup.rows[0].id, alreadyReported: true };

  const res = await pool.query(
    `INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES ($1, $2, $3, $4) RETURNING id`,
    [reporterId, targetType, targetId, reason]
  );

  await pool.query(
    `INSERT INTO audit_logs (action, actor, target_type, target_id, detail) VALUES ('report_created', $1, $2, $3, $4)`,
    [reporterId, targetType, targetId, JSON.stringify({ reason })]
  );

  // Auto-moderation: check reporter count for this target (≥3 unique reporters)
  const countRes = await pool.query(
    `SELECT COUNT(DISTINCT reporter_id) as cnt FROM reports WHERE target_type = $1 AND target_id = $2 AND resolved = false`,
    [targetType, targetId]
  );
  const cnt = parseInt(countRes.rows[0]?.cnt ?? 0);
  if (cnt >= 3) {
    if (targetType === 'user') {
      // Suspend account for 7 days
      const already = await pool.query(
        `SELECT suspended_until FROM users WHERE id = $1`,
        [targetId]
      );
      const existingSuspension = already.rows[0]?.suspended_until;
      if (!existingSuspension || new Date(existingSuspension) < new Date()) {
        const suspendUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await pool.query(
          `UPDATE users SET suspended_until = $2 WHERE id = $1`,
          [targetId, suspendUntil]
        );
        await pool.query(
          `INSERT INTO audit_logs (action, actor, target_type, target_id, detail) VALUES ('auto_suspend_7d', 'system', $1, $2, $3)`,
          [targetType, targetId, JSON.stringify({ triggerReportCount: cnt })]
        );
        // Mark reports as resolved
        await pool.query(
          `UPDATE reports SET resolved = true WHERE target_type = $1 AND target_id = $2`,
          [targetType, targetId]
        );
      }
    } else {
      // For comments/messages: hide the content by logging (UI reads this)
      await pool.query(
        `INSERT INTO audit_logs (action, actor, target_type, target_id, detail) VALUES ('auto_hide_content', 'system', $1, $2, $3) ON CONFLICT DO NOTHING`,
        [targetType, targetId, JSON.stringify({ triggerReportCount: cnt })]
      ).catch(() => {});
    }
  }

  return { id: res.rows[0].id, alreadyReported: false };
}

export async function isContentHidden(targetType: string, targetId: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM audit_logs WHERE action = 'auto_hide_content' AND target_type = $1 AND target_id = $2 LIMIT 1`,
    [targetType, targetId]
  );
  return res.rows.length > 0;
}

// ─── Public Routes (Global Map) ───────────────────────────────────────────────

type Coord = { latitude: number; longitude: number };

function rdpSimplify(pts: Coord[], epsilon: number): Coord[] {
  if (pts.length <= 2) return pts;
  let maxDist = 0;
  let maxIdx = 0;
  const start = pts[0];
  const end = pts[pts.length - 1];
  const dx = end.longitude - start.longitude;
  const dy = end.latitude - start.latitude;
  const len = Math.sqrt(dx * dx + dy * dy);
  for (let i = 1; i < pts.length - 1; i++) {
    let d: number;
    if (len === 0) {
      const ddx = pts[i].longitude - start.longitude;
      const ddy = pts[i].latitude - start.latitude;
      d = Math.sqrt(ddx * ddx + ddy * ddy);
    } else {
      const t = ((pts[i].longitude - start.longitude) * dx + (pts[i].latitude - start.latitude) * dy) / (len * len);
      const px = start.longitude + t * dx;
      const py = start.latitude + t * dy;
      const ex = pts[i].longitude - px;
      const ey = pts[i].latitude - py;
      d = Math.sqrt(ex * ex + ey * ey);
    }
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left = rdpSimplify(pts.slice(0, maxIdx + 1), epsilon);
    const right = rdpSimplify(pts.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [start, end];
}

function cleanGpsPath(pts: Coord[]): Coord[] {
  if (pts.length < 2) return pts;
  const MAX_JUMP_DEG = 0.01;
  const result: Coord[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const dlat = Math.abs(pts[i].latitude - result[result.length - 1].latitude);
    const dlng = Math.abs(pts[i].longitude - result[result.length - 1].longitude);
    if (dlat < MAX_JUMP_DEG && dlng < MAX_JUMP_DEG) result.push(pts[i]);
  }
  return result;
}

function computeRouteHash(pts: Coord[]): string {
  const step = Math.max(1, Math.floor(pts.length / 20));
  const sample = pts.filter((_, i) => i % step === 0);
  const str = sample.map(p =>
    `${Math.round(p.latitude * 1000) / 1000},${Math.round(p.longitude * 1000) / 1000}`
  ).join("|");
  return createHash("sha256").update(str).digest("hex").slice(0, 32);
}

export async function publishPublicRoute(params: {
  soloRunId: string;
  userId: string;
  rawPath: Coord[];
  activityType: string;
  distanceMiles: number;
  elevationGainFt?: number | null;
}): Promise<{ publicRouteId: string; isNew: boolean; timesCompleted: number }> {
  const { soloRunId, rawPath, activityType, distanceMiles, elevationGainFt } = params;

  const cleaned = cleanGpsPath(rawPath);
  const isRide = activityType === "ride";
  const epsilon = isRide ? 0.00018 : 0.00005;
  const simplified = rdpSimplify(cleaned, epsilon);
  if (simplified.length < 2) throw new Error("Route too short to publish");

  const hash = computeRouteHash(simplified);

  const lats = simplified.map(p => p.latitude);
  const lngs = simplified.map(p => p.longitude);
  const bboxSwLat = Math.min(...lats);
  const bboxSwLng = Math.min(...lngs);
  const bboxNeLat = Math.max(...lats);
  const bboxNeLng = Math.max(...lngs);
  const startLat = simplified[0].latitude;
  const startLng = simplified[0].longitude;

  let publicRouteId: string;
  let isNew: boolean;
  let timesCompleted: number;

  const ins = await pool.query(
    `INSERT INTO public_routes
       (route_hash, activity_type, path, distance_miles, elevation_gain_ft,
        bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, start_lat, start_lng, times_completed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0)
     ON CONFLICT (route_hash) DO NOTHING
     RETURNING id`,
    [hash, activityType, JSON.stringify(simplified), distanceMiles,
     elevationGainFt ?? null, bboxSwLat, bboxSwLng, bboxNeLat, bboxNeLng, startLat, startLng]
  );

  if (ins.rowCount && ins.rowCount > 0) {
    publicRouteId = ins.rows[0].id;
    isNew = true;
    timesCompleted = 0;
  } else {
    const existing = await pool.query(
      `SELECT id, times_completed FROM public_routes WHERE route_hash = $1`,
      [hash]
    );
    publicRouteId = existing.rows[0].id;
    isNew = false;
    timesCompleted = existing.rows[0].times_completed;
  }

  const completionResult = await pool.query(
    `INSERT INTO public_route_completions (public_route_id, solo_run_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id`,
    [publicRouteId, soloRunId]
  );

  if (completionResult.rowCount && completionResult.rowCount > 0) {
    const updated = await pool.query(
      `UPDATE public_routes SET times_completed = times_completed + 1, updated_at = NOW() WHERE id = $1 RETURNING times_completed`,
      [publicRouteId]
    );
    timesCompleted = updated.rows[0]?.times_completed ?? timesCompleted + 1;
  }

  await pool.query(
    `UPDATE solo_runs SET is_route_public = true, public_route_id = $1 WHERE id = $2`,
    [publicRouteId, soloRunId]
  );

  return { publicRouteId, isNew, timesCompleted };
}


export async function setSoloRunRoutePublic(soloRunId: string, isPublic: boolean): Promise<void> {
  await pool.query(
    `UPDATE solo_runs SET is_route_public = $1 WHERE id = $2`,
    [isPublic, soloRunId]
  );
}

export async function getMapRoutes(params: {
  swLat: number; swLng: number; neLat: number; neLng: number;
  layer?: string; limit?: number; zoom?: number;
}) {
  const { swLat, swLng, neLat, neLng, layer, limit = 500, zoom = 13 } = params;

  let activityFilter = "";
  const qParams: any[] = [swLat, neLat, swLng, neLng, limit];
  if (layer === "foot") {
    activityFilter = `AND pr.activity_type IN ('run', 'walk')`;
  } else if (layer === "ride") {
    activityFilter = `AND pr.activity_type = 'ride'`;
  }

  const res = await pool.query(`
    SELECT pr.id, pr.activity_type, pr.path, pr.distance_miles, pr.elevation_gain_ft,
           pr.times_completed, pr.bbox_sw_lat, pr.bbox_sw_lng, pr.bbox_ne_lat, pr.bbox_ne_lng,
           COALESCE(
             (SELECT COUNT(*) FROM public_route_completions prc
              WHERE prc.public_route_id = pr.id
                AND prc.completed_at >= NOW() - INTERVAL '90 days'),
             0
           ) AS recent_completions
    FROM public_routes pr
    WHERE pr.bbox_sw_lat <= $2
      AND pr.bbox_ne_lat >= $1
      AND pr.bbox_sw_lng <= $4
      AND pr.bbox_ne_lng >= $3
      ${activityFilter}
      AND EXISTS (
        SELECT 1 FROM solo_runs sr
        JOIN public_route_completions prc ON prc.solo_run_id = sr.id
        WHERE prc.public_route_id = pr.id AND sr.is_route_public = true
      )
    ORDER BY pr.times_completed DESC
    LIMIT $5
  `, qParams);

  const zoomEpsilon = zoom >= 14 ? 0 : zoom >= 12 ? 0.00005 : zoom >= 10 ? 0.0002 : 0.0008;

  return res.rows.map((r: any) => {
    let path = typeof r.path === "string" ? JSON.parse(r.path) : r.path;
    // Always normalize to {latitude, longitude} so the client Polyline always renders,
    // regardless of what key shape was stored. Only simplify if epsilon > 0.
    if (Array.isArray(path)) {
      path = path.map((p: any) => ({ latitude: p.latitude ?? p.lat, longitude: p.longitude ?? p.lng }));
      if (zoomEpsilon > 0 && path.length > 2) {
        path = rdpSimplify(path, zoomEpsilon);
      }
    }
    return {
      id: r.id,
      activity_type: r.activity_type,
      path,
      distance_miles: r.distance_miles,
      elevation_gain_ft: r.elevation_gain_ft,
      times_completed: parseInt(r.times_completed),
      recent_completions: parseInt(r.recent_completions),
    };
  });
}

export async function getPublicRouteDetail(routeId: string) {
  const res = await pool.query(
    `SELECT pr.id, pr.activity_type, pr.path, pr.distance_miles, pr.elevation_gain_ft,
            pr.times_completed,
            COALESCE(
              (SELECT COUNT(*) FROM public_route_completions prc
               WHERE prc.public_route_id = pr.id
                 AND prc.completed_at >= NOW() - INTERVAL '90 days'),
              0
            ) AS recent_completions,
            (SELECT json_agg(json_build_object('dow', dow_val, 'hour', hour_val, 'count', cnt))
             FROM (
               SELECT EXTRACT(DOW FROM completed_at)::int AS dow_val,
                      EXTRACT(HOUR FROM completed_at)::int AS hour_val,
                      COUNT(*) AS cnt
               FROM public_route_completions
               WHERE public_route_id = pr.id
               GROUP BY dow_val, hour_val
             ) sub
            ) AS busy_matrix
     FROM public_routes pr
     WHERE pr.id = $1`,
    [routeId]
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];

  const recentCompletions = parseInt(row.recent_completions);
  let busynessLabel: string;
  if (recentCompletions <= 5) busynessLabel = "green";
  else if (recentCompletions <= 20) busynessLabel = "yellow";
  else if (recentCompletions <= 50) busynessLabel = "orange";
  else busynessLabel = "red";

  const busy_matrix_7x24: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const busy_by_dow: number[] = [0, 0, 0, 0, 0, 0, 0];
  if (row.busy_matrix) {
    const items = Array.isArray(row.busy_matrix) ? row.busy_matrix : JSON.parse(row.busy_matrix);
    for (const item of items) {
      const dow = parseInt(item.dow ?? 0);
      const hour = parseInt(item.hour ?? 0);
      const cnt = parseInt(item.count ?? 0);
      if (dow >= 0 && dow <= 6 && hour >= 0 && hour <= 23) {
        busy_matrix_7x24[dow][hour] = cnt;
        busy_by_dow[dow] += cnt;
      }
    }
  }

  return {
    id: row.id,
    activity_type: row.activity_type,
    path: typeof row.path === "string" ? JSON.parse(row.path) : row.path,
    distance_miles: row.distance_miles,
    elevation_gain_ft: row.elevation_gain_ft,
    times_completed: parseInt(row.times_completed),
    recent_completions: recentCompletions,
    busyness_label: busynessLabel,
    busy_matrix_7x24,
    busy_by_dow,
  };
}

export async function getPublicRouteIdForSoloRun(soloRunId: string): Promise<string | null> {
  const res = await pool.query(
    `SELECT public_route_id FROM solo_runs WHERE id = $1`,
    [soloRunId]
  );
  return res.rows[0]?.public_route_id ?? null;
}
