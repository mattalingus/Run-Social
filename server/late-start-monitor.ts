import { pool } from "./storage";
import { sendPushNotification } from "./notifications";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

async function checkLateStarts(): Promise<void> {
  try {
    const result = await pool.query<{
      id: string;
      title: string;
      activity_type: string;
      host_push_token: string | null;
      notifications_enabled: boolean;
      notif_run_reminders: boolean;
    }>(
      `SELECT r.id, r.title, r.activity_type,
              u.push_token AS host_push_token,
              u.notifications_enabled,
              u.notif_run_reminders
       FROM runs r
       JOIN users u ON u.id = r.host_id
       WHERE r.is_active = false
         AND r.is_completed = false
         AND r.notif_late_start_sent = false
         AND r.date < NOW() - INTERVAL '60 minutes'
         AND r.date > NOW() - INTERVAL '90 minutes'`
    );

    if (result.rows.length > 0) {
      const ids = result.rows.map((r) => r.id);
      await pool.query(
        `UPDATE runs SET notif_late_start_sent = true WHERE id = ANY($1)`,
        [ids]
      );
      for (const run of result.rows) {
        const type = run.activity_type === "ride" ? "ride" : "run";
        if (
          run.host_push_token &&
          run.notifications_enabled !== false &&
          run.notif_run_reminders !== false
        ) {
          await sendPushNotification(
            run.host_push_token,
            `⏰ Start your ${type} soon`,
            `"${run.title}" was scheduled 1 hour ago. Start it now or update the time — it will be removed from PaceUp in 30 minutes.`,
            { screen: "run", runId: run.id }
          );
        }
        console.log(`[late-start] Notified host for run ${run.id} ("${run.title}")`);
      }
    }
  } catch (err) {
    console.error("[late-start] Check failed:", err);
  }
}

async function cleanupStaleActiveRuns(): Promise<void> {
  try {
    // Runs that have been is_active for more than 8 hours with no recent pings are dead test/abandoned runs
    const stale = await pool.query(
      `UPDATE runs
       SET is_completed = true, is_active = false
       WHERE is_active = true
         AND is_completed = false
         AND started_at < NOW() - INTERVAL '8 hours'
       RETURNING id, title`
    );
    if (stale.rowCount && stale.rowCount > 0) {
      for (const r of stale.rows) {
        console.log(`[late-start] Auto-completed stale run ${r.id} ("${r.title}")`);
      }
    }

    // Also clean up runs that were set is_active but never started (started_at is null)
    // and are more than 3 hours past their scheduled date
    const neverStarted = await pool.query(
      `UPDATE runs
       SET is_active = false
       WHERE is_active = true
         AND started_at IS NULL
         AND date < NOW() - INTERVAL '3 hours'
       RETURNING id, title`
    );
    if (neverStarted.rowCount && neverStarted.rowCount > 0) {
      for (const r of neverStarted.rows) {
        console.log(`[late-start] Reset stuck-active run ${r.id} ("${r.title}")`);
      }
    }
  } catch (err) {
    console.error("[late-start] Stale run cleanup failed:", err);
  }
}

export function scheduleLateStartMonitor(): void {
  console.log("[late-start] Monitor started — checking every 5 minutes");
  setInterval(() => {
    checkLateStarts();
    cleanupStaleActiveRuns();
  }, CHECK_INTERVAL_MS);
  checkLateStarts();
  cleanupStaleActiveRuns();
}
