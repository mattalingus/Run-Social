import { NativeModules, Platform } from "react-native";

export interface LiveActivityData {
  elapsedSeconds: number;
  distanceMiles: number;
  paceMinPerMile: number;
  activityType?: "run" | "ride" | "walk";
  activityName?: string;
  isPaused?: boolean;
  distanceUnit?: "mi" | "km";
  /**
   * Unix epoch seconds when the run started (adjusted for pauses).
   * If omitted we derive it from `now - elapsedSeconds`, which lets the
   * SwiftUI `.timer` text anchor correctly and self-correct on every update.
   */
  startedAt?: number;
}

const Bridge =
  Platform.OS === "ios" ? (NativeModules.PaceUpActivityBridge ?? null) : null;

function payload(data: LiveActivityData) {
  const now = Date.now() / 1000;
  return {
    elapsedSeconds: Math.max(0, Math.floor(data.elapsedSeconds ?? 0)),
    distanceMiles: data.distanceMiles ?? 0,
    paceMinPerMile: data.paceMinPerMile ?? 0,
    activityType: data.activityType ?? "run",
    activityName: data.activityName ?? "Run",
    isPaused: !!data.isPaused,
    distanceUnit: data.distanceUnit ?? "mi",
    startedAt:
      typeof data.startedAt === "number"
        ? data.startedAt
        : now - Math.max(0, data.elapsedSeconds ?? 0),
  };
}

export const LiveActivity = {
  async start(data: LiveActivityData): Promise<void> {
    if (!Bridge) return;
    try {
      await Bridge.startActivity(payload(data));
    } catch (e) {
      console.warn("[LiveActivity] start failed:", e);
    }
  },

  async update(data: LiveActivityData): Promise<void> {
    if (!Bridge) return;
    try {
      await Bridge.updateActivity(payload(data));
    } catch (e) {
      console.warn("[LiveActivity] update failed:", e);
    }
  },

  async end(data?: Partial<LiveActivityData>): Promise<void> {
    if (!Bridge) return;
    try {
      await Bridge.endActivity(
        payload({
          elapsedSeconds: data?.elapsedSeconds ?? 0,
          distanceMiles: data?.distanceMiles ?? 0,
          paceMinPerMile: data?.paceMinPerMile ?? 0,
          activityType: data?.activityType,
          isPaused: false,
          distanceUnit: data?.distanceUnit,
          startedAt: data?.startedAt,
        })
      );
    } catch (e) {
      console.warn("[LiveActivity] end failed:", e);
    }
  },
};
