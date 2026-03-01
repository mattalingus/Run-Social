import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import C from "@/constants/colors";

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

const RUN_TAGS = ["All", "Talkative", "Quiet", "Motivational", "Training", "Ministry", "Recovery"];

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

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState("All");

  const { data: runs = [], isLoading } = useQuery<Run[]>({
    queryKey: ["/api/runs"],
  });

  const filtered = runs.filter((r) => {
    const matchSearch = !search || r.title.toLowerCase().includes(search.toLowerCase()) || r.location_name.toLowerCase().includes(search.toLowerCase());
    const matchTag = activeTag === "All" || r.tags?.includes(activeTag);
    return matchSearch && matchTag;
  });

  return (
    <View style={[styles.container, { paddingTop: insets.top + 67 }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.title}>PaceUp</Text>
            <Text style={styles.subtitle}>Upcoming Runs</Text>
          </View>
          {user?.host_unlocked && (
            <Pressable
              style={styles.createBtn}
              onPress={() => router.push("/create-run/index")}
            >
              <Feather name="plus" size={18} color={C.bg} />
              <Text style={styles.createBtnText}>Create Run</Text>
            </Pressable>
          )}
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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tagsRow}
      >
        {RUN_TAGS.map((tag) => (
          <Pressable
            key={tag}
            style={[styles.tagChip, activeTag === tag && styles.tagChipActive]}
            onPress={() => setActiveTag(tag)}
          >
            <Text style={[styles.tagChipText, activeTag === tag && styles.tagChipTextActive]}>{tag}</Text>
          </Pressable>
        ))}
      </ScrollView>

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
              <Text style={styles.emptyText}>Check back soon for upcoming runs</Text>
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
                  <Text style={styles.hostName}>by {run.host_name}{run.host_rating > 0 ? ` · ${run.host_rating.toFixed(1)}` : ""}</Text>
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
                  <View style={styles.tags}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title: { fontFamily: "Outfit_700Bold", fontSize: 28, color: C.text },
  subtitle: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, marginTop: 2 },
  createBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  createBtnText: { fontFamily: "Outfit_700Bold", fontSize: 13, color: C.bg },
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
  tagsRow: { paddingHorizontal: 20, paddingBottom: 12, gap: 8, flexDirection: "row" },
  tagChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  tagChipActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  tagChipText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  tagChipTextActive: { color: C.primary },
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
  tags: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  tag: { backgroundColor: C.primaryMuted, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: C.primary + "33" },
  tagText: { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: C.primary },
  empty: { alignItems: "center", gap: 12, paddingTop: 80 },
  emptyTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text },
  emptyText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center" },
});
