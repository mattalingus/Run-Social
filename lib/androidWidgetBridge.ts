import { NativeModules, Platform } from "react-native";

export interface WidgetData {
  nextRunTitle?: string;
  nextRunTimestamp?: number;
  distanceRangeMiles?: string;
  weeklyMiles?: number;
  monthlyGoal?: number;
}

/**
 * React Native NativeModule registered by PaceUpNativePackage.
 * Available after EAS build — not present in Expo Go (falls back to no-op).
 */
function getBridge(): { writeWidgetData: (json: string) => Promise<void> } | null {
  return NativeModules.PaceUpAndroidBridge ?? null;
}

let _cache: WidgetData = {};

/**
 * Write widget data to Android SharedPreferences via PaceUpNativeModule.
 * The AppWidgetProvider reads from the same SharedPreferences file/key,
 * and the native module triggers a broadcast to refresh all widget instances.
 */
export async function updateAndroidWidget(data: WidgetData): Promise<void> {
  if (Platform.OS !== "android") return;
  _cache = { ..._cache, ...data };
  const payload = JSON.stringify({
    nextRunTitle: _cache.nextRunTitle ?? "",
    nextRunTimestamp: _cache.nextRunTimestamp ?? 0,
    distanceRangeMiles: _cache.distanceRangeMiles ?? "",
    weeklyMiles: _cache.weeklyMiles ?? 0,
    monthlyGoal: _cache.monthlyGoal ?? 0,
  });
  const bridge = getBridge();
  if (!bridge) return;
  try {
    await bridge.writeWidgetData(payload);
  } catch (e) {
    console.warn("[AndroidWidgetBridge] writeWidgetData failed:", e);
  }
}
