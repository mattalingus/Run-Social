import { pool } from "./storage";
import { sendPushNotification } from "./notifications";

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

async function closeGhostRuns(): Promise<void> {
  try {
    // Atomically close active runs that:
    //   - started at least 2 hours ago (so brand-new runs with zero pings are never swept)
    //   - have had no tracking pings from any participant in the last 2 hours
    // Both conditions together guarantee a true 2-hour inactivity window.
    // The predicate is evaluated inside the UPDATE to prevent false closures if pings
    // arrive between a prior candidate SELECT and this statement.
    const closed = await pool.query<{ id: string; title: string; host_id: string }>(
      `UPDATE runs
       SET is_active = false, is_completed = true
       WHERE is_active = true
         AND (is_completed IS NULL OR is_completed = false)
         AND started_at IS NOT NULL
         AND started_at < NOW() - INTERVAL '2 hours'
         AND NOT EXISTS (
           SELECT 1 FROM run_tracking_points tp
           WHERE tp.run_id = runs.id
             AND tp.recorded_at > NOW() - INTERVAL '2 hours'
         )
       RETURNING id, title, host_id`
    );

    if (closed.rows.length === 0) return;

    console.log(
      `[ghost-run-cleanup] Auto-closed ${closed.rows.length} ghost run(s):`,
      closed.rows.map((r) => `"${r.title}" (${r.id})`).join(", ")
    );

    // Notify only hosts of runs that were actually closed (uses RETURNING rows)
    for (const run of closed.rows) {
      const hostRes = await pool.query<{ push_token: string | null; notifications_enabled: boolean }>(
        `SELECT push_token, notifications_enabled FROM users WHERE id = $1`,
        [run.host_id]
      );
      const host = hostRes.rows[0];
      if (
        host?.push_token &&
        host.notifications_enabled !== false &&
        host.push_token.startsWith("ExponentPushToken[")
      ) {
        sendPushNotification(
          host.push_token,
          "Run auto-closed",
          `"${run.title}" was closed automatically due to 2 hours of inactivity.`,
          { runId: run.id }
        );
      }
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
