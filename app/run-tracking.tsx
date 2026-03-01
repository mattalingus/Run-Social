import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import C from "@/constants/colors";
import { formatDistance } from "@/lib/formatDistance";

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "idle" | "active" | "paused" | "done";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatElapsed(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

function calcPace(distanceMi: number, elapsedSec: number): string {
  if (distanceMi < 0.01 || elapsedSec < 1) return "--:--";
  const min = elapsedSec / 60 / distanceMi;
  const m = Math.floor(min);
  const s = Math.round((min - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function RunTrackingScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [permission, requestPermission] = Location.useForegroundPermissions();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [displayDist, setDisplayDist] = useState(0);
  const [saving, setSaving] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const webWatchIdRef = useRef<number | null>(null);
  const lastCoordRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const totalDistRef = useRef(0);

  // ─── Timer ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase === "active") {
      intervalRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [phase]);

  // ─── GPS ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase === "active") {
      watchLocation();
    } else {
      stopWatching();
    }
    return () => { stopWatching(); };
  }, [phase]);

  function handleCoord(latitude: number, longitude: number) {
    if (lastCoordRef.current) {
      const d = haversine(
        lastCoordRef.current.latitude,
        lastCoordRef.current.longitude,
        latitude,
        longitude
      );
      if (d >= 0 && d < 0.3) {
        totalDistRef.current += d;
        setDisplayDist(totalDistRef.current);
      }
    }
    lastCoordRef.current = { latitude, longitude };
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
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 5,
          timeInterval: 3000,
        },
        (loc) => handleCoord(loc.coords.latitude, loc.coords.longitude)
      );
      locationSubRef.current = sub;
    } catch (_) {}
  }

  function stopWatching() {
    if (Platform.OS === "web") {
      if (webWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(webWatchIdRef.current);
        webWatchIdRef.current = null;
      }
    } else {
      locationSubRef.current?.remove();
      locationSubRef.current = null;
    }
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  async function handleStart() {
    if (Platform.OS !== "web") {
      if (!permission?.granted) {
        const res = await requestPermission();
        if (!res.granted) {
          Alert.alert(
            "Location Required",
            "Enable location access so PaceUp can measure your run distance."
          );
          return;
        }
      }
    }
    lastCoordRef.current = null;
    totalDistRef.current = 0;
    setDisplayDist(0);
    setElapsed(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPhase("active");
  }

  function handlePause() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPhase("paused");
  }

  function handleResume() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    lastCoordRef.current = null;
    setPhase("active");
  }

  function handleFinish() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setPhase("done");
  }

  function handleCancel() {
    if (phase === "idle") {
      router.back();
      return;
    }
    Alert.alert("Discard Run", "Discard this run and go back?", [
      { text: "Keep Going", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          stopWatching();
          router.back();
        },
      },
    ]);
  }

  async function saveRun() {
    const distance = totalDistRef.current;
    const pace = distance > 0.01 ? (elapsed / 60) / distance : null;
    setSaving(true);
    try {
      await apiRequest("POST", "/api/solo-runs", {
        title: `${formatDistance(distance)} mi solo run`,
        date: new Date().toISOString(),
        distanceMiles: Math.max(distance, 0.001),
        paceMinPerMile: pace,
        durationSeconds: elapsed,
        completed: true,
        planned: false,
      });
      qc.invalidateQueries({ queryKey: ["/api/solo-runs"] });
      qc.invalidateQueries({ queryKey: ["/api/runs/mine"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)/solo" as any);
    } catch (e: any) {
      Alert.alert("Save Failed", e.message);
    } finally {
      setSaving(false);
    }
  }

  // ─── Done summary ─────────────────────────────────────────────────────────

  if (phase === "done") {
    const distance = totalDistRef.current;
    const pace = distance > 0.01 ? (elapsed / 60) / distance : null;
    const paceM = pace ? Math.floor(pace) : 0;
    const paceS = pace ? Math.round((pace - paceM) * 60) : 0;

    return (
      <View style={[t.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 24), paddingBottom: insets.bottom + 32 }]}>
        <View style={t.summaryCard}>
          <View style={t.checkCircle}>
            <Feather name="check" size={28} color={C.primary} />
          </View>
          <Text style={t.summaryTitle}>Run Complete</Text>

          <View style={t.statsRow}>
            <View style={t.statBlock}>
              <Text style={t.statBig}>{formatDistance(distance)}</Text>
              <Text style={t.statUnit}>miles</Text>
            </View>
            <View style={t.statDivider} />
            <View style={t.statBlock}>
              <Text style={t.statBig}>{formatElapsed(elapsed)}</Text>
              <Text style={t.statUnit}>time</Text>
            </View>
            <View style={t.statDivider} />
            <View style={t.statBlock}>
              <Text style={t.statBig}>
                {pace ? `${paceM}:${paceS.toString().padStart(2, "0")}` : "--"}
              </Text>
              <Text style={t.statUnit}>min/mi</Text>
            </View>
          </View>

          <Pressable
            style={[t.saveBtn, saving && { opacity: 0.6 }]}
            onPress={saveRun}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color={C.bg} />
            ) : (
              <Text style={t.saveBtnTxt}>Save Run</Text>
            )}
          </Pressable>

          <Pressable
            style={t.discardBtn}
            onPress={() => { stopWatching(); router.back(); }}
          >
            <Text style={t.discardTxt}>Discard</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ─── Tracker UI ──────────────────────────────────────────────────────────

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  return (
    <View style={t.container}>
      {/* Cancel */}
      <Pressable style={[t.cancelBtn, { top: topPad + 16 }]} onPress={handleCancel}>
        <Feather name="x" size={20} color={C.textSecondary} />
      </Pressable>

      <View style={[t.body, { paddingTop: topPad + 60 }]}>

        {/* Status chip */}
        <View style={t.statusChip}>
          <View style={[
            t.statusDot,
            {
              backgroundColor:
                phase === "active" ? C.primary :
                phase === "paused" ? C.orange : C.textMuted,
            },
          ]} />
          <Text style={t.statusTxt}>
            {phase === "idle" ? "Ready" : phase === "active" ? "Running" : "Paused"}
          </Text>
        </View>

        {/* Timer — largest element */}
        <Text style={t.timerTxt}>{formatElapsed(elapsed)}</Text>

        {/* Live stats */}
        <View style={t.liveRow}>
          <View style={t.liveStat}>
            <Text style={t.liveVal}>{formatDistance(displayDist)}</Text>
            <Text style={t.liveUnit}>miles</Text>
          </View>
          <View style={t.liveDivider} />
          <View style={t.liveStat}>
            <Text style={t.liveVal}>{calcPace(displayDist, elapsed)}</Text>
            <Text style={t.liveUnit}>min/mi</Text>
          </View>
        </View>

        {/* Controls */}
        <View style={t.controls}>
          {phase === "idle" && (
            <Pressable
              style={({ pressed }) => [t.startBtn, { opacity: pressed ? 0.85 : 1 }]}
              onPress={handleStart}
            >
              <Ionicons name="play" size={26} color={C.bg} />
              <Text style={t.startBtnTxt}>Start Run</Text>
            </Pressable>
          )}

          {(phase === "active" || phase === "paused") && (
            <View style={t.runControls}>
              <Pressable
                style={t.secondaryCtrl}
                onPress={phase === "active" ? handlePause : handleResume}
              >
                <Ionicons
                  name={phase === "active" ? "pause" : "play"}
                  size={22}
                  color={C.text}
                />
                <Text style={t.secondaryCtrlTxt}>
                  {phase === "active" ? "Pause" : "Resume"}
                </Text>
              </Pressable>

              <Pressable style={t.finishBtn} onPress={handleFinish}>
                <Ionicons name="stop" size={22} color={C.bg} />
                <Text style={t.finishBtnTxt}>Finish</Text>
              </Pressable>
            </View>
          )}
        </View>

        {phase === "idle" && (
          <Text style={t.hintTxt}>GPS will track your distance automatically</Text>
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const t = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  cancelBtn: {
    position: "absolute",
    left: 20,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },

  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 28,
  },

  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.textSecondary,
    letterSpacing: 0.5,
  },

  timerTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 64,
    color: C.text,
    letterSpacing: -2,
    lineHeight: 72,
  },

  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 20,
    paddingHorizontal: 32,
    gap: 0,
    alignSelf: "stretch",
  },
  liveStat: { flex: 1, alignItems: "center", gap: 4 },
  liveVal: { fontFamily: "Outfit_700Bold", fontSize: 28, color: C.text },
  liveUnit: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  liveDivider: { width: 1, height: 40, backgroundColor: C.border },

  controls: { alignItems: "center" },

  startBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.primary,
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 48,
  },
  startBtnTxt: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.bg },

  runControls: {
    flexDirection: "row",
    gap: 16,
    alignItems: "center",
  },
  secondaryCtrl: {
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    width: 88,
    paddingVertical: 16,
  },
  secondaryCtrlTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: C.textSecondary,
  },
  finishBtn: {
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.primaryDark,
    borderRadius: 18,
    width: 88,
    paddingVertical: 16,
  },
  finishBtnTxt: { fontFamily: "Outfit_700Bold", fontSize: 12, color: C.bg },

  hintTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.textMuted,
    textAlign: "center",
  },

  summaryCard: {
    flex: 1,
    marginHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.primaryMuted,
    borderWidth: 2,
    borderColor: C.primary + "66",
    alignItems: "center",
    justifyContent: "center",
  },
  summaryTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 28,
    color: C.text,
    letterSpacing: -0.5,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 22,
    paddingHorizontal: 24,
    alignSelf: "stretch",
    marginHorizontal: 4,
  },
  statBlock: { flex: 1, alignItems: "center", gap: 4 },
  statBig: { fontFamily: "Outfit_700Bold", fontSize: 26, color: C.text },
  statUnit: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textSecondary },
  statDivider: { width: 1, height: 36, backgroundColor: C.border },

  saveBtn: {
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    marginHorizontal: 4,
  },
  saveBtnTxt: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.bg },

  discardBtn: { paddingVertical: 10 },
  discardTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textMuted,
  },
});
