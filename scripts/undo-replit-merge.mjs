#!/usr/bin/env node
/**
 * Undo the Replit merge (merge-replit-backup.mjs).
 *
 * Strategy: every row the merge script inserted has an `id` value that came
 * from the dump file. Re-parse the dump, collect (table, id[]) pairs, and
 * DELETE WHERE id = ANY($1) in reverse-FK order inside a single transaction.
 * If anything goes wrong, the whole thing rolls back.
 *
 * Users table gets special handling — we only delete rows matching the dump
 * by BOTH id AND email (so we never touch a legitimate Railway user that
 * happens to share an id with a dump row), plus seed users by email pattern.
 *
 * Usage:
 *   cd ~/Run-Social
 *   railway run --service paceup-backend node scripts/undo-replit-merge.mjs \
 *     ~/Downloads/paceup_replit_backup.sql
 */
import fs from "node:fs";
import pg from "pg";

const { Pool } = pg;

const DUMP_PATH = process.argv[2];
if (!DUMP_PATH) { console.error("usage: node undo-replit-merge.mjs <dump.sql>"); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set — run under `railway run`"); process.exit(1); }

// Reverse of merge script's TABLE_ORDER. Delete children first.
const DELETE_ORDER = [
  "audit_logs",
  "reports",
  "password_reset_tokens",
  "direct_messages",
  "public_route_completions",
  "solo_run_photos",
  "solo_runs",
  "bookmarked_runs",
  "planned_runs",
  "tag_along_requests",
  "host_ratings",
  "run_notification_hidden",
  "run_tracking_points",
  "run_photos",
  "run_messages",
  "run_invites",
  "run_participants",
  "runs",
  "public_routes",
  "path_shares",
  "path_contributions",
  "community_paths",
  "saved_paths",
  "achievements",
  "user_blocks",
  "facebook_friends",
  "friends",
  "crew_chief_promotions",
  "crew_achievements",
  "crew_messages",
  "crew_members",
  "crews",
  // users deliberately handled last via special-case logic
];

// Tables keyed by (a,b) composite rather than id
const COMPOSITE_KEYS = {
  crew_members: ["crew_id", "user_id"],
  facebook_friends: ["user_id", "fb_friend_id"],
  user_blocks: ["blocker_id", "blocked_id"],
  run_notification_hidden: ["user_id", "run_id"],
};

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

console.log(`→ parsing ${DUMP_PATH}`);
const dump = fs.readFileSync(DUMP_PATH, "utf8");

const blocks = new Map();
{
  const lines = dump.split("\n");
  let i = 0;
  while (i < lines.length) {
    const m = /^COPY public\.(\w+) \(([^)]+)\) FROM stdin;$/.exec(lines[i]);
    if (!m) { i++; continue; }
    const table = m[1];
    const cols = m[2].split(",").map((s) => s.trim());
    const rows = [];
    i++;
    while (i < lines.length && lines[i] !== "\\.") {
      if (lines[i].length > 0) rows.push(lines[i].split("\t").map(unescape));
      i++;
    }
    blocks.set(table, { cols, rows });
    i++;
  }
}
console.log(`→ parsed ${blocks.size} tables`);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const report = [];

    for (const table of DELETE_ORDER) {
      const b = blocks.get(table);
      if (!b) { continue; }
      const { cols, rows } = b;

      let deleted = 0;
      const composite = COMPOSITE_KEYS[table];
      if (composite) {
        const idxA = cols.indexOf(composite[0]);
        const idxB = cols.indexOf(composite[1]);
        if (idxA < 0 || idxB < 0) throw new Error(`${table}: missing composite col`);
        // Build a VALUES list and DELETE USING
        const tuples = rows
          .map((r) => [r[idxA], r[idxB]])
          .filter((t) => t[0] && t[1]);
        if (tuples.length === 0) { report.push({ table, deleted: 0 }); continue; }
        // Chunk to keep query sane
        const CHUNK = 500;
        for (let k = 0; k < tuples.length; k += CHUNK) {
          const chunk = tuples.slice(k, k + CHUNK);
          const params = [];
          const placeholders = chunk.map((t, j) => {
            params.push(t[0], t[1]);
            return `($${j * 2 + 1}, $${j * 2 + 2})`;
          }).join(",");
          const sql = `DELETE FROM "${table}" WHERE (${composite[0]}, ${composite[1]}) IN (VALUES ${placeholders})`;
          const r = await client.query(sql, params);
          deleted += r.rowCount || 0;
        }
      } else {
        const idIdx = cols.indexOf("id");
        if (idIdx < 0) {
          console.warn(`  ! ${table}: no id column, skipping`);
          report.push({ table, deleted: 0, skipped: "no id col" });
          continue;
        }
        const ids = rows.map((r) => r[idIdx]).filter(Boolean);
        if (ids.length === 0) { report.push({ table, deleted: 0 }); continue; }
        const idType = typeof ids[0] === "string" && ids[0].includes("-") ? "varchar" : "text";
        const sql = `DELETE FROM "${table}" WHERE id::text = ANY($1::text[])`;
        const r = await client.query(sql, [ids]);
        deleted = r.rowCount || 0;
      }

      report.push({ table, deleted });
      console.log(`  − ${table.padEnd(30)} ${deleted} rows`);
    }

    // USERS: delete dump-user rows only if (id, email) both match dump.
    // Avoid nuking a legitimate Railway user who happens to share an id.
    const usersBlock = blocks.get("users");
    let dumpUserDeleted = 0;
    if (usersBlock) {
      const idIdx = usersBlock.cols.indexOf("id");
      const emailIdx = usersBlock.cols.indexOf("email");
      const dumpUsers = usersBlock.rows
        .map((r) => ({ id: r[idIdx], email: r[emailIdx] }))
        .filter((u) => u.id && u.email);
      for (const u of dumpUsers) {
        const r = await client.query(
          `DELETE FROM users WHERE id = $1 AND LOWER(email) = LOWER($2)`,
          [u.id, u.email]
        );
        dumpUserDeleted += r.rowCount || 0;
      }
    }
    console.log(`  − users (dump match)           ${dumpUserDeleted} rows`);

    // Seed users by email domain
    const seedResult = await client.query(
      `DELETE FROM users WHERE email ILIKE '%@paceup.dev' OR email ILIKE '%@paceup.com' OR email ILIKE '%@paceupapp.com' OR email ILIKE '%@paceup.test' OR email ILIKE '%@test.com' OR email ILIKE '%@t.com'`
    );
    const seedUserDeleted = seedResult.rowCount || 0;
    console.log(`  − users (seed domain)          ${seedUserDeleted} rows`);

    // Final summary before commit
    let total = 0;
    for (const r of report) total += r.deleted;
    total += dumpUserDeleted + seedUserDeleted;
    console.log(`\n→ about to commit: ${total} rows deleted across ${report.length + 1} tables`);

    await client.query("COMMIT");
    console.log("✓ COMMIT — undo complete");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("✗ ROLLBACK due to error:", e.message);
    throw e;
  } finally {
    client.release();
  }

  await pool.end();
}

run().catch((e) => { console.error(e); process.exit(1); });
