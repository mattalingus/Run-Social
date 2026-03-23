import React, { useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
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
import ShareActivityModal, { ShareRunData } from "@/components/ShareActivityModal";
import { darkColors as C } from "@/constants/colors";
import { MARKER_ICONS } from "@/constants/markerIcons";
import { ACHIEVEMENTS, type AchievementDef } from "@/constants/achievements";
import { formatDistance } from "@/lib/formatDistance";
import { toDisplayDist, toDisplayPace, unitLabel, type DistanceUnit } from "@/lib/units";
import { pickAndUploadImage } from "@/lib/uploadImage";
import MileSplitsChart from "@/components/MileSplitsChart";
import HostProfileSheet from "@/components/HostProfileSheet";
import SettingsModal from "@/components/SettingsModal";
import * as WebBrowser from "expo-web-browser";
import { Linking } from "react-native";
import { requestContactsPermission, scanContacts, type ContactMatch, type NonMemberContact, type ContactScanResult } from "@/lib/contactsDiscovery";
import WalkthroughPulse from "@/components/WalkthroughPulse";
const APP_SHARE_URL = Platform.OS === "ios"
  ? "https://apps.apple.com/us/app/paceup-move-together/id6760092871"
  : "https://paceupapp.com";

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
  my_final_distance?: number | null;
  my_final_pace?: number | null;
  my_route_path?: any[] | null;
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
  my_final_distance?: number | null;
  my_final_pace?: number | null;
  duration_seconds?: number | null;
  elevation_gain_ft?: number | null;
  step_count?: number | null;
  move_time_seconds?: number | null;
  distance_tier?: 1 | 2 | 3 | null;
  route_path?: Array<{ latitude: number; longitude: number }> | null;
  mile_splits?: Array<{ label: string; paceMinPerMile: number; isPartial: boolean }> | null;
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


function fmtTotalTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
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

function ProfileMiniRouteMap({ path }: { path: RoutePoint[] | null | undefined }) {
  if (Platform.OS === "web") return null;
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
  step_count?: number | null;
  move_time_seconds?: number | null;
  completed: boolean;
  planned: boolean;
  date: string;
  activity_type: string;
  is_starred: boolean;
  route_path: Array<{ latitude: number; longitude: number }> | null;
  mile_splits?: Array<{ label: string; paceMinPerMile: number; isPartial: boolean }> | null;
}

function ProfileScreenInner() {
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
  const [gender, setGender] = useState(user?.gender || "");
  const [devTaps, setDevTaps] = useState(0);
  const [showDevMode, setShowDevMode] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [uploadingProfile, setUploadingProfile] = useState(false);
  const [uploadingPin, setUploadingPin] = useState(false);
  const [topRunsModal, setTopRunsModal] = useState<"longest" | "fastest" | null>(null);
  const [showSoloHistory, setShowSoloHistory] = useState(false);
  const [historyActivityFilter, setHistoryActivityFilter] = useState<"run" | "ride" | "walk">("run");
  const [historyTypeFilter, setHistoryTypeFilter] = useState<"all" | HistoryEventType>("all");
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [shareRunData, setShareRunData] = useState<ShareRunData | null>(null);
  const [showFavorites, setShowFavorites] = useState(false);
  const [expandedFavId, setExpandedFavId] = useState<string | null>(null);
  const [favActivityFilter, setFavActivityFilter] = useState<"run" | "ride" | "walk">("run");
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
  const [contactMatches, setContactMatches] = useState<ContactMatch[]>([]);
  const [nonMemberContacts, setNonMemberContacts] = useState<NonMemberContact[]>([]);
  const [contactsScanning, setContactsScanning] = useState(false);
  const [contactsScanned, setContactsScanned] = useState(false);
  const [fbConnecting, setFbConnecting] = useState(false);
  const [dismissedContacts, setDismissedContacts] = useState<Set<string>>(new Set());
  const [showPhoneInput, setShowPhoneInput] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");

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
        gender: gender || null,
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

  const { data: fbSuggestions = [] } = useQuery<any[]>({
    queryKey: ["/api/friends/facebook-suggestions"],
    enabled: !!user && !!(user as any)?.facebook_id,
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
    const totalMovingSeconds = filtered.reduce((s, r) => {
      const secs = (r as any).move_time_seconds ?? r.duration_seconds ?? 0;
      return s + secs;
    }, 0);
    return { totalMiles, monthMiles, yearMiles, count: filtered.length, avgPace, totalMovingSeconds };
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
    // Compute distance ranks for solo runs of the filtered activity type
    const completedSolo = soloRuns
      .filter((r) => r.completed && (r.activity_type ?? "run") === historyActivityFilter)
      .sort((a, b) => b.distance_miles - a.distance_miles);
    const distRankMap = new Map<string, 1 | 2 | 3 | null>();
    completedSolo.forEach((r, i) => {
      distRankMap.set(r.id, i < 3 ? ((i + 1) as 1 | 2 | 3) : null);
    });

    const soloPart: UnifiedHistoryItem[] = completedSolo
      .map((r) => ({
        id: r.id,
        type: "solo" as const,
        title: r.title,
        date: r.date,
        distance_miles: r.distance_miles,
        pace_min_per_mile: r.pace_min_per_mile,
        duration_seconds: r.duration_seconds,
        elevation_gain_ft: r.elevation_gain_ft,
        step_count: (r as any).step_count ?? null,
        move_time_seconds: (r as any).move_time_seconds ?? null,
        distance_tier: distRankMap.get(r.id) ?? null,
        route_path: r.route_path,
        mile_splits: (r as any).mile_splits ?? null,
        activity_type: r.activity_type ?? "run",
        is_starred: r.is_starred,
      }));

    const groupPart: UnifiedHistoryItem[] = runs
      .filter((r) => {
        const isPast = new Date(r.date) < now;
        const wasInvolved = r.is_host || r.my_is_present || r.my_final_distance != null;
        return isPast && wasInvolved && (r.activity_type ?? "run") === historyActivityFilter;
      })
      .map((r) => {
        let type: HistoryEventType = "public";
        if (r.crew_id) type = "crew";
        else if (r.privacy === "friends") type = "friends";
        const actualDist: number = r.my_final_distance ?? (r.min_distance + r.max_distance) / 2;
        const actualPace: number | null = r.my_final_pace ?? (r.min_pace != null ? (r.min_pace + r.max_pace) / 2 : null);
        const routePath = r.my_route_path ?? null;
        return {
          id: r.id,
          type,
          title: r.title,
          date: r.date,
          distance_miles: actualDist,
          min_distance: r.min_distance,
          max_distance: r.max_distance,
          pace_min_per_mile: actualPace,
          my_final_distance: r.my_final_distance ?? null,
          my_final_pace: r.my_final_pace ?? null,
          duration_seconds: null,
          elevation_gain_ft: null,
          route_path: routePath,
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
      <WalkthroughPulse stepId="profile-intro" style={{ borderRadius: 16 }}>
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
              <Text style={styles.avatarText}>{user.name?.charAt(0)?.toUpperCase() ?? "?"}</Text>
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
              setEditNameValue(user.name ?? "");
              setNameError("");
              setShowEditName(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
          >
            <Text style={styles.profileName}>{user.name ?? "User"}</Text>
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
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/notifications"); }}
            style={styles.logoutBtn}
          >
            <Feather name="bell" size={18} color={C.textMuted} />
          </Pressable>
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
      </WalkthroughPulse>

      {/* ── Friends Quick-Access Row ───────────────────────────────────────── */}
      <WalkthroughPulse stepId="friends" style={{ borderRadius: 16 }}>
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
          <Text style={styles.goalLabel}>{"Find Friends"}</Text>
        </Pressable>
      </View>
      </WalkthroughPulse>

      {/* ── Achievements Card ─────────────────────────────────────────────── */}
      <WalkthroughPulse stepId="achievements" style={{ borderRadius: 16 }}>
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
                const rowHasSelected = selectedAchievement != null && row.some((a) => a.slug === selectedAchievement.slug);
                return (
                  <React.Fragment key={rowIdx}>
                    <View style={{ flexDirection: "row", justifyContent: "space-evenly", alignSelf: "stretch" }}>
                      {row.map((ach) => {
                        const earned = earnedSlugs.has(ach.slug);
                        const isSelected = selectedAchievement?.slug === ach.slug;
                        return (
                          <Pressable
                            key={ach.slug}
                            style={[styles.achGridCell, isSelected && styles.achGridCellSelected]}
                            onPress={() => setSelectedAchievement(isSelected ? null : ach)}
                          >
                            <View style={[
                              styles.achBadge,
                              earned
                                ? { backgroundColor: ach.iconBg, borderColor: ach.iconColor + "55" }
                                : { backgroundColor: C.surface, borderColor: C.border },
                            ]}>
                              <Ionicons
                                name={ach.icon as any}
                                size={20}
                                color={earned ? ach.iconColor : C.textMuted}
                              />
                            </View>
                            {earned && <View style={styles.achGridDot} />}
                          </Pressable>
                        );
                      })}
                      {row.length < 5 && Array.from({ length: 5 - row.length }, (_, i) => (
                        <View key={`pad-${i}`} style={styles.achGridCell} />
                      ))}
                    </View>
                    {rowHasSelected && (() => {
                      const ach = selectedAchievement!;
                      const earned = earnedSlugs.has(ach.slug);
                      const current = ach.progressKey ? Math.min(achStats[ach.progressKey] ?? 0, ach.progressTarget ?? 1) : 0;
                      const target = ach.progressTarget ?? 1;
                      const pct = Math.min(current / target, 1);
                      return (
                        <View style={styles.achFloatCard}>
                          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                            <View style={[
                              styles.achBadgeLarge,
                              earned
                                ? { backgroundColor: ach.iconBg, borderColor: ach.iconColor + "66" }
                                : { backgroundColor: C.surface, borderColor: C.border },
                            ]}>
                              <Ionicons name={ach.icon as any} size={26} color={earned ? ach.iconColor : C.textMuted} />
                            </View>
                            <View style={{ flex: 1, marginLeft: 12 }}>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                <Text style={styles.goalLabel}>{ach.name}</Text>
                                {earned && <Feather name="check-circle" size={13} color={C.primary} />}
                              </View>
                              <Text style={styles.statName}>{ach.category} · Difficulty {ach.difficulty}/6</Text>
                            </View>
                            <Pressable onPress={() => setSelectedAchievement(null)} hitSlop={10} style={{ padding: 2 }}>
                              <Feather name="x" size={16} color={C.textMuted} />
                            </Pressable>
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
                  </React.Fragment>
                );
              })}
            </View>
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
        <Pressable
          style={[styles.actToggleBtn, profileActivity === "walk" && styles.actToggleBtnActive]}
          onPress={() => { setProfileActivity("walk"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <Ionicons name="footsteps" size={14} color={profileActivity === "walk" ? C.primary : C.textMuted} />
          <Text style={[styles.actToggleTxt, profileActivity === "walk" && styles.actToggleTxtActive]}>Walks</Text>
        </Pressable>
      </View>

      {/* ── Stats Grid ────────────────────────────────────────────────────── */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{toDisplayDist(actStats.totalMiles, distUnit)}</Text>
          <Text style={styles.statName}>{distUnit === "km" ? "Total KM" : "Total Miles"}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{actStats.totalMovingSeconds > 0 ? fmtTotalTime(actStats.totalMovingSeconds) : "—"}</Text>
          <Text style={styles.statName}>Total Time</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{actStats.count}</Text>
          <Text style={styles.statName}>{profileActivity === "ride" ? "Rides Done" : profileActivity === "walk" ? "Walks Done" : "Runs Done"}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{user.hosted_runs ?? 0}</Text>
          <Text style={styles.statName}>Hosted</Text>
        </View>
        {(user.avg_rating ?? 0) > 0 && (
          <View style={styles.statCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <Text style={[styles.statNum, { color: C.gold }]}>{(user.avg_rating ?? 0).toFixed(1)}</Text>
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
          <Text style={styles.statName}>{profileActivity === "ride" ? "Longest Ride" : profileActivity === "walk" ? "Longest Walk" : "Longest Run"}</Text>
          <Feather name="chevron-right" size={10} color={C.textMuted} style={{ marginTop: 2 }} />
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.statCard, styles.statCardTappable, { opacity: pressed ? 0.75 : 1 }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTopRunsModal("fastest"); }}
        >
          <Text style={styles.statNum}>
            {computedTopRuns.fastest[0]?.pace != null ? toDisplayPace(computedTopRuns.fastest[0].pace, distUnit) : "—"}
          </Text>
          <Text style={styles.statName}>Fastest Pace</Text>
          <Feather name="chevron-right" size={10} color={C.textMuted} style={{ marginTop: 2 }} />
        </Pressable>
      </View>

      {/* ── Host Rating Warning ──────────────────────────────────────────────── */}
      {(user.avg_rating ?? 0) > 0 && (user.avg_rating ?? 0) < 4.0 && (user.rating_count ?? 0) >= 1 && (
        <View style={[styles.ratingWarningCard, { borderColor: (user.avg_rating ?? 0) < 3.5 ? "#FF6B3522" : "#FFB80022" }]}>
          <Feather name="alert-circle" size={14} color={(user.avg_rating ?? 0) < 3.5 ? "#FF6B35" : C.gold} />
          <Text style={[styles.ratingWarningText, { color: (user.avg_rating ?? 0) < 3.5 ? "#FF6B35" : C.gold }]}>
            {(user.avg_rating ?? 0) < 3.5
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
        <Ionicons name={profileActivity === "ride" ? "bicycle-outline" : profileActivity === "walk" ? "footsteps-outline" : "walk-outline"} size={16} color={C.primary} />
        <Text style={styles.viewPastBtnTxt}>
          {profileActivity === "ride" ? "View Past Rides" : profileActivity === "walk" ? "View Past Walks" : "View Past Runs"}
        </Text>
        <Feather name="chevron-right" size={16} color={C.primary} />
      </Pressable>

      {/* ── My Stats ──────────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>My Stats</Text>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statsItem}>
            <Ionicons name={profileActivity === "ride" ? "bicycle" : profileActivity === "walk" ? "footsteps" : "walk"} size={16} color={C.orange} />
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
                <Text style={styles.markerInitial}>{user.name?.charAt(0)?.toUpperCase() ?? "?"}</Text>
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
      </WalkthroughPulse>

      {/* ── Mileage Goals ─────────────────────────────────────────────────── */}
      <WalkthroughPulse stepId="goals" style={{ borderRadius: 16 }}>
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
          <ProgressBar value={actStats.monthMiles} total={user.monthly_goal ?? 50} />
          <Text style={styles.goalRemain}>
            {toDisplayDist(Math.max(0, (user.monthly_goal ?? 50) - actStats.monthMiles), distUnit)} remaining
          </Text>
        </View>
        <View style={[styles.goalCard, { marginTop: 10 }]}>
          <View style={styles.goalHeader}>
            <Text style={styles.goalLabel}>This Year</Text>
            <Text style={styles.goalValues}>{toDisplayDist(actStats.yearMiles, distUnit)} / {toDisplayDist(user.yearly_goal ?? 500, distUnit)}</Text>
          </View>
          <ProgressBar value={actStats.yearMiles} total={user.yearly_goal ?? 500} color={C.blue} />
          <Text style={styles.goalRemain}>
            {toDisplayDist(Math.max(0, (user.yearly_goal ?? 500) - actStats.yearMiles), distUnit)} remaining
          </Text>
        </View>
      </View>
      </WalkthroughPulse>

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
          {profileActivity === "ride" ? "View Favorite Rides" : profileActivity === "walk" ? "View Favorite Walks" : "View Favorite Runs"}
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
        <Text style={styles.sectionTitle}>{profileActivity === "ride" ? "Ride Schedule" : profileActivity === "walk" ? "Walk Schedule" : "Run Schedule"}</Text>
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
                {profileActivity === "ride" ? "No upcoming rides" : profileActivity === "walk" ? "No upcoming walks" : "No upcoming runs"}
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
                  <Text style={styles.historyMeta}>{formatDate(run.date)} · {run.min_distance === run.max_distance ? toDisplayDist(run.min_distance, distUnit).split(" ")[0] : `${toDisplayDist(run.min_distance, distUnit).split(" ")[0]}–${toDisplayDist(run.max_distance, distUnit).split(" ")[0]}`} {unitLabel(distUnit)}</Text>
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
        <Text style={devStylesObj.versionText}>PaceUp v1.0</Text>
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
            <Text style={styles.modalLabel}>Monthly Goal ({unitLabel(distUnit)})</Text>
            <TextInput
              style={styles.modalInput}
              value={monthlyGoal}
              onChangeText={setMonthlyGoal}
              keyboardType="decimal-pad"
              placeholderTextColor={C.textMuted}
            />
          </View>
          <View style={styles.modalField}>
            <Text style={styles.modalLabel}>Yearly Goal ({unitLabel(distUnit)})</Text>
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
          <View style={{ gap: 4, marginTop: 16 }}>
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary, marginLeft: 4 }}>Gender</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {["Man", "Woman", "Prefer not to say"].map((g) => (
                <Pressable
                  key={g}
                  style={{
                    flex: 1, height: 40, borderRadius: 10, backgroundColor: C.surface, borderWidth: 1,
                    borderColor: gender === g ? C.primary : C.border,
                    alignItems: "center", justifyContent: "center",
                  }}
                  onPress={() => { Haptics.selectionAsync(); setGender(g); }}
                >
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 12, color: gender === g ? C.primary : C.textSecondary }}>{g}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Pressable
            style={({ pressed }) => [styles.modalBtn, { opacity: pressed ? 0.8 : 1, marginTop: 24 }]}
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
                <Text style={styles.iconInitial}>{user?.name?.charAt(0)?.toUpperCase() ?? "?"}</Text>
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
                    {req.photo_url ? <Image source={{ uri: req.photo_url }} style={styles.friendAvatarImg} /> : <Text style={styles.friendAvatarTxt}>{req.name?.charAt(0)?.toUpperCase() ?? "?"}</Text>}
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
                      {f.photo_url ? <Image source={{ uri: f.photo_url }} style={styles.friendAvatarImg} /> : <Text style={styles.friendAvatarTxt}>{f.name?.charAt(0)?.toUpperCase() ?? "?"}</Text>}
                    </View>
                    <View style={styles.friendInfo}>
                      <Text style={styles.friendName}>{f.name}</Text>
                      <Text style={styles.friendStat}>{f.completed_runs} runs · {toDisplayDist(f.total_miles, distUnit)}</Text>
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
          <ScrollView showsVerticalScrollIndicator={false} bounces={false} keyboardShouldPersistTaps="handled">
          <View style={styles.modalTitleRow}>
            <Text style={styles.modalTitle}>Find Friends</Text>
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
                        {u.photo_url ? <Image source={{ uri: u.photo_url }} style={styles.friendAvatarImg} /> : <Text style={styles.friendAvatarTxt}>{u.name?.charAt(0)?.toUpperCase() ?? "?"}</Text>}
                      </View>
                      <View style={styles.friendInfo}>
                        <Text style={styles.friendName}>{u.name}</Text>
                        <Text style={styles.friendStat}>
                          {u.username ? `@${u.username}  ·  ` : ""}{u.completed_runs} runs · {toDisplayDist(u.total_miles, distUnit)}
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
              <Text style={styles.searchEmptyTxt}>No users found for "{friendSearch}"</Text>
            </View>
          )}

          {/* ── Find from Contacts ─────────────────────────────────────── */}
          {Platform.OS !== "web" && (
            <>
              <View style={styles.inviteDivider}>
                <View style={styles.inviteDivLine} />
                <Text style={styles.inviteDivTxt}>or</Text>
                <View style={styles.inviteDivLine} />
              </View>

              <Pressable
                style={({ pressed }) => [styles.contactsScanBtn, { opacity: pressed ? 0.8 : 1 }]}
                onPress={async () => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setContactsScanning(true);
                  try {
                    const granted = await requestContactsPermission();
                    if (!granted) {
                      Alert.alert("Contacts Access", "Please allow access to your contacts in Settings to find friends on PaceUp.");
                      return;
                    }
                    const result = await scanContacts();
                    setContactMatches(result.matches);
                    setNonMemberContacts(result.nonMembers);
                    setContactsScanned(true);
                    setDismissedContacts(new Set());
                  } catch (e: any) {
                    Alert.alert("Error", e.message || "Could not scan contacts");
                  } finally {
                    setContactsScanning(false);
                  }
                }}
                disabled={contactsScanning}
              >
                {contactsScanning ? (
                  <ActivityIndicator size="small" color={C.primary} />
                ) : (
                  <Ionicons name="people" size={20} color={C.primary} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inviteCardTitle, { color: C.text }]}>Find from Contacts</Text>
                  <Text style={styles.inviteCardSub}>
                    {contactsScanned
                      ? `${contactMatches.length} friend${contactMatches.length !== 1 ? "s" : ""} found on PaceUp`
                      : "See which of your contacts are on PaceUp"}
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={C.textMuted} />
              </Pressable>

              {contactsScanned && contactMatches.filter((u) => !dismissedContacts.has(u.id)).length > 0 && (
                <View style={styles.friendsSection}>
                  <Text style={styles.friendsSectionTitle}>From Your Contacts</Text>
                  {contactMatches.filter((u) => !dismissedContacts.has(u.id)).map((u) => {
                    const isAlreadyFriend = friendIds.has(u.id);
                    const hasSent = sentIds.has(u.id);
                    return (
                      <View key={u.id} style={styles.friendCard}>
                        <Pressable
                          style={styles.friendCardInfo}
                          onPress={() => { setViewProfileId(u.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                        >
                          <View style={styles.friendAvatar}>
                            {u.photo_url ? <Image source={{ uri: u.photo_url }} style={styles.friendAvatarImg} /> : <Text style={styles.friendAvatarTxt}>{u.name?.charAt(0)?.toUpperCase() ?? "?"}</Text>}
                          </View>
                          <View style={styles.friendInfo}>
                            <Text style={styles.friendName}>{u.name}</Text>
                            {u.contactName && u.contactName !== u.name && <Text style={[styles.friendStat, { fontSize: 11, color: C.textMuted }]}>{u.contactName} in your contacts</Text>}
                            <Text style={styles.friendStat}>
                              {u.username ? `@${u.username}` : ""}{u.total_miles ? ` · ${toDisplayDist(u.total_miles, distUnit)}` : ""}
                            </Text>
                          </View>
                        </Pressable>
                        {isAlreadyFriend ? (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <View style={styles.friendStatusBadge}><Feather name="check" size={12} color={C.primary} /><Text style={styles.friendStatusTxt}>Friends</Text></View>
                            <Pressable onPress={() => setDismissedContacts((s) => new Set(s).add(u.id))} hitSlop={8}>
                              <Feather name="x" size={14} color={C.textMuted} />
                            </Pressable>
                          </View>
                        ) : hasSent ? (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <View style={styles.friendStatusBadge}><Text style={styles.friendStatusTxt}>Sent</Text></View>
                            <Pressable onPress={() => setDismissedContacts((s) => new Set(s).add(u.id))} hitSlop={8}>
                              <Feather name="x" size={14} color={C.textMuted} />
                            </Pressable>
                          </View>
                        ) : (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Pressable style={styles.friendAddBtn} onPress={() => sendRequestMutation.mutate(u.id)} disabled={sendRequestMutation.isPending}>
                              <Feather name="user-plus" size={14} color={C.bg} />
                            </Pressable>
                            <Pressable onPress={() => setDismissedContacts((s) => new Set(s).add(u.id))} hitSlop={8}>
                              <Feather name="x" size={14} color={C.textMuted} />
                            </Pressable>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}

              {contactsScanned && contactMatches.length === 0 && (
                <View style={styles.searchEmpty}>
                  <Ionicons name="people-outline" size={28} color={C.textMuted} style={{ marginBottom: 6 }} />
                  <Text style={styles.searchEmptyTxt}>None of your contacts are on PaceUp yet</Text>
                  <Text style={[styles.searchEmptyTxt, { fontSize: 12, marginTop: 2 }]}>Invite them below!</Text>
                </View>
              )}

              {contactsScanned && nonMemberContacts.length > 0 && (
                <View style={styles.friendsSection}>
                  <Text style={styles.friendsSectionTitle}>Invite to PaceUp</Text>
                  {nonMemberContacts.slice(0, 15).map((c, idx) => (
                    <View key={`nm-${idx}`} style={styles.friendCard}>
                      <View style={styles.friendCardInfo}>
                        <View style={[styles.friendAvatar, { backgroundColor: C.border }]}>
                          <Text style={styles.friendAvatarTxt}>{c.name?.charAt(0)?.toUpperCase() ?? "?"}</Text>
                        </View>
                        <View style={styles.friendInfo}>
                          <Text style={styles.friendName}>{c.name}</Text>
                          <Text style={styles.friendStat}>Not on PaceUp</Text>
                        </View>
                      </View>
                      <Pressable
                        style={({ pressed }) => [styles.inviteSmsBtnSmall, { opacity: pressed ? 0.75 : 1 }]}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          const body = encodeURIComponent(`Hey! Join me on PaceUp for group runs & rides: ${APP_SHARE_URL}`);
                          const phone = c.phone.replace(/\D/g, "");
                          const smsUrl = Platform.OS === "ios"
                            ? `sms:${phone}&body=${body}`
                            : `sms:${phone}?body=${body}`;
                          Linking.openURL(smsUrl).catch(() => {});
                        }}
                      >
                        <Feather name="message-circle" size={13} color={C.primary} />
                        <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.primary }}>Invite</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}

          {/* ── Find Facebook Friends ─────────────────────────────────── */}
          <View style={[styles.inviteDivider, { marginTop: Platform.OS === "web" ? 16 : 6 }]}>
            <View style={styles.inviteDivLine} />
            <Text style={styles.inviteDivTxt}>social</Text>
            <View style={styles.inviteDivLine} />
          </View>

          <Pressable
            style={({ pressed }) => [styles.contactsScanBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={async () => {
              if ((user as any)?.facebook_id) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setFbConnecting(true);
              try {
                const res = await apiRequest("GET", "/api/auth/facebook/start");
                const data = await res.json();
                if (data.url) {
                  await WebBrowser.openBrowserAsync(data.url);
                  qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
                  qc.invalidateQueries({ queryKey: ["/api/friends/facebook-suggestions"] });
                  refreshUser();
                }
              } catch (e: any) {
                if (e.message?.includes("501") || e.message?.includes("404") || e.message?.includes("not configured")) {
                  Alert.alert("Coming Soon", "Facebook friend discovery is coming soon. It will be enabled in an upcoming app update.");
                } else {
                  Alert.alert("Error", e.message || "Could not connect Facebook");
                }
              } finally {
                setFbConnecting(false);
              }
            }}
            disabled={fbConnecting || !!(user as any)?.facebook_id}
          >
            {fbConnecting ? (
              <ActivityIndicator size="small" color="#1877F2" />
            ) : (
              <Ionicons name="logo-facebook" size={20} color="#1877F2" />
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.inviteCardTitle, { color: C.text }]}>Find Facebook Friends</Text>
              <Text style={styles.inviteCardSub}>
                {(user as any)?.facebook_id ? "Connected" : "Connect to find friends on Facebook"}
              </Text>
            </View>
            {(user as any)?.facebook_id ? (
              <Feather name="check-circle" size={18} color={C.primary} />
            ) : (
              <Feather name="chevron-right" size={18} color={C.textMuted} />
            )}
          </Pressable>

          {(user as any)?.facebook_id && fbSuggestions.length > 0 && (
            <View style={styles.friendsSection}>
              <Text style={styles.friendsSectionTitle}>Facebook Friends on PaceUp</Text>
              {fbSuggestions.map((u: any) => {
                const isAlreadyFriend = friendIds.has(u.id);
                const hasSent = sentIds.has(u.id);
                return (
                  <View key={u.id} style={styles.friendCard}>
                    <Pressable
                      style={styles.friendCardInfo}
                      onPress={() => { setViewProfileId(u.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                    >
                      <View style={styles.friendAvatar}>
                        {u.photo_url ? <Image source={{ uri: u.photo_url }} style={styles.friendAvatarImg} /> : <Text style={styles.friendAvatarTxt}>{u.name?.charAt(0)?.toUpperCase() ?? "?"}</Text>}
                      </View>
                      <View style={styles.friendInfo}>
                        <Text style={styles.friendName}>{u.name}</Text>
                        <Text style={styles.friendStat}>
                          {u.username ? `@${u.username}` : ""}{u.total_miles ? ` · ${toDisplayDist(u.total_miles, distUnit)}` : ""}
                        </Text>
                      </View>
                    </Pressable>
                    {isAlreadyFriend ? (
                      <View style={styles.friendStatusBadge}><Feather name="check" size={12} color={C.primary} /><Text style={styles.friendStatusTxt}>Friends</Text></View>
                    ) : hasSent ? (
                      <View style={styles.friendStatusBadge}><Text style={styles.friendStatusTxt}>Sent</Text></View>
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

          {(user as any)?.facebook_id && fbSuggestions.length === 0 && (
            <View style={[styles.searchEmpty, { marginTop: 4 }]}>
              <Text style={styles.searchEmptyTxt}>No Facebook friends found on PaceUp yet</Text>
            </View>
          )}

          {/* ── Add Your Phone ────────────────────────────────────────── */}
          {Platform.OS !== "web" && (
            <>
              <View style={[styles.inviteDivider, { marginTop: 6 }]}>
                <View style={styles.inviteDivLine} />
                <Text style={styles.inviteDivTxt}>your phone</Text>
                <View style={styles.inviteDivLine} />
              </View>

              {!showPhoneInput ? (
                <Pressable
                  style={({ pressed }) => [styles.contactsScanBtn, { opacity: pressed ? 0.8 : 1 }]}
                  onPress={() => { setShowPhoneInput(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                >
                  <Feather name="phone" size={18} color={C.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.inviteCardTitle, { color: C.text }]}>Add Your Phone Number</Text>
                    <Text style={styles.inviteCardSub}>Help friends find you by your phone number</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={C.textMuted} />
                </Pressable>
              ) : (
                <View style={styles.contactsScanBtn}>
                  <Feather name="phone" size={18} color={C.primary} />
                  <TextInput
                    style={{ flex: 1, color: C.text, fontFamily: "Outfit_400Regular", fontSize: 15, padding: 0 }}
                    value={phoneInput}
                    onChangeText={setPhoneInput}
                    placeholder="(555) 123-4567"
                    placeholderTextColor={C.textMuted}
                    keyboardType="phone-pad"
                    autoFocus
                  />
                  <Pressable
                    style={({ pressed }) => [styles.inviteShareBtn, { opacity: pressed ? 0.75 : 1, paddingHorizontal: 12, paddingVertical: 7 }]}
                    onPress={async () => {
                      const digits = phoneInput.replace(/\D/g, "");
                      if (digits.length < 7) { Alert.alert("Invalid", "Please enter a valid phone number"); return; }
                      try {
                        const { registerMyPhone } = await import("@/lib/contactsDiscovery");
                        await registerMyPhone(phoneInput);
                        Alert.alert("Saved", "Your phone number has been registered for friend discovery.");
                        setShowPhoneInput(false);
                        setPhoneInput("");
                      } catch (e: any) {
                        Alert.alert("Error", e.message || "Could not save phone number");
                      }
                    }}
                  >
                    <Text style={styles.inviteShareBtnTxt}>Save</Text>
                  </Pressable>
                </View>
              )}
            </>
          )}

          {/* ── Invite Share ─────────────────────────────────────────────── */}
          <View style={[styles.inviteDivider, { marginTop: 6 }]}>
            <View style={styles.inviteDivLine} />
            <Text style={styles.inviteDivTxt}>invite</Text>
            <View style={styles.inviteDivLine} />
          </View>

          <View style={styles.inviteCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.inviteCardTitle}>Invite to PaceUp</Text>
              <Text style={styles.inviteCardSub}>Share a link so friends can download the app</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.inviteShareBtn, { opacity: pressed ? 0.75 : 1 }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                Share.share({
                  message: `Join me on PaceUp — discover group runs & rides! Download it here: ${APP_SHARE_URL}`,
                  url: APP_SHARE_URL,
                });
              }}
            >
              <Feather name="share-2" size={15} color={C.bg} />
              <Text style={styles.inviteShareBtnTxt}>Share Link</Text>
            </Pressable>
          </View>
          </ScrollView>
        </View>
        <HostProfileSheet hostId={viewProfileId} onClose={() => setViewProfileId(null)} />
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Past Activity History Modal ─────────────────────────────────────── */}
      <Modal visible={showSoloHistory} transparent animationType="slide" onRequestClose={() => setShowSoloHistory(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowSoloHistory(false)} />
        <View style={[styles.modalSheet, styles.friendModalSheet, { paddingBottom: insets.bottom + 16, paddingHorizontal: 16, height: "75%", flexDirection: "column" }]}>
          {/* Header */}
          <View style={styles.modalTitleRow}>
            <Text style={styles.modalTitle}>Activity History</Text>
            <Pressable onPress={() => setShowSoloHistory(false)} hitSlop={12}>
              <Feather name="x" size={20} color={C.textMuted} />
            </Pressable>
          </View>

          {/* Activity toggle: Runs / Rides / Walks */}
          <View style={[styles.histToggleRow, { paddingHorizontal: 0 }]}>
            {(["run", "ride", "walk"] as const).map((act) => (
              <Pressable
                key={act}
                style={[styles.histToggleChip, historyActivityFilter === act && styles.histToggleChipActive]}
                onPress={() => { Haptics.selectionAsync(); setHistoryActivityFilter(act); }}
              >
                <Ionicons
                  name={act === "ride" ? "bicycle-outline" : act === "walk" ? "footsteps-outline" : "walk-outline"}
                  size={13}
                  color={historyActivityFilter === act ? C.bg : C.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.histToggleChipTxt, historyActivityFilter === act && styles.histToggleChipTxtActive]}>
                  {act === "ride" ? "Rides" : act === "walk" ? "Walks" : "Runs"}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Type filter: All / Solo / Crew / Public / Friends */}
          <View style={{ flexDirection: "row", gap: 6, marginBottom: 8 }}>
            {(["all", "solo", "crew", "public", "friends"] as const).map((t) => {
              const active = historyTypeFilter === t;
              const TYPE_COLORS: Record<string, string> = { solo: C.primary, crew: C.gold, public: C.blue, friends: "#C084FC" };
              const color = t === "all" ? C.textSecondary : TYPE_COLORS[t];
              return (
                <Pressable
                  key={t}
                  style={[styles.histTypeChip, { flex: 1, alignItems: "center" }, active && { backgroundColor: color + "22", borderColor: color }]}
                  onPress={() => { Haptics.selectionAsync(); setHistoryTypeFilter(t); }}
                >
                  <Text style={[styles.histTypeChipTxt, active && { color }]}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

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
                    No {historyTypeFilter === "all" ? "" : historyTypeFilter + " "}{historyActivityFilter === "ride" ? "rides" : historyActivityFilter === "walk" ? "walks" : "runs"} yet
                  </Text>
                </View>
              );
            }

            return (
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 0, paddingTop: 4, paddingBottom: 8 }}>
                {filtered.map((run) => {
                  const isSolo = run.type === "solo";
                  const typeColor = TYPE_COLORS[run.type];
                  const label = run.title || `${toDisplayDist(run.distance_miles, distUnit)} ${run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run"}`;
                  const histKey = `${run.type}-${run.id}`;
                  const isExpanded = expandedHistoryId === histKey;
                  return (
                    <View key={histKey} style={[styles.soloHistCard, { marginBottom: 10 }]}>
                      <Pressable
                        style={({ pressed }) => [styles.soloHistRow, { opacity: pressed ? 0.85 : 1 }]}
                        onPress={() => { Haptics.selectionAsync(); setExpandedHistoryId(isExpanded ? null : histKey); }}
                      >
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
                              {/* PR badge for top 3 solo distance runs */}
                              {isSolo && run.distance_tier != null && (() => {
                                const prColor = run.distance_tier === 1 ? "#FFB800" : run.distance_tier === 2 ? "#C0C0C0" : "#CD7F32";
                                const prLabel = run.distance_tier === 1 ? "PR" : run.distance_tier === 2 ? "2nd" : "3rd";
                                return (
                                  <View style={[styles.histEventBadge, { backgroundColor: prColor + "25", flexDirection: "row", alignItems: "center", gap: 3 }]}>
                                    <Ionicons name="medal" size={10} color={prColor} />
                                    <Text style={[styles.histEventBadgeTxt, { color: prColor }]}>{prLabel}</Text>
                                  </View>
                                );
                              })()}
                            </View>
                            <Text style={styles.soloHistMeta}>
                              {formatDisplayDate(run.date)}
                              {run.pace_min_per_mile ? ` · ${toDisplayPace(run.pace_min_per_mile, distUnit)}` : ""}
                              {run.duration_seconds ? ` · ${formatDurationSolo(run.duration_seconds)}` : ""}
                              {!isSolo && run.host_name ? ` · ${run.is_host ? "You hosted" : `by ${run.host_name}`}` : ""}
                              {isSolo && run.elevation_gain_ft ? ` · ${Math.round(run.elevation_gain_ft)}ft elev` : ""}
                            </Text>
                          </View>
                        </View>
                        <View style={[styles.soloHistRight, { flexDirection: "row", alignItems: "center", gap: 6 }]}>
                          <Pressable
                            onPress={() => {
                              Haptics.selectionAsync();
                              setShowSoloHistory(false);
                              setShareRunData({
                                distanceMi: isSolo ? run.distance_miles : (run.my_final_distance ?? run.distance_miles),
                                paceMinPerMile: isSolo ? run.pace_min_per_mile : (run.my_final_pace ?? run.pace_min_per_mile),
                                durationSeconds: run.duration_seconds,
                                routePath: run.route_path ?? undefined,
                                activityType: run.activity_type,
                                eventTitle: !isSolo ? (run.title ?? undefined) : undefined,
                              });
                            }}
                            hitSlop={10}
                            style={{ padding: 4 }}
                          >
                            <Feather name="share-2" size={16} color={C.textMuted} />
                          </Pressable>
                          <View style={{ alignItems: "flex-end" }}>
                            <Text style={styles.soloHistDist}>{toDisplayDist(run.distance_miles, distUnit).split(" ")[0]}</Text>
                            <Text style={styles.soloHistDistUnit}>{unitLabel(distUnit)}</Text>
                          </View>
                          {run.is_starred && <Ionicons name="star" size={12} color={C.gold} />}
                          <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color={C.textMuted} />
                        </View>
                      </Pressable>

                      {/* Route map — always visible */}
                      {run.route_path && run.route_path.length > 1 && (
                        <ProfileMiniRouteMap path={run.route_path} />
                      )}

                      {/* Expanded stats panel */}
                      {isExpanded && isSolo && (
                        <View style={styles.soloStatPanel}>
                          <View style={styles.soloStatRow}>
                            {run.duration_seconds != null && (
                              <View style={styles.soloStatItem}>
                                <Feather name="clock" size={13} color={C.primary} />
                                <Text style={styles.soloStatLabel}>Time</Text>
                                <Text style={styles.soloStatValue}>{formatDurationSolo(run.duration_seconds)}</Text>
                              </View>
                            )}
                            {run.pace_min_per_mile != null && (
                              <View style={styles.soloStatItem}>
                                <Feather name="zap" size={13} color={C.primary} />
                                <Text style={styles.soloStatLabel}>Pace</Text>
                                <Text style={styles.soloStatValue}>{toDisplayPace(run.pace_min_per_mile, distUnit)}</Text>
                              </View>
                            )}
                            <View style={styles.soloStatItem}>
                              <Feather name="map-pin" size={13} color={C.primary} />
                              <Text style={styles.soloStatLabel}>Distance</Text>
                              <Text style={styles.soloStatValue}>{toDisplayDist(run.distance_miles, distUnit)}</Text>
                            </View>
                            {run.elevation_gain_ft != null && (
                              <View style={styles.soloStatItem}>
                                <Feather name="trending-up" size={13} color={C.primary} />
                                <Text style={styles.soloStatLabel}>Elevation</Text>
                                <Text style={styles.soloStatValue}>{Math.round(run.elevation_gain_ft)} ft</Text>
                              </View>
                            )}
                          </View>
                          {run.mile_splits && run.mile_splits.length > 0 && (
                            <MileSplitsChart splits={run.mile_splits} activityType={run.activity_type} />
                          )}
                          <Pressable
                            style={({ pressed }) => [styles.shareActivityBtn, { opacity: pressed ? 0.75 : 1 }]}
                            onPress={() => {
                              Haptics.selectionAsync();
                              setShowSoloHistory(false);
                              setShareRunData({
                                distanceMi: run.distance_miles,
                                paceMinPerMile: run.pace_min_per_mile,
                                durationSeconds: run.duration_seconds,
                                routePath: run.route_path ?? undefined,
                                activityType: run.activity_type,
                              });
                            }}
                          >
                            <Feather name="share-2" size={14} color={C.primary} />
                            <Text style={styles.shareActivityBtnTxt}>Share Activity</Text>
                          </Pressable>
                        </View>
                      )}

                      {/* Expanded info for group runs */}
                      {isExpanded && !isSolo && (
                        <View style={[styles.soloStatPanel, { paddingVertical: 10 }]}>
                          {run.pace_min_per_mile != null && (
                            <Text style={[styles.soloHistMeta, { textAlign: "center" }]}>
                              Pace: {toDisplayPace(run.pace_min_per_mile, distUnit)}
                              {run.duration_seconds ? `  ·  Duration: ${formatDurationSolo(run.duration_seconds)}` : ""}
                            </Text>
                          )}
                          <Pressable
                            style={({ pressed }) => [styles.shareActivityBtn, { opacity: pressed ? 0.75 : 1, marginTop: 8 }]}
                            onPress={() => {
                              Haptics.selectionAsync();
                              setShowSoloHistory(false);
                              setShareRunData({
                                distanceMi: run.my_final_distance ?? run.distance_miles,
                                paceMinPerMile: run.my_final_pace ?? run.pace_min_per_mile,
                                durationSeconds: run.duration_seconds,
                                routePath: run.route_path ?? undefined,
                                activityType: run.activity_type,
                                eventTitle: run.title ?? undefined,
                              });
                            }}
                          >
                            <Feather name="share-2" size={14} color={C.primary} />
                            <Text style={styles.shareActivityBtnTxt}>Share Activity</Text>
                          </Pressable>
                        </View>
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
      <Modal visible={showFavorites} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowFavorites(false)}>
        <View style={[styles.modalSheet, { flex: 1, height: undefined, borderRadius: 0, paddingBottom: insets.bottom + 8, backgroundColor: C.bg }]}>
          {/* Header */}
          <View style={[styles.modalTitleRow, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16), borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 14 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="star" size={18} color={C.gold} />
              <Text style={styles.modalTitle}>Favorites</Text>
            </View>
            <Pressable onPress={() => { setShowFavorites(false); setExpandedFavId(null); }} hitSlop={12}
              style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, alignItems: "center", justifyContent: "center" }}>
              <Feather name="x" size={18} color={C.text} />
            </Pressable>
          </View>

          {/* Runs / Rides / Walks toggle — full width */}
          <View style={[styles.histToggleRow, { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 }]}>
            {(["run", "ride", "walk"] as const).map((act) => (
              <Pressable
                key={act}
                style={[styles.histToggleChip, { paddingVertical: 10 }, favActivityFilter === act && styles.histToggleChipActive]}
                onPress={() => { Haptics.selectionAsync(); setFavActivityFilter(act); setExpandedFavId(null); }}
              >
                <Ionicons
                  name={act === "ride" ? "bicycle-outline" : act === "walk" ? "footsteps-outline" : "walk-outline"}
                  size={15}
                  color={favActivityFilter === act ? C.bg : C.textSecondary}
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.histToggleChipTxt, { fontSize: 14 }, favActivityFilter === act && styles.histToggleChipTxtActive]}>
                  {act === "ride" ? "Rides" : act === "walk" ? "Walks" : "Runs"}
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
                  <Ionicons name="star-outline" size={36} color={C.textMuted} />
                  <Text style={styles.emptyStateTxt}>
                    {favActivityFilter === "ride"
                      ? "Star rides in your history to save them here"
                      : favActivityFilter === "walk"
                      ? "Star walks in your history to save them here"
                      : "Star runs in your history to save them here"}
                  </Text>
                </View>
              );
            }
            return (
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 2, paddingBottom: 20 }}>
                {favs.map((run) => {
                  const isExpanded = expandedFavId === run.id;
                  const label = run.title || `${toDisplayDist(run.distance_miles, distUnit)} ${run.activity_type === "ride" ? "ride" : run.activity_type === "walk" ? "walk" : "run"}`;
                  return (
                    <View key={run.id} style={[styles.soloHistCard, { marginBottom: 10 }]}>
                      {/* Main row */}
                      <Pressable
                        style={({ pressed }) => [styles.soloHistRow, { opacity: pressed ? 0.85 : 1 }]}
                        onPress={() => { Haptics.selectionAsync(); setExpandedFavId(isExpanded ? null : run.id); }}
                      >
                        <View style={styles.soloHistLeft}>
                          <View style={[styles.soloHistCheck, { backgroundColor: C.gold + "22", borderColor: C.gold + "44" }]}>
                            <Ionicons name="star" size={12} color={C.gold} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.soloHistTitle} numberOfLines={1}>{label}</Text>
                            <Text style={styles.soloHistMeta}>
                              {formatDisplayDate(run.date)}
                              {run.duration_seconds ? ` · ${formatDurationSolo(run.duration_seconds)}` : ""}
                              {run.pace_min_per_mile ? ` · ${toDisplayPace(run.pace_min_per_mile, distUnit)}` : ""}
                              {run.elevation_gain_ft ? ` · ${Math.round(run.elevation_gain_ft)}ft` : ""}
                            </Text>
                          </View>
                        </View>
                        <View style={[styles.soloHistRight, { flexDirection: "row", alignItems: "center", gap: 6 }]}>
                          <View style={{ alignItems: "flex-end" }}>
                            <Text style={styles.soloHistDist}>{toDisplayDist(run.distance_miles, distUnit).split(" ")[0]}</Text>
                            <Text style={styles.soloHistDistUnit}>{distUnit === "km" ? "km" : "mi"}</Text>
                          </View>
                          <Feather name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color={C.textMuted} />
                        </View>
                      </Pressable>

                      {/* Route map */}
                      {run.route_path && run.route_path.length > 1 && Platform.OS !== "web" && (
                        <ProfileMiniRouteMap path={run.route_path} />
                      )}

                      {/* Expanded stats panel */}
                      {isExpanded && (
                        <View style={styles.soloStatPanel}>
                          <View style={styles.soloStatRow}>
                            {run.duration_seconds != null && (
                              <View style={styles.soloStatItem}>
                                <Feather name="clock" size={13} color={C.primary} />
                                <Text style={styles.soloStatLabel}>Time</Text>
                                <Text style={styles.soloStatValue}>{formatDurationSolo(run.duration_seconds)}</Text>
                              </View>
                            )}
                            {run.pace_min_per_mile != null && (
                              <View style={styles.soloStatItem}>
                                <Feather name="zap" size={13} color={C.primary} />
                                <Text style={styles.soloStatLabel}>Pace</Text>
                                <Text style={styles.soloStatValue}>{toDisplayPace(run.pace_min_per_mile, distUnit)}</Text>
                              </View>
                            )}
                            <View style={styles.soloStatItem}>
                              <Feather name="map-pin" size={13} color={C.primary} />
                              <Text style={styles.soloStatLabel}>Distance</Text>
                              <Text style={styles.soloStatValue}>{toDisplayDist(run.distance_miles, distUnit)}</Text>
                            </View>
                            {run.elevation_gain_ft != null && (
                              <View style={styles.soloStatItem}>
                                <Feather name="trending-up" size={13} color={C.primary} />
                                <Text style={styles.soloStatLabel}>Elevation</Text>
                                <Text style={styles.soloStatValue}>{Math.round(run.elevation_gain_ft)} ft</Text>
                              </View>
                            )}
                            {(run as any).move_time_seconds != null && (
                              <View style={styles.soloStatItem}>
                                <Feather name="clock" size={13} color={C.primary} />
                                <Text style={styles.soloStatLabel}>Move Time</Text>
                                <Text style={styles.soloStatValue}>{formatDurationSolo((run as any).move_time_seconds)}</Text>
                              </View>
                            )}
                            {(run as any).step_count != null && run.activity_type !== "ride" && (
                              <View style={styles.soloStatItem}>
                                <Ionicons name="footsteps-outline" size={13} color={C.primary} />
                                <Text style={styles.soloStatLabel}>Steps</Text>
                                <Text style={styles.soloStatValue}>{((run as any).step_count as number).toLocaleString()}</Text>
                              </View>
                            )}
                          </View>
                        </View>
                      )}

                      {/* Mile splits */}
                      {isExpanded && run.mile_splits && run.mile_splits.length > 0 && (
                        <View style={{ paddingHorizontal: 12, paddingBottom: 14 }}>
                          <MileSplitsChart splits={run.mile_splits} activityType={run.activity_type} />
                        </View>
                      )}
                      {isExpanded && (!run.mile_splits || run.mile_splits.length === 0) && (
                        <View style={{ paddingHorizontal: 12, paddingBottom: 4, alignItems: "center" }}>
                          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, textAlign: "center" }}>
                            {`Splits available for activities of 1+ ${unitLabel(distUnit)}`}
                          </Text>
                        </View>
                      )}
                      {isExpanded && (
                        <Pressable
                          style={({ pressed }) => [styles.shareActivityBtn, { opacity: pressed ? 0.75 : 1 }]}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setShowFavorites(false);
                            setShareRunData({
                              distanceMi: run.distance_miles,
                              paceMinPerMile: run.pace_min_per_mile,
                              durationSeconds: run.duration_seconds,
                              routePath: run.route_path ?? undefined,
                              activityType: run.activity_type,
                            });
                          }}
                        >
                          <Feather name="share-2" size={14} color={C.primary} />
                          <Text style={styles.shareActivityBtnTxt}>Share Activity</Text>
                        </Pressable>
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
                  ? (profileActivity === "ride" ? "Top 5 Longest Rides" : profileActivity === "walk" ? "Top 5 Longest Walks" : "Top 5 Longest Runs")
                  : (profileActivity === "ride" ? "Top 5 Fastest Rides" : profileActivity === "walk" ? "Top 5 Fastest Walks" : "Top 5 Fastest Runs")}
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
                      {profileActivity === "ride" ? "No completed rides yet" : profileActivity === "walk" ? "No completed walks yet" : "No completed runs yet"}
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
                      {run.title || (run.run_type === "solo" ? (profileActivity === "ride" ? "Solo ride" : profileActivity === "walk" ? "Solo walk" : "Solo run") : (profileActivity === "ride" ? "Group ride" : profileActivity === "walk" ? "Group walk" : "Group run"))}
                    </Text>
                    <Text style={styles.topRunMeta}>
                      {run.date ? fmtDate(run.date) : ""}
                      {run.pace ? ` · ${toDisplayPace(run.pace, distUnit)}` : ""}
                    </Text>
                  </View>
                  <View style={styles.topRunStat}>
                    {topRunsModal === "longest" ? (
                      <>
                        <Text style={styles.topRunStatNum}>{toDisplayDist(run.dist, distUnit).split(" ")[0]}</Text>
                        <Text style={styles.topRunStatUnit}>{unitLabel(distUnit)}</Text>
                      </>
                    ) : (
                      <Text style={styles.topRunStatNum}>{toDisplayPace(run.pace, distUnit)}</Text>
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

      {shareRunData && (
        <ShareActivityModal
          visible={!!shareRunData}
          onClose={() => setShareRunData(null)}
          runData={shareRunData}
        />
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
  achBadge: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5,
  },
  achBadgeLarge: {
    width: 54, height: 54, borderRadius: 27,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2,
  },
  achGridDot: {
    width: 5, height: 5, borderRadius: 3,
    backgroundColor: C.primary, marginTop: 3,
  },
  achDetailPanel: {
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border, gap: 8,
  },
  achFloatCard: {
    backgroundColor: C.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.border, gap: 8,
    marginTop: 6, marginHorizontal: 2,
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

  contactsScanBtn: {
    flexDirection: "row" as const, alignItems: "center" as const, gap: 12,
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.border, marginBottom: 10,
  },
  inviteSmsBtnSmall: {
    flexDirection: "row" as const, alignItems: "center" as const, gap: 4,
    borderWidth: 1, borderColor: C.primary + "44", borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6,
  },

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

  soloStatPanel: {
    marginTop: 8, marginBottom: 4, paddingVertical: 12, paddingHorizontal: 8,
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border,
  },
  soloStatRow: { flexDirection: "row", justifyContent: "space-around" },
  soloStatItem: { alignItems: "center", gap: 3, flex: 1 },
  soloStatLabel: { fontFamily: "Outfit_400Regular", fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  soloStatValue: { fontFamily: "Outfit_700Bold", fontSize: 13, color: C.text },
  shareActivityBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginHorizontal: 12, marginTop: 10, marginBottom: 4, paddingVertical: 9,
    borderRadius: 10, borderWidth: 1, borderColor: C.primary + "40",
    backgroundColor: C.primary + "12",
  },
  shareActivityBtnTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },

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

export default function ProfileScreen() {
  return (
    <ErrorBoundary>
      <ProfileScreenInner />
    </ErrorBoundary>
  );
}
