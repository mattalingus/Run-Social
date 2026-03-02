import { Pool } from "pg";
import bcrypt from "bcryptjs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
        CREATE TYPE participant_status AS ENUM ('joined', 'confirmed', 'cancelled');
      END IF;
    END $$;

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

    CREATE TABLE IF NOT EXISTS friends (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      requester_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(requester_id, addressee_id)
    );

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

    ALTER TABLE runs ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false;
    ALTER TABLE runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;
    ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS is_present BOOLEAN DEFAULT false;
    ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS final_distance REAL;
    ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS final_pace REAL;
    ALTER TABLE run_participants ADD COLUMN IF NOT EXISTS final_rank INTEGER;

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
  `);
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

export async function createUser(data: { email: string; password: string; name: string; username?: string }) {
  const hashedPassword = await bcrypt.hash(data.password, 10);
  const result = await pool.query(
    `INSERT INTO users (email, password, name, username) VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.email.toLowerCase(), hashedPassword, data.name, data.username?.toLowerCase() ?? null]
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
}) {
  const inviteToken = data.privacy === "private"
    ? Math.random().toString(36).substring(2, 10).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase()
    : null;
  const result = await pool.query(
    `INSERT INTO runs (host_id, title, description, privacy, date, location_lat, location_lng, location_name, min_distance, max_distance, min_pace, max_pace, tags, max_participants, invite_token, invite_password)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [data.hostId, data.title, data.description || null, data.privacy, data.date, data.locationLat, data.locationLng, data.locationName, data.minDistance, data.maxDistance, data.minPace, data.maxPace, data.tags, data.maxParticipants, inviteToken, data.invitePassword || null]
  );
  await pool.query(`UPDATE users SET hosted_runs = hosted_runs + 1 WHERE id = $1`, [data.hostId]);
  return result.rows[0];
}

export async function searchUsers(query: string, currentUserId: string) {
  const result = await pool.query(
    `SELECT id, name, photo_url, completed_runs, total_miles FROM users WHERE id != $1 AND name ILIKE $2 LIMIT 20`,
    [currentUserId, `%${query}%`]
  );
  return result.rows;
}

export async function getFriends(userId: string) {
  const result = await pool.query(
    `SELECT u.id, u.name, u.photo_url, u.completed_runs, u.total_miles,
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
    `UPDATE friends SET status = 'accepted' WHERE id = $1 AND addressee_id = $2 RETURNING *`,
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

export async function getFriendPrivateRuns(userId: string, bounds?: { swLat: number; neLat: number; swLng: number; neLng: number }) {
  let query = `SELECT r.id, r.title, r.date, r.location_lat, r.location_lng, r.location_name,
    r.min_pace, r.max_pace, r.min_distance, r.max_distance, r.max_participants, r.privacy,
    u.name as host_name, u.photo_url as host_photo, u.marker_icon as host_marker_icon, u.avg_rating as host_rating, u.hosted_runs as host_hosted_runs,
    (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status != 'cancelled') as participant_count,
    true as is_locked
  FROM runs r
  JOIN users u ON u.id = r.host_id
  JOIN friends f ON ((f.requester_id = $1 AND f.addressee_id = r.host_id) OR (f.addressee_id = $1 AND f.requester_id = r.host_id))
  WHERE r.privacy = 'private' AND r.date > NOW() AND r.is_completed = false
    AND f.status = 'accepted' AND r.host_id != $1
    AND r.id NOT IN (SELECT run_id FROM run_invites WHERE invitee_id = $1)`;
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
  let query = `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.photo_url as host_photo, u.marker_icon as host_marker_icon, u.hosted_runs as host_hosted_runs,
    (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status != 'cancelled') as participant_count,
    false as is_locked
  FROM runs r
  JOIN users u ON u.id = r.host_id
  JOIN run_invites ri ON ri.run_id = r.id AND ri.invitee_id = $1
  WHERE r.privacy = 'private' AND r.date > NOW() AND r.is_completed = false`;
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
    `SELECT * FROM solo_runs WHERE user_id = $1 ORDER BY date DESC`,
    [userId]
  );
  return result.rows;
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
}) {
  const result = await pool.query(
    `INSERT INTO solo_runs (user_id, title, date, distance_miles, pace_min_per_mile, duration_seconds, completed, planned, notes, route_path)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
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
    ]
  );
  return result.rows[0];
}

export async function updateSoloRun(id: string, userId: string, updates: Record<string, any>) {
  const allowed = ["title", "date", "distance_miles", "pace_min_per_mile", "duration_seconds", "completed", "planned", "notes", "route_path"];
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
  await pool.query(`DELETE FROM solo_runs WHERE id = $1 AND user_id = $2`, [id, userId]);
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
  let query = `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.photo_url as host_photo, u.marker_icon as host_marker_icon, u.hosted_runs as host_hosted_runs,
    (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status != 'cancelled') as participant_count
    FROM runs r JOIN users u ON u.id = r.host_id
    WHERE r.privacy = 'public' AND r.date > NOW() - INTERVAL '2 hours' AND r.is_completed = false`;
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
    `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.photo_url as host_photo, u.avg_pace as host_avg_pace, u.hosted_runs as host_hosted_runs,
      (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status != 'cancelled') as participant_count,
      (SELECT COUNT(*) FROM planned_runs pr WHERE pr.run_id = r.id) as plan_count
     FROM runs r JOIN users u ON u.id = r.host_id WHERE r.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

export async function getUserRuns(userId: string) {
  const result = await pool.query(
    `SELECT r.*, u.name as host_name,
      (SELECT rp2.status FROM run_participants rp2 WHERE rp2.run_id = r.id AND rp2.user_id = $1 LIMIT 1) as my_status,
      CASE WHEN r.host_id = $1 THEN true ELSE false END as is_host
     FROM runs r
     JOIN users u ON u.id = r.host_id
     WHERE r.host_id = $1 OR r.id IN (SELECT run_id FROM run_participants WHERE user_id = $1 AND status != 'cancelled')
     ORDER BY r.date DESC`,
    [userId]
  );
  return result.rows;
}

export async function isParticipant(runId: string, userId: string) {
  const result = await pool.query(
    `SELECT id FROM run_participants WHERE run_id = $1 AND user_id = $2 AND status != 'cancelled'`,
    [runId, userId]
  );
  return result.rows.length > 0;
}

export async function joinRun(runId: string, userId: string) {
  const existing = await pool.query(
    `SELECT * FROM run_participants WHERE run_id = $1 AND user_id = $2`,
    [runId, userId]
  );
  if (existing.rows.length > 0) {
    if (existing.rows[0].status === "cancelled") {
      await pool.query(`UPDATE run_participants SET status = 'joined' WHERE run_id = $1 AND user_id = $2`, [runId, userId]);
    }
    return existing.rows[0];
  }
  const result = await pool.query(
    `INSERT INTO run_participants (run_id, user_id) VALUES ($1, $2) RETURNING *`,
    [runId, userId]
  );
  return result.rows[0];
}

export async function leaveRun(runId: string, userId: string) {
  await pool.query(
    `UPDATE run_participants SET status = 'cancelled' WHERE run_id = $1 AND user_id = $2`,
    [runId, userId]
  );
}

export async function getRunParticipants(runId: string) {
  const result = await pool.query(
    `SELECT u.id, u.name, u.photo_url, u.avg_pace, u.avg_distance, rp.status, rp.joined_at
     FROM run_participants rp JOIN users u ON u.id = rp.user_id
     WHERE rp.run_id = $1 AND rp.status != 'cancelled' ORDER BY rp.joined_at ASC`,
    [runId]
  );
  return result.rows;
}

export async function confirmRunCompletion(runId: string, userId: string, milesLogged: number) {
  await pool.query(
    `UPDATE run_participants SET status = 'confirmed', miles_logged = $3 WHERE run_id = $1 AND user_id = $2`,
    [runId, userId, milesLogged]
  );
  const userResult = await pool.query(
    `UPDATE users SET
      completed_runs = completed_runs + 1,
      total_miles = total_miles + $2,
      miles_this_year = miles_this_year + $2,
      miles_this_month = miles_this_month + $2
     WHERE id = $1 RETURNING total_miles`,
    [userId, milesLogged]
  );
  const totalMiles = userResult.rows[0]?.total_miles;
  if (totalMiles !== undefined) {
    await checkAndAwardAchievements(userId, totalMiles);
  }
  await checkHostUnlock(userId);
  return { success: true };
}

// ─── Live Group Run ───────────────────────────────────────────────────────────

export async function startGroupRun(runId: string, hostId: string) {
  const runRes = await pool.query(`SELECT * FROM runs WHERE id = $1`, [runId]);
  if (!runRes.rows.length) throw new Error("Run not found");
  const run = runRes.rows[0];
  if (run.host_id !== hostId) throw new Error("Only the host can start the run");
  if (run.is_active) throw new Error("Run already started");

  await pool.query(`UPDATE runs SET is_active = true, started_at = NOW() WHERE id = $1`, [runId]);

  const latestPings = await pool.query(
    `SELECT DISTINCT ON (user_id) user_id, latitude, longitude
     FROM run_tracking_points WHERE run_id = $1 ORDER BY user_id, recorded_at DESC`,
    [runId]
  );
  for (const ping of latestPings.rows) {
    const dist = haversineKm(ping.latitude, ping.longitude, run.location_lat, run.location_lng);
    if (dist <= 1.0) {
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

  const runRes = await pool.query(`SELECT location_lat, location_lng, is_active FROM runs WHERE id = $1`, [runId]);
  if (!runRes.rows.length) return { isPresent: false, isActive: false };
  const run = runRes.rows[0];

  let isPresent = false;
  if (run.is_active) {
    const dist = haversineKm(latitude, longitude, run.location_lat, run.location_lng);
    if (dist <= 1.0) {
      await pool.query(
        `UPDATE run_participants SET is_present = true WHERE run_id = $1 AND user_id = $2 AND status != 'cancelled'`,
        [runId, userId]
      );
      isPresent = true;
    } else {
      const pRes = await pool.query(
        `SELECT is_present FROM run_participants WHERE run_id = $1 AND user_id = $2 AND status != 'cancelled'`,
        [runId, userId]
      );
      isPresent = pRes.rows[0]?.is_present || false;
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

  const presentCount = participantsRes.rows.filter((r: any) => r.is_present).length;
  return {
    isActive: run.is_active,
    isCompleted: run.is_completed,
    startedAt: run.started_at,
    presentCount,
    participants: participantsRes.rows,
  };
}

export async function finishRunnerRun(runId: string, userId: string, finalDistance: number, finalPace: number) {
  await pool.query(
    `UPDATE run_participants SET final_distance = $3, final_pace = $4 WHERE run_id = $1 AND user_id = $2`,
    [runId, userId, finalDistance, finalPace]
  );
  const finishedRes = await pool.query(
    `SELECT user_id, final_pace FROM run_participants
     WHERE run_id = $1 AND final_pace IS NOT NULL ORDER BY final_pace ASC`,
    [runId]
  );
  for (let i = 0; i < finishedRes.rows.length; i++) {
    await pool.query(
      `UPDATE run_participants SET final_rank = $3 WHERE run_id = $1 AND user_id = $2`,
      [runId, finishedRes.rows[i].user_id, i + 1]
    );
  }
  return { success: true };
}

export async function getRunResults(runId: string) {
  const result = await pool.query(
    `SELECT rp.user_id, u.name, u.photo_url, rp.final_distance, rp.final_pace, rp.final_rank, rp.is_present
     FROM run_participants rp
     JOIN users u ON u.id = rp.user_id
     WHERE rp.run_id = $1 AND rp.is_present = true
     ORDER BY rp.final_rank ASC NULLS LAST, rp.joined_at ASC`,
    [runId]
  );
  return result.rows;
}

export async function checkHostUnlock(userId: string) {
  const result = await pool.query(
    `SELECT COUNT(DISTINCT r.host_id) as unique_hosts, COUNT(*) as total_runs
     FROM run_participants rp
     JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.host_id != $1`,
    [userId]
  );
  const { unique_hosts, total_runs } = result.rows[0];
  if (parseInt(total_runs) >= 3 && parseInt(unique_hosts) >= 2) {
    await pool.query(
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

async function awardSlug(userId: string, slug: string) {
  const existing = await pool.query(
    `SELECT id FROM achievements WHERE user_id = $1 AND slug = $2`,
    [userId, slug]
  );
  if (existing.rows.length === 0) {
    await pool.query(
      `INSERT INTO achievements (user_id, milestone, slug) VALUES ($1, 0, $2)`,
      [userId, slug]
    );
  }
}

export async function checkAndAwardAchievements(userId: string, totalMiles: number) {
  const user = await pool.query(`SELECT completed_runs, hosted_runs FROM users WHERE id = $1`, [userId]);
  const { completed_runs, hosted_runs } = user.rows[0] ?? {};

  if (totalMiles >= 25) await awardSlug(userId, "miles_25");
  if (totalMiles >= 100) await awardSlug(userId, "miles_100");
  if (totalMiles >= 250) await awardSlug(userId, "miles_250");
  if (completed_runs >= 1) await awardSlug(userId, "first_step");
  if (completed_runs >= 5) await awardSlug(userId, "five_alive");
  if (completed_runs >= 10) await awardSlug(userId, "ten_toes_down");
  if (hosted_runs >= 1) await awardSlug(userId, "host_in_making");
  if (hosted_runs >= 5) await awardSlug(userId, "crew_builder");

  const maxSingleRun = await pool.query(
    `SELECT COALESCE(MAX(miles_logged), 0) as max FROM run_participants WHERE user_id = $1 AND status = 'confirmed'`,
    [userId]
  );
  const maxMiles = parseFloat(maxSingleRun.rows[0]?.max ?? 0);
  if (maxMiles >= 13.1) await awardSlug(userId, "half_marathon");
  if (maxMiles >= 26.2) await awardSlug(userId, "marathoner");

  const publicJoined = await pool.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND r.privacy = 'public' AND r.host_id != $1`,
    [userId]
  );
  if (parseInt(publicJoined.rows[0]?.cnt) >= 1) await awardSlug(userId, "social_starter");

  const squadRuns = await pool.query(
    `SELECT COUNT(DISTINCT rp.run_id) as cnt FROM run_participants rp WHERE rp.user_id = $1 AND rp.status = 'confirmed'
     AND (SELECT COUNT(*) FROM run_participants rp2 WHERE rp2.run_id = rp.run_id AND rp2.status != 'cancelled') >= 3`,
    [userId]
  );
  if (parseInt(squadRuns.rows[0]?.cnt) >= 1) await awardSlug(userId, "squad_runner");

  const monthlyMax = await pool.query(
    `SELECT COALESCE(MAX(cnt), 0) as max FROM (
       SELECT DATE_TRUNC('month', r.date) as m, COUNT(*) as cnt
       FROM run_participants rp JOIN runs r ON r.id = rp.run_id
       WHERE rp.user_id = $1 AND rp.status = 'confirmed'
       GROUP BY m
     ) sub`,
    [userId]
  );
  if (parseInt(monthlyMax.rows[0]?.max) >= 8) await awardSlug(userId, "monthly_grinder");

  const streakResult = await pool.query(
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
  if (parseInt(streakResult.rows[0]?.max) >= 3) await awardSlug(userId, "streak_week");

  const nightRuns = await pool.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND EXTRACT(HOUR FROM r.date AT TIME ZONE 'UTC') >= 20`,
    [userId]
  );
  if (parseInt(nightRuns.rows[0]?.cnt) >= 5) await awardSlug(userId, "night_owl");

  const morningRuns = await pool.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE rp.user_id = $1 AND rp.status = 'confirmed' AND EXTRACT(HOUR FROM r.date AT TIME ZONE 'UTC') < 7`,
    [userId]
  );
  if (parseInt(morningRuns.rows[0]?.cnt) >= 10) await awardSlug(userId, "morning_warrior");

  const communityLeader = await pool.query(
    `SELECT COUNT(*) as cnt FROM run_participants rp JOIN runs r ON r.id = rp.run_id
     WHERE r.host_id = $1 AND rp.user_id != $1 AND rp.status = 'confirmed'`,
    [userId]
  );
  if (parseInt(communityLeader.rows[0]?.cnt) >= 20) await awardSlug(userId, "community_leader");
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
  ]);

  const maxSingleMiles = parseFloat(maxSingleRunRes.rows[0]?.max ?? 0);

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
  };
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

export async function updateGoals(userId: string, monthlyGoal?: number, yearlyGoal?: number) {
  const updates: string[] = [];
  const values: any[] = [userId];
  if (monthlyGoal !== undefined) { updates.push(`monthly_goal = $${values.length + 1}`); values.push(monthlyGoal); }
  if (yearlyGoal !== undefined) { updates.push(`yearly_goal = $${values.length + 1}`); values.push(yearlyGoal); }
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
  data: { name: string; routePath: Array<{ latitude: number; longitude: number }>; distanceMiles?: number }
) {
  const res = await pool.query(
    `INSERT INTO saved_paths (user_id, name, route_path, distance_miles)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, data.name, JSON.stringify(data.routePath), data.distanceMiles ?? null]
  );
  return res.rows[0];
}

export async function deleteSavedPath(id: string, userId: string) {
  const res = await pool.query(
    `DELETE FROM saved_paths WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId]
  );
  if (!res.rows.length) throw new Error("Not found or not authorized");
  return { success: true };
}

// ─── Community Paths ───────────────────────────────────────────────────────────

export async function getCommunityPaths(bounds?: { swLat: number; neLat: number; swLng: number; neLng: number }) {
  let query = `SELECT * FROM community_paths WHERE contributor_count >= 3`;
  const params: any[] = [];
  if (bounds) {
    params.push(bounds.swLat, bounds.neLat, bounds.swLng, bounds.neLng);
    query += ` AND start_lat >= $1 AND start_lat <= $2 AND start_lng >= $3 AND start_lng <= $4`;
  }
  query += ` ORDER BY contributor_count DESC, updated_at DESC LIMIT 50`;
  const res = await pool.query(query, params);
  return res.rows;
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
       AND ($6 = 0 OR cp.distance_miles IS NULL OR ABS(cp.distance_miles - $6) / GREATEST($6, 0.1) < 0.35)
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

export async function getBookmarkedRuns(userId: string) {
  const result = await pool.query(
    `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.photo_url as host_photo,
      u.marker_icon as host_marker_icon,
      (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status != 'cancelled') as participant_count,
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
