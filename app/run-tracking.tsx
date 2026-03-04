import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  Switch,
  Platform,
  Modal,
  TextInput,
  ScrollView,
  Image,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";
import ShareActivityModal from "@/components/ShareActivityModal";
import MileSplitsChart, { MileSplit } from "@/components/MileSplitsChart";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { useActivity } from "@/contexts/ActivityContext";
import C from "@/constants/colors";
import { formatDistance } from "@/lib/formatDistance";

const IS_NATIVE = Platform.OS !== "web";

// Lazy-load react-native-maps only on native to avoid web crashes
let MapView: any = null;
let Marker: any = null;
let Polyline: any = null;
if (IS_NATIVE) {
  const maps = require("react-native-maps");
  MapView = maps.default;
  Marker = maps.Marker;
  Polyline = maps.Polyline;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "idle" | "active" | "paused" | "done";
type Coord = { latitude: number; longitude: number };

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

// ─── Audio Coach Phrase Engine ────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function spokenPace(paceMinTotal: number): string {
  const m = Math.floor(paceMinTotal);
  const s = Math.round((paceMinTotal - m) * 60);
  if (s === 0) return `${m} minutes flat`;
  if (s === 30) return `${m} thirty`;
  if (s === 15) return `${m} fifteen`;
  if (s === 45) return `${m} forty-five`;
  return `${m} ${s < 10 ? "oh " + s : s}`;
}

function spokenTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s} seconds`;
  if (s === 0) return `${m} minute${m !== 1 ? "s" : ""}`;
  if (s === 30) return `${m} and a half minutes`;
  return `${m} minute${m !== 1 ? "s" : ""} ${s} second${s !== 1 ? "s" : ""}`;
}

function pickCoachPhrase(
  distance: number,
  paceMinTotal: number,
  totalSeconds: number,
  prevPace: number | null
): string {
  const pS = spokenPace(paceMinTotal);
  const tS = spokenTime(totalSeconds);
  const pM = Math.floor(paceMinTotal);
  const pSec = Math.round((paceMinTotal - pM) * 60);
  const totalM = Math.floor(totalSeconds / 60);
  const isWhole = distance % 1 === 0;
  const isHalf = distance === 0.5;
  const is5K = Math.abs(distance - 3.107) < 0.06;
  const is10K = Math.abs(distance - 6.214) < 0.06;
  const wholeMiles = Math.floor(distance);
  const NUM = ["zero","one","two","three","four","five","six","seven","eight","nine","ten",
    "eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen","twenty"];

  // ── Distance intro ──────────────────────────────────────────────────────────
  let distLine: string;
  if (is10K) {
    distLine = pick([
      "Ten K done.", "You've hit 10K.", "Ten kilometers.",
      "Six point two miles.", "10K complete.", "That's 10 kilometres.",
    ]);
  } else if (is5K) {
    distLine = pick([
      "5K mark.", "Three point one miles.", "You've hit 5K.",
      "Five kilometres in.", "5K done.",
    ]);
  } else if (isHalf) {
    distLine = pick([
      "Half mile.", "Half a mile done.", "Point five miles.",
      "Half mile in.", "That's half a mile.", "Opening half done.",
      "Half-mile mark.", "Five hundred meters in.",
    ]);
  } else if (distance === 1) {
    distLine = pick([
      "One mile.", "Mile one.", "First mile done.",
      "One mile in.", "That's one mile.", "One down.",
      "Mile marker one.", "One mile complete.",
    ]);
  } else if (distance === 1.5) {
    distLine = pick([
      "Mile and a half.", "One point five miles.",
      "One and a half miles.", "Halfway to three.", "One fifty.",
    ]);
  } else if (distance === 2) {
    distLine = pick([
      "Two miles.", "Two miles done.", "Two miles in.",
      "That's two miles.", "Mile two.", "Two down.",
    ]);
  } else if (distance === 3) {
    distLine = pick([
      "Three miles.", "Three miles in.", "That's three miles.",
      "Mile three.", "Three down.",
    ]);
  } else if (isWhole && wholeMiles <= 20) {
    const w = NUM[wholeMiles];
    distLine = pick([
      `${w.charAt(0).toUpperCase() + w.slice(1)} miles.`,
      `That's ${w} miles.`, `${w} miles in.`,
      `${w} miles done.`, `Mile ${wholeMiles}.`, `${wholeMiles} miles.`,
    ]);
  } else if (!isWhole) {
    const frac = distance % 1;
    const fracWord = frac === 0.5 ? "and a half" : `point ${Math.round(frac * 10)}`;
    const ww = wholeMiles <= 20 ? NUM[wholeMiles] : String(wholeMiles);
    distLine = pick([
      `${ww.charAt(0).toUpperCase() + ww.slice(1)} ${fracWord} miles.`,
      `${distance.toFixed(1)} miles.`,
      `${distance.toFixed(1)} miles in.`,
      `${distance.toFixed(1)}.`,
    ]);
  } else {
    distLine = `${distance} miles.`;
  }

  // ── Pace line ───────────────────────────────────────────────────────────────
  const secPart = pSec > 0 ? ` ${pSec} second${pSec !== 1 ? "s" : ""}` : "";
  const paceLines = [
    `Running at ${pS} per mile.`,
    `Current pace, ${pS} a mile.`,
    `${pM} minute${secPart} miles.`,
    `Averaging ${pS} per mile.`,
    `${pS} per mile right now.`,
    `Your pace is ${pS} a mile.`,
    `Pace is sitting at ${pS}.`,
    `Clocking ${pS} per mile.`,
    `That's ${pS} per mile.`,
    `${pS} a mile.`,
    `Pace: ${pS} per mile.`,
    `Holding ${pS} per mile.`,
    `You're at ${pS} per mile.`,
    `Average pace, ${pS}.`,
    `Moving at ${pS} a mile.`,
    `Pace right now is ${pS}.`,
    `That puts you at ${pS} per mile.`,
    `You're running ${pS} miles.`,
    `Speed check: ${pS} per mile.`,
    `${pS} on the pace.`,
    `Tracking at ${pS} per mile.`,
    `Mile pace: ${pS}.`,
    `You're sitting on ${pS}.`,
    `Pace check: ${pS} a mile.`,
    `${pS} per mile this run.`,
    `Effort translates to ${pS} per mile.`,
    `That's ${pS} minute miles.`,
    `${pS} through the mile.`,
    `On pace at ${pS}.`,
    `Holding a ${pS} per mile clip.`,
    `Current split: ${pS} a mile.`,
    `You're averaging ${pS}.`,
    `Right now you're doing ${pS} a mile.`,
    `Per mile pace is ${pS}.`,
    `${pS} miles per minute.`,
  ];
  const paceLine = pick(paceLines);

  // ── Pace context (trend or effort level) ────────────────────────────────────
  let paceContext = "";
  if (paceMinTotal < 6.5) {
    if (Math.random() < 0.5) paceContext = pick(["That's a quick clip.", "Fast work.", "Moving well."]);
  } else if (paceMinTotal < 7.5) {
    if (Math.random() < 0.35) paceContext = pick(["Good speed.", "Strong pace.", "Nice clip."]);
  } else if (paceMinTotal > 13) {
    if (Math.random() < 0.4) paceContext = pick(["Easy effort.", "Nice and easy.", "Taking it steady."]);
  }
  if (!paceContext && prevPace !== null && prevPace - paceMinTotal > 0.25) {
    if (Math.random() < 0.5) paceContext = pick([
      "Picking it up.", "You're speeding up.", "Pace is improving.",
      "You've got more in the tank.", "Negative splitting.",
    ]);
  }
  if (!paceContext && prevPace !== null && paceMinTotal - prevPace > 0.3) {
    if (Math.random() < 0.35) paceContext = pick([
      "Settling in.", "Pace has eased back.", "Breathing room.",
    ]);
  }

  // ── Time line ───────────────────────────────────────────────────────────────
  const timeLines = [
    `${tS} on the clock.`,
    `You've been out ${tS}.`,
    `Total time: ${tS}.`,
    `${tS} elapsed.`,
    `Time: ${tS}.`,
    `${totalM} minute${totalM !== 1 ? "s" : ""} in.`,
    `Running for ${tS}.`,
    `${tS} so far.`,
    `That's ${tS} of work.`,
    `${tS} logged.`,
    `Timer reads ${tS}.`,
    `You're ${tS} into this run.`,
    `${totalM} minute${totalM !== 1 ? "s" : ""} on the watch.`,
    `Time at ${tS}.`,
    `${tS} underway.`,
    `Clock says ${tS}.`,
    `${tS} into it.`,
    `Elapsed: ${tS}.`,
    `You've run for ${tS}.`,
    `${tS} on the run.`,
  ];
  const timeLine = pick(timeLines);

  // ── Optional closer (40% chance) ─────────────────────────────────────────
  const closers = [
    "Stay steady.", "Keep that cadence.", "Good form.", "Lock in.",
    "Breathe easy.", "Settle in.", "Stay relaxed.", "Hold that pace.",
    "Stay smooth.", "Keep it even.", "Relax your shoulders.",
    "Light on your feet.", "Stay loose.", "Good rhythm.", "Keep rolling.",
    "Stay controlled.", "Consistent effort.", "Keep your head up.",
    "Drive the arms.", "Stay on it.", "Nice and controlled.",
    "Hold your form.", "Stay tall.", "Chin up.", "Keep that stride.",
  ];
  const closer = Math.random() < 0.4 ? " " + pick(closers) : "";

  return [distLine, paceLine, paceContext, timeLine].filter(Boolean).join(" ") + closer;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function RunTrackingScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { activityFilter } = useActivity();
  const { pathId } = useLocalSearchParams<{ pathId?: string }>();

  const [permission, requestPermission] = Location.useForegroundPermissions();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [displayDist, setDisplayDist] = useState(0);
  const [saving, setSaving] = useState(false);
  const [routeState, setRouteState] = useState<Coord[]>([]);

  // Audio Coach state
  const [coachEnabled, setCoachEnabled] = useState(true);
  const [coachInterval, setCoachInterval] = useState<"0.5" | "1" | "2">("1");
  const lastAnnouncedMileRef = useRef(0);
  const lastAnnouncedPaceRef = useRef<number | null>(null);

  // Route Publishing state
  const [publishedPath, setPublishedPath] = useState<{ id: string; name: string } | null>(null);
  const [showPublishForm, setShowPublishForm] = useState(false);
  const [publishName, setPublishName] = useState("");
  const [publishing, setPublishing] = useState(false);

  // Saved paths state
  const [selectedPath, setSelectedPath] = useState<any | null>(null);
  const [showPathPicker, setShowPathPicker] = useState(false);
  const [showSaveNameModal, setShowSaveNameModal] = useState(false);
  const [pathName, setPathName] = useState("");
  const [savingPath, setSavingPath] = useState(false);
  const [pathSaved, setPathSaved] = useState(false);

  // Post-run photo state
  const [savedRunId, setSavedRunId] = useState<string | null>(null);
  const [runPhotos, setRunPhotos] = useState<any[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showShare, setShowShare] = useState(false);

  const { data: savedPaths = [] } = useQuery<any[]>({
    queryKey: ["/api/saved-paths"],
    staleTime: 60_000,
  });

  // ─── Auto-select path from URL param ─────────────────────────────────────

  useEffect(() => {
    if (pathId && savedPaths.length > 0 && !selectedPath) {
      const match = savedPaths.find((p: any) => p.id === pathId);
      if (match) setSelectedPath(match);
    }
  }, [pathId, savedPaths]);

  // ─── Audio Coach Prefs ────────────────────────────────────────────────────

  useEffect(() => {
    async function loadPrefs() {
      try {
        const enabled = await AsyncStorage.getItem("@fara_coach_enabled");
        const interval = await AsyncStorage.getItem("@fara_coach_interval");
        if (enabled !== null) setCoachEnabled(enabled === "true");
        if (interval !== null) setCoachInterval(interval as any);
      } catch (e) {}
    }
    loadPrefs();
  }, []);

  const toggleCoach = async (val: boolean) => {
    setCoachEnabled(val);
    try {
      await AsyncStorage.setItem("@fara_coach_enabled", val.toString());
    } catch (e) {}
  };

  const updateCoachInterval = async (val: "0.5" | "1" | "2") => {
    setCoachInterval(val);
    try {
      await AsyncStorage.setItem("@fara_coach_interval", val);
    } catch (e) {}
  };

  const announcePace = useCallback((distance: number, totalSeconds: number) => {
    if (Platform.OS === "web") return;
    const paceMinTotal = totalSeconds / 60 / distance;
    const text = pickCoachPhrase(distance, paceMinTotal, totalSeconds, lastAnnouncedPaceRef.current);
    lastAnnouncedPaceRef.current = paceMinTotal;
    Speech.speak(text, { rate: 0.95 });
  }, []);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const webWatchIdRef = useRef<number | null>(null);
  const lastCoordRef = useRef<Coord | null>(null);
  const totalDistRef = useRef(0);
  const routePathRef = useRef<Coord[]>([]);
  const mapRef = useRef<any>(null);

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

  const handleCoord = useCallback((latitude: number, longitude: number, accuracy?: number) => {
    // Skip poor-accuracy fixes that occur during GPS warm-up (first few seconds)
    // Native threshold: 40m, web threshold: 100m (web GPS is inherently less accurate)
    const maxAccuracy = Platform.OS === "web" ? 100 : 40;
    if (accuracy != null && accuracy > maxAccuracy) return;

    const coord: Coord = { latitude, longitude };
    routePathRef.current.push(coord);
    setRouteState((prev) => [...prev, coord]);

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

        // Audio Coach logic
        if (coachEnabled && Platform.OS !== "web") {
          const interval = parseFloat(coachInterval);
          if (totalDistRef.current >= lastAnnouncedMileRef.current + interval) {
            lastAnnouncedMileRef.current += interval;
            announcePace(lastAnnouncedMileRef.current, elapsed);
          }
        }
      }
    }
    lastCoordRef.current = coord;

    // Pan map to follow runner
    if (mapRef.current) {
      mapRef.current.animateToRegion(
        { latitude, longitude, latitudeDelta: 0.004, longitudeDelta: 0.004 },
        300
      );
    }
  }, []);

  async function watchLocation() {
    if (Platform.OS === "web") {
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        webWatchIdRef.current = navigator.geolocation.watchPosition(
          (pos) => handleCoord(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? undefined),
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
        (loc) => handleCoord(loc.coords.latitude, loc.coords.longitude, loc.coords.accuracy ?? undefined)
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
            "Enable location access so FARA can measure your run distance."
          );
          return;
        }
      }
    }
    lastCoordRef.current = null;
    totalDistRef.current = 0;
    routePathRef.current = [];
    setRouteState([]);
    setDisplayDist(0);
    setElapsed(0);
    setPathSaved(false);
    lastAnnouncedMileRef.current = 0;
    lastAnnouncedPaceRef.current = null;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPhase("active");
  }

  async function handleSavePath() {
    const name = pathName.trim();
    if (!name) { Alert.alert("Name required", "Enter a name for this path"); return; }
    setSavingPath(true);
    try {
      const res = await apiRequest("POST", "/api/saved-paths", {
        name,
        routePath: routePathRef.current,
        distanceMiles: totalDistRef.current,
      });
      const newPath = await res.json();
      qc.invalidateQueries({ queryKey: ["/api/saved-paths"] });

      if (savedRunId && newPath?.id) {
        try {
          await apiRequest("PUT", `/api/solo-runs/${savedRunId}`, { saved_path_id: newPath.id });
          qc.invalidateQueries({ queryKey: ["/api/solo-runs"] });
          qc.invalidateQueries({ queryKey: ["/api/saved-paths", newPath.id, "runs"] });
        } catch (_) {}
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPathSaved(true);
      setShowSaveNameModal(false);
      setPathName("");
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to save path");
    } finally {
      setSavingPath(false);
    }
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
    if (Platform.OS !== "web") Speech.stop();
    setPhase("done");
  }

  function handleCancel() {
    if (phase === "idle") {
      if (Platform.OS !== "web") Speech.stop();
      router.back();
      return;
    }
    Alert.alert("Discard Run", "Discard this run and go back?", [
      { text: "Keep Going", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          if (Platform.OS !== "web") Speech.stop();
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
      const res = await apiRequest("POST", "/api/solo-runs", {
        title: `${formatDistance(distance)} mi solo ${activityFilter === "ride" ? "ride" : "run"}`,
        date: new Date().toISOString(),
        distanceMiles: Math.max(distance, 0.001),
        paceMinPerMile: pace,
        durationSeconds: elapsed,
        completed: true,
        planned: false,
        routePath: routePathRef.current.length > 1 ? routePathRef.current : null,
        activityType: activityFilter,
        savedPathId: selectedPath?.id ?? null,
      });
      const saved = await res.json();
      setSavedRunId(saved.id);
      qc.invalidateQueries({ queryKey: ["/api/solo-runs"] });
      qc.invalidateQueries({ queryKey: ["/api/runs/mine"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Save Failed", e.message);
    } finally {
      setSaving(false);
    }
  }

  function finishAndNavigate() {
    router.replace("/(tabs)/solo" as any);
  }

  async function pickAndUploadSoloPhoto() {
    if (!savedRunId) return;
    if (Platform.OS !== "web") {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Please allow photo library access to upload run photos.");
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const formData = new FormData();
    formData.append("photo", { uri: asset.uri, type: asset.mimeType || "image/jpeg", name: "photo.jpg" } as any);
    setUploadingPhoto(true);
    try {
      const url = new URL(`/api/solo-runs/${savedRunId}/photos`, getApiUrl()).toString();
      const response = await fetch(url, { method: "POST", body: formData, credentials: "include" });
      if (!response.ok) throw new Error("Upload failed");
      const photo = await response.json();
      setRunPhotos((prev) => [...prev, photo]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Upload failed", e.message);
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handlePublishRoute() {
    if (Platform.OS === "ios" && !showPublishForm) {
      Alert.prompt(
        "Publish Route",
        "Enter a name for this community route:",
        [
          {
            text: "Cancel",
            style: "cancel",
          },
          {
            text: "Publish",
            onPress: async (name?: string) => {
              if (!name?.trim()) {
                Alert.alert("Name required", "Please enter a name for this route.");
                return;
              }
              await performPublish(name.trim());
            },
          },
        ],
        "plain-text",
        `${formatDistance(totalDistRef.current)} mi Run`
      );
      return;
    }

    const name = publishName.trim();
    if (!name) {
      Alert.alert("Name required", "Please enter a name for this route.");
      return;
    }
    await performPublish(name);
  }

  async function performPublish(name: string) {
    setPublishing(true);
    try {
      const res = await apiRequest("POST", `/api/solo-runs/${savedRunId}/publish-route`, {
        routeName: name,
      });
      const data = await res.json();
      setPublishedPath({ id: data.id, name });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["/api/community-paths"] });
      setShowPublishForm(false);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to publish route");
    } finally {
      setPublishing(false);
    }
  }

  // ─── Done summary ─────────────────────────────────────────────────────────

  if (phase === "done") {
    const distance = totalDistRef.current;
    const pace = distance > 0.01 ? (elapsed / 60) / distance : null;
    const paceM = pace ? Math.floor(pace) : 0;
    const paceS = pace ? Math.round((pace - paceM) * 60) : 0;
    const hasRoute = IS_NATIVE && routeState.length > 1;
    const lastPt = routeState[routeState.length - 1];

    return (
      <View style={[t.container, { paddingBottom: insets.bottom + 32 }]}>
        {/* Mini route map */}
        {hasRoute && MapView && (
          <View style={[t.miniMap, { marginTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
            <MapView
              style={StyleSheet.absoluteFillObject}
              initialRegion={{
                latitude: lastPt.latitude,
                longitude: lastPt.longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              }}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              customMapStyle={darkMapStyle}
            >
              <Polyline
                coordinates={routeState}
                strokeColor={C.primary}
                strokeWidth={3}
              />
              {lastPt && (
                <Marker coordinate={lastPt} anchor={{ x: 0.5, y: 0.5 }}>
                  <View style={t.currentDot} />
                </Marker>
              )}
            </MapView>
            <View style={t.miniMapOverlay}>
              <View style={t.miniMapBadge}>
                <Feather name="map-pin" size={11} color={C.primary} />
                <Text style={t.miniMapBadgeTxt}>Your Route</Text>
              </View>
            </View>
          </View>
        )}

        <View style={[t.summaryCard, !hasRoute && { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 48) }]}>
          <View style={t.checkCircle}>
            <Feather name="check" size={28} color={C.primary} />
          </View>
          <Text style={t.summaryTitle}>{activityFilter === "ride" ? "Ride Complete" : "Run Complete"}</Text>

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

          {savedRunId ? (
            <>
              {/* ─── Share ──────────────────────────────────────────────── */}
              <Pressable
                style={t.shareBtn}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowShare(true); }}
              >
                <Feather name="share-2" size={16} color={C.primary} />
                <Text style={t.shareBtnTxt}>{activityFilter === "ride" ? "Share Ride" : "Share Run"}</Text>
              </Pressable>

              {/* ─── Photo section ─────────────────────────────────────── */}
              <View style={t.photoSection}>
                <Text style={t.photoSectionTitle}>Add a photo</Text>
                {runPhotos.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={t.photoScroll}>
                    {runPhotos.map((p: any) => (
                      <Image key={p.id} source={{ uri: p.photo_url }} style={t.photoThumb} />
                    ))}
                  </ScrollView>
                )}
                <Pressable
                  style={[t.photoAddBtn, uploadingPhoto && { opacity: 0.6 }]}
                  onPress={pickAndUploadSoloPhoto}
                  disabled={uploadingPhoto}
                >
                  {uploadingPhoto ? (
                    <ActivityIndicator color={C.primary} size="small" />
                  ) : (
                    <>
                      <Feather name="camera" size={16} color={C.primary} />
                      <Text style={t.photoAddTxt}>{runPhotos.length > 0 ? "Add another" : "Add photo"}</Text>
                    </>
                  )}
                </Pressable>
              </View>

              {/* ─── Route Publishing ───────────────────────────────────── */}
              {IS_NATIVE && routeState.length > 1 && (
                publishedPath ? (
                  <View style={t.publishedPill}>
                    <Text style={t.publishedPillTxt}>
                      📍 {publishedPath.name} · Published
                    </Text>
                  </View>
                ) : (
                  <View style={{ width: "100%", paddingHorizontal: 4 }}>
                    {showPublishForm ? (
                      <View style={t.publishForm}>
                        <TextInput
                          style={t.publishInput}
                          value={publishName}
                          onChangeText={setPublishName}
                          placeholder="Route Name"
                          placeholderTextColor={C.textMuted}
                          autoFocus
                        />
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <Pressable
                            style={[t.publishConfirmBtn, publishing && { opacity: 0.6 }]}
                            onPress={handlePublishRoute}
                            disabled={publishing}
                          >
                            {publishing ? (
                              <ActivityIndicator size="small" color={C.bg} />
                            ) : (
                              <Text style={t.publishConfirmTxt}>Confirm</Text>
                            )}
                          </Pressable>
                          <Pressable
                            style={t.publishCancelBtn}
                            onPress={() => setShowPublishForm(false)}
                          >
                            <Text style={t.publishCancelTxt}>Cancel</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <Pressable
                        style={t.publishBtn}
                        onPress={() => {
                          setPublishName(`${formatDistance(totalDistRef.current)} mi Run`);
                          setShowPublishForm(true);
                        }}
                      >
                        <Feather name="map-pin" size={16} color={C.primary} />
                        <Text style={t.publishBtnTxt}>Publish Route</Text>
                      </Pressable>
                    )}
                  </View>
                )
              )}

              {/* ─── Save this path ─────────────────────────────────────── */}
              {routePathRef.current.length > 1 && (
                pathSaved ? (
                  <View style={t.pathSavedRow}>
                    <Feather name="check-circle" size={15} color={C.primary} />
                    <Text style={t.pathSavedTxt}>Path saved</Text>
                  </View>
                ) : (
                  <Pressable
                    style={t.savePathBtn}
                    onPress={() => {
                      setPathName(`My Route – ${formatDistance(totalDistRef.current)} mi`);
                      setShowSaveNameModal(true);
                    }}
                  >
                    <Feather name="bookmark" size={15} color={C.primary} />
                    <Text style={t.savePathBtnTxt}>Save this path</Text>
                  </Pressable>
                )
              )}

              <Pressable style={t.saveBtn} onPress={finishAndNavigate}>
                <Text style={t.saveBtnTxt}>Done</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                style={[t.saveBtn, saving && { opacity: 0.6 }]}
                onPress={saveRun}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={C.bg} />
                ) : (
                  <Text style={t.saveBtnTxt}>{activityFilter === "ride" ? "Save Ride" : "Save Run"}</Text>
                )}
              </Pressable>

              <Pressable
                style={t.discardBtn}
                onPress={() => { stopWatching(); router.back(); }}
              >
                <Text style={t.discardTxt}>Discard</Text>
              </Pressable>
            </>
          )}
        </View>

        {/* ─── Save path name modal ─────────────────────────────────────────── */}
        {showSaveNameModal && (
          <Modal visible transparent animationType="fade" onRequestClose={() => setShowSaveNameModal(false)}>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
            <Pressable style={t.modalOverlay} onPress={() => setShowSaveNameModal(false)} />
            <View style={[t.nameModal, { paddingBottom: insets.bottom + 24 }]}>
              <View style={t.nameModalHandle} />
              <Text style={t.nameModalTitle}>Name this path</Text>
              <TextInput
                style={t.nameInput}
                value={pathName}
                onChangeText={setPathName}
                placeholder="e.g. Riverside Loop"
                placeholderTextColor={C.textMuted}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleSavePath}
              />
              <Pressable
                style={[t.nameModalSaveBtn, savingPath && { opacity: 0.6 }]}
                onPress={handleSavePath}
                disabled={savingPath}
              >
                {savingPath
                  ? <ActivityIndicator color={C.bg} />
                  : <Text style={t.nameModalSaveTxt}>Save Path</Text>}
              </Pressable>
              <Pressable style={t.nameModalCancelBtn} onPress={() => setShowSaveNameModal(false)}>
                <Text style={t.nameModalCancelTxt}>Cancel</Text>
              </Pressable>
            </View>
            </KeyboardAvoidingView>
          </Modal>
        )}

        {/* ─── Share activity modal ─────────────────────────────────────────── */}
        <ShareActivityModal
          visible={showShare}
          onClose={() => setShowShare(false)}
          runData={{
            distanceMi: totalDistRef.current,
            paceMinPerMile: pace,
            durationSeconds: elapsed,
            routePath: routePathRef.current,
            activityType: activityFilter,
          }}
        />
      </View>
    );
  }

  // ─── Tracker UI ──────────────────────────────────────────────────────────

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const showMap = IS_NATIVE && MapView && (phase === "active" || phase === "paused") && routeState.length > 0;
  const currentPt = routeState[routeState.length - 1];

  return (
    <View style={t.container}>
      {/* Cancel */}
      <Pressable
        style={[t.cancelBtn, { top: (showMap ? insets.top : topPad) + 16, zIndex: 20 }]}
        onPress={handleCancel}
      >
        <Feather name="x" size={20} color={C.textSecondary} />
      </Pressable>

      {/* Live map — shown when running or paused */}
      {showMap && (
        <View style={t.mapContainer}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFillObject}
            initialRegion={{
              latitude: currentPt.latitude,
              longitude: currentPt.longitude,
              latitudeDelta: 0.004,
              longitudeDelta: 0.004,
            }}
            customMapStyle={darkMapStyle}
            showsUserLocation={false}
            showsCompass={false}
            toolbarEnabled={false}
          >
            {selectedPath?.route_path?.length > 1 && (
              <Polyline
                coordinates={selectedPath.route_path}
                strokeColor="#ffffff"
                strokeWidth={2}
                lineDashPattern={[8, 6]}
                strokeOpacity={0.28}
              />
            )}
            {routeState.length > 1 && (
              <Polyline
                coordinates={routeState}
                strokeColor={C.primary}
                strokeWidth={3}
              />
            )}
            {currentPt && (
              <Marker coordinate={currentPt} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={t.currentDot} />
              </Marker>
            )}
          </MapView>

          {/* Paused overlay badge */}
          {phase === "paused" && (
            <View style={t.pausedBadge}>
              <Ionicons name="pause" size={12} color={C.text} />
              <Text style={t.pausedBadgeTxt}>Paused</Text>
            </View>
          )}
        </View>
      )}

      {/* Stats + controls */}
      <View style={[
        t.body,
        showMap ? t.bodyWithMap : { paddingTop: topPad + 60 },
      ]}>
        {!showMap && (
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
              {phase === "idle" ? "Ready" : phase === "active" ? (activityFilter === "ride" ? "Riding" : "Running") : "Paused"}
            </Text>
          </View>
        )}

        {/* Timer */}
        <Text style={[t.timerTxt, showMap && t.timerTxtCompact]}>
          {formatElapsed(elapsed)}
        </Text>

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
              <Text style={t.startBtnTxt}>{activityFilter === "ride" ? "Start Ride" : "Start Run"}</Text>
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
          <View style={{ width: "100%", gap: 16 }}>
            {/* Audio Coach Settings */}
            <View style={t.coachSettings}>
              <View style={t.coachRow}>
                <View style={t.coachLabelRow}>
                  <Feather name="headphones" size={16} color={C.textSecondary} />
                  <Text style={t.coachLabel}>Audio Coach</Text>
                </View>
                <Switch
                  value={coachEnabled}
                  onValueChange={toggleCoach}
                  trackColor={{ false: C.textMuted, true: C.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>
              {coachEnabled && (
                <View style={t.intervalRow}>
                  {(["0.5", "1", "2"] as const).map((interval) => (
                    <Pressable
                      key={interval}
                      style={[
                        t.intervalPill,
                        coachInterval === interval && t.intervalPillActive,
                      ]}
                      onPress={() => updateCoachInterval(interval)}
                    >
                      <Text
                        style={[
                          t.intervalPillTxt,
                          coachInterval === interval && t.intervalPillTxtActive,
                        ]}
                      >
                        {interval} mi
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            <View style={{ alignItems: "center", gap: 10 }}>
              <Text style={t.hintTxt}>GPS will track your distance automatically</Text>
              {selectedPath ? (
                <Pressable
                  style={t.ghostPathChip}
                  onPress={() => setSelectedPath(null)}
                >
                  <Feather name="map" size={13} color={C.primary} />
                  <Text style={t.ghostPathChipTxt} numberOfLines={1}>{selectedPath.name}</Text>
                  <Feather name="x" size={13} color={C.textMuted} />
                </Pressable>
              ) : (
                <Pressable onPress={() => setShowPathPicker(true)}>
                  <Text style={t.followPathLink}>+ Follow a saved path</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
      </View>

      {/* ─── Path picker modal ────────────────────────────────────────────── */}
      {showPathPicker && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setShowPathPicker(false)}>
          <Pressable style={t.modalOverlay} onPress={() => setShowPathPicker(false)} />
          <View style={[t.pickerSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={t.nameModalHandle} />
            <Text style={t.nameModalTitle}>Follow a saved path</Text>
            {savedPaths.length === 0 ? (
              <Text style={t.pickerEmpty}>No saved paths yet. Complete a run and save its path first.</Text>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {savedPaths.map((p: any) => (
                  <Pressable
                    key={p.id}
                    style={t.pickerRow}
                    onPress={() => {
                      setSelectedPath(p);
                      setShowPathPicker(false);
                    }}
                  >
                    <Feather name="map" size={16} color={C.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={t.pickerRowName}>{p.name}</Text>
                      {p.distance_miles != null && (
                        <Text style={t.pickerRowMeta}>{formatDistance(p.distance_miles)} mi</Text>
                      )}
                    </View>
                    <Feather name="chevron-right" size={16} color={C.textMuted} />
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </Modal>
      )}
    </View>
  );
}

// ─── Dark map style ────────────────────────────────────────────────────────────

const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#0d1f18" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#4a7a60" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0d1f18" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1a3328" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0d1f18" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#071510" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

// ─── Styles ───────────────────────────────────────────────────────────────────

const t = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  mapContainer: {
    height: "55%",
    width: "100%",
    overflow: "hidden",
  },

  pausedBadge: {
    position: "absolute",
    bottom: 12,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.surface + "EE",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  pausedBadgeTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: C.textSecondary,
  },

  cancelBtn: {
    position: "absolute",
    left: 20,
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
  bodyWithMap: {
    paddingTop: 20,
    gap: 20,
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
  timerTxtCompact: {
    fontSize: 48,
    lineHeight: 54,
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

  // ─── Current position dot ─────────────────────────────────────────────────
  currentDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: C.primary,
    borderWidth: 2.5,
    borderColor: "#fff",
  },

  // ─── Done screen ──────────────────────────────────────────────────────────
  miniMap: {
    height: 220,
    marginHorizontal: 20,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
  },
  miniMapOverlay: {
    position: "absolute",
    bottom: 10,
    left: 10,
  },
  miniMapBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.surface + "DD",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  miniMapBadgeTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: C.textSecondary,
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
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 16,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: C.primary + "88",
    alignSelf: "stretch",
    marginHorizontal: 4,
    backgroundColor: C.primary + "11",
  },
  shareBtnTxt: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.primary },

  discardBtn: { paddingVertical: 10 },
  discardTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textMuted,
  },

  // ─── Post-run photos ────────────────────────────────────────────────────
  photoSection: {
    alignSelf: "stretch",
    gap: 10,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    backgroundColor: C.surface,
  },
  photoSectionTitle: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.textSecondary,
  },
  photoScroll: { marginBottom: 4 },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: 10,
    marginRight: 8,
    backgroundColor: C.card,
  },
  photoAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: C.primary + "55",
    borderRadius: 12,
    paddingVertical: 10,
    backgroundColor: C.primaryMuted,
  },
  photoAddTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.primary,
  },

  // ─── Save path button ───────────────────────────────────────────────────
  savePathBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: C.primary + "66",
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignSelf: "stretch",
    marginHorizontal: 4,
    backgroundColor: C.primaryMuted,
  },
  savePathBtnTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    color: C.primary,
    flex: 1,
    textAlign: "center",
  },
  pathSavedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 10,
  },
  pathSavedTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.primary,
  },

  // ─── Follow a saved path (idle) ────────────────────────────────────────
  followPathLink: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.primary,
    textDecorationLine: "underline",
  },
  ghostPathChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.primaryMuted,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: C.primary + "44",
    maxWidth: 220,
  },
  ghostPathChipTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.primary,
    flex: 1,
  },

  // ─── Audio Coach Settings ─────────────────────────────────────────────
  coachSettings: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    alignSelf: "stretch",
  },
  coachRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  coachLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  coachLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    color: C.text,
  },
  intervalRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  intervalPill: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  intervalPillActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  intervalPillTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.textSecondary,
  },
  intervalPillTxtActive: {
    color: C.bg,
  },

  // ─── Route Publishing ─────────────────────────────────────────────────
  publishBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    borderColor: C.primary,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  publishBtnTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    color: C.primary,
  },
  publishedPill: {
    backgroundColor: C.primary,
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: "center",
    marginBottom: 12,
  },
  publishedPillTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.bg,
  },
  publishForm: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 8,
  },
  publishInput: {
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: C.text,
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  publishConfirmBtn: {
    flex: 1,
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  publishConfirmTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 14,
    color: C.bg,
  },
  publishCancelBtn: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  publishCancelTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.textSecondary,
  },

  // ─── Modals ─────────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  nameModal: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: C.border,
  },
  nameModalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: "center",
    marginBottom: 18,
  },
  nameModalTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 20,
    color: C.text,
    marginBottom: 16,
  },
  nameInput: {
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: C.text,
    marginBottom: 16,
  },
  nameModalSaveBtn: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    marginBottom: 10,
  },
  nameModalSaveTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: C.bg,
  },
  nameModalCancelBtn: {
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: 4,
  },
  nameModalCancelTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textMuted,
  },

  pickerSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: C.border,
    maxHeight: "60%",
  },
  pickerEmpty: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textSecondary,
    textAlign: "center",
    paddingVertical: 24,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border + "88",
  },
  pickerRowName: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    color: C.text,
  },
  pickerRowMeta: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
});
