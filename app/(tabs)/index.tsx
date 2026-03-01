import React, { useState, useEffect, useMemo, useRef } from "react";
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
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useQuery } from "@tanstack/react-query";
import C from "@/constants/colors";
import { formatDistance } from "@/lib/formatDistance";

// ─── Types ────────────────────────────────────────────────────────────────────

type SortOption = "nearest" | "soonest" | "dist_asc" | "dist_desc";

const SORT_OPTIONS: { key: SortOption; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "nearest",  label: "Nearest",       icon: "navigation" },
  { key: "soonest",  label: "Soonest",        icon: "clock"      },
  { key: "dist_asc", label: "Short → Long",   icon: "trending-up"  },
  { key: "dist_desc",label: "Long → Short",   icon: "trending-down"},
];

const RUN_TAGS = ["All", "Talkative", "Quiet", "Motivational", "Training", "Ministry", "Recovery"];

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
      style={({ pressed }) => [s.card, { opacity: pressed ? 0.88 : 1 }]}
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
          <Feather name="calendar" size={12} color={C.primary} />
          <Text style={s.metaText}>{formatDate(run.date)} · {formatTime(run.date)}</Text>
        </View>
        <View style={s.metaItem}>
          <Feather name="map-pin" size={12} color={C.primary} />
          <Text style={s.metaText} numberOfLines={1}>{run.location_name}</Text>
        </View>
        {distanceMi !== undefined && (
          <View style={s.metaItem}>
            <Feather name="navigation" size={12} color={C.textMuted} />
            <Text style={[s.metaText, { color: C.textMuted }]}>{formatDistance(distanceMi)} mi away</Text>
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
  const [activeTag, setActiveTag] = useState("All");
  const [sortOption, setSortOption] = useState<SortOption>("nearest");
  const [showSort, setShowSort] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);

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
      m[run.id] = haversine(userLocation.latitude, userLocation.longitude, run.location_lat, run.location_lng);
    }
    return m;
  }, [runs, userLocation]);

  // ─── Filter + Sort ─────────────────────────────────────────────────────────

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
  }, [runs, search, activeTag, sortOption, distanceMap, userLocation]);

  // ─── Navigate to map ───────────────────────────────────────────────────────

  function goToMap() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const p = new URLSearchParams();
    if (activeTag !== "All") p.set("styles", activeTag);
    const qs = p.toString();
    router.push(qs ? `/map?${qs}` : "/map");
  }

  const sortLabel = SORT_OPTIONS.find((o) => o.key === sortOption)?.label ?? "Sort";

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={s.container}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[s.header, { paddingTop: headerTopPad }]}>
        <View style={s.titleRow}>
          <Text style={s.title}>Discover</Text>
          <View style={s.headerBtns}>
            <Pressable
              style={[s.sortBtn, showSort && s.sortBtnActive]}
              onPress={() => setShowSort((v) => !v)}
              testID="sort-button"
            >
              <Feather name="sliders" size={13} color={showSort ? C.primary : C.textSecondary} />
              <Text style={[s.sortBtnTxt, showSort && { color: C.primary }]} numberOfLines={1}>
                {sortLabel}
              </Text>
              <Feather
                name={showSort ? "chevron-up" : "chevron-down"}
                size={12}
                color={showSort ? C.primary : C.textMuted}
              />
            </Pressable>
            <Pressable style={s.mapBtn} onPress={goToMap} testID="map-button">
              <Feather name="map" size={14} color={C.bg} />
              <Text style={s.mapBtnTxt}>Map</Text>
            </Pressable>
          </View>
        </View>

        <View style={s.searchWrap}>
          <Feather name="search" size={16} color={C.textMuted} />
          <TextInput
            style={s.searchInput}
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
      </View>

      {/* ── Sort dropdown ──────────────────────────────────────────────────── */}
      {showSort && (
        <>
          <Pressable
            onPress={() => setShowSort(false)}
            style={s.sortOverlay}
          />
          <View style={[s.sortMenu, { top: headerTopPad + 56 }]}>
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
                  <Feather
                    name={opt.icon}
                    size={14}
                    color={active ? C.primary : C.textSecondary}
                  />
                  <Text style={[s.sortItemTxt, active && { color: C.primary }]}>
                    {opt.label}
                  </Text>
                  {active && <Feather name="check" size={13} color={C.primary} style={{ marginLeft: "auto" }} />}
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {/* ── Tag filters ────────────────────────────────────────────────────── */}
      <View style={s.tagsRow}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={RUN_TAGS}
          keyExtractor={(t) => t}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
          renderItem={({ item }) => (
            <Pressable
              style={[s.tagChip, activeTag === item && s.tagChipActive]}
              onPress={() => { Haptics.selectionAsync(); setActiveTag(item); setShowSort(false); }}
            >
              <Text style={[s.tagChipTxt, activeTag === item && s.tagChipTxtActive]}>{item}</Text>
            </Pressable>
          )}
        />
      </View>

      {/* ── List ───────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={C.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(r) => r.id}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 100) }]}
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
              <Ionicons name="walk-outline" size={48} color={C.textMuted} />
              <Text style={s.emptyTitle}>No runs found</Text>
              <Text style={s.emptySub}>
                {search || activeTag !== "All"
                  ? "Try different filters"
                  : "Check back soon for upcoming runs"}
              </Text>
            </View>
          }
        />
      )}
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
  title: { fontFamily: "Outfit_700Bold", fontSize: 28, color: C.text, letterSpacing: -0.5 },
  headerBtns: { flexDirection: "row", alignItems: "center", gap: 8 },

  sortBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    maxWidth: 130,
  },
  sortBtnActive: { borderColor: C.primary, backgroundColor: C.primaryMuted },
  sortBtnTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: C.textSecondary,
    flexShrink: 1,
  },

  mapBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 5,
  },
  mapBtnTxt: { fontFamily: "Outfit_700Bold", fontSize: 13, color: C.bg },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    height: 46,
    gap: 10,
  },
  searchInput: { flex: 1, fontFamily: "Outfit_400Regular", fontSize: 15, color: C.text },

  sortOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 10,
  },
  sortMenu: {
    position: "absolute",
    right: 16,
    zIndex: 11,
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    minWidth: 190,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 16,
    overflow: "hidden",
  },
  sortItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  sortItemActive: { backgroundColor: C.primaryMuted },
  sortItemTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textSecondary, flex: 1 },

  tagsRow: { marginBottom: 8 },
  tagChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  tagChipActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  tagChipTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  tagChipTxtActive: { color: C.primary },

  list: { paddingHorizontal: 20, paddingTop: 4, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    gap: 10,
  },
  cardTop: { gap: 4 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text, flex: 1 },
  urgentBadge: {
    backgroundColor: C.orange + "22",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: C.orange + "44",
  },
  urgentText: { fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.orange },
  hostLine: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary },
  ratingText: { color: C.gold },
  cardMeta: { gap: 4 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary, flex: 1 },
  cardStats: { flexDirection: "row", alignItems: "center", gap: 12 },
  stat: { flexDirection: "row", alignItems: "center", gap: 4 },
  statLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.text },
  statUnit: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },
  statDiv: { width: 1, height: 14, backgroundColor: C.border },
  tags: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  tag: {
    backgroundColor: C.primaryMuted,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: C.primary + "33",
  },
  tagTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: C.primary },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text },
  emptySub: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textSecondary,
    textAlign: "center",
    paddingHorizontal: 40,
  },
});
