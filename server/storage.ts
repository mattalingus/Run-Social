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

  const THRESHOLD_KM = 0.04; // 40 m proximity to call it a "return"
  const MIN_GAP_KM = 0.3;    // must have traveled ≥300m since the anchor point

  // For each point i, scan earlier anchor points j where gap(j→i) ≥ MIN_GAP_KM
  // Find the earliest i where point i returns within THRESHOLD_KM of some j < i
  let closureAt = -1; // index i where closure first occurs
  let closureAnchor = -1; // index j of the anchor point

  outer:
  for (let i = 3; i < coords.length; i++) {
    for (let j = 0; j < i; j++) {
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
    CREATE UNIQUE INDEX IF NOT EXISTS run_participants_run_user_unique ON run_participants (run_id, user_id);

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

    ALTER TABLE crew_messages ADD COLUMN IF NOT EXISTS message_type TEXT DEFAULT 'text';
    ALTER TABLE crew_messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;
    ALTER TABLE crew_members ADD COLUMN IF NOT EXISTS chat_muted BOOLEAN DEFAULT false;
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
        ALTER TABLE crews ADD COLUMN IF NOT EXISTS last_overtake_notif_at TIMESTAMP DEFAULT NULL;
        ALTER TABLE crews ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'none';
        ALTER TABLE crews ADD COLUMN IF NOT EXISTS member_cap_override INTEGER DEFAULT NULL;

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
  `);

  const dummyCheck = await pool.query(`SELECT COUNT(*) FROM users WHERE email LIKE 'dummy-%@paceup.dev'`);
  if (parseInt(dummyCheck.rows[0].count) > 0) {
    await pool.query(`DELETE FROM run_participants WHERE run_id IN (SELECT id FROM runs WHERE host_id IN (SELECT id FROM users WHERE email LIKE 'dummy-%@paceup.dev'))`);
    await pool.query(`DELETE FROM bookmarked_runs WHERE run_id IN (SELECT id FROM runs WHERE host_id IN (SELECT id FROM users WHERE email LIKE 'dummy-%@paceup.dev'))`);
    await pool.query(`DELETE FROM planned_runs WHERE run_id IN (SELECT id FROM runs WHERE host_id IN (SELECT id FROM users WHERE email LIKE 'dummy-%@paceup.dev'))`);
    await pool.query(`DELETE FROM runs WHERE host_id IN (SELECT id FROM users WHERE email LIKE 'dummy-%@paceup.dev')`);
    await pool.query(`DELETE FROM users WHERE email LIKE 'dummy-%@paceup.dev'`);
    console.log("[cleanup] Removed dummy seed accounts and their runs");
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
     WHERE r.host_id = $1 AND rp.status = 'pending'`,
    [userId]
  );

  // Upcoming confirmed runs within the next 24 hours
  const eventReminders = await pool.query(
    `SELECT r.id, r.title, r.date, r.location_name, u.name as host_name, r.activity_type
     FROM run_participants rp
     JOIN runs r ON r.id = rp.run_id
     JOIN users u ON u.id = r.host_id
     WHERE rp.user_id = $1
       AND rp.status = 'confirmed'
       AND r.host_id != $1
       AND r.date BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
       AND (r.is_active = false OR r.is_active IS NULL)
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
     ORDER BY r.started_at DESC`,
    [userId]
  );

  // Recent distance PRs (within 72h, must beat a prior run)
  const distPRs = await pool.query(
    `SELECT sr.id, sr.distance_miles, sr.date, sr.activity_type
     FROM solo_runs sr
     WHERE sr.user_id = $1
       AND sr.completed = true
       AND sr.is_deleted IS NOT TRUE
       AND sr.date >= NOW() - INTERVAL '72 hours'
       AND EXISTS (
         SELECT 1 FROM solo_runs s3
         WHERE s3.user_id = $1 AND s3.completed = true
           AND s3.is_deleted IS NOT TRUE AND s3.id != sr.id AND s3.date < sr.date
       )
       AND sr.distance_miles > COALESCE((
         SELECT MAX(s2.distance_miles) FROM solo_runs s2
         WHERE s2.user_id = $1 AND s2.completed = true
           AND s2.is_deleted IS NOT TRUE AND s2.id != sr.id AND s2.date < sr.date
       ), 0)
     ORDER BY sr.date DESC
     LIMIT 1`,
    [userId]
  );

  // Recent pace PRs (within 72h, must beat a prior qualifying run)
  const pacePRs = await pool.query(
    `SELECT sr.id, sr.pace_min_per_mile, sr.date, sr.activity_type
     FROM solo_runs sr
     WHERE sr.user_id = $1
       AND sr.completed = true
       AND sr.is_deleted IS NOT TRUE
       AND sr.distance_miles > 0.5
       AND sr.pace_min_per_mile >= 2.0
       AND sr.date >= NOW() - INTERVAL '72 hours'
       AND EXISTS (
         SELECT 1 FROM solo_runs s3
         WHERE s3.user_id = $1 AND s3.completed = true
           AND s3.is_deleted IS NOT TRUE AND s3.id != sr.id
           AND s3.distance_miles > 0.5 AND s3.pace_min_per_mile >= 2.0
           AND s3.date < sr.date
       )
       AND sr.pace_min_per_mile < COALESCE((
         SELECT MIN(s2.pace_min_per_mile) FROM solo_runs s2
         WHERE s2.user_id = $1 AND s2.completed = true
           AND s2.is_deleted IS NOT TRUE AND s2.id != sr.id
           AND s2.distance_miles > 0.5 AND s2.pace_min_per_mile >= 2.0
           AND s2.date < sr.date
       ), 999)
     ORDER BY sr.date DESC
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
        data: { run_id: r.id, host_name: r.host_name, location_name: r.location_name, date: r.date, activity_type: r.activity_type },
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
  const res = await pool.query(`SELECT * FROM users WHERE LOWER(username) = LOWER($1)`, [username]);
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
  const result = await pool.query(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);
  return result.rows[0] || null;
}

export async function getUserById(id: string) {
  const result = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
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
  savedPathId?: string | null;
  paceGroups?: { label: string; minPace: number; maxPace: number }[] | null;
}) {
  const inviteToken = data.privacy === "private"
    ? Math.random().toString(36).substring(2, 10).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase()
    : null;
  const activityType = data.activityType === "ride" ? "ride" : data.activityType === "walk" ? "walk" : "run";
  const paceGroupsJson = data.paceGroups && data.paceGroups.length > 0 ? JSON.stringify(data.paceGroups) : null;
  const result = await pool.query(
    `INSERT INTO runs (host_id, title, description, privacy, date, location_lat, location_lng, location_name, min_distance, max_distance, min_pace, max_pace, tags, max_participants, invite_token, invite_password, is_strict, run_style, activity_type, crew_id, saved_path_id, pace_groups)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
    [data.hostId, data.title, data.description || null, data.privacy, data.date, data.locationLat, data.locationLng, data.locationName, data.minDistance, data.maxDistance, data.minPace, data.maxPace, data.tags, data.maxParticipants, inviteToken, data.invitePassword || null, data.isStrict ?? false, data.runStyle || null, activityType, data.crewId || null, data.savedPathId || null, paceGroupsJson]
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
     WHERE id != $1 AND (username ILIKE $2 OR name ILIKE $2)
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
  let query = `SELECT r.id, r.title, r.date, r.location_lat, r.location_lng, r.location_name,
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
    AND r.crew_id IS NULL`;
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
  let query = `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.rating_count as host_rating_count, u.photo_url as host_photo, u.marker_icon as host_marker_icon, u.hosted_runs as host_hosted_runs,
    (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) as participant_count,
    (SELECT COUNT(*) FROM planned_runs pr WHERE pr.run_id = r.id) as plan_count,
    false as is_locked
  FROM runs r
  JOIN users u ON u.id = r.host_id
  JOIN run_invites ri ON ri.run_id = r.id AND ri.invitee_id = $1
  WHERE r.privacy = 'private' AND r.date > NOW() AND r.is_completed = false AND r.crew_id IS NULL`;
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
  let query = `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.rating_count as host_rating_count, u.photo_url as host_photo,
      u.marker_icon as host_marker_icon, u.hosted_runs as host_hosted_runs,
      (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) as participant_count,
      false as is_locked,
      c.image_url as crew_photo_url
    FROM runs r
    JOIN users u ON u.id = r.host_id
    JOIN crew_members cm ON cm.crew_id = r.crew_id AND cm.user_id = $1 AND cm.status = 'member'
    LEFT JOIN crews c ON c.id = r.crew_id
    WHERE r.crew_id IS NOT NULL AND (r.is_active = true OR r.date > NOW() - INTERVAL '90 minutes') AND r.is_completed = false`;
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
    `SELECT r.*, u.name as host_name FROM runs r JOIN users u ON u.id = r.host_id WHERE r.invite_token = $1`,
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
}) {
  const result = await pool.query(
    `INSERT INTO solo_runs (user_id, title, date, distance_miles, pace_min_per_mile, duration_seconds, completed, planned, notes, route_path, activity_type, saved_path_id, mile_splits, elevation_gain_ft, step_count, move_time_seconds)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
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
  await pool.query(
    `UPDATE solo_runs SET is_deleted = true WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
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
}) {
  let query = `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.rating_count as host_rating_count, u.photo_url as host_photo, u.marker_icon as host_marker_icon, u.hosted_runs as host_hosted_runs,
    (1 + (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status IS DISTINCT FROM 'cancelled' AND rp.user_id != r.host_id)) as participant_count,
    (SELECT COUNT(*) FROM planned_runs pr WHERE pr.run_id = r.id) as plan_count
    FROM runs r JOIN users u ON u.id = r.host_id
    WHERE r.privacy = 'public' AND (r.is_active = true OR r.date > NOW() - INTERVAL '90 minutes') AND r.is_completed = false AND r.crew_id IS NULL AND r.is_deleted IS NOT TRUE`;
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
  query += ` ORDER BY r.date ASC LIMIT 200`;
  const result = await pool.query(query, params);
  return result.rows;
}

export async function getRunById(id: string) {
  const result = await pool.query(
    `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.rating_count as host_rating_count,
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
    `SELECT r.*, u.name as host_name,
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
     WHERE (r.host_id = $1 OR r.id IN (SELECT run_id FROM run_participants WHERE user_id = $1 AND status != 'cancelled'))
       AND r.is_deleted IS NOT TRUE
       AND (
         r.date > NOW()
         OR r.host_id = $1
         OR EXISTS (SELECT 1 FROM run_participants rp4 WHERE rp4.run_id = r.id AND rp4.user_id = $1 AND rp4.status != 'cancelled')
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
      `SELECT id, is_deleted, is_completed, max_participants FROM runs WHERE id = $1 FOR UPDATE`,
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
        // Capacity check before re-activating a cancelled participant
        if (maxP !== null) {
          const countRes = await client.query(
            `SELECT COUNT(*) FROM run_participants WHERE run_id = $1 AND status IN ('joined', 'confirmed')`,
            [runId]
          );
          if (parseInt(countRes.rows[0].count, 10) >= maxP) {
            await client.query('ROLLBACK');
            throw new Error("EVENT_FULL");
          }
        }
        await client.query(
          `UPDATE run_participants SET status = 'joined', pace_group_label = $3 WHERE run_id = $1 AND user_id = $2`,
          [runId, userId, paceGroupLabel || null]
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

    // New participant — atomic conditional INSERT: only inserts when capacity allows
    const insertRes = await client.query(
      `INSERT INTO run_participants (run_id, user_id, pace_group_label)
       SELECT $1, $2, $3
       WHERE $4::int IS NULL
          OR (
            SELECT COUNT(*) FROM run_participants
            WHERE run_id = $1 AND status IN ('joined', 'confirmed')
          ) < $4::int
       RETURNING *`,
      [runId, userId, paceGroupLabel || null, maxP]
    );
    if (!insertRes.rows.length) {
      await client.query('ROLLBACK');
      throw new Error("EVENT_FULL");
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

export async function cancelRun(runId: string, userId: string) {
  const run = await pool.query(`SELECT * FROM runs WHERE id = $1`, [runId]);
  if (!run.rows.length) throw new Error("Run not found");
  if (run.rows[0].host_id !== userId) throw new Error("Only the host can cancel this run");
  const tokens = await getRunParticipantTokens(runId);
  await pool.query(`DELETE FROM run_tracking_points WHERE run_id = $1`, [runId]);
  await pool.query(`DELETE FROM planned_runs WHERE run_id = $1`, [runId]);
  await pool.query(`DELETE FROM run_participants WHERE run_id = $1`, [runId]);
  await pool.query(`DELETE FROM run_invites WHERE run_id = $1`, [runId]);
  await pool.query(`DELETE FROM bookmarked_runs WHERE run_id = $1`, [runId]);
  await pool.query(`DELETE FROM run_photos WHERE run_id = $1`, [runId]);
  await pool.query(`DELETE FROM runs WHERE id = $1`, [runId]);
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

// ─── Live Group Run ───────────────────────────────────────────────────────────

export async function startGroupRun(runId: string, hostId: string) {
  const runRes = await pool.query(`SELECT * FROM runs WHERE id = $1`, [runId]);
  if (!runRes.rows.length) throw new Error("Run not found");
  const run = runRes.rows[0];
  if (run.host_id !== hostId) throw new Error("Only the host can start the run");
  if (run.is_active) throw new Error("Run already started");

  await pool.query(`UPDATE runs SET is_active = true, started_at = NOW() WHERE id = $1`, [runId]);

  // Guarantee the host has a participant row with is_present = true from the moment the run starts
  await pool.query(
    `INSERT INTO run_participants (run_id, user_id, status, is_present)
     VALUES ($1, $2, 'joined', true)
     ON CONFLICT (run_id, user_id) DO UPDATE SET is_present = true`,
    [runId, hostId]
  );

  const latestPings = await pool.query(
    `SELECT DISTINCT ON (user_id) user_id, latitude, longitude
     FROM run_tracking_points WHERE run_id = $1 ORDER BY user_id, recorded_at DESC`,
    [runId]
  );
  for (const ping of latestPings.rows) {
    const dist = haversineKm(ping.latitude, ping.longitude, run.location_lat, run.location_lng);
    if (dist <= 0.1524) {
      await pool.query(
        `UPDATE run_participants SET is_present = true WHERE run_id = $1 AND user_id = $2 AND status != 'cancelled'`,
        [runId, ping.user_id]
      );
    }
  }
  return getRunById(runId);
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

  const runRes = await pool.query(`SELECT host_id, location_lat, location_lng, is_active FROM runs WHERE id = $1`, [runId]);
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

    if (within500ft || isHost) {
      const upsertRes = await pool.query(
        `INSERT INTO run_participants (run_id, user_id, status, is_present)
         VALUES ($1, $2, 'joined', true)
         ON CONFLICT (run_id, user_id) DO UPDATE SET is_present = true
         WHERE run_participants.status != 'cancelled'
         RETURNING run_id`,
        [runId, userId]
      );
      isPresent = (upsertRes.rowCount ?? 0) > 0;
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

export async function getLiveRunState(runId: string) {
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
    const lastPingAge = r.recorded_at ? now - new Date(r.recorded_at).getTime() : null;
    const isStale = r.is_present && r.final_pace == null && lastPingAge != null && lastPingAge > STALE_THRESHOLD_MS;
    return { ...r, isStale: !!isStale };
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
      await client.query(
        `UPDATE run_participants SET final_distance = $3, final_pace = $4, mile_splits = $5 WHERE run_id = $1 AND user_id = $2`,
        [runId, userId, finalDistance, finalPace, mileSplits && mileSplits.length > 0 ? JSON.stringify(mileSplits) : null]
      );
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
       WHERE run_id = $1 AND final_pace IS NOT NULL AND final_pace > 0`,
      [runId]
    );
    for (const groupRow of groupsRes.rows) {
      const label = groupRow.pace_group_label;
      const finishedRes = await db.query(
        `SELECT user_id, final_pace FROM run_participants
         WHERE run_id = $1 AND final_pace IS NOT NULL AND final_pace > 0
           AND (pace_group_label = $2 OR ($2::text IS NULL AND pace_group_label IS NULL))
         ORDER BY final_pace ASC`,
        [runId, label]
      );
      for (let i = 0; i < finishedRes.rows.length; i++) {
        await db.query(
          `UPDATE run_participants SET final_rank = $3 WHERE run_id = $1 AND user_id = $2`,
          [runId, finishedRes.rows[i].user_id, i + 1]
        );
      }
    }
  } else {
    const finishedRes = await db.query(
      `SELECT user_id, final_pace FROM run_participants
       WHERE run_id = $1 AND final_pace IS NOT NULL AND final_pace > 0 ORDER BY final_pace ASC`,
      [runId]
    );
    for (let i = 0; i < finishedRes.rows.length; i++) {
      await db.query(
        `UPDATE run_participants SET final_rank = $3 WHERE run_id = $1 AND user_id = $2`,
        [runId, finishedRes.rows[i].user_id, i + 1]
      );
    }
  }
}

export async function computeLeaderboardRanks(runId: string) {
  await computeLeaderboardRanksWithClient(runId, pool);
}

export async function forceCompleteRun(runId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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
          await client.query(
            `UPDATE run_participants SET final_distance = $3, final_pace = $4, status = 'confirmed'
             WHERE run_id = $1 AND user_id = $2`,
            [runId, row.user_id, safeDist, safePace]
          );
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
    `SELECT rp.user_id, u.name, u.photo_url, rp.final_distance, rp.final_pace, rp.final_rank, rp.is_present, rp.pace_group_label
     FROM run_participants rp
     JOIN users u ON u.id = rp.user_id
     WHERE rp.run_id = $1
       AND rp.status != 'cancelled'
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
  const existing = await db.query(
    `SELECT id FROM achievements WHERE user_id = $1 AND slug = $2`,
    [userId, slug]
  );
  if (existing.rows.length === 0) {
    await db.query(
      `INSERT INTO achievements (user_id, milestone, slug) VALUES ($1, 0, $2)`,
      [userId, slug]
    );
    return true;
  }
  return false;
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
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'run'`,
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
     WHERE rp.user_id = $1 AND rp.status != 'cancelled' AND r.date < NOW()`,
    [userId]
  );
  const committedCount = parseInt(committedRes.rows[0]?.cnt ?? 0);
  if (committedCount >= 5) {
    const presentRes = await db.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status != 'cancelled' AND rp.is_present = true AND r.date < NOW()`,
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
      `SELECT COALESCE(MAX(miles_logged), 0) as max FROM run_participants WHERE user_id = $1 AND status = 'confirmed'`,
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
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'`,
      [userId]
    ),
    pool.query(
      `SELECT COALESCE(MAX(rp.miles_logged), 0) as max FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'`,
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
     WHERE rp.user_id = $1 AND rp.status != 'cancelled' AND r.date < NOW()`,
    [userId]
  );
  const committedStatCount = parseInt(committedStatRes.rows[0]?.cnt ?? 0);
  let attendanceRatePct: number | null = null;
  if (committedStatCount >= 5) {
    const presentStatRes = await pool.query(
      `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status != 'cancelled' AND rp.is_present = true AND r.date < NOW()`,
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
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'`,
    [userId]
  );
  const totalRideMiles = parseFloat(rideMilesRes.rows[0]?.total ?? 0);
  if (totalRideMiles >= 25) await awardSlug(userId, "ride_miles_25");
  if (totalRideMiles >= 100) await awardSlug(userId, "ride_miles_100");
  if (totalRideMiles >= 250) await awardSlug(userId, "ride_miles_250");
  if (totalRideMiles >= 500) await awardSlug(userId, "ride_miles_500");

  const maxSingleRide = await pool.query(
    `SELECT COALESCE(MAX(rp.miles_logged), 0) as max FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.activity_type = 'ride'`,
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
  data: { name: string; routePath: Array<{ latitude: number; longitude: number }>; distanceMiles?: number; activityType?: string; soloRunId?: string | null }
) {
  const { path: dedupedPath, distanceMiles: computedDist, loopDetected } = deduplicateRoutePath(data.routePath);
  // When a loop closure was detected, use the trimmed GPS distance.
  // When no loop, keep the full path but prefer the run's recorded distance over recomputed GPS.
  const finalDist = loopDetected
    ? computedDist
    : (data.distanceMiles != null && data.distanceMiles > 0 ? data.distanceMiles : (computedDist > 0 ? computedDist : null));

  const res = await pool.query(
    `INSERT INTO saved_paths (user_id, name, route_path, distance_miles, activity_type)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, data.name, JSON.stringify(dedupedPath), finalDist, data.activityType ?? "run"]
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
    [toUserId, path.name, path.route_path, path.distance_miles, path.activity_type ?? "run"]
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
    [toUserId, path.name, path.route_path, path.distance_miles, path.activity_type ?? "run"]
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
    `INSERT INTO community_paths (name, route_path, distance_miles, is_public, created_by_user_id, created_by_name, start_lat, start_lng, end_lat, end_lng, activity_type, run_count)
     VALUES ($1, $2, $3, true, $4, $5, $6, $7, $8, $9, $10, 0) RETURNING *`,
    [path.name, path.route_path, path.distance_miles, userId, user.name, startLat, startLng, endLat, endLng, path.activity_type ?? "run"]
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
  let query = `SELECT *, (SELECT COUNT(*) FROM path_contributions WHERE community_path_id = cp.id) as contribution_count FROM community_paths cp WHERE is_public = true`;
  const params: any[] = [];
  if (bounds) {
    params.push(bounds.swLat, bounds.neLat, bounds.swLng, bounds.neLng);
    query += ` AND start_lat >= $1 AND start_lat <= $2 AND start_lng >= $3 AND start_lng <= $4`;
  }
  query += ` ORDER BY run_count DESC, updated_at DESC LIMIT 50`;
  const res = await pool.query(query, params);
  return res.rows;
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
  const existing = await pool.query(
    `SELECT id FROM planned_runs WHERE user_id = $1 AND run_id = $2`,
    [userId, runId]
  );
  if (existing.rows.length > 0) {
    await pool.query(`DELETE FROM planned_runs WHERE user_id = $1 AND run_id = $2`, [userId, runId]);
    return { planned: false };
  } else {
    await pool.query(
      `INSERT INTO planned_runs (user_id, run_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, runId]
    );
    return { planned: true };
  }
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
       AND r.date >= NOW() - INTERVAL '3 hours'
       AND r.is_completed = false
       AND r.is_deleted IS NOT TRUE
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
  await pool.query(`DELETE FROM run_photos WHERE id = $1 AND user_id = $2`, [photoId, userId]);
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
           WHERE rp.user_id = $1 AND rp.final_distance IS NOT NULL),
          0
        ) AS total_miles,
        COALESCE(
          (SELECT COUNT(*) FROM solo_runs sr
           WHERE sr.user_id = $1 AND sr.completed = true AND sr.is_deleted IS NOT TRUE),
          0
        ) + COALESCE(
          (SELECT COUNT(*) FROM run_participants rp
           WHERE rp.user_id = $1 AND rp.final_distance IS NOT NULL),
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
       WHERE rp.user_id = $1 AND rp.final_distance IS NOT NULL
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
       SELECT final_distance as dist FROM run_participants WHERE user_id = $1 AND final_distance IS NOT NULL
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
     JOIN users u ON u.id = c.created_by
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
       END AS pending_request_count
     FROM crews c
     JOIN crew_members cm ON cm.crew_id = c.id AND cm.user_id = $1 AND cm.status = 'member'
     JOIN users u ON u.id = c.created_by
     ORDER BY c.created_at DESC`,
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
  const members = await pool.query(
    `SELECT cm.*, u.name, u.photo_url, u.hosted_runs, u.default_activity,
       COALESCE((
         SELECT AVG(p) FROM (
           SELECT NULLIF(sr.pace_min_per_mile, 0) AS p
           FROM solo_runs sr
           WHERE sr.user_id = u.id AND sr.completed = true AND sr.is_deleted IS NOT TRUE
           AND sr.activity_type = COALESCE(u.default_activity, 'run')
           AND sr.pace_min_per_mile IS NOT NULL AND sr.pace_min_per_mile > 0
           UNION ALL
           SELECT NULLIF(rp.final_pace, 0) AS p
           FROM run_participants rp
           JOIN runs r ON r.id = rp.run_id
           WHERE rp.user_id = u.id AND rp.final_pace IS NOT NULL AND rp.final_pace > 0
           AND r.is_completed = true AND r.is_deleted IS NOT TRUE
           AND r.activity_type = COALESCE(u.default_activity, 'run')
         ) paces
       ), 0) AS avg_pace
     FROM crew_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.crew_id = $1 AND cm.status = 'member'
     ORDER BY cm.joined_at ASC`,
    [crewId]
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
    await pool.query(`DELETE FROM crews WHERE id = $1`, [crewId]);
    return { disbanded: true };
  }

  const crewRes = await pool.query(`SELECT created_by FROM crews WHERE id = $1`, [crewId]);
  const isCreator = crewRes.rows[0]?.created_by === userId;

  if (isCreator) {
    const nextRes = await pool.query(
      `SELECT user_id FROM crew_members WHERE crew_id = $1 AND user_id != $2 AND status = 'member' ORDER BY joined_at ASC LIMIT 1`,
      [crewId, userId]
    );
    const newOwner = nextRes.rows[0]?.user_id;
    if (newOwner) {
      await pool.query(`UPDATE crews SET created_by = $1 WHERE id = $2`, [newOwner, crewId]);
    }
  }

  await pool.query(`DELETE FROM crew_members WHERE crew_id = $1 AND user_id = $2`, [crewId, userId]);
  return { disbanded: false };
}

export async function disbandCrewById(crewId: string, userId: string) {
  const crewRes = await pool.query(`SELECT created_by FROM crews WHERE id = $1`, [crewId]);
  if (!crewRes.rows[0]) throw new Error("Crew not found");
  if (crewRes.rows[0].created_by !== userId) throw new Error("Only the creator can disband this crew");
  await pool.query(`DELETE FROM crews WHERE id = $1`, [crewId]);
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
    `SELECT r.id, r.title, r.date, r.min_distance, r.activity_type, r.host_id,
            u.name AS host_name,
            COALESCE(
              AVG(rp.final_pace) FILTER (WHERE rp.is_present = true AND rp.final_pace IS NOT NULL),
              0
            ) AS avg_attendee_pace,
            COUNT(rp.user_id) FILTER (WHERE rp.is_present = true) AS attendee_count
     FROM runs r
     JOIN users u ON u.id = r.host_id
     LEFT JOIN run_participants rp ON rp.run_id = r.id
     WHERE r.crew_id = $1
       AND r.date < NOW()
     GROUP BY r.id, u.name
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
     LEFT JOIN run_participants rp ON rp.run_id = r.id AND rp.final_distance IS NOT NULL
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

      await pool.query(
        `INSERT INTO crew_messages (crew_id, sender_name, message, message_type)
         VALUES ($1, 'PaceUp', $2, 'milestone')`,
        [crewId, m.msg]
      );

      newKeys.push(m.key);
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
       JOIN users u ON u.id = c.created_by
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
     JOIN users u ON u.id = c.created_by
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
     JOIN users u ON u.id = c.created_by
     WHERE NOT EXISTS (
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
}) {
  let query = `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.rating_count as host_rating_count, u.photo_url as host_photo,
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
  const result = await pool.query(
    `SELECT u.push_token FROM run_participants rp
     JOIN users u ON rp.user_id = u.id
     WHERE rp.run_id = $1 AND rp.status != 'cancelled'
       AND u.push_token IS NOT NULL AND u.notifications_enabled = true
     UNION
     SELECT u.push_token FROM planned_runs pr
     JOIN users u ON pr.user_id = u.id
     WHERE pr.run_id = $1
       AND u.push_token IS NOT NULL AND u.notifications_enabled = true`,
    [runId]
  );
  return result.rows.map((r: any) => r.push_token);
}

export async function deleteUser(userId: string): Promise<void> {
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
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
  const res = await pool.query(
    `SELECT COUNT(*) as runs,
            COALESCE(SUM(distance_mi), 0) as total_mi,
            COALESCE(SUM(duration_seconds), 0) as total_seconds
     FROM solo_runs
     WHERE user_id = $1 AND completed_at >= $2`,
    [userId, since]
  );
  return {
    runs: parseInt(res.rows[0].runs, 10),
    totalMi: parseFloat(res.rows[0].total_mi),
    totalSeconds: parseInt(res.rows[0].total_seconds, 10),
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
    WHERE r.is_completed = true
      AND COALESCE(r.started_at, r.date) >= NOW() - INTERVAL '7 days'
    GROUP BY r.id, u.name
    ORDER BY (COUNT(DISTINCT rp.user_id) * 2 + COALESCE(r.max_distance, 0)) DESC,
             COALESCE(r.started_at, r.date) DESC
    LIMIT 12
  `);
  return res.rows.map((row) => ({
    ...row,
    participant_count: parseInt(row.participant_count, 10),
  }));
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

export async function getBlockList(userId: string): Promise<string[]> {
  const res = await pool.query(
    `SELECT blocked_id FROM user_blocks WHERE blocker_id = $1`,
    [userId]
  );
  return res.rows.map((r: any) => r.blocked_id);
}
