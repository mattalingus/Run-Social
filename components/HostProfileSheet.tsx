import React, { useMemo, useState } from "react";
import { formatDistance } from "@/lib/formatDistance";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Image,
  ActivityIndicator,
  ScrollView,
  Platform,
  TouchableOpacity,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { useTheme } from "@/contexts/ThemeContext";
import { type ColorScheme } from "@/constants/colors";
import { ACHIEVEMENTS } from "@/constants/achievements";

interface Props {
  hostId: string | null;
  onClose: () => void;
}

function getHostBadge(hosted: number): { label: string; color: string } | null {
  if (hosted < 1) return null;
  if (hosted === 1) return { label: "1st Run", color: "#A0C4FF" };
  if (hosted < 5) return { label: "Bronze", color: "#CD7F32" };
  if (hosted < 20) return { label: "Silver", color: "#9E9E9E" };
  if (hosted < 100) return { label: "Gold", color: "#FFD700" };
  if (hosted < 500) return { label: "Platinum", color: "#B0E0E6" };
  return { label: "Elite", color: "#C084FC" };
}

function formatPace(p: number) {
  if (!p || p <= 0) return "—";
  const mins = Math.floor(p);
  const secs = Math.round((p - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")}/mi`;
}

function formatDate(d: string) {
  const dt = new Date(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTime(d: string) {
  const dt = new Date(d);
  return dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function HostProfileSheet({ hostId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const [activityTab, setActivityTab] = useState<"run" | "ride" | "walk">("run");

  const { data: profile, isLoading: profileLoading } = useQuery<any>({
    queryKey: [`/api/users/${hostId}/profile`],
    enabled: !!hostId,
  });

  const { data: friendship, isLoading: friendshipLoading } = useQuery<any>({
    queryKey: [`/api/users/${hostId}/friendship`],
    enabled: !!hostId,
  });

  const { data: starredRuns } = useQuery<any[]>({
    queryKey: [`/api/users/${hostId}/starred-runs`],
    enabled: !!hostId,
  });

  const { data: actStats } = useQuery<{ total_miles: number; count: number; avg_pace: number }>({
    queryKey: [`/api/users/${hostId}/stats?activityType=${activityTab}`],
    queryFn: async () => {
      const url = new URL(`/api/users/${hostId}/stats?activityType=${activityTab}`, getApiUrl());
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    enabled: !!hostId,
  });

  const addFriendMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/friends/request", { userId: hostId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/users/${hostId}/friendship`] });
      qc.invalidateQueries({ queryKey: ["/api/friends"] });
    },
  });

  const cancelMut = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/friends/${friendship?.friendshipId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/users/${hostId}/friendship`] });
      qc.invalidateQueries({ queryKey: ["/api/friends"] });
    },
  });

  const loading = profileLoading || friendshipLoading;
  const earnedSet = new Set<string>(profile?.earned_slugs ?? []);
  const earnedAchievements = ACHIEVEMENTS.filter((a) => earnedSet.has(a.slug));
  const badge = profile ? getHostBadge(profile.hosted_runs) : null;
  const friendStatus = friendship?.status ?? "none";

  const webPaddingTop = Platform.OS === "web" ? 67 : 0;
  const webPaddingBottom = Platform.OS === "web" ? 34 : 0;

  return (
    <Modal
      visible={!!hostId}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={s.backdrop} onPress={onClose} />
      <View
        style={[
          s.sheet,
          {
            paddingBottom: insets.bottom + 24 + webPaddingBottom,
            paddingTop: webPaddingTop,
          },
        ]}
      >
        <View style={s.handle} />

        {loading ? (
          <View style={s.loadingBox}>
            <ActivityIndicator color={C.primary} />
          </View>
        ) : profile ? (
          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            <View style={s.header}>
              {profile.photo_url ? (
                <Image source={{ uri: profile.photo_url }} style={s.avatar} />
              ) : (
                <View style={s.avatarFallback}>
                  <Text style={s.avatarLetter}>
                    {profile.name?.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.name}>{profile.name}</Text>
                <View style={s.badgeRow}>
                  {badge && (
                    <View style={[s.badgePill, { borderColor: badge.color + "44" }]}>
                      <Text style={[s.badgeText, { color: badge.color }]}>
                        {badge.label} Host
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {friendStatus !== "self" && (
                <View>
                  {friendStatus === "friends" ? (
                    <View style={[s.friendBtn, s.friendBtnDone]}>
                      <Feather name="check" size={14} color={C.primary} />
                      <Text style={[s.friendBtnTxt, { color: C.primary }]}>Friends</Text>
                    </View>
                  ) : friendStatus === "pending_sent" ? (
                    <Pressable
                      style={[s.friendBtn, s.friendBtnPending]}
                      onPress={() => cancelMut.mutate()}
                      disabled={cancelMut.isPending}
                    >
                      <Feather name="clock" size={14} color={C.textSecondary} />
                      <Text style={[s.friendBtnTxt, { color: C.textSecondary }]}>Pending</Text>
                    </Pressable>
                  ) : friendStatus === "pending_received" ? (
                    <Pressable
                      style={[s.friendBtn, s.friendBtnAdd]}
                      onPress={() => apiRequest("PUT", `/api/friends/${friendship?.friendshipId}/accept`).then(() => {
                        qc.invalidateQueries({ queryKey: [`/api/users/${hostId}/friendship`] });
                        qc.invalidateQueries({ queryKey: ["/api/friends"] });
                      })}
                    >
                      <Feather name="user-check" size={14} color="#080F0C" />
                      <Text style={[s.friendBtnTxt, { color: "#080F0C" }]}>Accept</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={[s.friendBtn, s.friendBtnAdd]}
                      onPress={() => addFriendMut.mutate()}
                      disabled={addFriendMut.isPending}
                    >
                      <Feather name="user-plus" size={14} color="#080F0C" />
                      <Text style={[s.friendBtnTxt, { color: "#080F0C" }]}>Add Friend</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>

            {/* Static summary stats */}
            <View style={s.statsRow}>
              <View style={s.statBox}>
                <Text style={s.statVal}>{profile.hosted_runs}</Text>
                <Text style={s.statLabel}>Hosted</Text>
              </View>
              <View style={s.statDivider} />
              <View style={s.statBox}>
                <Text style={s.statVal}>{profile.friends_count}</Text>
                <Text style={s.statLabel}>Friends</Text>
              </View>
              <View style={s.statDivider} />
              <View style={s.statBox}>
                <Text style={s.statVal}>
                  {actStats?.total_miles != null ? `${actStats.total_miles.toFixed(1)}` : "—"}
                </Text>
                <Text style={s.statLabel}>Miles</Text>
              </View>
              <View style={s.statDivider} />
              <View style={s.statBox}>
                <Text style={s.statVal}>{actStats?.count ?? "—"}</Text>
                <Text style={s.statLabel}>Activities</Text>
              </View>
            </View>

            {/* Activity toggle */}
            <View style={s.toggleRow}>
              {(["run", "ride", "walk"] as const).map((tab) => (
                <TouchableOpacity
                  key={tab}
                  style={[s.toggleBtn, activityTab === tab && s.toggleBtnActive]}
                  onPress={() => setActivityTab(tab)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={tab === "ride" ? "bicycle" : tab === "walk" ? "footsteps" : "walk"}
                    size={13}
                    color={activityTab === tab ? C.bg : C.textMuted}
                  />
                  <Text style={[s.toggleTxt, activityTab === tab && s.toggleTxtActive]}>
                    {tab === "run" ? "Runs" : tab === "ride" ? "Rides" : "Walks"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Per-activity stats */}
            <View style={s.actStatsRow}>
              <View style={s.actStatBox}>
                <Text style={s.actStatVal}>{formatPace(actStats?.avg_pace ?? 0)}</Text>
                <Text style={s.actStatLabel}>Avg Pace</Text>
              </View>
              <View style={s.statDivider} />
              <View style={s.actStatBox}>
                <Text style={s.actStatVal}>
                  {actStats?.total_miles != null ? `${actStats.total_miles.toFixed(1)} mi` : "—"}
                </Text>
                <Text style={s.actStatLabel}>Total Miles</Text>
              </View>
              <View style={s.statDivider} />
              <View style={s.actStatBox}>
                <Text style={s.actStatVal}>{actStats?.count ?? "—"}</Text>
                <Text style={s.actStatLabel}>{activityTab === "ride" ? "Rides" : activityTab === "walk" ? "Walks" : "Runs"}</Text>
              </View>
            </View>

            {earnedAchievements.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>
                  Achievements · {earnedAchievements.length}
                </Text>
                <View style={s.achieveGrid}>
                  {earnedAchievements.map((a) => (
                    <View key={a.slug} style={s.achieveChip}>
                      <Ionicons name={a.icon as any} size={14} color={a.iconColor} />
                      <Text style={s.achieveName}>{a.name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {earnedAchievements.length === 0 && (
              <View style={s.section}>
                <Text style={[s.sectionTitle, { color: C.textMuted }]}>
                  No achievements yet
                </Text>
              </View>
            )}

            {starredRuns && starredRuns.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Starred Events · {starredRuns.length}</Text>
                {starredRuns.map((r) => (
                  <View key={r.id} style={s.starredCard}>
                    <View style={s.starredLeft}>
                      <Feather
                        name={r.activity_type === "ride" ? "zap" : "activity"}
                        size={14}
                        color={C.primary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.starredTitle} numberOfLines={1}>{r.title}</Text>
                      <Text style={s.starredMeta}>
                        {r.distance_miles ? `${formatDistance(parseFloat(r.distance_miles))} mi · ` : ""}
                        {formatDate(r.date)} · {formatTime(r.date)}
                      </Text>
                    </View>
                    <Ionicons name="star" size={13} color={C.gold} style={{ marginTop: 2 }} />
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        ) : (
          <View style={s.loadingBox}>
            <Text style={{ color: C.textMuted }}>Could not load profile.</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

function makeStyles(C: ColorScheme) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.55)",
    },
    sheet: {
      backgroundColor: C.card,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingHorizontal: 20,
      paddingTop: 12,
      maxHeight: "85%",
    },
    handle: {
      width: 38,
      height: 4,
      borderRadius: 2,
      backgroundColor: C.border,
      alignSelf: "center",
      marginBottom: 20,
    },
    loadingBox: {
      height: 120,
      alignItems: "center",
      justifyContent: "center",
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      marginBottom: 20,
    },
    avatar: {
      width: 64,
      height: 64,
      borderRadius: 32,
      borderWidth: 2,
      borderColor: C.primary + "44",
    },
    avatarFallback: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: C.surface,
      borderWidth: 2,
      borderColor: C.primary + "44",
      alignItems: "center",
      justifyContent: "center",
    },
    avatarLetter: {
      fontFamily: "Outfit_700Bold",
      fontSize: 26,
      color: C.primary,
    },
    name: {
      fontFamily: "Outfit_700Bold",
      fontSize: 18,
      color: C.text,
      marginBottom: 6,
    },
    badgeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap",
    },
    badgePill: {
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    badgeText: {
      fontFamily: "Outfit_600SemiBold",
      fontSize: 11,
    },
    starredCard: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      backgroundColor: C.surface,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: C.border,
      marginBottom: 8,
    },
    starredLeft: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: C.primary + "18",
      alignItems: "center",
      justifyContent: "center",
      marginTop: 1,
    },
    starredTitle: {
      fontFamily: "Outfit_600SemiBold",
      fontSize: 13,
      color: C.text,
      marginBottom: 2,
    },
    starredMeta: {
      fontFamily: "Outfit_400Regular",
      fontSize: 11,
      color: C.textMuted,
    },
    friendBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
    },
    friendBtnAdd: {
      backgroundColor: C.primary,
      borderColor: C.primary,
    },
    friendBtnPending: {
      backgroundColor: "transparent",
      borderColor: C.border,
    },
    friendBtnDone: {
      backgroundColor: "transparent",
      borderColor: C.primary + "44",
    },
    friendBtnTxt: {
      fontFamily: "Outfit_600SemiBold",
      fontSize: 13,
    },
    statsRow: {
      flexDirection: "row",
      backgroundColor: C.surface,
      borderRadius: 14,
      paddingVertical: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: C.border,
    },
    statBox: {
      flex: 1,
      alignItems: "center",
      gap: 4,
    },
    statDivider: {
      width: 1,
      backgroundColor: C.border,
      marginVertical: 4,
    },
    statVal: {
      fontFamily: "Outfit_700Bold",
      fontSize: 15,
      color: C.text,
    },
    statLabel: {
      fontFamily: "Outfit_400Regular",
      fontSize: 11,
      color: C.textMuted,
    },
    toggleRow: {
      flexDirection: "row",
      backgroundColor: C.surface,
      borderRadius: 10,
      padding: 3,
      gap: 3,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: C.border,
    },
    toggleBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      paddingVertical: 8,
      borderRadius: 8,
    },
    toggleBtnActive: {
      backgroundColor: C.primary,
    },
    toggleTxt: {
      fontFamily: "Outfit_600SemiBold",
      fontSize: 12,
      color: C.textMuted,
    },
    toggleTxtActive: {
      color: C.bg,
    },
    actStatsRow: {
      flexDirection: "row",
      backgroundColor: C.surface,
      borderRadius: 14,
      paddingVertical: 14,
      marginBottom: 20,
      borderWidth: 1,
      borderColor: C.border,
    },
    actStatBox: {
      flex: 1,
      alignItems: "center",
      gap: 3,
    },
    actStatVal: {
      fontFamily: "Outfit_700Bold",
      fontSize: 14,
      color: C.primary,
    },
    actStatLabel: {
      fontFamily: "Outfit_400Regular",
      fontSize: 11,
      color: C.textMuted,
    },
    section: {
      marginBottom: 20,
    },
    sectionTitle: {
      fontFamily: "Outfit_600SemiBold",
      fontSize: 13,
      color: C.textSecondary,
      marginBottom: 12,
      letterSpacing: 0.4,
      textTransform: "uppercase",
    },
    achieveGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    achieveChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: C.surface,
      borderRadius: 20,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: C.border,
    },
    achieveName: {
      fontFamily: "Outfit_600SemiBold",
      fontSize: 12,
      color: C.textSecondary,
    },
  });
}
