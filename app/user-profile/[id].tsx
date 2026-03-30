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
  const mins = Math.floor(p);
  const secs = Math.round((p - mins) * 60);
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
    staleTime: 30000,
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
              <View style={s.actions}>
                <Pressable
                  style={[
                    s.actionBtn,
                    fStatus === "accepted" && { backgroundColor: C.primaryMuted },
                  ]}
                  disabled={fStatus === "accepted" || fStatus === "pending" || friendMutation.isPending}
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
  });
}
