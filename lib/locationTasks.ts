import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

export const SOLO_LOCATION_TASK = "PACEUP_SOLO_LOCATION";
export const GROUP_LOCATION_TASK = "PACEUP_GROUP_LOCATION";

export type LocationCallback = (
  latitude: number,
  longitude: number,
  speed: number | null,
  altitude: number | null,
  accuracy: number | null
) => void;

const soloListeners: LocationCallback[] = [];
const groupListeners: LocationCallback[] = [];

export function addSoloLocationListener(cb: LocationCallback): () => void {
  soloListeners.push(cb);
  return () => {
    const i = soloListeners.indexOf(cb);
    if (i > -1) soloListeners.splice(i, 1);
  };
}

export function addGroupLocationListener(cb: LocationCallback): () => void {
  groupListeners.push(cb);
  return () => {
    const i = groupListeners.indexOf(cb);
    if (i > -1) groupListeners.splice(i, 1);
  };
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(SOLO_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data;
  for (const loc of locations) {
    const { latitude, longitude, speed, altitude, accuracy } = loc.coords;
    soloListeners.forEach((cb) => cb(latitude, longitude, speed ?? null, altitude ?? null, accuracy ?? null));
  }
});

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(GROUP_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data;
  for (const loc of locations) {
    const { latitude, longitude, speed, altitude, accuracy } = loc.coords;
    groupListeners.forEach((cb) => cb(latitude, longitude, speed ?? null, altitude ?? null, accuracy ?? null));
  }
});

export async function requestForegroundPermission(): Promise<boolean> {
  if (Platform.OS === "web") return true;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

export async function requestBackgroundPermission(): Promise<boolean> {
  if (Platform.OS === "web") return true;
  try {
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== "granted") return false;

    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    return bgStatus === "granted";
  } catch {
    return false;
  }
}

export async function safeStartLocationUpdates(
  taskName: string,
  options: Location.LocationTaskOptions
): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(taskName);
    if (isRegistered) {
      await Location.stopLocationUpdatesAsync(taskName);
    }
  } catch {}
  await Location.startLocationUpdatesAsync(taskName, options);
}

export async function safeStopLocationUpdates(taskName: string): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(taskName);
    if (isRegistered) {
      await Location.stopLocationUpdatesAsync(taskName);
    }
  } catch {}
}
