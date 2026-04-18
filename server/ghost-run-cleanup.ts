import {
  pool,
  finishRunnerRun,
  creditGhostParticipant,
  updateCrewStreakForRun,
  checkAndAwardRideAchievements,
  checkAndAwardCrewAchievements,
} from "./storage";
import { sendPushNotification } from "./notifications";

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

async function closeGhostRuns(): Promise<void> {
  try {
    // Atomically close active runs that:
    //   - started at least 2 hours ago (so brand-new runs with zero pings are never swept)
    //   - have had no tracking pings from any participant in the last 2 hours
    //
    // Runs with zero tracking data ever → is_abandoned = true (hidden from
    // history/streaks/leaderboards via is_abandoned IS NOT TRUE filter paths).
    // Runs that do have some historical tracking data → is_completed = true
    // so participant stats can be reconciled via the canonical finishRunnerRun path.
    const closed = await pool.query<{
      id: string;
      title: string;
      host_id: string;
      is_abandoned: boolean;
    }>(
      `UPDATE runs
       SET is_active = false,
           is_completed = CASE
             WHEN EXISTS (SELECT 1 FROM run_tracking_points tp WHERE tp.run_id = runs.id)
             THEN true ELSE false END,
           is_abandoned = CASE
             WHEN NOT EXISTS (SELECT 1 FROM run_tracking_points tp WHERE tp.run_id = runs.id)
             THEN true ELSE false END
       WHERE is_active = true
         AND (is_completed IS NULL OR is_completed = false)
         AND started_at IS NOT NULL
         AND started_at < NOW() - INTERVAL '2 hours'
         AND NOT EXISTS (
           SELECT 1 FROM run_tracking_points tp
           WHERE tp.run_id = runs.id
             AND tp.recorded_at > NOW() - INTERVAL '2 hours'
         )
       RETURNING id, title, host_id, is_abandoned`
    );

    if (closed.rows.length === 0) return;

    console.log(
      `[ghost-run-cleanup] Auto-closed ${closed.rows.length} ghost run(s):`,
      closed.rows.map((r) => `"${r.title}" (${r.id}, ${r.is_abandoned ? "abandoned" : "completed"})`).join(", ")
    );

    for (const run of closed.rows) {
      if (run.is_abandoned) {
        // No tracking data at all — mark all present participants as abandoned
        // WITHOUT calling finishRunnerRun (which would auto-complete the run by
        // setting is_completed=true, undoing the abandoned flag).
        await markParticipantsAbandoned(run.id);
      } else {
        // Has tracking data — reconcile each participant's final stats via the
        // canonical finishRunnerRun path.
        await reconcileGhostRunParticipants(run.id);
      }

      // Notify the host
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

/**
 * For a ghost run that had zero tracking data (is_abandoned = true), mark all
 * present participants as abandoned directly — bypassing finishRunnerRun to avoid
 * the auto-completion side-effect that would overwrite is_abandoned with is_completed.
 */
async function markParticipantsAbandoned(runId: string): Promise<void> {
  try {
    const result = await pool.query<{ user_id: string }>(
      `UPDATE run_participants
       SET abandoned = true,
           final_distance = 0,
           final_pace = 0
       WHERE run_id = $1
         AND is_present = true
         AND (abandoned IS NULL OR abandoned = false)
       RETURNING user_id`,
      [runId]
    );
    if (result.rows.length > 0) {
      console.log(
        `[ghost-run-cleanup] Marked ${result.rows.length} participant(s) as abandoned in run ${runId} (no tracking data)`
      );
    }
  } catch (err: any) {
    console.error(`[ghost-run-cleanup] markParticipantsAbandoned(${runId}) failed:`, err?.message ?? err);
  }
}

/**
 * For a ghost-closed run that had some tracking data, compute final stats for each
 * un-finished participant from their tracking points and finalize them using the
 * canonical finishRunnerRun path so all side-effects (leaderboard ranks, auto-completion)
 * stay in sync with a normal runner finish.
 *
 * Participants with zero tracking points are marked abandoned=true (direct UPDATE)
 * and finalized as DNF so they are excluded from leaderboards.
 */
async function reconcileGhostRunParticipants(runId: string): Promise<void> {
  try {
    // Fetch run metadata needed for stat crediting and achievement checks
    const runMeta = await pool.query<{ activity_type: string | null; crew_id: string | null }>(
      `SELECT activity_type, crew_id FROM runs WHERE id = $1`,
      [runId]
    );
    const activityType = runMeta.rows[0]?.activity_type ?? "run";
    const crewId = runMeta.rows[0]?.crew_id ?? null;

    // Get all present (not yet finished, not yet abandoned) participants
    const participants = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM run_participants
       WHERE run_id = $1
         AND is_present = true
         AND final_pace IS NULL
         AND (abandoned IS NULL OR abandoned = false)`,
      [runId]
    );

    for (const { user_id } of participants.rows) {
      const statsRes = await pool.query<{
        max_dist: string | null;
        first_at: string | null;
        last_at: string | null;
        point_count: string;
      }>(
        `SELECT
           MAX(cumulative_distance) AS max_dist,
           MIN(recorded_at) AS first_at,
           MAX(recorded_at) AS last_at,
           COUNT(*) AS point_count
         FROM run_tracking_points
         WHERE run_id = $1 AND user_id = $2`,
        [runId, user_id]
      );

      const stats = statsRes.rows[0];
      const pointCount = parseInt(stats.point_count, 10);

      if (pointCount === 0 || stats.max_dist == null) {
        // This participant has no tracking data within a run that does have overall
        // tracking data. Mark them abandoned via direct UPDATE, then finalize as DNF
        // so leaderboard rank computation treats them as finished.
        await pool.query(
          `UPDATE run_participants SET abandoned = true WHERE run_id = $1 AND user_id = $2`,
          [runId, user_id]
        );
        await finishRunnerRun(runId, user_id, 0, 0, null, true);
        console.log(`[ghost-run-cleanup] Participant ${user_id} in run ${runId}: abandoned (no tracking points)`);
        continue;
      }

      const finalDistance = parseFloat(stats.max_dist);
      const firstAt = new Date(stats.first_at!).getTime();
      const lastAt = new Date(stats.last_at!).getTime();
      const finalDuration = Math.max(Math.round((lastAt - firstAt) / 1000), 1);
      const finalPace =
        finalDistance > 0.01 ? finalDuration / 60 / finalDistance : 0;

      if (finalDistance < 0.01 || finalPace <= 0) {
        await pool.query(
          `UPDATE run_participants SET abandoned = true WHERE run_id = $1 AND user_id = $2`,
          [runId, user_id]
        );
        await finishRunnerRun(runId, user_id, 0, 0, null, true);
        continue;
      }

      // Use the canonical finishRunnerRun path so all side-effects (leaderboard
      // rank computation, run auto-completion) are handled identically to a normal finish.
      await finishRunnerRun(runId, user_id, finalDistance, finalPace, null, false);

      // Credit per-participant stats (total_miles, completed_runs, miles_this_year/month)
      // and personal achievements. Crew streak is intentionally excluded here and
      // handled once per run after all participants are processed.
      try {
        await creditGhostParticipant(runId, user_id, finalDistance);
      } catch (creditErr: any) {
        console.error(
          `[ghost-run-cleanup] creditGhostParticipant failed for user ${user_id} in run ${runId}:`,
          creditErr?.message ?? creditErr
        );
      }

      // Award ride-specific achievements if this is a ride activity.
      if (activityType === "ride") {
        checkAndAwardRideAchievements(user_id).catch((err: any) =>
          console.error(`[ghost-run-cleanup] checkAndAwardRideAchievements(${user_id}):`, err?.message ?? err)
        );
      }

      console.log(
        `[ghost-run-cleanup] Reconciled participant ${user_id} in run ${runId}: ` +
        `${finalDistance.toFixed(2)} mi in ${finalDuration}s (pace ${finalPace.toFixed(2)} min/mi)`
      );
    }

    // Update crew streak once per run (not per participant) and award crew milestones.
    if (crewId) {
      try {
        await updateCrewStreakForRun(crewId);
      } catch (streakErr: any) {
        console.error(
          `[ghost-run-cleanup] updateCrewStreakForRun(${crewId}) failed:`,
          streakErr?.message ?? streakErr
        );
      }
      checkAndAwardCrewAchievements(crewId).catch((err: any) =>
        console.error(`[ghost-run-cleanup] checkAndAwardCrewAchievements(${crewId}):`, err?.message ?? err)
      );
    }
  } catch (err: any) {
    console.error(`[ghost-run-cleanup] reconcileGhostRunParticipants(${runId}) failed:`, err?.message ?? err);
  }
}

export function scheduleGhostRunCleanup(): void {
  closeGhostRuns().catch(() => {});
  setInterval(() => {
    closeGhostRuns().catch(() => {});
  }, CHECK_INTERVAL_MS);
  console.log("[ghost-run-cleanup] Scheduled (every 30 min)");
}
