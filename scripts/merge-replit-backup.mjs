#!/usr/bin/env node
/**
 * Merge Replit pg_dump into Railway Postgres (v2, remap-aware).
 *
 * v1 failed on:
 *   - crews_name_lower_unique: the placeholder "Founders" I created on Railway
 *     during recovery blocked the real Founders from re-inserting. Fix: drop
 *     the placeholder before inserting crews.
 *   - users_email_key: users who re-signed up on Railway after the Replit
 *     cutover exist with the SAME email but a DIFFERENT UUID. Fix: before
 *     inserting anything, build a replit_uuid → railway_uuid remap keyed on
 *     email. Every FK column that references users.id is rewritten through
 *     the remap on insert. Railway UUID always wins (so recent Railway-only
 *     activity — solo runs, etc. — is preserved).
 *
 * Usage:
 *   cd ~/Run-Social
 *   railway run --service paceup-backend node scripts/merge-replit-backup.mjs \
 *     ~/Downloads/paceup_replit_backup.sql
 */
import fs from "node:fs";
import pg from "pg";

const { Pool } = pg;

const DUMP_PATH = process.argv[2];
if (!DUMP_PATH) {
  console.error("usage: node merge-replit-backup.mjs <dump.sql>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set — run under `railway run`");
  process.exit(1);
}

// FK-safe insert order
const TABLE_ORDER = [
  "users",
  "crews",
  "crew_members",
  "crew_messages",
  "crew_achievements",
  "crew_chief_promotions",
  "friends",
  "facebook_friends",
  "user_blocks",
  "achievements",
  "saved_paths",
  "community_paths",
  "path_contributions",
  "path_shares",
  "public_routes",
  "runs",
  "run_participants",
  "run_invites",
  "run_messages",
  "run_photos",
  "run_tracking_points",
  "run_notification_hidden",
  "host_ratings",
  "tag_along_requests",
  "planned_runs",
  "bookmarked_runs",
  "solo_runs",
  "solo_run_photos",
  "public_route_completions",
  "direct_messages",
  "password_reset_tokens",
  "reports",
  "audit_logs",
];

const SKIP = new Set(["session", "remember_tokens", "db_migrations", "migration_flags"]);

const CONFLICT_TARGETS = {
  facebook_friends: "(user_id, fb_friend_id)",
  user_blocks: "(blocker_id, blocked_id)",
  run_notification_hidden: "(user_id, run_id)",
  crew_members: "(crew_id, user_id)",
};

// Every column (across all tables) that references users.id. These get
// rewritten through USER_REMAP on insert.
const USER_FK_COLUMNS = new Set([
  "user_id", "host_id", "invited_by", "requester_id", "addressee_id",
  "rater_id", "sender_id", "recipient_id", "invitee_id", "reporter_id",
  "actor", "created_by", "created_by_user_id", "from_user_id", "to_user_id",
  "blocker_id", "blocked_id", "tag_along_of_user_id", "target_id",
]);

// Crews that need dropping before insert because they occupy a unique name.
const PLACEHOLDER_CREWS = ["1bc9112d-e815-4f5e-9ffa-b6602bc635a9"];

// ── Parse dump ──────────────────────────────────────────────────────────────
console.log(`→ reading ${DUMP_PATH}`);
const dump = fs.readFileSync(DUMP_PATH, "utf8");

function unescape(raw) {
  if (raw === "\\N") return null;
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "\\" && i + 1 < raw.length) {
      const n = raw[i + 1];
      if (n === "t") { out += "\t"; i++; continue; }
      if (n === "n") { out += "\n"; i++; continue; }
      if (n === "r") { out += "\r"; i++; continue; }
      if (n === "b") { out += "\b"; i++; continue; }
      if (n === "f") { out += "\f"; i++; continue; }
      if (n === "v") { out += "\v"; i++; continue; }
      if (n === "\\") { out += "\\"; i++; continue; }
    }
    out += c;
  }
  return out;
}

const blocks = new Map();
{
  const lines = dump.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = /^COPY public\.(\w+) \(([^)]+)\) FROM stdin;$/.exec(line);
    if (!m) { i++; continue; }
    const table = m[1];
    const cols = m[2].split(",").map((s) => s.trim());
    const rows = [];
    i++;
    while (i < lines.length && lines[i] !== "\\.") {
      const raw = lines[i];
      if (raw.length > 0) {
        rows.push(raw.split("\t").map(unescape));
      }
      i++;
    }
    blocks.set(table, { cols, rows });
    i++;
  }
}
console.log(`→ parsed ${blocks.size} tables`);

// ── Connect + preflight ────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  // 1. Drop any placeholder crews occupying a unique name. Cascades to their
  //    crew_members + crew_messages so the real (restored) crew is clean.
  for (const id of PLACEHOLDER_CREWS) {
    const before = await pool.query(`SELECT name FROM crews WHERE id = $1`, [id]);
    if (before.rowCount === 0) continue;
    console.log(`→ dropping placeholder crew "${before.rows[0].name}" (${id})`);
    await pool.query(`DELETE FROM crew_members WHERE crew_id = $1`, [id]);
    await pool.query(`DELETE FROM crew_messages WHERE crew_id = $1`, [id]);
    await pool.query(`UPDATE runs SET crew_id = NULL WHERE crew_id = $1`, [id]);
    await pool.query(`DELETE FROM crews WHERE id = $1`, [id]);
  }

  // 2. Build USER_REMAP: Replit UUID → Railway UUID, keyed on email.
  //    If a Replit user's email already exists on Railway, we remap the
  //    Replit UUID to the Railway UUID so all their restored content stitches
  //    onto the live account.
  const usersBlock = blocks.get("users");
  if (!usersBlock) throw new Error("dump has no users table");
  const emailIdx = usersBlock.cols.indexOf("email");
  const idIdx = usersBlock.cols.indexOf("id");

  const replitEmails = usersBlock.rows
    .map((r) => ({ id: r[idIdx], email: r[emailIdx] }))
    .filter((u) => u.email);

  const railwayByEmail = await pool.query(
    `SELECT id, email FROM users WHERE email = ANY($1::text[])`,
    [replitEmails.map((u) => u.email.toLowerCase())]
  );
  const railwayMap = new Map(railwayByEmail.rows.map((r) => [r.email.toLowerCase(), r.id]));

  const USER_REMAP = new Map();
  for (const u of replitEmails) {
    const rwId = railwayMap.get(u.email.toLowerCase());
    if (rwId && rwId !== u.id) {
      USER_REMAP.set(u.id, rwId);
    }
  }
  console.log(`→ built user remap: ${USER_REMAP.size} Replit UUIDs will be rewritten to existing Railway UUIDs`);
  for (const [from, to] of USER_REMAP) {
    console.log(`     ${from}  →  ${to}`);
  }

  // 3. Walk tables and INSERT with remap + ON CONFLICT DO NOTHING.
  const report = [];
  for (const table of TABLE_ORDER) {
    if (SKIP.has(table)) continue;
    const b = blocks.get(table);
    if (!b) continue;
    const { cols, rows } = b;
    const colList = cols.map((c) => `"${c}"`).join(", ");
    const placeholders = cols.map((_, k) => `$${k + 1}`).join(", ");
    const conflict = CONFLICT_TARGETS[table] || "(id)";
    const sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT ${conflict} DO NOTHING`;

    // For users table: if the row's own id is in the remap, SKIP it
    // (Railway already has this user under the target UUID).
    const selfIdxForUsers = table === "users" ? cols.indexOf("id") : -1;

    // For every non-users table: rewrite any USER_FK column through the map.
    const remapCols = table === "users"
      ? []
      : cols
          .map((c, idx) => (USER_FK_COLUMNS.has(c) ? idx : -1))
          .filter((idx) => idx >= 0);

    let inserted = 0, skippedConflict = 0, skippedRemap = 0, errors = 0;
    for (const original of rows) {
      if (table === "users" && USER_REMAP.has(original[selfIdxForUsers])) {
        skippedRemap++;
        continue;
      }
      const row = original.slice();
      for (const idx of remapCols) {
        if (row[idx] && USER_REMAP.has(row[idx])) row[idx] = USER_REMAP.get(row[idx]);
      }
      try {
        const r = await pool.query(sql, row);
        if (r.rowCount && r.rowCount > 0) inserted++; else skippedConflict++;
      } catch (e) {
        errors++;
        console.error(`  ✗ [${table}] ${row[0]}: ${e.message}`);
      }
    }
    report.push({ table, inserted, skippedConflict, skippedRemap, errors, total: rows.length });
    console.log(
      `  ✓ ${table.padEnd(28)} +${inserted} conflict=${skippedConflict} remap=${skippedRemap} err=${errors} / ${rows.length}`
    );
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n=== MERGE SUMMARY ===`);
  let total = 0;
  for (const r of report) {
    total += r.inserted;
    if (r.inserted > 0 || r.errors > 0) {
      console.log(`  ${r.table.padEnd(28)} restored=${r.inserted} errors=${r.errors}`);
    }
  }
  console.log(`  TOTAL ROWS RESTORED: ${total}`);

  // ── Verify Founders ───────────────────────────────────────────────────────
  const founders = await pool.query(
    `SELECT c.id, c.name, c.created_by,
       (SELECT COUNT(*) FROM crew_members WHERE crew_id = c.id) AS members,
       (SELECT COUNT(*) FROM crew_messages WHERE crew_id = c.id) AS messages,
       (SELECT COUNT(*) FROM runs WHERE crew_id = c.id) AS runs
     FROM crews c WHERE LOWER(c.name) = 'founders'`
  );
  console.log(`\n=== FOUNDERS CHECK ===`);
  console.log(founders.rows);

  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
