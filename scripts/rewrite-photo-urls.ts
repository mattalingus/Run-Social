/**
 * After migrating photos from Replit GCS → R2, rewrite all photo URLs in the
 * database to point to the new R2 public URL.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... \
 *   OLD_PHOTO_PREFIX=https://storage.googleapis.com/replit-objstore-19b4c61a-... \
 *   R2_PUBLIC_URL=https://photos.paceupapp.com \
 *   npx tsx scripts/rewrite-photo-urls.ts
 *
 * The script is idempotent: re-running it on already-migrated rows is a no-op.
 * Discovers every text/varchar column and rewrites matching substrings.
 */

import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL!;
const OLD_PHOTO_PREFIX = process.env.OLD_PHOTO_PREFIX!;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;

if (!DATABASE_URL || !OLD_PHOTO_PREFIX || !R2_PUBLIC_URL) {
  console.error("Missing DATABASE_URL, OLD_PHOTO_PREFIX, or R2_PUBLIC_URL");
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  // Find every text-ish column in public schema
  const { rows: cols } = await pool.query<{
    table_name: string;
    column_name: string;
  }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('text','character varying','varchar','json','jsonb')
  `);

  let totalUpdated = 0;

  for (const { table_name, column_name } of cols) {
    try {
      const sql = `
        UPDATE "${table_name}"
        SET "${column_name}" = REPLACE("${column_name}"::text, $1, $2)::${
          column_name === "metadata" ? "jsonb" : "text"
        }
        WHERE "${column_name}"::text LIKE $3
      `;
      const res = await pool.query(sql, [
        OLD_PHOTO_PREFIX,
        R2_PUBLIC_URL,
        `%${OLD_PHOTO_PREFIX}%`,
      ]);
      if (res.rowCount && res.rowCount > 0) {
        console.log(`  ${table_name}.${column_name}: ${res.rowCount} rows`);
        totalUpdated += res.rowCount;
      }
    } catch (e: any) {
      // Column might be jsonb where cast fails — try a jsonb-safe path
      try {
        const sql = `
          UPDATE "${table_name}"
          SET "${column_name}" = REPLACE("${column_name}"::text, $1, $2)::jsonb
          WHERE "${column_name}"::text LIKE $3
        `;
        const res = await pool.query(sql, [
          OLD_PHOTO_PREFIX,
          R2_PUBLIC_URL,
          `%${OLD_PHOTO_PREFIX}%`,
        ]);
        if (res.rowCount && res.rowCount > 0) {
          console.log(`  ${table_name}.${column_name} (jsonb): ${res.rowCount} rows`);
          totalUpdated += res.rowCount;
        }
      } catch {
        console.warn(`  skipped ${table_name}.${column_name}: ${e.message}`);
      }
    }
  }

  await pool.end();
  console.log(`\nTotal rows updated: ${totalUpdated}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
