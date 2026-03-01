import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import C from "@/constants/colors";

const FEEDBACK_TAGS = [
  "Kept advertised pace",
  "Well organized",
  "Welcoming",
  "Clear communication",
];

export default function RateHostScreen() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [stars, setStars] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const { data: run } = useQuery<any>({
    queryKey: ["/api/runs", runId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${runId}`);
      return res.json();
    },
    enabled: !!runId,
  });

  const rateMutation = useMutation({
    mutationFn: async () => {
      if (stars === 0) throw new Error("Please select a star rating");
      await apiRequest("POST", `/api/runs/${runId}/rate`, { stars, tags: selectedTags });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/runs", runId, "my-rating"] });
      qc.invalidateQueries({ queryKey: ["/api/runs", runId] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Thanks!", "Your rating has been submitted.", [
        { text: "Done", onPress: () => router.back() },
      ]);
    },
    onError: (e: any) => {
      Alert.alert("Error", e.message || "Failed to submit rating");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  function toggleTag(tag: string) {
    setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
    Haptics.selectionAsync();
  }

  const STAR_LABELS = ["", "Poor", "Fair", "Good", "Great", "Excellent"];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => router.back()} style={styles.closeBtn}>
          <Feather name="x" size={20} color={C.textSecondary} />
        </Pressable>
        <Text style={styles.headerTitle}>Rate Host</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {run && (
          <View style={styles.runInfo}>
            <Text style={styles.runTitle}>{run.title}</Text>
            <View style={styles.hostRow}>
              <View style={styles.hostAvatar}>
                <Text style={styles.hostAvatarText}>{run.host_name?.charAt(0).toUpperCase()}</Text>
              </View>
              <Text style={styles.hostName}>{run.host_name}</Text>
            </View>
          </View>
        )}

        <View style={styles.starsSection}>
          <Text style={styles.sectionTitle}>Overall Rating</Text>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((s) => (
              <Pressable
                key={s}
                onPress={() => { setStars(s); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
                onPressIn={() => setHoveredStar(s)}
                onPressOut={() => setHoveredStar(0)}
                style={styles.starBtn}
              >
                <Ionicons
                  name={(hoveredStar || stars) >= s ? "star" : "star-outline"}
                  size={44}
                  color={(hoveredStar || stars) >= s ? C.gold : C.border}
                />
              </Pressable>
            ))}
          </View>
          {stars > 0 && (
            <Text style={styles.starLabel}>{STAR_LABELS[stars]}</Text>
          )}
        </View>

        <View style={styles.tagsSection}>
          <Text style={styles.sectionTitle}>What went well? (optional)</Text>
          <Text style={styles.sectionSub}>Select all that apply</Text>
          <View style={styles.tagsGrid}>
            {FEEDBACK_TAGS.map((tag) => (
              <Pressable
                key={tag}
                style={[styles.tagChip, selectedTags.includes(tag) && styles.tagChipActive]}
                onPress={() => toggleTag(tag)}
              >
                {selectedTags.includes(tag) && (
                  <Feather name="check" size={13} color={C.primary} />
                )}
                <Text style={[styles.tagText, selectedTags.includes(tag) && styles.tagTextActive]}>{tag}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.submitBtn, stars === 0 && styles.submitBtnDisabled, { opacity: pressed || rateMutation.isPending ? 0.8 : 1 }]}
          onPress={() => rateMutation.mutate()}
          disabled={stars === 0 || rateMutation.isPending}
        >
          {rateMutation.isPending ? (
            <ActivityIndicator color={C.bg} />
          ) : (
            <>
              <Ionicons name="star" size={18} color={stars > 0 ? C.bg : C.textMuted} />
              <Text style={[styles.submitBtnText, stars === 0 && styles.submitBtnTextDisabled]}>
                Submit Rating
              </Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  closeBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text, textAlign: "center" },
  content: { padding: 24, gap: 28 },
  runInfo: { backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border, gap: 10 },
  runTitle: { fontFamily: "Outfit_700Bold", fontSize: 17, color: C.text },
  hostRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  hostAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.primaryMuted, borderWidth: 1, borderColor: C.primary + "44", alignItems: "center", justifyContent: "center" },
  hostAvatarText: { fontFamily: "Outfit_700Bold", fontSize: 13, color: C.primary },
  hostName: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textSecondary },
  starsSection: { alignItems: "center", gap: 16 },
  sectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 17, color: C.text, alignSelf: "flex-start" },
  sectionSub: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary, alignSelf: "flex-start", marginTop: -8 },
  starsRow: { flexDirection: "row", gap: 8 },
  starBtn: { padding: 4 },
  starLabel: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.gold },
  tagsSection: { gap: 10 },
  tagsGrid: { gap: 10 },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  tagChipActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  tagText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textSecondary },
  tagTextActive: { color: C.primary },
  submitBtn: {
    backgroundColor: C.gold,
    borderRadius: 14,
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  submitBtnDisabled: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  submitBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.bg },
  submitBtnTextDisabled: { color: C.textMuted },
});
