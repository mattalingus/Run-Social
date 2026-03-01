import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const HOUSTON_LAT = 29.7604;
const HOUSTON_LNG = -95.3698;

const STYLES = ["Talkative", "Quiet", "Motivational", "Training", "Ministry", "Recovery"];

const TITLES = [
  "Morning Miles in Midtown",
  "Buffalo Bayou Bridge Run",
  "Memorial Park Loop",
  "Heights Neighborhood Jog",
  "Downtown Discovery Run",
  "Rice University Track Workout",
  "Hermann Park Sunrise Run",
  "Museum District 5K",
  "Galleria Area Sprint",
  "Montrose Morning Crew",
  "Energy Corridor Run",
  "Uptown Saturday Stroll",
  "Greenway Plaza Circuit",
  "River Oaks Route",
  "Cypress Creek Trail Blast",
  "South Loop Easy Miles",
  "Westheimer Winder",
  "Pearland Park Run",
  "Katy Prairie Discovery",
  "Sugarland Social Jog",
];

const DUMMY_HOSTS: { name: string; pfp: string; icon?: string }[] = [
  { name: "Marcus T.", pfp: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face", icon: "🔥" },
  { name: "Aisha K.", pfp: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop&crop=face" },
  { name: "Devon R.", pfp: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop&crop=face", icon: "⚡" },
  { name: "Sofia M.", pfp: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop&crop=face" },
  { name: "Jamal W.", pfp: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop&crop=face", icon: "🏆" },
  { name: "Lily C.", pfp: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&h=200&fit=crop&crop=face", icon: "🌿" },
  { name: "Brendan O.", pfp: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200&h=200&fit=crop&crop=face" },
  { name: "Priya S.", pfp: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop&crop=face", icon: "🎯" },
  { name: "Tyler H.", pfp: "https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=200&h=200&fit=crop&crop=face" },
  { name: "Naomi J.", pfp: "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=200&h=200&fit=crop&crop=face", icon: "🌟" },
];

function randFloat(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function getOrCreateDummyHost(host: { name: string; pfp: string; icon?: string }): Promise<string> {
  const email = `dummy-${host.name.toLowerCase().replace(/[^a-z]/g, "")}@paceup.dev`;
  const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existing.rows.length > 0) {
    if (host.icon) {
      await pool.query(`UPDATE users SET marker_icon = $2 WHERE id = $1`, [existing.rows[0].id, host.icon]);
    }
    return existing.rows[0].id;
  }
  const inserted = await pool.query(
    `INSERT INTO users (email, password, name, photo_url, marker_icon, host_unlocked, role) VALUES ($1, $2, $3, $4, $5, true, 'host') RETURNING id`,
    [email, "not-a-real-password-hash", host.name, host.pfp, host.icon ?? null]
  );
  return inserted.rows[0].id;
}

export async function generateDummyRuns(count = 15): Promise<void> {
  const titlePool = [...TITLES];

  for (let i = 0; i < count; i++) {
    const host = DUMMY_HOSTS[i % DUMMY_HOSTS.length];
    const hostId = await getOrCreateDummyHost(host);

    const lat = HOUSTON_LAT + randFloat(-0.03, 0.03);
    const lng = HOUSTON_LNG + randFloat(-0.03, 0.03);
    const paceMin = randFloat(6.5, 9.5);
    const paceMax = paceMin + randFloat(0.5, 1.5);
    const distMin = randFloat(3, 6);
    const distMax = distMin + randFloat(2, 4);
    const style = pick(STYLES);

    const daysAhead = Math.floor(Math.random() * 7);
    const hoursAhead = 5 + Math.floor(Math.random() * 14);
    const date = new Date();
    date.setDate(date.getDate() + daysAhead);
    date.setHours(hoursAhead, 0, 0, 0);

    const title =
      titlePool.length > 0
        ? titlePool.splice(Math.floor(Math.random() * titlePool.length), 1)[0]
        : `Houston Run ${i + 1}`;

    await pool.query(
      `INSERT INTO runs (host_id, title, privacy, date, location_lat, location_lng, location_name, min_distance, max_distance, min_pace, max_pace, tags, max_participants)
       VALUES ($1,$2,'public',$3,$4,$5,$6,$7,$8,$9,$10,$11,20)`,
      [hostId, title, date.toISOString(), lat, lng, "Houston, TX", distMin, distMax, paceMin, paceMax, [style]]
    );
  }
}

export async function clearAndReseedRuns(count = 20): Promise<void> {
  await pool.query(
    `DELETE FROM run_participants WHERE run_id IN (
      SELECT r.id FROM runs r
      JOIN users u ON u.id = r.host_id
      WHERE u.email LIKE 'dummy-%@paceup.dev'
    )`
  );
  await pool.query(
    `DELETE FROM runs WHERE host_id IN (
      SELECT id FROM users WHERE email LIKE 'dummy-%@paceup.dev'
    )`
  );
  await generateDummyRuns(count);
}

export async function getRunCount(): Promise<number> {
  const result = await pool.query(`SELECT COUNT(*) as count FROM runs WHERE date > NOW() AND is_completed = false`);
  return parseInt(result.rows[0].count, 10);
}
