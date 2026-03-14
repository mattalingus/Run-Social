import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SectionList,
  Pressable,
  TextInput,
  Alert,
  Modal,
  ActivityIndicator,
  Platform,
  Image,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, FontAwesome5, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Notifications from "@/lib/safeNotifications";
import * as ImagePicker from "expo-image-picker";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { useActivity } from "@/contexts/ActivityContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { darkColors as C, type ColorScheme } from "@/constants/colors";
import { useTheme } from "@/contexts/ThemeContext";
import { formatDistance } from "@/lib/formatDistance";
import { toDisplayDist, toDisplayPace, unitLabel, type DistanceUnit } from "@/lib/units";
import MAP_STYLE from "@/lib/mapStyle";
import MapView, { Polyline } from "react-native-maps";
import Svg, { Polyline as SvgPolyline, Circle as SvgCircle } from "react-native-svg";
import MileSplitsChart from "@/components/MileSplitsChart";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SoloRun {
  id: string;
  user_id: string;
  title: string | null;
  date: string;
  distance_miles: number;
  pace_min_per_mile: number | null;
  duration_seconds: number | null;
  completed: boolean;
  planned: boolean;
  notes: string | null;
  route_path: Array<{ latitude: number; longitude: number }> | null;
  created_at: string;
  activity_type: "run" | "ride" | "walk";
  is_starred: boolean;
  elevation_gain_ft: number | null;
  mile_splits: Array<{ label: string; paceMinPerMile: number; isPartial: boolean }> | null;
  source?: string | null;
  garmin_activity_id?: string | null;
  apple_health_id?: string | null;
}

interface SavedPath {
  id: string;
  name: string;
  route_path: Array<{ latitude: number; longitude: number }>;
  distance_miles: number | null;
  created_at: string;
  activity_type?: string | null;
}

type RoutePoint = { latitude: number; longitude: number };

function MiniRouteMap({ path, height = 200 }: { path: RoutePoint[]; height?: number }) {
  if (!path || path.length < 2) return null;
  const lats = path.map((p) => p.latitude);
  const lngs = path.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latDelta = Math.max((maxLat - minLat) * 1.6, 0.006);
  const lngDelta = Math.max((maxLng - minLng) * 1.6, 0.006);

  return (
    <MapView
      style={{ height, borderRadius: 16, overflow: "hidden" }}
      initialRegion={{
        latitude: (minLat + maxLat) / 2,
        longitude: (minLng + maxLng) / 2,
        latitudeDelta: latDelta,
        longitudeDelta: lngDelta,
      }}
      customMapStyle={MAP_STYLE}
      mapType="mutedStandard"
      scrollEnabled={false}
      zoomEnabled={false}
      rotateEnabled={false}
      pitchEnabled={false}
      showsUserLocation={false}
      showsCompass={false}
      showsScale={false}
      showsTraffic={false}
      showsBuildings={false}
      showsPointsOfInterest={false}
      userInterfaceStyle="dark"
      toolbarEnabled={false}
      pointerEvents="none"
    >
      <Polyline coordinates={path} strokeColor={C.primary} strokeWidth={3} lineCap="round" lineJoin="round" />
    </MapView>
  );
}

// ─── SVG Route Helpers ────────────────────────────────────────────────────────

const ROUTE_PREVIEW_W = 328; // CARD_W inside sheet (360 - 32px padding)
const ROUTE_PREVIEW_H = 200;

function normalizeRoute(pts: RoutePoint[], w: number, h: number): string {
  if (pts.length < 2) return "";
  const lats = pts.map(p => p.latitude);
  const lngs = pts.map(p => p.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const pad = 20;
  const rngLat = maxLat - minLat || 0.001;
  const rngLng = maxLng - minLng || 0.001;
  return pts.map(p => {
    const x = pad + ((p.longitude - minLng) / rngLng) * (w - pad * 2);
    const y = (h - pad) - ((p.latitude - minLat) / rngLat) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function getRouteEnds(pts: RoutePoint[], w: number, h: number) {
  if (pts.length < 2) return null;
  const lats = pts.map(p => p.latitude);
  const lngs = pts.map(p => p.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const pad = 20;
  const rngLat = maxLat - minLat || 0.001;
  const rngLng = maxLng - minLng || 0.001;
  const toXY = (p: RoutePoint) => ({
    x: pad + ((p.longitude - minLng) / rngLng) * (w - pad * 2),
    y: (h - pad) - ((p.latitude - minLat) / rngLat) * (h - pad * 2),
  });
  return { start: toXY(pts[0]), end: toXY(pts[pts.length - 1]) };
}

function PathRoutePreview({ path, primary }: { path: RoutePoint[]; primary: string }) {
  const W = ROUTE_PREVIEW_W;
  const H = ROUTE_PREVIEW_H;
  const hasRoute = path?.length >= 2;
  const svgPoints = hasRoute ? normalizeRoute(path, W, H) : "";
  const ends = hasRoute ? getRouteEnds(path, W, H) : null;

  return (
    <View style={{ width: "100%", height: H, backgroundColor: "#0D1510", borderRadius: 16, overflow: "hidden", marginTop: 14 }}>
      {/* Subtle grid */}
      {[0.25, 0.5, 0.75].map(f => (
        <View key={`h${f}`} style={{ position: "absolute", left: 0, right: 0, top: `${f * 100}%` as any, height: 1, backgroundColor: "#FFFFFF08" }} />
      ))}
      {[0.25, 0.5, 0.75].map(f => (
        <View key={`v${f}`} style={{ position: "absolute", top: 0, bottom: 0, left: `${f * 100}%` as any, width: 1, backgroundColor: "#FFFFFF08" }} />
      ))}

      {hasRoute ? (
        <Svg width={W} height={H} style={{ position: "absolute", top: 0, left: 0 }}>
          {/* Glow underlay */}
          <SvgPolyline points={svgPoints} fill="none" stroke={primary + "40"} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
          {/* Main line */}
          <SvgPolyline points={svgPoints} fill="none" stroke={primary} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          {ends && <SvgCircle cx={ends.start.x} cy={ends.start.y} r={5} fill="#FFFFFF" />}
          {ends && (
            <>
              <SvgCircle cx={ends.end.x} cy={ends.end.y} r={7} fill={primary + "55"} />
              <SvgCircle cx={ends.end.x} cy={ends.end.y} r={4} fill={primary} />
            </>
          )}
        </Svg>
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Feather name="map" size={28} color="#FFFFFF30" />
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: "#FFFFFF40" }}>No GPS data</Text>
        </View>
      )}

      {/* GPS badge */}
      {hasRoute && (
        <View style={{ position: "absolute", bottom: 10, left: 12, flexDirection: "row", alignItems: "center", backgroundColor: "#00000066", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
          <Feather name="map-pin" size={9} color={primary} style={{ marginRight: 3 }} />
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 9, color: primary, letterSpacing: 0.3 }}>GPS Route</Text>
        </View>
      )}
    </View>
  );
}

// ─── Solo Run Photo Section ───────────────────────────────────────────────────

function SoloRunPhotos({ runId }: { runId: string }) {
  const { C } = useTheme();
  const soloPhotoStyles = useMemo(() => makeSoloPhotoStyles(C), [C]);
  const [uploading, setUploading] = useState(false);

  const { data: photos = [], refetch } = useQuery<any[]>({
    queryKey: ["/api/solo-runs", runId, "photos"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/solo-runs/${runId}/photos`);
      return res.json();
    },
    staleTime: 30_000,
  });

  async function pickAndUpload() {
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
    setUploading(true);
    try {
      const url = new URL(`/api/solo-runs/${runId}/photos`, getApiUrl()).toString();
      const response = await fetch(url, { method: "POST", body: formData, credentials: "include" });
      if (!response.ok) throw new Error("Upload failed");
      refetch();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Upload failed", e.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={soloPhotoStyles.container}>
      <View style={soloPhotoStyles.header}>
        <Text style={soloPhotoStyles.title}>
          {photos.length > 0 ? `Photos (${photos.length})` : "Photos"}
        </Text>
        <Pressable
          style={[soloPhotoStyles.addBtn, uploading && { opacity: 0.6 }]}
          onPress={pickAndUpload}
          disabled={uploading}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={C.primary} />
          ) : (
            <>
              <Feather name="camera" size={13} color={C.primary} />
              <Text style={soloPhotoStyles.addBtnTxt}>Add</Text>
            </>
          )}
        </Pressable>
      </View>
      {photos.length === 0 ? (
        <Text style={soloPhotoStyles.emptyTxt}>No photos yet — tap Add to upload one</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          {photos.map((p: any) => (
            <Image key={p.id} source={{ uri: p.photo_url }} style={soloPhotoStyles.thumb} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function makeSoloPhotoStyles(C: ColorScheme) { return StyleSheet.create({
  container: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 12,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.primaryMuted,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: C.primary + "44",
  },
  addBtnTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.primary },
  emptyTxt: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, marginTop: 8 },
  thumb: { width: 75, height: 75, borderRadius: 9, marginRight: 7, backgroundColor: C.card },
}); }

interface RankingCategory {
  label: string;
  miles: number;
  tolerance: number;
  runs: SoloRun[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DISTANCE_CATEGORIES = [
  { label: "1 Mile", miles: 1.0, tolerance: 0.15 },
  { label: "2 Miles", miles: 2.0, tolerance: 0.2 },
  { label: "5K", miles: 3.1, tolerance: 0.25 },
  { label: "5 Miles", miles: 5.0, tolerance: 0.3 },
  { label: "10K", miles: 6.2, tolerance: 0.35 },
];

const RANK_EMOJI = ["🥇", "🥈", "🥉"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPace(p: number) {
  const m = Math.floor(p);
  const s = Math.round((p - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function parsePaceInput(str: string): number | null {
  const parts = str.trim().split(":");
  if (parts.length === 2) {
    const m = parseFloat(parts[0]);
    const s = parseFloat(parts[1]);
    if (!isNaN(m) && !isNaN(s)) return m + s / 60;
  }
  const n = parseFloat(str);
  return isNaN(n) ? null : n;
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDisplayDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatScheduledDateTime(d: string) {
  const date = new Date(d);
  const datePart = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const timePart = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${datePart} · ${timePart}`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  return `${mm}/${dd}/${yy}`;
}

function parseDMY(raw: string): Date | null {
  const parts = raw.split("/");
  if (parts.length !== 3) return null;
  const [mm, dd, yy] = parts.map(Number);
  if (isNaN(mm) || isNaN(dd) || isNaN(yy)) return null;
  const year = yy < 100 ? 2000 + yy : yy;
  const d = new Date(year, mm - 1, dd);
  if (d.getMonth() !== mm - 1) return null;
  return d;
}

function parseHHMMAMPM(raw: string, ampm: "AM" | "PM"): { hours: number; minutes: number } | null {
  const parts = raw.split(":");
  if (parts.length !== 2) return null;
  let hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes) || minutes < 0 || minutes > 59) return null;
  if (hours < 1 || hours > 12) return null;
  if (ampm === "AM") { if (hours === 12) hours = 0; }
  else { if (hours !== 12) hours += 12; }
  return { hours, minutes };
}

function autoFormatTime(digits: string): string {
  if (digits.length <= 1) return digits;
  const first = parseInt(digits[0], 10);
  const second = parseInt(digits[1], 10);
  if (digits.length === 2) {
    if (first > 1 || (first === 1 && second > 2)) return digits[0] + ":" + digits[1];
    return digits;
  }
  if (digits.length === 3) {
    return digits[0] + ":" + digits.slice(1);
  }
  if (first === 1 && second <= 2) return digits.slice(0, 2) + ":" + digits.slice(2, 4);
  return digits[0] + ":" + digits.slice(1, 3);
}

async function scheduleRunNotifications(runDate: Date, label: string, activityType: string = "run") {
  if (Platform.OS === "web") return;
  const isRide = activityType === "ride";
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return;

    const oneHour = new Date(runDate.getTime() - 60 * 60 * 1000);
    const tenMin = new Date(runDate.getTime() - 10 * 60 * 1000);
    const now = new Date();

    if (oneHour > now) {
      await Notifications.scheduleNotificationAsync({
        content: { title: isRide ? "🚴 Ride in 1 hour" : "🏃 Run in 1 hour", body: `${label} — get warmed up!` },
        trigger: { date: oneHour } as any,
      });
    }
    if (tenMin > now) {
      await Notifications.scheduleNotificationAsync({
        content: { title: isRide ? "🚴 Starting soon!" : "🏃 Starting soon!", body: `${label} — 10 minutes to go.` },
        trigger: { date: tenMin } as any,
      });
    }
  } catch (_) {}
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function Bar({ value, total, color }: { value: number; total: number; color?: string }) {
  const { C } = useTheme();
  const pct = Math.min(1, total > 0 ? value / total : 0);
  const barColor = color ?? C.primary;
  return (
    <View style={[barStyle.track, { backgroundColor: C.border }]}>
      <View style={[barStyle.fill, { width: `${pct * 100}%` as any, backgroundColor: barColor }]} />
    </View>
  );
}

const barStyle = StyleSheet.create({
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 4 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SoloScreen() {
  const insets = useSafeAreaInsets();
  const { user, refreshUser } = useAuth();
  const { data: buddyData } = useQuery<{ eligible: boolean; groupRuns: number; soloRuns: number; suggestions: any[] }>({
    queryKey: ["/api/users/buddy-suggestions"],
    enabled: !!user && ((user as any).gender === "Man" || (user as any).gender === "Woman"),
  });
  const buddyEligible = buddyData?.eligible ?? false;
  const buddies = buddyData?.suggestions ?? [];
  const { activityFilter, setActivityFilter } = useActivity();
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const qc = useQueryClient();
  const [ghostSoloDone, setGhostSoloDone] = useState(true);

  useEffect(() => {
    if (!user) return;
    const key = `paceup_draft_run_${user.id}`;
    AsyncStorage.getItem(key).then(async (raw) => {
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const savedToken = await AsyncStorage.getItem(`paceup_saved_draft_${user.id}`);
      if (savedToken && parsed.draftId && savedToken === parsed.draftId) {
        await AsyncStorage.removeItem(key).catch(() => {});
        await AsyncStorage.removeItem(`paceup_saved_draft_${user.id}`).catch(() => {});
        return null;
      }
      return raw;
    }).then((raw) => {
      if (!raw) return;
      try {
        const draft = JSON.parse(raw);
        const age = Date.now() - new Date(draft.timestamp).getTime();
        if (age > 24 * 60 * 60 * 1000) {
          AsyncStorage.removeItem(key).catch(() => {});
          return;
        }
        const mins = Math.round(age / 60000);
        const agoStr = mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
        const distStr = draft.distanceMi > 0 ? toDisplayDist(draft.distanceMi, distUnit) : "a";
        Alert.alert(
          "Unsaved Activity",
          `You have an unsaved ${draft.activityType ?? "run"} (${distStr}, ${agoStr}). Save it?`,
          [
            {
              text: "Discard",
              style: "destructive",
              onPress: () => AsyncStorage.removeItem(key).catch(() => {}),
            },
            {
              text: "Save",
              onPress: async () => {
                try {
                  const pace = draft.durationSeconds > 0 && draft.distanceMi > 0.01
                    ? (draft.durationSeconds / 60) / draft.distanceMi
                    : null;
                  await apiRequest("POST", "/api/solo-runs", {
                    title: `${toDisplayDist(draft.distanceMi, distUnit)} solo ${draft.activityType ?? "run"}`,
                    date: draft.timestamp,
                    distanceMiles: Math.max(draft.distanceMi, 0.001),
                    paceMinPerMile: pace,
                    durationSeconds: draft.durationSeconds,
                    completed: true,
                    planned: false,
                    routePath: draft.routePath && draft.routePath.length > 1 ? draft.routePath : null,
                    activityType: draft.activityType ?? "run",
                    mileSplits: draft.splits && draft.splits.length > 0 ? draft.splits : null,
                    elevationGainFt: draft.elevationGainFt > 0 ? Math.round(draft.elevationGainFt) : null,
                  });
                  if (draft.draftId) {
                    await AsyncStorage.setItem(`paceup_saved_draft_${user!.id}`, draft.draftId);
                  }
                  await AsyncStorage.removeItem(key);
                  qc.invalidateQueries({ queryKey: ["/api/solo-runs"] });
                  qc.invalidateQueries({ queryKey: ["/api/runs/mine"] });
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                } catch (e: any) {
                  Alert.alert("Save Failed", e?.message ?? "Could not save the run");
                }
              },
            },
          ]
        );
      } catch { AsyncStorage.removeItem(key).catch(() => {}); }
    }).catch(() => {});
  }, [user?.id]);

  const [showGoals, setShowGoals] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(true);
  const [historyFilter, setHistoryFilter] = useState<"all" | "favorites" | "longest" | "fastest">("all");
  const [selectedScheduled, setSelectedScheduled] = useState<SoloRun | null>(null);
  const [selectedSavedPath, setSelectedSavedPath] = useState<SavedPath | null>(null);
  const [editingScheduledTitle, setEditingScheduledTitle] = useState(false);
  const [scheduledTitleDraft, setScheduledTitleDraft] = useState("");
  const [editingPathName, setEditingPathName] = useState(false);
  const [pathNameDraft, setPathNameDraft] = useState("");

  // Goals display period (UI toggle only — not saved separately)
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");

  // Goals form state
  const [gPace, setGPace] = useState("");
  const [gMonthDist, setGMonthDist] = useState("");
  const [gYearDist, setGYearDist] = useState("");

  // Plan form state
  const [pTitle, setPTitle] = useState("");
  const [pDate, setPDate] = useState(tomorrowStr());
  const [pTime, setPTime] = useState("7:00");
  const [pAmPm, setPAmPm] = useState<"AM" | "PM">("AM");
  const [pDist, setPDist] = useState("");
  const [pPace, setPPace] = useState("");
  const [pNotify, setPNotify] = useState(true);
  const [saving, setSaving] = useState(false);

  const { data: soloRuns = [], isLoading } = useQuery<SoloRun[]>({
    queryKey: ["/api/solo-runs"],
    enabled: !!user,
    staleTime: 30_000,
  });

  const { data: savedPaths = [] } = useQuery<SavedPath[]>({
    queryKey: ["/api/saved-paths"],
    enabled: !!user,
    staleTime: 30_000,
  });

  const filteredSavedPaths = useMemo(
    () => savedPaths.filter((p) => (p.activity_type ?? "run") === activityFilter),
    [savedPaths, activityFilter]
  );

  const { data: pathRuns = [], isLoading: pathRunsLoading } = useQuery<SoloRun[]>({
    queryKey: ["/api/saved-paths", selectedSavedPath?.id, "runs"],
    enabled: !!selectedSavedPath,
    staleTime: 30_000,
  });

  const pathStats = useMemo(() => {
    const paces = pathRuns.map(r => r.pace_min_per_mile).filter((p): p is number => !!p && p > 0);
    const dists = pathRuns.map(r => r.distance_miles).filter(d => d > 0);
    const times = pathRuns.map(r => r.duration_seconds).filter((t): t is number => !!t && t > 0);
    return {
      bestPace: paces.length ? Math.min(...paces) : null,
      bestDist: dists.length ? Math.max(...dists) : null,
      bestTime: times.length ? Math.max(...times) : null,
      actType: pathRuns[0]?.activity_type ?? "run",
    };
  }, [pathRuns]);

  const deletePathMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/saved-paths/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/saved-paths"] }),
  });

  const renameRunMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const res = await apiRequest("PUT", `/api/solo-runs/${id}`, { title });
      return res.json();
    },
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["/api/solo-runs"] });
      setSelectedScheduled((prev) => prev ? { ...prev, title: updated.title } : prev);
      setEditingScheduledTitle(false);
    },
  });

  const renamePathMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await apiRequest("PATCH", `/api/saved-paths/${id}`, { name });
      return res.json();
    },
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["/api/saved-paths"] });
      setSelectedSavedPath((prev) => prev ? { ...prev, name: updated.name } : prev);
      setEditingPathName(false);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/solo-runs", data);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/solo-runs"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/solo-runs/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/solo-runs"] }),
  });

  const starMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/solo-runs/${id}/star`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/solo-runs"] });
      qc.invalidateQueries({ queryKey: ["/api/solo-runs/starred"] });
    },
  });

  const goalsMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PUT", "/api/users/me/goals", data);
      return res.json();
    },
    onSuccess: () => { refreshUser(); setShowGoals(false); },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  // ─── Rankings ───────────────────────────────────────────────────────────────

  const filteredSoloRuns = useMemo(
    () => soloRuns.filter((r) => (r.activity_type ?? "run") === activityFilter),
    [soloRuns, activityFilter]
  );

  const scheduledRuns = useMemo(
    () => filteredSoloRuns.filter((r) => r.planned && !r.completed).sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    ),
    [filteredSoloRuns]
  );

  const historyRuns = useMemo(
    () => filteredSoloRuns.filter((r) => r.completed),
    [filteredSoloRuns]
  );

  const displayedRuns = useMemo(() => {
    if (historyFilter === "favorites") return historyRuns.filter((r) => r.is_starred);
    if (historyFilter === "longest") return [...historyRuns].sort((a, b) => b.distance_miles - a.distance_miles);
    if (historyFilter === "fastest") return [...historyRuns].filter((r) => r.pace_min_per_mile != null).sort((a, b) => (a.pace_min_per_mile ?? 99) - (b.pace_min_per_mile ?? 99));
    return historyRuns;
  }, [historyRuns, historyFilter]);

  const historySections = useMemo(() => {
    if (!showHistory || displayedRuns.length === 0) return [];
    const groups: Record<string, SoloRun[]> = {};
    const order: string[] = [];
    for (const run of displayedRuns) {
      const d = new Date(run.date);
      const key = `${d.toLocaleString("en-US", { month: "long" })} ${d.getFullYear()}`;
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(run);
    }
    return order.map((title) => ({ title, data: groups[title] }));
  }, [displayedRuns, showHistory]);

  useEffect(() => {
    if (!user?.id) return;
    AsyncStorage.getItem(`paceup_ghost_solo_done_${user.id}`).then((v) => {
      setGhostSoloDone(v === "true");
    });
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || ghostSoloDone) return;
    if (historyRuns.length > 0) {
      setGhostSoloDone(true);
      AsyncStorage.setItem(`paceup_ghost_solo_done_${user.id}`, "true");
    }
  }, [historyRuns.length, user?.id, ghostSoloDone]);

  const completedRuns = useMemo(
    () => filteredSoloRuns.filter((r) => r.completed && r.pace_min_per_mile),
    [filteredSoloRuns]
  );

  const rankings = useMemo<RankingCategory[]>(() => {
    return DISTANCE_CATEGORIES.map((cat) => {
      const qualifying = completedRuns
        .filter((r) => Math.abs(r.distance_miles - cat.miles) <= cat.tolerance)
        .sort((a, b) => (a.pace_min_per_mile ?? 99) - (b.pace_min_per_mile ?? 99));
      return qualifying.length > 0 ? { ...cat, runs: qualifying } : null;
    }).filter(Boolean) as RankingCategory[];
  }, [completedRuns]);

  const runBadges = useMemo(() => {
    const map: Record<string, { rank: number; category: string }> = {};
    for (const cat of rankings) {
      cat.runs.slice(0, 3).forEach((r, i) => {
        if (!map[r.id]) map[r.id] = { rank: i + 1, category: cat.label };
      });
    }
    return map;
  }, [rankings]);

  // ─── Goal values ────────────────────────────────────────────────────────────

  const distGoal = period === "monthly" ? (user?.monthly_goal ?? 50) : (user?.yearly_goal ?? 500);
  const paceGoal = user?.pace_goal ?? null;
  const currentMiles = period === "monthly" ? (user?.miles_this_month ?? 0) : (user?.miles_this_year ?? 0);
  const distUnit: DistanceUnit = ((user as any)?.distance_unit ?? "miles") as DistanceUnit;
  const currentPace = user?.avg_pace ?? 0;

  // ─── Open goals modal ────────────────────────────────────────────────────────

  function openGoals() {
    setGPace(paceGoal != null ? formatPace(paceGoal) : "");
    setGMonthDist((user?.monthly_goal ?? 50).toString());
    setGYearDist((user?.yearly_goal ?? 500).toString());
    setShowGoals(true);
  }

  function saveGoals() {
    const pace = gPace.trim() ? parsePaceInput(gPace) : null;
    const monthlyGoal = parseFloat(gMonthDist) || 50;
    const yearlyGoal = parseFloat(gYearDist) || 500;
    goalsMutation.mutate({ monthlyGoal, yearlyGoal, paceGoal: pace });
  }

  // ─── Plan run save ───────────────────────────────────────────────────────────

  async function savePlan() {
    const dist = parseFloat(pDist);
    if (isNaN(dist) || dist <= 0) { Alert.alert("Invalid", "Enter a valid distance"); return; }
    const parsedDate = parseDMY(pDate.trim());
    if (!parsedDate) { Alert.alert("Invalid", "Enter a valid date (MM/DD/YY)"); return; }
    const parsedTime = parseHHMMAMPM(pTime.trim(), pAmPm);
    if (!parsedTime) { Alert.alert("Invalid", "Enter a valid time (e.g. 7:30)"); return; }
    parsedDate.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
    const runDate = parsedDate;
    if (isNaN(runDate.getTime())) { Alert.alert("Invalid", "Invalid date or time"); return; }

    setSaving(true);
    try {
      const pace = pPace.trim() ? parsePaceInput(pPace) : null;
      const label = pTitle.trim() || `${toDisplayDist(dist, distUnit)} solo ${activityFilter === "ride" ? "ride" : activityFilter === "walk" ? "walk" : "run"}`;
      await saveMutation.mutateAsync({
        title: label,
        date: runDate.toISOString(),
        distanceMiles: dist,
        paceMinPerMile: pace,
        planned: true,
        completed: false,
        activityType: activityFilter,
      });
      if (pNotify) await scheduleRunNotifications(runDate, label, activityFilter);
      setShowPlan(false);
      setPTitle(""); setPDate(tomorrowStr()); setPTime("7:00"); setPAmPm("AM"); setPDist(""); setPPace("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(id: string) {
    const type = activityFilter === "ride" ? "Ride" : activityFilter === "walk" ? "Walk" : "Run";
    Alert.alert(`Delete ${type}`, `Remove this ${type.toLowerCase()} from your history?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate(id) },
    ]);
  }

  function confirmDeletePath(id: string) {
    Alert.alert("Delete Path", "Remove this saved path?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deletePathMutation.mutate(id) },
    ]);
  }

  if (!user) {
    return (
      <View style={[s.container, { justifyContent: "center", alignItems: "center", paddingTop: insets.top }]}>
        <Feather name="lock" size={36} color={C.textMuted} />
        <Text style={s.emptyText}>Sign in to track your activities</Text>
        <Pressable style={s.loginBtn} onPress={() => router.push("/(auth)/login")}>
          <Text style={s.loginBtnTxt}>Sign In</Text>
        </Pressable>
      </View>
    );
  }

  const goalPct = Math.min(1, distGoal > 0 ? currentMiles / distGoal : 0);
  const periodLabel = period === "monthly" ? "This Month" : "This Year";

  const renderHistoryItem = useCallback(({ item: run }: { item: SoloRun }) => {
    const badge = runBadges[run.id];
    const label = run.title || `${toDisplayDist(run.distance_miles, distUnit)} ${run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run"}`;
    const isExpanded = expandedRunId === run.id;
    return (
      <View style={s.historyCard}>
        <View style={s.historyRow}>
          <Pressable
            style={({ pressed }) => [s.historyLeft, { opacity: pressed ? 0.85 : 1 }]}
            onPress={() => run.completed && setExpandedRunId(isExpanded ? null : run.id)}
            onLongPress={() => confirmDelete(run.id)}
          >
            <View style={[
              s.historyStatus,
              { backgroundColor: run.completed ? C.primary + "22" : run.planned ? C.blue + "22" : C.border },
            ]}>
              <Feather
                name={run.completed ? "check" : run.planned ? "calendar" : "circle"}
                size={12}
                color={run.completed ? C.primary : run.planned ? C.blue : C.textMuted}
              />
            </View>
            <View style={{ flex: 1 }}>
              <View style={s.historyTitleRow}>
                <Text style={s.historyTitle} numberOfLines={1}>{label}</Text>
                {(run.source === "garmin" || run.garmin_activity_id) && (
                  <View style={[s.sourceBadge, { backgroundColor: "#009CDE22" }]}>
                    <FontAwesome5 name="satellite-dish" size={8} color="#009CDE" />
                  </View>
                )}
                {(run.source === "apple_health" || run.apple_health_id) && (
                  <View style={[s.sourceBadge, { backgroundColor: "#FF3B3022" }]}>
                    <Ionicons name="heart" size={9} color="#FF3B30" />
                  </View>
                )}
                {badge && (
                  <Text style={s.historyBadge}>{RANK_EMOJI[badge.rank - 1]}</Text>
                )}
              </View>
              <Text style={s.historyMeta}>
                {formatDisplayDate(run.date)}
                {run.pace_min_per_mile ? ` · ${toDisplayPace(run.pace_min_per_mile, distUnit)}` : ""}
                {run.duration_seconds ? ` · ${formatDuration(run.duration_seconds)}` : ""}
              </Text>
            </View>
          </Pressable>
          <View style={s.historyRight}>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                starMutation.mutate(run.id);
              }}
              hitSlop={12}
              style={{ padding: 4 }}
            >
              <Ionicons
                name={run.is_starred ? "star" : "star-outline"}
                size={18}
                color={run.is_starred ? C.gold : C.textMuted}
              />
            </Pressable>
            <Text style={s.historyDist}>{toDisplayDist(run.distance_miles, distUnit)}</Text>
            {run.completed && (
              <Pressable
                onPress={() => setExpandedRunId(isExpanded ? null : run.id)}
                hitSlop={8}
              >
                <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color={C.textMuted} />
              </Pressable>
            )}
          </View>
        </View>
        {run.route_path && run.route_path.length > 1 && Platform.OS !== "web" && (
          <MiniRouteMap path={run.route_path} />
        )}
        {isExpanded && (
          <View style={s.statsPanel}>
            <View style={s.statRow}>
              {run.duration_seconds != null && (
                <View style={s.statItem}>
                  <Feather name="clock" size={13} color={C.primary} />
                  <Text style={s.statLabel}>Time</Text>
                  <Text style={s.statValue}>{formatDuration(run.duration_seconds)}</Text>
                </View>
              )}
              {run.pace_min_per_mile != null && (
                <View style={s.statItem}>
                  <Feather name="zap" size={13} color={C.primary} />
                  <Text style={s.statLabel}>Pace</Text>
                  <Text style={s.statValue}>{toDisplayPace(run.pace_min_per_mile, distUnit)}</Text>
                </View>
              )}
              <View style={s.statItem}>
                <Feather name="map-pin" size={13} color={C.primary} />
                <Text style={s.statLabel}>Distance</Text>
                <Text style={s.statValue}>{toDisplayDist(run.distance_miles, distUnit)}</Text>
              </View>
              {run.elevation_gain_ft != null && (
                <View style={s.statItem}>
                  <Feather name="trending-up" size={13} color={C.primary} />
                  <Text style={s.statLabel}>Elevation</Text>
                  <Text style={s.statValue}>{Math.round(run.elevation_gain_ft)} ft</Text>
                </View>
              )}
            </View>
          </View>
        )}
        {isExpanded && run.mile_splits && run.mile_splits.length > 0 && (
          <View style={{ paddingHorizontal: 12, paddingBottom: 14 }}>
            <MileSplitsChart splits={run.mile_splits} activityType={run.activity_type} />
          </View>
        )}
        {isExpanded && run.completed && (!run.mile_splits || run.mile_splits.length === 0) && (
          <View style={{ paddingHorizontal: 12, paddingBottom: 12, alignItems: "center" }}>
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, textAlign: "center" }}>
              {`Splits available for activities of 1+ ${unitLabel(distUnit)}`}
            </Text>
          </View>
        )}
      </View>
    );
  }, [expandedRunId, runBadges, distUnit, C, s]);

  const renderSectionHeader = useCallback(({ section }: { section: { title: string } }) => (
    <View style={[s.monthHeader, { backgroundColor: C.bg }]}>
      <Text style={[s.monthHeaderTxt, { color: C.textSecondary }]}>{section.title}</Text>
    </View>
  ), [C, s]);

  const listHeaderComponent = useMemo(() => (
    <>
      {/* ─── Header ─────────────────────────────────────────────────── */}
      <View style={s.headerRow}>
        <View>
          <Text style={s.screenTitle}>Solo</Text>
          <Text style={s.screenSub}>Your personal {activityFilter === "ride" ? "riding" : activityFilter === "walk" ? "walking" : "running"}</Text>
        </View>
        <Pressable style={s.planBtn} onPress={() => setShowPlan(true)}>
          <Feather name="plus" size={18} color={C.bg} />
          <Text style={s.planBtnTxt}>{activityFilter === "ride" ? "Plan Ride" : activityFilter === "walk" ? "Plan Walk" : "Plan Run"}</Text>
        </Pressable>
      </View>

      {/* ─── Activity Toggle ─────────────────────────────────────────── */}
      <View style={s.activityToggleRow}>
        <Pressable
          style={[s.activityPill, activityFilter === "run" && s.activityPillActive]}
          onPress={() => { setActivityFilter("run"); Haptics.selectionAsync(); }}
        >
          <Ionicons name="walk" size={14} color={activityFilter === "run" ? C.bg : C.textMuted} />
          <Text style={[s.activityPillTxt, activityFilter === "run" && s.activityPillTxtActive]}>Runs</Text>
        </Pressable>
        <Pressable
          style={[s.activityPill, activityFilter === "ride" && s.activityPillActive]}
          onPress={() => { setActivityFilter("ride"); Haptics.selectionAsync(); }}
        >
          <Ionicons name="bicycle" size={14} color={activityFilter === "ride" ? C.bg : C.textMuted} />
          <Text style={[s.activityPillTxt, activityFilter === "ride" && s.activityPillTxtActive]}>Rides</Text>
        </Pressable>
        <Pressable
          style={[s.activityPill, activityFilter === "walk" && s.activityPillActive]}
          onPress={() => { setActivityFilter("walk"); Haptics.selectionAsync(); }}
        >
          <Ionicons name="footsteps" size={14} color={activityFilter === "walk" ? C.bg : C.textMuted} />
          <Text style={[s.activityPillTxt, activityFilter === "walk" && s.activityPillTxtActive]}>Walks</Text>
        </Pressable>
      </View>

      {buddyEligible && buddies.length > 0 && (
        <View style={{ marginTop: 24, paddingHorizontal: 4 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text }}>Find a Buddy</Text>
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary }}>Matches for you</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>
            {buddies.map((buddy) => (
              <Pressable
                key={buddy.id}
                style={{
                  width: 140, backgroundColor: C.surface, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: C.border,
                  alignItems: "center",
                }}
                onPress={() => router.push(`/user-profile/${buddy.id}`)}
              >
                <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: C.card, marginBottom: 8, overflow: "hidden" }}>
                  {buddy.photo_url ? (
                    <Image source={{ uri: buddy.photo_url }} style={{ width: "100%", height: "100%" }} />
                  ) : (
                    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                      <Feather name="user" size={30} color={C.textMuted} />
                    </View>
                  )}
                </View>
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text, textAlign: "center" }} numberOfLines={1}>
                  {buddy.name}
                </Text>
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary, marginBottom: 8 }} numberOfLines={1}>
                  @{buddy.username}
                </Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: "auto" }}>
                  <View style={{ alignItems: "center" }}>
                    <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 10, color: C.primary }}>{buddy.avg_pace || "10:00"}</Text>
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 8, color: C.textMuted }}>PACE</Text>
                  </View>
                  <View style={{ width: 1, height: 16, backgroundColor: C.border }} />
                  <View style={{ alignItems: "center" }}>
                    <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 10, color: C.orange }}>{buddy.avg_distance || "3"}mi</Text>
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 8, color: C.textMuted }}>DIST</Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

        {/* ─── Goal Card ──────────────────────────────────────────────── */}
        <View style={s.goalCard}>
          <View style={s.goalCardTop}>
            <Text style={s.goalCardTitle}>My Goals</Text>
            <Pressable style={s.editGoalsBtn} onPress={openGoals}>
              <Feather name="edit-2" size={13} color={C.primary} />
              <Text style={s.editGoalsTxt}>Edit</Text>
            </Pressable>
          </View>

          {/* Period Toggle */}
          <View style={s.periodRow}>
            {(["monthly", "yearly"] as const).map((p) => (
              <Pressable
                key={p}
                style={[s.periodBtn, period === p && s.periodBtnOn]}
                onPress={() => { setPeriod(p); Haptics.selectionAsync(); }}
              >
                <Text style={[s.periodBtnTxt, period === p && s.periodBtnTxtOn]}>
                  {p === "monthly" ? "Monthly" : "Yearly"}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Distance goal */}
          <View style={s.goalSection}>
            <View style={s.goalRow}>
              <View style={s.goalLabelRow}>
                <Feather name="map" size={14} color={C.blue} />
                <Text style={s.goalLabel}>Distance Goal</Text>
              </View>
              <Text style={s.goalValues}>
                <Text style={s.goalCurrent}>{toDisplayDist(currentMiles, distUnit).split(" ")[0]}</Text>
                <Text style={s.goalSlash}> / {toDisplayDist(distGoal, distUnit)}</Text>
              </Text>
            </View>
            <Bar value={currentMiles} total={distGoal} color={C.blue} />
            <View style={s.goalFooterRow}>
              <Text style={s.goalPct}>{Math.round(goalPct * 100)}% complete</Text>
              <Text style={s.goalRemain}>
                {currentMiles >= distGoal
                  ? "🎉 Goal reached!"
                  : `${toDisplayDist(distGoal - currentMiles, distUnit)} to go`}
              </Text>
            </View>
          </View>

          {/* Pace goal */}
          <View style={[s.goalSection, { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 14, marginTop: 4 }]}>
            <View style={s.goalRow}>
              <View style={s.goalLabelRow}>
                <Ionicons name="walk" size={14} color={C.orange} />
                <Text style={s.goalLabel}>Avg Pace Goal</Text>
              </View>
              <Text style={s.goalValues}>
                <Text style={[s.goalCurrent, { color: paceGoal != null && currentPace <= paceGoal ? C.primary : C.orange }]}>
                  {formatPace(currentPace)}
                </Text>
                <Text style={s.goalSlash}>{paceGoal != null ? ` / ${toDisplayPace(paceGoal, distUnit)}` : ` /${unitLabel(distUnit)}`}</Text>
              </Text>
            </View>
            {paceGoal != null ? (
              <View style={s.paceCompare}>
                <Feather
                  name={currentPace <= paceGoal ? "check-circle" : "alert-circle"}
                  size={14}
                  color={currentPace <= paceGoal ? C.primary : C.orange}
                />
                <Text style={[s.paceCompareTxt, { color: currentPace <= paceGoal ? C.primary : C.orange }]}>
                  {currentPace <= paceGoal
                    ? `${formatPace(paceGoal - currentPace)} faster than goal`
                    : `${formatPace(currentPace - paceGoal)} slower than goal`}
                </Text>
              </View>
            ) : (
              <Text style={s.paceNoGoal}>Tap Edit to set a pace goal</Text>
            )}
          </View>
        </View>

        {/* ─── Run Solo CTA ────────────────────────────────────────────── */}
        <Pressable
          style={({ pressed }) => [s.runSoloBtn, { opacity: pressed ? 0.88 : 1 }]}
          onPress={() => router.push("/run-tracking" as any)}
        >
          <Ionicons name="play-circle" size={22} color={C.bg} />
          <Text style={s.runSoloBtnTxt}>{activityFilter === "ride" ? "Ride Solo" : activityFilter === "walk" ? "Walk Solo" : "Run Solo"}</Text>
        </Pressable>

        {/* ─── Scheduled Runs ──────────────────────────────────────────── */}
        {scheduledRuns.length > 0 && (
          <View style={[s.section, { marginTop: 5 }]}>
            <Text style={s.sectionTitle}>{activityFilter === "ride" ? "Scheduled Rides" : activityFilter === "walk" ? "Scheduled Walks" : "Scheduled Runs"}</Text>
            {scheduledRuns.map((run) => {
              const label = run.title || `${toDisplayDist(run.distance_miles, distUnit)} ${run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run"}`;
              return (
                <Pressable
                  key={run.id}
                  style={({ pressed }) => [s.scheduledCard, { opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => { Haptics.selectionAsync(); setSelectedScheduled(run); }}
                  onLongPress={() => confirmDelete(run.id)}
                >
                  <View style={s.scheduledIconWrap}>
                    <Feather name="calendar" size={16} color={C.blue} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.scheduledTitle} numberOfLines={1}>{label}</Text>
                    <Text style={s.scheduledDate}>{formatScheduledDateTime(run.date)}</Text>
                    <View style={s.scheduledChips}>
                      <View style={s.scheduledChip}>
                        <Feather name="map-pin" size={11} color={C.textMuted} />
                        <Text style={s.scheduledChipTxt}>{toDisplayDist(run.distance_miles, distUnit)}</Text>
                      </View>
                      {run.pace_min_per_mile ? (
                        <View style={s.scheduledChip}>
                          <Feather name="zap" size={11} color={C.textMuted} />
                          <Text style={s.scheduledChipTxt}>{toDisplayPace(run.pace_min_per_mile, distUnit)}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <Feather name="chevron-right" size={18} color={C.blue} />
                </Pressable>
              );
            })}
          </View>
        )}

        {/* ─── Saved Paths ──────────────────────────────────────────────── */}
        {filteredSavedPaths.length > 0 && (
          <View style={[s.section, { marginTop: 5 }]}>
            <Text style={s.sectionTitle}>Saved Paths</Text>
            {filteredSavedPaths.map((path) => (
              <Pressable
                key={path.id}
                style={({ pressed }) => [s.savedPathCard, { opacity: pressed ? 0.85 : 1 }]}
                onPress={() => { Haptics.selectionAsync(); setSelectedSavedPath(path); }}
                onLongPress={() => {
                  Alert.alert(
                    "Delete Path",
                    `Delete "${path.name}"? This won't delete your activity history.`,
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: "Delete", style: "destructive", onPress: () => deletePathMutation.mutate(path.id) },
                    ]
                  );
                }}
              >
                <View style={s.savedPathIconWrap}>
                  <Feather name="map" size={16} color={C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.savedPathName} numberOfLines={1}>{path.name}</Text>
                  {path.distance_miles != null && (
                    <Text style={s.savedPathMeta}>{toDisplayDist(path.distance_miles ?? 0, distUnit)}</Text>
                  )}
                </View>
                <Feather name="chevron-right" size={18} color={C.primary} />
              </Pressable>
            ))}
          </View>
        )}

        {/* ─── Rankings ────────────────────────────────────────────────── */}
        {rankings.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Performance Rankings</Text>
            {rankings.map((cat) => (
              <View key={cat.label} style={s.rankCard}>
                <View style={s.rankHeader}>
                  <Text style={s.rankCategory}>{cat.label}</Text>
                  <Text style={s.rankBest}>
                    Best: {cat.runs[0].pace_min_per_mile ? toDisplayPace(cat.runs[0].pace_min_per_mile, distUnit) : "—"}
                  </Text>
                </View>
                {cat.runs.slice(0, 3).map((run, i) => (
                  <View key={run.id} style={s.rankRow}>
                    <Text style={s.rankEmoji}>{RANK_EMOJI[i]}</Text>
                    <Text style={s.rankDate}>{formatDisplayDate(run.date)}</Text>
                    <Text style={s.rankDist}>{toDisplayDist(run.distance_miles, distUnit)}</Text>
                    <Text style={s.rankPace}>
                      {run.pace_min_per_mile ? toDisplayPace(run.pace_min_per_mile, distUnit) : "—"}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

      <View style={[s.section, { marginTop: 5 }]}>
        <Pressable
          style={s.historyHeaderRow}
          onPress={() => { setShowHistory((v) => !v); Haptics.selectionAsync(); }}
        >
          <Text style={[s.sectionTitle, { marginBottom: 0 }]}>{activityFilter === "ride" ? "Ride History" : activityFilter === "walk" ? "Walk History" : "Run History"}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {historyRuns.length > 0 && (
              <View style={s.historyCountBadge}>
                <Text style={s.historyCountTxt}>{historyRuns.length}</Text>
              </View>
            )}
            <Feather name={showHistory ? "chevron-up" : "chevron-down"} size={16} color={C.textMuted} />
          </View>
        </Pressable>

        {showHistory && isLoading && (
          <ActivityIndicator color={C.primary} style={{ marginTop: 20 }} />
        )}
        {showHistory && !isLoading && historyRuns.length === 0 && (
          <View style={s.emptyCard}>
            {!ghostSoloDone ? (
              <View style={s.ghostHistoryCard}>
                <View style={s.historyRow}>
                  <View style={s.historyLeft}>
                    <View style={[s.historyStatus, { backgroundColor: C.primary + "22" }]}>
                      <Feather name="check" size={12} color={C.primary + "80"} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.ghostHistoryTitle}>
                        {activityFilter === "ride" ? "Morning 14.0mi Ride" : activityFilter === "walk" ? "Morning 2.5mi Walk" : "Morning 3.1mi Run"}
                      </Text>
                      <Text style={s.ghostHistoryMeta}>
                        {activityFilter === "ride" ? "Today · 18.2 mph · 46:12" : activityFilter === "walk" ? "Today · 3.2 mph · 52:10" : "Today · 9:23/mi · 28:43"}
                      </Text>
                    </View>
                  </View>
                  <Text style={s.ghostHistoryDist}>
                    {activityFilter === "ride" ? "14.0" : activityFilter === "walk" ? "2.5" : "3.1"}
                  </Text>
                </View>
                <Svg width="100%" height={44} viewBox="0 0 160 44" style={{ marginTop: 8, marginBottom: 4 }}>
                  <SvgPolyline
                    points="8,36 22,18 38,28 54,10 70,22 86,8 102,20 118,12 134,24 150,8"
                    fill="none"
                    stroke={C.primary + "50"}
                    strokeWidth={8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <SvgPolyline
                    points="8,36 22,18 38,28 54,10 70,22 86,8 102,20 118,12 134,24 150,8"
                    fill="none"
                    stroke={C.primary + "90"}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
                <View style={s.ghostTipRow}>
                  <Feather name="info" size={10} color={C.textMuted} />
                  <Text style={s.ghostHistoryTip}>Your runs save here — every route, pace, and split</Text>
                </View>
              </View>
            ) : (
              <View style={{ alignItems: "center", paddingVertical: 24 }}>
                <Feather name="activity" size={28} color={C.textMuted} />
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 15, color: C.textMuted, marginTop: 10, textAlign: "center" }}>
                  {activityFilter === "ride" ? "No rides yet — start your first one!" : activityFilter === "walk" ? "No walks yet — start your first one!" : "No runs yet — start your first one!"}
                </Text>
              </View>
            )}
            <Pressable
              style={s.emptyCtaBtn}
              onPress={() => router.push("/run-tracking")}
            >
              <Text style={s.emptyCtaBtnText}>{activityFilter === "ride" ? "Track New Ride" : activityFilter === "walk" ? "Track New Walk" : "Track New Run"}</Text>
            </Pressable>
          </View>
        )}
        {showHistory && !isLoading && historyRuns.length > 0 && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4, paddingHorizontal: 2 }} style={{ marginBottom: 10 }}>
              {(["all", "favorites", "longest", "fastest"] as const).map((f) => {
                const labels = { all: "All", favorites: "Favorites", longest: "Longest", fastest: "Fastest" };
                const active = historyFilter === f;
                return (
                  <Pressable
                    key={f}
                    style={[s.historyFilterChip, active && s.historyFilterChipActive]}
                    onPress={() => { setHistoryFilter(f); Haptics.selectionAsync(); }}
                  >
                    <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: active ? C.primary : C.textSecondary }}>{labels[f]}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {displayedRuns.length === 0 && (
              <View style={{ padding: 16, alignItems: "center" }}>
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textMuted, textAlign: "center" }}>
                  {historyFilter === "favorites" ? "No starred runs yet — tap ★ to save a favourite" : "No runs to show"}
                </Text>
              </View>
            )}
          </>
        )}
      </View>
    </>
  ), [activityFilter, C, s, buddyEligible, buddies, goalPct, distGoal, currentMiles, currentPace, paceGoal, period, distUnit, scheduledRuns, filteredSavedPaths, rankings, historyRuns, showHistory, isLoading, ghostSoloDone, historyFilter, displayedRuns]);

  return (
    <View style={[s.container, { backgroundColor: C.bg }]}>
      <SectionList
        sections={historySections}
        keyExtractor={(item) => item.id}
        renderItem={renderHistoryItem}
        renderSectionHeader={renderSectionHeader}
        ListHeaderComponent={listHeaderComponent}
        contentContainerStyle={[
          s.scroll,
          {
            paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16),
            paddingBottom: insets.bottom + 120,
          },
        ]}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
      />

      {/* ─── Edit Goals Modal ─────────────────────────────────────────── */}
      <Modal visible={showGoals} transparent animationType="slide" onRequestClose={() => setShowGoals(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Pressable style={s.overlay} onPress={() => setShowGoals(false)} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>Edit Goals</Text>
            <Pressable onPress={() => setShowGoals(false)} hitSlop={12}>
              <Feather name="x" size={22} color={C.textSecondary} />
            </Pressable>
          </View>

          <Text style={s.inputLabel}>Monthly Distance Goal (miles)</Text>
          <TextInput
            style={s.input}
            value={gMonthDist}
            onChangeText={setGMonthDist}
            placeholder="50"
            placeholderTextColor={C.textMuted}
            keyboardType="numeric"
          />

          <Text style={s.inputLabel}>Yearly Distance Goal (miles)</Text>
          <TextInput
            style={s.input}
            value={gYearDist}
            onChangeText={setGYearDist}
            placeholder="500"
            placeholderTextColor={C.textMuted}
            keyboardType="numeric"
          />

          <Text style={s.inputLabel}>Pace Goal (min:sec per mile, optional)</Text>
          <TextInput
            style={s.input}
            value={gPace}
            onChangeText={setGPace}
            placeholder="8:30"
            placeholderTextColor={C.textMuted}
            keyboardType="numbers-and-punctuation"
          />

          <View style={s.sheetFooter}>
            <Pressable style={s.resetBtn} onPress={() => setShowGoals(false)}>
              <Text style={s.resetTxt}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[s.applyBtn, goalsMutation.isPending && { opacity: 0.7 }]}
              onPress={saveGoals}
              disabled={goalsMutation.isPending}
            >
              {goalsMutation.isPending
                ? <ActivityIndicator size="small" color={C.bg} />
                : <Text style={s.applyTxt}>Save Goals</Text>}
            </Pressable>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Plan Run Modal ───────────────────────────────────────────── */}
      <Modal visible={showPlan} transparent animationType="slide" onRequestClose={() => setShowPlan(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Pressable style={s.overlay} onPress={() => setShowPlan(false)} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>{activityFilter === "ride" ? "Plan a Solo Ride" : activityFilter === "walk" ? "Plan a Solo Walk" : "Plan a Solo Run"}</Text>
            <Pressable onPress={() => setShowPlan(false)} hitSlop={12}>
              <Feather name="x" size={22} color={C.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={s.inputLabel}>Title (optional)</Text>
            <TextInput
              style={s.input}
              value={pTitle}
              onChangeText={setPTitle}
              placeholder={activityFilter === "ride" ? "Morning group ride" : activityFilter === "walk" ? "Morning walk" : "Morning tempo run"}
              placeholderTextColor={C.textMuted}
            />

            <Text style={s.inputLabel}>Date & Time *</Text>
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
              <TextInput
                style={[s.input, { flex: 1, marginBottom: 0 }]}
                value={pDate}
                onChangeText={(text) => {
                  const digits = text.replace(/\D/g, "").slice(0, 6);
                  let fmt = digits;
                  if (digits.length > 2) fmt = digits.slice(0, 2) + "/" + digits.slice(2);
                  if (digits.length > 4) fmt = digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4);
                  setPDate(fmt);
                }}
                placeholder="MM/DD/YY"
                placeholderTextColor={C.textMuted}
                keyboardType="number-pad"
                maxLength={8}
              />
              <View style={{ flex: 1, flexDirection: "row", gap: 6 }}>
                <TextInput
                  style={[s.input, { flex: 1, marginBottom: 0 }]}
                  value={pTime}
                  onChangeText={(text) => {
                    const digits = text.replace(/\D/g, "").slice(0, 4);
                    setPTime(autoFormatTime(digits));
                  }}
                  placeholder="7:30"
                  placeholderTextColor={C.textMuted}
                  keyboardType="number-pad"
                  maxLength={5}
                />
                <View style={{ flexDirection: "column", gap: 4 }}>
                  {(["AM", "PM"] as const).map((period) => (
                    <Pressable
                      key={period}
                      onPress={() => { setPAmPm(period); Haptics.selectionAsync(); }}
                      style={{
                        flex: 1, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1,
                        alignItems: "center", justifyContent: "center",
                        backgroundColor: pAmPm === period ? C.primary + "33" : C.surface,
                        borderColor: pAmPm === period ? C.primary : C.border,
                      }}
                    >
                      <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 12, color: pAmPm === period ? C.primary : C.textMuted }}>{period}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>

            <Text style={s.inputLabel}>Distance (miles)</Text>
            <TextInput
              style={s.input}
              value={pDist}
              onChangeText={setPDist}
              placeholder="5.0"
              placeholderTextColor={C.textMuted}
              keyboardType="decimal-pad"
            />

            <Text style={s.inputLabel}>Target Pace (min:sec /{unitLabel(distUnit)}, optional)</Text>
            <TextInput
              style={s.input}
              value={pPace}
              onChangeText={setPPace}
              placeholder="8:30"
              placeholderTextColor={C.textMuted}
              keyboardType="numbers-and-punctuation"
            />

            {Platform.OS !== "web" && (
              <Pressable
                style={s.notifyRow}
                onPress={() => setPNotify((v) => !v)}
              >
                <View style={[s.notifyCheck, pNotify && s.notifyCheckOn]}>
                  {pNotify && <Feather name="check" size={12} color={C.bg} />}
                </View>
                <Text style={s.notifyLabel}>
                  Remind me 1 hour &amp; 10 minutes before
                </Text>
              </Pressable>
            )}

            <View style={s.sheetFooter}>
              <Pressable style={s.resetBtn} onPress={() => setShowPlan(false)}>
                <Text style={s.resetTxt}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.applyBtn, saving && { opacity: 0.7 }]}
                onPress={savePlan}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator size="small" color={C.bg} />
                  : <Text style={s.applyTxt}>Save Plan</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ─── Start Scheduled Run Modal ────────────────────────────────── */}
      <Modal
        visible={!!selectedScheduled}
        transparent
        animationType="slide"
        onRequestClose={() => { setSelectedScheduled(null); setEditingScheduledTitle(false); }}
      >
        <Pressable style={s.overlay} onPress={() => { setSelectedScheduled(null); setEditingScheduledTitle(false); }} />
        {selectedScheduled && (
          <View style={[s.sheet, { paddingBottom: insets.bottom + 28 }]}>
            <View style={s.sheetHandle} />

            {/* Header */}
            <View style={s.sheetHeader}>
              <View style={s.scheduledModalIcon}>
                <Feather name="calendar" size={18} color={C.blue} />
              </View>
              <Pressable onPress={() => { setSelectedScheduled(null); setEditingScheduledTitle(false); }} hitSlop={12}>
                <Feather name="x" size={22} color={C.textSecondary} />
              </Pressable>
            </View>

            {/* Title */}
            {editingScheduledTitle ? (
              <View style={s.inlineEditRow}>
                <TextInput
                  style={s.inlineEditInput}
                  value={scheduledTitleDraft}
                  onChangeText={setScheduledTitleDraft}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (scheduledTitleDraft.trim()) renameRunMutation.mutate({ id: selectedScheduled.id, title: scheduledTitleDraft.trim() });
                    else setEditingScheduledTitle(false);
                  }}
                  placeholderTextColor={C.textMuted}
                />
                <Pressable
                  onPress={() => {
                    if (scheduledTitleDraft.trim()) renameRunMutation.mutate({ id: selectedScheduled.id, title: scheduledTitleDraft.trim() });
                    else setEditingScheduledTitle(false);
                  }}
                  hitSlop={10}
                  style={s.inlineEditSave}
                >
                  <Feather name="check" size={18} color={C.primary} />
                </Pressable>
                <Pressable onPress={() => setEditingScheduledTitle(false)} hitSlop={10}>
                  <Feather name="x" size={16} color={C.textMuted} />
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={s.inlineTitleRow}
                onPress={() => {
                  const current = selectedScheduled.title ||
                    `${toDisplayDist(selectedScheduled.distance_miles, distUnit)} solo ${selectedScheduled.activity_type === "ride" ? "ride" : selectedScheduled.activity_type === "walk" ? "walk" : "run"}`;
                  setScheduledTitleDraft(current);
                  setEditingScheduledTitle(true);
                }}
              >
                <Text style={s.scheduledModalTitle} numberOfLines={2}>
                  {selectedScheduled.title ||
                    `${toDisplayDist(selectedScheduled.distance_miles, distUnit)} solo ${selectedScheduled.activity_type === "ride" ? "ride" : selectedScheduled.activity_type === "walk" ? "walk" : "run"}`}
                </Text>
                <Feather name="edit-2" size={14} color={C.textMuted} style={{ marginLeft: 8, marginTop: 3 }} />
              </Pressable>
            )}
            <Text style={s.scheduledModalDate}>{formatScheduledDateTime(selectedScheduled.date)}</Text>

            {/* Stats row */}
            <View style={s.scheduledModalStats}>
              <View style={s.scheduledModalStat}>
                <Feather name="map-pin" size={14} color={C.primary} />
                <Text style={s.scheduledModalStatLabel}>Distance</Text>
                <Text style={s.scheduledModalStatValue}>{toDisplayDist(selectedScheduled.distance_miles, distUnit)}</Text>
              </View>
              {selectedScheduled.pace_min_per_mile ? (
                <View style={s.scheduledModalStat}>
                  <Feather name="zap" size={14} color={C.primary} />
                  <Text style={s.scheduledModalStatLabel}>Target Pace</Text>
                  <Text style={s.scheduledModalStatValue}>{toDisplayPace(selectedScheduled.pace_min_per_mile, distUnit)}</Text>
                </View>
              ) : null}
            </View>

            {/* Start Now */}
            <Pressable
              style={({ pressed }) => [s.startNowBtn, { opacity: pressed ? 0.88 : 1 }]}
              onPress={() => {
                setActivityFilter(selectedScheduled.activity_type ?? "run");
                setSelectedScheduled(null);
                router.push("/run-tracking" as any);
              }}
            >
              <Ionicons name="play-circle" size={22} color={C.bg} />
              <Text style={s.startNowBtnTxt}>
                {selectedScheduled.activity_type === "ride" ? "Start Ride Now" : selectedScheduled.activity_type === "walk" ? "Start Walk Now" : "Start Run Now"}
              </Text>
            </Pressable>

            {/* Delete */}
            <Pressable
              style={s.deleteScheduledBtn}
              onPress={() => {
                setSelectedScheduled(null);
                setTimeout(() => confirmDelete(selectedScheduled.id), 300);
              }}
            >
              <Text style={s.deleteScheduledTxt}>Delete Scheduled {selectedScheduled.activity_type === "ride" ? "Ride" : selectedScheduled.activity_type === "walk" ? "Walk" : "Run"}</Text>
            </Pressable>
          </View>
        )}
      </Modal>

      {/* ─── Saved Path Detail Sheet ─────────────────────────────────── */}
      <Modal
        visible={!!selectedSavedPath}
        transparent
        animationType="slide"
        onRequestClose={() => { setSelectedSavedPath(null); setEditingPathName(false); }}
      >
        {/* flex: 1 + justifyContent: "flex-end" gives the sheet a real height context */}
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <Pressable
            style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.55)" }]}
            onPress={() => { setSelectedSavedPath(null); setEditingPathName(false); }}
          />
        {selectedSavedPath && (
          <View style={[s.sheet, { paddingBottom: insets.bottom + 24, maxHeight: "88%", flex: 1 }]}>
            <View style={s.sheetHandle} />

            {/* Header */}
            <View style={s.sheetHeader}>
              <View style={s.savedPathIconWrap}>
                <Feather name="map" size={18} color={C.primary} />
              </View>
              <Pressable onPress={() => { setSelectedSavedPath(null); setEditingPathName(false); }} hitSlop={12}>
                <Feather name="x" size={22} color={C.textSecondary} />
              </Pressable>
            </View>

            {editingPathName ? (
              <View style={s.inlineEditRow}>
                <TextInput
                  style={s.inlineEditInput}
                  value={pathNameDraft}
                  onChangeText={setPathNameDraft}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (pathNameDraft.trim()) renamePathMutation.mutate({ id: selectedSavedPath.id, name: pathNameDraft.trim() });
                    else setEditingPathName(false);
                  }}
                  placeholderTextColor={C.textMuted}
                />
                <Pressable
                  onPress={() => {
                    if (pathNameDraft.trim()) renamePathMutation.mutate({ id: selectedSavedPath.id, name: pathNameDraft.trim() });
                    else setEditingPathName(false);
                  }}
                  hitSlop={10}
                  style={s.inlineEditSave}
                >
                  <Feather name="check" size={18} color={C.primary} />
                </Pressable>
                <Pressable onPress={() => setEditingPathName(false)} hitSlop={10}>
                  <Feather name="x" size={16} color={C.textMuted} />
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={s.inlineTitleRow}
                onPress={() => { setPathNameDraft(selectedSavedPath.name); setEditingPathName(true); }}
              >
                <Text style={s.scheduledModalTitle} numberOfLines={2}>{selectedSavedPath.name}</Text>
                <Feather name="edit-2" size={14} color={C.textMuted} style={{ marginLeft: 8, marginTop: 3 }} />
              </Pressable>
            )}
            {selectedSavedPath.distance_miles != null && (
              <Text style={s.scheduledModalDate}>{toDisplayDist(selectedSavedPath.distance_miles ?? 0, distUnit)} route</Text>
            )}

            {/* ── Scrollable body ─────────────────────────────────── */}
            <View style={{ flex: 1 }}>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
                {/* ── Route preview (MapView on native, SVG on web) ──── */}
                {Platform.OS !== "web" && selectedSavedPath.route_path && selectedSavedPath.route_path.length >= 2 ? (
                  <View style={{ marginTop: 14 }}>
                    <MiniRouteMap path={selectedSavedPath.route_path} height={220} />
                  </View>
                ) : (
                  <PathRoutePreview path={selectedSavedPath.route_path ?? []} primary={C.primary} />
                )}

                {/* ── 2×2 stats grid ──────────────────────────────── */}
                <View style={s.pathStatsGrid}>
                  <View style={s.pathStatCell}>
                    <Text style={s.pathStatLabel}>Times Run</Text>
                    <Text style={s.pathStatValue}>{String(pathRuns.length)}</Text>
                    <Text style={s.pathStatUnit}>runs</Text>
                  </View>
                  <View style={[s.pathStatCell, s.pathStatCellRight]}>
                    <Text style={s.pathStatLabel}>Fastest Pace</Text>
                    <Text style={s.pathStatValue}>{pathStats.bestPace ? toDisplayPace(pathStats.bestPace, distUnit) : "--"}</Text>
                    <Text style={s.pathStatUnit}>{`min/${unitLabel(distUnit)}`}</Text>
                  </View>
                  <View style={[s.pathStatCell, s.pathStatCellBottom]}>
                    <Text style={s.pathStatLabel}>Longest Dist</Text>
                    <Text style={s.pathStatValue}>{pathStats.bestDist ? toDisplayDist(pathStats.bestDist, distUnit) : "--"}</Text>
                    <Text style={s.pathStatUnit}>{unitLabel(distUnit)}</Text>
                  </View>
                  <View style={[s.pathStatCell, s.pathStatCellRight, s.pathStatCellBottom]}>
                    <Text style={s.pathStatLabel}>Longest Time</Text>
                    <Text style={s.pathStatValue}>{pathStats.bestTime ? formatDuration(pathStats.bestTime) : "--"}</Text>
                    <Text style={s.pathStatUnit}>time</Text>
                  </View>
                </View>

                {/* ── Previous Runs header ─────────────────────────── */}
                <Text style={s.pathHistoryLabel}>Previous Runs</Text>

                {/* ── Run history ──────────────────────────────────── */}
                {pathRunsLoading ? (
                  <ActivityIndicator color={C.primary} style={{ marginTop: 20 }} />
                ) : pathRuns.length === 0 ? (
                  <View style={s.pathNoRunsWrap}>
                    <Feather name="flag" size={24} color={C.textMuted} />
                    <Text style={s.pathNoRunsTxt}>No runs recorded on this path yet.</Text>
                    <Text style={s.pathNoRunsSub}>Tap the button below to start a tracked activity on this route — it'll appear here automatically.</Text>
                  </View>
                ) : (
                  <View style={{ gap: 8 }}>
                    {pathRuns.map((run) => (
                      <View key={run.id} style={s.pathRunCard}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.pathRunDate}>{new Date(run.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</Text>
                          <Text style={s.pathRunTitle} numberOfLines={1}>{run.title || `${toDisplayDist(run.distance_miles, distUnit)} ${run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run"}`}</Text>
                        </View>
                        <View style={s.pathRunStats}>
                          <Text style={s.pathRunStat}>{toDisplayDist(run.distance_miles, distUnit)}</Text>
                          {run.pace_min_per_mile ? <Text style={s.pathRunStatMuted}>{toDisplayPace(run.pace_min_per_mile, distUnit)}</Text> : null}
                          {run.duration_seconds ? <Text style={s.pathRunStatMuted}>{formatDuration(run.duration_seconds)}</Text> : null}
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
            </View>

            {/* ── CTA button ───────────────────────────────────── */}
            <Pressable
              style={s.runPathBtn}
              onPress={() => {
                const pathId = selectedSavedPath.id;
                const actType = pathStats.actType;
                setSelectedSavedPath(null);
                setTimeout(() => {
                  setActivityFilter(actType);
                  router.push(`/run-tracking?pathId=${pathId}` as any);
                }, 350);
              }}
            >
              <Feather name={pathStats.actType === "ride" ? "trending-up" : "play"} size={16} color={C.bg} />
              <Text style={s.runPathBtnTxt}>{pathStats.actType === "ride" ? "Ride This Path" : pathStats.actType === "walk" ? "Walk This Path" : "Run This Path"}</Text>
            </Pressable>
          </View>
        )}
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(C: ColorScheme) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 16 },
  monthHeader: { paddingTop: 14, paddingBottom: 6, paddingHorizontal: 2 },
  monthHeaderTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5 },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  screenTitle: { fontFamily: "Outfit_700Bold", fontSize: 30, color: C.text, letterSpacing: -0.5 },
  screenSub: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary, marginTop: 2 },

  activityToggleRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  activityPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border,
  },
  activityPillActive: { backgroundColor: C.primary, borderColor: C.primary },
  activityPillTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textMuted },
  activityPillTxtActive: { color: C.bg },
  planBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
  },
  planBtnTxt: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.bg },

  runSoloBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingVertical: 16,
  },
  runSoloBtnTxt: { fontFamily: "Outfit_700Bold", fontSize: 17, color: C.bg },

  goalCard: {
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  goalCardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  goalCardTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text },
  editGoalsBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
  editGoalsTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },

  periodRow: { flexDirection: "row", gap: 8, marginBottom: 18 },
  periodBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  periodBtnOn: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  periodBtnTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  periodBtnTxtOn: { color: C.primary },

  goalSection: { marginBottom: 4 },
  goalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  goalLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  goalLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  goalValues: {},
  goalCurrent: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },
  goalSlash: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary },
  goalFooterRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  goalPct: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },
  goalRemain: { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: C.blue },

  paceCompare: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  paceCompareTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 12 },
  paceNoGoal: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, marginTop: 6 },

  section: { marginBottom: 24 },
  sectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text, marginBottom: 12 },
  historyHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  historyCountBadge: { backgroundColor: C.primaryMuted, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  historyCountTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.primary },
  historyFilterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  historyFilterChipActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },

  rankCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  rankHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  rankCategory: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.text },
  rankBest: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.primary },
  rankRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, gap: 8, borderTopWidth: 1, borderTopColor: C.border + "88" },
  rankEmoji: { fontSize: 16, width: 22 },
  rankDate: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary, flex: 1 },
  rankDist: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.text },
  rankPace: { fontFamily: "Outfit_700Bold", fontSize: 12, color: C.primary, minWidth: 70, textAlign: "right" },

  historyCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
    flexDirection: "column",
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  historyLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  historyStatus: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  ghostHistoryCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: "dashed",
    opacity: 0.95,
    flexDirection: "column",
    alignSelf: "stretch",
  },
  ghostHistoryTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textMuted, lineHeight: 18 },
  ghostHistoryMeta: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, marginTop: 2 },
  ghostHistoryDist: { fontFamily: "Outfit_700Bold", fontSize: 22, color: C.primary + "80" },
  ghostTipRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  ghostHistoryTip: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted, flex: 1 },
  historyTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  historyTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text, flex: 1 },
  historyBadge: { fontSize: 14 },
  sourceBadge: { width: 18, height: 18, borderRadius: 9, alignItems: "center" as const, justifyContent: "center" as const, marginLeft: 4 },
  historyMeta: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary, marginTop: 3 },
  historyRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  historyDist: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.primary },
  historyDistUnit: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textMuted },

  statsPanel: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  statItem: {
    alignItems: "center",
    gap: 3,
    flex: 1,
  },
  statLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted, marginTop: 2 },
  statValue: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.text },

  emptyCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  emptyTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text, marginTop: 12 },
  emptyBody: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary, textAlign: "center", marginTop: 6 },
  emptyCtaBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28, marginTop: 18 },
  emptyCtaBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#050C09" },
  emptyText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, marginTop: 12, marginBottom: 20 },
  loginBtn: { backgroundColor: C.primary, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 14 },
  loginBtnTxt: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.bg },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderColor: C.border,
    maxHeight: "88%",
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginBottom: 16 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  sheetTitle: { fontFamily: "Outfit_700Bold", fontSize: 22, color: C.text },

  inputLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary, marginBottom: 6, marginTop: 14 },
  input: {
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: C.text,
  },

  segRow: { flexDirection: "row", gap: 8, marginBottom: 4 },
  segBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: C.card,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  segBtnOn: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  segTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  segTxtOn: { color: C.primary },

  notifyRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 18, marginBottom: 4 },
  notifyCheck: {
    width: 22, height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
  },
  notifyCheckOn: { backgroundColor: C.primary, borderColor: C.primary },
  notifyLabel: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary, flex: 1 },

  sheetFooter: { flexDirection: "row", gap: 12, paddingTop: 20, borderTopWidth: 1, borderTopColor: C.border, marginTop: 8 },
  resetBtn: { flex: 1, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  resetTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.textSecondary },
  applyBtn: { flex: 2, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: C.primary },
  applyTxt: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.bg },

  pathCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  pathCardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  pathIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: C.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  pathName: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.text,
  },
  pathMeta: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: C.textSecondary,
    marginTop: 2,
  },

  scheduledCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.blue + "44",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  scheduledIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.blue + "22",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  scheduledTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  scheduledDate: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.blue, marginTop: 2 },
  scheduledChips: { flexDirection: "row", gap: 10, marginTop: 6 },
  scheduledChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  scheduledChipTxt: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },

  scheduledModalIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.blue + "22",
    alignItems: "center",
    justifyContent: "center",
  },
  inlineTitleRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 6 },
  inlineEditRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  inlineEditInput: {
    flex: 1, fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text,
    borderBottomWidth: 1.5, borderBottomColor: C.primary, paddingVertical: 4,
  },
  inlineEditSave: { padding: 2 },
  scheduledModalTitle: { fontFamily: "Outfit_700Bold", fontSize: 22, color: C.text, marginBottom: 6 },
  scheduledModalDate: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.blue, marginBottom: 20 },
  scheduledModalStats: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 24,
  },
  scheduledModalStat: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  scheduledModalStatLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted, marginTop: 2 },
  scheduledModalStatValue: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },

  startNowBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingVertical: 16,
    marginBottom: 12,
  },
  startNowBtnTxt: { fontFamily: "Outfit_700Bold", fontSize: 17, color: C.bg },

  deleteScheduledBtn: {
    alignItems: "center",
    paddingVertical: 10,
  },
  deleteScheduledTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textMuted },

  savedPathCard: {
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.primary + "33",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  savedPathIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.primary + "22",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  savedPathName: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  savedPathMeta: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, marginTop: 2 },

  pathStatsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
    marginTop: 14,
  },
  pathStatCell: {
    width: "50%",
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: "center",
    gap: 3,
  },
  pathStatCellRight: {
    borderLeftWidth: 1,
    borderLeftColor: C.border,
  },
  pathStatCellBottom: {
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  pathStatLabel: { fontFamily: "Outfit_400Regular", fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  pathStatValue: { fontFamily: "Outfit_700Bold", fontSize: 20, color: C.primary, letterSpacing: -0.5 },
  pathStatUnit: { fontFamily: "Outfit_400Regular", fontSize: 10, color: C.textMuted },

  pathHistoryLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 20,
    marginBottom: 8,
  },

  pathNoRunsWrap: { alignItems: "center", paddingVertical: 28, gap: 8 },
  pathNoRunsTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.textSecondary, textAlign: "center" },
  pathNoRunsSub: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textMuted, textAlign: "center", lineHeight: 18 },

  pathRunCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: C.border,
    gap: 12,
  },
  pathRunDate: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted, marginBottom: 2 },
  pathRunTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.text },
  pathRunStats: { alignItems: "flex-end", gap: 2 },
  pathRunStat: { fontFamily: "Outfit_700Bold", fontSize: 13, color: C.primary },
  pathRunStatMuted: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },

  runPathBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 16,
  },
  runPathBtnTxt: { fontFamily: "Outfit_700Bold", fontSize: 17, color: C.bg },
}); }
