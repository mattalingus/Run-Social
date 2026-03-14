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

function getHealthKit(): any {
  if (Platform.OS !== "ios") return null;
  if (AppleHealthKit) return AppleHealthKit;
  try {
    AppleHealthKit = require("react-native-health").default;
    return AppleHealthKit;
  } catch {
    return null;
  }
}

export function isHealthKitAvailable(): boolean {
  return Platform.OS === "ios" && getHealthKit() !== null;
}

export async function requestHealthKitPermissions(): Promise<boolean> {
  const hk = getHealthKit();
  if (!hk) return false;

  const { HealthKitDataType } = require("react-native-health");

  const permissions = {
    permissions: {
      read: [
        HealthKitDataType?.Workout ?? "Workout",
        HealthKitDataType?.DistanceWalkingRunning ?? "DistanceWalkingRunning",
        HealthKitDataType?.DistanceCycling ?? "DistanceCycling",
        HealthKitDataType?.ActiveEnergyBurned ?? "ActiveEnergyBurned",
        HealthKitDataType?.HeartRate ?? "HeartRate",
      ],
      write: [],
    },
  };

  return new Promise((resolve) => {
    hk.initHealthKit(permissions, (err: any) => {
      if (err) {
        console.warn("HealthKit init error:", err);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

function mapWorkoutType(typeId: number | string): "run" | "ride" | "walk" | null {
  const id = typeof typeId === "string" ? parseInt(typeId, 10) : typeId;
  if (id === 37 || id === 52) return "run";
  if (id === 13) return "ride";
  if (id === 52) return "walk";
  if (id === 83) return "walk";
  const strType = String(typeId).toLowerCase();
  if (strType.includes("run")) return "run";
  if (strType.includes("cycl") || strType.includes("bik")) return "ride";
  if (strType.includes("walk") || strType.includes("hik")) return "walk";
  return null;
}

export async function fetchWorkouts(daysSince: number = 90): Promise<HealthKitWorkout[]> {
  const hk = getHealthKit();
  if (!hk) return [];

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
          console.warn("HealthKit getSamples error:", err);
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
