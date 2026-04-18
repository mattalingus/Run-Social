import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Platform,
  Alert,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, router } from "expo-router";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { useTheme } from "@/contexts/ThemeContext";
import { type ColorScheme } from "@/constants/colors";
import { useAuth } from "@/contexts/AuthContext";
import { ACHIEVEMENTS } from "@/constants/achievements";
import * as Haptics from "expo-haptics";

function resolveImgUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return new URL(url, getApiUrl()).toString();
}

function formatPace(p: number) {
  if (!p || p <= 0) return "—";
  let mins = Math.floor(p);
  let secs = Math.round((p - mins) * 60);
  if (secs === 60) { secs = 0; mins += 1; }
  return `${mins}:${secs.toString().padStart(2, "0")}/mi`;
}

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { C } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(C), [C]);
  const { user: authUser } = useAuth();
  const qc = useQueryClient();
  const [photoError, setPhotoError] = useState(false);
  const [showAllAchievements, setShowAllAchievements] = useState(false);

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  const { data: profile, isLoading } = useQuery<{
    id: string;
    name: string;
    photo_url?: string;
    avg_pace?: number;
    total_miles?: number;
    completed_runs?: number;
    hosted_runs?: number;
    friends_count?: number;
  }>({
    queryKey: ["/api/users", id, "profile"],
    enabled: !!id,
  });

  const { data: friendship } = useQuery<{
    status: string;
    friendshipId: string | null;
  }>({
    queryKey: ["/api/users", id, "friendship"],
    enabled: !!id && id !== authUser?.id,
    staleTime: 10000,
  });

  const { data: starredRuns } = useQuery<any[]>({
    queryKey: ["/api/users", id, "starred-runs"],
    enabled: !!id,
  });

  const { data: achievementData } = useQuery<{ earned_slugs: string[] }>({
    queryKey: ["/api/users", id, "achievements"],
    enabled: !!id,
  });

  const { data: blockStatus } = useQuery<{ amBlocking: boolean; amBlockedBy: boolean }>({
    queryKey: ["/api/users", id, "block-status"],
    enabled: !!id && id !== authUser?.id,
    staleTime: 10000,
  });

  const friendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/friends/request", { userId: id });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/users", id, "friendship"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Alert.alert("Error", "Could not send friend request"),
  });

  const blockMutation = useMutation({
    mutationFn: async (blocking: boolean) => {
      if (blocking) {
        await apiRequest("POST", `/api/users/${id}/block`);
      } else {
        await apiRequest("DELETE", `/api/users/${id}/block`);
      }
    },
    onSuccess: (_, blocking) => {
      qc.invalidateQueries({ queryKey: ["/api/users", id, "block-status"] });
      qc.invalidateQueries({ queryKey: ["/api/users", id, "friendship"] });
      // Refresh feed and search so blocked/unblocked users appear/disappear correctly
      qc.invalidateQueries({ queryKey: ["/api/runs"] });
      qc.invalidateQueries({ queryKey: ["/api/users/search"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (blocking) {
        Alert.alert("Blocked", `You've blocked this user. They can no longer view your profile or interact with you.`);
      }
    },
    onError: () => Alert.alert("Error", "Could not update block status"),
  });

  const reportMutation = useMutation({
    mutationFn: async (reason: string) => {
      const res = await apiRequest("POST", "/api/reports", { targetType: "user", targetId: id, reason });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? "Could not submit report");
      }
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Report Submitted", "Thanks for letting us know. Our team will review this report.");
    },
    onError: (e: any) => Alert.alert("Error", e.message ?? "Could not submit report"),
  });

  function handleReportPress() {
    const reasons = ["Spam or fake account", "Harassment or bullying", "Inappropriate content", "Impersonation", "Other"];
    Alert.alert("Report User", "Why are you reporting this account?", [
      ...reasons.map((r) => ({ text: r, onPress: () => reportMutation.mutate(r) })),
      { text: "Cancel", style: "cancel" },
    ]);
  }

  function handleBlockPress() {
    if (blockStatus?.amBlocking) {
      Alert.alert("Unblock User", "Allow this user to see your profile and interact with you again?", [
        { text: "Cancel", style: "cancel" },
        { text: "Unblock", onPress: () => blockMutation.mutate(false) },
      ]);
    } else {
      Alert.alert("Block User", "This user won't be able to see your profile, and any existing friendship will be removed.", [
        { text: "Cancel", style: "cancel" },
        { text: "Block", style: "destructive", onPress: () => blockMutation.mutate(true) },
      ]);
    }
  }

  const isMe = id === authUser?.id;
  const fStatus = friendship?.status;

  function friendBtnLabel() {
    if (fStatus === "accepted") return "Friends";
    if (fStatus === "pending") return "Request Sent";
    return "Add Friend";
  }

  function friendBtnIcon(): keyof typeof Ionicons.glyphMap {
    if (fStatus === "accepted") return "people-outline";
    if (fStatus === "pending") return "time-outline";
    return "person-add-outline";
  }

  const earned = achievementData?.earned_slugs ?? [];

  return (
    <View style={[s.container, { paddingTop: topInset }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </Pressable>
        <Text style={s.headerTitle}>Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.scrollContent}>
        {isLoading ? (
          <ActivityIndicator color={C.primary} style={{ marginTop: 60 }} />
        ) : profile ? (
          <>
            <View style={s.avatarWrap}>
              {resolveImgUrl(profile.photo_url) && !photoError ? (
                <ExpoImage
                  source={{ uri: resolveImgUrl(profile.photo_url)! }}
                  style={s.avatar}
                  onError={() => setPhotoError(true)}
                />
              ) : (
                <View style={[s.avatar, s.avatarFallback]}>
                  <Text style={s.avatarLetter}>{profile.name?.[0]?.toUpperCase()}</Text>
                </View>
              )}
            </View>
            <Text style={s.name}>{profile.name}</Text>

            <View style={s.statsRow}>
              {[
                { label: "Miles", value: (profile.total_miles ?? 0).toFixed(1) },
                { label: "Runs", value: String(profile.completed_runs ?? 0) },
                { label: "Hosted", value: String(profile.hosted_runs ?? 0) },
                { label: "Friends", value: String(profile.friends_count ?? 0) },
              ].map((stat) => (
                <View key={stat.label} style={s.stat}>
                  <Text style={s.statVal}>{stat.value}</Text>
                  <Text style={s.statLbl}>{stat.label}</Text>
                </View>
              ))}
            </View>

            {profile.avg_pace && profile.avg_pace > 0 ? (
              <Text style={s.pace}>{formatPace(profile.avg_pace)} avg pace</Text>
            ) : null}

            {!isMe && (
              <View style={{ alignItems: "center", gap: 10, marginTop: 20, width: "100%" }}>
                <View style={s.actions}>
                  <Pressable
                    style={[
                      s.actionBtn,
                      fStatus === "accepted" && { backgroundColor: C.primaryMuted },
                    ]}
                    disabled={fStatus === "accepted" || fStatus === "pending" || friendMutation.isPending || blockStatus?.amBlocking}
                    onPress={() => friendMutation.mutate()}
                  >
                    <Ionicons name={friendBtnIcon()} size={16} color={fStatus === "accepted" ? C.primary : C.bg} />
                    <Text style={[s.actionBtnTxt, fStatus === "accepted" && { color: C.primary }]}>
                      {friendMutation.isPending ? "Sending…" : friendBtnLabel()}
                    </Text>
                  </Pressable>

                  <Pressable
                    style={s.actionSecondary}
                    onPress={() => {
                      router.push({
                        pathname: "/dm/[friendId]",
                        params: {
                          friendId: id!,
                          friendName: profile.name || "",
                          friendUsername: "",
                          friendPhoto: profile.photo_url || "",
                        },
                      });
                    }}
                  >
                    <Ionicons name="chatbubble-outline" size={16} color={C.primary} />
                    <Text style={s.actionSecondaryTxt}>Message</Text>
                  </Pressable>
                </View>

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Pressable
                    style={s.blockBtn}
                    disabled={blockMutation.isPending}
                    onPress={handleBlockPress}
                  >
                    <Feather
                      name="slash"
                      size={12}
                      color={blockStatus?.amBlocking ? C.textSecondary : "#F87171"}
                    />
                    <Text style={[s.blockBtnTxt, blockStatus?.amBlocking && { color: C.textSecondary }]}>
                      {blockMutation.isPending ? "…" : blockStatus?.amBlocking ? "Unblock" : "Block"}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[s.blockBtn, { borderColor: "#F87171" + "44" }]}
                    disabled={reportMutation.isPending}
                    onPress={handleReportPress}
                  >
                    <Feather name="flag" size={12} color="#F87171" />
                    <Text style={s.blockBtnTxt}>{reportMutation.isPending ? "…" : "Report"}</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {earned.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Achievements</Text>
                <View style={s.badgesRow}>
                  {(showAllAchievements ? earned : earned.slice(0, 6)).map((slug) => {
                    const ach = ACHIEVEMENTS.find((a) => a.slug === slug);
                    if (!ach) return null;
                    return (
                      <View key={slug} style={s.badge}>
                        <Text style={s.badgeEmoji}>{ach.icon}</Text>
                        <Text style={s.badgeLabel} numberOfLines={1}>{ach.name}</Text>
                      </View>
                    );
                  })}
                </View>
                {earned.length > 6 && (
                  <Pressable
                    style={s.showAllBtn}
                    onPress={() => setShowAllAchievements((v) => !v)}
                  >
                    <Text style={s.showAllText}>
                      {showAllAchievements ? "Show Less" : `Show All ${earned.length}`}
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          </>
        ) : (
          <Text style={s.errorText}>User not found</Text>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(C: ColorScheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    backBtn: { width: 40, alignItems: "flex-start" },
    headerTitle: { fontSize: 17, fontFamily: "Outfit_600SemiBold", color: C.text },
    scrollContent: { alignItems: "center", paddingHorizontal: 20, paddingBottom: 40 },
    avatarWrap: { marginTop: 24 },
    avatar: { width: 80, height: 80, borderRadius: 40 },
    avatarFallback: {
      backgroundColor: C.primaryMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarLetter: { fontSize: 28, fontFamily: "Outfit_700Bold", color: C.primary },
    name: { fontSize: 20, fontFamily: "Outfit_700Bold", color: C.text, marginTop: 12 },
    statsRow: {
      flexDirection: "row",
      marginTop: 20,
      gap: 20,
    },
    stat: { alignItems: "center" },
    statVal: { fontSize: 18, fontFamily: "Outfit_700Bold", color: C.text },
    statLbl: { fontSize: 12, fontFamily: "Outfit_400Regular", color: C.textSecondary, marginTop: 2 },
    pace: { fontSize: 14, fontFamily: "Outfit_400Regular", color: C.textSecondary, marginTop: 12 },
    actions: { flexDirection: "row", gap: 10, marginTop: 20 },
    actionBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: C.primary,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 10,
    },
    actionBtnTxt: { fontSize: 14, fontFamily: "Outfit_600SemiBold", color: C.bg },
    actionSecondary: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: C.primaryMuted,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 10,
    },
    actionSecondaryTxt: { fontSize: 14, fontFamily: "Outfit_600SemiBold", color: C.primary },
    section: { width: "100%", marginTop: 28 },
    sectionTitle: { fontSize: 16, fontFamily: "Outfit_600SemiBold", color: C.text, marginBottom: 12 },
    badgesRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    badge: {
      alignItems: "center",
      backgroundColor: C.card,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      width: 72,
    },
    badgeEmoji: { fontSize: 22 },
    badgeLabel: { fontSize: 10, fontFamily: "Outfit_400Regular", color: C.textSecondary, marginTop: 4, textAlign: "center" },
    showAllBtn: { alignSelf: "center", marginTop: 12, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: C.border },
    showAllText: { fontSize: 13, fontFamily: "Outfit_600SemiBold", color: C.primary },
    errorText: { fontSize: 16, fontFamily: "Outfit_400Regular", color: C.textSecondary, marginTop: 60 },
    blockBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    blockBtnTxt: { fontSize: 12, fontFamily: "Outfit_600SemiBold", color: "#F87171" },
  });
}
