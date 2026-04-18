import { Pool } from "pg";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const BATCH_SIZE = 100;
const RECEIPT_DELAY_MS = 5000;

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: "default" | null;
  badge?: number;
}

interface PushTicket {
  id?: string;
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

interface PushReceipt {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

let _pool: Pool | null = null;
export function setNotificationsPool(pool: Pool) {
  _pool = pool;
}

async function removeStaleToken(token: string) {
  if (!_pool) return;
  try {
    await _pool.query(`UPDATE users SET push_token = NULL WHERE push_token = $1`, [token]);
  } catch (err) {
    console.error("[push] Failed to remove stale token:", err);
  }
}

async function fetchReceiptsAndCleanup(ticketIds: string[], tokensByTicket: Map<string, string>) {
  if (!ticketIds.length) return;
  await new Promise((r) => setTimeout(r, RECEIPT_DELAY_MS));
  try {
    const res = await fetch(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ids: ticketIds }),
    });
    if (!res.ok) return;
    const json = await res.json() as { data: Record<string, PushReceipt> };
    for (const [id, receipt] of Object.entries(json.data ?? {})) {
      if (receipt.status === "error") {
        const errCode = receipt.details?.error;
        if (errCode === "DeviceNotRegistered" || errCode === "InvalidCredentials") {
          const token = tokensByTicket.get(id);
          if (token) await removeStaleToken(token);
        }
      }
    }
  } catch (err) {
    console.error("[push] Failed to fetch receipts:", err);
  }
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

  for (let i = 0; i < valid.length; i += BATCH_SIZE) {
    const chunk = valid.slice(i, i + BATCH_SIZE);
    const messages: PushMessage[] = chunk.map((to) => ({
      to,
      title,
      body,
      sound: "default",
      data: data ?? {},
    }));

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(messages),
      });

      if (res.ok) {
        const json = await res.json() as { data: PushTicket[] };
        const tickets: PushTicket[] = json.data ?? [];
        const ticketIds: string[] = [];
        const tokensByTicket = new Map<string, string>();
        tickets.forEach((ticket, idx) => {
          if (ticket.status === "ok" && ticket.id) {
            ticketIds.push(ticket.id);
            tokensByTicket.set(ticket.id, chunk[idx]);
          } else if (ticket.status === "error") {
            const errCode = ticket.details?.error;
            if (errCode === "DeviceNotRegistered" || errCode === "InvalidCredentials") {
              removeStaleToken(chunk[idx]);
            }
          }
        });
        if (ticketIds.length > 0) {
          fetchReceiptsAndCleanup(ticketIds, tokensByTicket).catch(() => {});
        }
      }
    } catch (err) {
      console.error("[push] Failed to send notification batch:", err);
    }
  }
}

export type NotifType = "run_reminders" | "crew_activity" | "weekly_summary" | "friend_requests" | "direct_messages";

const notifFieldMap: Record<NotifType, string> = {
  run_reminders: "notif_run_reminders",
  crew_activity: "notif_crew_activity",
  weekly_summary: "notif_weekly_summary",
  friend_requests: "notif_friend_requests",
  direct_messages: "notif_direct_messages",
};

export function userWantsNotif(user: any, type: NotifType): boolean {
  if (!user) return false;
  if (user.notifications_enabled === false) return false;
  if (!user.push_token) return false;
  const field = notifFieldMap[type];
  return user[field] !== false;
}
