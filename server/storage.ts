import { Pool } from "pg";
import bcrypt from "bcryptjs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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

    CREATE TABLE IF NOT EXISTS achievements (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL REFERENCES users(id),
      milestone INTEGER NOT NULL,
      earned_at TIMESTAMP DEFAULT NOW(),
      reward_eligible BOOLEAN DEFAULT true,
      reward_claimed BOOLEAN DEFAULT false
    );
  `);
}

export async function createUser(data: { email: string; password: string; name: string }) {
  const hashedPassword = await bcrypt.hash(data.password, 10);
  const result = await pool.query(
    `INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING *`,
    [data.email.toLowerCase(), hashedPassword, data.name]
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
}) {
  const result = await pool.query(
    `INSERT INTO runs (host_id, title, description, privacy, date, location_lat, location_lng, location_name, min_distance, max_distance, min_pace, max_pace, tags, max_participants)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [data.hostId, data.title, data.description || null, data.privacy, data.date, data.locationLat, data.locationLng, data.locationName, data.minDistance, data.maxDistance, data.minPace, data.maxPace, data.tags, data.maxParticipants]
  );
  await pool.query(`UPDATE users SET hosted_runs = hosted_runs + 1 WHERE id = $1`, [data.hostId]);
  return result.rows[0];
}

export async function getPublicRuns(filters?: { minPace?: number; maxPace?: number; minDistance?: number; maxDistance?: number; tag?: string }) {
  let query = `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.photo_url as host_photo,
    (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status != 'cancelled') as participant_count
    FROM runs r JOIN users u ON u.id = r.host_id
    WHERE r.privacy = 'public' AND r.date > NOW() AND r.is_completed = false`;
  const params: any[] = [];
  let idx = 1;
  if (filters?.minPace !== undefined) { query += ` AND r.max_pace >= $${idx++}`; params.push(filters.minPace); }
  if (filters?.maxPace !== undefined) { query += ` AND r.min_pace <= $${idx++}`; params.push(filters.maxPace); }
  if (filters?.minDistance !== undefined) { query += ` AND r.max_distance >= $${idx++}`; params.push(filters.minDistance); }
  if (filters?.maxDistance !== undefined) { query += ` AND r.min_distance <= $${idx++}`; params.push(filters.maxDistance); }
  if (filters?.tag) { query += ` AND $${idx++} = ANY(r.tags)`; params.push(filters.tag); }
  query += ` ORDER BY r.date ASC LIMIT 100`;
  const result = await pool.query(query, params);
  return result.rows;
}

export async function getRunById(id: string) {
  const result = await pool.query(
    `SELECT r.*, u.name as host_name, u.avg_rating as host_rating, u.photo_url as host_photo, u.avg_pace as host_avg_pace,
      (SELECT COUNT(*) FROM run_participants rp WHERE rp.run_id = r.id AND rp.status != 'cancelled') as participant_count
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

export async function checkAndAwardAchievements(userId: string, totalMiles: number) {
  const milestones = [25, 100, 250, 500, 1000];
  for (const milestone of milestones) {
    if (totalMiles >= milestone) {
      const existing = await pool.query(
        `SELECT id FROM achievements WHERE user_id = $1 AND milestone = $2`,
        [userId, milestone]
      );
      if (existing.rows.length === 0) {
        await pool.query(`INSERT INTO achievements (user_id, milestone) VALUES ($1, $2)`, [userId, milestone]);
      }
    }
  }
}

export async function getUserAchievements(userId: string) {
  const result = await pool.query(
    `SELECT * FROM achievements WHERE user_id = $1 ORDER BY milestone ASC`,
    [userId]
  );
  return result.rows;
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
