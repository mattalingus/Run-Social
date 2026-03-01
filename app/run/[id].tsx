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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/query-client";
import C from "@/constants/colors";

const RUN_TAG_ICONS: Record<string, string> = {
  Talkative: "message-circle",
  Quiet: "moon",
  Motivational: "zap",
  Training: "activity",
  Ministry: "heart",
  Recovery: "wind",
};

function formatPace(pace: number) {
  const mins = Math.floor(pace);
  const secs = Math.round((pace - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDateFull(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function RunDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user, refreshUser } = useAuth();
  const qc = useQueryClient();
  const [joining, setJoining] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const { data: run, isLoading } = useQuery<any>({
    queryKey: ["/api/runs", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}`);
      return res.json();
    },
  });

  const { data: participants = [] } = useQuery<any[]>({
    queryKey: ["/api/runs", id, "participants"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}/participants`);
      return res.json();
    },
    enabled: !!id,
  });

  const { data: myRating } = useQuery<any>({
    queryKey: ["/api/runs", id, "my-rating"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}/my-rating`);
      return res.json();
    },
    enabled: !!user && !!id,
  });

  const isHost = run?.host_id === user?.id;
  const isParticipant = participants.some((p) => p.id === user?.id);
  const myParticipation = participants.find((p) => p.id === user?.id);
  const isPastRun = run ? new Date(run.date) < new Date() : false;
  const canRate = isPastRun && isParticipant && !isHost && !myRating;
  const hasConfirmed = myParticipation?.status === "confirmed";

  async function handleJoin() {
    if (!user) return router.push("/(auth)/login");
    setJoining(true);
    try {
      await apiRequest("POST", `/api/runs/${id}/join`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["/api/runs", id, "participants"] });
      qc.invalidateQueries({ queryKey: ["/api/runs"] });
      Alert.alert("Joined!", "You're registered for this run.");
    } catch (e: any) {
      Alert.alert("Can't Join", e.message || "Unable to join run");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setJoining(false);
    }
  }

  async function handleLeave() {
    Alert.alert("Leave Run", "Are you sure you want to leave this run?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: async () => {
          await apiRequest("POST", `/api/runs/${id}/leave`);
          qc.invalidateQueries({ queryKey: ["/api/runs", id, "participants"] });
          qc.invalidateQueries({ queryKey: ["/api/runs"] });
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        },
      },
    ]);
  }

  async function handleConfirmComplete() {
    Alert.prompt(
      "Log Miles",
      "How many miles did you run?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: async (miles) => {
            setConfirming(true);
            try {
              await apiRequest("POST", `/api/runs/${id}/complete`, { milesLogged: parseFloat(miles || "3") });
              await refreshUser();
              qc.invalidateQueries({ queryKey: ["/api/runs/mine"] });
              qc.invalidateQueries({ queryKey: ["/api/users/me/achievements"] });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert("Great job!", "Run logged successfully. Check your achievements!");
            } catch (e: any) {
              Alert.alert("Error", e.message);
            } finally {
              setConfirming(false);
            }
          },
        },
      ],
      "plain-text",
      run?.min_distance?.toString() || "3"
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  if (!run) {
    return (
      <View style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <Text style={styles.errorText}>Run not found</Text>
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <Text style={styles.backLinkText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="x" size={20} color={C.text} />
          </Pressable>
          <View style={[styles.privacyBadge, { backgroundColor: run.privacy === "public" ? C.primaryMuted : C.border }]}>
            <Feather name={run.privacy === "public" ? "globe" : run.privacy === "private" ? "lock" : "user"} size={12} color={run.privacy === "public" ? C.primary : C.textSecondary} />
            <Text style={[styles.privacyText, { color: run.privacy === "public" ? C.primary : C.textSecondary }]}>
              {run.privacy.charAt(0).toUpperCase() + run.privacy.slice(1)}
            </Text>
          </View>
        </View>

        <Text style={styles.title}>{run.title}</Text>

        <View style={styles.hostCard}>
          <View style={styles.hostAvatar}>
            <Text style={styles.hostAvatarText}>{run.host_name?.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.hostInfo}>
            <Text style={styles.hostName}>{run.host_name}</Text>
            {run.host_rating > 0 && (
              <View style={styles.ratingRow}>
                <Ionicons name="star" size={12} color={C.gold} />
                <Text style={styles.ratingText}>{parseFloat(run.host_rating).toFixed(1)} rating</Text>
              </View>
            )}
          </View>
          {isHost && (
            <View style={styles.yourRunBadge}>
              <Text style={styles.yourRunText}>Your Run</Text>
            </View>
          )}
        </View>

        <View style={styles.infoGrid}>
          <View style={styles.infoCard}>
            <Feather name="calendar" size={18} color={C.primary} />
            <View>
              <Text style={styles.infoValue}>{formatDateFull(run.date)}</Text>
              <Text style={styles.infoLabel}>at {formatTime(run.date)}</Text>
            </View>
          </View>
          <View style={styles.infoCard}>
            <Feather name="map-pin" size={18} color={C.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.infoValue} numberOfLines={2}>{run.location_name}</Text>
            </View>
          </View>
        </View>

        <View style={styles.requirementsCard}>
          <Text style={styles.requirementsTitle}>Requirements</Text>
          <View style={styles.requirementsGrid}>
            <View style={styles.reqItem}>
              <Ionicons name="walk" size={20} color={C.orange} />
              <Text style={styles.reqValue}>{formatPace(run.min_pace)} – {formatPace(run.max_pace)}</Text>
              <Text style={styles.reqLabel}>Pace (min/mi)</Text>
            </View>
            <View style={styles.reqDivider} />
            <View style={styles.reqItem}>
              <Feather name="target" size={20} color={C.blue} />
              <Text style={styles.reqValue}>{run.min_distance} – {run.max_distance}</Text>
              <Text style={styles.reqLabel}>Distance (mi)</Text>
            </View>
            <View style={styles.reqDivider} />
            <View style={styles.reqItem}>
              <Ionicons name="people" size={20} color={C.textSecondary} />
              <Text style={styles.reqValue}>{run.participant_count}/{run.max_participants}</Text>
              <Text style={styles.reqLabel}>Participants</Text>
            </View>
          </View>
          {user && (
            <View style={[styles.eligibilityRow, {
              backgroundColor: (user.avg_pace >= run.min_pace && user.avg_pace <= run.max_pace && user.avg_distance >= run.min_distance) ? C.primaryMuted : C.danger + "22",
              borderColor: (user.avg_pace >= run.min_pace && user.avg_pace <= run.max_pace && user.avg_distance >= run.min_distance) ? C.primary + "44" : C.danger + "44",
            }]}>
              <Feather
                name={(user.avg_pace >= run.min_pace && user.avg_pace <= run.max_pace && user.avg_distance >= run.min_distance) ? "check-circle" : "alert-circle"}
                size={14}
                color={(user.avg_pace >= run.min_pace && user.avg_pace <= run.max_pace && user.avg_distance >= run.min_distance) ? C.primary : C.danger}
              />
              <Text style={[styles.eligibilityText, {
                color: (user.avg_pace >= run.min_pace && user.avg_pace <= run.max_pace && user.avg_distance >= run.min_distance) ? C.primary : C.danger,
              }]}>
                {(user.avg_pace >= run.min_pace && user.avg_pace <= run.max_pace && user.avg_distance >= run.min_distance)
                  ? "You meet the requirements"
                  : `Your pace (${formatPace(user.avg_pace)}/mi) or distance (${user.avg_distance} mi) doesn't match`}
              </Text>
            </View>
          )}
        </View>

        {run.description ? (
          <View style={styles.descCard}>
            <Text style={styles.descTitle}>About this run</Text>
            <Text style={styles.descText}>{run.description}</Text>
          </View>
        ) : null}

        {run.tags?.length > 0 && (
          <View style={styles.tagsSection}>
            <Text style={styles.sectionTitle}>Run Style</Text>
            <View style={styles.tagsGrid}>
              {run.tags.map((tag: string) => (
                <View key={tag} style={styles.tagChip}>
                  <Feather name={RUN_TAG_ICONS[tag] as any || "tag"} size={13} color={C.primary} />
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {participants.length > 0 && (
          <View style={styles.participantsSection}>
            <Text style={styles.sectionTitle}>Participants ({run.participant_count})</Text>
            <View style={styles.participantsList}>
              {participants.slice(0, 8).map((p: any) => (
                <View key={p.id} style={styles.participantItem}>
                  <View style={styles.participantAvatar}>
                    <Text style={styles.participantAvatarText}>{p.name?.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={styles.participantInfo}>
                    <Text style={styles.participantName}>{p.name}</Text>
                    <Text style={styles.participantPace}>{formatPace(p.avg_pace)}/mi · {p.avg_distance} mi avg</Text>
                  </View>
                  <View style={[styles.participantStatus, { backgroundColor: p.status === "confirmed" ? C.primary + "22" : C.border }]}>
                    <Text style={[styles.participantStatusText, { color: p.status === "confirmed" ? C.primary : C.textMuted }]}>
                      {p.status === "confirmed" ? "Done" : "Joined"}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        {!isHost && !isPastRun && !isParticipant && (
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, { opacity: pressed || joining ? 0.85 : 1 }]}
            onPress={handleJoin}
            disabled={joining}
          >
            {joining ? <ActivityIndicator color={C.bg} /> : (
              <>
                <Ionicons name="walk" size={18} color={C.bg} />
                <Text style={styles.primaryBtnText}>Join Run</Text>
              </>
            )}
          </Pressable>
        )}
        {!isHost && !isPastRun && isParticipant && (
          <Pressable
            style={({ pressed }) => [styles.secondaryBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={handleLeave}
          >
            <Text style={styles.secondaryBtnText}>Leave Run</Text>
          </Pressable>
        )}
        {isPastRun && isParticipant && !hasConfirmed && (
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, { opacity: pressed || confirming ? 0.85 : 1 }]}
            onPress={handleConfirmComplete}
            disabled={confirming}
          >
            {confirming ? <ActivityIndicator color={C.bg} /> : (
              <>
                <Feather name="check-circle" size={18} color={C.bg} />
                <Text style={styles.primaryBtnText}>Log Completion</Text>
              </>
            )}
          </Pressable>
        )}
        {canRate && !myRating && (
          <Pressable
            style={({ pressed }) => [styles.rateBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => router.push(`/rate/${id}`)}
          >
            <Ionicons name="star-outline" size={18} color={C.gold} />
            <Text style={styles.rateBtnText}>Rate Host</Text>
          </Pressable>
        )}
        {myRating && (
          <View style={styles.ratedBanner}>
            <Ionicons name="star" size={14} color={C.gold} />
            <Text style={styles.ratedText}>You rated this host {myRating.stars}/5</Text>
          </View>
        )}
        {isParticipant && !isPastRun && (
          <View style={styles.joinedBanner}>
            <Feather name="check" size={14} color={C.primary} />
            <Text style={styles.joinedText}>You're registered for this run</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 20 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  privacyBadge: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: "transparent" },
  privacyText: { fontFamily: "Outfit_600SemiBold", fontSize: 12 },
  title: { fontFamily: "Outfit_700Bold", fontSize: 26, color: C.text, marginBottom: 16, lineHeight: 32 },
  hostCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border, marginBottom: 16 },
  hostAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primaryMuted, borderWidth: 1, borderColor: C.primary + "44", alignItems: "center", justifyContent: "center" },
  hostAvatarText: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.primary },
  hostInfo: { flex: 1, gap: 2 },
  hostName: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.text },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  yourRunBadge: { backgroundColor: C.primaryMuted, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: C.primary + "44" },
  yourRunText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.primary },
  infoGrid: { gap: 10, marginBottom: 16 },
  infoCard: { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border },
  infoValue: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  infoLabel: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  requirementsCard: { backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border, marginBottom: 16, gap: 14 },
  requirementsTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },
  requirementsGrid: { flexDirection: "row", alignItems: "center" },
  reqItem: { flex: 1, alignItems: "center", gap: 4 },
  reqDivider: { width: 1, height: 40, backgroundColor: C.border },
  reqValue: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.text, textAlign: "center" },
  reqLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textSecondary, textAlign: "center" },
  eligibilityRow: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, padding: 10, borderWidth: 1 },
  eligibilityText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, flex: 1 },
  descCard: { backgroundColor: C.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border, marginBottom: 16, gap: 8 },
  descTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.text },
  descText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, lineHeight: 20 },
  tagsSection: { gap: 10, marginBottom: 16 },
  sectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },
  tagsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tagChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.primaryMuted, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: C.primary + "33" },
  tagText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },
  participantsSection: { gap: 10, marginBottom: 16 },
  participantsList: { gap: 8 },
  participantItem: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border },
  participantAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  participantAvatarText: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.textSecondary },
  participantInfo: { flex: 1, gap: 2 },
  participantName: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  participantPace: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  participantStatus: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  participantStatusText: { fontFamily: "Outfit_600SemiBold", fontSize: 11 },
  bottomBar: { padding: 20, paddingTop: 12, gap: 10, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg },
  primaryBtn: { backgroundColor: C.primary, borderRadius: 14, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.bg },
  secondaryBtn: { borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.danger + "66" },
  secondaryBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.danger },
  rateBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, height: 52, backgroundColor: C.gold + "22", borderWidth: 1, borderColor: C.gold + "44" },
  rateBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.gold },
  ratedBanner: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", padding: 12 },
  ratedText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  joinedBanner: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", padding: 8 },
  joinedText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },
  errorText: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text },
  backLink: { marginTop: 16 },
  backLinkText: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.primary },
});
