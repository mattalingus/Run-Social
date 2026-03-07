import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ─── Houston GPS route helpers ────────────────────────────────────────────────

function memorialParkLoop(): Array<{ latitude: number; longitude: number }> {
  return [
    { latitude: 29.7658, longitude: -95.4322 },
    { latitude: 29.7671, longitude: -95.4298 },
    { latitude: 29.7685, longitude: -95.4271 },
    { latitude: 29.7694, longitude: -95.4241 },
    { latitude: 29.7698, longitude: -95.4207 },
    { latitude: 29.7692, longitude: -95.4178 },
    { latitude: 29.7680, longitude: -95.4157 },
    { latitude: 29.7662, longitude: -95.4148 },
    { latitude: 29.7643, longitude: -95.4155 },
    { latitude: 29.7628, longitude: -95.4171 },
    { latitude: 29.7619, longitude: -95.4196 },
    { latitude: 29.7620, longitude: -95.4225 },
    { latitude: 29.7631, longitude: -95.4252 },
    { latitude: 29.7645, longitude: -95.4274 },
    { latitude: 29.7657, longitude: -95.4296 },
    { latitude: 29.7658, longitude: -95.4322 },
  ];
}

function buffaloByouRoute(): Array<{ latitude: number; longitude: number }> {
  return [
    { latitude: 29.7575, longitude: -95.3779 },
    { latitude: 29.7582, longitude: -95.3751 },
    { latitude: 29.7591, longitude: -95.3724 },
    { latitude: 29.7603, longitude: -95.3699 },
    { latitude: 29.7615, longitude: -95.3674 },
    { latitude: 29.7628, longitude: -95.3651 },
    { latitude: 29.7639, longitude: -95.3627 },
    { latitude: 29.7648, longitude: -95.3601 },
    { latitude: 29.7641, longitude: -95.3578 },
    { latitude: 29.7629, longitude: -95.3558 },
    { latitude: 29.7614, longitude: -95.3541 },
    { latitude: 29.7599, longitude: -95.3559 },
    { latitude: 29.7587, longitude: -95.3581 },
    { latitude: 29.7578, longitude: -95.3607 },
    { latitude: 29.7571, longitude: -95.3634 },
    { latitude: 29.7569, longitude: -95.3663 },
    { latitude: 29.7572, longitude: -95.3693 },
    { latitude: 29.7574, longitude: -95.3723 },
    { latitude: 29.7575, longitude: -95.3751 },
  ];
}

function hermannParkRoute(): Array<{ latitude: number; longitude: number }> {
  return [
    { latitude: 29.7215, longitude: -95.3906 },
    { latitude: 29.7225, longitude: -95.3886 },
    { latitude: 29.7238, longitude: -95.3868 },
    { latitude: 29.7249, longitude: -95.3848 },
    { latitude: 29.7255, longitude: -95.3824 },
    { latitude: 29.7248, longitude: -95.3800 },
    { latitude: 29.7235, longitude: -95.3784 },
    { latitude: 29.7218, longitude: -95.3779 },
    { latitude: 29.7201, longitude: -95.3790 },
    { latitude: 29.7190, longitude: -95.3810 },
    { latitude: 29.7188, longitude: -95.3836 },
    { latitude: 29.7195, longitude: -95.3860 },
    { latitude: 29.7206, longitude: -95.3880 },
    { latitude: 29.7215, longitude: -95.3900 },
    { latitude: 29.7215, longitude: -95.3906 },
  ];
}

function terryHersheyRide(): Array<{ latitude: number; longitude: number }> {
  return [
    { latitude: 29.7415, longitude: -95.5821 },
    { latitude: 29.7408, longitude: -95.5792 },
    { latitude: 29.7401, longitude: -95.5762 },
    { latitude: 29.7396, longitude: -95.5731 },
    { latitude: 29.7393, longitude: -95.5699 },
    { latitude: 29.7392, longitude: -95.5667 },
    { latitude: 29.7394, longitude: -95.5636 },
    { latitude: 29.7399, longitude: -95.5605 },
    { latitude: 29.7406, longitude: -95.5576 },
    { latitude: 29.7415, longitude: -95.5549 },
    { latitude: 29.7425, longitude: -95.5524 },
    { latitude: 29.7435, longitude: -95.5500 },
    { latitude: 29.7440, longitude: -95.5527 },
    { latitude: 29.7438, longitude: -95.5558 },
    { latitude: 29.7434, longitude: -95.5589 },
    { latitude: 29.7430, longitude: -95.5620 },
    { latitude: 29.7426, longitude: -95.5651 },
    { latitude: 29.7422, longitude: -95.5682 },
    { latitude: 29.7418, longitude: -95.5713 },
    { latitude: 29.7416, longitude: -95.5745 },
    { latitude: 29.7415, longitude: -95.5776 },
    { latitude: 29.7415, longitude: -95.5821 },
  ];
}

function spotsRoute(): Array<{ latitude: number; longitude: number }> {
  return [
    { latitude: 29.7624, longitude: -95.4234 },
    { latitude: 29.7634, longitude: -95.4210 },
    { latitude: 29.7644, longitude: -95.4188 },
    { latitude: 29.7651, longitude: -95.4163 },
    { latitude: 29.7645, longitude: -95.4139 },
    { latitude: 29.7633, longitude: -95.4121 },
    { latitude: 29.7618, longitude: -95.4115 },
    { latitude: 29.7603, longitude: -95.4122 },
    { latitude: 29.7593, longitude: -95.4139 },
    { latitude: 29.7590, longitude: -95.4163 },
    { latitude: 29.7597, longitude: -95.4187 },
    { latitude: 29.7609, longitude: -95.4207 },
    { latitude: 29.7619, longitude: -95.4224 },
    { latitude: 29.7624, longitude: -95.4234 },
  ];
}

// ─── Main seed function ───────────────────────────────────────────────────────

async function seed() {
  console.log("🌱 Starting PaceUp demo seed (Houston edition)...");

  const hashedPassword = await bcrypt.hash("PaceUp123!", 10);

  // ── 1. Check if already seeded ─────────────────────────────────────────────
  const existing = await pool.query(
    `SELECT id FROM users WHERE email = 'marcus.j@paceup.dev' LIMIT 1`
  );
  if (existing.rows.length > 0) {
    console.log("⚠️  Demo data already exists. Re-running will insert duplicates.");
    console.log("    Delete seed users first if you want a clean re-seed.");
  }

  // ── 2. Lookup Mattius ──────────────────────────────────────────────────────
  const mattiusRow = await pool.query(
    `SELECT id, name FROM users WHERE username ILIKE 'mattius' OR name ILIKE 'mattius' OR email = 'matpeacock9@gmail.com' LIMIT 1`
  );
  if (mattiusRow.rows.length === 0) {
    console.error("❌ Could not find Mattius's account. Make sure that account exists first.");
    process.exit(1);
  }
  const mattiusId: string = mattiusRow.rows[0].id;
  const mattiusName: string = mattiusRow.rows[0].name;
  console.log(`✅ Found Mattius: ${mattiusName} (${mattiusId})`);

  // ── 3. Create fake users ───────────────────────────────────────────────────
  const users: Array<{ id: string; name: string; username: string }> = [];

  const fakeUsers = [
    {
      email: "marcus.j@paceup.dev",
      name: "Marcus Johnson",
      username: "marcus_j",
      avg_pace: 7.8,
      total_miles: 312.4,
      miles_this_year: 198.6,
      miles_this_month: 42.3,
      completed_runs: 47,
      hosted_runs: 28,
      host_unlocked: true,
      role: "host",
      avg_rating: 4.9,
      rating_count: 24,
      photo_url: "https://images.unsplash.com/photo-1567013127542-490d757e51cd?w=200&h=200&fit=crop&crop=face",
    },
    {
      email: "emma.r@paceup.dev",
      name: "Emma Rodriguez",
      username: "emma_runs",
      avg_pace: 8.5,
      total_miles: 241.2,
      miles_this_year: 156.8,
      miles_this_month: 38.1,
      completed_runs: 39,
      hosted_runs: 6,
      host_unlocked: false,
      role: "runner",
      avg_rating: 4.7,
      rating_count: 12,
      photo_url: "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=200&h=200&fit=crop&crop=face",
    },
    {
      email: "sarah.c@paceup.dev",
      name: "Sarah Chen",
      username: "sarah_chen",
      avg_pace: 9.2,
      total_miles: 178.5,
      miles_this_year: 121.3,
      miles_this_month: 29.7,
      completed_runs: 31,
      hosted_runs: 4,
      host_unlocked: false,
      role: "runner",
      avg_rating: 4.8,
      rating_count: 9,
      photo_url: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&h=200&fit=crop&crop=face",
    },
    {
      email: "jake.w@paceup.dev",
      name: "Jake Williams",
      username: "jake_w",
      avg_pace: 8.0,
      total_miles: 289.7,
      miles_this_year: 174.2,
      miles_this_month: 35.6,
      completed_runs: 52,
      hosted_runs: 31,
      host_unlocked: true,
      role: "host",
      avg_rating: 4.8,
      rating_count: 19,
      photo_url: "https://images.unsplash.com/photo-1552058544-f2b08422138a?w=200&h=200&fit=crop&crop=face",
    },
    {
      email: "olivia.d@paceup.dev",
      name: "Olivia Davis",
      username: "olivia_d",
      avg_pace: 9.8,
      total_miles: 134.6,
      miles_this_year: 89.4,
      miles_this_month: 21.8,
      completed_runs: 22,
      hosted_runs: 2,
      host_unlocked: false,
      role: "runner",
      avg_rating: 4.6,
      rating_count: 7,
      photo_url: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop&crop=face",
    },
    {
      email: "noah.t@paceup.dev",
      name: "Noah Thompson",
      username: "noah_t",
      avg_pace: 8.3,
      total_miles: 267.9,
      miles_this_year: 162.5,
      miles_this_month: 33.2,
      completed_runs: 44,
      hosted_runs: 8,
      host_unlocked: false,
      role: "runner",
      avg_rating: 4.9,
      rating_count: 11,
      photo_url: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop&crop=face",
    },
    {
      email: "ava.m@paceup.dev",
      name: "Ava Martinez",
      username: "ava_m",
      avg_pace: 10.1,
      total_miles: 98.3,
      miles_this_year: 67.1,
      miles_this_month: 18.4,
      completed_runs: 16,
      hosted_runs: 1,
      host_unlocked: false,
      role: "runner",
      avg_rating: 4.5,
      rating_count: 5,
      photo_url: "https://images.unsplash.com/photo-1489424731084-a5d8b219a5bb?w=200&h=200&fit=crop&crop=face",
    },
    {
      email: "liam.w@paceup.dev",
      name: "Liam Wilson",
      username: "liam_w",
      avg_pace: 7.5,
      total_miles: 398.4,
      miles_this_year: 241.7,
      miles_this_month: 51.3,
      completed_runs: 61,
      hosted_runs: 38,
      host_unlocked: true,
      role: "host",
      avg_rating: 5.0,
      rating_count: 31,
      photo_url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face",
    },
    {
      email: "mia.a@paceup.dev",
      name: "Mia Anderson",
      username: "mia_a",
      avg_pace: 9.5,
      total_miles: 156.2,
      miles_this_year: 103.8,
      miles_this_month: 24.6,
      completed_runs: 27,
      hosted_runs: 3,
      host_unlocked: false,
      role: "runner",
      avg_rating: 4.7,
      rating_count: 8,
      photo_url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop&crop=face",
    },
    {
      email: "carlos.r@paceup.dev",
      name: "Carlos Rivera",
      username: "carlos_r",
      avg_pace: 8.7,
      total_miles: 224.8,
      miles_this_year: 138.9,
      miles_this_month: 28.4,
      completed_runs: 36,
      hosted_runs: 15,
      host_unlocked: true,
      role: "host",
      avg_rating: 4.8,
      rating_count: 14,
      photo_url: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200&h=200&fit=crop&crop=face",
    },
  ];

  for (const u of fakeUsers) {
    const res = await pool.query(
      `INSERT INTO users (email, password, name, username, avg_pace, total_miles, miles_this_year, miles_this_month,
        completed_runs, hosted_runs, host_unlocked, role, avg_rating, rating_count, photo_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::user_role,$13,$14,$15)
       ON CONFLICT (email) DO UPDATE SET
         name=EXCLUDED.name, username=EXCLUDED.username, avg_pace=EXCLUDED.avg_pace,
         total_miles=EXCLUDED.total_miles, miles_this_year=EXCLUDED.miles_this_year,
         miles_this_month=EXCLUDED.miles_this_month, completed_runs=EXCLUDED.completed_runs,
         hosted_runs=EXCLUDED.hosted_runs, host_unlocked=EXCLUDED.host_unlocked,
         role=EXCLUDED.role, avg_rating=EXCLUDED.avg_rating, rating_count=EXCLUDED.rating_count,
         photo_url=EXCLUDED.photo_url
       RETURNING id, name, username`,
      [u.email, hashedPassword, u.name, u.username, u.avg_pace, u.total_miles,
       u.miles_this_year, u.miles_this_month, u.completed_runs, u.hosted_runs,
       u.host_unlocked, u.role, u.avg_rating, u.rating_count, u.photo_url]
    );
    users.push(res.rows[0]);
    console.log(`  👤 Upserted user: ${res.rows[0].name}`);
  }

  const [marcus, emma, sarah, jake, olivia, noah, ava, liam, mia, carlos] = users;

  // ── 4. Create crews ────────────────────────────────────────────────────────
  console.log("\n🏃 Creating crews...");

  async function upsertCrew(name: string, emoji: string, description: string, createdBy: string, runStyle: string, tags: string[]) {
    const existing = await pool.query(`SELECT id FROM crews WHERE name = $1 LIMIT 1`, [name]);
    if (existing.rows.length > 0) return existing.rows[0].id as string;
    const res = await pool.query(
      `INSERT INTO crews (name, emoji, description, created_by, run_style, tags)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [name, emoji, description, createdBy, runStyle, tags]
    );
    return res.rows[0].id as string;
  }

  const speedSquadId = await upsertCrew(
    "Speed Squad", "🏃", "Houston's fastest social runners. We push each other every Tuesday & Thursday at Memorial Park.",
    marcus.id, "tempo", ["fast", "tempo", "houston", "memorial-park"]
  );
  const trailBlazersId = await upsertCrew(
    "Trail Blazers", "🌲", "Exploring Houston's bayou trails and green spaces. All paces welcome, good vibes only.",
    jake.id, "trail", ["trail", "bayou", "nature", "houston"]
  );
  const midnightRidersId = await upsertCrew(
    "Midnight Riders", "🚴", "Houston road cyclists. Sunday long rides, Tuesday spins. Come for the miles, stay for the coffee.",
    liam.id, "distance", ["cycling", "road", "houston", "terry-hershey"]
  );

  console.log(`  ✅ Speed Squad (${speedSquadId})`);
  console.log(`  ✅ Trail Blazers (${trailBlazersId})`);
  console.log(`  ✅ Midnight Riders (${midnightRidersId})`);

  // ── 5. Add crew members ────────────────────────────────────────────────────
  console.log("\n👥 Adding crew members...");

  async function addCrewMember(crewId: string, userId: string, invitedBy: string, status = "member") {
    await pool.query(
      `INSERT INTO crew_members (crew_id, user_id, status, invited_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (crew_id, user_id) DO UPDATE SET status = EXCLUDED.status`,
      [crewId, userId, status, invitedBy]
    );
  }

  // Speed Squad members
  await addCrewMember(speedSquadId, marcus.id, marcus.id);
  await addCrewMember(speedSquadId, emma.id, marcus.id);
  await addCrewMember(speedSquadId, sarah.id, marcus.id);
  await addCrewMember(speedSquadId, noah.id, marcus.id);
  await addCrewMember(speedSquadId, carlos.id, marcus.id);
  await addCrewMember(speedSquadId, mia.id, marcus.id);

  // Trail Blazers members
  await addCrewMember(trailBlazersId, jake.id, jake.id);
  await addCrewMember(trailBlazersId, olivia.id, jake.id);
  await addCrewMember(trailBlazersId, ava.id, jake.id);
  await addCrewMember(trailBlazersId, emma.id, jake.id);
  await addCrewMember(trailBlazersId, sarah.id, jake.id);
  await addCrewMember(trailBlazersId, liam.id, jake.id);

  // Midnight Riders members
  await addCrewMember(midnightRidersId, liam.id, liam.id);
  await addCrewMember(midnightRidersId, carlos.id, liam.id);
  await addCrewMember(midnightRidersId, marcus.id, liam.id);
  await addCrewMember(midnightRidersId, noah.id, liam.id);
  await addCrewMember(midnightRidersId, jake.id, liam.id);

  // Invite Mattius to all 3 crews as pending
  await addCrewMember(speedSquadId, mattiusId, marcus.id, "pending");
  await addCrewMember(trailBlazersId, mattiusId, jake.id, "pending");
  await addCrewMember(midnightRidersId, mattiusId, liam.id, "pending");
  console.log(`  📨 Invited Mattius to all 3 crews`);

  // ── 6. Upcoming group runs ─────────────────────────────────────────────────
  console.log("\n🗓️  Creating upcoming runs & rides...");

  function daysFromNow(d: number, hour = 6, min = 0) {
    const dt = new Date();
    dt.setDate(dt.getDate() + d);
    dt.setHours(hour, min, 0, 0);
    return dt.toISOString();
  }

  async function createRun(data: {
    hostId: string; title: string; description: string; date: string;
    lat: number; lng: number; locationName: string;
    minDist: number; maxDist: number; minPace: number; maxPace: number;
    maxParticipants?: number; tags?: string[]; activityType?: string;
    crewId?: string; runStyle?: string;
  }) {
    const existing = await pool.query(
      `SELECT id FROM runs WHERE title = $1 AND host_id = $2 AND date = $3 LIMIT 1`,
      [data.title, data.hostId, data.date]
    );
    if (existing.rows.length > 0) return existing.rows[0].id as string;
    const res = await pool.query(
      `INSERT INTO runs (host_id, title, description, privacy, date, location_lat, location_lng,
        location_name, min_distance, max_distance, min_pace, max_pace, max_participants,
        tags, activity_type, crew_id, run_style)
       VALUES ($1,$2,$3,'public',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [data.hostId, data.title, data.description, data.date, data.lat, data.lng,
       data.locationName, data.minDist, data.maxDist, data.minPace, data.maxPace,
       data.maxParticipants ?? 20, data.tags ?? [], data.activityType ?? "run",
       data.crewId ?? null, data.runStyle ?? null]
    );
    return res.rows[0].id as string;
  }

  async function addParticipants(runId: string, userIds: string[]) {
    for (const uid of userIds) {
      await pool.query(
        `INSERT INTO run_participants (run_id, user_id, status) VALUES ($1,$2,'joined')
         ON CONFLICT DO NOTHING`,
        [runId, uid]
      );
    }
  }

  const run1 = await createRun({
    hostId: marcus.id,
    title: "6AM Tempo Run — Memorial Park",
    description: "Speed Squad's weekly Tuesday tempo. We warm up at the tennis center parking lot and do 2 loops of the 3-mile trail. Expect 8:00–8:30 avg pace. All are welcome to join!",
    date: daysFromNow(1, 6, 0),
    lat: 29.7658, lng: -95.4322, locationName: "Memorial Park, Houston, TX",
    minDist: 5.0, maxDist: 8.0, minPace: 7.5, maxPace: 9.0,
    tags: ["tempo", "memorial-park", "morning"], runStyle: "tempo", crewId: speedSquadId,
  });
  await addParticipants(run1, [emma.id, noah.id, carlos.id, sarah.id]);

  const run2 = await createRun({
    hostId: jake.id,
    title: "Buffalo Bayou Saturday Long Run",
    description: "Easy long run along the bayou trails. Starting at Sabine to Waugh Bridge and back. Conversational pace — let's enjoy the views. Water fountains at both ends.",
    date: daysFromNow(3, 7, 0),
    lat: 29.7575, lng: -95.3779, locationName: "Buffalo Bayou Park, Houston, TX",
    minDist: 8.0, maxDist: 12.0, minPace: 9.0, maxPace: 11.5,
    tags: ["long-run", "bayou", "trails"], runStyle: "long", crewId: trailBlazersId,
  });
  await addParticipants(run2, [olivia.id, ava.id, liam.id, mia.id, sarah.id]);

  const run3 = await createRun({
    hostId: emma.id,
    title: "Hermann Park 5K Morning Run",
    description: "Super casual 5K loop around Hermann Park. Meeting by the fountain near the Japanese Garden. Perfect if you want a chill midweek run with good company ☀️",
    date: daysFromNow(2, 6, 30),
    lat: 29.7215, lng: -95.3906, locationName: "Hermann Park, Houston, TX",
    minDist: 3.0, maxDist: 5.0, minPace: 9.0, maxPace: 11.0,
    tags: ["5k", "beginner-friendly", "morning"],
  });
  await addParticipants(run3, [mia.id, ava.id, sarah.id, mattiusId]);

  const run4 = await createRun({
    hostId: carlos.id,
    title: "Spotts Park Intervals",
    description: "Track-style interval workout at Spotts Park. 6×800m at 5K race pace with 2 min rest. Bring your A game 💪 We meet at the park entrance off Allen Pkwy.",
    date: daysFromNow(2, 5, 45),
    lat: 29.7624, lng: -95.4234, locationName: "Spotts Park, Houston, TX",
    minDist: 4.0, maxDist: 6.0, minPace: 7.0, maxPace: 8.5,
    tags: ["intervals", "speed-work", "track"],
  });
  await addParticipants(run4, [marcus.id, noah.id, jake.id]);

  const run5 = await createRun({
    hostId: liam.id,
    title: "Sunday Long Ride — Terry Hershey Park",
    description: "Midnight Riders weekly long ride. Meeting at the Bear Creek trailhead. Doing the full Terry Hershey trail out and back, ~25 miles. No drop policy — we ride together!",
    date: daysFromNow(4, 7, 30),
    lat: 29.7415, lng: -95.5821, locationName: "Terry Hershey Park, Houston, TX",
    minDist: 20.0, maxDist: 30.0, minPace: 5.5, maxPace: 7.0,
    tags: ["cycling", "long-ride", "terry-hershey"], activityType: "ride", crewId: midnightRidersId, runStyle: "long",
  });
  await addParticipants(run5, [carlos.id, marcus.id, noah.id, jake.id]);

  const run6 = await createRun({
    hostId: noah.id,
    title: "White Oak Bayou Greenway Run",
    description: "Exploring the White Oak Bayou trail from the Heights. 6-mile out-and-back through the Heights neighborhood. Great scenery, paved path the whole way.",
    date: daysFromNow(5, 6, 0),
    lat: 29.7738, lng: -95.3869, locationName: "White Oak Bayou, Houston, TX",
    minDist: 5.0, maxDist: 7.0, minPace: 8.5, maxPace: 10.5,
    tags: ["bayou", "heights", "greenway"],
  });
  await addParticipants(run6, [sarah.id, mia.id, emma.id, mattiusId]);

  const run7 = await createRun({
    hostId: jake.id,
    title: "Friday Night Easy Run — Discovery Green",
    description: "Wrapping up the week with a relaxed 4-miler around Discovery Green and downtown. Post-run beers at the lawn 🍺 All paces welcome, no one gets left behind!",
    date: daysFromNow(5, 18, 30),
    lat: 29.7530, lng: -95.3677, locationName: "Discovery Green, Houston, TX",
    minDist: 3.0, maxDist: 5.0, minPace: 9.5, maxPace: 12.0,
    tags: ["easy", "social", "downtown", "evening"],
  });
  await addParticipants(run7, [olivia.id, ava.id, mia.id, carlos.id, noah.id]);

  const run8 = await createRun({
    hostId: marcus.id,
    title: "Speed Squad Thursday Tempo",
    description: "Our other weekly tempo run! Galleria-area loop, about 6 miles at a solid pace. We start sharp at 6am. If you're late we're gone 😂 Strava segment challenge on the Westheimer stretch.",
    date: daysFromNow(6, 6, 0),
    lat: 29.7368, lng: -95.4613, locationName: "Galleria Area, Houston, TX",
    minDist: 5.0, maxDist: 7.0, minPace: 7.5, maxPace: 9.0,
    tags: ["tempo", "galleria", "speed-squad"], crewId: speedSquadId,
  });
  await addParticipants(run8, [emma.id, noah.id, carlos.id, sarah.id, mia.id]);

  console.log(`  ✅ Created 8 upcoming runs/rides`);

  // ── 7. Completed past runs for leaderboard ─────────────────────────────────
  console.log("\n🏆 Creating completed runs for leaderboard...");

  async function createCompletedRun(data: {
    hostId: string; title: string; date: string; lat: number; lng: number;
    locationName: string; minDist: number; maxDist: number;
    activityType?: string; crewId?: string;
    participants: Array<{ userId: string; finalDistance: number; finalPace: number }>;
  }) {
    const existing = await pool.query(
      `SELECT id FROM runs WHERE title = $1 AND host_id = $2 AND date = $3 LIMIT 1`,
      [data.title, data.hostId, data.date]
    );
    let runId: string;
    if (existing.rows.length > 0) {
      runId = existing.rows[0].id;
    } else {
      const res = await pool.query(
        `INSERT INTO runs (host_id, title, privacy, date, location_lat, location_lng, location_name,
          min_distance, max_distance, min_pace, max_pace, is_completed, activity_type, crew_id)
         VALUES ($1,$2,'public',$3,$4,$5,$6,$7,$8,8.0,10.0,true,$9,$10) RETURNING id`,
        [data.hostId, data.title, data.date, data.lat, data.lng, data.locationName,
         data.minDist, data.maxDist, data.activityType ?? "run", data.crewId ?? null]
      );
      runId = res.rows[0].id;
    }
    for (const p of data.participants) {
      await pool.query(
        `INSERT INTO run_participants (run_id, user_id, status, final_distance, final_pace)
         VALUES ($1,$2,'confirmed',$3,$4)
         ON CONFLICT DO NOTHING`,
        [runId, p.userId, p.finalDistance, p.finalPace]
      );
    }
    return runId;
  }

  function weeksAgo(w: number, hour = 7) {
    const dt = new Date();
    dt.setDate(dt.getDate() - w * 7);
    dt.setHours(hour, 0, 0, 0);
    return dt.toISOString();
  }

  // Speed Squad completed runs (drives crew leaderboard miles)
  await createCompletedRun({
    hostId: marcus.id, title: "Speed Squad — Memorial Park Tempo (Past)",
    date: weeksAgo(1), lat: 29.7658, lng: -95.4322, locationName: "Memorial Park, Houston, TX",
    minDist: 5.0, maxDist: 8.0, crewId: speedSquadId,
    participants: [
      { userId: marcus.id, finalDistance: 6.2, finalPace: 7.8 },
      { userId: emma.id, finalDistance: 5.8, finalPace: 8.5 },
      { userId: noah.id, finalDistance: 6.2, finalPace: 8.3 },
      { userId: carlos.id, finalDistance: 6.0, finalPace: 8.7 },
      { userId: sarah.id, finalDistance: 5.5, finalPace: 9.1 },
    ],
  });

  await createCompletedRun({
    hostId: marcus.id, title: "Speed Squad — Galleria Thursday (Past)",
    date: weeksAgo(2), lat: 29.7368, lng: -95.4613, locationName: "Galleria Area, Houston, TX",
    minDist: 5.0, maxDist: 7.0, crewId: speedSquadId,
    participants: [
      { userId: marcus.id, finalDistance: 6.5, finalPace: 7.9 },
      { userId: emma.id, finalDistance: 6.1, finalPace: 8.6 },
      { userId: noah.id, finalDistance: 6.5, finalPace: 8.4 },
      { userId: carlos.id, finalDistance: 6.3, finalPace: 8.8 },
      { userId: mia.id, finalDistance: 5.9, finalPace: 9.5 },
    ],
  });

  await createCompletedRun({
    hostId: carlos.id, title: "Speed Squad — Spotts Park Speed Work (Past)",
    date: weeksAgo(3), lat: 29.7624, lng: -95.4234, locationName: "Spotts Park, Houston, TX",
    minDist: 4.0, maxDist: 6.0, crewId: speedSquadId,
    participants: [
      { userId: carlos.id, finalDistance: 5.0, finalPace: 8.2 },
      { userId: marcus.id, finalDistance: 5.0, finalPace: 7.7 },
      { userId: noah.id, finalDistance: 4.8, finalPace: 8.3 },
      { userId: emma.id, finalDistance: 4.5, finalPace: 8.6 },
    ],
  });

  // Trail Blazers completed runs
  await createCompletedRun({
    hostId: jake.id, title: "Trail Blazers — Buffalo Bayou Long Run (Past)",
    date: weeksAgo(1, 8), lat: 29.7575, lng: -95.3779, locationName: "Buffalo Bayou Park, Houston, TX",
    minDist: 8.0, maxDist: 12.0, crewId: trailBlazersId,
    participants: [
      { userId: jake.id, finalDistance: 10.2, finalPace: 8.1 },
      { userId: olivia.id, finalDistance: 9.8, finalPace: 9.9 },
      { userId: ava.id, finalDistance: 9.5, finalPace: 10.2 },
      { userId: liam.id, finalDistance: 10.2, finalPace: 7.6 },
      { userId: sarah.id, finalDistance: 9.1, finalPace: 9.3 },
    ],
  });

  await createCompletedRun({
    hostId: jake.id, title: "Trail Blazers — Hermann Park Loop (Past)",
    date: weeksAgo(2, 7), lat: 29.7215, lng: -95.3906, locationName: "Hermann Park, Houston, TX",
    minDist: 5.0, maxDist: 8.0, crewId: trailBlazersId,
    participants: [
      { userId: jake.id, finalDistance: 6.8, finalPace: 8.0 },
      { userId: emma.id, finalDistance: 6.4, finalPace: 8.6 },
      { userId: ava.id, finalDistance: 6.2, finalPace: 10.1 },
      { userId: mia.id, finalDistance: 6.0, finalPace: 9.6 },
    ],
  });

  await createCompletedRun({
    hostId: liam.id, title: "Trail Blazers — White Oak Greenway (Past)",
    date: weeksAgo(3, 6), lat: 29.7738, lng: -95.3869, locationName: "White Oak Bayou, Houston, TX",
    minDist: 6.0, maxDist: 9.0, crewId: trailBlazersId,
    participants: [
      { userId: liam.id, finalDistance: 7.5, finalPace: 7.7 },
      { userId: jake.id, finalDistance: 7.5, finalPace: 8.0 },
      { userId: olivia.id, finalDistance: 7.2, finalPace: 9.8 },
      { userId: sarah.id, finalDistance: 7.0, finalPace: 9.2 },
      { userId: emma.id, finalDistance: 7.3, finalPace: 8.5 },
    ],
  });

  // Midnight Riders completed rides
  await createCompletedRun({
    hostId: liam.id, title: "Midnight Riders — Terry Hershey Ride (Past)",
    date: weeksAgo(1, 7), lat: 29.7415, lng: -95.5821, locationName: "Terry Hershey Park, Houston, TX",
    minDist: 20.0, maxDist: 30.0, activityType: "ride", crewId: midnightRidersId,
    participants: [
      { userId: liam.id, finalDistance: 28.4, finalPace: 5.1 },
      { userId: carlos.id, finalDistance: 26.8, finalPace: 5.4 },
      { userId: marcus.id, finalDistance: 27.1, finalPace: 5.2 },
      { userId: noah.id, finalDistance: 25.9, finalPace: 5.6 },
    ],
  });

  await createCompletedRun({
    hostId: carlos.id, title: "Midnight Riders — Galveston Road Ride (Past)",
    date: weeksAgo(2, 8), lat: 29.7415, lng: -95.5500, locationName: "Katy, TX (Westpark Tollway Trail)",
    minDist: 25.0, maxDist: 40.0, activityType: "ride", crewId: midnightRidersId,
    participants: [
      { userId: carlos.id, finalDistance: 38.2, finalPace: 4.9 },
      { userId: liam.id, finalDistance: 38.2, finalPace: 5.0 },
      { userId: jake.id, finalDistance: 36.5, finalPace: 5.3 },
      { userId: marcus.id, finalDistance: 35.9, finalPace: 5.2 },
    ],
  });

  console.log(`  ✅ Created 8 completed runs/rides for leaderboard`);

  // ── 8. Solo runs with GPS routes for map pins ──────────────────────────────
  console.log("\n📍 Adding solo GPS runs for map pins...");

  const routeConfigs = [
    { userId: marcus.id, route: memorialParkLoop(), dist: 5.8, pace: 7.8, dur: 2714, date: weeksAgo(0.1, 5), title: "Morning Memorial Loop" },
    { userId: emma.id, route: buffaloByouRoute(), dist: 4.2, pace: 8.5, dur: 2142, date: weeksAgo(0.2, 6), title: "Bayou Morning Run" },
    { userId: jake.id, route: hermannParkRoute(), dist: 3.8, pace: 8.1, dur: 1847, date: weeksAgo(0.3, 7), title: "Hermann Park Loop" },
    { userId: liam.id, route: terryHersheyRide(), dist: 24.6, pace: 5.1, dur: 7520, date: weeksAgo(0.4, 7), title: "Terry Hershey Ride", activityType: "ride" },
    { userId: noah.id, route: spotsRoute(), dist: 4.4, pace: 8.3, dur: 2191, date: weeksAgo(0.5, 6), title: "Spotts Park Run" },
    { userId: carlos.id, route: memorialParkLoop(), dist: 6.2, pace: 8.7, dur: 3237, date: weeksAgo(0.6, 5), title: "Memorial Tempo" },
    { userId: sarah.id, route: hermannParkRoute(), dist: 3.1, pace: 9.2, dur: 1712, date: weeksAgo(0.3, 7), title: "Easy Hermann 5K" },
    { userId: olivia.id, route: buffaloByouRoute(), dist: 4.0, pace: 9.8, dur: 2352, date: weeksAgo(0.7, 6), title: "Bayou Easy Run" },
    { userId: ava.id, route: spotsRoute(), dist: 3.5, pace: 10.1, dur: 2121, date: weeksAgo(0.4, 8), title: "Spotts Park Jog" },
    { userId: mia.id, route: hermannParkRoute(), dist: 3.4, pace: 9.5, dur: 1938, date: weeksAgo(0.8, 6), title: "Hermann Morning Run" },
  ];

  for (const r of routeConfigs) {
    const existing = await pool.query(
      `SELECT id FROM solo_runs WHERE user_id = $1 AND title = $2 LIMIT 1`,
      [r.userId, r.title]
    );
    if (existing.rows.length > 0) continue;
    await pool.query(
      `INSERT INTO solo_runs (user_id, title, date, distance_miles, pace_min_per_mile, duration_seconds,
        completed, planned, activity_type, route_path)
       VALUES ($1,$2,$3,$4,$5,$6,true,false,$7,$8)`,
      [r.userId, r.title, r.date, r.dist, r.pace, r.dur,
       (r as any).activityType ?? "run", JSON.stringify(r.route)]
    );
  }
  console.log(`  ✅ Added ${routeConfigs.length} solo GPS runs`);

  // ── 9. Mattius solo runs so their stats page looks good ────────────────────
  const mattiusSoloDates = [
    { days: 1, dist: 4.1, pace: 9.1, dur: 2244, route: spotsRoute(), title: "Evening Run", activityType: "run" },
    { days: 4, dist: 5.8, pace: 8.8, dur: 3062, route: memorialParkLoop(), title: "Memorial Park Loop", activityType: "run" },
    { days: 8, dist: 3.2, pace: 9.4, dur: 1807, route: hermannParkRoute(), title: "Hermann Park 5K", activityType: "run" },
    { days: 14, dist: 6.3, pace: 8.6, dur: 3254, route: buffaloByouRoute(), title: "Bayou Saturday Run", activityType: "run" },
    { days: 21, dist: 4.6, pace: 9.0, dur: 2484, route: spotsRoute(), title: "Tuesday Tempo", activityType: "run" },
  ];
  for (const r of mattiusSoloDates) {
    const dAgo = new Date();
    dAgo.setDate(dAgo.getDate() - r.days);
    dAgo.setHours(6, 30, 0, 0);
    const existing = await pool.query(
      `SELECT id FROM solo_runs WHERE user_id = $1 AND title = $2 LIMIT 1`,
      [mattiusId, r.title]
    );
    if (existing.rows.length > 0) continue;
    await pool.query(
      `INSERT INTO solo_runs (user_id, title, date, distance_miles, pace_min_per_mile, duration_seconds,
        completed, planned, activity_type, route_path)
       VALUES ($1,$2,$3,$4,$5,$6,true,false,$7,$8)`,
      [mattiusId, r.title, dAgo.toISOString(), r.dist, r.pace, r.dur, r.activityType, JSON.stringify(r.route)]
    );
  }
  // Update Mattius's stats
  await pool.query(
    `UPDATE users SET total_miles = 24.0, miles_this_year = 24.0, miles_this_month = 10.0,
      avg_pace = 9.0, completed_runs = 5 WHERE id = $1`,
    [mattiusId]
  );
  console.log(`  ✅ Added solo runs and stats for Mattius`);

  // ── 10. Friends ────────────────────────────────────────────────────────────
  console.log("\n🤝 Creating friend relationships...");

  async function addFriendship(a: string, b: string, status = "accepted") {
    await pool.query(
      `INSERT INTO friends (requester_id, addressee_id, status)
       VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [a, b, status]
    );
  }

  await addFriendship(marcus.id, emma.id);
  await addFriendship(marcus.id, noah.id);
  await addFriendship(marcus.id, carlos.id);
  await addFriendship(jake.id, liam.id);
  await addFriendship(jake.id, olivia.id);
  await addFriendship(sarah.id, mia.id);
  await addFriendship(sarah.id, ava.id);
  await addFriendship(emma.id, sarah.id);
  await addFriendship(noah.id, carlos.id);
  await addFriendship(liam.id, carlos.id);
  // Pending requests TO Mattius
  await addFriendship(emma.id, mattiusId, "pending");
  await addFriendship(marcus.id, mattiusId, "pending");
  await addFriendship(noah.id, mattiusId, "pending");
  console.log(`  ✅ Created friendships + 3 pending requests to Mattius`);

  // ── 11. Crew achievements ──────────────────────────────────────────────────
  console.log("\n🏅 Adding crew achievements...");

  async function addCrewAchievement(crewId: string, key: string, value: number) {
    await pool.query(
      `INSERT INTO crew_achievements (crew_id, achievement_key, achieved_value)
       VALUES ($1,$2,$3)
       ON CONFLICT (crew_id, achievement_key) DO NOTHING`,
      [crewId, key, value]
    );
  }

  await addCrewAchievement(speedSquadId, "first_run", 1);
  await addCrewAchievement(speedSquadId, "runs_10", 10);
  await addCrewAchievement(speedSquadId, "miles_100", 158.4);
  await addCrewAchievement(speedSquadId, "members_5", 6);

  await addCrewAchievement(trailBlazersId, "first_run", 1);
  await addCrewAchievement(trailBlazersId, "runs_10", 10);
  await addCrewAchievement(trailBlazersId, "miles_100", 133.7);
  await addCrewAchievement(trailBlazersId, "members_5", 6);

  await addCrewAchievement(midnightRidersId, "first_run", 1);
  await addCrewAchievement(midnightRidersId, "miles_100", 154.4);
  await addCrewAchievement(midnightRidersId, "members_5", 5);

  console.log(`  ✅ Added crew achievements`);

  // ── 12. Crew chat messages ─────────────────────────────────────────────────
  console.log("\n💬 Seeding crew chat messages...");

  async function addCrewMsg(crewId: string, userId: string, name: string, photo: string | null, message: string, minsAgo: number) {
    const ts = new Date(Date.now() - minsAgo * 60 * 1000);
    await pool.query(
      `INSERT INTO crew_messages (crew_id, user_id, sender_name, sender_photo, message, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [crewId, userId, name, photo, message, ts.toISOString()]
    );
  }

  const mPhoto = "https://images.unsplash.com/photo-1567013127542-490d757e51cd?w=200&h=200&fit=crop&crop=face";
  const ePhoto = "https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=200&h=200&fit=crop&crop=face";
  const sPhoto = "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=200&h=200&fit=crop&crop=face";
  const nPhoto = "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop&crop=face";
  const cPhoto = "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200&h=200&fit=crop&crop=face";
  const jPhoto = "https://images.unsplash.com/photo-1552058544-f2b08422138a?w=200&h=200&fit=crop&crop=face";
  const lPhoto = "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face";

  await addCrewMsg(speedSquadId, marcus.id, "Marcus Johnson", mPhoto, "Who's locking in for tomorrow's tempo? 6am sharp at the tennis center lot 🔥", 420);
  await addCrewMsg(speedSquadId, emma.id, "Emma Rodriguez", ePhoto, "I'm in! Should be a good one, weather looks perfect 🌤️", 410);
  await addCrewMsg(speedSquadId, noah.id, "Noah Thompson", nPhoto, "Same, been working on my turnover all week. Ready to test it 💪", 400);
  await addCrewMsg(speedSquadId, carlos.id, "Carlos Rivera", cPhoto, "Count me in. Anyone doing strides beforehand?", 390);
  await addCrewMsg(speedSquadId, marcus.id, "Marcus Johnson", mPhoto, "Yeah I'll be there at 5:50 for warmup strides. Join me!", 380);
  await addCrewMsg(speedSquadId, sarah.id, "Sarah Chen", sPhoto, "I'll try to make it, might be a few minutes late. Save me a spot!", 120);
  await addCrewMsg(speedSquadId, emma.id, "Emma Rodriguez", ePhoto, "We'll do a slow first mile as warmup so you can catch up 😊", 110);
  await addCrewMsg(speedSquadId, noah.id, "Noah Thompson", nPhoto, "Just PR'd my 5K on Strava this morning btw 👀 feeling DIALED", 60);
  await addCrewMsg(speedSquadId, marcus.id, "Marcus Johnson", mPhoto, "Yooo let's go! We're bringing you to sub-19 before the year's out 🏆", 30);

  await addCrewMsg(trailBlazersId, jake.id, "Jake Williams", jPhoto, "Saturday long run is ON. Buffalo Bayou, 8am start. Shooting for 10 miles easy.", 600);
  await addCrewMsg(trailBlazersId, liam.id, "Liam Wilson", lPhoto, "Perfect — I'll bring extra Gu gels for anyone who needs them", 590);
  await addCrewMsg(trailBlazersId, emma.id, "Emma Rodriguez", ePhoto, "So excited for this one! Is the trail flooded near the Waugh Bridge still?", 580);
  await addCrewMsg(trailBlazersId, jake.id, "Jake Williams", jPhoto, "Checked this morning — all clear! They fixed the drainage last week", 575);
  await addCrewMsg(trailBlazersId, liam.id, "Liam Wilson", lPhoto, "Great news. Will there be water stops on the route?", 300);
  await addCrewMsg(trailBlazersId, jake.id, "Jake Williams", jPhoto, "Fountain at Sabine, one at Waugh. Should be fine for 10 miles but bring a handheld if it's hot", 280);
  await addCrewMsg(trailBlazersId, emma.id, "Emma Rodriguez", ePhoto, "It's Houston in summer so... yes it will be hot lol 😂", 90);

  await addCrewMsg(midnightRidersId, liam.id, "Liam Wilson", lPhoto, "Sunday ride is a go. Terry Hershey full trail, 7:30am start. Aiming for 28 miles 🚴", 800);
  await addCrewMsg(midnightRidersId, carlos.id, "Carlos Rivera", cPhoto, "YES. Been waiting for this one. My legs are fresh after taking Wednesday off", 790);
  await addCrewMsg(midnightRidersId, marcus.id, "Marcus Johnson", mPhoto, "I'm in. Just serviced my bike yesterday so should be smooth sailing", 780);
  await addCrewMsg(midnightRidersId, jake.id, "Jake Williams", jPhoto, "Solid. Anyone doing the optional extra loop on Barker Reservoir?", 400);
  await addCrewMsg(midnightRidersId, liam.id, "Liam Wilson", lPhoto, "If legs feel good after the main route, absolutely. No pressure though", 395);
  await addCrewMsg(midnightRidersId, carlos.id, "Carlos Rivera", cPhoto, "I'm down for the extra loop. After last week's ride I know I have it in me 💪", 200);
  await addCrewMsg(midnightRidersId, marcus.id, "Marcus Johnson", mPhoto, "Same, let's do it. Coffee after at 1940 Coffee & Tea?", 100);
  await addCrewMsg(midnightRidersId, liam.id, "Liam Wilson", lPhoto, "Obviously 😂 that's the whole reason I ride", 50);

  console.log(`  ✅ Added crew chat messages`);

  // ── 13. Direct messages to Mattius ────────────────────────────────────────
  console.log("\n📩 Seeding DMs to Mattius...");

  async function addDM(senderId: string, recipientId: string, message: string, minsAgo: number) {
    const ts = new Date(Date.now() - minsAgo * 60 * 1000);
    await pool.query(
      `INSERT INTO direct_messages (sender_id, recipient_id, message, created_at, read_at)
       VALUES ($1,$2,$3,$4,NULL)`,
      [senderId, recipientId, message, ts.toISOString()]
    );
  }

  await addDM(emma.id, mattiusId, "Hey! Saw you at Hermann Park this morning, great pace! 👋", 180);
  await addDM(emma.id, mattiusId, "You should come to the Trail Blazers Saturday run, super chill group 😊", 175);
  await addDM(marcus.id, mattiusId, "Yo what's up! Marcus here — you should join Speed Squad, we run Tuesdays and Thursdays at Memorial Park 🏃", 240);
  await addDM(marcus.id, mattiusId, "We've got runners of all paces, but we do push each other. You down?", 238);
  await addDM(noah.id, mattiusId, "Hey! We've got a group run at White Oak Bayou this Friday evening — you in?", 60);

  console.log(`  ✅ Added DMs to Mattius`);

  // ── Done ───────────────────────────────────────────────────────────────────
  console.log("\n✅ Demo seed complete!");
  console.log("   - 10 users created");
  console.log("   - 3 crews (Speed Squad, Trail Blazers, Midnight Riders)");
  console.log("   - Mattius invited to all 3 crews (pending)");
  console.log("   - 8 upcoming runs/rides in Houston");
  console.log("   - 8 completed runs for leaderboard data");
  console.log("   - GPS solo runs for map pins (Memorial Park, Buffalo Bayou, Hermann Park, Terry Hershey)");
  console.log("   - 3 pending friend requests to Mattius");
  console.log("   - Crew achievements unlocked");
  console.log("   - Crew chat seeded");
  console.log("   - 5 DMs to Mattius");
  await pool.end();
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
