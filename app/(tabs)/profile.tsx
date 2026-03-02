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
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/query-client";
import C from "@/constants/colors";
import { MARKER_ICONS } from "@/constants/markerIcons";
import { ACHIEVEMENTS, type AchievementDef } from "@/constants/achievements";
import { formatDistance } from "@/lib/formatDistance";
import { pickAndUploadImage } from "@/lib/uploadImage";

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

function ProgressBar({ value, total, color = C.primary }: { value: number; total: number; color?: string }) {
  const pct = Math.min(1, total > 0 ? value / total : 0);
  return (
    <View style={pbarStyles.track}>
      <View style={[pbarStyles.fill, { width: `${pct * 100}%` as any, backgroundColor: color }]} />
    </View>
  );
}

const pbarStyles = StyleSheet.create({
  track: { height: 6, backgroundColor: C.border, borderRadius: 3, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3 },
});

interface RunHistoryItem {
  id: string;
  title: string;
  date: string;
  min_distance: number;
  max_distance: number;
  is_host: boolean;
  is_completed: boolean;
  my_status: string;
  host_name: string;
}

function formatDate(s: string) {
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout, refreshUser } = useAuth();
  const qc = useQueryClient();

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
  const [friendSearch, setFriendSearch] = useState("");
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [showFriendList, setShowFriendList] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [selectedAchievement, setSelectedAchievement] = useState<AchievementDef | null>(null);
  const [achFilter, setAchFilter] = useState("All");

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
          <Text style={styles.profileName}>{user.name}</Text>
          <Text style={styles.profileEmail}>{user.email}</Text>
          <View style={styles.roleChip}>
            <Feather name="user" size={11} color={C.primary} />
            <Text style={[styles.roleText, { color: C.primary }]}>Runner</Text>
          </View>
        </View>

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
                          ? `${(current / 10).toFixed(1)} / ${(target / 10).toFixed(1)} mi`
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

      {/* ── Stats Grid ────────────────────────────────────────────────────── */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{formatDistance(user.total_miles)}</Text>
          <Text style={styles.statName}>Total Miles</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{user.completed_runs}</Text>
          <Text style={styles.statName}>Runs Done</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{user.hosted_runs}</Text>
          <Text style={styles.statName}>Hosted</Text>
        </View>
        {user.avg_rating > 0 && (
          <View style={styles.statCard}>
            <Text style={[styles.statNum, { color: C.gold }]}>{user.avg_rating.toFixed(1)}</Text>
            <Text style={styles.statName}>Rating</Text>
          </View>
        )}
        <Pressable
          style={({ pressed }) => [styles.statCard, styles.statCardTappable, { opacity: pressed ? 0.75 : 1 }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTopRunsModal("longest"); }}
        >
          <Text style={styles.statNum}>
            {runRecords?.longest_run ? `${formatDistance(runRecords.longest_run)} mi` : "—"}
          </Text>
          <Text style={styles.statName}>Longest Run</Text>
          <Feather name="chevron-right" size={10} color={C.textMuted} style={{ marginTop: 2 }} />
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.statCard, styles.statCardTappable, { opacity: pressed ? 0.75 : 1 }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTopRunsModal("fastest"); }}
        >
          <Text style={styles.statNum}>
            {runRecords?.fastest_pace
              ? `${Math.floor(runRecords.fastest_pace)}:${Math.round((runRecords.fastest_pace % 1) * 60).toString().padStart(2, "0")}`
              : "—"}
          </Text>
          <Text style={styles.statName}>Fastest Pace</Text>
          <Feather name="chevron-right" size={10} color={C.textMuted} style={{ marginTop: 2 }} />
        </Pressable>
      </View>

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
            <Ionicons name="walk" size={16} color={C.orange} />
            <View>
              <Text style={styles.statsVal}>
                {user.avg_pace
                  ? `${Math.floor(user.avg_pace)}:${Math.round((user.avg_pace % 1) * 60).toString().padStart(2, "0")}/mi`
                  : "—"}
              </Text>
              <Text style={styles.statsLabel}>Avg Pace</Text>
            </View>
          </View>
          <View style={styles.statsItem}>
            <Feather name="target" size={16} color={C.blue} />
            <View>
              <Text style={styles.statsVal}>
                {user.avg_distance ? `${formatDistance(user.avg_distance)} mi` : "—"}
              </Text>
              <Text style={styles.statsLabel}>Avg Distance</Text>
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
            <Text style={styles.goalValues}>{formatDistance(user.miles_this_month)} / {user.monthly_goal} mi</Text>
          </View>
          <ProgressBar value={user.miles_this_month} total={user.monthly_goal} />
          <Text style={styles.goalRemain}>
            {formatDistance(Math.max(0, user.monthly_goal - user.miles_this_month))} mi remaining
          </Text>
        </View>
        <View style={[styles.goalCard, { marginTop: 10 }]}>
          <View style={styles.goalHeader}>
            <Text style={styles.goalLabel}>This Year</Text>
            <Text style={styles.goalValues}>{formatDistance(user.miles_this_year)} / {user.yearly_goal} mi</Text>
          </View>
          <ProgressBar value={user.miles_this_year} total={user.yearly_goal} color={C.blue} />
          <Text style={styles.goalRemain}>
            {formatDistance(Math.max(0, user.yearly_goal - user.miles_this_year))} mi remaining
          </Text>
        </View>
      </View>


      {/* ── Run History ───────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Run History</Text>
        {runsLoading ? (
          <ActivityIndicator color={C.primary} />
        ) : runs.length === 0 ? (
          <View style={styles.emptyHistory}>
            <Ionicons name="walk-outline" size={36} color={C.textMuted} />
            <Text style={styles.emptyHistoryText}>No runs yet — discover one now</Text>
          </View>
        ) : (
          runs.slice(0, 10).map((run) => (
            <Pressable
              key={run.id}
              style={({ pressed }) => [styles.historyCard, { opacity: pressed ? 0.8 : 1 }]}
              onPress={() => router.push(`/run/${run.id}`)}
            >
              <View style={styles.historyLeft}>
                <View style={[styles.historyType, { backgroundColor: run.is_host ? C.gold + "22" : C.primaryMuted }]}>
                  <Feather name={run.is_host ? "star" : "user"} size={12} color={run.is_host ? C.gold : C.primary} />
                </View>
                <View>
                  <Text style={styles.historyTitle} numberOfLines={1}>{run.title}</Text>
                  <Text style={styles.historyMeta}>{formatDate(run.date)} · {formatDistance(run.min_distance)}–{formatDistance(run.max_distance)} mi</Text>
                </View>
              </View>
              <View style={[styles.historyStatus, { backgroundColor: run.is_completed ? C.primary + "22" : C.border }]}>
                <Text style={[styles.historyStatusText, { color: run.is_completed ? C.primary : C.textMuted }]}>
                  {run.is_completed ? "Done" : "Upcoming"}
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </View>

      {/* ── Dev Mode ──────────────────────────────────────────────────────── */}
      <Pressable onPress={handleVersionTap} style={devStyles.versionWrap}>
        <Text style={devStyles.versionText}>PaceUp v1.0</Text>
      </Pressable>

      {showDevMode && (
        <View style={devStyles.devPanel}>
          <Text style={devStyles.devTitle}>Dev Mode</Text>
          <Pressable
            style={({ pressed }) => [devStyles.devBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              seedMutation.mutate();
            }}
            disabled={seedMutation.isPending}
          >
            {seedMutation.isPending
              ? <ActivityIndicator color={C.primary} />
              : <Text style={devStyles.devBtnText}>Generate 20 Random Runs</Text>
            }
          </Pressable>
          <Pressable onPress={() => setShowDevMode(false)} style={devStyles.devClose}>
            <Text style={devStyles.devCloseText}>Close Dev Mode</Text>
          </Pressable>
        </View>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────── */}

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
                  <View style={styles.friendAvatar}>
                    {f.photo_url ? <Image source={{ uri: f.photo_url }} style={styles.friendAvatarImg} /> : <Text style={styles.friendAvatarTxt}>{f.name.charAt(0).toUpperCase()}</Text>}
                  </View>
                  <View style={styles.friendInfo}>
                    <Text style={styles.friendName}>{f.name}</Text>
                    <Text style={styles.friendStat}>{f.completed_runs} runs · {formatDistance(f.total_miles)} mi</Text>
                  </View>
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
              placeholder="Search runners by name..."
              placeholderTextColor={C.textMuted}
              autoCapitalize="words"
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
              <Text style={styles.inviteCardTitle}>Invite to PaceUp</Text>
              <Text style={styles.inviteCardSub}>Share a link so friends can download the app</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.inviteShareBtn, { opacity: pressed ? 0.75 : 1 }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                Share.share({
                  message: `Join me on PaceUp — the social running app! Download it here: ${APP_SHARE_URL}`,
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
                    <View style={styles.friendAvatar}>
                      {u.photo_url ? <Image source={{ uri: u.photo_url }} style={styles.friendAvatarImg} /> : <Text style={styles.friendAvatarTxt}>{u.name.charAt(0).toUpperCase()}</Text>}
                    </View>
                    <View style={styles.friendInfo}>
                      <Text style={styles.friendName}>{u.name}</Text>
                      <Text style={styles.friendStat}>{u.completed_runs} runs · {formatDistance(u.total_miles)} mi</Text>
                    </View>
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
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Top Runs Modal ─────────────────────────────────────────────────── */}
      {topRunsModal !== null && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setTopRunsModal(null)}>
          <Pressable style={styles.modalOverlay} onPress={() => setTopRunsModal(null)} />
          <View style={[styles.modalSheet, styles.friendModalSheet, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.modalTitleRow}>
              <Text style={styles.modalTitle}>
                {topRunsModal === "longest" ? "Top 5 Longest Runs" : "Top 5 Fastest Runs"}
              </Text>
              <Pressable onPress={() => setTopRunsModal(null)} hitSlop={12}>
                <Feather name="x" size={20} color={C.textMuted} />
              </Pressable>
            </View>

            {(() => {
              const list = topRunsModal === "longest"
                ? (topRunsData?.longestRuns ?? [])
                : (topRunsData?.fastestRuns ?? []);

              if (list.length === 0) {
                return (
                  <View style={styles.emptyState}>
                    <Feather name="activity" size={32} color={C.textMuted} />
                    <Text style={styles.emptyStateTxt}>No completed runs yet</Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 20, gap: 24 },
  profileHeader: { flexDirection: "row", alignItems: "center", gap: 14 },

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
  profileName: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text },
  profileEmail: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary },
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
});

const devStyles = StyleSheet.create({
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
});
