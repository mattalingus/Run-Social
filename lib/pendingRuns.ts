/**
 * Offline-first save queue for solo runs.
 *
 * If POST /api/solo-runs fails for any reason (network dead, server 5xx,
 * auth rejection not recoverable via restore-session), the payload is
 * persisted to AsyncStorage so no user run is ever lost. The queue is
 * flushed on every successful apiRequest and on app foreground.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest } from "@/lib/query-client";

const KEY = "paceup_pending_solo_runs";

export interface PendingSoloRun {
  payload: Record<string, unknown>;
  queuedAt: number;
  attempts: number;
}

async function readQueue(): Promise<PendingSoloRun[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: PendingSoloRun[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(items));
  } catch {}
}

/** Add a run payload to the pending-saves queue. */
export async function queuePendingRun(payload: Record<string, unknown>): Promise<void> {
  const q = await readQueue();
  q.push({ payload, queuedAt: Date.now(), attempts: 0 });
  await writeQueue(q);
}

/** Number of queued runs (for UI badges / notices). */
export async function getPendingRunCount(): Promise<number> {
  return (await readQueue()).length;
}

/**
 * Try to flush the queue. Returns counts. Caller should ignore errors —
 * queue stays populated for the next attempt.
 */
let _flushInFlight = false;
export async function flushPendingRuns(): Promise<{ flushed: number; remaining: number }> {
  if (_flushInFlight) return { flushed: 0, remaining: (await readQueue()).length };
  _flushInFlight = true;
  try {
    const q = await readQueue();
    if (q.length === 0) return { flushed: 0, remaining: 0 };
    const remaining: PendingSoloRun[] = [];
    let flushed = 0;
    for (const item of q) {
      try {
        const res = await apiRequest("POST", "/api/solo-runs", item.payload);
        if (res.ok) {
          flushed++;
        } else {
          remaining.push({ ...item, attempts: item.attempts + 1 });
        }
      } catch {
        remaining.push({ ...item, attempts: item.attempts + 1 });
      }
    }
    await writeQueue(remaining);
    return { flushed, remaining: remaining.length };
  } finally {
    _flushInFlight = false;
  }
}
