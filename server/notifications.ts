const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface PushMessage {
  to: string | string[];
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: "default" | null;
  badge?: number;
}

export async function sendPushNotification(
  tokens: string | string[],
  title: string,
  body: string,
  data?: Record<string, any>
): Promise<void> {
  const tokenList = Array.isArray(tokens) ? tokens : [tokens];
  const valid = tokenList.filter((t) => t && t.startsWith("ExponentPushToken["));
  if (!valid.length) return;

  const messages: PushMessage[] = valid.map((to) => ({
    to,
    title,
    body,
    sound: "default",
    data: data ?? {},
  }));

  try {
    await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });
  } catch (err) {
    console.error("[push] Failed to send notification:", err);
  }
}

export type NotifType = "run_reminders" | "crew_activity" | "weekly_summary" | "friend_requests";

const notifFieldMap: Record<NotifType, string> = {
  run_reminders: "notif_run_reminders",
  crew_activity: "notif_crew_activity",
  weekly_summary: "notif_weekly_summary",
  friend_requests: "notif_friend_requests",
};

export function userWantsNotif(user: any, type: NotifType): boolean {
  if (!user) return false;
  if (user.notifications_enabled === false) return false;
  if (!user.push_token) return false;
  const field = notifFieldMap[type];
  return user[field] !== false;
}
