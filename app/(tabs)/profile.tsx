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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/query-client";
import C from "@/constants/colors";
import { MARKER_ICONS } from "@/constants/markerIcons";

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

  function handleVersionTap() {
    const next = devTaps + 1;
    setDevTaps(next);
    if (next >= 5) {
      setShowDevMode(true);
      setDevTaps(0);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }

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

  const { data: achievements = [] } = useQuery<any[]>({
    queryKey: ["/api/users/me/achievements"],
    enabled: !!user,
  });

  const { data: runs = [], isLoading: runsLoading } = useQuery<RunHistoryItem[]>({
    queryKey: ["/api/runs/mine"],
    enabled: !!user,
  });

  const { data: unlockProgress } = useQuery<{ unique_hosts: number; total_runs: number }>({
    queryKey: ["/api/users/me/unlock-progress"],
    enabled: !!user && !user.host_unlocked,
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

  const milestones = [25, 100, 250, 500, 1000];
  const earnedIds = new Set(achievements.map((a: any) => a.milestone));

  if (!user) return <View style={styles.container}><ActivityIndicator color={C.primary} /></View>;

  const nextMilestone = milestones.find((m) => !earnedIds.has(m));

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
      <View style={styles.profileHeader}>
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.name.charAt(0).toUpperCase()}</Text>
          </View>
          {user.host_unlocked && (
            <View style={styles.hostBadge}>
              <Feather name="star" size={10} color={C.bg} />
            </View>
          )}
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>{user.name}</Text>
          <Text style={styles.profileEmail}>{user.email}</Text>
          <View style={styles.roleChip}>
            <Feather name={user.host_unlocked ? "star" : "user"} size={11} color={user.host_unlocked ? C.gold : C.primary} />
            <Text style={[styles.roleText, { color: user.host_unlocked ? C.gold : C.primary }]}>
              {user.host_unlocked ? "Host" : "Runner"}
            </Text>
          </View>
        </View>
        <Pressable onPress={async () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); await logout(); router.replace("/(auth)/login"); }} style={styles.logoutBtn}>
          <Feather name="log-out" size={18} color={C.textMuted} />
        </Pressable>
      </View>

      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{user.total_miles.toFixed(1)}</Text>
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
      </View>

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
              <Text style={styles.statsVal}>{Math.floor(user.avg_pace)}:{Math.round((user.avg_pace % 1) * 60).toString().padStart(2, "0")}/mi</Text>
              <Text style={styles.statsLabel}>Avg Pace</Text>
            </View>
          </View>
          <View style={styles.statsItem}>
            <Feather name="target" size={16} color={C.blue} />
            <View>
              <Text style={styles.statsVal}>{user.avg_distance} mi</Text>
              <Text style={styles.statsLabel}>Avg Distance</Text>
            </View>
          </View>
        </View>
      </View>

      {user.host_unlocked && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Map Marker</Text>
            <Pressable onPress={() => setShowIconPicker(true)} style={styles.editBtn}>
              <Feather name="edit-2" size={14} color={C.primary} />
              <Text style={styles.editBtnText}>Change</Text>
            </Pressable>
          </View>
          <Pressable
            style={iconStyles.markerPreview}
            onPress={() => setShowIconPicker(true)}
          >
            <View style={iconStyles.markerCircle}>
              {user.marker_icon ? (
                <Text style={iconStyles.markerEmoji}>{user.marker_icon}</Text>
              ) : (
                <Text style={iconStyles.markerInitial}>{user.name.charAt(0).toUpperCase()}</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={iconStyles.markerLabel}>
                {user.marker_icon ? "Custom icon" : "Profile initial"}
              </Text>
              <Text style={iconStyles.markerSub}>
                {user.marker_icon ? "Your runs show this icon on the map" : "Tap to choose a custom map icon"}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={C.textMuted} />
          </Pressable>
        </View>
      )}

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
            <Text style={styles.goalValues}>{user.miles_this_month.toFixed(1)} / {user.monthly_goal} mi</Text>
          </View>
          <ProgressBar value={user.miles_this_month} total={user.monthly_goal} />
          <Text style={styles.goalRemain}>
            {Math.max(0, user.monthly_goal - user.miles_this_month).toFixed(1)} mi remaining
          </Text>
        </View>
        <View style={[styles.goalCard, { marginTop: 10 }]}>
          <View style={styles.goalHeader}>
            <Text style={styles.goalLabel}>This Year</Text>
            <Text style={styles.goalValues}>{user.miles_this_year.toFixed(1)} / {user.yearly_goal} mi</Text>
          </View>
          <ProgressBar value={user.miles_this_year} total={user.yearly_goal} color={C.blue} />
          <Text style={styles.goalRemain}>
            {Math.max(0, user.yearly_goal - user.miles_this_year).toFixed(1)} mi remaining
          </Text>
        </View>
      </View>

      {!user.host_unlocked && unlockProgress && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Host Unlock Progress</Text>
          <View style={styles.unlockCard}>
            <View style={styles.unlockRow}>
              <Feather name="users" size={16} color={C.primary} />
              <Text style={styles.unlockText}>Runs completed with different hosts</Text>
              <Text style={styles.unlockCount}>{unlockProgress.unique_hosts}/2</Text>
            </View>
            <ProgressBar value={unlockProgress.unique_hosts} total={2} />
            <View style={[styles.unlockRow, { marginTop: 12 }]}>
              <Feather name="check-circle" size={16} color={C.primary} />
              <Text style={styles.unlockText}>Total runs completed</Text>
              <Text style={styles.unlockCount}>{unlockProgress.total_runs}/3</Text>
            </View>
            <ProgressBar value={unlockProgress.total_runs} total={3} />
            <Text style={styles.unlockHint}>Complete 3 runs with at least 2 different hosts to unlock hosting</Text>
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Achievements</Text>
        <View style={styles.badgesGrid}>
          {milestones.map((m) => {
            const earned = earnedIds.has(m);
            return (
              <View key={m} style={[styles.badge, earned ? styles.badgeEarned : styles.badgeLocked]}>
                <Feather name={MILESTONE_ICONS[m] as any} size={22} color={earned ? C.primary : C.textMuted} />
                <Text style={[styles.badgeLabel, { color: earned ? C.text : C.textMuted }]}>{MILESTONE_LABELS[m]}</Text>
                <Text style={[styles.badgeMiles, { color: earned ? C.primary : C.textMuted }]}>{m} mi</Text>
              </View>
            );
          })}
        </View>
        {nextMilestone && (
          <View style={styles.nextMilestoneCard}>
            <Text style={styles.nextLabel}>Next achievement</Text>
            <View style={styles.nextRow}>
              <Feather name={MILESTONE_ICONS[nextMilestone] as any} size={16} color={C.primary} />
              <Text style={styles.nextName}>{MILESTONE_LABELS[nextMilestone]} — {nextMilestone} miles</Text>
            </View>
            <ProgressBar value={user.total_miles} total={nextMilestone} />
            <Text style={styles.nextRemain}>{Math.max(0, nextMilestone - user.total_miles).toFixed(1)} mi to go</Text>
          </View>
        )}
      </View>

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
                  <Text style={styles.historyMeta}>{formatDate(run.date)} · {run.min_distance}–{run.max_distance} mi</Text>
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

      <Modal visible={showGoals} transparent animationType="slide" onRequestClose={() => setShowGoals(false)}>
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
      </Modal>

      <Modal visible={showPace} transparent animationType="slide" onRequestClose={() => setShowPace(false)}>
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
      </Modal>

      <Modal visible={showIconPicker} transparent animationType="slide" onRequestClose={() => setShowIconPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowIconPicker(false)} />
        <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={styles.modalTitle}>Choose Map Marker</Text>
          <Text style={[styles.modalLabel, { marginBottom: 16 }]}>
            This icon appears on the map when you host a run
          </Text>
          <View style={iconStyles.iconGrid}>
            <Pressable
              style={[iconStyles.iconCell, !user?.marker_icon && iconStyles.iconCellActive]}
              onPress={() => iconMutation.mutate(null)}
            >
              <Text style={iconStyles.iconInitial}>{user?.name.charAt(0).toUpperCase()}</Text>
              <Text style={iconStyles.iconLabel}>Initial</Text>
            </Pressable>
            {MARKER_ICONS.map((item) => (
              <Pressable
                key={item.emoji}
                style={[iconStyles.iconCell, user?.marker_icon === item.emoji && iconStyles.iconCellActive]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  iconMutation.mutate(item.emoji);
                }}
              >
                <Text style={iconStyles.iconEmoji}>{item.emoji}</Text>
                <Text style={iconStyles.iconLabel}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          {iconMutation.isPending && (
            <ActivityIndicator color={C.primary} style={{ marginTop: 16 }} />
          )}
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 20, gap: 24 },
  profileHeader: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatarWrap: { position: "relative" },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.primaryMuted,
    borderWidth: 2,
    borderColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: "Outfit_700Bold", fontSize: 26, color: C.primary },
  hostBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: C.gold,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: C.bg,
  },
  profileInfo: { flex: 1, gap: 2 },
  profileName: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text },
  profileEmail: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary },
  roleChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
    alignSelf: "flex-start",
    backgroundColor: C.card,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: C.border,
  },
  roleText: { fontFamily: "Outfit_600SemiBold", fontSize: 11 },
  logoutBtn: { padding: 8 },
  statsGrid: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  statCard: {
    flex: 1,
    minWidth: "40%",
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    gap: 4,
  },
  statNum: { fontFamily: "Outfit_700Bold", fontSize: 24, color: C.primary },
  statName: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  section: { gap: 12 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  editBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },
  statsRow: { flexDirection: "row", gap: 12 },
  statsItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  statsVal: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.text },
  statsLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textSecondary },
  goalCard: { backgroundColor: C.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border, gap: 8 },
  goalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  goalLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  goalValues: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.primary },
  goalRemain: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  unlockCard: { backgroundColor: C.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border, gap: 8 },
  unlockRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  unlockText: { flex: 1, fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary },
  unlockCount: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.primary },
  unlockHint: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, fontStyle: "italic", marginTop: 4 },
  badgesGrid: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  badge: {
    width: "28%",
    flex: 1,
    minWidth: 90,
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
  },
  badgeEarned: { backgroundColor: C.primaryMuted, borderColor: C.primary + "44" },
  badgeLocked: { backgroundColor: C.surface, borderColor: C.border },
  badgeLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 11, textAlign: "center" },
  badgeMiles: { fontFamily: "Outfit_700Bold", fontSize: 14 },
  nextMilestoneCard: { backgroundColor: C.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border, gap: 8 },
  nextLabel: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  nextRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  nextName: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.text },
  nextRemain: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted },
  historyCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  historyLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  historyType: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  historyTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text, maxWidth: 200 },
  historyMeta: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  historyStatus: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  historyStatusText: { fontFamily: "Outfit_600SemiBold", fontSize: 11 },
  emptyHistory: { alignItems: "center", gap: 8, paddingVertical: 24 },
  emptyHistoryText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  modalSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    gap: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  modalTitle: { fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text },
  modalField: { gap: 6 },
  modalLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  modalInput: {
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: C.text,
  },
  modalBtn: { backgroundColor: C.primary, borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center" },
  modalBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.bg },
});

const devStyles = StyleSheet.create({
  versionWrap: { alignItems: "center", paddingVertical: 16 },
  versionText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted },
  devPanel: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  devTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },
  devBtn: {
    backgroundColor: C.primaryMuted,
    borderRadius: 12,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.primary + "55",
  },
  devBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.primary },
  devClose: { alignItems: "center", paddingVertical: 8 },
  devCloseText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textMuted },
});

const iconStyles = StyleSheet.create({
  markerPreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  markerCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.surface,
    borderWidth: 3,
    borderColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  markerEmoji: { fontSize: 28 },
  markerInitial: { fontFamily: "Outfit_700Bold", fontSize: 22, color: C.primary },
  markerLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  markerSub: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary, marginTop: 2 },
  iconGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  iconCell: {
    width: 70,
    height: 70,
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  iconCellActive: { borderColor: C.primary, backgroundColor: C.primaryMuted },
  iconEmoji: { fontSize: 28 },
  iconInitial: { fontFamily: "Outfit_700Bold", fontSize: 22, color: C.primary },
  iconLabel: { fontFamily: "Outfit_400Regular", fontSize: 10, color: C.textSecondary },
});
