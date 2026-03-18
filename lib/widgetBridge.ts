import { NativeModules, Platform } from "react-native";

export interface WidgetData {
  nextRunTitle?: string;
  nextRunTimestamp?: number;
  distanceRangeMiles?: string;
  weeklyMiles?: number;
  monthlyGoal?: number;
}

const Bridge =
  Platform.OS === "ios" ? (NativeModules.PaceUpWidgetBridge ?? null) : null;

// Module-level cache so partial updates from different screens get merged
// before writing to the App Group JSON file.
let _cache: WidgetData = {};

export async function updateWidget(data: WidgetData): Promise<void> {
  _cache = { ..._cache, ...data };
  if (!Bridge) return;
  try {
    const payload = JSON.stringify({
      nextRunTitle: _cache.nextRunTitle ?? "",
      nextRunTimestamp: _cache.nextRunTimestamp ?? 0,
      distanceRangeMiles: _cache.distanceRangeMiles ?? "",
      weeklyMiles: _cache.weeklyMiles ?? 0,
      monthlyGoal: _cache.monthlyGoal ?? 0,
    });
    await Bridge.writeWidgetJson(payload);
  } catch (e) {
    console.warn("[WidgetBridge] update failed:", e);
  }
}
