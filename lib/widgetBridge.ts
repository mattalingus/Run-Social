import { NativeModules, Platform } from "react-native";

export interface WidgetData {
  nextRunTitle?: string;
  nextRunTime?: string;
  weeklyMiles?: number;
  monthlyGoal?: number;
}

const Bridge =
  Platform.OS === "ios" ? (NativeModules.PaceUpWidgetBridge ?? null) : null;

export async function updateWidget(data: WidgetData): Promise<void> {
  if (!Bridge) return;
  try {
    await Bridge.updateWidgetData({
      nextRunTitle: data.nextRunTitle ?? "",
      nextRunTime: data.nextRunTime ?? "",
      weeklyMiles: data.weeklyMiles ?? 0,
      monthlyGoal: data.monthlyGoal ?? 0,
    });
  } catch (e) {
    console.warn("[WidgetBridge] update failed:", e);
  }
}
