import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  ActionSheetIOS,
  TextInput,
  Platform,
  Image,
  Modal,
  Linking,
  Animated,
  Share,
} from "react-native";
import MapView, { Polyline, Marker } from "react-native-maps";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLiveTracking } from "@/contexts/LiveTrackingContext";
import { apiRequest, getApiUrl, apiFetch } from "@/lib/query-client";
import { type ColorScheme } from "@/constants/colors";
import { useTheme } from "@/contexts/ThemeContext";
import { formatDistance } from "@/lib/formatDistance";
import { toDisplayDist, toDisplayDistSmart, toDisplayPace, unitLabel, type DistanceUnit } from "@/lib/units";
import HostProfileSheet from "@/components/HostProfileSheet";
import { resolvePhotoUrl } from "@/lib/photoUrl";
import { formatEventDateFull, formatEventTime } from "@/lib/formatDate";

function haversineKmDetail(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getHostBadge(hostedRuns?: number): { label: string; color: string } | null {
  if (!hostedRuns || hostedRuns < 1) return null;
  if (hostedRuns === 1) return { label: "1st Run", color: "#A0C4FF" };
  if (hostedRuns < 5)   return { label: "Bronze",  color: "#CD7F32" };
  if (hostedRuns < 20)  return { label: "Silver",  color: "#9E9E9E" };
  if (hostedRuns < 100) return { label: "Gold",    color: "#FFD700" };
  if (hostedRuns < 500) return { label: "Platinum", color: "#B0E0E6" };
  return { label: "Elite", color: "#C084FC" };
}

const RUN_TAG_ICONS: Record<string, string> = {
  Talkative: "message-circle",
  Quiet: "moon",
  Motivational: "zap",
  Training: "activity",
  Ministry: "heart",
  Recovery: "wind",
};

function formatPace(pace: number) {
  let mins = Math.floor(pace);
  let secs = Math.round((pace - mins) * 60);
  if (secs === 60) { secs = 0; mins += 1; }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function RunDetailScreen() {
  const { C } = useTheme();
  const styles = useMemo(() => makeStyles(C), [C]);
  const { id, token } = useLocalSearchParams<{ id: string; token?: string }>();
  const insets = useSafeAreaInsets();
  const { user, refreshUser } = useAuth();
  const distUnit: DistanceUnit = ((user as any)?.distance_unit ?? "miles") as DistanceUnit;
  const liveTracking = useLiveTracking();
  const qc = useQueryClient();
  const pillPulse = useRef(new Animated.Value(1)).current;
  const wasLiveRef = useRef(false);
  const joiningRef = useRef(false);
  const [joining, setJoining] = useState(false);
  const [fullToast, setFullToast] = useState(false);
  const [requestingJoin, setRequestingJoin] = useState(false);
  const [joinRequestSent, setJoinRequestSent] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [proximityTriggered, setProximityTriggered] = useState(false);
  const [showPlanInfoModal, setShowPlanInfoModal] = useState(false);
  const [planInfoPage, setPlanInfoPage] = useState(0);
  const [passwordInput, setPasswordInput] = useState("");
  const [tokenInput, setTokenInput] = useState(token || "");
  const [accessError, setAccessError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  const [hostProfileId, setHostProfileId] = useState<string | null>(null);
  const [showEditSheet, setShowEditSheet] = useState(false);
  const [showMessageSheet, setShowMessageSheet] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);
  const [showPaceGroupSheet, setShowPaceGroupSheet] = useState(false);
  const [pendingJoinPaceGroup, setPendingJoinPaceGroup] = useState<string | null>(null);
  const [paceGroupSheetMode, setPaceGroupSheetMode] = useState<"join" | "switch">("join");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editAmPm, setEditAmPm] = useState<"AM" | "PM">("AM");
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLocationName, setEditLocationName] = useState("");
  const [editMinDistance, setEditMinDistance] = useState("");
  const [editMaxDistance, setEditMaxDistance] = useState("");
  const [editMinPace, setEditMinPace] = useState("");
  const [editMaxPace, setEditMaxPace] = useState("");
  const [editMaxParticipants, setEditMaxParticipants] = useState("");
  const [editPaceGroups, setEditPaceGroups] = useState<{ label: string; minPace: string; maxPace: string }[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const [runDeleted, setRunDeleted] = useState(false);

  const { data: run, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/runs", id],
    queryFn: async () => {
      const { getApiUrl } = await import("@/lib/query-client");
      const url = new URL(`/api/runs/${id}`, getApiUrl()).toString();
      const { fetch: expoFetch } = await import("expo/fetch");
      const res = await expoFetch(url, { credentials: "include" });
      if (res.status === 410) {
        setRunDeleted(true);
        return null;
      }
      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return body;
      }
      return res.json();
    },
  });

  async function handleUnlockWithPassword() {
    if (!passwordInput.trim() && !tokenInput.trim()) {
      setAccessError("Enter a password or invite code");
      return;
    }
    setUnlocking(true);
    setAccessError("");
    try {
      const res = await apiRequest("POST", `/api/runs/${id}/join-private`, {
        password: passwordInput.trim() || undefined,
        token: tokenInput.trim() || undefined,
      });
      if (!res.ok) {
        const body = await res.json();
        setAccessError(body.message || "Incorrect password or code");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        refetch();
      }
    } catch {
      setAccessError("Something went wrong. Try again.");
    } finally {
      setUnlocking(false);
    }
  }

  const { data: participants = [] } = useQuery<any[]>({
    queryKey: ["/api/runs", id, "participants"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}/participants`);
      return res.json();
    },
    enabled: !!id,
  });

  const { data: myRating } = useQuery<any>({
    queryKey: ["/api/runs", id, "my-rating"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}/my-rating`);
      return res.json();
    },
    enabled: !!user && !!id,
  });

  const { data: recentDistances } = useQuery<number[]>({
    queryKey: ["/api/users/me/recent-distances"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/users/me/recent-distances");
      return res.json();
    },
    enabled: !!user,
  });

  const { data: runStatus } = useQuery<{ is_bookmarked: boolean; is_planned: boolean }>({
    queryKey: ["/api/runs", id, "status"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}/status`);
      return res.json();
    },
    enabled: !!user && !!id,
  });

  const bookmarkMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/runs/${id}/bookmark`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/runs", id, "status"] });
      qc.invalidateQueries({ queryKey: ["/api/runs/bookmarked"] });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
  });

  const planMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/runs/${id}/plan`),
    onSuccess: async (res) => {
      const body = await res.json();
      if (body.planned) {
        qc.setQueryData<any[]>(["/api/runs/planned"], (old) => {
          if (!old) return run ? [run] : [];
          if (old.some((r: any) => r.id === id)) return old;
          return run ? [...old, run] : old;
        });
      } else {
        qc.setQueryData<any[]>(["/api/runs/planned"], (old) =>
          old ? old.filter((r: any) => r.id !== id) : []
        );
      }
      qc.invalidateQueries({ queryKey: ["/api/runs", id, "status"] });
      qc.invalidateQueries({ queryKey: ["/api/runs", id] });
      qc.invalidateQueries({ queryKey: ["/api/runs/planned"] });
      qc.invalidateQueries({ queryKey: ["/api/runs"] });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
  });

  const isBookmarked = runStatus?.is_bookmarked ?? false;
  const isPlanned = runStatus?.is_planned ?? false;

  const { data: runPhotos = [], refetch: refetchPhotos } = useQuery<any[]>({
    queryKey: ["/api/runs", id, "photos"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}/photos`);
      return res.json();
    },
    enabled: !!id,
  });

  async function uploadPhotoAsset(asset: ImagePicker.ImagePickerAsset) {
    const formData = new FormData();
    formData.append("photo", { uri: asset.uri, type: asset.mimeType || "image/jpeg", name: "photo.jpg" } as any);
    setUploadingPhoto(true);
    try {
      const url = new URL(`/api/runs/${id}/photos`, getApiUrl()).toString();
      const response = await apiFetch(url, { method: "POST", body: formData });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Upload failed");
      }
      await refetchPhotos();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Upload failed", e.message);
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow camera access to take photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    await uploadPhotoAsset(result.assets[0]);
  }

  async function chooseFromLibrary() {
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
    await uploadPhotoAsset(result.assets[0]);
  }

  function pickAndUploadPhoto() {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Take Photo", "Choose from Library"],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) takePhoto();
          else if (buttonIndex === 2) chooseFromLibrary();
        }
      );
    } else {
      Alert.alert(
        "Add Photo",
        "Choose a source",
        [
          { text: "Take Photo", onPress: takePhoto },
          { text: "Choose from Library", onPress: chooseFromLibrary },
          { text: "Cancel", style: "cancel" },
        ],
        { cancelable: true }
      );
    }
  }

  const isHost = run?.host_id === user?.id;
  const myParticipation = participants.find((p) => p.id === user?.id);
  const bestPaceGroup = useMemo(() => {
    if (!run?.pace_groups || !user || (run.pace_groups as any[]).length === 0) return null;
    const userAvgPace = (user as any).avg_pace || 10;
    // For rides, pace groups store mph; compare against user's avg speed in mph
    const userMetric = run?.activity_type === "ride"
      ? (userAvgPace > 0 ? 60 / userAvgPace : 10)
      : userAvgPace;
    const groups = run.pace_groups as any[];
    let best = groups[0];
    let minDiff = Math.abs((groups[0].minPace + groups[0].maxPace) / 2 - userMetric);
    for (const g of groups) {
      const avg = (g.minPace + g.maxPace) / 2;
      const diff = Math.abs(avg - userMetric);
      if (diff < minDiff) {
        minDiff = diff;
        best = g;
      }
    }
    return best;
  }, [run?.pace_groups, run?.activity_type, user]);
  const isParticipant = !!myParticipation && myParticipation.status !== "pending" && myParticipation.status !== "cancelled";
  const hasPendingRequest = !!myParticipation && myParticipation.status === "pending";
  const isPastRun = run ? new Date(run.date) < new Date() : false;
  const isRunStartingSoon = run ? (new Date(run.date).getTime() - Date.now() < 2 * 60 * 60 * 1000) : false;
  const isStillJoinable = run ? (isPastRun && !run.is_completed && new Date(run.date).getTime() > Date.now() - 2 * 60 * 60 * 1000) : false;
  const minutesSinceRun = run ? Math.floor((Date.now() - new Date(run.date).getTime()) / 60000) : 0;
  const canRate = !!run?.is_completed && isParticipant && !isHost && !myRating;
  const hasConfirmed = myParticipation?.status === "confirmed";
  const isLive = !!run?.is_active && !run?.is_completed;
  const isMyTracking =
    liveTracking.runId === id &&
    liveTracking.phase === "active" &&
    liveTracking.isMinimized;

  useEffect(() => {
    if (!isMyTracking) return;
    Animated.loop(
      Animated.sequence([
        Animated.timing(pillPulse, { toValue: 0.35, duration: 800, useNativeDriver: true }),
        Animated.timing(pillPulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
    return () => pillPulse.stopAnimation();
  }, [isMyTracking]);


  // Geo-proximity auto-trigger: show rules modal when non-participant arrives within 1 km
  useEffect(() => {
    if (!user || !run || isHost || isParticipant || run.is_completed || proximityTriggered || Platform.OS === "web") return;
    let sub: any = null;
    Location.getForegroundPermissionsAsync().then(async (perm) => {
      try {
        let granted = perm.granted;
        if (!granted) {
          const req = await Location.requestForegroundPermissionsAsync();
          granted = req.granted;
        }
        if (!granted) return;
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 50 },
          (loc) => {
            const d = haversineKmDetail(loc.coords.latitude, loc.coords.longitude, run.location_lat, run.location_lng);
            if (d <= 0.1524) {
              setProximityTriggered(true);
              setShowRulesModal(true);
              sub?.remove();
            }
          }
        );
      } catch { /* location unavailable */ }
    });
    return () => { sub?.remove(); };
  }, [user?.id, run?.id, isParticipant, isHost, isPastRun, proximityTriggered]);

  // ── Auto-start tracking for participants when host activates the run ──────
  useEffect(() => {
    const nowLive = isLive;
    const justWentLive = nowLive && !wasLiveRef.current;
    wasLiveRef.current = nowLive;
    if (!justWentLive) return;
    if (!user || !id || !run || isHost || !isParticipant) return;
    if (Platform.OS === "web") return;
    if (liveTracking.phase !== "idle" || liveTracking.runId === id) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert(run.activity_type === "ride" ? "Ride started — let's go!" : run.activity_type === "walk" ? "Walk started — let's go!" : "Run started — let's go!");
    liveTracking.startTracking(id, (run.activity_type ?? "run") as "run" | "ride" | "walk");
    liveTracking.minimize();
  }, [isLive]);

  // Poll run state every 15 s for participants so the screen auto-transitions
  // when the host marks the run complete — without needing a manual pull-to-refresh.
  useEffect(() => {
    if (!isParticipant || isHost || run?.is_completed) return;
    const timer = setInterval(() => { refetch(); }, 15_000);
    return () => clearInterval(timer);
  }, [isParticipant, isHost, run?.is_completed, refetch]);

  function handleOpenEdit() {
    if (!run) return;
    const d = new Date(run.date);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(2);
    setEditDate(`${mm}/${dd}/${yy}`);
    const raw24h = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, "0");
    const ap: "AM" | "PM" = raw24h >= 12 ? "PM" : "AM";
    const h12 = raw24h % 12 === 0 ? 12 : raw24h % 12;
    setEditTime(`${h12}:${mins}`);
    setEditAmPm(ap);
    setEditTitle(String(run.title ?? ""));
    setEditDescription(String(run.description ?? ""));
    setEditLocationName(String(run.location_name ?? ""));
    setEditMinDistance(String(run.min_distance ?? ""));
    setEditMaxDistance(String(run.max_distance ?? ""));
    setEditMinPace(String(run.min_pace ?? ""));
    setEditMaxPace(String(run.max_pace ?? ""));
    setEditMaxParticipants(String(run.max_participants ?? ""));
    const pg = Array.isArray(run.pace_groups) ? (run.pace_groups as any[]) : [];
    setEditPaceGroups(pg.map((g) => ({
      label: String(g.label ?? ""),
      minPace: g.minPace != null ? String(g.minPace) : "",
      maxPace: g.maxPace != null ? String(g.maxPace) : "",
    })));
    setShowEditSheet(true);
  }

  function parseDMY(raw: string): Date | null {
    const parts = raw.split("/");
    if (parts.length !== 3) return null;
    const [mo, dy, yr] = parts.map(Number);
    if (isNaN(mo) || isNaN(dy) || isNaN(yr)) return null;
    const year = yr < 100 ? 2000 + yr : yr;
    const d = new Date(year, mo - 1, dy);
    if (d.getMonth() !== mo - 1) return null;
    return d;
  }

  function parseHHMMAMPM(raw: string, ap: "AM" | "PM"): { hours: number; minutes: number } | null {
    const parts = raw.split(":");
    if (parts.length !== 2) return null;
    let hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(minutes) || minutes < 0 || minutes > 59) return null;
    if (hours < 1 || hours > 12) return null;
    if (ap === "AM") { if (hours === 12) hours = 0; }
    else { if (hours !== 12) hours += 12; }
    return { hours, minutes };
  }

  function autoFormatEditTime(digits: string): string {
    if (digits.length <= 1) return digits;
    if (digits.length === 2) return parseInt(digits[0], 10) > 1 ? digits[0] + ":" + digits[1] : digits;
    if (digits.length === 3) return parseInt(digits[0], 10) > 1 ? digits[0] + ":" + digits.slice(1) : digits.slice(0, 2) + ":" + digits[2];
    return parseInt(digits[0], 10) > 1 ? digits[0] + ":" + digits.slice(1, 3) : digits.slice(0, 2) + ":" + digits.slice(2, 4);
  }

  async function handleSaveEdit() {
    if (!editDate.trim() || !editTime.trim()) {
      Alert.alert("Missing info", "Please enter both a date and time.");
      return;
    }
    const parsedDate = parseDMY(editDate.trim());
    if (!parsedDate) { Alert.alert("Invalid format", "Enter date as MM/DD/YY (e.g. 06/15/26)."); return; }
    const parsedTime = parseHHMMAMPM(editTime.trim(), editAmPm);
    if (!parsedTime) { Alert.alert("Invalid format", "Enter time as H:MM (e.g. 7:30)."); return; }
    parsedDate.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
    const parsed = parsedDate;
    if (isNaN(parsed.getTime())) {
      Alert.alert("Invalid format", "Could not parse the date or time.");
      return;
    }
    if (parsed.getTime() < Date.now() - 60_000) {
      Alert.alert("Invalid date", "Event date cannot be in the past.");
      return;
    }
    const title = editTitle.trim();
    if (!title) { Alert.alert("Title required", "Enter a title for the event."); return; }
    const location = editLocationName.trim();
    if (!location) { Alert.alert("Location required", "Enter a location name."); return; }

    const minDistNum = parseFloat(editMinDistance);
    const maxDistNum = parseFloat(editMaxDistance);
    const minPaceNum = parseFloat(editMinPace);
    const maxPaceNum = parseFloat(editMaxPace);
    const maxPartNum = parseInt(editMaxParticipants, 10);
    if (isFinite(minDistNum) && isFinite(maxDistNum) && minDistNum > maxDistNum) {
      Alert.alert("Invalid distance", "Min distance must be ≤ max."); return;
    }
    if (isFinite(minPaceNum) && isFinite(maxPaceNum) && minPaceNum > maxPaceNum) {
      Alert.alert("Invalid pace", "Faster pace must be ≤ slower pace."); return;
    }

    // Validate + serialize pace groups
    let paceGroupsPayload: { label: string; minPace: number; maxPace: number }[] | null | undefined = undefined;
    if (editPaceGroups.length > 0) {
      const cleaned: { label: string; minPace: number; maxPace: number }[] = [];
      for (let i = 0; i < editPaceGroups.length; i++) {
        const g = editPaceGroups[i];
        const label = g.label.trim();
        const mn = parseFloat(g.minPace);
        const mx = parseFloat(g.maxPace);
        if (!label) { Alert.alert("Pace group", `Group ${i + 1} needs a label.`); return; }
        if (!isFinite(mn) || !isFinite(mx)) { Alert.alert("Pace group", `Group "${label}" needs both paces.`); return; }
        if (mn > mx) { Alert.alert("Pace group", `Group "${label}": faster pace must be ≤ slower pace.`); return; }
        cleaned.push({ label, minPace: mn, maxPace: mx });
      }
      paceGroupsPayload = cleaned;
    } else if (Array.isArray((run as any).pace_groups) && (run as any).pace_groups.length > 0) {
      // User cleared all groups → tell server to clear them
      paceGroupsPayload = null;
    }

    setEditSaving(true);
    try {
      await apiRequest("PATCH", `/api/runs/${id}`, {
        date: parsed.toISOString(),
        title,
        description: editDescription.trim() || null,
        locationName: location,
        minDistance: isFinite(minDistNum) ? minDistNum : undefined,
        maxDistance: isFinite(maxDistNum) ? maxDistNum : undefined,
        minPace: isFinite(minPaceNum) ? minPaceNum : undefined,
        maxPace: isFinite(maxPaceNum) ? maxPaceNum : undefined,
        maxParticipants: Number.isInteger(maxPartNum) ? maxPartNum : undefined,
        paceGroups: paceGroupsPayload,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["/api/runs", id] });
      qc.invalidateQueries({ queryKey: ["/api/runs"] });
      setShowEditSheet(false);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not update the run.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setEditSaving(false);
    }
  }

  function handleCancelRun() {
    const label = run?.activity_type === "ride" ? "ride" : run?.activity_type === "walk" ? "walk" : "run";
    const labelCap = label.charAt(0).toUpperCase() + label.slice(1);
    Alert.alert(
      `Cancel ${labelCap}`,
      `Are you sure you want to cancel this ${label}? All participants will be notified and the event will be removed.`,
      [
        { text: "Keep It", style: "cancel" },
        {
          text: `Cancel ${labelCap}`,
          style: "destructive",
          onPress: async () => {
            setCancelling(true);
            try {
              await apiRequest("DELETE", `/api/runs/${id}`);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              qc.invalidateQueries({ queryKey: ["/api/runs"] });
              if (router.canGoBack()) router.back();
              else router.replace("/(tabs)/" as any);
            } catch (e: any) {
              Alert.alert("Error", e.message || "Could not cancel the run.");
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  }

  async function handleBroadcast() {
    const msg = broadcastMsg.trim();
    if (!msg) return;
    setBroadcasting(true);
    try {
      const res = await apiRequest("POST", `/api/runs/${id}/broadcast`, { message: msg });
      setBroadcastMsg("");
      setShowMessageSheet(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const data = await res.json();
      Alert.alert("Sent!", `Your message was delivered to ${data.sent} participant${data.sent !== 1 ? "s" : ""}.`);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not send message.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBroadcasting(false);
    }
  }

  async function doJoin(paceGroupLabel?: string) {
    // If this event has pace groups and no group selected yet, show the picker first.
    // Pre-select the auto-suggested group so the user can confirm with one tap.
    if (!paceGroupLabel && run?.pace_groups && (run.pace_groups as any[]).length > 0) {
      if (!pendingJoinPaceGroup && bestPaceGroup?.label) {
        setPendingJoinPaceGroup(bestPaceGroup.label);
      }
      setPaceGroupSheetMode("join");
      setShowPaceGroupSheet(true);
      return;
    }
    // Double-tap guard: ref is synchronous, state update is not
    if (joiningRef.current) return;
    joiningRef.current = true;
    setJoining(true);
    try {
      const body_payload: Record<string, any> = {};
      if (paceGroupLabel) body_payload.paceGroupLabel = paceGroupLabel;
      await apiRequest("POST", `/api/runs/${id}/join`, body_payload);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["/api/runs", id, "participants"] });
      qc.invalidateQueries({ queryKey: ["/api/runs"] });
      Alert.alert("You're in! 🎉", `You've been added to the live count.\n\nNow tap "Join Live ${run?.activity_type === "ride" ? "Ride" : run?.activity_type === "walk" ? "Walk" : "Run"}" to check in with your host and let them know you're ready.`);
    } catch (e: any) {
      const errMsg = e?.message ?? "";
      if (errMsg.includes("This event is full") || errMsg.includes("Event is full")) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setFullToast(true);
        setTimeout(() => setFullToast(false), 4000);
        return;
      }
      Alert.alert("Can't Join", e.message || `Unable to join ${run?.activity_type === "ride" ? "ride" : run?.activity_type === "walk" ? "walk" : "run"}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      joiningRef.current = false;
      setJoining(false);
    }
  }

  async function doRequestJoin() {
    setRequestingJoin(true);
    try {
      const res = await apiRequest("POST", `/api/runs/${id}/request-join`);
      const body = await res.json();
      if (!res.ok) {
        if (body.message === "already_requested") {
          setJoinRequestSent(true);
          return;
        }
        throw new Error(body.message || "Unable to send request");
      }
      setJoinRequestSent(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Request Failed", e.message || "Could not send join request");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setRequestingJoin(false);
    }
  }

  async function handleLeave() {
    const actLabel = run?.activity_type === "ride" ? "Ride" : run?.activity_type === "walk" ? "Walk" : "Run";
    Alert.alert(`Leave ${actLabel}`, `Are you sure you want to leave this ${actLabel.toLowerCase()}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: async () => {
          try {
            const res = await apiRequest("POST", `/api/runs/${id}/leave`);
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              throw new Error(body.message || "Unable to leave");
            }
            qc.invalidateQueries({ queryKey: ["/api/runs", id, "participants"] });
            qc.invalidateQueries({ queryKey: ["/api/runs"] });
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          } catch (e: any) {
            Alert.alert("Couldn't Leave", e.message || "Something went wrong. You're still in this run.");
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          }
        },
      },
    ]);
  }

  async function handleConfirmComplete() {
    const isActiveTracking =
      liveTracking.runId === id &&
      liveTracking.phase === "active";
    const milesLogged = isActiveTracking
      ? liveTracking.totalDistRef.current
      : (run?.min_distance ?? 0);
    setConfirming(true);
    try {
      await apiRequest("POST", `/api/runs/${id}/complete`, { milesLogged });
      await refreshUser();
      qc.invalidateQueries({ queryKey: ["/api/runs/mine"] });
      qc.invalidateQueries({ queryKey: ["/api/users/me/achievements"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Great job!", "Run logged successfully. Check your achievements!");
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setConfirming(false);
    }
  }

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: C.bg, justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  if (!run) {
    return (
      <View style={[styles.container, { backgroundColor: C.bg, justifyContent: "center", alignItems: "center" }]}>
        <Text style={styles.errorText}>{runDeleted ? "This run was deleted" : "Run not found"}</Text>
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <Text style={styles.backLinkText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  if (run.isPrivate) {
    return (
      <KeyboardAvoidingView behavior="padding" style={[styles.container, { backgroundColor: C.bg, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20, paddingHorizontal: 28 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={C.textSecondary} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16 }}>
          <View style={styles.lockIcon}>
            <Feather name="lock" size={36} color={C.primary} />
          </View>
          <Text style={styles.lockTitle}>Private Run</Text>
          {run.hostName && (
            <Text style={styles.lockHost}>Hosted by {run.hostName}</Text>
          )}
          {run.title && (
            <Text style={styles.lockRunTitle}>{run.title}</Text>
          )}
          <Text style={styles.lockSub}>Enter the invite code or password to access this run.</Text>

          <View style={styles.lockInputGroup}>
            {run.hasPassword && (
              <TextInput
                style={styles.lockInput}
                value={passwordInput}
                onChangeText={setPasswordInput}
                placeholder="Enter password..."
                placeholderTextColor={C.textMuted}
                autoCapitalize="none"
                secureTextEntry={false}
              />
            )}
            <TextInput
              style={styles.lockInput}
              value={tokenInput}
              onChangeText={v => setTokenInput(v.toUpperCase())}
              placeholder="Enter invite code (e.g. ABC123XY)"
              placeholderTextColor={C.textMuted}
              autoCapitalize="characters"
            />
          </View>

          {accessError ? <Text style={styles.lockError}>{accessError}</Text> : null}

          <Pressable
            style={[styles.lockUnlockBtn, { opacity: unlocking ? 0.7 : 1 }]}
            onPress={handleUnlockWithPassword}
            disabled={unlocking}
          >
            {unlocking ? (
              <ActivityIndicator size="small" color={C.text} />
            ) : (
              <>
                <Feather name="unlock" size={18} color={C.text} />
                <Text style={styles.lockUnlockTxt}>Unlock Run</Text>
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: C.bg }]}>
      {fullToast && (
        <View style={styles.fullToast}>
          <Feather name="alert-circle" size={16} color="#FF6B6B" />
          <Text style={styles.fullToastText}>This event is full</Text>
          <Pressable onPress={() => doRequestJoin()} hitSlop={8}>
            <Text style={[styles.fullToastText, { color: C.primary, fontFamily: "Outfit_600SemiBold" }]}>Request to Join</Text>
          </Pressable>
        </View>
      )}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="x" size={20} color={C.text} />
          </Pressable>
          <View style={styles.topBarRight}>
            <View style={[styles.privacyBadge, { backgroundColor: run.privacy === "public" ? C.primaryMuted : C.border }]}>
              <Feather name={run.privacy === "public" ? "globe" : run.privacy === "private" ? "lock" : "user"} size={12} color={run.privacy === "public" ? C.primary : C.textSecondary} />
              <Text style={[styles.privacyText, { color: run.privacy === "public" ? C.primary : C.textSecondary }]}>
                {run.privacy.charAt(0).toUpperCase() + run.privacy.slice(1)}
              </Text>
            </View>
            {user && (
              <Pressable
                style={[styles.bookmarkBtn, isBookmarked && styles.bookmarkBtnActive]}
                onPress={() => bookmarkMutation.mutate()}
                hitSlop={8}
              >
                <Ionicons
                  name={isBookmarked ? "bookmark" : "bookmark-outline"}
                  size={20}
                  color={isBookmarked ? C.primary : C.textSecondary}
                />
              </Pressable>
            )}
            <Pressable
              style={styles.bookmarkBtn}
              hitSlop={8}
              onPress={async () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                const date = run.date ? formatEventDateFull(run.date, run.timezone) : "";
                const loc = run.location_name ? ` at ${run.location_name}` : "";
                const msg = `Join me for ${run.title} on PaceUp!${date ? ` ${date}` : ""}${loc}`;
                try {
                  await Share.share(Platform.OS === "ios" ? { message: msg, url: `paceup://run/${id}` } : { message: `${msg}\npaceup://run/${id}` });
                } catch (e: any) {
                  if (!e.message?.includes("cancel")) console.warn("Share failed:", e.message);
                }
              }}
            >
              <Feather name="share-2" size={18} color={C.textSecondary} />
            </Pressable>
          </View>
        </View>

        <Text style={styles.heroDateLabel}>
          {formatEventDateFull(run.date, run.timezone)} · {formatEventTime(run.date, run.timezone)}
        </Text>
        <Text style={styles.title} numberOfLines={3} ellipsizeMode="tail">{run.title}</Text>

        {/* T2.2 Mode B: stages preview — chain multi-sport events */}
        {Array.isArray((run as any).stages) && (run as any).stages.length >= 2 && (
          <View style={styles.stagesPreview}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <Feather name="git-branch" size={13} color={C.primary} />
              <Text style={styles.stagesPreviewLabel}>STAGES</Text>
              <Text style={styles.stagesPreviewSub}>· {(run as any).stages.length} legs</Text>
            </View>
            {(run as any).stages.map((stage: any, idx: number) => {
              const isRide = stage.activityType === "ride";
              const isWalk = stage.activityType === "walk";
              const actLabel = isRide ? "Ride" : isWalk ? "Walk" : "Run";
              return (
                <View key={idx} style={styles.stagesPreviewRow}>
                  <View style={styles.stagesPreviewBadge}>
                    <Text style={styles.stagesPreviewBadgeTxt}>{idx + 1}</Text>
                  </View>
                  {isRide ? <Ionicons name="bicycle" size={14} color={C.primary} /> :
                   isWalk ? <Ionicons name="footsteps" size={14} color={C.primary} /> :
                   <MaterialCommunityIcons name="run-fast" size={14} color={C.primary} />}
                  <Text style={styles.stagesPreviewActivity}>{actLabel}</Text>
                  {stage.distanceMiles ? (
                    <Text style={styles.stagesPreviewDist}>· {toDisplayDistSmart(stage.distanceMiles, distUnit)}</Text>
                  ) : null}
                  {stage.minPace && stage.maxPace ? (
                    <Text style={styles.stagesPreviewPace} numberOfLines={1}>
                      · {isRide ? `${stage.minPace}–${stage.maxPace} mph` : `${stage.minPace}–${stage.maxPace} /mi`}
                    </Text>
                  ) : null}
                  {idx < (run as any).stages.length - 1 && (
                    <Feather name="chevron-down" size={11} color={C.textMuted} style={{ marginLeft: "auto" }} />
                  )}
                </View>
              );
            })}
          </View>
        )}

        <Pressable
          style={styles.heroLocationRow}
          onPress={() => {
            const lat = run.location_lat;
            const lng = run.location_lng;
            const label = encodeURIComponent(run.location_name);
            const url = Platform.select({
              ios: `maps://maps.apple.com/?ll=${lat},${lng}&q=${label}`,
              android: `geo:${lat},${lng}?q=${label}`,
              default: `https://www.google.com/maps?q=${lat},${lng}`,
            });
            if (url) Linking.openURL(url).catch(() => {});
          }}
        >
          <Feather name="map-pin" size={14} color={C.textMuted} />
          <Text style={styles.heroLocationTxt} numberOfLines={1}>{run.location_name}</Text>
        </Pressable>

        {/* Mini map of the event location */}
        {Platform.OS !== "web" && run.location_lat != null && run.location_lng != null && (
          <Pressable
            style={styles.locationMapCard}
            onPress={() => {
              const lat = run.location_lat;
              const lng = run.location_lng;
              const label = encodeURIComponent(run.location_name);
              const url = Platform.select({
                ios: `maps://maps.apple.com/?ll=${lat},${lng}&q=${label}`,
                android: `geo:${lat},${lng}?q=${label}`,
                default: `https://www.google.com/maps?q=${lat},${lng}`,
              });
              if (url) Linking.openURL(url).catch(() => {});
            }}
          >
            <MapView
              style={StyleSheet.absoluteFill}
              initialRegion={{
                latitude: run.location_lat,
                longitude: run.location_lng,
                latitudeDelta: 0.012,
                longitudeDelta: 0.012,
              }}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              pointerEvents="none"
            >
              <Marker coordinate={{ latitude: run.location_lat, longitude: run.location_lng }}>
                <View style={styles.locationMapPin}>
                  <Feather name="map-pin" size={16} color={C.bg} />
                </View>
              </Marker>
            </MapView>
            <View style={styles.locationMapOpenHint}>
              <Feather name="external-link" size={12} color={C.text} />
              <Text style={styles.locationMapOpenHintTxt}>Open in Maps</Text>
            </View>
          </Pressable>
        )}

        {isStillJoinable && (
          <View style={styles.stillJoinableRow}>
            <Feather name="clock" size={13} color="#F5A623" />
            <Text style={styles.stillJoinableTxt}>
              {isLive
                ? `Started ${minutesSinceRun < 60 ? `${minutesSinceRun}m` : `${Math.floor(minutesSinceRun / 60)}h ${minutesSinceRun % 60}m`} ago · Live`
                : `Still joinable`}
            </Text>
          </View>
        )}

        <Pressable
          style={({ pressed }) => [styles.hostCard, { opacity: pressed ? 0.8 : 1 }]}
          onPress={() => !isHost && setHostProfileId(run.host_id)}
        >
          {run.host_photo ? (
            <Image source={{ uri: run.host_photo }} style={[styles.hostAvatar, { borderWidth: 0 }]} />
          ) : (
            <View style={styles.hostAvatar}>
              <Text style={styles.hostAvatarText}>{run.host_name?.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.hostInfo}>
            <Text style={styles.hostedByLabel}>HOSTED BY</Text>
            <Text style={styles.hostName}>{run.host_name}</Text>
            <View style={styles.hostMeta}>
              {(run.host_rating_count ?? 0) >= 5 && (run.host_rating ?? 0) >= 4.5 && (
                <View style={styles.topRatedChip}>
                  <Text style={styles.topRatedChipTxt}>⭐ Top Rated</Text>
                </View>
              )}
              {(() => { const b = getHostBadge(run.host_hosted_runs); return b ? <Text style={[styles.hostBadgeText, { color: b.color }]}>{b.label}</Text> : null; })()}
            </View>
            <Text style={styles.hostPlannedDist}>{toDisplayDistSmart(run.min_distance, distUnit)} planned</Text>
          </View>
          {isHost && (
            <View style={styles.yourRunBadge}>
              <Text style={styles.yourRunText}>Your {run?.activity_type === "ride" ? "Ride" : run?.activity_type === "walk" ? "Walk" : "Run"}</Text>
            </View>
          )}
          {!isHost && (
            <Feather name="chevron-right" size={16} color={C.textMuted} />
          )}
        </Pressable>

        {/* Date + location moved to hero above; infoGrid removed to adopt mock layout */}

        <View style={styles.requirementsCard}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <Text style={styles.requirementsTitle}>Plan</Text>
            {run.is_strict && (
              <View style={{ backgroundColor: C.orange + "22", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: C.orange + "55" }}>
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: C.orange }}>Strict</Text>
              </View>
            )}
          </View>
          <View style={styles.requirementsGrid}>
            <View style={styles.reqItem}>
              <Ionicons name={run.activity_type === "ride" ? "bicycle" : run.activity_type === "walk" ? "footsteps" : "body"} size={20} color={C.orange} />
              <Text style={styles.reqValue}>
                {run.activity_type === "ride"
                  ? (run.min_pace === run.max_pace ? `${(60 / run.min_pace).toFixed(1)}` : `${(60 / run.max_pace).toFixed(1)}–${(60 / run.min_pace).toFixed(1)}`)
                  : (run.min_pace === run.max_pace ? toDisplayPace(run.min_pace, distUnit) : `${toDisplayPace(run.min_pace, distUnit)} – ${toDisplayPace(run.max_pace, distUnit)}`)}
              </Text>
              <Text style={styles.reqLabel}>{run.activity_type === "ride" ? "Speed (mph)" : `Pace (min/${unitLabel(distUnit)})`}</Text>
            </View>
            <View style={styles.reqDivider} />
            <View style={styles.reqItem}>
              <Feather name="target" size={20} color={C.blue} />
              <Text style={styles.reqValue}>{(!run.min_distance || run.min_distance === run.max_distance) ? toDisplayDistSmart(run.max_distance, distUnit) : `${toDisplayDist(run.min_distance, distUnit)} – ${toDisplayDist(run.max_distance, distUnit)}`}</Text>
              <Text style={styles.reqLabel}>{`Distance (${unitLabel(distUnit)})`}</Text>
            </View>
            <View style={styles.reqDivider} />
            <View style={styles.reqItem}>
              <Ionicons name="people" size={20} color={C.textSecondary} />
              {run.crew_id ? (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Text style={styles.reqValue}>{run.participant_count ?? 1}</Text>
                    {parseInt(run.plan_count) > 0 && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: C.card, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}>
                        <Feather name="calendar" size={10} color={C.textMuted} />
                        <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.textMuted }}>{run.plan_count}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.reqLabel}>Coming</Text>
                </>
              ) : (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Text style={styles.reqValue}>
                      {run.crew_id || (run.max_participants ?? 0) >= 9999
                        ? `${run.participant_count ?? 1} going`
                        : `${run.participant_count ?? 1}/${run.max_participants}`}
                    </Text>
                    {parseInt(run.plan_count) > 0 && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: C.card, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}>
                        <Feather name="calendar" size={10} color={C.textMuted} />
                        <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.textMuted }}>{run.plan_count}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.reqLabel}>Participants</Text>
                </>
              )}
            </View>
          </View>
          {user && run.is_strict && (() => {
            const hasHistory = (recentDistances ?? []).length > 0;
            if (!hasHistory) {
              return (
                <View style={[styles.eligibilityRow, { backgroundColor: C.primaryMuted, borderColor: C.primary + "44" }]}>
                  <Feather name="check-circle" size={14} color={C.primary} />
                  <Text style={[styles.eligibilityText, { color: C.primary }]}>No history yet — you can still join this {run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run"}</Text>
                </View>
              );
            }
            const isRideEvent = run.activity_type === "ride";
            // For rides, min/max pace are stored as mph; convert user avg_pace to mph for comparison
            const userSpeedMph = user.avg_pace > 0 ? 60 / user.avg_pace : 0;
            const paceOk = isRideEvent
              ? (userSpeedMph >= run.min_pace && userSpeedMph <= run.max_pace)
              : (user.avg_pace >= run.min_pace && user.avg_pace <= run.max_pace);
            const distOk = (recentDistances ?? []).some((d) => d >= run.min_distance * 0.7);
            const eligible = paceOk && distOk;
            let msg = "";
            if (eligible) msg = isRideEvent ? "Speed and distance both qualify" : "Pace and distance both qualify";
            else if (!paceOk && !distOk) msg = isRideEvent ? "Speed and distance both fall short" : "Pace and distance both fall short";
            else if (!paceOk) msg = isRideEvent
              ? `Your avg speed (${userSpeedMph > 0 ? userSpeedMph.toFixed(1) : "–"} mph) doesn't match this ride`
              : `Your pace (${toDisplayPace(user.avg_pace, distUnit)}) doesn't match this run`;
            else msg = `No recent ${isRideEvent ? "ride" : "run"} covers 70%+ of the planned ${toDisplayDist(run.min_distance, distUnit)}`;
            return (
              <View style={[styles.eligibilityRow, {
                backgroundColor: eligible ? C.primaryMuted : C.danger + "22",
                borderColor: eligible ? C.primary + "44" : C.danger + "44",
              }]}>
                <Feather
                  name={eligible ? "check-circle" : "alert-circle"}
                  size={14}
                  color={eligible ? C.primary : C.danger}
                />
                <Text style={[styles.eligibilityText, { color: eligible ? C.primary : C.danger }]}>
                  {msg}
                </Text>
              </View>
            );
          })()}
        </View>

        {run.saved_path_route && Array.isArray(run.saved_path_route) && run.saved_path_route.length > 1 && (() => {
          const coords = run.saved_path_route.map((pt: any) => ({ latitude: pt.lat ?? pt.latitude, longitude: pt.lng ?? pt.longitude }));
          const lats = coords.map((c: any) => c.latitude);
          const lngs = coords.map((c: any) => c.longitude);
          const minLat = Math.min(...lats), maxLat = Math.max(...lats);
          const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
          const midLat = (minLat + maxLat) / 2;
          const midLng = (minLng + maxLng) / 2;
          const latDelta = Math.max(maxLat - minLat, 0.005) * 1.3;
          const lngDelta = Math.max(maxLng - minLng, 0.005) * 1.3;
          return (
            <Pressable
              style={styles.routeCard}
              onPress={() => {
                const lat = run.location_lat;
                const lng = run.location_lng;
                const label = encodeURIComponent(run.saved_path_name || run.location_name);
                const url = Platform.select({
                  ios: `maps://maps.apple.com/?ll=${lat},${lng}&q=${label}`,
                  android: `geo:${lat},${lng}?q=${label}`,
                  default: `https://www.google.com/maps?q=${lat},${lng}`,
                });
                if (url) Linking.openURL(url).catch(() => {});
              }}
            >
              <View style={styles.routeCardHeader}>
                <Feather name="map" size={14} color={C.primary} />
                <Text style={styles.routeCardName} numberOfLines={1}>
                  {run.saved_path_name || "Saved Route"}
                </Text>
                <Feather name="external-link" size={12} color={C.textMuted} />
              </View>
              {Platform.OS !== "web" ? (
                <MapView
                  style={styles.routeMap}
                  initialRegion={{ latitude: midLat, longitude: midLng, latitudeDelta: latDelta, longitudeDelta: lngDelta }}
                  scrollEnabled={false}
                  zoomEnabled={false}
                  rotateEnabled={false}
                  pitchEnabled={false}
                  pointerEvents="none"
                >
                  <Polyline coordinates={coords} strokeColor={C.primary} strokeWidth={3} />
                </MapView>
              ) : (
                <View style={[styles.routeMap, { backgroundColor: C.card, alignItems: "center", justifyContent: "center" }]}>
                  <Feather name="map" size={24} color={C.textMuted} />
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, marginTop: 4 }}>View on map</Text>
                </View>
              )}
            </Pressable>
          );
        })()}

        {run.description ? (
          <View style={styles.descCard}>
            <Text style={styles.descTitle}>{run.activity_type === "ride" ? "About this ride" : run.activity_type === "walk" ? "About this walk" : "About this run"}</Text>
            <Text style={styles.descText}>{run.description}</Text>
          </View>
        ) : null}

        {run.run_style && (
          <View style={styles.tagsSection}>
            <Text style={styles.sectionTitle}>{run.activity_type === "ride" ? "Ride Style" : run.activity_type === "walk" ? "Walk Style" : "Run Style"}</Text>
            <View style={styles.runStyleBadgeRow}>
              <View style={styles.runStyleBadge}>
                <Feather name="activity" size={14} color={C.bg} />
                <Text style={styles.runStyleBadgeText}>{run.run_style}</Text>
              </View>
            </View>
          </View>
        )}

        {run.tags?.length > 0 && (
          <View style={styles.tagsSection}>
            <Text style={styles.sectionTitle}>Group Vibe</Text>
            <View style={styles.tagsGrid}>
              {run.tags.map((tag: string) => (
                <View key={tag} style={styles.tagChip}>
                  <Feather name={RUN_TAG_ICONS[tag] as any || "tag"} size={13} color={C.primary} />
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {(() => {
          const joinedParticipants = participants.filter((p: any) => p.status !== "pending" && p.status !== "cancelled");
          const pendingParticipants = participants.filter((p: any) => p.status === "pending");
          return (
            <>
              {/* Switch-group pill — visible only to participants in pace-group events. */}
              {(() => {
                const hasPaceGroups = run?.pace_groups && (run.pace_groups as any[]).length > 0;
                if (!hasPaceGroups || !isParticipant || isPastRun || run?.is_active) return null;
                const myLabel = (myParticipation as any)?.pace_group_label;
                return (
                  <View style={{ paddingHorizontal: 16, marginTop: 4, marginBottom: 8 }}>
                    <Pressable
                      onPress={() => {
                        setPendingJoinPaceGroup(myLabel ?? bestPaceGroup?.label ?? null);
                        setPaceGroupSheetMode("switch");
                        setShowPaceGroupSheet(true);
                      }}
                      style={{
                        flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
                        backgroundColor: C.primaryMuted, borderWidth: 1, borderColor: C.primary + "55",
                        borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
                      }}
                    >
                      <Feather name="repeat" size={13} color={C.primary} />
                      <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 13, color: C.primary }}>
                        {myLabel ? `Switch from ${myLabel}` : `Pick your ${run?.activity_type === "ride" ? "speed" : "pace"} group`}
                      </Text>
                    </Pressable>
                  </View>
                );
              })()}

              {joinedParticipants.length > 0 && (() => {
                const hasPaceGroups = run?.pace_groups && (run.pace_groups as any[]).length > 0;
                const hasAnyGroupLabel = joinedParticipants.some((p: any) => p.pace_group_label);

                const renderParticipant = (p: any) => (
                  <Pressable
                    key={p.id}
                    style={({ pressed }) => [styles.participantItem, { opacity: pressed ? 0.8 : 1 }]}
                    onPress={() => setHostProfileId(p.id)}
                  >
                    {p.photo_url ? (
                      <Image source={{ uri: p.photo_url }} style={styles.participantAvatarImg} />
                    ) : (
                      <View style={styles.participantAvatar}>
                        <Text style={styles.participantAvatarText}>{p.name?.charAt(0).toUpperCase()}</Text>
                      </View>
                    )}
                    <View style={styles.participantInfo}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Text style={styles.participantName}>{p.name}</Text>
                        {p.reliability_slug === "reliable_90" && <Text style={{ fontSize: 13 }}>⭐</Text>}
                        {p.reliability_slug === "reliable_80" && <Text style={{ fontSize: 13 }}>🟢</Text>}
                        {p.reliability_slug === "reliable_65" && <Text style={{ fontSize: 13 }}>🔵</Text>}
                        {p.reliability_slug === "reliable_50" && <Text style={{ fontSize: 13 }}>🟡</Text>}
                      </View>
                      <Text style={styles.participantPace}>{toDisplayPace(p.avg_pace, distUnit)} · {toDisplayDist(p.avg_distance, distUnit)} avg</Text>
                    </View>
                    <View style={[styles.participantStatus, { backgroundColor: p.status === "confirmed" ? C.primary + "22" : C.border }]}>
                      <Text style={[styles.participantStatusText, { color: p.status === "confirmed" ? C.primary : C.textMuted }]}>
                        {p.status === "confirmed" ? "Done" : "Joined"}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={14} color={C.textMuted} />
                  </Pressable>
                );

                if (hasPaceGroups && hasAnyGroupLabel) {
                  // Group participants by their pace_group_label
                  const groups: Record<string, any[]> = {};
                  const ungrouped: any[] = [];
                  for (const p of joinedParticipants.slice(0, 24)) {
                    if (p.pace_group_label) {
                      if (!groups[p.pace_group_label]) groups[p.pace_group_label] = [];
                      groups[p.pace_group_label].push(p);
                    } else {
                      ungrouped.push(p);
                    }
                  }
                  const paceGroupDefs = run.pace_groups as any[];
                  const orderedLabels = [
                    ...paceGroupDefs.map((g: any) => g.label).filter((l: string) => groups[l]),
                    ...Object.keys(groups).filter((l) => !paceGroupDefs.find((g: any) => g.label === l)),
                  ];

                  return (
                    <View style={styles.participantsSection}>
                      <Text style={styles.sectionTitle}>Participants ({run.participant_count ?? 1})</Text>
                      {orderedLabels.map((label) => {
                        const groupDef = paceGroupDefs.find((g: any) => g.label === label);
                        return (
                          <View key={label} style={{ marginBottom: 12 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                              <View style={{ backgroundColor: C.primaryMuted, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: C.primary + "44" }}>
                                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 13, color: C.primary }}>{label}</Text>
                              </View>
                              {groupDef && (
                                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted }}>
                                  {groupDef.minPace}–{groupDef.maxPace} {run?.activity_type === "ride" ? "mph" : "min/mi"}
                                </Text>
                              )}
                              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted }}>
                                · {groups[label].length} {run?.activity_type === "ride" ? "rider" : run?.activity_type === "walk" ? "walker" : "runner"}{groups[label].length !== 1 ? "s" : ""}
                              </Text>
                            </View>
                            <View style={styles.participantsList}>
                              {groups[label].map(renderParticipant)}
                            </View>
                          </View>
                        );
                      })}
                      {ungrouped.length > 0 && (
                        <View style={{ marginBottom: 12 }}>
                          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textMuted, marginBottom: 6 }}>No group assigned</Text>
                          <View style={styles.participantsList}>{ungrouped.map(renderParticipant)}</View>
                        </View>
                      )}
                    </View>
                  );
                }

                return (
                  <View style={styles.participantsSection}>
                    <Text style={styles.sectionTitle}>Participants ({run.participant_count ?? 1})</Text>
                    <View style={styles.participantsList}>
                      {joinedParticipants.slice(0, 8).map(renderParticipant)}
                    </View>
                  </View>
                );
              })()}
              {isHost && pendingParticipants.length > 0 && (
                <View style={styles.participantsSection}>
                  <Text style={styles.sectionTitle}>Join Requests ({pendingParticipants.length})</Text>
                  <View style={styles.participantsList}>
                    {pendingParticipants.map((p: any) => (
                      <View key={p.id} style={styles.joinRequestRow}>
                        {p.photo_url ? (
                          <Image source={{ uri: p.photo_url }} style={styles.participantAvatarImg} />
                        ) : (
                          <View style={styles.participantAvatar}>
                            <Text style={styles.participantAvatarText}>{p.name?.charAt(0).toUpperCase()}</Text>
                          </View>
                        )}
                        <View style={styles.participantInfo}>
                          <Text style={styles.participantName}>{p.name}</Text>
                          <Text style={styles.participantPace}>{toDisplayPace(p.avg_pace, distUnit)} avg</Text>
                        </View>
                        <Pressable
                          style={styles.joinRequestDeny}
                          onPress={async () => {
                            try {
                              await apiRequest("POST", "/api/runs/requests/respond", { participantId: p.participation_id ?? p.participant_id ?? p.rp_id, action: "deny", runId: id });
                              qc.invalidateQueries({ queryKey: ["/api/runs", id, "participants"] });
                            } catch {
                              Alert.alert("Error", "Could not deny the request. Please try again.");
                            }
                          }}
                        >
                          <Text style={styles.joinRequestDenyTxt}>Deny</Text>
                        </Pressable>
                        <Pressable
                          style={styles.joinRequestApprove}
                          onPress={async () => {
                            try {
                              await apiRequest("POST", "/api/runs/requests/respond", { participantId: p.participation_id ?? p.participant_id ?? p.rp_id, action: "approve", runId: id });
                              qc.invalidateQueries({ queryKey: ["/api/runs", id, "participants"] });
                              qc.invalidateQueries({ queryKey: ["/api/runs", id] });
                            } catch {
                              Alert.alert("Error", "Could not approve the request. Please try again.");
                            }
                          }}
                        >
                          <Text style={styles.joinRequestApproveTxt}>Approve</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </>
          );
        })()}

        {/* ─── Run Photos ──────────────────────────────────────────────────── */}
        {isPastRun && (
          <View style={styles.photosSection}>
            <View style={styles.photosSectionHeader}>
              <Text style={styles.sectionTitle}>
                {run?.activity_type === "ride" ? "Ride" : run?.activity_type === "walk" ? "Walk" : "Run"} Photos {runPhotos.length > 0 ? `(${runPhotos.length})` : ""}
              </Text>
              {(isHost || isParticipant) && (
                <Pressable
                  style={[styles.addPhotoBtn, uploadingPhoto && { opacity: 0.6 }]}
                  onPress={pickAndUploadPhoto}
                  disabled={uploadingPhoto}
                >
                  {uploadingPhoto ? (
                    <ActivityIndicator color={C.primary} size="small" />
                  ) : (
                    <>
                      <Feather name="camera" size={14} color={C.primary} />
                      <Text style={styles.addPhotoBtnTxt}>Add</Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
            {runPhotos.length === 0 ? (
              <View style={styles.photosEmpty}>
                <Feather name="image" size={22} color={C.textMuted} />
                <Text style={styles.photosEmptyTxt}>No photos yet</Text>
                {(isHost || isParticipant) && (
                  <Text style={styles.photosEmptyHint}>Be the first to add a photo from this run</Text>
                )}
              </View>
            ) : (
              <View style={styles.photosGrid}>
                {runPhotos.map((p: any) => (
                  <Pressable key={p.id} onPress={() => setViewingPhoto(resolvePhotoUrl(p.photo_url))}>
                    <Image source={{ uri: resolvePhotoUrl(p.photo_url) }} style={styles.photoGridImg} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <HostProfileSheet hostId={hostProfileId} onClose={() => setHostProfileId(null)} />

      {/* ─── Full-screen photo viewer ─────────────────────────────────────── */}
      {viewingPhoto && (
        <Pressable style={styles.photoViewer} onPress={() => setViewingPhoto(null)}>
          <Image source={{ uri: viewingPhoto }} style={styles.photoViewerImg} resizeMode="contain" />
          <Pressable style={[styles.photoViewerClose, { top: insets.top + 16 }]} onPress={() => setViewingPhoto(null)}>
            <Feather name="x" size={22} color="#fff" />
          </Pressable>
        </Pressable>
      )}

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        {isHost && !run.is_completed && (
          <>
            {(
              <View style={styles.hostMgmtRow}>
                <Pressable
                  style={({ pressed }) => [styles.hostMgmtBtn, { opacity: pressed ? 0.75 : 1 }]}
                  onPress={handleOpenEdit}
                  testID="edit-run-btn"
                >
                  <Feather name="edit-2" size={15} color={C.textSecondary} />
                  <Text style={styles.hostMgmtTxt}>Edit Event</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.hostMgmtBtn, { opacity: pressed ? 0.75 : 1, borderColor: C.primary + "55", backgroundColor: C.primaryMuted }]}
                  onPress={() => { setBroadcastMsg(""); setShowMessageSheet(true); Haptics.selectionAsync(); }}
                  testID="message-participants-btn"
                >
                  <Feather name="message-circle" size={15} color={C.primary} />
                  <Text style={[styles.hostMgmtTxt, { color: C.primary }]}>Message All</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.hostMgmtBtn, styles.hostMgmtDangerBtn, { opacity: pressed || cancelling ? 0.75 : 1 }]}
                  onPress={handleCancelRun}
                  disabled={cancelling}
                  testID="cancel-run-btn"
                >
                  {cancelling ? <ActivityIndicator size="small" color={C.danger} /> : (
                    <>
                      <Feather name="x-circle" size={15} color={C.danger} />
                      <Text style={styles.hostMgmtDangerTxt}>Cancel {run?.activity_type === "ride" ? "Ride" : run?.activity_type === "walk" ? "Walk" : "Run"}</Text>
                    </>
                  )}
                </Pressable>
              </View>
            )}
            <Pressable
              style={({ pressed }) => [styles.liveBtn, { opacity: pressed ? 0.85 : 1 }]}
              onPress={() => router.push(`/run-live/${id}`)}
            >
              {isLive && <View style={styles.liveDot} />}
              <Feather name={isLive ? "radio" : "play-circle"} size={18} color="#fff" />
              <Text style={styles.liveBtnText}>
                {isLive
                  ? (run?.activity_type === "ride" ? "Ready to Ride" : run?.activity_type === "walk" ? "Ready to Walk" : "Ready to Run")
                  : (run?.activity_type === "ride" ? "Host Ride" : run?.activity_type === "walk" ? "Host Walk" : "Host Run")}
              </Text>
            </Pressable>
          </>
        )}
        {!isHost && isLive && isParticipant && !run.is_completed && (
          <Pressable
            style={({ pressed }) => [styles.liveBtn, { opacity: pressed ? 0.85 : 1 }]}
            onPress={() => router.push(`/run-live/${id}`)}
          >
            <View style={styles.liveDot} />
            <Text style={styles.liveBtnText}>{run?.activity_type === "ride" ? "Join Live Ride" : run?.activity_type === "walk" ? "Join Live Walk" : "Join Live Run"}</Text>
          </Pressable>
        )}
        {!isHost && !isLive && isParticipant && !run.is_completed && (isRunStartingSoon || proximityTriggered) && (
          <View style={styles.waitingBanner}>
            <Feather name="clock" size={15} color={C.gold} />
            <Text style={styles.waitingText}>Waiting on host to start</Text>
          </View>
        )}
        {!isHost && !isLive && isParticipant && !run.is_completed && !isRunStartingSoon && !proximityTriggered && (
          <View style={styles.youreGoingBanner}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
              <Feather name="check-circle" size={15} color={C.primary} />
              <Text style={styles.youreGoingText}>You're going{run?.activity_type === "ride" ? " for a ride" : run?.activity_type === "walk" ? " for a walk" : " for a run"}</Text>
            </View>
            <Pressable onPress={handleLeave} hitSlop={10}>
              <Text style={styles.youreGoingLeave}>Leave</Text>
            </Pressable>
          </View>
        )}
        {isPastRun && isParticipant && !hasConfirmed && (
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, { opacity: pressed || confirming ? 0.85 : 1 }]}
            onPress={handleConfirmComplete}
            disabled={confirming}
          >
            {confirming ? <ActivityIndicator color={C.text} /> : (
              <>
                <Feather name="check-circle" size={18} color={C.text} />
                <Text style={styles.primaryBtnText}>Log Completion</Text>
              </>
            )}
          </Pressable>
        )}
        {canRate && !myRating && (
          <View>
            <Text style={styles.ratePrompt}>How was the host?</Text>
            <Pressable
              style={({ pressed }) => [styles.rateBtn, { opacity: pressed ? 0.8 : 1 }]}
              onPress={() => router.push(`/rate/${id}`)}
            >
              <Ionicons name="star-outline" size={18} color={C.gold} />
              <Text style={styles.rateBtnText}>Rate Host</Text>
            </Pressable>
          </View>
        )}
        {myRating && (
          <View style={styles.ratedBanner}>
            <Ionicons name="star" size={14} color={C.gold} />
            <Text style={styles.ratedText}>You rated this host {myRating.stars}/5</Text>
          </View>
        )}
        {!isHost && !isParticipant && user && (() => {
          // Joinable while: not deleted, not completed. Past the planned time
          // is fine — the host may still be running late. Once the late-start
          // monitor auto-removes the event, is_deleted flips and we land here.
          const notJoinable = run.is_deleted || run.is_completed;
          if (notJoinable) {
            const label = run.is_deleted ? "Event Cancelled" : "Event Ended";
            return (
              <View style={[styles.primaryBtn, { opacity: 0.45 }]} pointerEvents="none">
                <Ionicons name="calendar-outline" size={18} color={C.text} />
                <Text style={styles.primaryBtnText}>{label}</Text>
              </View>
            );
          }
          return (
            <Pressable
              style={({ pressed }) => [
                isPlanned ? [styles.planBtn, styles.planBtnActive] : styles.primaryBtn,
                { opacity: pressed || planMutation.isPending ? 0.8 : 1 },
              ]}
              onPress={() => {
                if (isPlanned) {
                  planMutation.mutate();
                } else {
                  setPlanInfoPage(0);
                  setShowPlanInfoModal(true);
                }
              }}
              disabled={planMutation.isPending}
            >
              {planMutation.isPending ? <ActivityIndicator color={isPlanned ? C.primary : C.text} /> : (
                <>
                  <Ionicons
                    name={isPlanned ? "calendar" : "calendar-outline"}
                    size={18}
                    color={isPlanned ? C.primary : C.text}
                  />
                  <Text style={isPlanned ? [styles.planBtnText, styles.planBtnTextActive] : styles.primaryBtnText}>
                    {isPlanned ? "I'm Not Coming" : run?.activity_type === "ride" ? "I Plan To Ride" : run?.activity_type === "walk" ? "I Plan To Walk" : "I Plan To Run"}
                  </Text>
                </>
              )}
            </Pressable>
          );
        })()}
        {isParticipant && !run.is_completed && isLive && (
          <View style={styles.joinedBanner}>
            <Feather name="map-pin" size={14} color={C.primary} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.joinedText}>You've arrived — you're in the live count</Text>
              <Text style={styles.joinedHint}>
                Tap {run?.activity_type === "ride" ? "Join Live Ride" : run?.activity_type === "walk" ? "Join Live Walk" : "Join Live Run"} above to check in with your host
              </Text>
            </View>
          </View>
        )}
        {(hasPendingRequest || joinRequestSent) && !run.is_completed && (
          <View style={styles.pendingRequestBanner}>
            <Feather name="clock" size={14} color={C.gold} />
            <Text style={styles.pendingRequestText}>Request pending — the host will be notified</Text>
          </View>
        )}
      </View>

      {/* ── Plan info modal (How It Works) ───────────────────────────────── */}
      {showPlanInfoModal && (
        <Modal transparent animationType="slide" onRequestClose={() => setShowPlanInfoModal(false)}>
          <View style={styles.frModalWrap}>
            <Pressable style={styles.frOverlay} onPress={() => setShowPlanInfoModal(false)} />
            <View style={[styles.frSheet, { paddingBottom: insets.bottom + 24 }]}>
              <View style={styles.frHandle} />

              {planInfoPage === 0 ? (
                <>
                  <View style={styles.frHeader}>
                    <Text style={styles.frTitle}>
                      {run?.activity_type === "ride" ? "How Riding Works" : run?.activity_type === "walk" ? "How Walking Works" : "How Running Works"}
                    </Text>
                    <Pressable onPress={() => setShowPlanInfoModal(false)} hitSlop={12}>
                      <Feather name="x" size={18} color={C.textSecondary} />
                    </Pressable>
                  </View>
                  <Text style={styles.frIntro}>
                    {run?.activity_type === "ride"
                      ? "Here's what happens after you tap 'I Plan To Ride'."
                      : "Here's what happens after you tap 'I Plan To Run'."}
                  </Text>
                  {[
                    {
                      icon: "calendar" as const,
                      title: "Let the host know you're coming",
                      body: "Tapping lets the host see you plan on joining. No commitment — you can cancel any time.",
                    },
                    {
                      icon: "map-pin" as const,
                      title: "Head to the start",
                      body: "On the day, make your way to the start pin shown on the map.",
                    },
                    {
                      icon: "clock" as const,
                      title: "Arrive within the window",
                      body: "Check-in opens 1 hour before start. Show up close to the pin and you'll be added automatically.",
                    },
                    {
                      icon: "users" as const,
                      title: "Go with the group",
                      body: run?.activity_type === "ride"
                        ? "Once checked in, you're live. Ride together and enjoy the miles."
                        : "Once checked in, you're live. Run together and enjoy the miles.",
                    },
                  ].map((item) => (
                    <View key={item.title} style={styles.frRuleRow}>
                      <View style={styles.frRuleIcon}>
                        <Feather name={item.icon} size={15} color={C.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.frRuleTitle}>{item.title}</Text>
                        <Text style={styles.frRuleBody}>{item.body}</Text>
                      </View>
                    </View>
                  ))}
                  <View style={styles.planInfoPageRow}>
                    <View style={[styles.planInfoDot, styles.planInfoDotActive]} />
                    <View style={styles.planInfoDot} />
                  </View>
                  <Pressable
                    style={[styles.primaryBtn, { marginTop: 8 }]}
                    onPress={() => setPlanInfoPage(1)}
                  >
                    <Text style={styles.primaryBtnText}>Next</Text>
                    <Feather name="arrow-right" size={16} color={C.text} />
                  </Pressable>
                </>
              ) : (
                <>
                  <View style={styles.frHeader}>
                    <Text style={styles.frTitle}>Check-In Rules</Text>
                    <Pressable onPress={() => setShowPlanInfoModal(false)} hitSlop={12}>
                      <Feather name="x" size={18} color={C.textSecondary} />
                    </Pressable>
                  </View>
                  <Text style={styles.frIntro}>
                    Planning a spot doesn't make you official — arriving does.
                  </Text>
                  {[
                    {
                      icon: "navigation" as const,
                      title: "Location is required",
                      body: "Your phone needs location enabled so PaceUp can detect when you arrive near the start.",
                    },
                    {
                      icon: "clock" as const,
                      title: "1-hour window",
                      body: "Check-in opens exactly 1 hour before the start time. Arriving earlier won't count.",
                    },
                    {
                      icon: "check-circle" as const,
                      title: "Auto check-in",
                      body: run?.activity_type === "ride"
                        ? "When you're within ~500 ft (150 m) of the start pin during the window, you're automatically added to the live rider count."
                        : "When you're within ~500 ft (150 m) of the start pin during the window, you're automatically added to the live runner count.",
                    },
                    {
                      icon: "alert-circle" as const,
                      title: "No-shows are removed",
                      body: "If you planned but didn't show up, your spot is released for others.",
                    },
                  ].map((item) => (
                    <View key={item.title} style={styles.frRuleRow}>
                      <View style={styles.frRuleIcon}>
                        <Feather name={item.icon} size={15} color={C.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.frRuleTitle}>{item.title}</Text>
                        <Text style={styles.frRuleBody}>{item.body}</Text>
                      </View>
                    </View>
                  ))}
                  <View style={styles.planInfoPageRow}>
                    <View style={styles.planInfoDot} />
                    <View style={[styles.planInfoDot, styles.planInfoDotActive]} />
                  </View>
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                    <Pressable
                      style={[styles.planBtn, { flex: 1 }]}
                      onPress={() => setPlanInfoPage(0)}
                    >
                      <Feather name="arrow-left" size={16} color={C.textSecondary} />
                      <Text style={styles.planBtnText}>Back</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.primaryBtn, { flex: 2 }]}
                      onPress={() => {
                        setShowPlanInfoModal(false);
                        planMutation.mutate();
                      }}
                    >
                      <Ionicons
                        name={run?.activity_type === "ride" ? "bicycle" : "walk"}
                        size={18}
                        color={C.text}
                      />
                      <Text style={styles.primaryBtnText}>
                        {run?.activity_type === "ride" ? "I'm In, Let's Ride!" : run?.activity_type === "walk" ? "I'm In, Let's Walk!" : "I'm In, Let's Run!"}
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* ── Community rules popup ─────────────────────────────────────────── */}
      {showRulesModal && (
        <Modal transparent animationType="slide" onRequestClose={() => setShowRulesModal(false)}>
          <View style={styles.frModalWrap}>
            <Pressable style={styles.frOverlay} onPress={() => setShowRulesModal(false)} />
            <View style={[styles.frSheet, { paddingBottom: insets.bottom + 24 }]}>
              <View style={styles.frHandle} />
              <View style={styles.frHeader}>
                <Text style={styles.frTitle}>{run?.activity_type === "ride" ? "Before You Ride" : run?.activity_type === "walk" ? "Before You Walk" : "Before You Run"}</Text>
                <Pressable onPress={() => setShowRulesModal(false)}>
                  <Feather name="x" size={18} color={C.textSecondary} />
                </Pressable>
              </View>
              <Text style={styles.frIntro}>
                {proximityTriggered
                  ? `You're near the start — want to join the group?`
                  : `A quick reminder before you join the group.`}
              </Text>
              {[
                { icon: "smile" as const,      title: "Have fun",   body: run?.activity_type === "ride" ? "Riding with others is a great time. Enjoy the pace, the people, and the miles." : run?.activity_type === "walk" ? "Walking with others is a great time. Enjoy the pace, the people, and the miles." : "Running with others is a great time. Enjoy the pace, the people, and the miles." },
                { icon: "heart" as const,      title: "Be kind",    body: run?.activity_type === "ride" ? "Cheer each other on. Every rider is working hard — support your group." : run?.activity_type === "walk" ? "Cheer each other on. Every walker is working hard — support your group." : "Cheer each other on. Every runner is working hard — support your group." },
                { icon: "trending-up" as const, title: "Keep up",   body: "Do your best to match the group's pace. If you fall behind, it's okay — just keep moving." },
              ].map((item) => (
                <View key={item.title} style={styles.frRuleRow}>
                  <View style={styles.frRuleIcon}>
                    <Feather name={item.icon} size={15} color={C.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.frRuleTitle}>{item.title}</Text>
                    <Text style={styles.frRuleBody}>{item.body}</Text>
                  </View>
                </View>
              ))}
              <Pressable
                style={[styles.primaryBtn, { marginTop: 20 }]}
                onPress={() => {
                  setShowRulesModal(false);
                  doJoin();
                }}
              >
                <Ionicons name={run?.activity_type === "ride" ? "bicycle" : run?.activity_type === "walk" ? "footsteps" : "body"} size={18} color={C.text} />
                <Text style={styles.primaryBtnText}>Let's go!</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}

      {/* ── Edit Date/Time Sheet ──────────────────────────────────────────── */}
      {showEditSheet && (
        <Modal transparent animationType="slide" onRequestClose={() => setShowEditSheet(false)}>
          <View style={styles.frModalWrap}>
            <Pressable style={styles.frOverlay} onPress={() => setShowEditSheet(false)} />
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.editSheetOuter}>
              <View style={[styles.editSheet, { paddingBottom: insets.bottom + 24, maxHeight: "90%" }]}>
                <View style={styles.frHandle} />
                <View style={styles.editSheetHeader}>
                  <Text style={styles.editSheetTitle}>Edit Event</Text>
                  <Pressable onPress={() => setShowEditSheet(false)} hitSlop={12}>
                    <Feather name="x" size={18} color={C.textSecondary} />
                  </Pressable>
                </View>
                <Text style={styles.editSheetSub}>
                  All planned participants will be notified of any changes.
                </Text>
                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  <View style={styles.editFieldGroup}>
                    <Text style={styles.editFieldLabel}>Title</Text>
                    <TextInput
                      style={styles.editInput}
                      value={editTitle}
                      onChangeText={setEditTitle}
                      placeholder="Event title"
                      placeholderTextColor={C.textMuted}
                      maxLength={120}
                    />
                  </View>
                  <View style={styles.editFieldGroup}>
                    <Text style={styles.editFieldLabel}>Description</Text>
                    <TextInput
                      style={[styles.editInput, { minHeight: 72, textAlignVertical: "top" }]}
                      value={editDescription}
                      onChangeText={setEditDescription}
                      placeholder="Optional details"
                      placeholderTextColor={C.textMuted}
                      multiline
                      maxLength={1000}
                    />
                  </View>
                  <View style={styles.editFieldGroup}>
                    <Text style={styles.editFieldLabel}>Location</Text>
                    <TextInput
                      style={styles.editInput}
                      value={editLocationName}
                      onChangeText={setEditLocationName}
                      placeholder="e.g. Memorial Park"
                      placeholderTextColor={C.textMuted}
                    />
                  </View>
                  <View style={styles.editFieldGroup}>
                    <Text style={styles.editFieldLabel}>Date & Time</Text>
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <TextInput
                        style={[styles.editInput, { flex: 1 }]}
                        value={editDate}
                        onChangeText={(text) => {
                          const digits = text.replace(/\D/g, "").slice(0, 6);
                          let fmt = digits;
                          if (digits.length > 2) fmt = digits.slice(0, 2) + "/" + digits.slice(2);
                          if (digits.length > 4) fmt = digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4);
                          setEditDate(fmt);
                        }}
                        placeholder="MM/DD/YY"
                        placeholderTextColor={C.textMuted}
                        keyboardType="number-pad"
                        maxLength={8}
                        autoCorrect={false}
                      />
                      <View style={{ flex: 1, flexDirection: "row", gap: 6 }}>
                        <TextInput
                          style={[styles.editInput, { flex: 1 }]}
                          value={editTime}
                          onChangeText={(text) => {
                            const digits = text.replace(/\D/g, "").slice(0, 4);
                            setEditTime(autoFormatEditTime(digits));
                          }}
                          placeholder="7:30"
                          placeholderTextColor={C.textMuted}
                          keyboardType="number-pad"
                          maxLength={5}
                          autoCorrect={false}
                        />
                        <View style={{ flexDirection: "column", gap: 4 }}>
                          {(["AM", "PM"] as const).map((period) => (
                            <Pressable
                              key={period}
                              onPress={() => { setEditAmPm(period); Haptics.selectionAsync(); }}
                              style={{
                                flex: 1, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1,
                                alignItems: "center", justifyContent: "center",
                                backgroundColor: editAmPm === period ? C.primary + "33" : C.surface,
                                borderColor: editAmPm === period ? C.primary : C.border,
                              }}
                            >
                              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 12, color: editAmPm === period ? C.primary : C.textMuted }}>{period}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <View style={[styles.editFieldGroup, { flex: 1 }]}>
                      <Text style={styles.editFieldLabel}>Min distance (mi)</Text>
                      <TextInput
                        style={styles.editInput}
                        value={editMinDistance}
                        onChangeText={setEditMinDistance}
                        placeholder="0"
                        placeholderTextColor={C.textMuted}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View style={[styles.editFieldGroup, { flex: 1 }]}>
                      <Text style={styles.editFieldLabel}>Max distance (mi)</Text>
                      <TextInput
                        style={styles.editInput}
                        value={editMaxDistance}
                        onChangeText={setEditMaxDistance}
                        placeholder="3"
                        placeholderTextColor={C.textMuted}
                        keyboardType="decimal-pad"
                      />
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <View style={[styles.editFieldGroup, { flex: 1 }]}>
                      <Text style={styles.editFieldLabel}>Faster pace (min/mi)</Text>
                      <TextInput
                        style={styles.editInput}
                        value={editMinPace}
                        onChangeText={setEditMinPace}
                        placeholder="7"
                        placeholderTextColor={C.textMuted}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <View style={[styles.editFieldGroup, { flex: 1 }]}>
                      <Text style={styles.editFieldLabel}>Slower pace (min/mi)</Text>
                      <TextInput
                        style={styles.editInput}
                        value={editMaxPace}
                        onChangeText={setEditMaxPace}
                        placeholder="10"
                        placeholderTextColor={C.textMuted}
                        keyboardType="decimal-pad"
                      />
                    </View>
                  </View>
                  <View style={styles.editFieldGroup}>
                    <Text style={styles.editFieldLabel}>Max participants</Text>
                    <TextInput
                      style={styles.editInput}
                      value={editMaxParticipants}
                      onChangeText={setEditMaxParticipants}
                      placeholder="20"
                      placeholderTextColor={C.textMuted}
                      keyboardType="number-pad"
                    />
                  </View>
                  {/* Pace groups editor — add/remove on the fly, even while the event is live */}
                  <View style={styles.editFieldGroup}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <Text style={styles.editFieldLabel}>Pace groups</Text>
                      {editPaceGroups.length < 8 && (
                        <Pressable
                          onPress={() => {
                            const letters = ["A", "B", "C", "D", "E", "F", "G", "H"];
                            const next = letters[editPaceGroups.length] ?? String(editPaceGroups.length + 1);
                            setEditPaceGroups([...editPaceGroups, { label: `Group ${next}`, minPace: "", maxPace: "" }]);
                            Haptics.selectionAsync();
                          }}
                          style={({ pressed }) => [{
                            flexDirection: "row", alignItems: "center", gap: 4,
                            paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
                            backgroundColor: C.primaryMuted, borderWidth: 1, borderColor: C.primary + "55",
                            opacity: pressed ? 0.75 : 1,
                          }]}
                          testID="edit-add-pace-group"
                        >
                          <Feather name="plus" size={12} color={C.primary} />
                          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.primary }}>Add group</Text>
                        </Pressable>
                      )}
                    </View>
                    {editPaceGroups.length === 0 && (
                      <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, fontStyle: "italic" }}>
                        No pace groups. Tap Add group to create one.
                      </Text>
                    )}
                    {editPaceGroups.map((g, idx) => (
                      <View key={idx} style={{ flexDirection: "row", gap: 8, marginBottom: 8, alignItems: "center" }}>
                        <TextInput
                          style={[styles.editInput, { flex: 1.2 }]}
                          value={g.label}
                          onChangeText={(t) => {
                            const copy = [...editPaceGroups];
                            copy[idx] = { ...copy[idx], label: t };
                            setEditPaceGroups(copy);
                          }}
                          placeholder="Label"
                          placeholderTextColor={C.textMuted}
                          maxLength={40}
                        />
                        <TextInput
                          style={[styles.editInput, { flex: 1 }]}
                          value={g.minPace}
                          onChangeText={(t) => {
                            const copy = [...editPaceGroups];
                            copy[idx] = { ...copy[idx], minPace: t };
                            setEditPaceGroups(copy);
                          }}
                          placeholder="Fast"
                          placeholderTextColor={C.textMuted}
                          keyboardType="decimal-pad"
                        />
                        <TextInput
                          style={[styles.editInput, { flex: 1 }]}
                          value={g.maxPace}
                          onChangeText={(t) => {
                            const copy = [...editPaceGroups];
                            copy[idx] = { ...copy[idx], maxPace: t };
                            setEditPaceGroups(copy);
                          }}
                          placeholder="Slow"
                          placeholderTextColor={C.textMuted}
                          keyboardType="decimal-pad"
                        />
                        <Pressable
                          onPress={() => {
                            setEditPaceGroups(editPaceGroups.filter((_, i) => i !== idx));
                            Haptics.selectionAsync();
                          }}
                          hitSlop={8}
                          style={({ pressed }) => [{ padding: 6, opacity: pressed ? 0.6 : 1 }]}
                          testID={`edit-remove-pace-group-${idx}`}
                        >
                          <Feather name="x" size={16} color={C.textMuted} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.primaryBtn, { opacity: pressed || editSaving ? 0.85 : 1, marginTop: 8 }]}
                    onPress={handleSaveEdit}
                    disabled={editSaving}
                    testID="save-edit-btn"
                  >
                    {editSaving ? <ActivityIndicator color={C.text} /> : (
                      <>
                        <Feather name="check" size={16} color={C.text} />
                        <Text style={styles.primaryBtnText}>Save Changes</Text>
                      </>
                    )}
                  </Pressable>
                </ScrollView>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>
      )}

      {/* ── Message Participants Sheet ── */}
      {showMessageSheet && (
        <Modal transparent animationType="slide" onRequestClose={() => setShowMessageSheet(false)}>
          <View style={styles.frModalWrap}>
            <Pressable style={styles.frOverlay} onPress={() => setShowMessageSheet(false)} />
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.editSheetOuter}>
              <View style={[styles.editSheet, { paddingBottom: insets.bottom + 24 }]}>
                <View style={styles.frHandle} />
                <View style={styles.editSheetHeader}>
                  <Text style={styles.editSheetTitle}>Message Participants</Text>
                  <Pressable onPress={() => setShowMessageSheet(false)} hitSlop={12}>
                    <Feather name="x" size={18} color={C.textSecondary} />
                  </Pressable>
                </View>
                <Text style={styles.editSheetSub}>
                  All joined and planned attendees will receive a push notification with your message.
                </Text>
                <View style={styles.editFieldGroup}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <Text style={styles.editFieldLabel}>Message</Text>
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: (280 - broadcastMsg.length) <= 30 ? C.danger : C.textMuted }}>
                      {280 - broadcastMsg.length} left
                    </Text>
                  </View>
                  <TextInput
                    style={[styles.editInput, { minHeight: 100, textAlignVertical: "top", paddingTop: 12 }]}
                    value={broadcastMsg}
                    onChangeText={setBroadcastMsg}
                    placeholder={`e.g. "Heads up — we're meeting by the north entrance today!"`}
                    placeholderTextColor={C.textMuted}
                    multiline
                    maxLength={280}
                    autoFocus
                  />
                </View>
                <Pressable
                  style={({ pressed }) => [styles.primaryBtn, { opacity: pressed || broadcasting || !broadcastMsg.trim() || broadcastMsg.length >= 280 ? 0.75 : 1, marginTop: 8 }]}
                  onPress={handleBroadcast}
                  disabled={broadcasting || !broadcastMsg.trim() || broadcastMsg.length >= 280}
                >
                  {broadcasting ? <ActivityIndicator color={C.text} /> : (
                    <>
                      <Feather name="send" size={16} color={C.text} />
                      <Text style={styles.primaryBtnText}>Send Message</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>
      )}

      {/* ── Pace Group Selection Sheet ── */}
      {showPaceGroupSheet && run?.pace_groups && (
        <Modal transparent animationType="slide" onRequestClose={() => setShowPaceGroupSheet(false)}>
          <View style={styles.frModalWrap}>
            <Pressable style={styles.frOverlay} onPress={() => setShowPaceGroupSheet(false)} />
            <View style={[styles.editSheet, { paddingBottom: insets.bottom + 24, maxHeight: "75%" }]}>
              <View style={styles.frHandle} />
              <View style={styles.editSheetHeader}>
                <Text style={styles.editSheetTitle}>{run?.activity_type === "ride" ? "Pick Your Speed Group" : "Pick Your Pace Group"}</Text>
                <Pressable onPress={() => setShowPaceGroupSheet(false)} hitSlop={12}>
                  <Feather name="x" size={18} color={C.textSecondary} />
                </Pressable>
              </View>
              <Text style={[styles.editSheetSub, { marginBottom: 16 }]}>
                {run?.activity_type === "ride"
                  ? "Choose the group that best matches your riding speed. This helps the host organize the ride."
                  : "Choose the group that best matches your pace. This helps the host organize the run."}
              </Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                {(run.pace_groups as any[]).map((group: any, idx: number) => {
                  const isSelected = pendingJoinPaceGroup === group.label;
                  return (
                    <Pressable
                      key={idx}
                      onPress={() => setPendingJoinPaceGroup(group.label)}
                      style={{
                        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                        backgroundColor: isSelected ? C.primaryMuted : C.surface,
                        borderRadius: 14, borderWidth: 1.5,
                        borderColor: isSelected ? C.primary : C.border,
                        padding: 14, marginBottom: 10,
                      }}
                    >
                      <View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text }}>{group.label}</Text>
                          {bestPaceGroup?.label === group.label && (
                            <View style={{ backgroundColor: C.primary + "22", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 0.5, borderColor: C.primary + "44" }}>
                              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 10, color: C.primary }}>SUGGESTED</Text>
                            </View>
                          )}
                        </View>
                        <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary, marginTop: 2 }}>
                          {run?.activity_type === "ride"
                            ? `${group.minPace} – ${group.maxPace} mph`
                            : `${group.minPace} – ${group.maxPace} min/mi`}
                        </Text>
                      </View>
                      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: isSelected ? C.primary : C.border, backgroundColor: isSelected ? C.primary : "transparent", alignItems: "center", justifyContent: "center" }}>
                        {isSelected && <Feather name="check" size={12} color="#fff" />}
                      </View>
                    </Pressable>
                  );
                })}
                {/* No-preference / skip option so users are never trapped */}
                <Pressable
                  onPress={() => {
                    setShowPaceGroupSheet(false);
                    doJoin();
                  }}
                  style={{
                    flexDirection: "row", alignItems: "center", justifyContent: "center",
                    borderRadius: 14, borderWidth: 1, borderStyle: "dashed",
                    borderColor: C.border, padding: 14, marginBottom: 4, gap: 6,
                  }}
                >
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary }}>
                    No preference — skip
                  </Text>
                </Pressable>
              </ScrollView>
              <Pressable
                style={{ marginTop: 16, backgroundColor: pendingJoinPaceGroup ? C.primary : C.surface, borderRadius: 14, paddingVertical: 15, alignItems: "center", opacity: pendingJoinPaceGroup ? 1 : 0.5 }}
                onPress={async () => {
                  if (!pendingJoinPaceGroup) return;
                  setShowPaceGroupSheet(false);
                  if (paceGroupSheetMode === "switch") {
                    try {
                      await apiRequest("PATCH", `/api/runs/${id}/pace-group`, { paceGroupLabel: pendingJoinPaceGroup });
                      qc.invalidateQueries({ queryKey: ["/api/runs", id, "participants"] });
                      qc.invalidateQueries({ queryKey: ["/api/runs", id] });
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    } catch (e: any) {
                      Alert.alert("Could not switch group", e?.message ?? "Please try again.");
                    }
                  } else {
                    doJoin(pendingJoinPaceGroup);
                  }
                }}
                disabled={!pendingJoinPaceGroup}
              >
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: pendingJoinPaceGroup ? "#000" : C.textMuted }}>
                  {pendingJoinPaceGroup
                    ? (paceGroupSheetMode === "switch" ? `Switch to ${pendingJoinPaceGroup}` : `Join as ${pendingJoinPaceGroup}`)
                    : "Select a group to continue"}
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}

      {/* ── Floating "Back to Live" pill (shown when tracking is minimized) ── */}
      {isMyTracking && (
        <Pressable
          style={[styles.livePill, { bottom: insets.bottom + 80 + (Platform.OS === "web" ? 34 : 0) }]}
          onPress={() => {
            liveTracking.restore();
            router.push(`/run-live/${id}`);
          }}
        >
          <Animated.View style={[styles.livePillDot, { opacity: pillPulse }]} />
          <Text style={styles.livePillLabel}>
            {liveTracking.activityType === "ride" ? "Back to Live Ride" : liveTracking.activityType === "walk" ? "Back to Live Walk" : "Back to Live Run"}
          </Text>
          <Text style={styles.livePillDist}>{liveTracking.displayDist.toFixed(2)} mi</Text>
          <Feather name="chevron-right" size={16} color={C.primary} />
        </Pressable>
      )}
    </View>
  );
}

function makeStyles(C: ColorScheme) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  fullToast: { position: "absolute" as const, top: 60, left: 20, right: 20, zIndex: 100, backgroundColor: C.surface, borderWidth: 1, borderColor: "#FF6B6B55", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
  fullToastText: { fontFamily: "Outfit_500Medium", fontSize: 14, color: C.text },
  content: { paddingHorizontal: 20 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  topBarRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  privacyBadge: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: "transparent" },
  privacyText: { fontFamily: "Outfit_600SemiBold", fontSize: 12 },
  bookmarkBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  bookmarkBtnActive: { backgroundColor: C.primaryMuted, borderColor: C.primary + "55" },
  planCountRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  planCountText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted },
  planBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: 14, height: 52, paddingHorizontal: 16,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  planBtnActive: { backgroundColor: C.primaryMuted, borderColor: C.primary + "55" },
  planBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  planBtnTextActive: { color: C.primary },
  heroDateLabel: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, marginBottom: 6, fontStyle: "italic" },
  title: { fontFamily: "Outfit_700Bold", fontSize: 30, color: C.text, marginBottom: 10, lineHeight: 36 },
  heroLocationRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  heroLocationTxt: { fontFamily: "Outfit_500Medium", fontSize: 13, color: C.textSecondary, flex: 1 },
  locationMapCard: {
    height: 160,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 16,
    backgroundColor: C.surface,
  },
  locationMapPin: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: C.primary,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: C.bg,
  },
  locationMapOpenHint: {
    position: "absolute",
    bottom: 10, right: 10,
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: C.card + "EB",
    borderWidth: 1, borderColor: C.border,
    borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  locationMapOpenHintTxt: {
    fontFamily: "Outfit_600SemiBold", fontSize: 11, color: C.text, letterSpacing: 0.4,
  },
  hostCard: { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border, marginBottom: 16 },
  hostAvatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: C.primaryMuted, borderWidth: 2, borderColor: C.primary, alignItems: "center", justifyContent: "center" },
  hostAvatarText: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.primary },
  hostInfo: { flex: 1, gap: 2 },
  stagesPreview: {
    backgroundColor: C.primaryMuted,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.primary + "44",
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 12,
    marginBottom: 4,
  },
  stagesPreviewLabel: {
    fontFamily: "Outfit_700Bold",
    fontSize: 11,
    color: C.primary,
    letterSpacing: 0.6,
  },
  stagesPreviewSub: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: C.textMuted,
  },
  stagesPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 5,
  },
  stagesPreviewBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  stagesPreviewBadgeTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 11,
    color: C.bg,
  },
  stagesPreviewActivity: {
    fontFamily: "Outfit_700Bold",
    fontSize: 13,
    color: C.text,
  },
  stagesPreviewDist: {
    fontFamily: "Outfit_500Medium",
    fontSize: 12,
    color: C.textSecondary,
  },
  stagesPreviewPace: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: C.textMuted,
    flexShrink: 1,
  },
  hostedByLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 10,
    color: C.textMuted,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  hostName: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.text },
  hostPlannedDist: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.text, marginTop: 3 },
  hostMeta: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  hostBadgeText: { fontFamily: "Outfit_600SemiBold", fontSize: 11 },
  topRatedChip: { backgroundColor: "#FFB80020", borderWidth: 1, borderColor: "#FFB80055", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  topRatedChipTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: "#FFB800" },
  ratePrompt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text, textAlign: "center", marginBottom: 8, marginTop: 4 },
  yourRunBadge: { backgroundColor: C.primaryMuted, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: C.primary + "44" },
  yourRunText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.primary },
  stillJoinableRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  stillJoinableTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: "#F5A623" },
  infoGrid: { gap: 10, marginBottom: 16 },
  infoCard: { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border },
  infoValue: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  infoLabel: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  requirementsCard: { backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border, marginBottom: 16, gap: 14 },
  requirementsTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },
  requirementsGrid: { flexDirection: "row", alignItems: "center" },
  reqItem: { flex: 1, alignItems: "center", gap: 4 },
  reqDivider: { width: 1, height: 40, backgroundColor: C.border },
  reqValue: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.text, textAlign: "center" },
  reqLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textSecondary, textAlign: "center" },
  eligibilityRow: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, padding: 10, borderWidth: 1 },
  eligibilityText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, flex: 1 },
  routeCard: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, marginBottom: 16, overflow: "hidden" },
  routeCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, paddingBottom: 10 },
  routeCardName: { flex: 1, fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  routeMap: { width: "100%", height: 160 },
  descCard: { backgroundColor: C.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border, marginBottom: 16, gap: 8 },
  descTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.text },
  descText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, lineHeight: 20 },
  tagsSection: { gap: 10, marginBottom: 16 },
  sectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },
  tagsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tagChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.primaryMuted, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: C.primary + "33" },
  tagText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },
  runStyleBadgeRow: { flexDirection: "row" },
  runStyleBadge: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  runStyleBadgeText: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.bg },
  participantsSection: { gap: 10, marginBottom: 16 },
  participantsList: { gap: 8 },
  participantItem: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border },
  participantAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  participantAvatarImg: { width: 40, height: 40, borderRadius: 20 },
  participantAvatarText: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.textSecondary },
  participantInfo: { flex: 1, gap: 2 },
  participantName: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  participantPace: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  participantStatus: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  participantStatusText: { fontFamily: "Outfit_600SemiBold", fontSize: 11 },
  bottomBar: { padding: 20, paddingTop: 12, gap: 10, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg },
  primaryBtn: { backgroundColor: C.primary, borderRadius: 14, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },
  secondaryBtn: { borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.danger + "66" },
  secondaryBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.danger },
  rateBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, height: 52, backgroundColor: C.gold + "22", borderWidth: 1, borderColor: C.gold + "44" },
  rateBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.gold },
  ratedBanner: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", padding: 12 },
  ratedText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  joinedBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, justifyContent: "center", padding: 8 },
  joinedText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },
  joinedHint: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary, marginTop: 2 },
  waitingBanner: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", padding: 12, backgroundColor: C.gold + "18", borderRadius: 12, borderWidth: 1, borderColor: C.gold + "44" },
  waitingText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.gold },
  youreGoingBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14, backgroundColor: C.primary + "18", borderRadius: 12, borderWidth: 1, borderColor: C.primary + "44" },
  youreGoingText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.primary },
  youreGoingLeave: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textMuted },
  pendingRequestBanner: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", padding: 12, backgroundColor: C.gold + "18", borderRadius: 12, borderWidth: 1, borderColor: C.gold + "44" },
  pendingRequestText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.gold, flex: 1 },
  joinRequestRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  joinRequestApprove: { backgroundColor: C.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  joinRequestApproveTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.bg },
  joinRequestDeny: { backgroundColor: C.card, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: C.border },
  joinRequestDenyTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.textSecondary },
  liveBtn: { backgroundColor: C.primary, borderRadius: 14, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  liveBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  btnDisabled: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  hostMgmtRow: { flexDirection: "row", gap: 10 },
  hostMgmtBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, height: 44, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  hostMgmtTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textSecondary },
  hostMgmtDangerBtn: { borderColor: C.danger + "55", backgroundColor: C.danger + "11" },
  hostMgmtDangerTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.danger },
  editSheetOuter: { justifyContent: "flex-end" },
  editSheet: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 16 },
  editSheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  editSheetTitle: { fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text },
  editSheetSub: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, lineHeight: 20, marginTop: -8 },
  editFieldGroup: { gap: 6 },
  editFieldLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  editInput: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 16, paddingVertical: 14, fontFamily: "Outfit_400Regular", fontSize: 16, color: C.text },
  proximityWarn: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", paddingTop: 4 },
  proximityText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary, flex: 1 },
  errorText: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text },
  backLink: { marginTop: 16 },
  backLinkText: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.primary },
  lockIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: C.primaryMuted, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: C.primary + "44" },
  lockTitle: { fontFamily: "Outfit_700Bold", fontSize: 26, color: C.text, textAlign: "center" },
  lockHost: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center" },
  lockRunTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 16, color: C.text, textAlign: "center" },
  lockSub: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center" },
  lockInputGroup: { width: "100%", gap: 10 },
  lockInput: {
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 16, paddingVertical: 14, fontFamily: "Outfit_400Regular", fontSize: 15, color: C.text,
    textAlign: "center", letterSpacing: 1,
  },
  lockError: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: "#FF6B6B", textAlign: "center" },
  lockUnlockBtn: { backgroundColor: C.primary, borderRadius: 14, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 32, width: "100%" },
  lockUnlockTxt: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },

  // ─── Run Photos ───────────────────────────────────────────────────────────
  photosSection: { marginTop: 24, marginBottom: 16 },
  photosSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  addPhotoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.primaryMuted,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: C.primary + "44",
  },
  addPhotoBtnTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },
  photosEmpty: { alignItems: "center", paddingVertical: 20, gap: 6 },
  photosEmptyTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textMuted },
  photosEmptyHint: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, textAlign: "center" },
  photosGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  photoGridImg: { width: 105, height: 105, borderRadius: 10, backgroundColor: C.card },
  photoViewer: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.95)", alignItems: "center", justifyContent: "center", zIndex: 999,
  },
  photoViewerImg: { width: "100%", height: "80%" },
  photoViewerClose: {
    position: "absolute", right: 20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center",
  },

  // ─── First-run modal ──────────────────────────────────────────────────────
  frModalWrap: { flex: 1, justifyContent: "flex-end" },
  frOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
  frSheet: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 0 },
  frHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginBottom: 16 },
  frHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  frTitle: { fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text },
  frIntro: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, lineHeight: 20, marginBottom: 16 },
  frRuleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 },
  frRuleIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.primaryMuted, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.primary + "44" },
  frRuleTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text, marginBottom: 2 },
  frRuleBody: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary, lineHeight: 18 },
  planInfoPageRow: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 16 },
  planInfoDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.border },
  planInfoDotActive: { backgroundColor: C.primary, width: 18 },

  // ─── Floating live tracking pill ─────────────────────────────────────────
  livePill: {
    position: "absolute", alignSelf: "center", left: 20, right: 20,
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.surface, borderRadius: 28,
    paddingHorizontal: 18, paddingVertical: 12,
    borderWidth: 1.5, borderColor: C.primary,
    shadowColor: C.primary, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
  },
  livePillDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary },
  livePillLabel: { flex: 1, fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  livePillDist: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.primary },
}); }
