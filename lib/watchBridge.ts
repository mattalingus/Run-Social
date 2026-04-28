import { NativeModules, Platform } from "react-native";

/**
 * Phone-side bridge to the paired Apple Watch.
 *
 * Use `sendAuthToken` after login / remember-token refresh / unit change so the
 * watch can run workouts standalone and upload them via `/api/solo-runs`.
 *
 * No-op on Android — the method resolves silently so callers don't need
 * Platform checks at every call site.
 */
const Bridge =
  Platform.OS === "ios" ? (NativeModules.PaceUpWatchBridge ?? null) : null;

export interface WatchAuthPayload {
  token: string;
  apiHost: string;
  userId?: number | string;
  distanceUnit?: "mi" | "km";
}

export interface WatchState {
  supported: boolean;
  paired?: boolean;
  watchAppInstalled?: boolean;
  reachable?: boolean;
  activationState?: number;
}

export const WatchBridge = {
  async sendAuthToken(data: WatchAuthPayload): Promise<WatchState> {
    if (!Bridge) return { supported: false };
    try {
      const res = await Bridge.sendAuthToken(data);
      return res ?? { supported: true };
    } catch (e) {
      console.warn("[WatchBridge] sendAuthToken failed:", e);
      return { supported: true, reachable: false };
    }
  },

  async getState(): Promise<WatchState> {
    if (!Bridge) return { supported: false };
    try {
      return (await Bridge.getWatchState()) ?? { supported: true };
    } catch {
      return { supported: true };
    }
  },

  async clearAuth(): Promise<void> {
    if (!Bridge) return;
    try {
      await Bridge.clearAuth();
    } catch (e) {
      console.warn("[WatchBridge] clearAuth failed:", e);
    }
  },
};
