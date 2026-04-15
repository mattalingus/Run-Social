import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Buffer } from "buffer";
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
  Share,
  Linking,
} from "react-native";
import * as Notifications from "@/lib/safeNotifications";
import * as MediaLibrary from "expo-media-library";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import ShareActivityModal from "@/components/ShareActivityModal";
import AICoachCard from "@/components/AICoachCard";
import MileSplitsChart, { MileSplit } from "@/components/MileSplitsChart";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import {
  SOLO_LOCATION_TASK,
  addSoloLocationListener,
  requestBackgroundPermission,
  requestForegroundPermission,
  safeStartLocationUpdates,
  safeStopLocationUpdates,
} from "@/lib/locationTasks";
import * as ImagePicker from "expo-image-picker";
import { Pedometer } from "expo-sensors";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { useActivity } from "@/contexts/ActivityContext";
import { useAuth } from "@/contexts/AuthContext";
import { type ColorScheme } from "@/constants/colors";
import { useTheme } from "@/contexts/ThemeContext";
import { formatDistance } from "@/lib/formatDistance";
import { toDisplayDist, toDisplayPace, unitLabel, type DistanceUnit } from "@/lib/units";
import { LiveActivity } from "@/lib/liveActivity";
import { AndroidLiveNotification } from "@/lib/androidLiveNotification";

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
  prevPace: number | null,
  activityType: "run" | "ride" | "walk" = "run"
): string {
  const isRide = activityType === "ride";
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
    `${isRide ? "Riding" : "Running"} at ${pS} per mile.`,
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
    `You're ${isRide ? "riding" : "running"} ${pS} miles.`,
    `Speed check: ${pS} per mile.`,
    `${pS} on the pace.`,
    `Tracking at ${pS} per mile.`,
    `Mile pace: ${pS}.`,
    `You're sitting on ${pS}.`,
    `Pace check: ${pS} a mile.`,
    `${pS} per mile this ${isRide ? "ride" : "run"}.`,
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
    `${isRide ? "Riding" : "Running"} for ${tS}.`,
    `${tS} so far.`,
    `That's ${tS} of work.`,
    `${tS} logged.`,
    `Timer reads ${tS}.`,
    `You're ${tS} into this ${isRide ? "ride" : "run"}.`,
    `${totalM} minute${totalM !== 1 ? "s" : ""} on the watch.`,
    `Time at ${tS}.`,
    `${tS} underway.`,
    `Clock says ${tS}.`,
    `${tS} into it.`,
    `Elapsed: ${tS}.`,
    `You've ${isRide ? "ridden" : "run"} for ${tS}.`,
    `${tS} on the ${isRide ? "ride" : "run"}.`,
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
  const { activityFilter, setActivityFilter } = useActivity();
  const { user } = useAuth();
  const { C } = useTheme();
  const t = useMemo(() => makeRunStyles(C), [C]);
  const distUnit: DistanceUnit = ((user as any)?.distance_unit ?? "miles") as DistanceUnit;
  const { pathId, recover } = useLocalSearchParams<{ pathId?: string; recover?: string }>();

  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [displayDist, setDisplayDist] = useState(0);
  const [saving, setSaving] = useState(false);
  const [routeState, setRouteState] = useState<Coord[]>([]);
  const [isDriving, setIsDriving] = useState(false);
  const isDrivingRef = useRef(false);
  const vehicleNotifIdRef = useRef<string | null>(null);

  // T007: Fire haptic + local notification when vehicle detection triggers
  useEffect(() => {
    if (isDriving && !isDrivingRef.current) {
      isDrivingRef.current = true;
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Notifications.scheduleNotificationAsync({
          content: {
            title: "PaceUp paused",
            body: "Vehicle speed detected — open the app to resume.",
          },
          trigger: null,
        }).then((id) => { if (id) vehicleNotifIdRef.current = id; }).catch(() => {});
      }
    } else if (!isDriving && isDrivingRef.current) {
      isDrivingRef.current = false;
      if (vehicleNotifIdRef.current && Platform.OS !== "web") {
        Notifications.dismissNotificationAsync(vehicleNotifIdRef.current).catch(() => {});
        vehicleNotifIdRef.current = null;
      }
    }
  }, [isDriving]);

  // Audio Coach state
  const [coachEnabled, setCoachEnabled] = useState(true);
  const [coachInterval, setCoachInterval] = useState<"0.5" | "1" | "2">("1");
  const [coachVoice, setCoachVoice] = useState<"nova" | "onyx" | "shimmer" | "echo">("nova");
  const [previewingVoice, setPreviewingVoice] = useState<"nova" | "onyx" | "shimmer" | "echo" | null>(null);
  const previewSoundRef = useRef<Audio.Sound | null>(null);
  const previewTokenRef = useRef(0);
  const coachEnabledRef = useRef(true);
  const coachIntervalRef = useRef<"0.5" | "1" | "2">("1");
  const coachVoiceRef = useRef<"nova" | "onyx" | "shimmer" | "echo">("nova");
  const lastAnnouncedMileRef = useRef(0);
  const lastAnnouncedPaceRef = useRef<number | null>(null);

  useEffect(() => { coachEnabledRef.current = coachEnabled; }, [coachEnabled]);
  useEffect(() => { coachIntervalRef.current = coachInterval; }, [coachInterval]);
  useEffect(() => { coachVoiceRef.current = coachVoice; }, [coachVoice]);

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

  // Mile splits state
  const [mileSplits, setMileSplits] = useState<MileSplit[]>([]);

  // Post-run title editing state
  const [runTitle, setRunTitle] = useState("");
  const [titleSaved, setTitleSaved] = useState(false);

  // Post-run photo state
  const [savedRunId, setSavedRunId] = useState<string | null>(null);
  const [runPhotos, setRunPhotos] = useState<any[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [prTiers, setPrTiers] = useState<{ distanceTier: number | null; paceTier: number | null } | null>(null);


  const { data: savedPaths = [] } = useQuery<any[]>({
    queryKey: ["/api/saved-paths"],
    staleTime: 60_000,
  });

  const filteredSavedPaths = savedPaths.filter(
    (p: any) => (p.activity_type ?? "run") === activityFilter
  );

  // ─── Auto-select path from URL param ─────────────────────────────────────

  useEffect(() => {
    if (pathId && savedPaths.length > 0 && !selectedPath) {
      const match = savedPaths.find((p: any) => p.id === pathId);
      if (match) setSelectedPath(match);
    }
  }, [pathId, savedPaths]);

  const [pendingRecoveryFinish, setPendingRecoveryFinish] = useState(false);
  const recoveryDone = useRef(false);
  const draftIdRef = useRef(Date.now().toString() + Math.random().toString(36).substr(2, 9));
  useEffect(() => {
    if (recover !== "1" || !user || recoveryDone.current) return;
    recoveryDone.current = true;
    (async () => {
      try {
        const key = `paceup_active_run_${user.id}`;
        const raw = await AsyncStorage.getItem(key);
        if (!raw) return;
        const data = JSON.parse(raw);
        const savedToken = await AsyncStorage.getItem(`paceup_saved_draft_${user.id}`);
        if (savedToken && data.draftId && savedToken === data.draftId) {
          await AsyncStorage.removeItem(key);
          await AsyncStorage.removeItem(`paceup_saved_draft_${user.id}`).catch(() => {});
          return;
        }
        const validTypes = ["run", "ride", "walk"];
        const recoveredType = validTypes.includes(data.activityType) ? data.activityType : "run";
        draftIdRef.current = data.draftId || draftIdRef.current;
        setActivityFilter(recoveredType);
        totalDistRef.current = data.distanceMi ?? 0;
        elapsedRef.current = data.durationSeconds ?? 0;
        routePathRef.current = data.routePath ?? [];
        mileSplitsRef.current = data.splits ?? [];
        elevationGainRef.current = data.elevationGainFt ?? 0;
        lastSplitMileRef.current = Math.floor(data.distanceMi ?? 0);
        prevMileElapsedRef.current = data.durationSeconds ?? 0;
        setElapsed(data.durationSeconds ?? 0);
        setDisplayDist(data.distanceMi ?? 0);
        setRouteState(data.routePath ?? []);
        await AsyncStorage.removeItem(key);
        setPendingRecoveryFinish(true);
      } catch {}
    })();
  }, [recover, user]);

  useEffect(() => {
    if (!pendingRecoveryFinish || !user) return;
    setPendingRecoveryFinish(false);
    doFinish();
  }, [pendingRecoveryFinish, user]);

  // ─── Audio Coach Prefs ────────────────────────────────────────────────────

  useEffect(() => {
    async function loadPrefs() {
      try {
        const enabled = await AsyncStorage.getItem("@paceup_coach_enabled");
        const interval = await AsyncStorage.getItem("@paceup_coach_interval");
        const voice = await AsyncStorage.getItem("@paceup_coach_voice");
        if (enabled !== null) setCoachEnabled(enabled === "true");
        if (interval !== null) setCoachInterval(interval as any);
        if (voice !== null && ["nova", "onyx", "shimmer", "echo"].includes(voice)) {
          setCoachVoice(voice as "nova" | "onyx" | "shimmer" | "echo");
        }
      } catch (e) {}
    }
    loadPrefs();
  }, []);

  const toggleCoach = async (val: boolean) => {
    setCoachEnabled(val);
    try {
      await AsyncStorage.setItem("@paceup_coach_enabled", val.toString());
    } catch (e) {}
  };

  const updateCoachInterval = async (val: "0.5" | "1" | "2") => {
    setCoachInterval(val);
    try {
      await AsyncStorage.setItem("@paceup_coach_interval", val);
    } catch (e) {}
  };

  const updateCoachVoice = async (val: "nova" | "onyx" | "shimmer" | "echo") => {
    setCoachVoice(val);
    try {
      await AsyncStorage.setItem("@paceup_coach_voice", val);
    } catch (e) {}
  };

  const PREVIEW_PHRASES: Record<"nova" | "onyx" | "shimmer" | "echo", string> = {
    nova: "Ready to crush it? Let's go!",
    onyx: "Stay focused. You've got this.",
    shimmer: "You're doing great, keep it up!",
    echo: "Let's lock in and get after it.",
  };

  const playCoachPreview = async (voice: "nova" | "onyx" | "shimmer" | "echo") => {
    if (Platform.OS === "web") return;
    const token = ++previewTokenRef.current;
    try {
      if (previewSoundRef.current) {
        await previewSoundRef.current.stopAsync().catch(() => {});
        await previewSoundRef.current.unloadAsync().catch(() => {});
        previewSoundRef.current = null;
      }
    } catch (_) {}
    setPreviewingVoice(voice);
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        interruptionModeIOS: InterruptionModeIOS.DuckOthers,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
        shouldDuckAndroid: true,
      });
      const res = await apiRequest("POST", "/api/tts", { text: PREVIEW_PHRASES[voice], voice });
      if (!res.ok || previewTokenRef.current !== token) { setPreviewingVoice(null); return; }
      const arrayBuffer = await res.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const filename = `${FileSystem.cacheDirectory}coach_preview_${voice}.mp3`;
      await FileSystem.writeAsStringAsync(filename, base64, { encoding: FileSystem.EncodingType.Base64 });
      if (previewTokenRef.current !== token) { setPreviewingVoice(null); return; }
      const { sound } = await Audio.Sound.createAsync({ uri: filename });
      previewSoundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (status.didJustFinish) {
          setPreviewingVoice(null);
          sound.unloadAsync().catch(() => {});
          if (previewSoundRef.current === sound) previewSoundRef.current = null;
        }
      });
      await sound.playAsync();
      return;
    } catch (_) {}
    setPreviewingVoice(null);
  };

  useEffect(() => {
    return () => {
      previewTokenRef.current = -1;
      previewSoundRef.current?.stopAsync().catch(() => {});
      previewSoundRef.current?.unloadAsync().catch(() => {});
      previewSoundRef.current = null;
    };
  }, []);

  const audioModeConfiguredRef = useRef(false);

  const ensureAudioMode = useCallback(async (duck: boolean) => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        interruptionModeIOS: duck ? InterruptionModeIOS.DuckOthers : InterruptionModeIOS.MixWithOthers,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
        shouldDuckAndroid: duck,
        playThroughEarpieceAndroid: false,
      });
    } catch (e) {}
  }, []);

  const announcePace = useCallback(async (distance: number, totalSeconds: number) => {
    if (Platform.OS === "web") return;

    await ensureAudioMode(true);

    const paceMinTotal = totalSeconds / 60 / distance;
    const text = pickCoachPhrase(distance, paceMinTotal, totalSeconds, lastAnnouncedPaceRef.current, activityFilter);
    lastAnnouncedPaceRef.current = paceMinTotal;

    try {
      const res = await apiRequest("POST", "/api/tts", { text, voice: coachVoiceRef.current });
      if (!res.ok) throw new Error("TTS failed");
      try {
        const arrayBuffer = await res.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");
        const filename = `${FileSystem.cacheDirectory}pace_${Math.round(distance * 100)}.mp3`;
        await FileSystem.writeAsStringAsync(filename, base64, { encoding: FileSystem.EncodingType.Base64 });
        const { sound } = await Audio.Sound.createAsync({ uri: filename });
        sound.setOnPlaybackStatusUpdate((status: any) => {
          if (status.didJustFinish) {
            ensureAudioMode(false);
            sound.unloadAsync().catch(() => {});
          }
        });
        await sound.playAsync();
        return;
      } catch (e) {
        Speech.speak(text, {
          rate: 0.95,
          onDone: () => { void ensureAudioMode(false); },
          onError: () => { void ensureAudioMode(false); },
        });
        return;
      }
    } catch (e) {}

    Speech.speak(text, {
      rate: 0.95,
      onDone: () => { void ensureAudioMode(false); },
      onError: () => { void ensureAudioMode(false); },
    });
  }, [activityFilter]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const foregroundOnlyRef = useRef(false);
  const webWatchIdRef = useRef<number | null>(null);
  const lastCoordRef = useRef<Coord | null>(null);
  const lastCoordTimestampRef = useRef<number | null>(null);
  const liveActivityStartedRef = useRef(false);
  const totalDistRef = useRef(0);
  const routePathRef = useRef<Coord[]>([]);
  const mapRef = useRef<any>(null);
  const elapsedRef = useRef(0);
  const mileSplitsRef = useRef<MileSplit[]>([]);
  const lastSplitMileRef = useRef(0);
  // New stat tracking refs
  const elevationGainRef = useRef(0);
  const altitudeBufferRef = useRef<number[]>([]);
  const lastSmoothedAltRef = useRef<number | null>(null);
  const moveTimeRef = useRef(0);
  const lastMoveTimestampRef = useRef<number | null>(null);

  // ─── Location permission nudge banner ────────────────────────────────────
  const [showPermNudge, setShowPermNudge] = useState(false);
  const stepCountRef = useRef(0);
  const pedometerSubRef = useRef<{ remove: () => void } | null>(null);
  const prevMileElapsedRef = useRef(0);

  // ─── Timer ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase === "active") {
      intervalRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [phase]);

  useEffect(() => { elapsedRef.current = elapsed; }, [elapsed]);


  // ─── Periodic autosave (crash recovery) ───────────────────────────────────
  const AUTOSAVE_KEY = user ? `paceup_active_run_${user.id}` : null;

  useEffect(() => {
    if ((phase !== "active" && phase !== "paused") || !AUTOSAVE_KEY) return;
    const save = () => {
      const data = {
        draftId: draftIdRef.current,
        distanceMi: totalDistRef.current,
        durationSeconds: elapsedRef.current,
        routePath: routePathRef.current,
        splits: mileSplitsRef.current,
        activityType: activityFilter,
        elevationGainFt: elevationGainRef.current,
        timestamp: new Date().toISOString(),
      };
      AsyncStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data)).catch(() => {});
    };
    save();
    const id = setInterval(save, 30_000);
    return () => clearInterval(id);
  }, [phase, AUTOSAVE_KEY, activityFilter]);

  // ─── Screenshot detection on done screen ──────────────────────────────────
  useEffect(() => {
    if (phase !== "done" || Platform.OS === "web") return;
    let sub: MediaLibrary.Subscription | null = null;
    const doneAt = Date.now();
    (async () => {
      try {
        const { status } = await MediaLibrary.requestPermissionsAsync(false);
        if (status !== "granted") return;
        sub = MediaLibrary.addListener(() => {
          // Ignore triggers in first 3s (avoids false positive on screen load)
          if (Date.now() - doneAt < 3000) return;
          const dist = totalDistRef.current;
          const pace = dist > 0.01 ? (elapsedRef.current / 60) / dist : null;
          const paceStr = pace
            ? `${Math.floor(pace)}:${Math.round((pace - Math.floor(pace)) * 60).toString().padStart(2, "0")}/mi`
            : "";
          Share.share({
            message: `Just finished a ${dist.toFixed(2)} mile ${activityFilter}${paceStr ? ` at ${paceStr} pace` : ""}! ${activityFilter === "ride" ? "🚴" : activityFilter === "walk" ? "🚶" : "🏃"} Tracked on PaceUp.`,
          }).catch(() => {});
        });
      } catch (_) {}
    })();
    return () => { sub?.remove(); };
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

  const handleCoord = useCallback((latitude: number, longitude: number, accuracy?: number, speed?: number | null, altitude?: number | null) => {
    // Skip poor-accuracy fixes that occur during GPS warm-up (first few seconds)
    // Native threshold: 40m, web threshold: 100m (web GPS is inherently less accurate)
    const maxAccuracy = Platform.OS === "web" ? 100 : 40;
    if (accuracy != null && accuracy > maxAccuracy) return;

    // Vehicle detection: walk > 4 m/s (~9 mph), run > 12 m/s (~27 mph), ride > 22 m/s (~50 mph)
    const vehicleThreshold = activityFilter === "ride" ? 22 : activityFilter === "walk" ? 4 : 12;
    if (speed != null && speed > 0 && speed > vehicleThreshold) {
      setIsDriving(true);
      return;
    }
    setIsDriving(false);

    if (altitude != null && Platform.OS !== "web") {
      altitudeBufferRef.current.push(altitude);
      if (altitudeBufferRef.current.length > 5) {
        altitudeBufferRef.current.shift();
      }
      if (altitudeBufferRef.current.length === 5) {
        const smoothed = altitudeBufferRef.current.reduce((a, b) => a + b, 0) / 5;
        if (lastSmoothedAltRef.current != null) {
          const deltaM = smoothed - lastSmoothedAltRef.current;
          if (deltaM > 0.6) {
            elevationGainRef.current += deltaM * 3.28084;
            lastSmoothedAltRef.current = smoothed;
          } else if (deltaM < -0.6) {
            lastSmoothedAltRef.current = smoothed;
          }
        } else {
          lastSmoothedAltRef.current = smoothed;
        }
      }
    }

    // Move time: accumulate when actively moving (speed > 0.5 m/s ≈ 1.1 mph)
    const now = Date.now();
    if (lastMoveTimestampRef.current != null && speed != null && speed > 0.5) {
      const deltaSec = (now - lastMoveTimestampRef.current) / 1000;
      if (deltaSec < 30) moveTimeRef.current += deltaSec; // cap to avoid jumps after pauses
    }
    lastMoveTimestampRef.current = now;

    // GPS gap reconciliation: if the app was backgrounded with foreground-only permission,
    // the location (and our timer) pauses, but the user kept moving. When we get a new fix
    // after a large time gap, credit the missing wall-clock seconds to the elapsed timer so
    // distance and time stay proportional and pace stays accurate.
    const GPS_GAP_THRESHOLD_SEC = 30;
    if (lastCoordTimestampRef.current !== null) {
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
        if (coachEnabledRef.current && Platform.OS !== "web") {
          const interval = parseFloat(coachIntervalRef.current);
          if (totalDistRef.current >= lastAnnouncedMileRef.current + interval) {
            lastAnnouncedMileRef.current += interval;
            announcePace(lastAnnouncedMileRef.current, elapsedRef.current);
          }
        }

        // Mile split tracking — uses elapsedRef to avoid stale closure
        if (totalDistRef.current >= lastSplitMileRef.current + 1) {
          const segmentSeconds = elapsedRef.current - prevMileElapsedRef.current;
          const splitPace = Math.min(Math.max(segmentSeconds / 60, 1), 30);
          mileSplitsRef.current.push({
            label: `M${mileSplitsRef.current.length + 1}`,
            paceMinPerMile: splitPace,
            isPartial: false,
          });
          setMileSplits([...mileSplitsRef.current]);
          lastSplitMileRef.current += 1;
          prevMileElapsedRef.current = elapsedRef.current;
        }
      }
    }
    lastCoordRef.current = coord;

    // Live Activity (iOS) + Android lock screen notification: start on first GPS fix, update on each tick
    if (Platform.OS !== "web") {
      const paceNum = totalDistRef.current > 0.01
        ? elapsedRef.current / 60 / totalDistRef.current
        : 0;
      const actType = (activityFilter ?? "run") as "run" | "ride" | "walk";
      if (!liveActivityStartedRef.current) {
        liveActivityStartedRef.current = true;
        LiveActivity.start({
          elapsedSeconds: elapsedRef.current,
          distanceMiles: totalDistRef.current,
          paceMinPerMile: paceNum,
          activityType: actType,
        });
        if (Platform.OS === "android") {
          AndroidLiveNotification.start({
            elapsedSeconds: elapsedRef.current,
            distanceMiles: totalDistRef.current,
            paceMinPerMile: paceNum,
            activityType: actType,
            coordinates: routePathRef.current,
          });
        }
      } else {
        LiveActivity.update({
          elapsedSeconds: elapsedRef.current,
          distanceMiles: totalDistRef.current,
          paceMinPerMile: paceNum,
          activityType: actType,
        });
        if (Platform.OS === "android") {
          AndroidLiveNotification.update({
            elapsedSeconds: elapsedRef.current,
            distanceMiles: totalDistRef.current,
            paceMinPerMile: paceNum,
            activityType: actType,
            coordinates: routePathRef.current,
          });
        }
      }
    }

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
          (pos) => handleCoord(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? undefined, pos.coords.speed, pos.coords.altitude),
          () => {},
          { enableHighAccuracy: true, maximumAge: 3000 }
        );
      }
      return;
    }
    if (foregroundOnlyRef.current) {
      try {
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5 },
          (loc) => {
            const { latitude, longitude, speed, altitude, accuracy } = loc.coords;
            handleCoord(latitude, longitude, accuracy ?? undefined, speed, altitude);
          }
        );
        locationSubRef.current = sub;
      } catch (err: any) {
        handleLocationPermissionError(err);
      }
      return;
    }
    try {
      await safeStartLocationUpdates(SOLO_LOCATION_TASK, {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 5,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: `PaceUp is tracking your ${activityFilter === "ride" ? "ride" : activityFilter === "walk" ? "walk" : "run"}`,
          notificationBody: "Your route is being recorded",
          notificationColor: "#00D97E",
        },
      });
      const unsub = addSoloLocationListener((lat, lng, speed, altitude, accuracy) => {
        handleCoord(lat, lng, accuracy ?? undefined, speed, altitude);
      });
      locationSubRef.current = { remove: unsub } as any;
    } catch (err: any) {
      if (isPermissionError(err)) {
        handleLocationPermissionError(err);
        return;
      }
      try {
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5 },
          (loc) => {
            const { latitude, longitude, speed, altitude, accuracy } = loc.coords;
            handleCoord(latitude, longitude, accuracy ?? undefined, speed, altitude);
          }
        );
        locationSubRef.current = sub;
      } catch (err2: any) {
        handleLocationPermissionError(err2);
      }
    }
  }

  function isPermissionError(err: any): boolean {
    const msg = (err?.message ?? "").toLowerCase();
    return msg.includes("permission") || msg.includes("denied") || msg.includes("not authorized") || msg.includes("not granted");
  }

  const permAlertShownRef = useRef(false);
  function handleLocationPermissionError(err: any) {
    if (!isPermissionError(err) || permAlertShownRef.current) return;
    permAlertShownRef.current = true;
    Alert.alert(
      "Location Access Lost",
      "Location permission was revoked. Your route will stop recording. Please re-enable location access in Settings.",
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

  function stopWatching() {
    if (Platform.OS === "web") {
      if (webWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(webWatchIdRef.current);
        webWatchIdRef.current = null;
      }
    } else {
      if (locationSubRef.current) {
        locationSubRef.current.remove();
        locationSubRef.current = null;
      }
      if (!foregroundOnlyRef.current) {
        safeStopLocationUpdates(SOLO_LOCATION_TASK);
      }
    }
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  async function handleStart() {
    if (Platform.OS !== "web") {
      let bgGranted = false;
      try {
        bgGranted = await requestBackgroundPermission();
      } catch {}
      foregroundOnlyRef.current = false;
      if (!bgGranted) {
        const fgGranted = await requestForegroundPermission();
        if (!fgGranted) {
          Alert.alert(
            "Location Required",
            "Enable location access in Settings so PaceUp can track your run."
          );
          return;
        }
        foregroundOnlyRef.current = true;
      }
    }
    lastCoordRef.current = null;
    lastCoordTimestampRef.current = null;
    totalDistRef.current = 0;
    routePathRef.current = [];
    setRouteState([]);
    setDisplayDist(0);
    setElapsed(0);
    setPathSaved(false);
    lastAnnouncedMileRef.current = 0;
    lastAnnouncedPaceRef.current = null;
    mileSplitsRef.current = [];
    lastSplitMileRef.current = 0;
    prevMileElapsedRef.current = 0;
    setMileSplits([]);
    // Reset new stat refs
    elevationGainRef.current = 0;
    altitudeBufferRef.current = [];
    lastSmoothedAltRef.current = null;
    moveTimeRef.current = 0;
    lastMoveTimestampRef.current = null;
    stepCountRef.current = 0;

    // Check permission level and show nudge if only foreground was granted
    if (Platform.OS !== "web") {
      (async () => {
        try {
          const dismissed = await AsyncStorage.getItem("@paceup_perm_nudge_dismissed");
          if (dismissed === "true") return;
          const { status: fgStatus } = await Location.getForegroundPermissionsAsync();
          const { status: bgStatus } = await Location.getBackgroundPermissionsAsync();
          if (fgStatus === "granted" && bgStatus !== "granted") {
            setShowPermNudge(true);
          }
        } catch {}
      })();
    }
    // Start pedometer for runs only (native only)
    if (activityFilter === "run" && Platform.OS !== "web") {
      try {
        const available = await Pedometer.isAvailableAsync();
        if (available) {
          pedometerSubRef.current = Pedometer.watchStepCount((result) => {
            stepCountRef.current = result.steps;
          });
        }
      } catch (_) {}
    }
    liveActivityStartedRef.current = false;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPhase("active");
  }

  function stopPedometer() {
    if (pedometerSubRef.current) {
      pedometerSubRef.current.remove();
      pedometerSubRef.current = null;
    }
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
        activityType: activityFilter,
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
    lastCoordTimestampRef.current = null;
    setPhase("active");
  }

  function doFinish() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (Platform.OS !== "web") Speech.stop();
    stopPedometer();
    const finalPaceNum =
      totalDistRef.current > 0.01
        ? elapsedRef.current / 60 / totalDistRef.current
        : 0;
    LiveActivity.end({
      elapsedSeconds: elapsedRef.current,
      distanceMiles: totalDistRef.current,
      paceMinPerMile: finalPaceNum,
      activityType: activityFilter as "run" | "ride" | "walk",
    });
    if (Platform.OS === "android") {
      AndroidLiveNotification.end({
        elapsedSeconds: elapsedRef.current,
        distanceMiles: totalDistRef.current,
        paceMinPerMile: finalPaceNum,
        activityType: activityFilter as "run" | "ride" | "walk",
      });
    }
    // Compute final partial-mile split before transitioning to done screen
    const finalSplits = [...mileSplitsRef.current];
    const remainingDist = totalDistRef.current - lastSplitMileRef.current;
    if (remainingDist > 0.05 && elapsedRef.current > prevMileElapsedRef.current) {
      const remainingSeconds = elapsedRef.current - prevMileElapsedRef.current;
      const partialPace = Math.min(Math.max((remainingSeconds / 60) / remainingDist, 1), 30);
      finalSplits.push({
        label: remainingDist.toFixed(1),
        paceMinPerMile: partialPace,
        isPartial: true,
      });
    }

    // Clip GPS path and distance to the saved route's length if the user ran past it
    if (selectedPath?.distance_miles && totalDistRef.current > selectedPath.distance_miles) {
      const routeDist = selectedPath.distance_miles;
      const fullPath = routePathRef.current;
      if (fullPath.length > 1) {
        let cumDist = 0;
        const clippedPts: { latitude: number; longitude: number }[] = [fullPath[0]];
        let didClip = false;
        for (let i = 1; i < fullPath.length; i++) {
          const prev = fullPath[i - 1];
          const curr = fullPath[i];
          const seg = haversine(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
          if (cumDist + seg >= routeDist) {
            const frac = seg > 0 ? (routeDist - cumDist) / seg : 0;
            clippedPts.push({
              latitude: prev.latitude + frac * (curr.latitude - prev.latitude),
              longitude: prev.longitude + frac * (curr.longitude - prev.longitude),
            });
            didClip = true;
            break;
          }
          clippedPts.push(curr);
          cumDist += seg;
        }
        if (didClip) {
          routePathRef.current = clippedPts;
          totalDistRef.current = routeDist;
          setDisplayDist(routeDist);
          // Rebuild splits: keep full-mile splits within the route, add partial for leftover
          const fullMilesInRoute = Math.floor(routeDist);
          const keptSplits = finalSplits.filter((s) => !s.isPartial).slice(0, fullMilesInRoute);
          const fracDist = routeDist - fullMilesInRoute;
          if (fracDist > 0.05) {
            const avgPace = elapsedRef.current / 60 / routeDist;
            keptSplits.push({
              label: fracDist.toFixed(2),
              paceMinPerMile: Math.min(Math.max(avgPace, 1), 30),
              isPartial: true,
            });
          }
          finalSplits.length = 0;
          finalSplits.push(...keptSplits);
        }
      }
    }

    setMileSplits(finalSplits);
    // T002: persist draft so data survives app crash on done screen
    if (user) {
      const draft = {
        draftId: draftIdRef.current,
        distanceMi: totalDistRef.current,
        durationSeconds: elapsedRef.current,
        routePath: routePathRef.current,
        splits: finalSplits,
        activityType: activityFilter,
        elevationGainFt: elevationGainRef.current,
        timestamp: new Date().toISOString(),
      };
      AsyncStorage.setItem(`paceup_draft_run_${user.id}`, JSON.stringify(draft)).catch(() => {});
    }
    if (AUTOSAVE_KEY) AsyncStorage.removeItem(AUTOSAVE_KEY).catch(() => {});
    setPhase("done");
  }

  function handleFinish() {
    const type = activityFilter === "ride" ? "Ride" : activityFilter === "walk" ? "Walk" : "Run";
    Alert.alert(
      `Finish ${type}?`,
      `Ready to wrap up this ${type.toLowerCase()}?`,
      [
        { text: "Keep Going", style: "cancel" },
        { text: `Finish ${type}`, onPress: doFinish },
      ]
    );
  }

  function handleCancel() {
    if (phase === "idle") {
      if (Platform.OS !== "web") Speech.stop();
      router.back();
      return;
    }
    Alert.alert(`Discard ${activityFilter === "ride" ? "Ride" : activityFilter === "walk" ? "Walk" : "Run"}`, `Discard this ${activityFilter === "ride" ? "ride" : activityFilter === "walk" ? "walk" : "run"} and go back?`, [
      { text: "Keep Going", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          if (Platform.OS !== "web") Speech.stop();
          stopWatching();
          stopPedometer();
          if (AUTOSAVE_KEY) AsyncStorage.removeItem(AUTOSAVE_KEY).catch(() => {});
          router.back();
        },
      },
    ]);
  }

  async function saveRun() {
    const distance = totalDistRef.current;
    const pace = distance > 0.01 ? (elapsed / 60) / distance : null;
    setSaving(true);
    const MAX_RETRIES = 3;
    const payload = {
      title: `${toDisplayDist(distance, distUnit)} solo ${activityFilter === "ride" ? "ride" : activityFilter === "walk" ? "walk" : "run"}`,
      date: new Date().toISOString(),
      distanceMiles: Math.max(distance, 0.001),
      paceMinPerMile: pace,
      durationSeconds: elapsed,
      completed: true,
      planned: false,
      routePath: routePathRef.current.length > 1 ? routePathRef.current : null,
      activityType: activityFilter,
      savedPathId: selectedPath?.id ?? null,
      mileSplits: mileSplits.length > 0 ? mileSplits : null,
      elevationGainFt: elevationGainRef.current > 0 ? Math.round(elevationGainRef.current) : null,
      stepCount: activityFilter === "run" && stepCountRef.current > 0 ? stepCountRef.current : null,
      moveTimeSeconds: moveTimeRef.current > 0 ? Math.round(moveTimeRef.current) : null,
    };

    let lastErr: any = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await apiRequest("POST", "/api/solo-runs", payload);
        const saved = await res.json();
        setSavedRunId(saved.id);
        setRunTitle(saved.title ?? "");
        if (saved.prTiers) setPrTiers(saved.prTiers);
        qc.invalidateQueries({ queryKey: ["/api/solo-runs"] });
        qc.invalidateQueries({ queryKey: ["/api/runs/mine"] });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (user) {
          await AsyncStorage.setItem(`paceup_saved_draft_${user.id}`, draftIdRef.current);
          await AsyncStorage.removeItem(`paceup_draft_run_${user.id}`).catch(() => {});
        }
        // Write-back to Apple Health so it credits Activity rings (iOS only, silent fail)
        if (Platform.OS === "ios" && (user as any)?.apple_health_connected) {
          try {
            const { saveWorkoutToHealthKit } = require("@/lib/healthKit");
            const runEndDate = new Date();
            const runStartDate = new Date(runEndDate.getTime() - elapsed * 1000);
            await saveWorkoutToHealthKit({
              activityType: activityFilter as "run" | "ride" | "walk",
              startDate: runStartDate,
              endDate: runEndDate,
              distanceMiles: Math.max(distance, 0.001),
              durationSeconds: elapsed,
            });
          } catch (_) {}
        }
        // Write-back to Google Health Connect (Android only, silent fail)
        if (Platform.OS === "android" && (user as any)?.health_connect_connected) {
          try {
            const { saveWorkoutToHealthConnect } = require("@/lib/healthConnect");
            const runEndDate = new Date();
            const runStartDate = new Date(runEndDate.getTime() - elapsed * 1000);
            await saveWorkoutToHealthConnect({
              activityType: activityFilter as "run" | "ride" | "walk",
              startDate: runStartDate,
              endDate: runEndDate,
              distanceMeters: Math.max(distance, 0.001) * 1609.344,
              durationSeconds: elapsed,
            });
          } catch (_) {}
        }
        setSaving(false);
        return;
      } catch (e: any) {
        lastErr = e;
        
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
        }
      }
    }
    setSaving(false);
    Alert.alert("Save Failed", lastErr?.message ?? "Could not save your activity. Your data has been preserved — try again.");
  }

  async function saveTitleIfChanged(newTitle: string) {
    if (!savedRunId) return;
    const trimmed = newTitle.trim();
    if (!trimmed || trimmed === runTitle) return;
    try {
      await apiRequest("PUT", `/api/solo-runs/${savedRunId}`, { title: trimmed });
      setRunTitle(trimmed);
      setTitleSaved(true);
      setTimeout(() => setTitleSaved(false), 2000);
      qc.invalidateQueries({ queryKey: ["/api/solo-runs"] });
    } catch (_) {}
  }

  function finishAndNavigate() {
    // Stop any lingering location watchers before navigating away to prevent
    // callbacks firing into an unmounted component state.
    stopWatching();
    stopPedometer();
    // Navigate to solo tab; use a brief tick to let React flush pending state
    // before the route transition tears down this component.
    setTimeout(() => {
      router.replace("/(tabs)/solo" as any);
    }, 0);
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
        `${toDisplayDist(totalDistRef.current, distUnit)} ${activityFilter === "ride" ? "Ride" : activityFilter === "walk" ? "Walk" : "Run"}`
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
    const displayPace = pace && distUnit === "km" ? pace / 1.60934 : pace;
    const paceM = displayPace ? Math.floor(displayPace) : 0;
    const paceS = displayPace ? Math.round((displayPace - paceM) * 60) : 0;
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

        <ScrollView
          style={t.summaryCard}
          contentContainerStyle={[
            t.summaryCardContent,
            !hasRoute && { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 48) },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={t.summaryTitle}>{activityFilter === "ride" ? "Ride Complete" : activityFilter === "walk" ? "Walk Complete" : "Run Complete"}</Text>

          {/* Editable run title */}
          {savedRunId ? (
            <View style={t.titleEditRow}>
              <TextInput
                style={t.titleInput}
                value={runTitle}
                onChangeText={setRunTitle}
                onBlur={() => saveTitleIfChanged(runTitle)}
                onSubmitEditing={() => saveTitleIfChanged(runTitle)}
                returnKeyType="done"
                placeholder={activityFilter === "ride" ? "Name this ride…" : activityFilter === "walk" ? "Name this walk…" : "Name this run…"}
                placeholderTextColor={C.textMuted}
                selectTextOnFocus
                maxLength={80}
              />
              {titleSaved ? (
                <Feather name="check" size={14} color={C.primary} />
              ) : (
                <Feather name="edit-2" size={14} color={C.textMuted} />
              )}
            </View>
          ) : null}

          {/* PR Banner */}
          {prTiers && (prTiers.distanceTier != null || prTiers.paceTier != null) && (() => {
            const tier = Math.min(
              prTiers.distanceTier ?? 99,
              prTiers.paceTier ?? 99
            );
            const isDistance = (prTiers.distanceTier ?? 99) <= (prTiers.paceTier ?? 99);
            const color = tier === 1 ? "#FFB800" : tier === 2 ? "#C0C0C0" : "#CD7F32";
            const actLabel = activityFilter === "ride" ? "Ride" : activityFilter === "walk" ? "Walk" : "Run";
            const label = tier === 1
              ? (isDistance ? `New Distance PR!` : "New Pace PR!")
              : tier === 2
              ? (isDistance ? `2nd Longest ${actLabel}` : "2nd Fastest Pace")
              : (isDistance ? `3rd Longest ${actLabel}` : "3rd Fastest Pace");
            return (
              <View style={[t.prBanner, { borderColor: color + "55", backgroundColor: color + "15" }]}>
                <Ionicons name="medal" size={18} color={color} />
                <Text style={[t.prBannerText, { color }]}>{label}</Text>
              </View>
            );
          })()}

          <View style={t.statsRow}>
            <View style={t.statBlock}>
              <Text style={t.statBig}>{toDisplayDist(distance, distUnit)}</Text>
              <Text style={t.statUnit}>{distUnit === "km" ? "km" : "miles"}</Text>
            </View>
            <View style={t.statDivider} />
            <View style={t.statBlock}>
              <Text style={t.statBig}>{formatElapsed(elapsed)}</Text>
              <Text style={t.statUnit}>time</Text>
            </View>
            <View style={t.statDivider} />
            <View style={t.statBlock}>
              <Text style={t.statBig}>
                {displayPace ? `${paceM}:${paceS.toString().padStart(2, "0")}` : "--"}
              </Text>
              <Text style={t.statUnit}>{distUnit === "km" ? "min/km" : "min/mi"}</Text>
            </View>
          </View>

          {/* Secondary stats row: elevation, move time, steps */}
          {(() => {
            const elev = elevationGainRef.current > 0 ? Math.round(elevationGainRef.current) : null;
            const moveSecs = Math.round(moveTimeRef.current);
            const steps = activityFilter === "run" ? stepCountRef.current : 0;
            if (!elev && !moveSecs && !steps) return null;
            const formatMoveTime = (s: number) => {
              const h = Math.floor(s / 3600);
              const m = Math.floor((s % 3600) / 60);
              const sec = s % 60;
              if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
              return `${m}:${sec.toString().padStart(2, "0")}`;
            };
            return (
              <View style={[t.statsRow2, { backgroundColor: C.card, borderColor: C.border }]}>
                {elev != null && (
                  <View style={t.stat2Block}>
                    <Feather name="trending-up" size={14} color={C.textMuted} />
                    <Text style={[t.stat2Val, { color: C.text }]}>{elev} ft</Text>
                    <Text style={[t.stat2Label, { color: C.textMuted }]}>elevation</Text>
                  </View>
                )}
                {moveSecs > 0 && (
                  <View style={t.stat2Block}>
                    <Feather name="clock" size={14} color={C.textMuted} />
                    <Text style={[t.stat2Val, { color: C.text }]}>{formatMoveTime(moveSecs)}</Text>
                    <Text style={[t.stat2Label, { color: C.textMuted }]}>move time</Text>
                  </View>
                )}
                {steps > 0 && (
                  <View style={t.stat2Block}>
                    <Ionicons name="footsteps-outline" size={14} color={C.textMuted} />
                    <Text style={[t.stat2Val, { color: C.text }]}>{steps.toLocaleString()}</Text>
                    <Text style={[t.stat2Label, { color: C.textMuted }]}>steps</Text>
                  </View>
                )}
              </View>
            );
          })()}

          {mileSplits.length > 0 && (
            <MileSplitsChart splits={mileSplits} activityType={activityFilter} />
          )}

          {savedRunId ? (
            <>
              {/* ─── AI Coach Card ──────────────────────────────────────── */}
              <AICoachCard runId={savedRunId} style={{ marginHorizontal: 4, marginBottom: 10 }} />

              {/* ─── Share ──────────────────────────────────────────────── */}
              <Pressable
                style={t.shareBtn}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowShare(true); }}
              >
                <Feather name="share-2" size={16} color={C.primary} />
                <Text style={t.shareBtnTxt}>{activityFilter === "ride" ? "Share Ride" : activityFilter === "walk" ? "Share Walk" : "Share Run"}</Text>
              </Pressable>

              {/* ─── Photo section ─────────────────────────────────────── */}
              <View style={t.photoSection}>
                <Text style={t.photoSectionTitle}>Add a photo</Text>
                {runPhotos.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={t.photoScroll}>
                    {runPhotos.map((p: any) => {
                      const photoUri = p.photo_url?.startsWith("/")
                        ? new URL(p.photo_url, getApiUrl()).toString()
                        : p.photo_url;
                      return <Image key={p.id} source={{ uri: photoUri }} style={t.photoThumb} />;
                    })}
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
                          setPublishName(`${toDisplayDist(totalDistRef.current, distUnit)} ${activityFilter === "ride" ? "Ride" : activityFilter === "walk" ? "Walk" : "Run"}`);
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
                      setPathName(`My Route – ${toDisplayDist(totalDistRef.current, distUnit)}`);
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
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <ActivityIndicator color={C.bg} />
                    <Text style={t.saveBtnTxt}>Saving…</Text>
                  </View>
                ) : (
                  <Text style={t.saveBtnTxt}>{activityFilter === "ride" ? "Save Ride" : activityFilter === "walk" ? "Save Walk" : "Save Run"}</Text>
                )}
              </Pressable>

              {!saving && (
                <Pressable
                  style={t.discardBtn}
                  onPress={() => {
                    if (user) AsyncStorage.removeItem(`paceup_draft_run_${user.id}`).catch(() => {});
                    stopWatching();
                    router.back();
                  }}
                >
                  <Text style={t.discardTxt}>Discard</Text>
                </Pressable>
              )}
            </>
          )}
        </ScrollView>

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
            durationSeconds: elapsedRef.current,
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
  const livePaceStr = (() => {
    if (displayDist < 0.01 || elapsed < 1) return "--:--";
    const minPerMile = elapsed / 60 / displayDist;
    const p = distUnit === "km" ? minPerMile / 1.60934 : minPerMile;
    const m = Math.floor(p);
    const s = Math.round((p - m) * 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  })();

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
              {phase === "idle" ? "Ready" : phase === "active" ? (activityFilter === "ride" ? "Riding" : activityFilter === "walk" ? "Walking" : "Running") : "Paused"}
            </Text>
          </View>
        )}

        {/* Timer */}
        <Text style={[t.timerTxt, showMap && t.timerTxtCompact]}>
          {formatElapsed(elapsed)}
        </Text>

        {/* Vehicle detected banner */}
        {isDriving && phase === "active" && (
          <View style={t.drivingBanner}>
            <Ionicons name="car-outline" size={16} color="#fff" />
            <Text style={t.drivingBannerTxt}>Vehicle detected — tracking paused</Text>
          </View>
        )}

        {/* Location permission nudge */}
        {showPermNudge && (phase === "active" || phase === "paused") && (
          <View style={t.permNudge}>
            <Feather name="map-pin" size={14} color="#FFC542" />
            <Text style={t.permNudgeTxt}>
              Enable "Always Allow" location for accurate tracking when switching apps or locking the screen.
            </Text>
            <Pressable
              style={t.permNudgeDismiss}
              onPress={() => {
                setShowPermNudge(false);
                AsyncStorage.setItem("@paceup_perm_nudge_dismissed", "true").catch(() => {});
              }}
            >
              <Feather name="x" size={14} color="#FFC542" />
            </Pressable>
          </View>
        )}

        {/* Live stats */}
        <View style={t.liveRow}>
          <View style={t.liveStat}>
            <Text style={t.liveVal}>{toDisplayDist(displayDist, distUnit)}</Text>
            <Text style={t.liveUnit}>{distUnit === "km" ? "km" : "miles"}</Text>
          </View>
          <View style={t.liveDivider} />
          <View style={t.liveStat}>
            <Text style={t.liveVal}>{livePaceStr}</Text>
            <Text style={t.liveUnit}>{distUnit === "km" ? "min/km" : "min/mi"}</Text>
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
              <Text style={t.startBtnTxt}>{activityFilter === "ride" ? "Start Ride" : activityFilter === "walk" ? "Start Walk" : "Start Run"}</Text>
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

        {(phase === "active" || phase === "paused") && mileSplits.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ width: "100%" }}
            contentContainerStyle={{ flexDirection: "row", gap: 8, paddingHorizontal: 16 }}
          >
            {mileSplits.map((split) => {
              const m = Math.floor(split.paceMinPerMile);
              const s = Math.round((split.paceMinPerMile - m) * 60);
              const paceStr = `${m}:${s.toString().padStart(2, "0")}`;
              return (
                <View key={split.label} style={t.splitChip}>
                  <Text style={t.splitChipLabel}>{split.label}</Text>
                  <Text style={t.splitChipPace}>{paceStr}</Text>
                </View>
              );
            })}
          </ScrollView>
        )}

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
                <>
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
                  <View style={t.coachPersonaRow}>
                    {[
                      { voice: "nova" as const, name: "Nova", blurb: "Energetic & motivating" },
                      { voice: "onyx" as const, name: "Jordan", blurb: "Calm & authoritative" },
                      { voice: "shimmer" as const, name: "Sam", blurb: "Clear & encouraging" },
                      { voice: "echo" as const, name: "Zach", blurb: "Warm & steady" },
                    ].map((persona) => (
                      <Pressable
                        key={persona.voice}
                        style={[
                          t.coachPersonaCard,
                          coachVoice === persona.voice && t.coachPersonaCardActive,
                        ]}
                        onPress={() => { updateCoachVoice(persona.voice); playCoachPreview(persona.voice); }}
                      >
                        <Text style={[t.coachPersonaName, coachVoice === persona.voice && t.coachPersonaNameActive]}>
                          {persona.name}
                        </Text>
                        {previewingVoice === persona.voice ? (
                          <ActivityIndicator size="small" color={C.primary} style={{ marginTop: 2 }} />
                        ) : (
                          <Text style={t.coachPersonaBlurb} numberOfLines={2}>
                            {persona.blurb}
                          </Text>
                        )}
                      </Pressable>
                    ))}
                  </View>
                </>
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
            {filteredSavedPaths.length === 0 ? (
              <Text style={t.pickerEmpty}>No saved paths yet. Complete a {activityFilter} and save its path first.</Text>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {filteredSavedPaths.map((p: any) => (
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
                        <Text style={t.pickerRowMeta}>{toDisplayDist(p.distance_miles ?? 0, distUnit)}</Text>
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

function makeRunStyles(C: ColorScheme) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  mapContainer: {
    height: "45%",
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

  drivingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#D97700",
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignSelf: "stretch",
    marginBottom: 8,
  },
  drivingBannerTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: "#fff",
    flex: 1,
  },
  permNudge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#78500A",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignSelf: "stretch",
    marginBottom: 8,
  },
  permNudgeTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: "#FFC542",
    flex: 1,
    lineHeight: 16,
  },
  permNudgeDismiss: {
    padding: 2,
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

  splitChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  splitChipLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: C.textMuted,
  },
  splitChipPace: {
    fontFamily: "Outfit_700Bold",
    fontSize: 12,
    color: C.primary,
  },

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
  },
  summaryCardContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    paddingBottom: 16,
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
  titleEditRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingBottom: 4,
    paddingHorizontal: 4,
    maxWidth: 280,
    alignSelf: "center",
  },
  titleInput: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    color: C.textSecondary,
    flexShrink: 1,
    textAlign: "center",
    minWidth: 60,
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
  prBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignSelf: "stretch",
    marginHorizontal: 4,
  },
  prBannerText: { fontFamily: "Outfit_700Bold", fontSize: 15 },
  statsRow2: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignSelf: "stretch",
    marginHorizontal: 4,
  },
  stat2Block: { alignItems: "center", gap: 4 },
  stat2Val: { fontFamily: "Outfit_600SemiBold", fontSize: 16, color: C.text },
  stat2Label: { fontFamily: "Outfit_400Regular", fontSize: 10, color: C.textMuted },

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
  coachPersonaRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  coachPersonaCard: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
    gap: 2,
  },
  coachPersonaCardActive: {
    backgroundColor: C.primaryMuted,
    borderColor: C.primary,
  },
  coachPersonaName: {
    fontFamily: "Outfit_700Bold",
    fontSize: 14,
    color: C.textSecondary,
  },
  coachPersonaNameActive: {
    color: C.primary,
  },
  coachPersonaBlurb: {
    fontFamily: "Outfit_400Regular",
    fontSize: 10,
    color: C.textMuted,
    textAlign: "center",
    lineHeight: 13,
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
}); }
