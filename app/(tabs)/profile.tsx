import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  Image,
  Share,
} from "react-native";
import MapView, { Polyline } from "react-native-maps";
import MAP_STYLE from "@/lib/mapStyle";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { useActivity } from "@/contexts/ActivityContext";
import { apiRequest } from "@/lib/query-client";
import { useTheme } from "@/contexts/ThemeContext";
import { darkColors as C } from "@/constants/colors";
import { MARKER_ICONS } from "@/constants/markerIcons";
import { ACHIEVEMENTS, type AchievementDef } from "@/constants/achievements";
import { formatDistance } from "@/lib/formatDistance";
import { toDisplayDist, toDisplayPace, unitLabel, type DistanceUnit } from "@/lib/units";
import { pickAndUploadImage } from "@/lib/uploadImage";
import HostProfileSheet from "@/components/HostProfileSheet";
import SettingsModal from "@/components/SettingsModal";
const APP_SHARE_URL = process.env.EXPO_PUBLIC_DOMAIN
  ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
  : "https://paceup.app";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MILESTONE_LABELS: Record<number, string> = {
  25: "First 25",
  100: "Century",
  250: "Quarter K",
  500: "Half K",
  1000: "1K Club",
};

const MILESTONE_ICONS: Record<number, string> = {
  25: "star",
  100: "award",
  250: "zap",
  500: "shield",
  1000: "activity",
};

function isPhotoUrl(v: string | null | undefined): boolean {
  if (!v) return false;
  return v.startsWith("http") || v.startsWith("/api/objects");
}

function ProgressBar({ value, total, color }: { value: number; total: number; color?: string }) {
  const { C: TC } = useTheme();
  const pct = Math.min(1, total > 0 ? value / total : 0);
  const fillColor = color ?? TC.primary;
  return (
    <View style={{ height: 6, backgroundColor: TC.border, borderRadius: 3, overflow: "hidden" }}>
      <View style={{ height: "100%", borderRadius: 3, width: `${pct * 100}%` as any, backgroundColor: fillColor }} />
    </View>
  );
}

interface RunHistoryItem {
  id: string;
  title: string;
  date: string;
  min_distance: number;
  max_distance: number;
  min_pace: number;
  max_pace: number;
  is_host: boolean;
  is_completed: boolean;
  my_is_present: boolean;
  my_status: string;
  host_name: string;
  activity_type?: string;
  privacy?: string;
  crew_id?: string | null;
}

type HistoryEventType = "solo" | "crew" | "public" | "friends";

interface UnifiedHistoryItem {
  id: string;
  type: HistoryEventType;
  title: string | null;
  date: string;
  distance_miles: number;
  min_distance?: number;
  max_distance?: number;
  pace_min_per_mile?: number | null;
  duration_seconds?: number | null;
  elevation_gain_ft?: number | null;
  route_path?: Array<{ latitude: number; longitude: number }> | null;
  activity_type: string;
  is_starred?: boolean;
  host_name?: string;
  is_host?: boolean;
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDisplayDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatPaceSolo(p: number) {
  const m = Math.floor(p);
  const s = Math.round((p - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDurationSolo(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

type RoutePoint = { latitude: number; longitude: number };

function ProfileMiniRouteMap({ path }: { path: RoutePoint[] }) {
  if (Platform.OS === "web") return null;
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
      style={{ height: 130, borderRadius: 14, marginTop: 12, overflow: "hidden" }}
      initialRegion={{ latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2, latitudeDelta: latDelta, longitudeDelta: lngDelta }}
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface TopRun {
  dist: number | null;
  date: string;
  pace: number | null;
  title: string | null;
  run_type: "solo" | "group";
}

interface TopRunsData {
  longestRuns: TopRun[];
  fastestRuns: TopRun[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPace(p: number | null) {
  if (!p || p <= 0) return "—";
  return `${Math.floor(p)}:${Math.round((p % 1) * 60).toString().padStart(2, "0")}/mi`;
}

function fmtDate(d: string) {
  const date = new Date(d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const RANK_COLORS = ["#FFD700", "#C0C0C0", "#CD7F32", C.textMuted, C.textMuted] as const;

// ─── Main Screen ──────────────────────────────────────────────────────────────

interface SoloRunItem {
  id: string;
  title: string | null;
  distance_miles: number;
  pace_min_per_mile: number | null;
  duration_seconds: number | null;
  elevation_gain_ft: number | null;
  completed: boolean;
  planned: boolean;
  date: string;
  activity_type: string;
  is_starred: boolean;
  route_path: Array<{ latitude: number; longitude: number }> | null;
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout, refreshUser } = useAuth();
  const qc = useQueryClient();
  const { activityFilter: profileActivity, setActivityFilter: setProfileActivity } = useActivity();
  const { C, theme, toggleTheme } = useTheme();
  const distUnit: DistanceUnit = ((user as any)?.distance_unit ?? "miles") as DistanceUnit;

  const [showGoals, setShowGoals] = useState(false);
  const [showPace, setShowPace] = useState(false);
  const [monthlyGoal, setMonthlyGoal] = useState(user?.monthly_goal?.toString() || "50");
  const [yearlyGoal, setYearlyGoal] = useState(user?.yearly_goal?.toString() || "500");
  const [avgPace, setAvgPace] = useState(user?.avg_pace?.toString() || "10");
  const [avgDistance, setAvgDistance] = useState(user?.avg_distance?.toString() || "3");
  const [devTaps, setDevTaps] = useState(0);
  const [showDevMode, setShowDevMode] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [uploadingProfile, setUploadingProfile] = useState(false);
  const [uploadingPin, setUploadingPin] = useState(false);
  const [topRunsModal, setTopRunsModal] = useState<"longest" | "fastest" | null>(null);
  const [showSoloHistory, setShowSoloHistory] = useState(false);
  const [historyActivityFilter, setHistoryActivityFilter] = useState<"run" | "ride">("run");
  const [historyTypeFilter, setHistoryTypeFilter] = useState<"all" | HistoryEventType>("all");
  const [showFavorites, setShowFavorites] = useState(false);
  const [favActivityFilter, setFavActivityFilter] = useState<"run" | "ride">("run");
  const [friendSearch, setFriendSearch] = useState("");
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [viewProfileId, setViewProfileId] = useState<string | null>(null);
  const [showFriendList, setShowFriendList] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [selectedAchievement, setSelectedAchievement] = useState<AchievementDef | null>(null);
  const [achFilter, setAchFilter] = useState("All");
  const [showEditName, setShowEditName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const [nameError, setNameError] = useState("");
  const [nameDaysRemaining, setNameDaysRemaining] = useState<number | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const styles = makeStyles(C);
  const devStylesObj = makeDevStyles(C);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  async function handleChangeProfilePhoto() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      setUploadingProfile(true);
      const url = await pickAndUploadImage("profile");
      if (!url) return;
      await apiRequest("PUT", "/api/users/me", { photoUrl: url });
      await refreshUser();
    } catch (e: any) {
      Alert.alert("Upload Failed", e.message || "Could not upload photo");
    } finally {
      setUploadingProfile(false);
    }
  }

  async function handleChangePinPhoto() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      setUploadingPin(true);
      const url = await pickAndUploadImage("pin");
      if (!url) return;
      await apiRequest("PATCH", "/api/users/me/marker-icon", { icon: url });
      await refreshUser();
      setShowIconPicker(false);
    } catch (e: any) {
      Alert.alert("Upload Failed", e.message || "Could not upload photo");
    } finally {
      setUploadingPin(false);
    }
  }

  function handleVersionTap() {
    const next = devTaps + 1;
    setDevTaps(next);
    if (next >= 5) {
      setShowDevMode(true);
      setDevTaps(0);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const seedMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/admin/seed-runs", { count: 20 });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/runs"] });
      Alert.alert("Done", "Generated 20 fresh runs on the map.");
    },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  const iconMutation = useMutation({
    mutationFn: async (icon: string | null) => {
      await apiRequest("PATCH", "/api/users/me/marker-icon", { icon });
    },
    onSuccess: () => { refreshUser(); setShowIconPicker(false); },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  // ─── Queries ───────────────────────────────────────────────────────────────

  const { data: achievements = [] } = useQuery<any[]>({
    queryKey: ["/api/users/me/achievements"],
    enabled: !!user,
  });

  const { data: achData } = useQuery<{ earned_slugs: string[]; stats: Record<string, number> }>({
    queryKey: ["/api/users/me/achievement-stats"],
    enabled: !!user,
  });

  const { data: runs = [], isLoading: runsLoading } = useQuery<RunHistoryItem[]>({
    queryKey: ["/api/runs/mine"],
    enabled: !!user,
  });


  const goalsMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", "/api/users/me/goals", {
        monthlyGoal: parseFloat(monthlyGoal),
        yearlyGoal: parseFloat(yearlyGoal),
      });
    },
    onSuccess: () => { refreshUser(); setShowGoals(false); },
  });

  const paceMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", "/api/users/me", {
        avgPace: parseFloat(avgPace),
        avgDistance: parseFloat(avgDistance),
      });
    },
    onSuccess: () => { refreshUser(); setShowPace(false); },
  });

  const { data: friendsList = [] } = useQuery<any[]>({
    queryKey: ["/api/friends"],
    enabled: !!user,
  });

  const { data: friendRequests } = useQuery<{ incoming: any[]; sent: any[] }>({
    queryKey: ["/api/friends/requests"],
    enabled: !!user,
  });

  const { data: searchResults = [] } = useQuery<any[]>({
    queryKey: ["/api/users/search", friendSearch],
    queryFn: async () => {
      if (!friendSearch || friendSearch.length < 2) return [];
      const res = await apiRequest("GET", `/api/users/search?q=${encodeURIComponent(friendSearch)}`);
      return res.json();
    },
    enabled: !!user && friendSearch.length >= 2,
  });

  const { data: runRecords } = useQuery<{ longest_run: number | null; fastest_pace: number | null }>({
    queryKey: ["/api/users/me/run-records"],
    enabled: !!user,
  });

  const { data: topRunsData } = useQuery<TopRunsData>({
    queryKey: ["/api/users/me/top-runs"],
    enabled: !!user,
  });

  const { data: soloRuns = [] } = useQuery<SoloRunItem[]>({
    queryKey: ["/api/solo-runs"],
    enabled: !!user,
    staleTime: 30_000,
  });

  const { data: starredRuns = [] } = useQuery<SoloRunItem[]>({
    queryKey: ["/api/solo-runs/starred"],
    enabled: !!user,
    staleTime: 30_000,
  });

  const actStats = React.useMemo(() => {
    const filtered = soloRuns.filter((r) => (r.activity_type ?? "run") === profileActivity && r.completed);
    const now = new Date();
    const thisMonth = filtered.filter((r) => {
      const d = new Date(r.date);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
    const thisYear = filtered.filter((r) => new Date(r.date).getFullYear() === now.getFullYear());
    const totalMiles = filtered.reduce((s, r) => s + r.distance_miles, 0);
    const monthMiles = thisMonth.reduce((s, r) => s + r.distance_miles, 0);
    const yearMiles = thisYear.reduce((s, r) => s + r.distance_miles, 0);
    const withPace = filtered.filter(
      (r) =>
        r.pace_min_per_mile != null &&
        r.pace_min_per_mile >= 2.0 &&
        r.distance_miles > 0.5
    );
    const avgPace = withPace.length > 0
      ? withPace.reduce((s, r) => s + r.pace_min_per_mile!, 0) / withPace.length
      : null;
    return { totalMiles, monthMiles, yearMiles, count: filtered.length, avgPace };
  }, [soloRuns, profileActivity]);

  const computedTopRuns = React.useMemo(() => {
    const completed = soloRuns.filter((r) => (r.activity_type ?? "run") === profileActivity && r.completed);
    const longest = [...completed]
      .sort((a, b) => b.distance_miles - a.distance_miles)
      .slice(0, 5)
      .map((r) => ({ dist: r.distance_miles, pace: r.pace_min_per_mile, date: r.date, title: null, run_type: "solo" as const }));
    const fastest = [...completed]
      .filter((r) => r.pace_min_per_mile != null && r.pace_min_per_mile >= 2.0 && r.distance_miles > 0.5)
      .sort((a, b) => (a.pace_min_per_mile ?? 99) - (b.pace_min_per_mile ?? 99))
      .slice(0, 5)
      .map((r) => ({ dist: r.distance_miles, pace: r.pace_min_per_mile, date: r.date, title: null, run_type: "solo" as const }));
    return { longest, fastest };
  }, [soloRuns, profileActivity]);

  const combinedHistory = React.useMemo((): UnifiedHistoryItem[] => {
    const now = new Date();
    const soloPart: UnifiedHistoryItem[] = soloRuns
      .filter((r) => r.completed && (r.activity_type ?? "run") === historyActivityFilter)
      .map((r) => ({
        id: r.id,
        type: "solo" as const,
        title: r.title,
        date: r.date,
        distance_miles: r.distance_miles,
        pace_min_per_mile: r.pace_min_per_mile,
        duration_seconds: r.duration_seconds,
        elevation_gain_ft: r.elevation_gain_ft,
        route_path: r.route_path,
        activity_type: r.activity_type ?? "run",
        is_starred: r.is_starred,
      }));

    const groupPart: UnifiedHistoryItem[] = runs
      .filter((r) => {
        const isPast = new Date(r.date) < now;
        const wasInvolved = r.is_host || r.my_is_present || r.my_status === "joined";
        return isPast && wasInvolved && (r.activity_type ?? "run") === historyActivityFilter;
      })
      .map((r) => {
        let type: HistoryEventType = "public";
        if (r.crew_id) type = "crew";
        else if (r.privacy === "friends") type = "friends";
        return {
          id: r.id,
          type,
          title: r.title,
          date: r.date,
          distance_miles: (r.min_distance + r.max_distance) / 2,
          min_distance: r.min_distance,
          max_distance: r.max_distance,
          pace_min_per_mile: r.min_pace != null ? (r.min_pace + r.max_pace) / 2 : null,
          duration_seconds: null,
          elevation_gain_ft: null,
          route_path: null,
          activity_type: r.activity_type ?? "run",
          is_starred: false,
          host_name: r.host_name,
          is_host: r.is_host,
        };
      });

    return [...soloPart, ...groupPart].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [soloRuns, runs, historyActivityFilter]);

  const nameMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("PUT", "/api/users/me/name", { name });
      const body = await res.json();
      if (!res.ok) throw { status: res.status, ...body };
      return body;
    },
    onSuccess: () => {
      refreshUser();
      setShowEditName(false);
      setNameError("");
      setNameDaysRemaining(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (e: any) => {
      if (e.status === 429) {
        setNameDaysRemaining(e.daysRemaining ?? 30);
        setNameError(e.message ?? "Name change on cooldown");
      } else {
        setNameError(e.message ?? "Failed to update name");
      }
    },
  });

  const sendRequestMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("POST", "/api/friends/request", { userId });
      if (!res.ok) { const b = await res.json(); throw new Error(b.message); }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/friends/requests"] }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  const acceptMutation = useMutation({
    mutationFn: async (friendshipId: string) => {
      await apiRequest("PUT", `/api/friends/${friendshipId}/accept`, {});
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/friends"] }); qc.invalidateQueries({ queryKey: ["/api/friends/requests"] }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); },
  });

  const removeFriendMutation = useMutation({
    mutationFn: async (friendshipId: string) => {
      await apiRequest("DELETE", `/api/friends/${friendshipId}`, {});
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/friends"] }); qc.invalidateQueries({ queryKey: ["/api/friends/requests"] }); },
  });

  const incomingRequests = friendRequests?.incoming || [];
  const sentRequests = friendRequests?.sent || [];
  const friendIds = new Set(friendsList.map((f: any) => f.id));
  const sentIds = new Set(sentRequests.map((r: any) => r.id));

  const milestones = [25, 100, 250, 500, 1000];
  const earnedIds = new Set(achievements.map((a: any) => a.milestone));
  const earnedSlugs = new Set<string>(achData?.earned_slugs ?? []);
  const achStats = achData?.stats ?? {};
  const earnedCount = ACHIEVEMENTS.filter((a) => earnedSlugs.has(a.slug)).length;

  const filteredAchievements = (achFilter === "All" ? ACHIEVEMENTS : ACHIEVEMENTS.filter((a) => a.category === achFilter))
    .slice()
    .sort((a, b) => a.difficulty - b.difficulty);

  if (!user) return <View style={styles.container}><ActivityIndicator color={C.primary} /></View>;

  const nextMilestone = milestones.find((m) => !earnedIds.has(m));
  const hasPinPhoto = isPhotoUrl(user.marker_icon);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16),
          paddingBottom: insets.bottom + 100,
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Profile Header ────────────────────────────────────────────────── */}
      <View style={styles.profileHeader}>
        <Pressable
          style={styles.avatarWrap}
          onPress={handleChangeProfilePhoto}
          disabled={uploadingProfile}
          testID="change-photo-btn"
        >
          {user.photo_url ? (
            <Image source={{ uri: user.photo_url }} style={styles.avatarPhoto} />
          ) : (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{user.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.cameraBadge}>
            {uploadingProfile
              ? <ActivityIndicator size="small" color={C.bg} />
              : <Feather name="camera" size={11} color={C.bg} />
            }
          </View>
        </Pressable>

        <View style={styles.profileInfo}>
          <Pressable
            style={styles.profileNameRow}
            onPress={() => {
              const changedAt = (user as any).name_changed_at;
              if (changedAt) {
                const daysSince = (Date.now() - new Date(changedAt).getTime()) / (1000 * 60 * 60 * 24);
                if (daysSince < 30) setNameDaysRemaining(Math.ceil(30 - daysSince));
                else setNameDaysRemaining(null);
              } else {
                setNameDaysRemaining(null);
              }
              setEditNameValue(user.name);
              setNameError("");
              setShowEditName(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
          >
            <Text style={styles.profileName}>{user.name}</Text>
            <Feather name="edit-2" size={13} color={C.textMuted} style={{ marginTop: 2 }} />
          </Pressable>
          <Text style={styles.profileEmail}>{user.email}</Text>
          <View style={styles.roleChip}>
            <Feather name="user" size={11} color={C.primary} />
            <Text style={[styles.roleText, { color: C.primary }]}>Runner</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowSettings(true); }}
            style={styles.logoutBtn}
          >
            <Feather name="settings" size={18} color={C.textMuted} />
          </Pressable>
          <Pressable
            onPress={async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              await logout();
              router.replace("/(auth)/login");
            }}
            style={styles.logoutBtn}
          >
            <Feather name="log-out" size={18} color={C.textMuted} />
          </Pressable>
        </View>
      </View>

      {/* ── Friends Quick-Access Row ───────────────────────────────────────── */}
      <View style={styles.statsGrid}>
        <Pressable
          style={({ pressed }) => [styles.statCard, { opacity: pressed ? 0.8 : 1 }]}
          onPress={() => { setShowFriendList(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <Feather name="users" size={18} color={C.primary} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={styles.goalLabel}>
              {"Friends: "}
              <Text style={styles.editBtnText}>{friendsList.length}</Text>
            </Text>
            {incomingRequests.length > 0 && (
              <View style={styles.friendsQuickDot}>
                <Text style={styles.friendsQuickDotTxt}>{incomingRequests.length}</Text>
              </View>
            )}
          </View>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.statCard, { opacity: pressed ? 0.8 : 1 }]}
          onPress={() => { setShowAddFriend(true); setFriendSearch(""); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <Feather name="user-plus" size={18} color={C.primary} />
          <Text style={styles.goalLabel}>{"+ Add Friends"}</Text>
        </Pressable>
      </View>

      {/* ── Achievements Card ─────────────────────────────────────────────── */}
      <View style={styles.achOuterCard}>
        <Pressable
          style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
          onPress={() => { setShowAchievements((v) => !v); setSelectedAchievement(null); setAchFilter("All"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <Text style={[styles.goalLabel, { fontSize: 17 }]}>🏆 Achievements</Text>
          <Text style={styles.statName}>{earnedCount}/{ACHIEVEMENTS.length} earned</Text>
          <View style={{ flex: 1 }} />
          <Feather name={showAchievements ? "chevron-up" : "chevron-down"} size={16} color={C.textMuted} />
        </Pressable>

        {showAchievements && (
          <View style={styles.achExpandedInCard}>
            {/* Divider */}
            <View style={styles.achDivider} />

            {/* Category filter */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {["All", "Beginner", "Consistency", "Mileage", "Social", "Speed", "Lifestyle"].map((cat) => {
                const active = achFilter === cat;
                return (
                  <Pressable
                    key={cat}
                    style={[styles.achFilterChip, active && styles.achFilterChipActive]}
                    onPress={() => { setAchFilter(cat); setSelectedAchievement(null); }}
                  >
                    <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: active ? C.primary : C.text }}>{cat}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* 5-per-row grid — chunked into explicit rows so flex works on web */}
            <View style={{ gap: 4 }}>
              {Array.from({ length: Math.ceil(filteredAchievements.length / 5) }, (_, rowIdx) => {
                const row = filteredAchievements.slice(rowIdx * 5, rowIdx * 5 + 5);
                return (
                  <View key={rowIdx} style={{ flexDirection: "row", justifyContent: "space-evenly", alignSelf: "stretch" }}>
                    {row.map((ach) => {
                      const earned = earnedSlugs.has(ach.slug);
                      const isSelected = selectedAchievement?.slug === ach.slug;
                      return (
                        <Pressable
                          key={ach.slug}
                          style={[styles.achGridCell, isSelected && styles.achGridCellSelected]}
                          onPress={() => setSelectedAchievement(isSelected ? null : ach)}
                        >
                          <Text style={{ fontSize: 36, opacity: earned ? 1 : 0.2 }}>{ach.icon}</Text>
                          {earned && <View style={styles.achGridDot} />}
                        </Pressable>
                      );
                    })}
                    {row.length < 5 && Array.from({ length: 5 - row.length }, (_, i) => (
                      <View key={`pad-${i}`} style={styles.achGridCell} />
                    ))}
                  </View>
                );
              })}
            </View>

            {/* Selected achievement detail */}
            {selectedAchievement && (() => {
              const ach = selectedAchievement;
              const earned = earnedSlugs.has(ach.slug);
              const current = ach.progressKey ? Math.min(achStats[ach.progressKey] ?? 0, ach.progressTarget ?? 1) : 0;
              const target = ach.progressTarget ?? 1;
              const pct = Math.min(current / target, 1);
              return (
                <View style={styles.achDetailPanel}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontSize: 28 }}>{ach.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={styles.goalLabel}>{ach.name}</Text>
                        {earned && <Feather name="check-circle" size={13} color={C.primary} />}
                      </View>
                      <Text style={styles.statName}>{ach.category} · Difficulty {ach.difficulty}/6</Text>
                    </View>
                  </View>
                  <Text style={styles.statName}>{ach.desc}</Text>
                  {ach.progressTarget && (
                    <View style={styles.achDetailProgress}>
                      <View style={styles.achProgressTrack}>
                        <View style={[styles.achProgressFill, { width: `${Math.round(pct * 100)}%` as any, backgroundColor: earned ? C.primary : C.primaryDark }]} />
                      </View>
                      <Text style={styles.statName}>
                        {ach.progressKey === "max_single_run_miles_x10"
                          ? `${toDisplayDist(current / 10, distUnit)} / ${toDisplayDist(target / 10, distUnit)}`
                          : `${Math.round(current)} / ${target} ${ach.progressLabel ?? ""}`}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })()}
          </View>
        )}
      </View>

      {/* ── Activity Toggle ────────────────────────────────────────────────── */}
      <View style={styles.actToggleRow}>
        <Pressable
          style={[styles.actToggleBtn, profileActivity === "run" && styles.actToggleBtnActive]}
          onPress={() => { setProfileActivity("run"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <Ionicons name="walk" size={14} color={profileActivity === "run" ? C.primary : C.textMuted} />
          <Text style={[styles.actToggleTxt, profileActivity === "run" && styles.actToggleTxtActive]}>Runs</Text>
        </Pressable>
        <Pressable
          style={[styles.actToggleBtn, profileActivity === "ride" && styles.actToggleBtnActive]}
          onPress={() => { setProfileActivity("ride"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <Ionicons name="bicycle" size={14} color={profileActivity === "ride" ? C.primary : C.textMuted} />
          <Text style={[styles.actToggleTxt, profileActivity === "ride" && styles.actToggleTxtActive]}>Rides</Text>
        </Pressable>
      </View>

      {/* ── Stats Grid ────────────────────────────────────────────────────── */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{toDisplayDist(actStats.totalMiles, distUnit)}</Text>
          <Text style={styles.statName}>{distUnit === "km" ? "Total KM" : "Total Miles"}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{actStats.count}</Text>
          <Text style={styles.statName}>{profileActivity === "ride" ? "Rides Done" : "Runs Done"}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{user.hosted_runs}</Text>
          <Text style={styles.statName}>Hosted</Text>
        </View>
        {user.avg_rating > 0 && (
          <View style={styles.statCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <Text style={[styles.statNum, { color: C.gold }]}>{user.avg_rating.toFixed(1)}</Text>
              <Feather name="lock" size={10} color={C.gold} />
            </View>
            <Text style={styles.statName}>Host Rating</Text>
          </View>
        )}
        <Pressable
          style={({ pressed }) => [styles.statCard, styles.statCardTappable, { opacity: pressed ? 0.75 : 1 }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTopRunsModal("longest"); }}
        >
          <Text style={styles.statNum}>
            {computedTopRuns.longest[0]?.dist != null ? toDisplayDist(computedTopRuns.longest[0].dist, distUnit) : "—"}
          </Text>
          <Text style={styles.statName}>{profileActivity === "ride" ? "Longest Ride" : "Longest Run"}</Text>
          <Feather name="chevron-right" size={10} color={C.textMuted} style={{ marginTop: 2 }} />
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.statCard, styles.statCardTappable, { opacity: pressed ? 0.75 : 1 }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTopRunsModal("fastest"); }}
        >
          <Text style={styles.statNum}>
            {computedTopRuns.fastest[0]?.pace != null ? fmtPace(computedTopRuns.fastest[0].pace) : "—"}
          </Text>
          <Text style={styles.statName}>Fastest Pace</Text>
          <Feather name="chevron-right" size={10} color={C.textMuted} style={{ marginTop: 2 }} />
        </Pressable>
      </View>

      {/* ── Host Rating Warning ──────────────────────────────────────────────── */}
      {user.avg_rating > 0 && user.avg_rating < 4.0 && user.rating_count >= 1 && (
        <View style={[styles.ratingWarningCard, { borderColor: user.avg_rating < 3.5 ? "#FF6B3522" : "#FFB80022" }]}>
          <Feather name="alert-circle" size={14} color={user.avg_rating < 3.5 ? "#FF6B35" : C.gold} />
          <Text style={[styles.ratingWarningText, { color: user.avg_rating < 3.5 ? "#FF6B35" : C.gold }]}>
            {user.avg_rating < 3.5
              ? "Your host rating is below the 3.5 minimum — you cannot create new runs until it recovers."
              : "Your host rating is approaching the minimum threshold. Keep it above 3.5 to continue hosting."}
          </Text>
        </View>
      )}

      {/* ── View Past Runs / Rides ────────────────────────────────────────── */}
      <Pressable
        style={({ pressed }) => [styles.viewPastBtn, { opacity: pressed ? 0.8 : 1 }]}
        onPress={() => {
          setHistoryActivityFilter(profileActivity);
          setHistoryTypeFilter("all");
          setShowSoloHistory(true);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }}
      >
        <Ionicons name={profileActivity === "ride" ? "bicycle-outline" : "walk-outline"} size={16} color={C.primary} />
        <Text style={styles.viewPastBtnTxt}>
          {profileActivity === "ride" ? "View Past Rides" : "View Past Runs"}
        </Text>
        <Feather name="chevron-right" size={16} color={C.primary} />
      </Pressable>

      {/* ── My Stats ──────────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>My Stats</Text>
          <Pressable onPress={() => setShowPace(true)} style={styles.editBtn}>
            <Feather name="edit-2" size={14} color={C.primary} />
            <Text style={styles.editBtnText}>Edit</Text>
          </Pressable>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statsItem}>
            <Ionicons name={profileActivity === "ride" ? "bicycle" : "walk"} size={16} color={C.orange} />
            <View>
              <Text style={styles.statsVal}>
                {actStats.avgPace != null
                  ? toDisplayPace(actStats.avgPace, distUnit)
                  : "—"}
              </Text>
              <Text style={styles.statsLabel}>Avg Pace</Text>
            </View>
          </View>
          <View style={styles.statsItem}>
            <Feather name="target" size={16} color={C.blue} />
            <View>
              <Text style={styles.statsVal}>
                {user.avg_distance ? toDisplayDist(user.avg_distance, distUnit) : "—"}
              </Text>
              <Text style={styles.statsLabel}>Avg Distance</Text>
            </View>
          </View>
        </View>
        <View style={[styles.statsRow, { marginTop: 8 }]}>
          <View style={styles.statsItem}>
            <Text style={{ fontSize: 16 }}>
              {achData?.stats?.attendance_rate_pct != null
                ? achData.stats.attendance_rate_pct >= 90 ? "⭐"
                  : achData.stats.attendance_rate_pct >= 80 ? "🟢"
                  : achData.stats.attendance_rate_pct >= 65 ? "🔵"
                  : "🟡"
                : "📋"}
            </Text>
            <View>
              <Text style={styles.statsVal}>
                {achData?.stats?.attendance_rate_pct != null
                  ? `${achData.stats.attendance_rate_pct}%`
                  : "—"}
              </Text>
              <Text style={styles.statsLabel}>Show-Up Rate</Text>
            </View>
          </View>
        </View>
      </View>

      {/* ── Map Marker ────────────────────────────────────────────────────── */}
      <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Map Pin</Text>
            <Pressable onPress={() => setShowIconPicker(true)} style={styles.editBtn}>
              <Feather name="edit-2" size={14} color={C.primary} />
              <Text style={styles.editBtnText}>Change</Text>
            </Pressable>
          </View>
          <Pressable style={styles.markerPreview} onPress={() => setShowIconPicker(true)}>
            <View style={styles.markerCircle}>
              {hasPinPhoto ? (
                <Image source={{ uri: user.marker_icon! }} style={styles.markerPhoto} />
              ) : user.marker_icon ? (
                <Text style={styles.markerEmoji}>{user.marker_icon}</Text>
              ) : user.photo_url ? (
                <Image source={{ uri: user.photo_url }} style={styles.markerPhoto} />
              ) : (
                <Text style={styles.markerInitial}>{user.name.charAt(0).toUpperCase()}</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.markerLabel}>
                {hasPinPhoto ? "Custom photo" : user.marker_icon ? "Custom icon" : user.photo_url ? "Profile photo" : "Profile initial"}
              </Text>
              <Text style={styles.markerSub}>
                {hasPinPhoto
                  ? "Your runs show this photo on the map"
                  : user.marker_icon
                  ? "Your runs show this icon on the map"
                  : user.photo_url
                  ? "Your profile photo is used as your pin"
                  : "Tap to choose a custom map pin"}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={C.textMuted} />
          </Pressable>
        </View>

      {/* ── Mileage Goals ─────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Mileage Goals</Text>
          <Pressable onPress={() => setShowGoals(true)} style={styles.editBtn}>
            <Feather name="edit-2" size={14} color={C.primary} />
            <Text style={styles.editBtnText}>Edit</Text>
          </Pressable>
        </View>
        <View style={styles.goalCard}>
          <View style={styles.goalHeader}>
            <Text style={styles.goalLabel}>This Month</Text>
            <Text style={styles.goalValues}>{toDisplayDist(actStats.monthMiles, distUnit)} / {toDisplayDist(user.monthly_goal ?? 50, distUnit)}</Text>
          </View>
          <ProgressBar value={actStats.monthMiles} total={user.monthly_goal} />
          <Text style={styles.goalRemain}>
            {toDisplayDist(Math.max(0, user.monthly_goal - actStats.monthMiles), distUnit)} remaining
          </Text>
        </View>
        <View style={[styles.goalCard, { marginTop: 10 }]}>
          <View style={styles.goalHeader}>
            <Text style={styles.goalLabel}>This Year</Text>
            <Text style={styles.goalValues}>{toDisplayDist(actStats.yearMiles, distUnit)} / {toDisplayDist(user.yearly_goal ?? 500, distUnit)}</Text>
          </View>
          <ProgressBar value={actStats.yearMiles} total={user.yearly_goal} color={C.blue} />
          <Text style={styles.goalRemain}>
            {toDisplayDist(Math.max(0, user.yearly_goal - actStats.yearMiles), distUnit)} remaining
          </Text>
        </View>
      </View>


      {/* ── Favorite Runs/Rides ───────────────────────────────────────────── */}
      <Pressable
        style={({ pressed }) => [styles.viewPastBtn, { opacity: pressed ? 0.8 : 1 }]}
        onPress={() => {
          setFavActivityFilter(profileActivity);
          setShowFavorites(true);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }}
      >
        <Ionicons name="star" size={16} color={C.gold} />
        <Text style={[styles.viewPastBtnTxt, { color: C.gold }]}>
          {profileActivity === "ride" ? "View Favorite Rides" : "View Favorite Runs"}
        </Text>
        {starredRuns.filter((r) => (r.activity_type ?? "run") === profileActivity).length > 0 && (
          <View style={[styles.histEventBadge, { backgroundColor: C.gold + "22", marginRight: 4 }]}>
            <Text style={[styles.histEventBadgeTxt, { color: C.gold }]}>
              {starredRuns.filter((r) => (r.activity_type ?? "run") === profileActivity).length}
            </Text>
          </View>
        )}
        <Feather name="chevron-right" size={16} color={C.gold} />
      </Pressable>

      {/* ── Run / Ride Schedule ───────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{profileActivity === "ride" ? "Ride Schedule" : "Run Schedule"}</Text>
        {runsLoading ? (
          <ActivityIndicator color={C.primary} />
        ) : (() => {
          const now = new Date();
          const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const scheduleRuns = runs
            .filter((r) => {
              if ((r.activity_type ?? "run") !== profileActivity) return false;
              const d = new Date(r.date);
              return d >= startOfToday;
            })
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .slice(0, 5);
          if (scheduleRuns.length === 0) return (
            <View style={styles.emptyHistory}>
              <Ionicons name={profileActivity === "ride" ? "bicycle-outline" : "walk-outline"} size={36} color={C.textMuted} />
              <Text style={styles.emptyHistoryText}>
                {profileActivity === "ride" ? "No upcoming rides" : "No upcoming runs"}
              </Text>
            </View>
          );
          return scheduleRuns.map((run) => (
            <Pressable
              key={run.id}
              style={({ pressed }) => [styles.historyCard, { opacity: pressed ? 0.8 : 1 }]}
              onPress={() => router.push(`/run/${run.id}`)}
            >
              <View style={styles.historyLeft}>
                <View style={[styles.historyType, { backgroundColor: run.is_host ? C.gold + "22" : C.primaryMuted }]}>
                  {run.is_host
                    ? <Feather name="star" size={12} color={C.gold} />
                    : run.activity_type === "ride"
                      ? <Ionicons name="bicycle-outline" size={12} color={C.primary} />
                      : <Feather name="user" size={12} color={C.primary} />
                  }
                </View>
                <View>
                  <Text style={styles.historyTitle} numberOfLines={1}>{run.title}</Text>
                  <Text style={styles.historyMeta}>{formatDate(run.date)} · {run.min_distance === run.max_distance ? formatDistance(run.min_distance) : `${formatDistance(run.min_distance)}–${formatDistance(run.max_distance)}`} mi</Text>
                </View>
              </View>
              {(() => {
                const isPast = new Date(run.date) <= new Date();
                return (
                  <View style={[styles.historyStatus, { backgroundColor: isPast ? C.primary + "22" : C.border }]}>
                    <Text style={[styles.historyStatusText, { color: isPast ? C.primary : C.textMuted }]}>
                      {isPast ? "Done" : "Upcoming"}
                    </Text>
                  </View>
                );
              })()}
            </Pressable>
          ));
        })()}
      </View>

      {/* ── Dev Mode ──────────────────────────────────────────────────────── */}
      <Pressable onPress={handleVersionTap} style={devStylesObj.versionWrap}>
        <Text style={devStylesObj.versionText}>FARA v1.0</Text>
      </Pressable>

      {showDevMode && (
        <View style={devStylesObj.devPanel}>
          <Text style={devStylesObj.devTitle}>Dev Mode</Text>
          <Pressable
            style={({ pressed }) => [devStylesObj.devBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              seedMutation.mutate();
            }}
            disabled={seedMutation.isPending}
          >
            {seedMutation.isPending
              ? <ActivityIndicator color={C.primary} />
              : <Text style={devStylesObj.devBtnText}>Generate 20 Random Runs</Text>
            }
          </Pressable>
          <Pressable onPress={() => setShowDevMode(false)} style={devStylesObj.devClose}>
            <Text style={devStylesObj.devCloseText}>Close Dev Mode</Text>
          </Pressable>
        </View>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────── */}

      {/* ── Edit Name Modal ────────────────────────────────────────────────── */}
      {/* ── Settings Modal ─────────────────────────────────────────────── */}
      <SettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        onSignOut={async () => {
          await logout();
          router.replace("/(auth)/login");
        }}
      />

      <Modal visible={showEditName} transparent animationType="slide" onRequestClose={() => setShowEditName(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Pressable style={styles.modalOverlay} onPress={() => setShowEditName(false)} />
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={styles.modalTitle}>Change Name</Text>

          {nameDaysRemaining !== null && (
            <View style={styles.nameLockBanner}>
              <Feather name="lock" size={14} color={C.orange} />
              <Text style={styles.nameLockTxt}>You can change your name again in {nameDaysRemaining} day{nameDaysRemaining === 1 ? "" : "s"}</Text>
            </View>
          )}

          <View style={styles.modalField}>
            <Text style={styles.modalLabel}>Display Name</Text>
            <TextInput
              style={[styles.modalInput, nameDaysRemaining !== null && { opacity: 0.5 }]}
              value={editNameValue}
              onChangeText={(t) => { setEditNameValue(t); setNameError(""); }}
              placeholder="Your name"
              placeholderTextColor={C.textMuted}
              autoCapitalize="words"
              maxLength={30}
              editable={nameDaysRemaining === null}
            />
            {nameError !== "" && <Text style={styles.nameErrorTxt}>{nameError}</Text>}
          </View>

          <Pressable
            style={({ pressed }) => [styles.modalBtn, (nameDaysRemaining !== null || nameMutation.isPending) && { opacity: 0.5 }, { opacity: pressed && nameDaysRemaining === null ? 0.8 : undefined }]}
            onPress={() => { if (nameDaysRemaining === null) nameMutation.mutate(editNameValue); }}
            disabled={nameDaysRemaining !== null || nameMutation.isPending}
          >
            {nameMutation.isPending ? <ActivityIndicator color={C.bg} /> : <Text style={styles.modalBtnText}>Save Name</Text>}
          </Pressable>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showGoals} transparent animationType="slide" onRequestClose={() => setShowGoals(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Pressable style={styles.modalOverlay} onPress={() => setShowGoals(false)} />
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={styles.modalTitle}>Set Mileage Goals</Text>
          <View style={styles.modalField}>
            <Text style={styles.modalLabel}>Monthly Goal (miles)</Text>
            <TextInput
              style={styles.modalInput}
              value={monthlyGoal}
              onChangeText={setMonthlyGoal}
              keyboardType="decimal-pad"
              placeholderTextColor={C.textMuted}
            />
          </View>
          <View style={styles.modalField}>
            <Text style={styles.modalLabel}>Yearly Goal (miles)</Text>
            <TextInput
              style={styles.modalInput}
              value={yearlyGoal}
              onChangeText={setYearlyGoal}
              keyboardType="decimal-pad"
              placeholderTextColor={C.textMuted}
            />
          </View>
          <Pressable
            style={({ pressed }) => [styles.modalBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => goalsMutation.mutate()}
            disabled={goalsMutation.isPending}
          >
            {goalsMutation.isPending ? <ActivityIndicator color={C.bg} /> : <Text style={styles.modalBtnText}>Save Goals</Text>}
          </Pressable>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showPace} transparent animationType="slide" onRequestClose={() => setShowPace(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Pressable style={styles.modalOverlay} onPress={() => setShowPace(false)} />
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={styles.modalTitle}>Update Your Stats</Text>
          <View style={styles.modalField}>
            <Text style={styles.modalLabel}>Average Pace (min/mile, e.g. 9.5 = 9:30)</Text>
            <TextInput
              style={styles.modalInput}
              value={avgPace}
              onChangeText={setAvgPace}
              keyboardType="decimal-pad"
              placeholderTextColor={C.textMuted}
            />
          </View>
          <View style={styles.modalField}>
            <Text style={styles.modalLabel}>Average Distance (miles)</Text>
            <TextInput
              style={styles.modalInput}
              value={avgDistance}
              onChangeText={setAvgDistance}
              keyboardType="decimal-pad"
              placeholderTextColor={C.textMuted}
            />
          </View>
          <Pressable
            style={({ pressed }) => [styles.modalBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => paceMutation.mutate()}
            disabled={paceMutation.isPending}
          >
            {paceMutation.isPending ? <ActivityIndicator color={C.bg} /> : <Text style={styles.modalBtnText}>Save Stats</Text>}
          </Pressable>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Map Pin Picker Modal ───────────────────────────────────────────── */}
      <Modal visible={showIconPicker} transparent animationType="slide" onRequestClose={() => setShowIconPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowIconPicker(false)} />
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={styles.modalTitle}>Customize Map Pin</Text>
          <Text style={[styles.modalLabel, { marginBottom: 16 }]}>
            This appears on the map when you host a run
          </Text>

          {/* Upload photo option */}
          <Pressable
            style={[styles.uploadPhotoBtn, uploadingPin && { opacity: 0.6 }]}
            onPress={handleChangePinPhoto}
            disabled={uploadingPin}
          >
            {uploadingPin ? (
              <ActivityIndicator color={C.primary} size="small" />
            ) : hasPinPhoto ? (
              <Image source={{ uri: user.marker_icon! }} style={styles.uploadPhotoBtnThumb} />
            ) : (
              <Feather name="upload" size={18} color={C.primary} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.uploadPhotoLabel}>
                {hasPinPhoto ? "Change photo" : "Upload a photo"}
              </Text>
              <Text style={styles.uploadPhotoSub}>Use a custom image as your pin</Text>
            </View>
            <Feather name="chevron-right" size={16} color={C.textMuted} />
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.divLine} />
            <Text style={styles.divText}>or choose an icon</Text>
            <View style={styles.divLine} />
          </View>

          <View style={styles.iconGrid}>
            <Pressable
              style={[styles.iconCell, !user?.marker_icon && styles.iconCellActive]}
              onPress={() => iconMutation.mutate(null)}
            >
              {user?.photo_url ? (
                <Image source={{ uri: user.photo_url }} style={styles.iconProfileThumb} />
              ) : (
                <Text style={styles.iconInitial}>{user?.name.charAt(0).toUpperCase()}</Text>
              )}
              <Text style={styles.iconLabel}>{user?.photo_url ? "Profile" : "Initial"}</Text>
            </Pressable>
            {MARKER_ICONS.map((item) => (
              <Pressable
                key={item.emoji}
                style={[
                  styles.iconCell,
                  user?.marker_icon === item.emoji && styles.iconCellActive,
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  iconMutation.mutate(item.emoji);
                }}
              >
                <Text style={styles.iconEmoji}>{item.emoji}</Text>
                <Text style={styles.iconLabel}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          {iconMutation.isPending && (
            <ActivityIndicator color={C.primary} style={{ marginTop: 16 }} />
          )}
        </View>
      </Modal>

      {/* ── Friend List Modal ──────────────────────────────────────────────── */}
      <Modal visible={showFriendList} transparent animationType="slide" onRequestClose={() => setShowFriendList(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowFriendList(false)} />
        <View style={[styles.modalSheet, styles.friendModalSheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.modalTitleRow}>
            <Text style={styles.modalTitle}>Friends</Text>
            <Pressable onPress={() => setShowFriendList(false)} hitSlop={12}>
              <Feather name="x" size={20} color={C.textMuted} />
            </Pressable>
          </View>

          {incomingRequests.length > 0 && (
            <View style={styles.friendsSection}>
              <Text style={styles.friendsSectionTitle}>Pending Requests</Text>
              {incomingRequests.map((req: any) => (
                <View key={req.friendship_id} style={styles.friendCard}>
                  <View style={styles.friendAvatar}>
                    {req.photo_url ? <Image source={{ uri: req.photo_url }} style={styles.friendAvatarImg} /> : <Text style={styles.friendAvatarTxt}>{req.name.charAt(0).toUpperCase()}</Text>}
                  </View>
                  <View style={styles.friendInfo}>
                    <Text style={styles.friendName}>{req.name}</Text>
                    <Text style={styles.friendStat}>Wants to connect</Text>
                  </View>
                  <View style={styles.requestActions}>
                    <Pressable style={styles.friendAcceptBtn} onPress={() => acceptMutation.mutate(req.friendship_id)}>
                      <Text style={styles.friendAcceptTxt}>Accept</Text>
                    </Pressable>
                    <Pressable style={styles.friendDeclineBtn} onPress={() => removeFriendMutation.mutate(req.friendship_id)}>
                      <Text style={styles.friendDeclineTxt}>Decline</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}

          {friendsList.length > 0 && (
            <View style={styles.friendsSection}>
              <Text style={styles.friendsSectionTitle}>Your Friends ({friendsList.length})</Text>
              {friendsList.map((f: any) => (
                <View key={f.friendship_id} style={styles.friendCard}>
                  <Pressable
                    style={styles.friendCardInfo}
                    onPress={() => { setViewProfileId(f.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                  >
                    <View style={styles.friendAvatar}>
                      {f.photo_url ? <Image source={{ uri: f.photo_url }} style={styles.friendAvatarImg} /> : <Text style={styles.friendAvatarTxt}>{f.name.charAt(0).toUpperCase()}</Text>}
                    </View>
                    <View style={styles.friendInfo}>
                      <Text style={styles.friendName}>{f.name}</Text>
                      <Text style={styles.friendStat}>{f.completed_runs} runs · {formatDistance(f.total_miles)} mi</Text>
                    </View>
                  </Pressable>
                  <Pressable
                    style={styles.friendRemoveBtn}
                    onPress={() => Alert.alert("Remove Friend", `Remove ${f.name} from your friends?`, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Remove", style: "destructive", onPress: () => removeFriendMutation.mutate(f.friendship_id) },
                    ])}
                  >
                    <Feather name="user-x" size={16} color={C.textMuted} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {friendsList.length === 0 && incomingRequests.length === 0 && (
            <View style={styles.emptyState}>
              <Feather name="users" size={32} color={C.textMuted} />
              <Text style={styles.emptyStateTitle}>No friends yet</Text>
              <Text style={styles.emptyStateTxt}>Tap "+ Add Friends" to find other runners.</Text>
            </View>
          )}
        </View>
        <HostProfileSheet hostId={viewProfileId} onClose={() => setViewProfileId(null)} />
      </Modal>

      {/* ── Add Friend Modal ───────────────────────────────────────────────── */}
      <Modal visible={showAddFriend} transparent animationType="slide" onRequestClose={() => { setShowAddFriend(false); setFriendSearch(""); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <Pressable style={styles.modalOverlay} onPress={() => { setShowAddFriend(false); setFriendSearch(""); }} />
        <View style={[styles.modalSheet, styles.friendModalSheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.modalTitleRow}>
            <Text style={styles.modalTitle}>Add Friends</Text>
            <Pressable onPress={() => { setShowAddFriend(false); setFriendSearch(""); }} hitSlop={12}>
              <Feather name="x" size={20} color={C.textMuted} />
            </Pressable>
          </View>

          <View style={styles.searchBox}>
            <Feather name="search" size={16} color={C.textMuted} />
            <TextInput
              style={[styles.searchInput, { color: C.text }]}
              value={friendSearch}
              onChangeText={setFriendSearch}
              placeholder="Search by username..."
              placeholderTextColor={C.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {friendSearch.length > 0 && (
              <Pressable onPress={() => setFriendSearch("")} hitSlop={8}>
                <Feather name="x" size={14} color={C.textMuted} />
              </Pressable>
            )}
          </View>

          {/* ── Invite Share ─────────────────────────────────────────────── */}
          <View style={styles.inviteDivider}>
            <View style={styles.inviteDivLine} />
            <Text style={styles.inviteDivTxt}>or</Text>
            <View style={styles.inviteDivLine} />
          </View>

          <View style={styles.inviteCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.inviteCardTitle}>Invite to FARA</Text>
              <Text style={styles.inviteCardSub}>Share a link so friends can download the app</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.inviteShareBtn, { opacity: pressed ? 0.75 : 1 }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                Share.share({
                  message: `Join me on FARA — the social running app! Download it here: ${APP_SHARE_URL}`,
                  url: APP_SHARE_URL,
                });
              }}
            >
              <Feather name="share-2" size={15} color={C.bg} />
              <Text style={styles.inviteShareBtnTxt}>Share Link</Text>
            </Pressable>
          </View>

          {friendSearch.length >= 2 && searchResults.length > 0 && (
            <View style={styles.friendsSection}>
              <Text style={styles.friendsSectionTitle}>Results</Text>
              {searchResults.map((u: any) => {
                const isAlreadyFriend = friendIds.has(u.id);
                const hasSent = sentIds.has(u.id);
                const hasIncoming = incomingRequests.some((r: any) => r.id === u.id);
                return (
                  <View key={u.id} style={styles.friendCard}>
                    <Pressable
                      style={styles.friendCardInfo}
                      onPress={() => { setViewProfileId(u.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                    >
                      <View style={styles.friendAvatar}>
                        {u.photo_url ? <Image source={{ uri: u.photo_url }} style={styles.friendAvatarImg} /> : <Text style={styles.friendAvatarTxt}>{u.name.charAt(0).toUpperCase()}</Text>}
                      </View>
                      <View style={styles.friendInfo}>
                        <Text style={styles.friendName}>{u.name}</Text>
                        <Text style={styles.friendStat}>
                          {u.username ? `@${u.username}  ·  ` : ""}{u.completed_runs} runs · {formatDistance(u.total_miles)} mi
                        </Text>
                      </View>
                    </Pressable>
                    {isAlreadyFriend ? (
                      <View style={styles.friendStatusBadge}><Feather name="check" size={12} color={C.primary} /><Text style={styles.friendStatusTxt}>Friends</Text></View>
                    ) : hasSent ? (
                      <View style={styles.friendStatusBadge}><Text style={styles.friendStatusTxt}>Sent</Text></View>
                    ) : hasIncoming ? (
                      <Pressable style={styles.friendAcceptBtn} onPress={() => { const r = incomingRequests.find((req: any) => req.id === u.id); if (r) acceptMutation.mutate(r.friendship_id); }}>
                        <Text style={styles.friendAcceptTxt}>Accept</Text>
                      </Pressable>
                    ) : (
                      <Pressable style={styles.friendAddBtn} onPress={() => sendRequestMutation.mutate(u.id)} disabled={sendRequestMutation.isPending}>
                        <Feather name="user-plus" size={14} color={C.bg} />
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {friendSearch.length >= 2 && searchResults.length === 0 && (
            <View style={styles.searchEmpty}>
              <Text style={styles.searchEmptyTxt}>No runners found for "{friendSearch}"</Text>
            </View>
          )}

        </View>
        <HostProfileSheet hostId={viewProfileId} onClose={() => setViewProfileId(null)} />
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Past Activity History Modal ─────────────────────────────────────── */}
      <Modal visible={showSoloHistory} transparent animationType="slide" onRequestClose={() => setShowSoloHistory(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowSoloHistory(false)} />
        <View style={[styles.modalSheet, styles.friendModalSheet, { paddingBottom: insets.bottom + 16, height: "75%", flexDirection: "column" }]}>
          {/* Header */}
          <View style={styles.modalTitleRow}>
            <Text style={styles.modalTitle}>Activity History</Text>
            <Pressable onPress={() => setShowSoloHistory(false)} hitSlop={12}>
              <Feather name="x" size={20} color={C.textMuted} />
            </Pressable>
          </View>

          {/* Activity toggle: Runs / Rides */}
          <View style={styles.histToggleRow}>
            {(["run", "ride"] as const).map((act) => (
              <Pressable
                key={act}
                style={[styles.histToggleChip, historyActivityFilter === act && styles.histToggleChipActive]}
                onPress={() => { Haptics.selectionAsync(); setHistoryActivityFilter(act); }}
              >
                <Ionicons
                  name={act === "ride" ? "bicycle-outline" : "walk-outline"}
                  size={13}
                  color={historyActivityFilter === act ? C.bg : C.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.histToggleChipTxt, historyActivityFilter === act && styles.histToggleChipTxtActive]}>
                  {act === "ride" ? "Rides" : "Runs"}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Type filter: All / Solo / Crew / Public / Friends */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.histTypeRow} contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingVertical: 4 }}>
            {(["all", "solo", "crew", "public", "friends"] as const).map((t) => {
              const active = historyTypeFilter === t;
              const TYPE_COLORS: Record<string, string> = { solo: C.primary, crew: C.gold, public: C.blue, friends: "#C084FC" };
              const color = t === "all" ? C.textSecondary : TYPE_COLORS[t];
              return (
                <Pressable
                  key={t}
                  style={[styles.histTypeChip, active && { backgroundColor: color + "22", borderColor: color }]}
                  onPress={() => { Haptics.selectionAsync(); setHistoryTypeFilter(t); }}
                >
                  <Text style={[styles.histTypeChipTxt, active && { color }]}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* List */}
          {(() => {
            const TYPE_COLORS: Record<string, string> = { solo: C.primary, crew: C.gold, public: C.blue, friends: "#C084FC" };
            const filtered = historyTypeFilter === "all"
              ? combinedHistory
              : combinedHistory.filter((r) => r.type === historyTypeFilter);

            if (filtered.length === 0) {
              return (
                <View style={styles.emptyState}>
                  <Ionicons name={historyActivityFilter === "ride" ? "bicycle-outline" : "walk-outline"} size={32} color={C.textMuted} />
                  <Text style={styles.emptyStateTxt}>
                    No {historyTypeFilter === "all" ? "" : historyTypeFilter + " "}{historyActivityFilter === "ride" ? "rides" : "runs"} yet
                  </Text>
                </View>
              );
            }

            return (
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 }}>
                {filtered.map((run) => {
                  const isSolo = run.type === "solo";
                  const typeColor = TYPE_COLORS[run.type];
                  const label = run.title || `${formatDistance(run.distance_miles)} mi ${run.activity_type === "ride" ? "ride" : "run"}`;
                  return (
                    <View key={`${run.type}-${run.id}`} style={styles.soloHistCard}>
                      <View style={styles.soloHistRow}>
                        <View style={styles.soloHistLeft}>
                          {/* Status dot with type color */}
                          <View style={[styles.soloHistCheck, { backgroundColor: typeColor + "22", borderColor: typeColor + "55" }]}>
                            <Feather name="check" size={12} color={typeColor} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <Text style={styles.soloHistTitle} numberOfLines={1}>{label}</Text>
                              {/* Type badge */}
                              <View style={[styles.histEventBadge, { backgroundColor: typeColor + "22" }]}>
                                <Text style={[styles.histEventBadgeTxt, { color: typeColor }]}>{run.type}</Text>
                              </View>
                            </View>
                            <Text style={styles.soloHistMeta}>
                              {formatDisplayDate(run.date)}
                              {isSolo && run.pace_min_per_mile ? ` · ${formatPaceSolo(run.pace_min_per_mile)}/mi` : ""}
                              {isSolo && run.duration_seconds ? ` · ${formatDurationSolo(run.duration_seconds)}` : ""}
                              {!isSolo && run.host_name ? ` · ${run.is_host ? "You hosted" : `by ${run.host_name}`}` : ""}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.soloHistRight}>
                          {isSolo ? (
                            <>
                              <Text style={styles.soloHistDist}>{formatDistance(run.distance_miles)}</Text>
                              <Text style={styles.soloHistDistUnit}>mi</Text>
                            </>
                          ) : (
                            <>
                              <Text style={styles.soloHistDist}>{formatDistance(run.min_distance ?? run.distance_miles)}</Text>
                              <Text style={styles.soloHistDistUnit}>mi</Text>
                            </>
                          )}
                          {run.is_starred && <Ionicons name="star" size={12} color={C.gold} style={{ marginLeft: 2 }} />}
                        </View>
                      </View>
                      {run.route_path && run.route_path.length > 1 && (
                        <ProfileMiniRouteMap path={run.route_path} />
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            );
          })()}
        </View>
      </Modal>

      {/* ── Favorites Modal ────────────────────────────────────────────────── */}
      <Modal visible={showFavorites} transparent animationType="slide" onRequestClose={() => setShowFavorites(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowFavorites(false)} />
        <View style={[styles.modalSheet, styles.friendModalSheet, { paddingBottom: insets.bottom + 16, height: "70%" }]}>
          {/* Header */}
          <View style={styles.modalTitleRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="star" size={18} color={C.gold} />
              <Text style={styles.modalTitle}>Favorites</Text>
            </View>
            <Pressable onPress={() => setShowFavorites(false)} hitSlop={12}>
              <Feather name="x" size={20} color={C.textMuted} />
            </Pressable>
          </View>

          {/* Runs / Rides toggle */}
          <View style={styles.histToggleRow}>
            {(["run", "ride"] as const).map((act) => (
              <Pressable
                key={act}
                style={[styles.histToggleChip, favActivityFilter === act && styles.histToggleChipActive]}
                onPress={() => { Haptics.selectionAsync(); setFavActivityFilter(act); }}
              >
                <Ionicons
                  name={act === "ride" ? "bicycle-outline" : "walk-outline"}
                  size={13}
                  color={favActivityFilter === act ? C.bg : C.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.histToggleChipTxt, favActivityFilter === act && styles.histToggleChipTxtActive]}>
                  {act === "ride" ? "Rides" : "Runs"}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* List */}
          {(() => {
            const favs = starredRuns.filter((r) => (r.activity_type ?? "run") === favActivityFilter);
            if (favs.length === 0) {
              return (
                <View style={styles.emptyState}>
                  <Ionicons name="star-outline" size={32} color={C.textMuted} />
                  <Text style={styles.emptyStateTxt}>
                    {favActivityFilter === "ride"
                      ? "Star rides in your history to save them here"
                      : "Star runs in your history to save them here"}
                  </Text>
                </View>
              );
            }
            return (
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 }}>
                {favs.map((run) => {
                  const label = run.title || `${formatDistance(run.distance_miles)} mi ${run.activity_type === "ride" ? "ride" : "run"}`;
                  return (
                    <View key={run.id} style={styles.soloHistCard}>
                      <View style={styles.soloHistRow}>
                        <View style={styles.soloHistLeft}>
                          <View style={[styles.soloHistCheck, { backgroundColor: C.gold + "22", borderColor: C.gold + "44" }]}>
                            <Ionicons name="star" size={12} color={C.gold} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.soloHistTitle} numberOfLines={1}>{label}</Text>
                            <Text style={styles.soloHistMeta}>
                              {formatDisplayDate(run.date)}
                              {run.pace_min_per_mile ? ` · ${formatPaceSolo(run.pace_min_per_mile)}/mi` : ""}
                              {run.duration_seconds ? ` · ${formatDurationSolo(run.duration_seconds)}` : ""}
                              {run.elevation_gain_ft ? ` · ${Math.round(run.elevation_gain_ft)}ft gain` : ""}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.soloHistRight}>
                          <Text style={styles.soloHistDist}>{formatDistance(run.distance_miles)}</Text>
                          <Text style={styles.soloHistDistUnit}>mi</Text>
                        </View>
                      </View>
                      {run.route_path && run.route_path.length > 1 && (
                        <ProfileMiniRouteMap path={run.route_path} />
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            );
          })()}
        </View>
      </Modal>

      {/* ── Top Runs Modal ─────────────────────────────────────────────────── */}
      {topRunsModal !== null && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setTopRunsModal(null)}>
          <Pressable style={styles.modalOverlay} onPress={() => setTopRunsModal(null)} />
          <View style={[styles.modalSheet, styles.friendModalSheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.modalTitleRow}>
              <Text style={styles.modalTitle}>
                {topRunsModal === "longest"
                  ? (profileActivity === "ride" ? "Top 5 Longest Rides" : "Top 5 Longest Runs")
                  : (profileActivity === "ride" ? "Top 5 Fastest Rides" : "Top 5 Fastest Runs")}
              </Text>
              <Pressable onPress={() => setTopRunsModal(null)} hitSlop={12}>
                <Feather name="x" size={20} color={C.textMuted} />
              </Pressable>
            </View>

            {(() => {
              const list = topRunsModal === "longest"
                ? computedTopRuns.longest
                : computedTopRuns.fastest;

              if (list.length === 0) {
                return (
                  <View style={styles.emptyState}>
                    <Feather name="activity" size={32} color={C.textMuted} />
                    <Text style={styles.emptyStateTxt}>
                      {profileActivity === "ride" ? "No completed rides yet" : "No completed runs yet"}
                    </Text>
                  </View>
                );
              }

              return list.map((run, i) => (
                <View key={i} style={styles.topRunRow}>
                  <View style={[styles.topRunRank, { borderColor: RANK_COLORS[i] + "66" }]}>
                    <Text style={[styles.topRunRankNum, { color: RANK_COLORS[i] }]}>#{i + 1}</Text>
                  </View>
                  <View style={styles.topRunInfo}>
                    <Text style={styles.topRunTitle} numberOfLines={1}>
                      {run.title || (run.run_type === "solo" ? "Solo run" : "Group run")}
                    </Text>
                    <Text style={styles.topRunMeta}>
                      {run.date ? fmtDate(run.date) : ""}
                      {run.pace ? ` · ${fmtPace(run.pace)}` : ""}
                    </Text>
                  </View>
                  <View style={styles.topRunStat}>
                    {topRunsModal === "longest" ? (
                      <>
                        <Text style={styles.topRunStatNum}>{formatDistance(run.dist)}</Text>
                        <Text style={styles.topRunStatUnit}>mi</Text>
                      </>
                    ) : (
                      <Text style={styles.topRunStatNum}>{fmtPace(run.pace)}</Text>
                    )}
                    <View style={[styles.topRunTypePill, { backgroundColor: run.run_type === "solo" ? C.primaryMuted : C.blue + "22" }]}>
                      <Text style={[styles.topRunTypeTxt, { color: run.run_type === "solo" ? C.primary : C.blue }]}>
                        {run.run_type}
                      </Text>
                    </View>
                  </View>
                </View>
              ));
            })()}
          </View>
        </Modal>
      )}

    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(C: ReturnType<typeof import("@/contexts/ThemeContext").useTheme>["C"]) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 20, gap: 24 },
  profileHeader: { flexDirection: "row", alignItems: "center", gap: 14 },

  actToggleRow: { flexDirection: "row", backgroundColor: C.surface, borderRadius: 10, padding: 3, gap: 3 },
  actToggleBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 8, borderRadius: 8 },
  actToggleBtnActive: { backgroundColor: C.card },
  actToggleTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textMuted },
  actToggleTxtActive: { color: C.primary },

  avatarWrap: { position: "relative" },
  avatar: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: C.primaryMuted, borderWidth: 2, borderColor: C.primary,
    alignItems: "center", justifyContent: "center",
  },
  avatarPhoto: {
    width: 64, height: 64, borderRadius: 32,
    borderWidth: 2, borderColor: C.primary,
  },
  cameraBadge: {
    position: "absolute",
    bottom: 0, right: 0,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: C.primaryDark,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: C.bg,
  },
  hostBadge: {
    position: "absolute",
    bottom: 0, left: 0,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: C.gold,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: C.bg,
  },
  avatarText: { fontFamily: "Outfit_700Bold", fontSize: 26, color: C.primary },

  profileInfo: { flex: 1, gap: 2 },
  profileNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  profileName: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text },
  profileEmail: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary },
  nameLockBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.orange + "18", borderRadius: 10, padding: 10, marginBottom: 4 },
  nameLockTxt: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.orange, flex: 1 },
  nameErrorTxt: { fontFamily: "Outfit_400Regular", fontSize: 12, color: "#FF6B6B", marginTop: 4 },
  roleChip: {
    flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4,
    alignSelf: "flex-start", backgroundColor: C.card, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: C.border,
  },
  roleText: { fontFamily: "Outfit_600SemiBold", fontSize: 11 },
  logoutBtn: { padding: 8 },

  statsGrid: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  statCard: {
    flex: 1, minWidth: "40%", backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, alignItems: "center", gap: 4,
  },
  statNum: { fontFamily: "Outfit_700Bold", fontSize: 24, color: C.primary },
  statName: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },

  section: { gap: 12 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  editBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },

  statsRow: {
    flexDirection: "row", gap: 16, backgroundColor: C.surface,
    borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border,
  },
  statsItem: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  statsVal: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.text },
  statsLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textSecondary },

  goalCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, gap: 10,
  },
  goalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  goalLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  goalValues: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  goalRemain: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted },

  unlockCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, gap: 8,
  },
  unlockRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  unlockText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary, flex: 1 },
  unlockCount: { fontFamily: "Outfit_700Bold", fontSize: 13, color: C.primary },
  unlockHint: {
    fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted,
    marginTop: 4, lineHeight: 18,
  },

  badgesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  badge: {
    width: "30%", flexGrow: 1, borderRadius: 14, padding: 14, alignItems: "center",
    gap: 6, borderWidth: 1,
  },
  badgeEarned: { backgroundColor: C.primaryMuted, borderColor: C.primary + "55" },
  badgeLocked: { backgroundColor: C.surface, borderColor: C.border },
  badgeLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 11, textAlign: "center" },
  badgeMiles: { fontFamily: "Outfit_700Bold", fontSize: 14 },

  nextMilestoneCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, gap: 10,
  },
  nextLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.textSecondary },
  nextRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  nextName: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text, flex: 1 },
  nextRemain: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted },

  historyCard: {
    flexDirection: "row", alignItems: "center", backgroundColor: C.surface,
    borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border,
    marginBottom: 8, gap: 12,
  },
  historyLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  historyType: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  historyTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  historyMeta: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textSecondary },
  historyStatus: {
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
  },
  historyStatusText: { fontFamily: "Outfit_600SemiBold", fontSize: 11 },

  emptyHistory: { alignItems: "center", gap: 8, paddingVertical: 24 },
  emptyHistoryText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  modalSheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderTopColor: C.borderLight, padding: 24, gap: 16,
  },
  modalTitle: { fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text },
  modalField: { gap: 6 },
  modalLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  modalInput: {
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 12,
    fontFamily: "Outfit_400Regular", fontSize: 15, color: C.text,
  },
  modalBtn: {
    backgroundColor: C.primary, borderRadius: 14, paddingVertical: 15,
    alignItems: "center", justifyContent: "center",
  },
  modalBtnText: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.bg },

  // ─── Icon Picker + Marker ─────────────────────────────────────────────────
  markerPreview: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: C.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.border,
  },
  markerCircle: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: C.surface, borderWidth: 2, borderColor: C.primary,
    alignItems: "center", justifyContent: "center", overflow: "hidden",
  },
  markerPhoto: { width: 52, height: 52, borderRadius: 26 },
  markerEmoji: { fontSize: 26 },
  markerInitial: { fontFamily: "Outfit_700Bold", fontSize: 22, color: C.primary },
  markerLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  markerSub: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary, marginTop: 2 },

  uploadPhotoBtn: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: C.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.border, marginBottom: 4,
  },
  uploadPhotoBtnThumb: {
    width: 44, height: 44, borderRadius: 22,
    borderWidth: 2, borderColor: C.primary,
  },
  uploadPhotoLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  uploadPhotoSub: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary, marginTop: 2 },

  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 4 },
  divLine: { flex: 1, height: 1, backgroundColor: C.border },
  divText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted },

  iconGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  iconCell: {
    width: 70, height: 70, borderRadius: 14,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    alignItems: "center", justifyContent: "center", gap: 4,
  },
  iconCellActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  iconInitial: { fontFamily: "Outfit_700Bold", fontSize: 22, color: C.primary },
  iconEmoji: { fontSize: 26 },
  iconLabel: { fontFamily: "Outfit_400Regular", fontSize: 9, color: C.textSecondary },
  iconProfileThumb: { width: 38, height: 38, borderRadius: 19 },
  fqRow: { flexDirection: "row", gap: 10, alignItems: "stretch" },
  fqCard: {
    flex: 1, minWidth: "40%",
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border,
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  fqLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  fqCount: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.primary },
  friendsQuickDot: { marginLeft: "auto" as const, backgroundColor: C.orange, borderRadius: 10, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  friendsQuickDotTxt: { fontFamily: "Outfit_700Bold", fontSize: 10, color: C.bg },
  modalTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  friendModalSheet: { maxHeight: "80%" as const, gap: 16 },
  searchPanel: { gap: 14, backgroundColor: C.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: C.border },
  searchInput: { flex: 1, fontFamily: "Outfit_400Regular", fontSize: 15, color: C.text },
  searchEmpty: { alignItems: "center", paddingVertical: 20 },
  searchEmptyTxt: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textMuted, textAlign: "center" },
  searchHint: { alignItems: "center", paddingVertical: 12 },
  searchHintTxt: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textMuted },
  friendsSection: { gap: 10 },
  friendsSectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.textSecondary, textTransform: "uppercase" as const, letterSpacing: 0.8, marginBottom: 2 },
  friendCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.surface, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.border },
  friendCardInfo: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  friendAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primaryMuted, borderWidth: 1, borderColor: C.primary + "33", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  friendAvatarImg: { width: 44, height: 44, borderRadius: 22 },
  friendAvatarTxt: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.primary },
  friendInfo: { flex: 1, gap: 2 },
  friendName: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.text },
  friendStat: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  friendAddBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  friendRemoveBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  friendStatusBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.primaryMuted, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: C.primary + "33" },
  friendStatusTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.primary },
  requestActions: { flexDirection: "row", gap: 8 },
  friendAcceptBtn: { backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  friendAcceptTxt: { fontFamily: "Outfit_700Bold", fontSize: 12, color: C.bg },
  friendDeclineBtn: { backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: C.border },
  friendDeclineTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.textSecondary },
  emptyState: { alignItems: "center", justifyContent: "center", paddingVertical: 48, gap: 12 },
  emptyStateTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text },
  emptyStateTxt: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center" },

  achCountBadge: {
    fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.primary,
    backgroundColor: C.primaryMuted, paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 10, overflow: "hidden" as const,
  },
  achInlineIcon: { fontSize: 18 },
  achOuterCard: {
    backgroundColor: C.surface, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
    borderWidth: 1, borderColor: C.border, overflow: "hidden" as const,
  },
  achCardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  achExpandedInCard: { gap: 14, marginTop: 14 },
  achDivider: { height: 1, backgroundColor: C.border },

  achGrid: { flexDirection: "row", flexWrap: "wrap" },
  achGridCell: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingVertical: 10, borderRadius: 10,
  },
  achGridCellSelected: { backgroundColor: C.primaryMuted },
  achGridIcon: { fontSize: 32 },
  achGridDot: {
    width: 5, height: 5, borderRadius: 3,
    backgroundColor: C.primary, marginTop: 3,
  },
  achDetailPanel: {
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border, gap: 8,
  },
  achDetailPanelIcon: { fontSize: 28 },

  achFilterRow: { flexShrink: 0, marginBottom: 0 },
  achFilterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  achFilterChipActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  achFilterTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.textSecondary },
  achFilterTxtActive: { color: C.primary },

  achItem: {
    flexDirection: "row", alignItems: "flex-start", gap: 14,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  achItemIcon: { fontSize: 26, lineHeight: 32 },
  achItemIconLocked: { opacity: 0.22 },
  achItemName: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.text },
  achItemNameLocked: { color: C.textMuted },
  achItemDesc: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary },
  achDetail: { gap: 6, marginTop: 4 },
  achDetailCategory: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  achDetailProgress: { gap: 4 },
  achProgressTrack: { height: 6, backgroundColor: C.border, borderRadius: 3, overflow: "hidden" as const },
  achProgressFill: { height: 6, borderRadius: 3 },
  achProgressTxt: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  achProgressTrackSmall: { height: 3, backgroundColor: C.border, borderRadius: 2, overflow: "hidden" as const, marginTop: 2 },
  achProgressFillSmall: { height: 3, borderRadius: 2, backgroundColor: C.primaryDark },

  statCardTappable: { borderWidth: 1, borderColor: C.border + "88" },

  topRunRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: C.surface, borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: C.border,
  },
  topRunRank: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 1.5, alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  topRunRankNum: { fontFamily: "Outfit_700Bold", fontSize: 12 },
  topRunInfo: { flex: 1, gap: 2 },
  topRunTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  topRunMeta: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  topRunStat: { alignItems: "flex-end", gap: 4 },
  topRunStatNum: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.text },
  topRunStatUnit: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },
  topRunTypePill: {
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2,
  },
  topRunTypeTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 10, textTransform: "uppercase" as const, letterSpacing: 0.4 },

  inviteDivider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 2 },
  inviteDivLine: { flex: 1, height: 1, backgroundColor: C.border },
  inviteDivTxt: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted },
  inviteCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.border,
  },
  inviteCardTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text, marginBottom: 2 },
  inviteCardSub: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  inviteShareBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.primary, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 9, flexShrink: 0,
  },
  inviteShareBtnTxt: { fontFamily: "Outfit_700Bold", fontSize: 13, color: C.bg },

  ratingWarningCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    backgroundColor: C.surface, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, marginBottom: 12,
  },
  ratingWarningText: {
    flex: 1, fontFamily: "Outfit_400Regular", fontSize: 13, lineHeight: 18,
  },
  viewPastBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.surface, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    borderWidth: 1, borderColor: C.primary + "44",
    marginBottom: 4,
  },
  viewPastBtnTxt: {
    flex: 1, fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.primary,
  },
  soloHistCard: {
    backgroundColor: C.surface, borderRadius: 14,
    padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: C.border,
  },
  soloHistRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  soloHistLeft: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  soloHistCheck: {
    width: 24, height: 24, borderRadius: 8, backgroundColor: C.primary + "22",
    alignItems: "center", justifyContent: "center", marginTop: 1,
  },
  soloHistTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  soloHistMeta: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary, marginTop: 2 },
  soloHistRight: { alignItems: "flex-end" },
  soloHistDist: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text },
  soloHistDistUnit: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },

  histToggleRow: {
    flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingBottom: 10,
  },
  histToggleChip: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingVertical: 8, borderRadius: 10,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  histToggleChipActive: {
    backgroundColor: C.primary, borderColor: C.primary,
  },
  histToggleChipTxt: {
    fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary,
  },
  histToggleChipTxtActive: {
    color: C.bg,
  },
  histTypeRow: {
    flexGrow: 0, marginBottom: 8,
  },
  histTypeChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  histTypeChipTxt: {
    fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.textSecondary,
  },
  histEventBadge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  histEventBadgeTxt: {
    fontFamily: "Outfit_600SemiBold", fontSize: 10,
  },

}); }

function makeDevStyles(C: ReturnType<typeof import("@/contexts/ThemeContext").useTheme>["C"]) { return StyleSheet.create({
  versionWrap: { alignItems: "center", paddingVertical: 8 },
  versionText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted },
  devPanel: {
    backgroundColor: C.surface, borderRadius: 14, padding: 20,
    borderWidth: 1, borderColor: C.border, gap: 12,
  },
  devTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },
  devBtn: {
    backgroundColor: C.primaryMuted, borderRadius: 12, padding: 14,
    alignItems: "center", borderWidth: 1, borderColor: C.primary + "55",
  },
  devBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.primary },
  devClose: { alignItems: "center", paddingVertical: 8 },
  devCloseText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textMuted },
}); }
