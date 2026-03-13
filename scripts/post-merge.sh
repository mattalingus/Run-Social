#!/bin/bash
set -e

echo "[post-merge] Installing dependencies..."
npm install --legacy-peer-deps

echo "[post-merge] Running database migrations..."
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(\`
  ALTER TABLE friends ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP;
\`).then(() => {
  console.log('[post-merge] DB migration complete');
  pool.end();
}).catch(err => {
  console.error('[post-merge] DB migration error:', err.message);
  pool.end();
  process.exit(1);
});
"

echo "[post-merge] Done."
