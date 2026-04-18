import { Platform } from "react-native";

export interface GpsCoordInput {
  accuracy?: number | null;
  speed?: number | null;
}

/**
 * Returns true when the coordinate is good enough to accept for tracking,
 * false when it should be discarded.
 *
 * Filters applied:
 *  1. Accuracy gate   — native ≤ 40 m, web ≤ 100 m
 *  2. Vehicle-speed gate — walk > 4 m/s, run > 12 m/s, ride > 22 m/s
 *
 * Extracted from app/run-tracking.tsx so both solo and live-group paths
 * stay in sync with a single source of truth.
 */
export function shouldAcceptCoord(
  coord: GpsCoordInput,
  activityType: "run" | "ride" | "walk"
): boolean {
  const maxAccuracy = Platform.OS === "web" ? 100 : 40;
  if (coord.accuracy != null && coord.accuracy > maxAccuracy) return false;

  const vehicleThreshold =
    activityType === "ride" ? 22 : activityType === "walk" ? 4 : 12;
  if (coord.speed != null && coord.speed > 0 && coord.speed > vehicleThreshold)
    return false;

  return true;
}
