import { pool } from "./storage";
import { sendPushNotification } from "./notifications";

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

async function closeGhostRuns(): Promise<void> {
  try {
    // Identify active runs that qualify for auto-closure:
    //   - Run started at least 2 hours ago (so a new run with zero pings is never swept)
    //   - No tracking pings from any participant in the last 2 hours
    // Both conditions together guarantee a true 2-hour inactivity window.
    const candidates = await pool.query<{ id: string; title: string; host_id: string }>(
      `SELECT r.id, r.title, r.host_id
       FROM runs r
       WHERE r.is_active = true
         AND (r.is_completed IS NULL OR r.is_completed = false)
         AND r.started_at IS NOT NULL
         AND r.started_at < NOW() - INTERVAL '2 hours'
         AND NOT EXISTS (
           SELECT 1 FROM run_tracking_points tp
           WHERE tp.run_id = r.id
             AND tp.recorded_at > NOW() - INTERVAL '2 hours'
         )`
    );

    if (candidates.rows.length === 0) return;

    // Notify each candidate host BEFORE closing so they are informed first.
    // Notifications are sent based on the eligibility check above; in the rare case
    // a run gets a fresh ping between here and the UPDATE below it will not be
    // closed (the UPDATE re-checks the predicate), but the notification is still
    // appropriate since the run had been silent for 2+ hours when detected.
    for (const candidate of candidates.rows) {
      const hostRes = await pool.query<{ push_token: string | null; notifications_enabled: boolean }>(
        `SELECT push_token, notifications_enabled FROM users WHERE id = $1`,
        [candidate.host_id]
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
          `"${candidate.title}" was closed automatically due to 2 hours of inactivity.`,
          { runId: candidate.id }
        );
      }
    }

    // Atomically close — re-checks both conditions at UPDATE time to prevent
    // false closures if pings arrive between the SELECT above and here.
    const ids = candidates.rows.map((r) => r.id);
    const closed = await pool.query<{ id: string; title: string }>(
      `UPDATE runs
       SET is_active = false, is_completed = true
       WHERE id = ANY($1)
         AND is_active = true
         AND (is_completed IS NULL OR is_completed = false)
         AND started_at IS NOT NULL
         AND started_at < NOW() - INTERVAL '2 hours'
         AND NOT EXISTS (
           SELECT 1 FROM run_tracking_points tp
           WHERE tp.run_id = runs.id
             AND tp.recorded_at > NOW() - INTERVAL '2 hours'
         )
       RETURNING id, title`,
      [ids]
    );

    if (closed.rows.length > 0) {
      console.log(
        `[ghost-run-cleanup] Auto-closed ${closed.rows.length} ghost run(s):`,
        closed.rows.map((r) => `"${r.title}" (${r.id})`).join(", ")
      );
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
