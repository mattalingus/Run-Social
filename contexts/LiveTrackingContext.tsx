import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Alert, Linking, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import {
  GROUP_LOCATION_TASK,
  addGroupLocationListener,
  requestBackgroundPermission,
  safeStartLocationUpdates,
  safeStopLocationUpdates,
} from "@/lib/locationTasks";
import { apiRequest } from "@/lib/query-client";

type Phase = "idle" | "active" | "paused" | "finishing";

export type MileSplit = {
  label: string;
  paceMinPerMile: number;
  isPartial: boolean;
};

export interface LiveTrackingContextValue {
  runId: string | null;
  activityType: "run" | "ride" | "walk";
  phase: Phase;
  displayDist: number;
  elapsed: number;
  isMinimized: boolean;
  presentConfirmed: boolean;
  hasBeenPresent: boolean;
  userLocation: { latitude: number; longitude: number } | null;
  routePathRef: React.MutableRefObject<Array<{ latitude: number; longitude: number }>>;
  totalDistRef: React.MutableRefObject<number>;
  elapsedRef: React.MutableRefObject<number>;
  mileSplitsRef: React.MutableRefObject<MileSplit[]>;
  startTracking: (runId: string, activityType: "run" | "ride" | "walk", userId?: string) => Promise<void>;
  pauseTracking: () => void;
  resumeTracking: () => void;
  beginFinishing: () => void;
  resetTracking: () => void;
  recoverToActive: () => void;
  minimize: () => void;
  restore: () => void;
}

function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 0.621371;
}

function calcPaceNum(distanceMi: number, elapsedSec: number): number {
  if (distanceMi <= 0 || elapsedSec <= 0) return 0;
  return elapsedSec / 60 / distanceMi;
}

const LiveTrackingContext = createContext<LiveTrackingContextValue | null>(null);

export function LiveTrackingProvider({ children }: { children: React.ReactNode }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [activityType, setActivityType] = useState<"run" | "ride" | "walk">("run");
  const [phase, setPhase] = useState<Phase>("idle");
  const [displayDist, setDisplayDist] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [isMinimized, setIsMinimized] = useState(false);
  const [presentConfirmed, setPresentConfirmed] = useState(false);
  const [hasBeenPresent, setHasBeenPresent] = useState(false);

  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const persistIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const webWatchIdRef = useRef<number | null>(null);
  const lastCoordRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const lastCoordTimestampRef = useRef<number | null>(null);
  const totalDistRef = useRef(0);
  const elapsedRef = useRef(0);
  const routePathRef = useRef<Array<{ latitude: number; longitude: number }>>([]);
  const mileSplitsRef = useRef<MileSplit[]>([]);
  const lastSplitMileRef = useRef(0);
  const prevMileElapsedRef = useRef(0);
  const markedPresentRef = useRef(false);
  const activeRunIdRef = useRef<string | null>(null);
  const activeUserIdRef = useRef<string | null>(null);
  const activeActivityTypeRef = useRef<"run" | "ride" | "walk">("run");
  const isPausedRef = useRef(false);

  useEffect(() => {
    if (phase === "active") {
      intervalRef.current = setInterval(() => {
        setElapsed((e) => {
          elapsedRef.current = e + 1;
          return e + 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [phase]);

  const pingServer = useCallback(async (lat: number, lng: number) => {
    const rid = activeRunIdRef.current;
    if (!rid) return;
    try {
      const paceNum = calcPaceNum(totalDistRef.current, elapsedRef.current);
      const res = await apiRequest("POST", `/api/runs/${rid}/ping`, {
        latitude: lat,
        longitude: lng,
        cumulativeDistance: totalDistRef.current,
        pace: paceNum,
      });
      const data = await res.json();
      if (data.isPresent && !markedPresentRef.current) {
        markedPresentRef.current = true;
        setHasBeenPresent(true);
        setPresentConfirmed(true);
        setTimeout(() => setPresentConfirmed(false), 3000);
      }
    } catch {}
  }, []);

  function handleCoord(latitude: number, longitude: number) {
    setUserLocation({ latitude, longitude });

    // GPS gap reconciliation: if the app was backgrounded with foreground-only
    // permission, the timer pauses but the user kept moving. Credit missing
    // wall-clock seconds so distance and time stay proportional.
    const GPS_GAP_THRESHOLD_SEC = 30;
    const now = Date.now();
    if (!isPausedRef.current && lastCoordTimestampRef.current !== null) {
      const gapSec = (now - lastCoordTimestampRef.current) / 1000;
      if (gapSec > GPS_GAP_THRESHOLD_SEC) {
        setElapsed((prev) => {
          const adjusted = prev + Math.round(gapSec);
          elapsedRef.current = adjusted;
          return adjusted;
        });
      }
    }
    lastCoordTimestampRef.current = now;

    routePathRef.current = [...routePathRef.current, { latitude, longitude }];

    if (!isPausedRef.current && lastCoordRef.current) {
      const d = haversineMi(
        lastCoordRef.current.latitude,
        lastCoordRef.current.longitude,
        latitude,
        longitude
      );
      if (d >= 0 && d < 0.3) {
        totalDistRef.current += d;
        setDisplayDist(totalDistRef.current);

        // Track mile splits
        const crossedMile = Math.floor(totalDistRef.current);
        if (crossedMile > lastSplitMileRef.current && crossedMile >= 1) {
          const splitSeconds = elapsedRef.current - prevMileElapsedRef.current;
          if (splitSeconds > 0) {
            const pace = Math.min(Math.max(splitSeconds / 60, 1), 30);
            mileSplitsRef.current = [
              ...mileSplitsRef.current,
              { label: `M${mileSplitsRef.current.length + 1}`, paceMinPerMile: pace, isPartial: false },
            ];
          }
          lastSplitMileRef.current = crossedMile;
          prevMileElapsedRef.current = elapsedRef.current;
        }
      }
    }
    // Always keep lastCoord current so resume has no distance jump
    lastCoordRef.current = { latitude, longitude };
  }

  const permAlertShownRef = useRef(false);

  function showPermissionLostAlert() {
    if (permAlertShownRef.current) return;
    permAlertShownRef.current = true;
    Alert.alert(
      "Location Access Lost",
      "Location permission was revoked. Your route will stop recording. Please re-enable location in Settings.",
      [
        { text: "Dismiss", style: "cancel" },
        {
          text: "Open Settings",
          onPress: () => {
            if (Platform.OS === "ios") {
              Linking.openURL("app-settings:");
            } else {
              Linking.openSettings();
            }
          },
        },
      ]
    );
  }

  async function watchLocation() {
    if (Platform.OS === "web") {
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        webWatchIdRef.current = navigator.geolocation.watchPosition(
          (pos) => handleCoord(pos.coords.latitude, pos.coords.longitude),
          () => {},
          { enableHighAccuracy: true, maximumAge: 3000 }
        );
      }
      return;
    }
    try {
      await safeStartLocationUpdates(GROUP_LOCATION_TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 5,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: "PaceUp is tracking your group run",
          notificationBody: "Your route is being recorded",
          notificationColor: "#00D97E",
        },
      });
      const unsub = addGroupLocationListener((lat, lng) => {
        handleCoord(lat, lng);
      });
      locationSubRef.current = { remove: unsub } as any;
    } catch (err: any) {
      const msg = (err?.message ?? "").toLowerCase();
      if (msg.includes("permission") || msg.includes("denied") || msg.includes("not authorized")) {
        showPermissionLostAlert();
      }
    }
  }

  function clearLocationAndPing() {
    if (Platform.OS === "web") {
      if (webWatchIdRef.current !== null) {
        navigator.geolocation?.clearWatch(webWatchIdRef.current);
        webWatchIdRef.current = null;
      }
    } else {
      if (locationSubRef.current) {
        locationSubRef.current.remove();
        locationSubRef.current = null;
      }
      safeStopLocationUpdates(GROUP_LOCATION_TASK);
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (persistIntervalRef.current) {
      clearInterval(persistIntervalRef.current);
      persistIntervalRef.current = null;
    }
  }

  async function startTracking(rid: string, type: "run" | "ride" | "walk", userId?: string) {
    lastCoordRef.current = null;
    lastCoordTimestampRef.current = null;
    totalDistRef.current = 0;
    elapsedRef.current = 0;
    routePathRef.current = [];
    mileSplitsRef.current = [];
    lastSplitMileRef.current = 0;
    prevMileElapsedRef.current = 0;
    markedPresentRef.current = false;
    setDisplayDist(0);
    setElapsed(0);
    setUserLocation(null);
    setPresentConfirmed(false);
    setRunId(rid);
    activeRunIdRef.current = rid;
    activeUserIdRef.current = userId ?? null;
    activeActivityTypeRef.current = type;
    setActivityType(type);
    setIsMinimized(false);
    setPhase("active");

    if (Platform.OS !== "web") {
      await requestBackgroundPermission();
    }

    await watchLocation();

    if (Platform.OS !== "web") {
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        handleCoord(loc.coords.latitude, loc.coords.longitude);
        await pingServer(loc.coords.latitude, loc.coords.longitude);
      } catch {}
    }

    pingIntervalRef.current = setInterval(async () => {
      if (isPausedRef.current) return;
      if (lastCoordRef.current) {
        await pingServer(lastCoordRef.current.latitude, lastCoordRef.current.longitude);
      }
    }, 10000);

    // Persist tracking state to AsyncStorage every 10s for crash recovery
    if (Platform.OS !== "web") {
      persistIntervalRef.current = setInterval(() => {
        AsyncStorage.setItem("paceup_group_active_run", JSON.stringify({
          runId: activeRunIdRef.current,
          activityType: activeActivityTypeRef.current,
          userId: activeUserIdRef.current,
          distanceMi: totalDistRef.current,
          durationSeconds: elapsedRef.current,
          timestamp: new Date().toISOString(),
        })).catch(() => {});
      }, 10000);
    }
  }

  function pauseTracking() {
    isPausedRef.current = true;
    setPhase("paused");
  }

  function resumeTracking() {
    isPausedRef.current = false;
    lastCoordRef.current = null;
    lastCoordTimestampRef.current = null;
    setPhase("active");
  }

  function beginFinishing() {
    setPhase("finishing");
    clearLocationAndPing();
    // Clear crash recovery key when user intentionally finishes
    if (Platform.OS !== "web") {
      AsyncStorage.removeItem("paceup_group_active_run").catch(() => {});
    }
  }

  function resetTracking() {
    clearLocationAndPing();
    isPausedRef.current = false;
    // Clear crash recovery key
    if (Platform.OS !== "web") {
      AsyncStorage.removeItem("paceup_group_active_run").catch(() => {});
    }
    setPhase("idle");
    setRunId(null);
    activeRunIdRef.current = null;
    setIsMinimized(false);
    setDisplayDist(0);
    setElapsed(0);
    elapsedRef.current = 0;
    totalDistRef.current = 0;
    routePathRef.current = [];
    mileSplitsRef.current = [];
    lastSplitMileRef.current = 0;
    prevMileElapsedRef.current = 0;
    lastCoordRef.current = null;
    lastCoordTimestampRef.current = null;
    markedPresentRef.current = false;
    setHasBeenPresent(false);
    setPresentConfirmed(false);
    setUserLocation(null);
  }

  function recoverToActive() {
    setPhase("active");
  }

  function minimize() {
    setIsMinimized(true);
  }

  function restore() {
    setIsMinimized(false);
  }

  return (
    <LiveTrackingContext.Provider
      value={{
        runId,
        activityType,
        phase,
        displayDist,
        elapsed,
        isMinimized,
        presentConfirmed,
        hasBeenPresent,
        userLocation,
        routePathRef,
        totalDistRef,
        elapsedRef,
        mileSplitsRef,
        startTracking,
        pauseTracking,
        resumeTracking,
        beginFinishing,
        resetTracking,
        recoverToActive,
        minimize,
        restore,
      }}
    >
      {children}
    </LiveTrackingContext.Provider>
  );
}

export function useLiveTracking() {
  const ctx = useContext(LiveTrackingContext);
  if (!ctx) throw new Error("useLiveTracking must be used within LiveTrackingProvider");
  return ctx;
}
