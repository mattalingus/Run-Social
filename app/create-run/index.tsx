import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/query-client";
import C from "@/constants/colors";

const RUN_TAGS = ["Talkative", "Quiet", "Motivational", "Training", "Ministry", "Recovery"];
const PRIVACY_OPTIONS = [
  { value: "public", label: "Public", icon: "globe", desc: "Anyone can join" },
  { value: "private", label: "Private", icon: "lock", desc: "Invite only" },
  { value: "solo", label: "Solo", icon: "user", desc: "Just you" },
];

export default function CreateRunScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState("public");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationLat, setLocationLat] = useState("37.7749");
  const [locationLng, setLocationLng] = useState("-122.4194");
  const [minDistance, setMinDistance] = useState("3");
  const [maxDistance, setMaxDistance] = useState("6");
  const [minPace, setMinPace] = useState("8");
  const [maxPace, setMaxPace] = useState("12");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [maxParticipants, setMaxParticipants] = useState("20");

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Title is required");
      if (!date.trim()) throw new Error("Date is required (YYYY-MM-DD)");
      if (!time.trim()) throw new Error("Time is required (HH:MM)");
      if (!locationName.trim()) throw new Error("Location name is required");

      const dateTime = new Date(`${date}T${time}:00`);
      if (isNaN(dateTime.getTime())) throw new Error("Invalid date or time format");

      await apiRequest("POST", "/api/runs", {
        title: title.trim(),
        description: description.trim() || undefined,
        privacy,
        date: dateTime.toISOString(),
        locationLat: parseFloat(locationLat),
        locationLng: parseFloat(locationLng),
        locationName: locationName.trim(),
        minDistance: parseFloat(minDistance),
        maxDistance: parseFloat(maxDistance),
        minPace: parseFloat(minPace),
        maxPace: parseFloat(maxPace),
        tags: selectedTags,
        maxParticipants: parseInt(maxParticipants),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/runs"] });
      qc.invalidateQueries({ queryKey: ["/api/runs/mine"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Run Created!", "Your run is now live on the map.", [
        { text: "Great!", onPress: () => router.back() },
      ]);
    },
    onError: (e: any) => {
      Alert.alert("Error", e.message || "Failed to create run");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  function toggleTag(tag: string) {
    setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
    Haptics.selectionAsync();
  }

  if (!user?.host_unlocked) {
    return (
      <View style={[styles.container, styles.center]}>
        <Feather name="lock" size={48} color={C.textMuted} />
        <Text style={styles.lockedTitle}>Host Privileges Required</Text>
        <Text style={styles.lockedSub}>Complete 3 runs with 2+ different hosts to unlock hosting</Text>
        <Pressable style={styles.closeBtn} onPress={() => router.back()}>
          <Text style={styles.closeBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => router.back()} style={styles.cancelBtn}>
          <Feather name="x" size={20} color={C.textSecondary} />
        </Pressable>
        <Text style={styles.headerTitle}>Create Run</Text>
        <Pressable
          style={({ pressed }) => [styles.createBtn, { opacity: pressed || createMutation.isPending ? 0.8 : 1 }]}
          onPress={() => createMutation.mutate()}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? (
            <ActivityIndicator size="small" color={C.bg} />
          ) : (
            <Text style={styles.createBtnText}>Post</Text>
          )}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.form, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.field}>
          <Text style={styles.label}>Run Title *</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Morning 5K in the Park"
            placeholderTextColor={C.textMuted}
            maxLength={60}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={description}
            onChangeText={setDescription}
            placeholder="Tell runners what to expect..."
            placeholderTextColor={C.textMuted}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Visibility</Text>
          <View style={styles.privacyRow}>
            {PRIVACY_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                style={[styles.privacyOption, privacy === opt.value && styles.privacyOptionActive]}
                onPress={() => { setPrivacy(opt.value); Haptics.selectionAsync(); }}
              >
                <Feather name={opt.icon as any} size={16} color={privacy === opt.value ? C.primary : C.textSecondary} />
                <Text style={[styles.privacyLabel, privacy === opt.value && styles.privacyLabelActive]}>{opt.label}</Text>
                <Text style={styles.privacyDesc}>{opt.desc}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.row}>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>Date * (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.input}
              value={date}
              onChangeText={setDate}
              placeholder="2026-03-15"
              placeholderTextColor={C.textMuted}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>Time * (HH:MM)</Text>
            <TextInput
              style={styles.input}
              value={time}
              onChangeText={setTime}
              placeholder="07:00"
              placeholderTextColor={C.textMuted}
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Location Name *</Text>
          <TextInput
            style={styles.input}
            value={locationName}
            onChangeText={setLocationName}
            placeholder="e.g. Central Park South Entrance"
            placeholderTextColor={C.textMuted}
          />
        </View>

        <View style={styles.row}>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>Latitude</Text>
            <TextInput
              style={styles.input}
              value={locationLat}
              onChangeText={setLocationLat}
              keyboardType="decimal-pad"
              placeholderTextColor={C.textMuted}
            />
          </View>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>Longitude</Text>
            <TextInput
              style={styles.input}
              value={locationLng}
              onChangeText={setLocationLng}
              keyboardType="decimal-pad"
              placeholderTextColor={C.textMuted}
            />
          </View>
        </View>

        <View style={styles.sectionDivider}>
          <Text style={styles.sectionLabel}>Pace Requirements (min/mile)</Text>
        </View>

        <View style={styles.row}>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>Min Pace</Text>
            <TextInput
              style={styles.input}
              value={minPace}
              onChangeText={setMinPace}
              keyboardType="decimal-pad"
              placeholder="8.0"
              placeholderTextColor={C.textMuted}
            />
          </View>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>Max Pace</Text>
            <TextInput
              style={styles.input}
              value={maxPace}
              onChangeText={setMaxPace}
              keyboardType="decimal-pad"
              placeholder="12.0"
              placeholderTextColor={C.textMuted}
            />
          </View>
        </View>

        <View style={styles.sectionDivider}>
          <Text style={styles.sectionLabel}>Distance Requirements (miles)</Text>
        </View>

        <View style={styles.row}>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>Min Distance</Text>
            <TextInput
              style={styles.input}
              value={minDistance}
              onChangeText={setMinDistance}
              keyboardType="decimal-pad"
              placeholder="3"
              placeholderTextColor={C.textMuted}
            />
          </View>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>Max Distance</Text>
            <TextInput
              style={styles.input}
              value={maxDistance}
              onChangeText={setMaxDistance}
              keyboardType="decimal-pad"
              placeholder="6"
              placeholderTextColor={C.textMuted}
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Max Participants</Text>
          <TextInput
            style={styles.input}
            value={maxParticipants}
            onChangeText={setMaxParticipants}
            keyboardType="number-pad"
            placeholder="20"
            placeholderTextColor={C.textMuted}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Run Style Tags</Text>
          <View style={styles.tagsGrid}>
            {RUN_TAGS.map((tag) => (
              <Pressable
                key={tag}
                style={[styles.tagChip, selectedTags.includes(tag) && styles.tagChipActive]}
                onPress={() => toggleTag(tag)}
              >
                <Text style={[styles.tagChipText, selectedTags.includes(tag) && styles.tagChipTextActive]}>{tag}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: "center", justifyContent: "center", gap: 16, padding: 40 },
  lockedTitle: { fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text, textAlign: "center" },
  lockedSub: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center" },
  closeBtn: { marginTop: 8, backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, borderWidth: 1, borderColor: C.border },
  closeBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.text },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  cancelBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text, textAlign: "center" },
  createBtn: { backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8, minWidth: 52, alignItems: "center" },
  createBtnText: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.bg },
  form: { padding: 20, gap: 16 },
  field: { gap: 6 },
  label: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  input: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: C.text,
  },
  textarea: { height: 80, paddingTop: 12 },
  privacyRow: { flexDirection: "row", gap: 8 },
  privacyOption: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  privacyOptionActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  privacyLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  privacyLabelActive: { color: C.primary },
  privacyDesc: { fontFamily: "Outfit_400Regular", fontSize: 10, color: C.textMuted, textAlign: "center" },
  row: { flexDirection: "row", gap: 12 },
  sectionDivider: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 16 },
  sectionLabel: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.text },
  tagsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tagChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  tagChipActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  tagChipText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  tagChipTextActive: { color: C.primary },
});
