import React from "react";
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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import C from "@/constants/colors";
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

export default function HostProfileSheet({ hostId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const { data: profile, isLoading: profileLoading } = useQuery<any>({
    queryKey: [`/api/users/${hostId}/profile`],
    enabled: !!hostId,
  });

  const { data: friendship, isLoading: friendshipLoading } = useQuery<any>({
    queryKey: [`/api/users/${hostId}/friendship`],
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
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          {
            paddingBottom: insets.bottom + 24 + webPaddingBottom,
            paddingTop: webPaddingTop,
          },
        ]}
      >
        <View style={styles.handle} />

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={C.primary} />
          </View>
        ) : profile ? (
          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            <View style={styles.header}>
              {profile.photo_url ? (
                <Image source={{ uri: profile.photo_url }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarLetter}>
                    {profile.name?.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{profile.name}</Text>
                <View style={styles.badgeRow}>
                  {badge && (
                    <View style={[styles.badgePill, { borderColor: badge.color + "44" }]}>
                      <Text style={[styles.badgeText, { color: badge.color }]}>
                        {badge.label} Host
                      </Text>
                    </View>
                  )}
                  {profile.avg_rating > 0 && (
                    <View style={styles.ratingRow}>
                      <Ionicons name="star" size={12} color={C.gold ?? "#FFD700"} />
                      <Text style={styles.ratingText}>
                        {profile.avg_rating.toFixed(1)}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {friendStatus !== "self" && (
                <View>
                  {friendStatus === "friends" ? (
                    <View style={[styles.friendBtn, styles.friendBtnDone]}>
                      <Feather name="check" size={14} color={C.primary} />
                      <Text style={[styles.friendBtnTxt, { color: C.primary }]}>Friends</Text>
                    </View>
                  ) : friendStatus === "pending_sent" ? (
                    <Pressable
                      style={[styles.friendBtn, styles.friendBtnPending]}
                      onPress={() => cancelMut.mutate()}
                      disabled={cancelMut.isPending}
                    >
                      <Feather name="clock" size={14} color={C.textSecondary} />
                      <Text style={[styles.friendBtnTxt, { color: C.textSecondary }]}>Pending</Text>
                    </Pressable>
                  ) : friendStatus === "pending_received" ? (
                    <Pressable
                      style={[styles.friendBtn, styles.friendBtnAdd]}
                      onPress={() => apiRequest("PUT", `/api/friends/${friendship?.friendshipId}/accept`).then(() => {
                        qc.invalidateQueries({ queryKey: [`/api/users/${hostId}/friendship`] });
                        qc.invalidateQueries({ queryKey: ["/api/friends"] });
                      })}
                    >
                      <Feather name="user-check" size={14} color="#080F0C" />
                      <Text style={[styles.friendBtnTxt, { color: "#080F0C" }]}>Accept</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={[styles.friendBtn, styles.friendBtnAdd]}
                      onPress={() => addFriendMut.mutate()}
                      disabled={addFriendMut.isPending}
                    >
                      <Feather name="user-plus" size={14} color="#080F0C" />
                      <Text style={[styles.friendBtnTxt, { color: "#080F0C" }]}>Add Friend</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statVal}>{formatPace(profile.avg_pace)}</Text>
                <Text style={styles.statLabel}>Avg Pace</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statBox}>
                <Text style={styles.statVal}>
                  {profile.avg_distance ? `${profile.avg_distance.toFixed(1)} mi` : "—"}
                </Text>
                <Text style={styles.statLabel}>Avg Distance</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statBox}>
                <Text style={styles.statVal}>{profile.hosted_runs}</Text>
                <Text style={styles.statLabel}>Runs Hosted</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statBox}>
                <Text style={styles.statVal}>{profile.friends_count}</Text>
                <Text style={styles.statLabel}>Friends</Text>
              </View>
            </View>

            {earnedAchievements.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  Achievements · {earnedAchievements.length}
                </Text>
                <View style={styles.achieveGrid}>
                  {earnedAchievements.map((a) => (
                    <View key={a.slug} style={styles.achieveChip}>
                      <Text style={styles.achieveIcon}>{a.icon}</Text>
                      <Text style={styles.achieveName}>{a.name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {earnedAchievements.length === 0 && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: C.textMuted }]}>
                  No achievements yet
                </Text>
              </View>
            )}
          </ScrollView>
        ) : (
          <View style={styles.loadingBox}>
            <Text style={{ color: C.textMuted }}>Could not load profile.</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    backgroundColor: "#111A15",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: "80%",
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#2A3D30",
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
    borderColor: "#00D97E44",
  },
  avatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#1A2E21",
    borderWidth: 2,
    borderColor: "#00D97E44",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: {
    fontFamily: "Outfit_700Bold",
    fontSize: 26,
    color: "#00D97E",
  },
  name: {
    fontFamily: "Outfit_700Bold",
    fontSize: 18,
    color: "#E8F5EE",
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
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  ratingText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: "#FFD700",
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
    backgroundColor: "#00D97E",
    borderColor: "#00D97E",
  },
  friendBtnPending: {
    backgroundColor: "transparent",
    borderColor: "#2A3D30",
  },
  friendBtnDone: {
    backgroundColor: "transparent",
    borderColor: "#00D97E44",
  },
  friendBtnTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
  },
  statsRow: {
    flexDirection: "row",
    backgroundColor: "#1A2E21",
    borderRadius: 14,
    paddingVertical: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#2A3D30",
  },
  statBox: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: "#2A3D30",
    marginVertical: 4,
  },
  statVal: {
    fontFamily: "Outfit_700Bold",
    fontSize: 15,
    color: "#E8F5EE",
  },
  statLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: "#5A8A70",
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: "#5A8A70",
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
    backgroundColor: "#1A2E21",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#2A3D30",
  },
  achieveIcon: {
    fontSize: 14,
  },
  achieveName: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: "#C2DAC8",
  },
});
