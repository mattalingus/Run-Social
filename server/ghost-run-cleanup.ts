import { pool } from "./storage";
import { sendPushNotification } from "./notifications";

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

async function closeGhostRuns(): Promise<void> {
  try {
    // Find active runs that have had no tracking pings from any participant in the last 2 hours
    const candidates = await pool.query<{ id: string; title: string; host_id: string }>(
      `SELECT r.id, r.title, r.host_id
       FROM runs r
       WHERE r.is_active = true
         AND (r.is_completed IS NULL OR r.is_completed = false)
         AND NOT EXISTS (
           SELECT 1 FROM run_tracking_points tp
           WHERE tp.run_id = r.id
             AND tp.recorded_at > NOW() - INTERVAL '2 hours'
         )`
    );

    if (candidates.rows.length === 0) return;

    const ids = candidates.rows.map((r) => r.id);

    // Close all candidates atomically
    const closed = await pool.query<{ id: string; title: string }>(
      `UPDATE runs
       SET is_active = false, is_completed = true
       WHERE id = ANY($1)
         AND is_active = true
         AND (is_completed IS NULL OR is_completed = false)
       RETURNING id, title`,
      [ids]
    );

    if (closed.rows.length === 0) return;

    const closedIds = new Set(closed.rows.map((r) => r.id));
    console.log(
      `[ghost-run-cleanup] Auto-closed ${closed.rows.length} ghost run(s):`,
      closed.rows.map((r) => `"${r.title}" (${r.id})`).join(", ")
    );

    // Notify each host whose run was actually closed
    for (const candidate of candidates.rows) {
      if (!closedIds.has(candidate.id)) continue;
      const hostRes = await pool.query<{
        push_token: string | null;
        notifications_enabled: boolean;
      }>(
        `SELECT push_token, notifications_enabled FROM users WHERE id = $1`,
        [candidate.host_id]
      );
      const host = hostRes.rows[0];
      if (
        host?.push_token &&
        host.notifications_enabled !== false &&
        host.push_token.startsWith("ExponentPushToken[")
      ) {
        await sendPushNotification(
          host.push_token,
          "Run auto-closed",
          `"${candidate.title}" was closed automatically due to 2 hours of inactivity.`,
          { runId: candidate.id }
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
