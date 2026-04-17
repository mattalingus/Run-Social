import { NativeModules, Platform } from "react-native";

export interface Coord {
  latitude: number;
  longitude: number;
}

export interface LiveNotificationData {
  elapsedSeconds: number;
  distanceMiles: number;
  paceMinPerMile: number;
  activityType?: "run" | "ride" | "walk";
  coordinates?: Coord[];
  /** Optional group run ID — used to deep-link notification tap to the correct screen */
  runId?: string;
}

interface NativeBridge {
  startLiveNotification: (params: Record<string, string>) => Promise<void>;
  updateLiveNotification: (params: Record<string, string>) => Promise<void>;
  stopLiveNotification: () => Promise<void>;
}

/**
 * React Native NativeModule registered by PaceUpNativePackage.
 * Available after EAS build — not present in Expo Go (falls back gracefully).
 */
function getBridge(): NativeBridge | null {
  return NativeModules.PaceUpAndroidBridge ?? null;
}

function formatElapsed(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatPace(p: number): string {
  if (p <= 0) return "--:--";
  let m = Math.floor(p);
  let s = Math.round((p - m) * 60);
  if (s === 60) { s = 0; m += 1; }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function activityLabel(type: string): string {
  switch (type) {
    case "ride": return "Ride";
    case "walk": return "Walk";
    default: return "Run";
  }
}

/**
 * Encode GPS polyline as compact sampled JSON (≤100 points).
 * Passed to the native ForegroundService which renders it as a Canvas bitmap
 * and attaches it as the notification's large icon on the lock screen.
 */
function encodeRoutePayload(coordinates: Coord[]): string {
  if (!coordinates || coordinates.length < 2) return "";
  const MAX_POINTS = 100;
  const step = coordinates.length > MAX_POINTS
    ? Math.floor(coordinates.length / MAX_POINTS)
    : 1;
  const sampled: Coord[] = [];
  for (let i = 0; i < coordinates.length; i += step) {
    sampled.push(coordinates[i]);
  }
  const last = coordinates[coordinates.length - 1];
  if (sampled[sampled.length - 1] !== last) {
    sampled.push(last);
  }
  return JSON.stringify(sampled);
}

let _notificationStarted = false;

function buildParams(data: LiveNotificationData): Record<string, string> {
  const {
    elapsedSeconds,
    distanceMiles,
    paceMinPerMile,
    activityType = "run",
    coordinates = [],
    runId,
  } = data;
  const params: Record<string, string> = {
    elapsed: formatElapsed(elapsedSeconds),
    distance: `${distanceMiles.toFixed(2)} mi`,
    pace: `${formatPace(paceMinPerMile)} /mi`,
    activityType: activityLabel(activityType),
    routePayload: encodeRoutePayload(coordinates),
  };
  if (runId) {
    params.runId = runId;
  }
  return params;
}

export const AndroidLiveNotification = {
  /**
   * Start the Android ForegroundService and show the lock screen notification.
   * The service renders the GPS polyline bitmap and attaches it as the large icon.
   */
  async start(data: LiveNotificationData): Promise<void> {
    if (Platform.OS !== "android") return;
    const bridge = getBridge();
    if (!bridge) return;
    _notificationStarted = true;
    try {
      await bridge.startLiveNotification(buildParams(data));
    } catch (e) {
      console.warn("[AndroidLiveNotification] start failed:", e);
    }
  },

  /**
   * Update notification stats + redraw the route bitmap with accumulated coordinates.
   * Called on each GPS fix at the same cadence as iOS Live Activity updates.
   */
  async update(data: LiveNotificationData): Promise<void> {
    if (Platform.OS !== "android" || !_notificationStarted) return;
    const bridge = getBridge();
    if (!bridge) return;
    try {
      await bridge.updateLiveNotification(buildParams(data));
    } catch (e) {
      console.warn("[AndroidLiveNotification] update failed:", e);
    }
  },

  /**
   * Stop the ForegroundService and dismiss the notification.
   * Called when the run/ride/walk session ends.
   */
  async end(_data?: Partial<LiveNotificationData>): Promise<void> {
    if (Platform.OS !== "android") return;
    _notificationStarted = false;
    const bridge = getBridge();
    if (!bridge) return;
    try {
      await bridge.stopLiveNotification();
    } catch (e) {
      console.warn("[AndroidLiveNotification] stop failed:", e);
    }
  },
};
