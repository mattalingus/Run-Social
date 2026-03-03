import * as storage from "./storage";
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

      await sendPushNotification(
        user.push_token,
        `Your weekly FARA summary 📊`,
        `${stats.runs} run${stats.runs !== 1 ? "s" : ""} · ${mi} mi · ${timeLabel} this week — keep it up!`,
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
