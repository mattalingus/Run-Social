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
 *
 * iOS quirk: initHealthKit returns success with null error even when the user
 * denied read permissions. We probe with getAuthStatus (if available) and a
 * sample read to distinguish real success from silent denial.
 */
export async function requestHealthKitPermissions(): Promise<boolean> {
  const hk = getHealthKit();
  if (!hk) {
    throw new Error("HEALTHKIT_UNAVAILABLE: This build doesn't include Apple Health support. Update to the latest version from the App Store.");
  }

  hkInitialized = false;
  const err = await ensureHealthKitInitialized();
  if (err) {
    throw new Error(err);
  }

  const probeOk = await new Promise<boolean>((resolve) => {
    try {
      hk.getAnchoredWorkouts(
        {
          startDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
          endDate: new Date().toISOString(),
          type: "Workout",
          limit: 1,
        },
        (e: any) => {
          if (e) {
            console.warn("[HealthKit] permission probe error:", e);
            resolve(false);
          } else {
            resolve(true);
          }
        }
      );
    } catch (e) {
      console.warn("[HealthKit] permission probe exception:", e);
      resolve(false);
    }
  });

  if (!probeOk) {
    throw new Error("PERMISSION_DENIED: Apple Health access was denied. Open Settings → Apps → Health → Data Access & Devices → PaceUp to enable it.");
  }

  return true;
}

/** Diagnostic info for the Settings "Diagnose" action. */
export function healthKitDiagnostics(): { platform: string; available: boolean; moduleLoaded: boolean; initialized: boolean } {
  return {
    platform: Platform.OS,
    available: isHealthKitAvailable(),
    moduleLoaded: AppleHealthKit !== null,
    initialized: hkInitialized,
  };
}

function mapWorkoutType(typeId: number | string | undefined): "run" | "ride" | "walk" | null {
  if (typeId === undefined || typeId === null) return null;
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

const MILES_TO_METERS = 1609.344;

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
    hk.getAnchoredWorkouts(
      {
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
        type: "Workout",
        limit: 500,
      },
      (err: any, results: any) => {
        if (err || !results) {
          console.warn("[HealthKit] getAnchoredWorkouts error:", err);
          resolve([]);
          return;
        }

        const data: any[] = Array.isArray(results) ? results : (results.data ?? []);
        const workouts: HealthKitWorkout[] = [];
        for (const r of data) {
          const actType = mapWorkoutType(r.activityId ?? r.activityName ?? r.activityType ?? r.workoutActivityType);
          if (!actType) continue;

          const start = new Date(r.start ?? r.startDate);
          const end = new Date(r.end ?? r.endDate);
          const durationSeconds = r.duration
            ? Math.round(r.duration)
            : Math.round((end.getTime() - start.getTime()) / 1000);
          const distMiles = typeof r.distance === "number" ? r.distance : 0;
          const distMeters = distMiles * MILES_TO_METERS;

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
