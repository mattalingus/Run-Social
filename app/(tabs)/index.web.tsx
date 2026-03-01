import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  TextInput,
  Modal,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import C from "@/constants/colors";
import RangeSlider from "@/components/RangeSlider";

interface Run {
  id: string;
  title: string;
  host_name: string;
  host_rating: number;
  date: string;
  location_name: string;
  min_distance: number;
  max_distance: number;
  min_pace: number;
  max_pace: number;
  tags: string[];
  participant_count: number;
  max_participants: number;
}

const RUN_STYLES = ["Talkative", "Quiet", "Motivational", "Training", "Ministry", "Recovery"];

const DEFAULT_FILTERS = {
  paceMin: 6.0,
  paceMax: 12.0,
  distMin: 1,
  distMax: 20,
  styles: [] as string[],
};

function formatPace(pace: number) {
  const mins = Math.floor(pace);
  const secs = Math.round((pace - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const diff = d.getTime() - Date.now();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [unit, setUnit] = useState<"mi" | "km">("mi");
  const [draft, setDraft] = useState({ ...DEFAULT_FILTERS });
  const [applied, setApplied] = useState({ ...DEFAULT_FILTERS });

  const isFiltered =
    applied.paceMin !== DEFAULT_FILTERS.paceMin ||
    applied.paceMax !== DEFAULT_FILTERS.paceMax ||
    applied.distMin !== DEFAULT_FILTERS.distMin ||
    applied.distMax !== DEFAULT_FILTERS.distMax ||
    applied.styles.length > 0;

  const queryUrl = useMemo(() => {
    const p = new URLSearchParams();
    p.set("paceMin", applied.paceMin.toString());
    p.set("paceMax", applied.paceMax.toString());
    p.set("distMin", applied.distMin.toString());
    p.set("distMax", applied.distMax.toString());
    if (applied.styles.length > 0) p.set("styles", applied.styles.join(","));
    return `/api/runs?${p.toString()}`;
  }, [applied]);

  const { data: runs = [], isLoading } = useQuery<Run[]>({
    queryKey: [queryUrl],
    staleTime: 30_000,
  });

  const filtered = runs.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.title.toLowerCase().includes(q) || r.location_name.toLowerCase().includes(q);
  });

  function toggleStyle(s: string) {
    setDraft((prev) => ({
      ...prev,
      styles: prev.styles.includes(s) ? prev.styles.filter((x) => x !== s) : [...prev.styles, s],
    }));
  }

  function applyFilters() {
    setApplied({ ...draft });
    setShowFilter(false);
  }

  function resetFilters() {
    setDraft({ ...DEFAULT_FILTERS });
  }

  function fmtDist(miles: number) {
    if (unit === "km") return `${(miles * 1.60934).toFixed(1)} km`;
    return `${miles.toFixed(1)} mi`;
  }

  const topPad = insets.top + 67;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.title}>PaceUp</Text>
            <Text style={styles.subtitle}>Upcoming Runs</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              style={[styles.filterBtn, isFiltered && styles.filterBtnActive]}
              onPress={() => { setDraft({ ...applied }); setShowFilter(true); }}
            >
              <Feather name="sliders" size={15} color={isFiltered ? C.primary : C.text} />
              <Text style={[styles.filterBtnText, isFiltered && { color: C.primary }]}>Filter</Text>
              {isFiltered && <View style={styles.filterDot} />}
            </Pressable>
            {user?.host_unlocked && (
              <Pressable style={styles.createBtn} onPress={() => router.push("/create-run/index")}>
                <Feather name="plus" size={16} color={C.bg} />
                <Text style={styles.createBtnText}>Create Run</Text>
              </Pressable>
            )}
          </View>
        </View>
        <View style={styles.searchWrap}>
          <Feather name="search" size={16} color={C.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search runs or locations..."
            placeholderTextColor={C.textMuted}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x" size={16} color={C.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.primary} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 34 }]}
          showsVerticalScrollIndicator={false}
        >
          {filtered.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="walk-outline" size={48} color={C.textMuted} />
              <Text style={styles.emptyTitle}>No runs found</Text>
              <Text style={styles.emptyText}>
                {isFiltered ? "Try adjusting your filters" : "Check back soon for upcoming runs"}
              </Text>
            </View>
          ) : (
            filtered.map((run) => (
              <Pressable
                key={run.id}
                style={({ pressed }) => [styles.card, { opacity: pressed ? 0.9 : 1 }]}
                onPress={() => router.push(`/run/${run.id}`)}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{run.title}</Text>
                  <Text style={styles.hostName}>by {run.host_name}{run.host_rating > 0 ? ` · ★${run.host_rating.toFixed(1)}` : ""}</Text>
                </View>
                <View style={styles.cardMeta}>
                  <View style={styles.metaItem}>
                    <Feather name="calendar" size={12} color={C.primary} />
                    <Text style={styles.metaText}>{formatDate(run.date)} · {formatTime(run.date)}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Feather name="map-pin" size={12} color={C.primary} />
                    <Text style={styles.metaText} numberOfLines={1}>{run.location_name}</Text>
                  </View>
                </View>
                <View style={styles.cardStats}>
                  <View style={styles.stat}>
                    <Ionicons name="walk" size={12} color={C.orange} />
                    <Text style={styles.statText}>{formatPace(run.min_pace)}–{formatPace(run.max_pace)}/mi</Text>
                  </View>
                  <View style={styles.dot} />
                  <View style={styles.stat}>
                    <Feather name="target" size={12} color={C.blue} />
                    <Text style={styles.statText}>{run.min_distance}–{run.max_distance} mi</Text>
                  </View>
                  <View style={styles.dot} />
                  <View style={styles.stat}>
                    <Ionicons name="people" size={12} color={C.textMuted} />
                    <Text style={styles.statText}>{run.participant_count}/{run.max_participants}</Text>
                  </View>
                </View>
                {run.tags?.length > 0 && (
                  <View style={styles.tagRow}>
                    {run.tags.slice(0, 3).map((t) => (
                      <View key={t} style={styles.tag}>
                        <Text style={styles.tagText}>{t}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </Pressable>
            ))
          )}
        </ScrollView>
      )}

      <Modal visible={showFilter} transparent animationType="slide" onRequestClose={() => setShowFilter(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowFilter(false)} />
        <View style={[styles.filterSheet, { paddingBottom: insets.bottom + 34 }]}>
          <View style={styles.filterHandle} />
          <View style={styles.filterHeader}>
            <Text style={styles.filterTitle}>Filters</Text>
            <Pressable onPress={() => setShowFilter(false)} hitSlop={12}>
              <Feather name="x" size={22} color={C.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            <View style={styles.filterSection}>
              <View style={styles.filterSectionHeader}>
                <Text style={styles.filterSectionTitle}>Pace</Text>
              </View>
              <Text style={styles.filterSectionValue}>
                {formatPace(draft.paceMin)} – {formatPace(draft.paceMax)} /mi
              </Text>
              <RangeSlider
                min={6} max={12} step={0.5}
                low={draft.paceMin} high={draft.paceMax}
                onLowChange={(v) => setDraft((p) => ({ ...p, paceMin: v }))}
                onHighChange={(v) => setDraft((p) => ({ ...p, paceMax: v }))}
              />
              <View style={styles.sliderEdgeLabels}>
                <Text style={styles.sliderEdgeText}>6:00</Text>
                <Text style={styles.sliderEdgeText}>12:00</Text>
              </View>
            </View>

            <View style={styles.filterSection}>
              <View style={styles.filterSectionHeader}>
                <Text style={styles.filterSectionTitle}>Distance</Text>
                <View style={styles.unitToggle}>
                  {(["mi", "km"] as const).map((u) => (
                    <Pressable
                      key={u}
                      style={[styles.unitBtn, unit === u && styles.unitBtnActive]}
                      onPress={() => setUnit(u)}
                    >
                      <Text style={[styles.unitBtnText, unit === u && styles.unitBtnTextActive]}>{u}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <Text style={styles.filterSectionValue}>
                {fmtDist(draft.distMin)} – {fmtDist(draft.distMax)}
              </Text>
              <RangeSlider
                min={1} max={20} step={0.5}
                low={draft.distMin} high={draft.distMax}
                onLowChange={(v) => setDraft((p) => ({ ...p, distMin: v }))}
                onHighChange={(v) => setDraft((p) => ({ ...p, distMax: v }))}
              />
              <View style={styles.sliderEdgeLabels}>
                <Text style={styles.sliderEdgeText}>{unit === "km" ? "1.6 km" : "1 mi"}</Text>
                <Text style={styles.sliderEdgeText}>{unit === "km" ? "32.2 km" : "20 mi"}</Text>
              </View>
            </View>

            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Host Style</Text>
              <View style={{ height: 12 }} />
              <View style={styles.styleGrid}>
                {RUN_STYLES.map((s) => {
                  const active = draft.styles.includes(s);
                  return (
                    <Pressable
                      key={s}
                      style={[styles.styleChip, active && styles.styleChipActive]}
                      onPress={() => toggleStyle(s)}
                    >
                      {active && <Feather name="check" size={13} color={C.primary} style={{ marginRight: 4 }} />}
                      <Text style={[styles.styleChipText, active && styles.styleChipTextActive]}>{s}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>

          <View style={styles.filterFooter}>
            <Pressable style={styles.resetBtn} onPress={resetFilters}>
              <Text style={styles.resetBtnText}>Reset</Text>
            </Pressable>
            <Pressable style={styles.applyBtn} onPress={applyFilters}>
              <Text style={styles.applyBtnText}>Apply Filters</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title: { fontFamily: "Outfit_700Bold", fontSize: 28, color: C.text },
  subtitle: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, marginTop: 2 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  filterBtnActive: { borderColor: C.primary, backgroundColor: C.primaryMuted },
  filterBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.text },
  filterDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: C.primary, marginLeft: -2 },
  createBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  createBtnText: { fontFamily: "Outfit_700Bold", fontSize: 13, color: C.bg },
  searchWrap: { flexDirection: "row", alignItems: "center", backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, height: 46, gap: 10 },
  searchInput: { flex: 1, fontFamily: "Outfit_400Regular", fontSize: 15, color: C.text },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: 20, paddingTop: 4, gap: 12 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border, gap: 10 },
  cardTop: { gap: 2 },
  cardTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },
  hostName: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary },
  cardMeta: { gap: 4 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  cardStats: { flexDirection: "row", alignItems: "center", gap: 8 },
  stat: { flexDirection: "row", alignItems: "center", gap: 4 },
  statText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.textSecondary },
  dot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: C.border },
  tagRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  tag: { backgroundColor: C.primaryMuted, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: C.primary + "33" },
  tagText: { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: C.primary },
  empty: { alignItems: "center", gap: 12, paddingTop: 80 },
  emptyTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text },
  emptyText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  filterSheet: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 12, paddingHorizontal: 24, borderTopWidth: 1, borderColor: C.border, maxHeight: "85%" },
  filterHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginBottom: 16 },
  filterHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  filterTitle: { fontFamily: "Outfit_700Bold", fontSize: 22, color: C.text },
  filterSection: { marginBottom: 28 },
  filterSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  filterSectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },
  filterSectionValue: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.primary, marginBottom: 14 },
  sliderEdgeLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingHorizontal: 2 },
  sliderEdgeText: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },
  unitToggle: { flexDirection: "row", borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: C.border },
  unitBtn: { paddingHorizontal: 12, paddingVertical: 5, backgroundColor: C.card },
  unitBtnActive: { backgroundColor: C.primaryMuted },
  unitBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.textSecondary },
  unitBtnTextActive: { color: C.primary },
  styleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  styleChip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  styleChipActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  styleChipText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  styleChipTextActive: { color: C.primary },
  filterFooter: { flexDirection: "row", gap: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.border, marginTop: 8 },
  resetBtn: { flex: 1, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  resetBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.textSecondary },
  applyBtn: { flex: 2, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: C.primary },
  applyBtnText: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.bg },
});
