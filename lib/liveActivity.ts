import { NativeModules, Platform } from "react-native";

export interface LiveActivityData {
  elapsedSeconds: number;
  distanceMiles: number;
  paceMinPerMile: number;
  activityType?: "run" | "ride" | "walk";
  activityName?: string;
}

const Bridge =
  Platform.OS === "ios" ? (NativeModules.PaceUpActivityBridge ?? null) : null;

export const LiveActivity = {
  async start(data: LiveActivityData): Promise<void> {
    if (!Bridge) return;
    try {
      await Bridge.startActivity({
        elapsedSeconds: data.elapsedSeconds,
        distanceMiles: data.distanceMiles,
        paceMinPerMile: data.paceMinPerMile,
        activityType: data.activityType ?? "run",
        activityName: data.activityName ?? "Run",
      });
    } catch (e) {
      console.warn("[LiveActivity] start failed:", e);
    }
  },

  async update(data: LiveActivityData): Promise<void> {
    if (!Bridge) return;
    try {
      await Bridge.updateActivity({
        elapsedSeconds: data.elapsedSeconds,
        distanceMiles: data.distanceMiles,
        paceMinPerMile: data.paceMinPerMile,
        activityType: data.activityType ?? "run",
      });
    } catch (e) {
      console.warn("[LiveActivity] update failed:", e);
    }
  },

  async end(data?: Partial<LiveActivityData>): Promise<void> {
    if (!Bridge) return;
    try {
      await Bridge.endActivity({
        elapsedSeconds: data?.elapsedSeconds ?? 0,
        distanceMiles: data?.distanceMiles ?? 0,
        paceMinPerMile: data?.paceMinPerMile ?? 0,
        activityType: data?.activityType ?? "run",
      });
    } catch (e) {
      console.warn("[LiveActivity] end failed:", e);
    }
  },
};
