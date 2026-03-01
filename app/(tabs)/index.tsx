import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Modal,
  ScrollView,
  Switch,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useQuery } from "@tanstack/react-query";
import C from "@/constants/colors";
import RangeSlider from "@/components/RangeSlider";
import { formatDistance } from "@/lib/formatDistance";

// ─── Constants ────────────────────────────────────────────────────────────────

const PACE_STEP = 5 / 60; // 5-second increments

type SortOption = "nearest" | "soonest" | "dist_asc" | "dist_desc";

const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: "nearest",  label: "Nearest"              },
  { key: "soonest",  label: "Soonest"               },
  { key: "dist_asc", label: "Distance: Low → High"  },
  { key: "dist_desc",label: "Distance: High → Low"  },
];

const HOST_STYLES = ["Talkative", "Quiet", "Motivational", "Training", "Ministry", "Recovery"];
const PROX_STEPS  = [1, 5, 10, 25, 50]; // miles

interface FilterState {
  paceMin: number;
  paceMax: number;
  distMin: number;
  distMax: number;
  maxDistFromMe: number | null;
  styles: string[];
}

const DEFAULT_FILTERS: FilterState = {
  paceMin: 6.0,
  paceMax: 12.0,
  distMin: 1,
  distMax: 20,
  maxDistFromMe: null,
  styles: [],
};

// ─── Run interface ────────────────────────────────────────────────────────────

interface Run {
  id: string;
  title: string;
  host_name: string;
  host_rating: number;
  date: string;
  location_lat: number;
  location_lng: number;
  location_name: string;
  min_distance: number;
  max_distance: number;
  min_pace: number;
  max_pace: number;
  tags: string[];
  participant_count: number;
  max_participants: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toR = (v: number) => (v * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatPace(pace: number) {
  const mins = Math.floor(pace);
  const secs = Math.round((pace - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
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

// ─── Filter Modal ─────────────────────────────────────────────────────────────

interface FilterModalProps {
  visible: boolean;
  onClose: () => void;
  draft: FilterState;
  setDraft: React.Dispatch<React.SetStateAction<FilterState>>;
  onApply: () => void;
  onReset: () => void;
  userLocation: { latitude: number; longitude: number } | null;
}

function FilterModal({ visible, onClose, draft, setDraft, onApply, onReset, userLocation }: FilterModalProps) {
  const insets = useSafeAreaInsets();

  function toggleStyle(s: string) {
    setDraft((p) => ({
      ...p,
      styles: p.styles.includes(s) ? p.styles.filter((x) => x !== s) : [...p.styles, s],
    }));
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={fm.overlay} onPress={onClose} />
      <View style={[fm.sheet, { paddingBottom: insets.bottom + 16 }]}>
        {/* Handle + header */}
        <View style={fm.handle} />
        <View style={fm.header}>
          <Text style={fm.title}>Filters</Text>
          <Pressable onPress={onClose} hitSlop={12} style={fm.closeBtn}>
            <Feather name="x" size={18} color={C.textSecondary} />
          </Pressable>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={fm.scrollContent}
          bounces={false}
        >
          {/* ── A. Pace ─────────────────────────────────────────────────── */}
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
              color={C.primary}
              trackColor={C.border}
            />
            <View style={fm.edgeRow}>
              <Text style={fm.edgeLabel}>6:00</Text>
              <Text style={fm.edgeLabel}>12:00 /mi</Text>
            </View>
          </View>

          <View style={fm.divider} />

          {/* ── B. Distance (Run length) ────────────────────────────────── */}
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
              color={C.primary}
              trackColor={C.border}
            />
            <View style={fm.edgeRow}>
              <Text style={fm.edgeLabel}>1 mi</Text>
              <Text style={fm.edgeLabel}>20 mi</Text>
            </View>
          </View>

          <View style={fm.divider} />

          {/* ── C. Distance From Me ─────────────────────────────────────── */}
          <View style={fm.section}>
            <View style={fm.sectionHead}>
              <Text style={fm.sectionTitle}>Distance From Me</Text>
              {!userLocation && (
                <View style={fm.noLocBadge}>
                  <Feather name="map-pin" size={10} color={C.textMuted} />
                  <Text style={fm.noLocTxt}>Location off</Text>
                </View>
              )}
            </View>
            <View style={fm.proxRow}>
              <Pressable
                style={[fm.proxChip, draft.maxDistFromMe === null && fm.proxChipActive]}
                onPress={() => setDraft((p) => ({ ...p, maxDistFromMe: null }))}
                disabled={!userLocation}
              >
                <Text style={[fm.proxChipTxt, draft.maxDistFromMe === null && fm.proxChipTxtActive]}>
                  Any
                </Text>
              </Pressable>
              {PROX_STEPS.map((mi) => (
                <Pressable
                  key={mi}
                  style={[
                    fm.proxChip,
                    draft.maxDistFromMe === mi && fm.proxChipActive,
                    !userLocation && fm.proxChipDisabled,
                  ]}
                  onPress={() => {
                    if (!userLocation) return;
                    Haptics.selectionAsync();
                    setDraft((p) => ({ ...p, maxDistFromMe: p.maxDistFromMe === mi ? null : mi }));
                  }}
                  disabled={!userLocation}
                >
                  <Text
                    style={[
                      fm.proxChipTxt,
                      draft.maxDistFromMe === mi && fm.proxChipTxtActive,
                      !userLocation && fm.proxChipTxtDisabled,
                    ]}
                  >
                    {mi} mi
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={fm.divider} />

          {/* ── D. Host Style ────────────────────────────────────────────── */}
          <View style={fm.section}>
            <Text style={fm.sectionTitle}>Host Style</Text>
            <View style={fm.styleGrid}>
              {HOST_STYLES.map((style) => {
                const active = draft.styles.includes(style);
                return (
                  <Pressable
                    key={style}
                    style={[fm.stylePill, active && fm.stylePillActive]}
                    onPress={() => { Haptics.selectionAsync(); toggleStyle(style); }}
                  >
                    {active && (
                      <Feather name="check" size={11} color={C.primary} style={{ marginRight: 4 }} />
                    )}
                    <Text style={[fm.stylePillTxt, active && fm.stylePillTxtActive]}>{style}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={fm.divider} />

          {/* ── E. Future-Proof (structure only) ────────────────────────── */}
          <View style={[fm.section, fm.futureSection]}>
            <View style={fm.sectionHead}>
              <Text style={[fm.sectionTitle, fm.futureTxt]}>More Filters</Text>
              <View style={fm.soonBadge}>
                <Text style={fm.soonTxt}>Coming soon</Text>
              </View>
            </View>

            {/* Day of week */}
            <Text style={fm.futureLabel}>Day of Week</Text>
            <View style={fm.proxRow}>
              {["M","T","W","T","F","S","S"].map((d, i) => (
                <View key={i} style={[fm.proxChip, fm.proxChipDisabled, { minWidth: 34 }]}>
                  <Text style={[fm.proxChipTxt, fm.proxChipTxtDisabled]}>{d}</Text>
                </View>
              ))}
            </View>

            {/* Time of day */}
            <Text style={[fm.futureLabel, { marginTop: 14 }]}>Time of Day</Text>
            <View style={fm.proxRow}>
              {["Morning","Afternoon","Evening"].map((t) => (
                <View key={t} style={[fm.proxChip, fm.proxChipDisabled]}>
                  <Text style={[fm.proxChipTxt, fm.proxChipTxtDisabled]}>{t}</Text>
                </View>
              ))}
            </View>

            {/* Toggles row */}
            <View style={fm.futureToggles}>
              <View style={fm.futureToggleRow}>
                <Text style={[fm.futureLabel, { marginTop: 0 }]}>Spots remaining</Text>
                <Switch value={false} disabled trackColor={{ false: C.border, true: C.primary }} />
              </View>
              <View style={fm.futureToggleRow}>
                <Text style={[fm.futureLabel, { marginTop: 0 }]}>Verified host only</Text>
                <Switch value={false} disabled trackColor={{ false: C.border, true: C.primary }} />
              </View>
            </View>
          </View>
        </ScrollView>

        {/* Footer buttons */}
        <View style={fm.footer}>
          <Pressable
            style={fm.resetBtn}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onReset(); }}
          >
            <Text style={fm.resetTxt}>Reset</Text>
          </Pressable>
          <Pressable
            style={fm.applyBtn}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onApply(); }}
          >
            <Text style={fm.applyTxt}>Apply Filters</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ─── RunCard ──────────────────────────────────────────────────────────────────

function RunCard({
  run,
  onPress,
  distanceMi,
}: {
  run: Run;
  onPress: () => void;
  distanceMi?: number;
}) {
  const spotsLeft = run.max_participants - run.participant_count;
  return (
    <Pressable
      style={({ pressed }) => [s.card, { opacity: pressed ? 0.85 : 1 }]}
      onPress={onPress}
      testID={`run-card-${run.id}`}
    >
      <View style={s.cardTop}>
        <View style={s.cardTitleRow}>
          <Text style={s.cardTitle} numberOfLines={1}>{run.title}</Text>
          {spotsLeft <= 3 && spotsLeft > 0 && (
            <View style={s.urgentBadge}>
              <Text style={s.urgentText}>{spotsLeft} left</Text>
            </View>
          )}
        </View>
        <Text style={s.hostLine}>
          {run.host_name}
          {run.host_rating > 0 && (
            <Text style={s.ratingText}>{"  "}★ {run.host_rating.toFixed(1)}</Text>
          )}
        </Text>
      </View>

      <View style={s.cardMeta}>
        <View style={s.metaItem}>
          <Feather name="calendar" size={12} color={C.textMuted} />
          <Text style={s.metaText}>{formatDate(run.date)} · {formatTime(run.date)}</Text>
        </View>
        <View style={s.metaItem}>
          <Feather name="map-pin" size={12} color={C.textMuted} />
          <Text style={s.metaText} numberOfLines={1}>{run.location_name}</Text>
        </View>
        {distanceMi !== undefined && (
          <View style={s.metaItem}>
            <Feather name="navigation" size={12} color={C.textMuted} />
            <Text style={s.metaText}>{formatDistance(distanceMi)} mi away</Text>
          </View>
        )}
      </View>

      <View style={s.cardStats}>
        <View style={s.stat}>
          <Ionicons name="walk" size={13} color={C.orange} />
          <Text style={s.statLabel}>{formatPace(run.min_pace)}–{formatPace(run.max_pace)}</Text>
          <Text style={s.statUnit}>/mi</Text>
        </View>
        <View style={s.statDiv} />
        <View style={s.stat}>
          <Feather name="target" size={13} color={C.blue} />
          <Text style={s.statLabel}>
            {formatDistance(run.min_distance)}–{formatDistance(run.max_distance)}
          </Text>
          <Text style={s.statUnit}>mi</Text>
        </View>
        <View style={s.statDiv} />
        <View style={s.stat}>
          <Ionicons name="people" size={13} color={C.textMuted} />
          <Text style={s.statLabel}>{run.participant_count}/{run.max_participants}</Text>
        </View>
      </View>

      {run.tags?.length > 0 && (
        <View style={s.tags}>
          {run.tags.slice(0, 3).map((t) => (
            <View key={t} style={s.tag}>
              <Text style={s.tagTxt}>{t}</Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();

  const [search, setSearch] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("nearest");
  const [showSort, setShowSort] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  const [draft,    setDraft]    = useState<FilterState>({ ...DEFAULT_FILTERS });
  const [applied,  setApplied]  = useState<FilterState>({ ...DEFAULT_FILTERS });

  const headerTopPad = insets.top + (Platform.OS === "web" ? 67 : 16);

  // ─── Location ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (Platform.OS === "web") { setSortOption("soonest"); return; }
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") { setSortOption("soonest"); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setUserLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    })();
  }, []);

  // ─── Data ──────────────────────────────────────────────────────────────────

  const { data: runs = [], isLoading, refetch, isRefetching } = useQuery<Run[]>({
    queryKey: ["/api/runs"],
    staleTime: 30_000,
  });

  // ─── Distance map ──────────────────────────────────────────────────────────

  const distanceMap = useMemo<Record<string, number>>(() => {
    if (!userLocation) return {};
    const m: Record<string, number> = {};
    for (const run of runs) {
      m[run.id] = haversine(
        userLocation.latitude, userLocation.longitude,
        run.location_lat, run.location_lng
      );
    }
    return m;
  }, [runs, userLocation]);

  // ─── Filter + Sort ─────────────────────────────────────────────────────────

  const sorted = useMemo(() => {
    const list = runs.filter((r) => {
      // Search
      const q = search.toLowerCase();
      const matchSearch = !search ||
        r.title.toLowerCase().includes(q) ||
        r.location_name.toLowerCase().includes(q) ||
        r.host_name.toLowerCase().includes(q);
      // Pace overlap
      const matchPace = r.min_pace <= applied.paceMax && r.max_pace >= applied.paceMin;
      // Distance (run length) overlap
      const matchDist = r.min_distance <= applied.distMax && r.max_distance >= applied.distMin;
      // Proximity
      const matchProx = !applied.maxDistFromMe || !userLocation ||
        (distanceMap[r.id] ?? Infinity) <= applied.maxDistFromMe;
      // Host style
      const matchStyle = applied.styles.length === 0 ||
        r.tags?.some((t) => applied.styles.includes(t));

      return matchSearch && matchPace && matchDist && matchProx && matchStyle;
    });

    switch (sortOption) {
      case "nearest":
        list.sort((a, b) =>
          userLocation
            ? (distanceMap[a.id] ?? Infinity) - (distanceMap[b.id] ?? Infinity)
            : new Date(a.date).getTime() - new Date(b.date).getTime()
        );
        break;
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
  }, [runs, search, applied, sortOption, distanceMap, userLocation]);

  // ─── Filter state helpers ──────────────────────────────────────────────────

  const isFiltered =
    applied.paceMin !== DEFAULT_FILTERS.paceMin ||
    applied.paceMax !== DEFAULT_FILTERS.paceMax ||
    applied.distMin !== DEFAULT_FILTERS.distMin ||
    applied.distMax !== DEFAULT_FILTERS.distMax ||
    applied.maxDistFromMe !== null ||
    applied.styles.length > 0;

  const isNonDefaultSort = sortOption !== "nearest";

  function openFilter() {
    setDraft({ ...applied });
    setShowSort(false);
    setShowFilter(true);
  }

  function applyFilters() {
    setApplied({ ...draft });
    setShowFilter(false);
  }

  function resetFilters() {
    setDraft({ ...DEFAULT_FILTERS });
  }

  // ─── Navigate to map ───────────────────────────────────────────────────────

  function goToMap() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const p = new URLSearchParams();
    if (applied.styles.length > 0) p.set("styles", applied.styles.join(","));
    const qs = p.toString();
    router.push(qs ? `/map?${qs}` : "/map");
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={s.container}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[s.header, { paddingTop: headerTopPad }]}>
        <View style={s.titleRow}>
          <Text style={s.title}>PaceUp</Text>

          <View style={s.headerBtns}>
            {/* Filter */}
            <Pressable
              style={[s.hBtn, isFiltered && s.hBtnActive]}
              onPress={openFilter}
              testID="filter-button"
            >
              <Feather name="sliders" size={16} color={isFiltered ? C.primary : C.textSecondary} />
              {isFiltered && <View style={s.dot} />}
            </Pressable>

            {/* Sort */}
            <Pressable
              style={[s.hBtnRow, showSort && s.hBtnActive]}
              onPress={() => { setShowSort((v) => !v); setShowFilter(false); }}
              testID="sort-button"
            >
              {isNonDefaultSort && <View style={s.dot} />}
              <Text style={[s.hBtnTxt, showSort && { color: C.text }]}>Sort by</Text>
              <Feather
                name={showSort ? "chevron-up" : "chevron-down"}
                size={13}
                color={showSort ? C.text : C.textMuted}
              />
            </Pressable>

            {/* Map */}
            <Pressable style={s.hBtnRow} onPress={goToMap} testID="map-button">
              <Feather name="map" size={15} color={C.textSecondary} />
              <Text style={s.hBtnTxt}>Map</Text>
            </Pressable>
          </View>
        </View>

        {/* Search */}
        <View style={s.searchWrap}>
          <Feather name="search" size={15} color={C.textMuted} />
          <TextInput
            style={s.searchInput}
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

      {/* ── Sort dropdown ──────────────────────────────────────────────────── */}
      {showSort && (
        <>
          <Pressable style={s.sortOverlay} onPress={() => setShowSort(false)} />
          <View style={[s.sortMenu, { top: headerTopPad + 54 }]}>
            {SORT_OPTIONS.map((opt) => {
              const active = sortOption === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  style={[s.sortItem, active && s.sortItemActive]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSortOption(opt.key);
                    setShowSort(false);
                  }}
                >
                  <Text style={[s.sortItemTxt, active && s.sortItemTxtActive]}>
                    {opt.label}
                  </Text>
                  {active && (
                    <Feather name="check" size={13} color={C.primary} />
                  )}
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {/* ── List ───────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={C.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(r) => r.id}
          contentContainerStyle={[
            s.list,
            { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 100) },
          ]}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!!sorted.length}
          onScrollBeginDrag={() => setShowSort(false)}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={C.primary} />
          }
          renderItem={({ item }) => (
            <RunCard
              run={item}
              distanceMi={userLocation ? distanceMap[item.id] : undefined}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowSort(false);
                router.push(`/run/${item.id}`);
              }}
            />
          )}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="walk-outline" size={44} color={C.textMuted} />
              <Text style={s.emptyTitle}>No runs found</Text>
              <Text style={s.emptySub}>
                {search || isFiltered
                  ? "Try adjusting your filters"
                  : "Check back soon for upcoming runs"}
              </Text>
            </View>
          }
        />
      )}

      {/* ── Filter Modal ───────────────────────────────────────────────────── */}
      <FilterModal
        visible={showFilter}
        onClose={() => setShowFilter(false)}
        draft={draft}
        setDraft={setDraft}
        onApply={applyFilters}
        onReset={resetFilters}
        userLocation={userLocation}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: { paddingHorizontal: 20, paddingBottom: 12 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: { fontFamily: "Outfit_700Bold", fontSize: 26, color: C.text, letterSpacing: -0.5 },

  headerBtns: { flexDirection: "row", alignItems: "center", gap: 6 },

  hBtn: {
    width: 38,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  hBtnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 36,
    paddingHorizontal: 11,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  hBtnActive: { borderColor: C.primary + "55", backgroundColor: C.primaryMuted + "AA" },
  hBtnTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.primary,
    position: "absolute",
    top: 5,
    right: 5,
  },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 13,
    height: 44,
    gap: 10,
  },
  searchInput: { flex: 1, fontFamily: "Outfit_400Regular", fontSize: 14, color: C.text },

  sortOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 10,
  },
  sortMenu: {
    position: "absolute",
    right: 16,
    zIndex: 11,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    minWidth: 200,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 14,
    overflow: "hidden",
  },
  sortItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  sortItemActive: { backgroundColor: C.card },
  sortItemTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textSecondary },
  sortItemTxtActive: { color: C.text },

  list: { paddingHorizontal: 16, paddingTop: 10, gap: 10 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 15,
    borderWidth: 1,
    borderColor: C.border,
    gap: 9,
  },
  cardTop: { gap: 3 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.text, flex: 1 },
  urgentBadge: {
    backgroundColor: C.orange + "20",
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: C.orange + "40",
  },
  urgentText: { fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.orange },
  hostLine: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  ratingText: { color: C.gold },

  cardMeta: { gap: 3 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary, flex: 1 },

  cardStats: { flexDirection: "row", alignItems: "center", gap: 10 },
  stat: { flexDirection: "row", alignItems: "center", gap: 4 },
  statLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.text },
  statUnit: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },
  statDiv: { width: 1, height: 12, backgroundColor: C.border },

  tags: { flexDirection: "row", gap: 5, flexWrap: "wrap" },
  tag: {
    backgroundColor: C.card,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  tagTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.textSecondary },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 10 },
  emptyTitle: { fontFamily: "Outfit_700Bold", fontSize: 17, color: C.text },
  emptySub: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.textSecondary,
    textAlign: "center",
    paddingHorizontal: 40,
  },
});

// ─── Filter Modal Styles ──────────────────────────────────────────────────────

const fm = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: C.borderLight,
    maxHeight: "90%",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  title: { fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
  },

  scrollContent: { paddingBottom: 8 },

  section: { paddingHorizontal: 24, paddingVertical: 20 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  sectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.text },
  sectionValue: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },

  edgeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
    paddingHorizontal: 2,
  },
  edgeLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },

  divider: { height: 1, backgroundColor: C.border, marginHorizontal: 0 },

  noLocBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.card,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  noLocTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.textMuted },

  proxRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  proxChip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  proxChipActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  proxChipDisabled: { opacity: 0.35 },
  proxChipTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  proxChipTxtActive: { color: C.primary },
  proxChipTxtDisabled: { color: C.textMuted },

  styleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  stylePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  stylePillActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  stylePillTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  stylePillTxtActive: { color: C.primary },

  futureSection: { opacity: 0.45 },
  futureTxt: { color: C.textSecondary },
  futureLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: C.textMuted,
    marginBottom: 8,
    marginTop: 6,
  },
  soonBadge: {
    backgroundColor: C.card,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  soonTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.textMuted },
  futureToggles: { marginTop: 14, gap: 12 },
  futureToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  footer: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 24,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  resetBtn: {
    flex: 1,
    height: 50,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  resetTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textSecondary },
  applyBtn: {
    flex: 2,
    height: 50,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.primary,
  },
  applyTxt: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.bg },
});
