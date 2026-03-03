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
  Switch,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { darkColors as C, type ColorScheme } from "@/constants/colors";
import { useTheme } from "@/contexts/ThemeContext";
import RangeSlider from "@/components/RangeSlider";
import { formatDistance } from "@/lib/formatDistance";

// ─── Constants ────────────────────────────────────────────────────────────────

const PACE_STEP = 5 / 60;

type SortOption = "soonest" | "dist_asc" | "dist_desc";

const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: "soonest",  label: "Soonest"              },
  { key: "dist_asc", label: "Distance: Low → High" },
  { key: "dist_desc",label: "Distance: High → Low" },
];

const HOST_STYLES = ["Talkative", "Quiet", "Motivational", "Training", "Ministry", "Recovery"];

interface FilterState {
  paceMin: number;
  paceMax: number;
  distMin: number;
  distMax: number;
  styles: string[];
}

const DEFAULT_FILTERS: FilterState = {
  paceMin: 6.0,
  paceMax: 12.0,
  distMin: 1,
  distMax: 20,
  styles: [],
};

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
  const { C } = useTheme();
  const st = useMemo(() => makeStStyles(C), [C]);
  const fm = useMemo(() => makeFmStyles(C), [C]);
  const [search, setSearch]       = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("soonest");
  const [showSort, setShowSort]   = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [draft, setDraft]         = useState<FilterState>({ ...DEFAULT_FILTERS });
  const [applied, setApplied]     = useState<FilterState>({ ...DEFAULT_FILTERS });

  const isFiltered =
    applied.paceMin !== DEFAULT_FILTERS.paceMin ||
    applied.paceMax !== DEFAULT_FILTERS.paceMax ||
    applied.distMin !== DEFAULT_FILTERS.distMin ||
    applied.distMax !== DEFAULT_FILTERS.distMax ||
    applied.styles.length > 0;

  const isNonDefaultSort = sortOption !== "soonest";

  const { data: runs = [], isLoading } = useQuery<Run[]>({
    queryKey: ["/api/runs"],
    staleTime: 30_000,
  });

  const sorted = useMemo(() => {
    const list = runs.filter((r) => {
      const q = search.toLowerCase();
      const matchSearch = !search ||
        r.title.toLowerCase().includes(q) ||
        r.location_name.toLowerCase().includes(q) ||
        r.host_name.toLowerCase().includes(q);
      const matchPace  = r.min_pace <= applied.paceMax && r.max_pace >= applied.paceMin;
      const matchDist  = r.min_distance <= applied.distMax && r.max_distance >= applied.distMin;
      const matchStyle = applied.styles.length === 0 || r.tags?.some((t) => applied.styles.includes(t));
      return matchSearch && matchPace && matchDist && matchStyle;
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
  }, [runs, search, applied, sortOption]);

  function toggleStyle(s: string) {
    setDraft((p) => ({
      ...p,
      styles: p.styles.includes(s) ? p.styles.filter((x) => x !== s) : [...p.styles, s],
    }));
  }

  function applyFilters() { setApplied({ ...draft }); setShowFilter(false); }
  function resetFilters() { setDraft({ ...DEFAULT_FILTERS }); }

  const topPad = insets.top + 67;

  return (
    <View style={[st.container, { paddingTop: topPad }]}>
      {/* ─── Header ───────────────────────────────────────────────────────── */}
      <View style={st.header}>
        <View style={st.titleRow}>
          <Text style={st.title}>FARA</Text>
          <View style={st.headerBtns}>
            {/* Filter */}
            <Pressable
              style={[st.hBtn, isFiltered && st.hBtnActive]}
              onPress={() => { setDraft({ ...applied }); setShowSort(false); setShowFilter(true); }}
              testID="filter-button"
            >
              <Feather name="sliders" size={16} color={isFiltered ? C.primary : C.textSecondary} />
              {isFiltered && <View style={st.dot} />}
            </Pressable>

            {/* Sort */}
            <Pressable
              style={[st.hBtnRow, showSort && st.hBtnActive]}
              onPress={() => { setShowSort((v) => !v); setShowFilter(false); }}
              testID="sort-button"
            >
              {isNonDefaultSort && <View style={st.dot} />}
              <Text style={[st.hBtnTxt, showSort && { color: C.text }]}>Sort by</Text>
              <Feather
                name={showSort ? "chevron-up" : "chevron-down"}
                size={13}
                color={showSort ? C.text : C.textMuted}
              />
            </Pressable>

            {/* Create run */}
            {user && (
              <Pressable style={st.hBtnRow} onPress={() => router.push("/create-run")}>
                <Feather name="plus" size={15} color={C.textSecondary} />
                <Text style={st.hBtnTxt}>Create</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Search */}
        <View style={st.searchWrap}>
          <Feather name="search" size={15} color={C.textMuted} />
          <TextInput
            style={st.searchInput}
            value={search}
            onChangeText={(t) => { setSearch(t); setShowSort(false); }}
            placeholder="Search runs, hosts, locations..."
            placeholderTextColor={C.textMuted}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x" size={15} color={C.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      {/* ─── Sort dropdown ────────────────────────────────────────────────── */}
      {showSort && (
        <>
          <Pressable style={st.sortOverlay} onPress={() => setShowSort(false)} />
          <View style={[st.sortMenu, { top: topPad + 108 }]}>
            {SORT_OPTIONS.map((opt) => {
              const active = sortOption === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  style={[st.sortItem, active && st.sortItemActive]}
                  onPress={() => { setSortOption(opt.key); setShowSort(false); }}
                >
                  <Text style={[st.sortItemTxt, active && st.sortItemTxtActive]}>{opt.label}</Text>
                  {active && <Feather name="check" size={13} color={C.primary} />}
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {/* ─── List ────────────────────────────────────────────────────────── */}
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
              <Ionicons name="walk-outline" size={44} color={C.textMuted} />
              <Text style={st.emptyTitle}>No runs found</Text>
              <Text style={st.emptyText}>
                {search || isFiltered ? "Try adjusting your filters" : "Check back soon"}
              </Text>
            </View>
          ) : (
            sorted.map((run) => {
              const spotsLeft = run.max_participants - run.participant_count;
              return (
                <Pressable
                  key={run.id}
                  style={({ pressed }) => [st.card, { opacity: pressed ? 0.88 : 1 }]}
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
                      {run.host_name}
                    </Text>
                  </View>
                  <View style={st.cardMeta}>
                    <View style={st.metaItem}>
                      <Feather name="calendar" size={12} color={C.textMuted} />
                      <Text style={st.metaText}>{formatDate(run.date)} · {formatTime(run.date)}</Text>
                    </View>
                    <View style={st.metaItem}>
                      <Feather name="map-pin" size={12} color={C.textMuted} />
                      <Text style={st.metaText} numberOfLines={1}>{run.location_name}</Text>
                    </View>
                  </View>
                  <View style={st.cardStats}>
                    <View style={st.stat}>
                      <Ionicons name="walk" size={12} color={C.orange} />
                      <Text style={st.statText}>{formatPace(run.min_pace)}–{formatPace(run.max_pace)}/mi</Text>
                    </View>
                    <View style={st.divDot} />
                    <View style={st.stat}>
                      <Feather name="target" size={12} color={C.blue} />
                      <Text style={st.statText}>
                        {run.min_distance === run.max_distance ? formatDistance(run.min_distance) : `${formatDistance(run.min_distance)}–${formatDistance(run.max_distance)}`} mi
                      </Text>
                    </View>
                    <View style={st.divDot} />
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

      {/* ─── Filter Modal ─────────────────────────────────────────────────── */}
      <Modal visible={showFilter} transparent animationType="slide" onRequestClose={() => setShowFilter(false)}>
        <Pressable style={fm.overlay} onPress={() => setShowFilter(false)} />
        <View style={[fm.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={fm.handle} />
          <View style={fm.header}>
            <Text style={fm.title}>Filters</Text>
            <Pressable onPress={() => setShowFilter(false)} hitSlop={12} style={fm.closeBtn}>
              <Feather name="x" size={18} color={C.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }} bounces={false}>
            {/* Pace */}
            <View style={fm.section}>
              <View style={fm.sectionHead}>
                <Text style={fm.sectionTitle}>Pace</Text>
                <Text style={fm.sectionValue}>
                  {formatPace(draft.paceMin)} – {formatPace(draft.paceMax)} /mi
                </Text>
              </View>
              <RangeSlider
                min={6} max={12} step={PACE_STEP}
                low={draft.paceMin} high={draft.paceMax}
                onLowChange={(v) => setDraft((p) => ({ ...p, paceMin: v }))}
                onHighChange={(v) => setDraft((p) => ({ ...p, paceMax: v }))}
                color={C.primary} trackColor={C.border}
              />
              <View style={fm.edgeRow}>
                <Text style={fm.edgeLabel}>6:00</Text>
                <Text style={fm.edgeLabel}>12:00 /mi</Text>
              </View>
            </View>
            <View style={fm.divider} />

            {/* Run Length */}
            <View style={fm.section}>
              <View style={fm.sectionHead}>
                <Text style={fm.sectionTitle}>Run Length</Text>
                <Text style={fm.sectionValue}>
                  {formatDistance(draft.distMin)} – {formatDistance(draft.distMax)} mi
                </Text>
              </View>
              <RangeSlider
                min={1} max={20} step={0.5}
                low={draft.distMin} high={draft.distMax}
                onLowChange={(v) => setDraft((p) => ({ ...p, distMin: v }))}
                onHighChange={(v) => setDraft((p) => ({ ...p, distMax: v }))}
                color={C.primary} trackColor={C.border}
              />
              <View style={fm.edgeRow}>
                <Text style={fm.edgeLabel}>1 mi</Text>
                <Text style={fm.edgeLabel}>20 mi</Text>
              </View>
            </View>
            <View style={fm.divider} />

            {/* Distance From Me — not available on web */}
            <View style={fm.section}>
              <View style={fm.sectionHead}>
                <Text style={fm.sectionTitle}>Distance From Me</Text>
                <View style={fm.noLocBadge}>
                  <Feather name="map-pin" size={10} color={C.textMuted} />
                  <Text style={fm.noLocTxt}>Not available on web</Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, opacity: 0.35 }}>
                {["Any", "1 mi", "5 mi", "10 mi", "25 mi", "50 mi"].map((l) => (
                  <View key={l} style={fm.proxChip}>
                    <Text style={fm.proxChipTxt}>{l}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={fm.divider} />

            {/* Host Style */}
            <View style={fm.section}>
              <Text style={fm.sectionTitle}>Host Style</Text>
              <View style={fm.styleGrid}>
                {HOST_STYLES.map((style) => {
                  const active = draft.styles.includes(style);
                  return (
                    <Pressable
                      key={style}
                      style={[fm.stylePill, active && fm.stylePillActive]}
                      onPress={() => toggleStyle(style)}
                    >
                      {active && <Feather name="check" size={11} color={C.primary} style={{ marginRight: 4 }} />}
                      <Text style={[fm.stylePillTxt, active && fm.stylePillTxtActive]}>{style}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View style={fm.divider} />

            {/* Future filters */}
            <View style={[fm.section, { opacity: 0.4 }]}>
              <View style={fm.sectionHead}>
                <Text style={[fm.sectionTitle, { color: C.textSecondary }]}>More Filters</Text>
                <View style={fm.soonBadge}>
                  <Text style={fm.soonTxt}>Coming soon</Text>
                </View>
              </View>
              <Text style={fm.futureLabel}>Day of Week</Text>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {["M","T","W","T","F","S","S"].map((d, i) => (
                  <View key={i} style={[fm.proxChip, { minWidth: 34 }]}>
                    <Text style={fm.proxChipTxt}>{d}</Text>
                  </View>
                ))}
              </View>
              <Text style={[fm.futureLabel, { marginTop: 14 }]}>Time of Day</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {["Morning","Afternoon","Evening"].map((t) => (
                  <View key={t} style={fm.proxChip}>
                    <Text style={fm.proxChipTxt}>{t}</Text>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>

          <View style={fm.footer}>
            <Pressable style={fm.resetBtn} onPress={resetFilters}>
              <Text style={fm.resetTxt}>Reset</Text>
            </Pressable>
            <Pressable style={fm.applyBtn} onPress={applyFilters}>
              <Text style={fm.applyTxt}>Apply Filters</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStStyles(C: ColorScheme) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  titleRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12,
  },
  title: { fontFamily: "Outfit_700Bold", fontSize: 26, color: C.text, letterSpacing: -0.5 },
  headerBtns: { flexDirection: "row", alignItems: "center", gap: 6 },

  hBtn: {
    width: 38, height: 36, borderRadius: 10,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
  },
  hBtnRow: {
    flexDirection: "row", alignItems: "center", gap: 5,
    height: 36, paddingHorizontal: 11, borderRadius: 10,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  hBtnActive: { borderColor: C.primary + "55", backgroundColor: C.primaryMuted + "AA" },
  hBtnTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  dot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: C.primary,
    position: "absolute", top: 5, right: 5,
  },

  searchWrap: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.surface, borderRadius: 11, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 13, height: 44, gap: 10,
  },
  searchInput: { flex: 1, fontFamily: "Outfit_400Regular", fontSize: 14, color: C.text },

  sortOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 },
  sortMenu: {
    position: "absolute", right: 20, zIndex: 11,
    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    minWidth: 200, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 16, elevation: 14,
  },
  sortItem: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  sortItemActive: { backgroundColor: C.card },
  sortItemTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textSecondary },
  sortItemTxtActive: { color: C.text },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: 16, paddingTop: 10, gap: 10 },

  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 15,
    borderWidth: 1, borderColor: C.border, gap: 9,
  },
  cardTop: { gap: 3 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.text, flex: 1 },
  urgentBadge: {
    backgroundColor: C.orange + "20", borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: C.orange + "40",
  },
  urgentText: { fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.orange },
  hostName: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  cardMeta: { gap: 3 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  cardStats: { flexDirection: "row", alignItems: "center", gap: 10 },
  stat: { flexDirection: "row", alignItems: "center", gap: 4 },
  statText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.textSecondary },
  divDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: C.border },
  tagRow: { flexDirection: "row", gap: 5, flexWrap: "wrap" },
  tag: {
    backgroundColor: C.card, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: C.borderLight,
  },
  tagText: { fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.textSecondary },
  empty: { alignItems: "center", gap: 10, paddingTop: 80 },
  emptyTitle: { fontFamily: "Outfit_700Bold", fontSize: 17, color: C.text },
  emptyText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary, textAlign: "center" },
}); }

function makeFmStyles(C: ColorScheme) { return StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderColor: C.borderLight, maxHeight: "90%",
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginTop: 12, marginBottom: 4 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 24, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  title: { fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text },
  closeBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: C.card, alignItems: "center", justifyContent: "center" },

  section: { paddingHorizontal: 24, paddingVertical: 20 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  sectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.text },
  sectionValue: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },
  edgeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingHorizontal: 2 },
  edgeLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },
  divider: { height: 1, backgroundColor: C.border },

  noLocBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.card, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  noLocTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.textMuted },

  proxChip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  proxChipTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },

  styleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  stylePill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 13, paddingVertical: 8, borderRadius: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  stylePillActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  stylePillTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  stylePillTxtActive: { color: C.primary },

  futureLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.textMuted, marginBottom: 8 },
  soonBadge: { backgroundColor: C.card, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: C.borderLight },
  soonTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.textMuted },

  footer: { flexDirection: "row", gap: 10, paddingHorizontal: 24, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.border },
  resetBtn: { flex: 1, height: 50, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  resetTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textSecondary },
  applyBtn: { flex: 2, height: 50, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: C.primary },
  applyTxt: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.bg },
}); }
