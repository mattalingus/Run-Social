/**
 * Rewrites photo URLs in Postgres after migrating objects from Replit GCS → R2.
 * Handles both URL patterns found in the DB:
 *   1. https://PaceUp.replit.app/api/objects/public/photos/... (absolute)
 *   2. /api/objects/public/photos/...                         (relative)
 * Both become: ${R2_PUBLIC_URL}/public/photos/...
 *
 * Idempotent. Scans every text/varchar/json(b) column in the public schema.
 *
 * Usage:
 *   DATABASE_URL=... R2_PUBLIC_URL=https://pub-xxx.r2.dev \
 *   npx tsx scripts/rewrite-photo-urls.ts
 */

import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL!;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;
const OLD_ABS = process.env.OLD_ABS_PREFIX || "https://PaceUp.replit.app/api/objects/";
const OLD_REL = process.env.OLD_REL_PREFIX || "/api/objects/";

if (!DATABASE_URL || !R2_PUBLIC_URL) {
  console.error("Missing DATABASE_URL or R2_PUBLIC_URL");
  process.exit(1);
}

const NEW_PREFIX = `${R2_PUBLIC_URL}/`;

async function rewrite(pool: Pool, oldPrefix: string): Promise<number> {
  const { rows: cols } = await pool.query<{
    table_name: string;
    column_name: string;
    data_type: string;
  }>(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('text','character varying','varchar','json','jsonb')
  `);

  let total = 0;
  for (const { table_name, column_name, data_type } of cols) {
    const isJsonb = data_type === "jsonb" || data_type === "json";
    const cast = isJsonb ? "::jsonb" : "::text";
    try {
      const sql = `
        UPDATE "${table_name}"
        SET "${column_name}" = REPLACE("${column_name}"::text, $1, $2)${cast}
        WHERE "${column_name}"::text LIKE $3
      `;
      const res = await pool.query(sql, [oldPrefix, NEW_PREFIX, `%${oldPrefix}%`]);
      if (res.rowCount && res.rowCount > 0) {
        console.log(`  [${oldPrefix}] ${table_name}.${column_name}: ${res.rowCount} rows`);
        total += res.rowCount;
      }
    } catch (e: any) {
      console.warn(`  skipped ${table_name}.${column_name}: ${e.message}`);
    }
  }
  return total;
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  console.log(`Pass 1: rewriting absolute prefix "${OLD_ABS}" → "${NEW_PREFIX}"`);
  const a = await rewrite(pool, OLD_ABS);

  console.log(`\nPass 2: rewriting relative prefix "${OLD_REL}" → "${NEW_PREFIX}"`);
  const b = await rewrite(pool, OLD_REL);

  await pool.end();
  console.log(`\nTotal rows updated: ${a + b}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
