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
         AND (r.is_deleted IS NULL OR r.is_deleted = false)
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
            `"${run.title}" was scheduled 1 hour ago. Start it now or it will be automatically removed in 30 minutes.`,
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

// Auto-delete runs that are 90+ minutes past scheduled time and were never started
async function cleanupUnstartedRuns(): Promise<void> {
  try {
    const result = await pool.query(
      `UPDATE runs
       SET is_deleted = true
       WHERE is_active = false
         AND is_completed = false
         AND (is_deleted IS NULL OR is_deleted = false)
         AND date < NOW() - INTERVAL '90 minutes'
       RETURNING id, title`
    );
    if (result.rowCount && result.rowCount > 0) {
      for (const r of result.rows) {
        console.log(`[late-start] Auto-removed unstarted run ${r.id} ("${r.title}")`);
      }
    }
  } catch (err) {
    console.error("[late-start] Unstarted run cleanup failed:", err);
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

// Auto-promote a new host when the current host hasn't pinged in 5+ minutes during an active run
async function checkAndPromoteHost(): Promise<void> {
  try {
    // Find active runs where the host hasn't pinged in 5+ minutes
    const staleHosts = await pool.query(
      `SELECT r.id, r.host_id
       FROM runs r
       WHERE r.is_active = true
         AND r.is_completed = false
         AND r.started_at IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM run_tracking_points tp
           WHERE tp.run_id = r.id
             AND tp.user_id = r.host_id
             AND tp.recorded_at > NOW() - INTERVAL '5 minutes'
         )`
    );

    for (const run of staleHosts.rows) {
      // Find the present participant with the highest cumulative distance (excluding current host, not yet finished)
      const bestRunner = await pool.query(
        `SELECT DISTINCT ON (tp.user_id) tp.user_id, tp.cumulative_distance
         FROM run_tracking_points tp
         JOIN run_participants rp ON rp.run_id = tp.run_id AND rp.user_id = tp.user_id
         WHERE tp.run_id = $1
           AND tp.user_id != $2
           AND rp.is_present = true
           AND rp.final_pace IS NULL
           AND tp.recorded_at > NOW() - INTERVAL '5 minutes'
         ORDER BY tp.user_id, tp.recorded_at DESC`,
        [run.id, run.host_id]
      );

      if (bestRunner.rows.length > 0) {
        // Pick the one with the highest cumulative distance
        const sorted = bestRunner.rows.sort(
          (a: any, b: any) => parseFloat(b.cumulative_distance) - parseFloat(a.cumulative_distance)
        );
        const newHostId = sorted[0].user_id;
        await pool.query(`UPDATE runs SET host_id = $1 WHERE id = $2`, [newHostId, run.id]);
        console.log(`[late-start] Auto-promoted user ${newHostId} to host for run ${run.id} (original host went silent)`);
      }
    }
  } catch (err) {
    console.error("[late-start] Host promotion check failed:", err);
  }
}

export function scheduleLateStartMonitor(): void {
  console.log("[late-start] Monitor started — checking every 5 minutes");
  setInterval(() => {
    checkLateStarts();
    cleanupStaleActiveRuns();
    cleanupUnstartedRuns();
    checkAndPromoteHost();
  }, CHECK_INTERVAL_MS);
  checkLateStarts();
  cleanupStaleActiveRuns();
  cleanupUnstartedRuns();
  checkAndPromoteHost();
}
