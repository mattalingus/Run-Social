import { Platform } from "react-native";

export interface HealthConnectWorkout {
  id: string;
  activityType: "run" | "ride" | "walk";
  startDate: string;
  endDate: string;
  distanceMeters: number;
  durationSeconds: number;
  totalEnergyBurned?: number;
  sourceName: string;
}

export interface SaveWorkoutOptions {
  activityType: "run" | "ride" | "walk";
  startDate: Date;
  endDate: Date;
  distanceMeters: number;
  durationSeconds: number;
  caloriesBurned?: number;
}

let hcInitialized = false;

function getHC(): any {
  if (Platform.OS !== "android") return null;
  try {
    return require("react-native-health-connect");
  } catch {
    return null;
  }
}

export function isHealthConnectAvailable(): boolean {
  return Platform.OS === "android" && getHC() !== null;
}

const EXERCISE_TYPE_RUNNING = 56;
const EXERCISE_TYPE_BIKING = 8;
const EXERCISE_TYPE_WALKING = 79;

function mapExerciseType(typeNum: number): "run" | "ride" | "walk" | null {
  if (typeNum === EXERCISE_TYPE_RUNNING) return "run";
  if (typeNum === EXERCISE_TYPE_BIKING) return "ride";
  if (typeNum === EXERCISE_TYPE_WALKING) return "walk";
  return null;
}

function activityToExerciseType(type: "run" | "ride" | "walk"): number {
  if (type === "run") return EXERCISE_TYPE_RUNNING;
  if (type === "ride") return EXERCISE_TYPE_BIKING;
  return EXERCISE_TYPE_WALKING;
}

async function ensureInitialized(): Promise<boolean> {
  if (hcInitialized) return true;
  const hc = getHC();
  if (!hc) return false;
  try {
    const available = await hc.initialize();
    if (available) hcInitialized = true;
    return !!available;
  } catch (e) {
    console.warn("[HealthConnect] initialize error:", e);
    return false;
  }
}

export async function requestHealthConnectPermissions(): Promise<boolean> {
  const hc = getHC();
  if (!hc) return false;

  hcInitialized = false;
  const ok = await ensureInitialized();
  if (!ok) return false;

  try {
    const permissions = [
      { accessType: "read", recordType: "ExerciseSession" },
      { accessType: "write", recordType: "ExerciseSession" },
      { accessType: "read", recordType: "Distance" },
      { accessType: "write", recordType: "Distance" },
      { accessType: "read", recordType: "TotalCaloriesBurned" },
      { accessType: "write", recordType: "TotalCaloriesBurned" },
    ];
    await hc.requestPermission(permissions);
    const granted = await hc.getGrantedPermissions();
    return Array.isArray(granted) && granted.length > 0;
  } catch (e) {
    console.warn("[HealthConnect] requestPermission error:", e);
    return false;
  }
}

export async function fetchHealthConnectWorkouts(daysSince: number = 90): Promise<HealthConnectWorkout[]> {
  const hc = getHC();
  if (!hc) return [];

  const ok = await ensureInitialized();
  if (!ok) return [];

  const endTime = new Date();
  const startTime = new Date();
  startTime.setDate(startTime.getDate() - daysSince);

  const timeRangeFilter = {
    operator: "between",
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  };

  try {
    const [sessionsResult, distResult] = await Promise.all([
      hc.readRecords("ExerciseSession", { timeRangeFilter }),
      hc.readRecords("Distance", { timeRangeFilter }),
    ]);

    const sessions: any[] = sessionsResult?.records ?? [];
    const distances: any[] = distResult?.records ?? [];

    const workouts: HealthConnectWorkout[] = [];

    for (const s of sessions) {
      const actType = mapExerciseType(s.exerciseType ?? 0);
      if (!actType) continue;

      const start = new Date(s.startTime);
      const end = new Date(s.endTime);
      const durationSeconds = Math.round((end.getTime() - start.getTime()) / 1000);
      if (durationSeconds < 60) continue;

      const startMs = start.getTime();
      const endMs = end.getTime();

      const matchedDist = distances.find((d: any) => {
        const dStart = new Date(d.startTime).getTime();
        const dEnd = new Date(d.endTime).getTime();
        return dStart >= startMs - 5000 && dEnd <= endMs + 5000;
      });

      const distMeters = matchedDist?.distance?.inMeters ?? matchedDist?.distance ?? 0;
      if (distMeters < 100) continue;

      workouts.push({
        id: s.metadata?.id ?? `hc-${startMs}-${distMeters.toFixed(0)}`,
        activityType: actType,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        distanceMeters: distMeters,
        durationSeconds,
        sourceName: s.metadata?.dataOrigins?.[0]?.packageName ?? "Health Connect",
      });
    }

    return workouts;
  } catch (e) {
    console.warn("[HealthConnect] readRecords error:", e);
    return [];
  }
}

export async function saveWorkoutToHealthConnect(opts: SaveWorkoutOptions): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const hc = getHC();
  if (!hc) return false;

  const ok = await ensureInitialized();
  if (!ok) return false;

  const startTime = opts.startDate.toISOString();
  const endTime = opts.endDate.toISOString();
  const exerciseType = activityToExerciseType(opts.activityType);

  try {
    await hc.insertRecords([
      {
        recordType: "ExerciseSession",
        startTime,
        endTime,
        exerciseType,
      },
    ]);

    await hc.insertRecords([
      {
        recordType: "Distance",
        startTime,
        endTime,
        distance: { value: opts.distanceMeters, unit: "meters" },
      },
    ]);

    if (opts.caloriesBurned && opts.caloriesBurned > 0) {
      await hc.insertRecords([
        {
          recordType: "TotalCaloriesBurned",
          startTime,
          endTime,
          energy: { value: opts.caloriesBurned, unit: "kilocalories" },
        },
      ]);
    }

    return true;
  } catch (e) {
    console.warn("[HealthConnect] insertRecords error:", e);
    return false;
  }
}
