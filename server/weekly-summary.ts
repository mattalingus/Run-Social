import * as storage from "./storage";
import * as ai from "./ai";
import { sendPushNotification } from "./notifications";

export async function sendWeeklySummaries(): Promise<void> {
  console.log("[weekly-summary] Sending weekly summaries...");
  const users = await storage.getUsersForWeeklySummary();

  for (const user of users) {
    try {
      const stats = await storage.getWeeklyStatsForUser(user.id);
      if (stats.runs === 0) continue;

      const mi = stats.totalMi.toFixed(1);
      const mins = Math.floor(stats.totalSeconds / 60);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      const timeLabel = h > 0 ? `${h}h ${m}m` : `${m}m`;

      const insight = await ai.generateWeeklyInsight(user.name, stats);
      const body = insight 
        ? `${stats.runs} activit${stats.runs !== 1 ? "ies" : "y"} · ${mi} mi · ${timeLabel} — ${insight}`
        : `${stats.runs} activit${stats.runs !== 1 ? "ies" : "y"} · ${mi} mi · ${timeLabel} this week — keep it up!`;

      await sendPushNotification(
        user.push_token,
        `Your weekly PaceUp summary 📊`,
        body,
        { screen: "profile" }
      );
    } catch (err) {
      console.error(`[weekly-summary] Failed for user ${user.id}:`, err);
    }
  }

  console.log(`[weekly-summary] Sent to ${users.length} eligible users`);
}

function msUntilNextSunday8pm(): number {
  const now = new Date();
  const day = now.getUTCDay();
  const daysUntilSunday = day === 0 ? 7 : 7 - day;
  const next = new Date(now);
  next.setUTCDate(now.getUTCDate() + daysUntilSunday);
  next.setUTCHours(20, 0, 0, 0);
  return Math.max(next.getTime() - now.getTime(), 1000);
}

export function scheduleWeeklySummary(): void {
  function scheduleNext() {
    const delay = msUntilNextSunday8pm();
    const hours = Math.round(delay / 1000 / 3600);
    console.log(`[weekly-summary] Next send in ~${hours}h (Sunday 8pm UTC)`);
    setTimeout(async () => {
      try {
        await sendWeeklySummaries();
      } catch (err) {
        console.error("[weekly-summary] Batch error:", err);
      }
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}

// ─── Streak-At-Risk Check ──────────────────────────────────────────────────

function getCurrentISOWeek(): number {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export async function checkCrewStreakAtRisk(): Promise<void> {
  console.log("[streak-risk] Checking crews at streak risk...");
  try {
    const crews = await storage.getCrewsAtStreakRisk();
    const currentWeek = getCurrentISOWeek();
    for (const crew of crews) {
      try {
        const weeksLabel = crew.current_streak_weeks === 1 ? "1-week" : `${crew.current_streak_weeks}-week`;
        await storage.createCrewMessage(
          crew.id,
          "system",
          "PaceUp Bot",
          null,
          `⚠️ Heads up! Your ${weeksLabel} streak is at risk — no activity logged this week yet. Schedule one to keep it alive! 🔥`,
          "milestone"
        );
        await storage.updateCrew(crew.id, { streak_risk_notif_week: currentWeek });
        console.log(`[streak-risk] Sent at-risk warning to crew ${crew.id} (${crew.name})`);
      } catch (err) {
        console.error(`[streak-risk] Failed for crew ${crew.id}:`, err);
      }
    }
    console.log(`[streak-risk] Checked ${crews.length} crews`);
  } catch (err) {
    console.error("[streak-risk] Batch error:", err);
  }
}

export function scheduleStreakAtRiskCheck(): void {
  // Run once immediately, then every 24 hours (Wednesday is ideal mid-week check)
  const run = async () => {
    try {
      await checkCrewStreakAtRisk();
    } catch (err) {
      console.error("[streak-risk] Scheduler error:", err);
    }
  };
  // Initial run after a short startup delay
  setTimeout(run, 10_000);
  setInterval(run, 24 * 60 * 60 * 1000);
  console.log("[streak-risk] Streak-at-risk checker scheduled (daily)");
}
