import { Platform } from "react-native";

export interface HealthKitWorkout {
  id: string;
  activityType: "run" | "ride" | "walk";
  startDate: string;
  endDate: string;
  distanceMeters: number;
  durationSeconds: number;
  totalEnergyBurned?: number;
  sourceName?: string;
}

let AppleHealthKit: any = null;
let hkInitialized = false;

function getHealthKit(): any {
  if (Platform.OS !== "ios" || Platform.isPad) return null;
  if (AppleHealthKit) return AppleHealthKit;
  try {
    const mod = require("react-native-health");
    const hk = mod.default ?? mod;
    if (!hk || typeof hk.initHealthKit !== "function") return null;
    AppleHealthKit = hk;
    return AppleHealthKit;
  } catch {
    return null;
  }
}

export function isHealthKitAvailable(): boolean {
  return Platform.OS === "ios" && !Platform.isPad && getHealthKit() !== null;
}

function buildPermissions(): object {
  return {
    permissions: {
      read: [
        "Workout",
        "DistanceWalkingRunning",
        "DistanceCycling",
        "ActiveEnergyBurned",
        "HeartRate",
      ],
      write: [
        "Workout",
        "ActiveEnergyBurned",
      ],
    },
  };
}

/**
 * Ensures HealthKit is initialized for the current app session.
 * Returns null on success, or an error string describing the failure reason.
 * Uses a session flag so it only calls initHealthKit once per app launch.
 */
async function ensureHealthKitInitialized(): Promise<string | null> {
  if (hkInitialized) return null;
  const hk = getHealthKit();
  if (!hk) return "HealthKit is not available on this device.";

  const permissions = buildPermissions();
  return new Promise((resolve) => {
    hk.initHealthKit(permissions, (err: any) => {
      if (err) {
        const msg = typeof err === "string" ? err : JSON.stringify(err);
        console.warn("[HealthKit] initHealthKit error:", msg);
        resolve(msg);
      } else {
        hkInitialized = true;
        resolve(null);
      }
    });
  });
}

/**
 * Requests HealthKit read + write permissions. Returns true on success.
 * Throws a descriptive Error on failure so callers can surface the reason.
 */
export async function requestHealthKitPermissions(): Promise<boolean> {
  const hk = getHealthKit();
  if (!hk) return false;

  hkInitialized = false;
  const err = await ensureHealthKitInitialized();
  if (err) {
    throw new Error(err);
  }
  return true;
}

function mapWorkoutType(typeId: number | string): "run" | "ride" | "walk" | null {
  const id = typeof typeId === "string" ? parseInt(typeId, 10) : typeId;
  if (id === 37) return "run";
  if (id === 13) return "ride";
  if (id === 52 || id === 83) return "walk";
  const strType = String(typeId).toLowerCase();
  if (strType.includes("run") || strType.includes("jog")) return "run";
  if (strType.includes("cycl") || strType.includes("bik") || strType.includes("ride")) return "ride";
  if (strType.includes("walk") || strType.includes("hik")) return "walk";
  return null;
}

export async function fetchWorkouts(daysSince: number = 90): Promise<HealthKitWorkout[]> {
  const hk = getHealthKit();
  if (!hk) return [];

  const initErr = await ensureHealthKitInitialized();
  if (initErr) {
    console.warn("[HealthKit] fetchWorkouts init error:", initErr);
    return [];
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysSince);

  return new Promise((resolve) => {
    hk.getSamples(
      {
        typeIdentifier: "Workout",
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
        limit: 500,
      },
      (err: any, results: any[]) => {
        if (err || !results) {
          console.warn("[HealthKit] getSamples error:", err);
          resolve([]);
          return;
        }

        const workouts: HealthKitWorkout[] = [];
        for (const r of results) {
          const actType = mapWorkoutType(r.activityType ?? r.workoutActivityType ?? "");
          if (!actType) continue;

          const start = new Date(r.startDate ?? r.start);
          const end = new Date(r.endDate ?? r.end);
          const durationSeconds = Math.round((end.getTime() - start.getTime()) / 1000);
          const distMeters = r.distance ? r.distance * 1000 : (r.totalDistance ?? 0);

          if (distMeters < 100 || durationSeconds < 60) continue;

          workouts.push({
            id: r.id ?? r.uuid ?? `${start.getTime()}-${distMeters.toFixed(0)}`,
            activityType: actType,
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            distanceMeters: distMeters,
            durationSeconds,
            totalEnergyBurned: r.calories ?? r.totalEnergyBurned ?? undefined,
            sourceName: r.sourceName ?? r.sourceRevision?.source?.name ?? "Apple Health",
          });
        }

        resolve(workouts);
      }
    );
  });
}

export interface SaveWorkoutOptions {
  activityType: "run" | "ride" | "walk";
  startDate: Date;
  endDate: Date;
  distanceMiles: number;
  durationSeconds: number;
  caloriesBurned?: number;
}

export async function saveWorkoutToHealthKit(opts: SaveWorkoutOptions): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  const hk = getHealthKit();
  if (!hk) return false;

  const initErr = await ensureHealthKitInitialized();
  if (initErr) {
    console.warn("[HealthKit] saveWorkout init error:", initErr);
    return false;
  }

  const typeMap: Record<string, string> = {
    run: "Running",
    ride: "Cycling",
    walk: "Walking",
  };
  const type = typeMap[opts.activityType] ?? "Running";

  return new Promise((resolve) => {
    try {
      hk.saveWorkout(
        {
          type,
          startDate: opts.startDate.toISOString(),
          endDate: opts.endDate.toISOString(),
          distance: opts.distanceMiles,
          distanceUnit: "mile",
          energyBurned: opts.caloriesBurned ?? 0,
          energyBurnedUnit: "calorie",
        },
        (err: any) => {
          if (err) {
            console.warn("[HealthKit] saveWorkout error:", err);
            resolve(false);
          } else {
            resolve(true);
          }
        }
      );
    } catch (e) {
      console.warn("[HealthKit] saveWorkout exception:", e);
      resolve(false);
    }
  });
}
