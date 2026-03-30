import { pool } from "./storage";

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

async function closeGhostRuns(): Promise<void> {
  try {
    const result = await pool.query<{ id: string; title: string }>(
      `UPDATE runs
       SET is_active = false, is_completed = true
       WHERE is_active = true
         AND (is_completed IS NULL OR is_completed = false)
         AND (
           date < NOW() - INTERVAL '4 hours'
           OR NOT EXISTS (
             SELECT 1 FROM run_tracking_points
             WHERE run_id = runs.id
               AND recorded_at > NOW() - INTERVAL '4 hours'
           )
         )
       RETURNING id, title`
    );
    if (result.rows.length > 0) {
      console.log(`[ghost-run-cleanup] Auto-closed ${result.rows.length} ghost run(s):`,
        result.rows.map((r) => `"${r.title}" (${r.id})`).join(", "));
    }
  } catch (err: any) {
    console.error("[ghost-run-cleanup] Error:", err?.message ?? err);
  }
}

export function scheduleGhostRunCleanup(): void {
  closeGhostRuns().catch(() => {});
  setInterval(() => {
    closeGhostRuns().catch(() => {});
  }, CHECK_INTERVAL_MS);
  console.log("[ghost-run-cleanup] Scheduled (every 30 min)");
}
