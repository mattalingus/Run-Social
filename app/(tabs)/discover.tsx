import React, { useState } from "react";
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
import { useQuery } from "@tanstack/react-query";
import C from "@/constants/colors";
import { formatDistance } from "@/lib/formatDistance";

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

function formatPace(pace: number) {
  const mins = Math.floor(pace);
  const secs = Math.round((pace - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function RunCard({ run, onPress }: { run: Run; onPress: () => void }) {
  const spotsLeft = run.max_participants - run.participant_count;
  return (
    <Pressable
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.9 : 1 }]}
      onPress={onPress}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>{run.title}</Text>
          {spotsLeft <= 3 && spotsLeft > 0 && (
            <View style={styles.urgentBadge}>
              <Text style={styles.urgentText}>{spotsLeft} left</Text>
            </View>
          )}
        </View>
        <Text style={styles.hostLine}>
          {run.host_name}
          {run.host_rating > 0 && (
            <Text style={styles.rating}>  {run.host_rating.toFixed(1)}</Text>
          )}
        </Text>
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
          <Ionicons name="walk" size={13} color={C.orange} />
          <Text style={styles.statLabel}>{formatPace(run.min_pace)}–{formatPace(run.max_pace)}</Text>
          <Text style={styles.statUnit}>/mi</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Feather name="target" size={13} color={C.blue} />
          <Text style={styles.statLabel}>{formatDistance(run.min_distance)}–{formatDistance(run.max_distance)}</Text>
          <Text style={styles.statUnit}>mi</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Ionicons name="people" size={13} color={C.textMuted} />
          <Text style={styles.statLabel}>{run.participant_count}/{run.max_participants}</Text>
        </View>
      </View>

      {run.tags?.length > 0 && (
        <View style={styles.tags}>
          {run.tags.slice(0, 3).map((t) => (
            <View key={t} style={styles.tag}>
              <Text style={styles.tagText}>{t}</Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState("All");

  const { data: runs = [], isLoading, refetch, isRefetching } = useQuery<Run[]>({
    queryKey: ["/api/runs"],
  });

  const filtered = runs.filter((r) => {
    const matchSearch = !search || r.title.toLowerCase().includes(search.toLowerCase()) || r.location_name.toLowerCase().includes(search.toLowerCase()) || r.host_name.toLowerCase().includes(search.toLowerCase());
    const matchTag = activeTag === "All" || r.tags?.includes(activeTag);
    return matchSearch && matchTag;
  });

  return (
    <View style={[styles.container, Platform.OS === "web" && { paddingTop: insets.top + 67 }]}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Discover Runs</Text>
        <View style={styles.searchWrap}>
          <Feather name="search" size={16} color={C.textMuted} />
          <TextInput
            style={styles.searchInput}
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

      <View style={styles.tagsRow}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={RUN_TAGS}
          keyExtractor={(t) => t}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.tagFilter, activeTag === item && styles.tagFilterActive]}
              onPress={() => { Haptics.selectionAsync(); setActiveTag(item); }}
            >
              <Text style={[styles.tagFilterText, activeTag === item && styles.tagFilterTextActive]}>{item}</Text>
            </Pressable>
          )}
        />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => r.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!!filtered.length}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={C.primary} />}
          renderItem={({ item }) => (
            <RunCard
              run={item}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/run/${item.id}`); }}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="walk-outline" size={48} color={C.textMuted} />
              <Text style={styles.emptyTitle}>No runs found</Text>
              <Text style={styles.emptySub}>
                {search || activeTag !== "All" ? "Try different filters" : "Check back soon for upcoming runs"}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  title: { fontFamily: "Outfit_700Bold", fontSize: 28, color: C.text, marginBottom: 14 },
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
  tagsRow: { marginBottom: 12 },
  tagFilter: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  tagFilterActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  tagFilterText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  tagFilterTextActive: { color: C.primary },
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
  urgentBadge: { backgroundColor: C.orange + "22", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: C.orange + "44" },
  urgentText: { fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.orange },
  hostLine: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary },
  rating: { color: C.gold },
  cardMeta: { gap: 4 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary, flex: 1 },
  cardStats: { flexDirection: "row", alignItems: "center", gap: 12 },
  stat: { flexDirection: "row", alignItems: "center", gap: 4 },
  statLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.text },
  statUnit: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },
  statDivider: { width: 1, height: 14, backgroundColor: C.border },
  tags: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  tag: { backgroundColor: C.primaryMuted, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: C.primary + "33" },
  tagText: { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: C.primary },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text },
  emptySub: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center", paddingHorizontal: 40 },
});
