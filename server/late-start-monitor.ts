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
        const type = run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run";
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
    const stale = await pool.query(
      `SELECT id, title, crew_id FROM runs
       WHERE is_active = true
         AND is_completed = false
         AND started_at < NOW() - INTERVAL '8 hours'`
    );
    for (const r of stale.rows) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const lockRes = await client.query(
          `SELECT id FROM runs WHERE id = $1 AND is_active = true AND is_completed = false FOR UPDATE`,
          [r.id]
        );
        if (lockRes.rows.length === 0) {
          await client.query('ROLLBACK');
          continue;
        }
        const finishedParticipants = await client.query(
          `SELECT rp.user_id, rp.final_distance
           FROM run_participants rp
           WHERE rp.run_id = $1 AND rp.final_pace IS NOT NULL AND rp.status != 'confirmed'`,
          [r.id]
        );
        for (const p of finishedParticipants.rows) {
          const miles = parseFloat(p.final_distance) || 3;
          await client.query(
            `UPDATE run_participants SET status = 'confirmed', miles_logged = $3 WHERE run_id = $1 AND user_id = $2`,
            [r.id, p.user_id, miles]
          );
          await client.query(
            `UPDATE users SET
              completed_runs = completed_runs + 1,
              total_miles = total_miles + $2,
              miles_this_year = miles_this_year + $2,
              miles_this_month = miles_this_month + $2
             WHERE id = $1`,
            [p.user_id, miles]
          );
        }
        if (r.crew_id && finishedParticipants.rows.length > 0) {
          const crew = await client.query(
            `SELECT id, current_streak_weeks, last_run_week FROM crews WHERE id = $1 FOR UPDATE`,
            [r.crew_id]
          );
          if (crew.rows.length > 0) {
            const c = crew.rows[0];
            const now = new Date();
            const lastRun = c.last_run_week ? new Date(c.last_run_week) : null;
            const getWeekNumber = (d: Date) => {
              const onejan = new Date(d.getFullYear(), 0, 1);
              return Math.ceil((((d.getTime() - onejan.getTime()) / 86400000) + onejan.getDay() + 1) / 7);
            };
            const currentWeek = getWeekNumber(now);
            const currentYear = now.getFullYear();
            const lastWeek = lastRun ? getWeekNumber(lastRun) : -1;
            const lastYear = lastRun ? lastRun.getFullYear() : -1;
            let newStreak = c.current_streak_weeks || 0;
            if (lastYear === currentYear && lastWeek === currentWeek) {
            } else if (lastYear === currentYear && lastWeek === currentWeek - 1) {
              newStreak++;
            } else if (lastYear === currentYear - 1 && lastWeek >= 52 && currentWeek === 1) {
              newStreak++;
            } else {
              newStreak = 1;
            }
            await client.query(
              `UPDATE crews SET current_streak_weeks = $2, last_run_week = $3 WHERE id = $1`,
              [r.crew_id, newStreak, now]
            );
            console.log(`[late-start] Updated crew ${r.crew_id} streak to ${newStreak} weeks`);
          }
        }
        const ranksRes = await client.query(
          `SELECT user_id, final_pace FROM run_participants
           WHERE run_id = $1 AND final_pace IS NOT NULL AND final_pace > 0 ORDER BY final_pace ASC`,
          [r.id]
        );
        for (let i = 0; i < ranksRes.rows.length; i++) {
          await client.query(
            `UPDATE run_participants SET final_rank = $3 WHERE run_id = $1 AND user_id = $2`,
            [r.id, ranksRes.rows[i].user_id, i + 1]
          );
        }
        await client.query(
          `UPDATE runs SET is_completed = true, is_active = false WHERE id = $1`,
          [r.id]
        );
        await client.query('COMMIT');
        console.log(`[late-start] Auto-completed stale run ${r.id} ("${r.title}") with ${finishedParticipants.rows.length} credited`);
      } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`[late-start] Auto-completion failed for run ${r.id}:`, err?.message);
      } finally {
        client.release();
      }
    }

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

const PRE_RUN_PHRASES = [
  (type: string, title: string) => `Lace up — your ${type} starts in 30 minutes! 👟`,
  (type: string, title: string) => `30 min to go. Your crew is counting on you 💪`,
  (type: string, title: string) => `Time to get moving — "${title}" kicks off in 30!`,
  (type: string, title: string) => `Head out now so you make it to the start on time 🏃`,
  (type: string, title: string) => `Your ${type} is almost here. Don't leave your crew hanging!`,
  (type: string, title: string) => `30 minutes until "${title}" — get those miles ready 🔥`,
  (type: string, title: string) => `Almost time! "${title}" starts in 30. See you out there 🌟`,
  (type: string, title: string) => `Your ${type} is starting soon — warm up and head over!`,
  (type: string, title: string) => `30-minute warning: "${title}" is about to begin. Let's go! 🚀`,
  (type: string, title: string) => `Rise and roll — "${title}" kicks off in 30 minutes ⚡`,
];

async function checkPreRunReminders(): Promise<void> {
  try {
    const result = await pool.query<{
      id: string;
      title: string;
      activity_type: string;
      host_id: string;
    }>(
      `SELECT r.id, r.title, r.activity_type, r.host_id
       FROM runs r
       WHERE r.is_active = false
         AND r.is_completed = false
         AND (r.is_deleted IS NULL OR r.is_deleted = false)
         AND r.notif_pre_run_sent = false
         AND r.date > NOW() + INTERVAL '25 minutes'
         AND r.date < NOW() + INTERVAL '35 minutes'`
    );

    if (!result.rows.length) return;

    const ids = result.rows.map((r) => r.id);
    await pool.query(
      `UPDATE runs SET notif_pre_run_sent = true WHERE id = ANY($1)`,
      [ids]
    );

    for (const run of result.rows) {
      const type = run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run";
      const phraseIdx = Math.floor(Math.random() * PRE_RUN_PHRASES.length);
      const body = PRE_RUN_PHRASES[phraseIdx](type, run.title);
      const title = `⏱ ${run.title} starts soon`;

      const participants = await pool.query<{
        push_token: string | null;
        notifications_enabled: boolean;
        notif_run_reminders: boolean;
      }>(
        `SELECT u.push_token, u.notifications_enabled, u.notif_run_reminders
         FROM run_participants rp
         JOIN users u ON u.id = rp.user_id
         WHERE rp.run_id = $1
           AND rp.status IN ('joined', 'confirmed')
           AND u.push_token IS NOT NULL`,
        [run.id]
      );

      const tokens = participants.rows
        .filter((p) => p.notifications_enabled !== false && p.notif_run_reminders !== false && p.push_token)
        .map((p) => p.push_token as string);

      if (tokens.length > 0) {
        await sendPushNotification(tokens, title, body, { screen: "run", runId: run.id });
      }
      console.log(`[pre-run] Sent reminder for run ${run.id} ("${run.title}") to ${tokens.length} participant(s)`);
    }
  } catch (err) {
    console.error("[pre-run] Check failed:", err);
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
    checkPreRunReminders();
    checkLateStarts();
    cleanupStaleActiveRuns();
    cleanupUnstartedRuns();
    checkAndPromoteHost();
  }, CHECK_INTERVAL_MS);
  checkPreRunReminders();
  checkLateStarts();
  cleanupStaleActiveRuns();
  cleanupUnstartedRuns();
  checkAndPromoteHost();
}
