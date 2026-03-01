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
import { formatDistance } from "@/lib/formatDistance";

// ─── Types ────────────────────────────────────────────────────────────────────

type SortOption = "soonest" | "dist_asc" | "dist_desc";

const SORT_OPTIONS: { key: SortOption; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "soonest",  label: "Soonest",      icon: "clock"       },
  { key: "dist_asc", label: "Short → Long", icon: "trending-up" },
  { key: "dist_desc",label: "Long → Short", icon: "trending-down"},
];

const RUN_TAGS = ["All", "Talkative", "Quiet", "Motivational", "Training", "Ministry", "Recovery"];

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
const DEFAULT_FILTERS = { paceMin: 6.0, paceMax: 12.0, distMin: 1, distMax: 20, styles: [] as string[] };

function formatPace(pace: number) {
  const m = Math.floor(pace);
  const s = Math.round((pace - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const days = Math.floor((d.getTime() - Date.now()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState("All");
  const [sortOption, setSortOption] = useState<SortOption>("soonest");
  const [showSort, setShowSort] = useState(false);
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

  const sorted = useMemo(() => {
    const list = runs.filter((r) => {
      const q = search.toLowerCase();
      const matchSearch = !search ||
        r.title.toLowerCase().includes(q) ||
        r.location_name.toLowerCase().includes(q) ||
        r.host_name.toLowerCase().includes(q);
      const matchTag = activeTag === "All" || r.tags?.includes(activeTag);
      return matchSearch && matchTag;
    });

    switch (sortOption) {
      case "soonest":
        list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        break;
      case "dist_asc":
        list.sort((a, b) => a.min_distance - b.min_distance);
        break;
      case "dist_desc":
        list.sort((a, b) => b.min_distance - a.min_distance);
        break;
    }
    return list;
  }, [runs, search, activeTag, sortOption]);

  function toggleStyle(s: string) {
    setDraft((prev) => ({
      ...prev,
      styles: prev.styles.includes(s) ? prev.styles.filter((x) => x !== s) : [...prev.styles, s],
    }));
  }

  function applyFilters() { setApplied({ ...draft }); setShowFilter(false); }
  function resetFilters() { setDraft({ ...DEFAULT_FILTERS }); }
  function fmtDist(miles: number) {
    return unit === "km" ? `${formatDistance(miles * 1.60934)} km` : `${formatDistance(miles)} mi`;
  }

  const topPad = insets.top + 67;
  const sortLabel = SORT_OPTIONS.find((o) => o.key === sortOption)?.label ?? "Sort";

  return (
    <View style={[st.container, { paddingTop: topPad }]}>
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <View style={st.header}>
        <View style={st.titleRow}>
          <View>
            <Text style={st.title}>Discover</Text>
            <Text style={st.subtitle}>Upcoming Runs</Text>
          </View>
          <View style={st.headerActions}>
            {/* Sort */}
            <Pressable
              style={[st.sortBtn, showSort && st.sortBtnActive]}
              onPress={() => setShowSort((v) => !v)}
            >
              <Feather name="sliders" size={13} color={showSort ? C.primary : C.textSecondary} />
              <Text style={[st.sortBtnTxt, showSort && { color: C.primary }]}>{sortLabel}</Text>
              <Feather name={showSort ? "chevron-up" : "chevron-down"} size={12} color={showSort ? C.primary : C.textMuted} />
            </Pressable>
            {/* Filter */}
            <Pressable
              style={[st.filterBtn, isFiltered && st.filterBtnActive]}
              onPress={() => { setDraft({ ...applied }); setShowFilter(true); }}
            >
              <Feather name="sliders" size={15} color={isFiltered ? C.primary : C.text} />
              <Text style={[st.filterBtnText, isFiltered && { color: C.primary }]}>Filter</Text>
              {isFiltered && <View style={st.filterDot} />}
            </Pressable>
            {user?.host_unlocked && (
              <Pressable style={st.createBtn} onPress={() => router.push("/create-run/index")}>
                <Feather name="plus" size={16} color={C.bg} />
                <Text style={st.createBtnText}>Create</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Search */}
        <View style={st.searchWrap}>
          <Feather name="search" size={16} color={C.textMuted} />
          <TextInput
            style={st.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search runs, hosts, locations..."
            placeholderTextColor={C.textMuted}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x" size={16} color={C.textMuted} />
            </Pressable>
          )}
        </View>

        {/* Tag chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tagsContent}>
          {RUN_TAGS.map((t) => (
            <Pressable
              key={t}
              style={[st.tagChip, activeTag === t && st.tagChipActive]}
              onPress={() => setActiveTag(t)}
            >
              <Text style={[st.tagChipTxt, activeTag === t && st.tagChipTxtActive]}>{t}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* ─── Sort dropdown ───────────────────────────────────────────────── */}
      {showSort && (
        <>
          <Pressable style={st.sortOverlay} onPress={() => setShowSort(false)} />
          <View style={st.sortMenu}>
            {SORT_OPTIONS.map((opt) => {
              const active = sortOption === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  style={[st.sortItem, active && st.sortItemActive]}
                  onPress={() => { setSortOption(opt.key); setShowSort(false); }}
                >
                  <Feather name={opt.icon} size={14} color={active ? C.primary : C.textSecondary} />
                  <Text style={[st.sortItemTxt, active && { color: C.primary }]}>{opt.label}</Text>
                  {active && <Feather name="check" size={13} color={C.primary} style={{ marginLeft: "auto" as any }} />}
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {/* ─── List ───────────────────────────────────────────────────────── */}
      {isLoading ? (
        <View style={st.center}>
          <ActivityIndicator color={C.primary} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[st.list, { paddingBottom: insets.bottom + 34 }]}
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={() => setShowSort(false)}
        >
          {sorted.length === 0 ? (
            <View style={st.empty}>
              <Ionicons name="walk-outline" size={48} color={C.textMuted} />
              <Text style={st.emptyTitle}>No runs found</Text>
              <Text style={st.emptyText}>
                {search || activeTag !== "All" || isFiltered ? "Try different filters" : "Check back soon"}
              </Text>
            </View>
          ) : (
            sorted.map((run) => {
              const spotsLeft = run.max_participants - run.participant_count;
              return (
                <Pressable
                  key={run.id}
                  style={({ pressed }) => [st.card, { opacity: pressed ? 0.9 : 1 }]}
                  onPress={() => router.push(`/run/${run.id}`)}
                >
                  <View style={st.cardTop}>
                    <View style={st.cardTitleRow}>
                      <Text style={st.cardTitle} numberOfLines={1}>{run.title}</Text>
                      {spotsLeft <= 3 && spotsLeft > 0 && (
                        <View style={st.urgentBadge}>
                          <Text style={st.urgentText}>{spotsLeft} left</Text>
                        </View>
                      )}
                    </View>
                    <Text style={st.hostName}>
                      {run.host_name}{run.host_rating > 0 ? ` · ★${run.host_rating.toFixed(1)}` : ""}
                    </Text>
                  </View>
                  <View style={st.cardMeta}>
                    <View style={st.metaItem}>
                      <Feather name="calendar" size={12} color={C.primary} />
                      <Text style={st.metaText}>{formatDate(run.date)} · {formatTime(run.date)}</Text>
                    </View>
                    <View style={st.metaItem}>
                      <Feather name="map-pin" size={12} color={C.primary} />
                      <Text style={st.metaText} numberOfLines={1}>{run.location_name}</Text>
                    </View>
                  </View>
                  <View style={st.cardStats}>
                    <View style={st.stat}>
                      <Ionicons name="walk" size={12} color={C.orange} />
                      <Text style={st.statText}>{formatPace(run.min_pace)}–{formatPace(run.max_pace)}/mi</Text>
                    </View>
                    <View style={st.dot} />
                    <View style={st.stat}>
                      <Feather name="target" size={12} color={C.blue} />
                      <Text style={st.statText}>{formatDistance(run.min_distance)}–{formatDistance(run.max_distance)} mi</Text>
                    </View>
                    <View style={st.dot} />
                    <View style={st.stat}>
                      <Ionicons name="people" size={12} color={C.textMuted} />
                      <Text style={st.statText}>{run.participant_count}/{run.max_participants}</Text>
                    </View>
                  </View>
                  {run.tags?.length > 0 && (
                    <View style={st.tagRow}>
                      {run.tags.slice(0, 3).map((t) => (
                        <View key={t} style={st.tag}>
                          <Text style={st.tagText}>{t}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}

      {/* ─── Filter sheet ─────────────────────────────────────────────────── */}
      <Modal visible={showFilter} transparent animationType="slide" onRequestClose={() => setShowFilter(false)}>
        <Pressable style={st.modalOverlay} onPress={() => setShowFilter(false)} />
        <View style={[st.filterSheet, { paddingBottom: insets.bottom + 34 }]}>
          <View style={st.filterHandle} />
          <View style={st.filterHeader}>
            <Text style={st.filterTitle}>Filters</Text>
            <Pressable onPress={() => setShowFilter(false)} hitSlop={12}>
              <Feather name="x" size={22} color={C.textSecondary} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            <View style={st.filterSection}>
              <Text style={st.filterSectionTitle}>Pace</Text>
              <Text style={st.filterSectionValue}>{formatPace(draft.paceMin)} – {formatPace(draft.paceMax)} /mi</Text>
              <RangeSlider
                min={6} max={12} step={0.5}
                low={draft.paceMin} high={draft.paceMax}
                onLowChange={(v) => setDraft((p) => ({ ...p, paceMin: v }))}
                onHighChange={(v) => setDraft((p) => ({ ...p, paceMax: v }))}
              />
              <View style={st.sliderEdge}>
                <Text style={st.sliderEdgeTxt}>6:00</Text>
                <Text style={st.sliderEdgeTxt}>12:00</Text>
              </View>
            </View>
            <View style={st.filterSection}>
              <View style={st.filterSectionHeader}>
                <Text style={st.filterSectionTitle}>Distance</Text>
                <View style={st.unitToggle}>
                  {(["mi", "km"] as const).map((u) => (
                    <Pressable key={u} style={[st.unitBtn, unit === u && st.unitBtnActive]} onPress={() => setUnit(u)}>
                      <Text style={[st.unitBtnTxt, unit === u && st.unitBtnTxtActive]}>{u}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <Text style={st.filterSectionValue}>{fmtDist(draft.distMin)} – {fmtDist(draft.distMax)}</Text>
              <RangeSlider
                min={1} max={20} step={0.5}
                low={draft.distMin} high={draft.distMax}
                onLowChange={(v) => setDraft((p) => ({ ...p, distMin: v }))}
                onHighChange={(v) => setDraft((p) => ({ ...p, distMax: v }))}
              />
              <View style={st.sliderEdge}>
                <Text style={st.sliderEdgeTxt}>{unit === "km" ? "1.6 km" : "1 mi"}</Text>
                <Text style={st.sliderEdgeTxt}>{unit === "km" ? "32.2 km" : "20 mi"}</Text>
              </View>
            </View>
            <View style={st.filterSection}>
              <Text style={st.filterSectionTitle}>Style</Text>
              <View style={{ height: 12 }} />
              <View style={st.styleGrid}>
                {RUN_STYLES.map((s) => {
                  const active = draft.styles.includes(s);
                  return (
                    <Pressable
                      key={s}
                      style={[st.styleChip, active && st.styleChipActive]}
                      onPress={() => toggleStyle(s)}
                    >
                      {active && <Feather name="check" size={13} color={C.primary} style={{ marginRight: 4 }} />}
                      <Text style={[st.styleChipTxt, active && st.styleChipTxtActive]}>{s}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>
          <View style={st.filterFooter}>
            <Pressable style={st.resetBtn} onPress={resetFilters}>
              <Text style={st.resetBtnTxt}>Reset</Text>
            </Pressable>
            <Pressable style={st.applyBtn} onPress={applyFilters}>
              <Text style={st.applyBtnTxt}>Apply Filters</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title: { fontFamily: "Outfit_700Bold", fontSize: 28, color: C.text },
  subtitle: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, marginTop: 2 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  sortBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 11, paddingVertical: 8, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, maxWidth: 130,
  },
  sortBtnActive: { borderColor: C.primary, backgroundColor: C.primaryMuted },
  sortBtnTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.textSecondary, flexShrink: 1 },
  filterBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  filterBtnActive: { borderColor: C.primary, backgroundColor: C.primaryMuted },
  filterBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.text },
  filterDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: C.primary, marginLeft: -2 },
  createBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  createBtnText: { fontFamily: "Outfit_700Bold", fontSize: 13, color: C.bg },
  searchWrap: { flexDirection: "row", alignItems: "center", backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, height: 46, gap: 10 },
  searchInput: { flex: 1, fontFamily: "Outfit_400Regular", fontSize: 15, color: C.text },
  tagsContent: { gap: 8, paddingVertical: 2 },
  tagChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  tagChipActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  tagChipTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  tagChipTxtActive: { color: C.primary },

  sortOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 },
  sortMenu: {
    position: "absolute", right: 20, top: 140, zIndex: 11,
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    minWidth: 180, shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 20, elevation: 16, overflow: "hidden",
  },
  sortItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.border },
  sortItemActive: { backgroundColor: C.primaryMuted },
  sortItemTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textSecondary, flex: 1 },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: 20, paddingTop: 4, gap: 12 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border, gap: 10 },
  cardTop: { gap: 2 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text, flex: 1 },
  urgentBadge: { backgroundColor: C.orange + "22", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: C.orange + "44" },
  urgentText: { fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.orange },
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
  sliderEdge: { flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingHorizontal: 2 },
  sliderEdgeTxt: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },
  unitToggle: { flexDirection: "row", borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: C.border },
  unitBtn: { paddingHorizontal: 12, paddingVertical: 5, backgroundColor: C.card },
  unitBtnActive: { backgroundColor: C.primaryMuted },
  unitBtnTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.textSecondary },
  unitBtnTxtActive: { color: C.primary },
  styleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  styleChip: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  styleChipActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  styleChipTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  styleChipTxtActive: { color: C.primary },
  filterFooter: { flexDirection: "row", gap: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.border, marginTop: 8 },
  resetBtn: { flex: 1, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  resetBtnTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.textSecondary },
  applyBtn: { flex: 2, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: C.primary },
  applyBtnTxt: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.bg },
});
