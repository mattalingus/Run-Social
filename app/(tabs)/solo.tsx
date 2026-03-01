import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  Modal,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/query-client";
import C from "@/constants/colors";
import { formatDistance } from "@/lib/formatDistance";

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
  created_at: string;
}

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

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function scheduleRunNotifications(runDate: Date, label: string) {
  if (Platform.OS === "web") return;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return;

    const oneHour = new Date(runDate.getTime() - 60 * 60 * 1000);
    const tenMin = new Date(runDate.getTime() - 10 * 60 * 1000);
    const now = new Date();

    if (oneHour > now) {
      await Notifications.scheduleNotificationAsync({
        content: { title: "🏃 Run in 1 hour", body: `${label} — get warmed up!` },
        trigger: { date: oneHour } as any,
      });
    }
    if (tenMin > now) {
      await Notifications.scheduleNotificationAsync({
        content: { title: "🏃 Starting soon!", body: `${label} — 10 minutes to go.` },
        trigger: { date: tenMin } as any,
      });
    }
  } catch (_) {}
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function Bar({ value, total, color = C.primary }: { value: number; total: number; color?: string }) {
  const pct = Math.min(1, total > 0 ? value / total : 0);
  return (
    <View style={bar.track}>
      <View style={[bar.fill, { width: `${pct * 100}%` as any, backgroundColor: color }]} />
    </View>
  );
}

const bar = StyleSheet.create({
  track: { height: 8, backgroundColor: C.border, borderRadius: 4, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 4 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SoloScreen() {
  const insets = useSafeAreaInsets();
  const { user, refreshUser } = useAuth();
  const qc = useQueryClient();

  const [showGoals, setShowGoals] = useState(false);
  const [showPlan, setShowPlan] = useState(false);

  // Goals form state
  const [gPace, setGPace] = useState("");
  const [gDist, setGDist] = useState("");
  const [gPeriod, setGPeriod] = useState<"monthly" | "yearly">("monthly");

  // Plan form state
  const [pTitle, setPTitle] = useState("");
  const [pDate, setPDate] = useState(tomorrowStr());
  const [pTime, setPTime] = useState("07:00");
  const [pDist, setPDist] = useState("");
  const [pPace, setPPace] = useState("");
  const [pNotify, setPNotify] = useState(true);
  const [saving, setSaving] = useState(false);

  const { data: soloRuns = [], isLoading } = useQuery<SoloRun[]>({
    queryKey: ["/api/solo-runs"],
    enabled: !!user,
    staleTime: 30_000,
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

  const goalsMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PUT", "/api/users/me/solo-goals", data);
      return res.json();
    },
    onSuccess: () => { refreshUser(); setShowGoals(false); },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  // ─── Rankings ───────────────────────────────────────────────────────────────

  const completedRuns = useMemo(
    () => soloRuns.filter((r) => r.completed && r.pace_min_per_mile),
    [soloRuns]
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

  const period = (user?.goal_period as "monthly" | "yearly") ?? "monthly";
  const distGoal = user?.distance_goal ?? 100;
  const paceGoal = user?.pace_goal ?? null;
  const currentMiles = period === "monthly" ? (user?.miles_this_month ?? 0) : (user?.miles_this_year ?? 0);
  const currentPace = user?.avg_pace ?? 0;

  // ─── Open goals modal ────────────────────────────────────────────────────────

  function openGoals() {
    setGPace(paceGoal != null ? formatPace(paceGoal) : "");
    setGDist(distGoal.toString());
    setGPeriod(period);
    setShowGoals(true);
  }

  function saveGoals() {
    const pace = gPace.trim() ? parsePaceInput(gPace) : null;
    const dist = parseFloat(gDist) || 100;
    goalsMutation.mutate({ paceGoal: pace, distanceGoal: dist, goalPeriod: gPeriod });
  }

  // ─── Plan run save ───────────────────────────────────────────────────────────

  async function savePlan() {
    const dist = parseFloat(pDist);
    if (isNaN(dist) || dist <= 0) { Alert.alert("Invalid", "Enter a valid distance"); return; }
    const dateStr = `${pDate}T${pTime}:00`;
    const runDate = new Date(dateStr);
    if (isNaN(runDate.getTime())) { Alert.alert("Invalid", "Enter a valid date (YYYY-MM-DD) and time (HH:MM)"); return; }

    setSaving(true);
    try {
      const pace = pPace.trim() ? parsePaceInput(pPace) : null;
      const label = pTitle.trim() || `${formatDistance(dist)} mi solo run`;
      await saveMutation.mutateAsync({
        title: label,
        date: runDate.toISOString(),
        distanceMiles: dist,
        paceMinPerMile: pace,
        planned: true,
        completed: false,
      });
      if (pNotify) await scheduleRunNotifications(runDate, label);
      setShowPlan(false);
      setPTitle(""); setPDate(tomorrowStr()); setPTime("07:00"); setPDist(""); setPPace("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(id: string) {
    Alert.alert("Delete Run", "Remove this run from your history?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate(id) },
    ]);
  }

  if (!user) {
    return (
      <View style={[s.container, { justifyContent: "center", alignItems: "center", paddingTop: insets.top }]}>
        <Feather name="lock" size={36} color={C.textMuted} />
        <Text style={s.emptyText}>Sign in to track your solo runs</Text>
        <Pressable style={s.loginBtn} onPress={() => router.push("/(auth)/login")}>
          <Text style={s.loginBtnTxt}>Sign In</Text>
        </Pressable>
      </View>
    );
  }

  const goalPct = Math.min(1, distGoal > 0 ? currentMiles / distGoal : 0);
  const periodLabel = period === "monthly" ? "This Month" : "This Year";

  return (
    <View style={s.container}>
      <ScrollView
        contentContainerStyle={[
          s.scroll,
          {
            paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16),
            paddingBottom: insets.bottom + 120,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Header ─────────────────────────────────────────────────── */}
        <View style={s.headerRow}>
          <View>
            <Text style={s.screenTitle}>Solo</Text>
            <Text style={s.screenSub}>Your personal running</Text>
          </View>
          <Pressable style={s.planBtn} onPress={() => setShowPlan(true)}>
            <Feather name="plus" size={18} color={C.bg} />
            <Text style={s.planBtnTxt}>Plan Run</Text>
          </Pressable>
        </View>

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
                onPress={() => goalsMutation.mutate({ paceGoal, distanceGoal: distGoal, goalPeriod: p })}
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
                <Text style={s.goalCurrent}>{formatDistance(currentMiles)}</Text>
                <Text style={s.goalSlash}> / {formatDistance(distGoal)} mi</Text>
              </Text>
            </View>
            <Bar value={currentMiles} total={distGoal} color={C.blue} />
            <View style={s.goalFooterRow}>
              <Text style={s.goalPct}>{Math.round(goalPct * 100)}% complete</Text>
              <Text style={s.goalRemain}>
                {currentMiles >= distGoal
                  ? "🎉 Goal reached!"
                  : `${formatDistance(distGoal - currentMiles)} mi to go`}
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
                <Text style={s.goalSlash}>{paceGoal != null ? ` / ${formatPace(paceGoal)} /mi` : " /mi"}</Text>
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

        {/* ─── Rankings ────────────────────────────────────────────────── */}
        {rankings.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Performance Rankings</Text>
            {rankings.map((cat) => (
              <View key={cat.label} style={s.rankCard}>
                <View style={s.rankHeader}>
                  <Text style={s.rankCategory}>{cat.label}</Text>
                  <Text style={s.rankBest}>
                    Best: {cat.runs[0].pace_min_per_mile ? formatPace(cat.runs[0].pace_min_per_mile) + " /mi" : "—"}
                  </Text>
                </View>
                {cat.runs.slice(0, 3).map((run, i) => (
                  <View key={run.id} style={s.rankRow}>
                    <Text style={s.rankEmoji}>{RANK_EMOJI[i]}</Text>
                    <Text style={s.rankDate}>{formatDisplayDate(run.date)}</Text>
                    <Text style={s.rankDist}>{formatDistance(run.distance_miles)} mi</Text>
                    <Text style={s.rankPace}>
                      {run.pace_min_per_mile ? formatPace(run.pace_min_per_mile) + " /mi" : "—"}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        )}

        {/* ─── Run History ─────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Run History</Text>

          {isLoading ? (
            <ActivityIndicator color={C.primary} style={{ marginTop: 20 }} />
          ) : soloRuns.length === 0 ? (
            <View style={s.emptyCard}>
              <Ionicons name="walk-outline" size={44} color={C.textMuted} />
              <Text style={s.emptyTitle}>No solo runs yet</Text>
              <Text style={s.emptyBody}>Plan your first run and start tracking your progress</Text>
            </View>
          ) : (
            soloRuns.map((run) => {
              const badge = runBadges[run.id];
              const label = run.title || `${formatDistance(run.distance_miles)} mi run`;
              return (
                <Pressable
                  key={run.id}
                  style={({ pressed }) => [s.historyCard, { opacity: pressed ? 0.85 : 1 }]}
                  onLongPress={() => confirmDelete(run.id)}
                >
                  <View style={s.historyLeft}>
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
                        {badge && (
                          <Text style={s.historyBadge}>{RANK_EMOJI[badge.rank - 1]}</Text>
                        )}
                      </View>
                      <Text style={s.historyMeta}>
                        {formatDisplayDate(run.date)}
                        {run.pace_min_per_mile ? ` · ${formatPace(run.pace_min_per_mile)}/mi` : ""}
                        {run.duration_seconds ? ` · ${formatDuration(run.duration_seconds)}` : ""}
                      </Text>
                    </View>
                  </View>
                  <View style={s.historyRight}>
                    <Text style={s.historyDist}>{formatDistance(run.distance_miles)}</Text>
                    <Text style={s.historyDistUnit}>mi</Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
      </ScrollView>

      {/* ─── Edit Goals Modal ─────────────────────────────────────────── */}
      <Modal visible={showGoals} transparent animationType="slide" onRequestClose={() => setShowGoals(false)}>
        <Pressable style={s.overlay} onPress={() => setShowGoals(false)} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>Edit Goals</Text>
            <Pressable onPress={() => setShowGoals(false)} hitSlop={12}>
              <Feather name="x" size={22} color={C.textSecondary} />
            </Pressable>
          </View>

          <Text style={s.inputLabel}>Goal Period</Text>
          <View style={s.segRow}>
            {(["monthly", "yearly"] as const).map((p) => (
              <Pressable
                key={p}
                style={[s.segBtn, gPeriod === p && s.segBtnOn]}
                onPress={() => setGPeriod(p)}
              >
                <Text style={[s.segTxt, gPeriod === p && s.segTxtOn]}>
                  {p === "monthly" ? "Monthly" : "Yearly"}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={s.inputLabel}>Distance Goal (miles)</Text>
          <TextInput
            style={s.input}
            value={gDist}
            onChangeText={setGDist}
            placeholder="100"
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
      </Modal>

      {/* ─── Plan Run Modal ───────────────────────────────────────────── */}
      <Modal visible={showPlan} transparent animationType="slide" onRequestClose={() => setShowPlan(false)}>
        <Pressable style={s.overlay} onPress={() => setShowPlan(false)} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>Plan a Solo Run</Text>
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
              placeholder="Morning tempo run"
              placeholderTextColor={C.textMuted}
            />

            <Text style={s.inputLabel}>Date (YYYY-MM-DD)</Text>
            <TextInput
              style={s.input}
              value={pDate}
              onChangeText={setPDate}
              placeholder={tomorrowStr()}
              placeholderTextColor={C.textMuted}
              keyboardType="numbers-and-punctuation"
            />

            <Text style={s.inputLabel}>Time (HH:MM, 24h)</Text>
            <TextInput
              style={s.input}
              value={pTime}
              onChangeText={setPTime}
              placeholder="07:00"
              placeholderTextColor={C.textMuted}
              keyboardType="numbers-and-punctuation"
            />

            <Text style={s.inputLabel}>Distance (miles)</Text>
            <TextInput
              style={s.input}
              value={pDist}
              onChangeText={setPDist}
              placeholder="5.0"
              placeholderTextColor={C.textMuted}
              keyboardType="decimal-pad"
            />

            <Text style={s.inputLabel}>Target Pace (min:sec /mi, optional)</Text>
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
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 16 },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  screenTitle: { fontFamily: "Outfit_700Bold", fontSize: 30, color: C.text, letterSpacing: -0.5 },
  screenSub: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary, marginTop: 2 },
  planBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  planBtnTxt: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.bg },

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
  historyTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  historyTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text, flex: 1 },
  historyBadge: { fontSize: 14 },
  historyMeta: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textSecondary, marginTop: 3 },
  historyRight: { alignItems: "flex-end" },
  historyDist: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.primary },
  historyDistUnit: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },

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
  emptyText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, marginTop: 12, marginBottom: 20 },
  loginBtn: { backgroundColor: C.primary, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 14 },
  loginBtnTxt: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.bg },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingHorizontal: 24,
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
});
