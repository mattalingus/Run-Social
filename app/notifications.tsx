import React, { useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  Pressable,
  Platform,
  ActivityIndicator,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { useTheme } from "@/contexts/ThemeContext";

interface NotifItem {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: any;
  created_at: string;
  from_name?: string;
  from_photo?: string;
  crew_id?: string;
  crew_name?: string;
  emoji?: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function sectionKey(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  if (d >= startOfToday) return "Today";
  if (d >= startOfWeek) return "This Week";
  return "Earlier";
}

const ICON_MAP: Record<string, { name: string; color: string; bg: string }> = {
  friend_request: { name: "user-plus", color: "#4DA6FF", bg: "#4DA6FF22" },
  friend_accepted: { name: "user-check", color: "#00D97E", bg: "#00D97E22" },
  crew_invite: { name: "users", color: "#A78BFA", bg: "#A78BFA22" },
  join_request: { name: "user-plus", color: "#F59E0B", bg: "#F59E0B22" },
  event_reminder: { name: "clock", color: "#3B82F6", bg: "#3B82F622" },
  host_arrived: { name: "map-pin", color: "#00D97E", bg: "#00D97E22" },
  friend_run_posted: { name: "activity", color: "#00D97E", bg: "#00D97E22" },
  pr_notification: { name: "award", color: "#F59E0B", bg: "#F59E0B22" },
};

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { C } = useTheme();
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: notifData, isLoading } = useQuery<{ items: NotifItem[]; lastReadAt: string | null }>({
    queryKey: ["/api/notifications"],
    enabled: !!user,
    refetchInterval: 30000,
  });

  const items = notifData?.items ?? [];
  const lastReadAt = notifData?.lastReadAt ? new Date(notifData.lastReadAt).getTime() : 0;

  const markReadMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/notifications/mark-read", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  useEffect(() => {
    if (items.length > 0) {
      markReadMut.mutate();
    }
  }, [items.length > 0]);

  const acceptFriendMut = useMutation({
    mutationFn: async (friendshipId: string) => {
      await apiRequest("PUT", `/api/friends/${friendshipId}/accept`, {});
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["/api/notifications"] });
      qc.invalidateQueries({ queryKey: ["/api/friends"] });
      qc.invalidateQueries({ queryKey: ["/api/friends/requests"] });
    },
  });

  const declineFriendMut = useMutation({
    mutationFn: async (friendshipId: string) => {
      await apiRequest("DELETE", `/api/friends/${friendshipId}`, {});
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/notifications"] });
      qc.invalidateQueries({ queryKey: ["/api/friends/requests"] });
    },
  });

  const respondCrewInviteMut = useMutation({
    mutationFn: async ({ crewId, accept }: { crewId: string; accept: boolean }) => {
      await apiRequest("POST", `/api/crew-invites/${crewId}/respond`, { accept });
    },
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["/api/notifications"] });
      qc.invalidateQueries({ queryKey: ["/api/crews"] });
      qc.invalidateQueries({ queryKey: ["/api/crew-invites"] });
    },
  });

  const sections = useMemo(() => {
    const groups: Record<string, NotifItem[]> = { Today: [], "This Week": [], Earlier: [] };
    items.forEach((item) => {
      const key = sectionKey(item.created_at);
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return ["Today", "This Week", "Earlier"]
      .filter((k) => groups[k]?.length > 0)
      .map((k) => ({ title: k, data: groups[k] }));
  }, [items]);

  function handleTap(item: NotifItem) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (item.data?.run_id) {
      router.push(`/run/${item.data.run_id}`);
    } else if (item.data?.friend_id && item.type === "friend_accepted") {
      router.push(`/user-profile/${item.data.friend_id}`);
    } else if (item.data?.crew_id || item.crew_id) {
      router.push("/(tabs)/crew");
    }
  }

  function renderItem({ item }: { item: NotifItem }) {
    const iconDef = ICON_MAP[item.type] ?? { name: "bell", color: C.textMuted, bg: C.surface };
    const isUnread = new Date(item.created_at).getTime() > lastReadAt;
    const hasPhoto = item.from_photo || item.data?.from_photo || item.data?.friend_photo;
    const photoUrl = item.from_photo || item.data?.from_photo || item.data?.friend_photo;
    const isFriendReq = item.type === "friend_request";
    const isCrewInvite = item.type === "crew_invite";

    return (
      <Pressable
        style={[s.row, isUnread && { backgroundColor: C.primary + "08" }]}
        onPress={() => handleTap(item)}
      >
        {hasPhoto ? (
          <Image source={{ uri: photoUrl }} style={[s.iconCircle, { backgroundColor: iconDef.bg }]} />
        ) : (
          <View style={[s.iconCircle, { backgroundColor: iconDef.bg }]}>
            <Feather name={iconDef.name as any} size={18} color={iconDef.color} />
          </View>
        )}
        <View style={s.rowContent}>
          <Text style={[s.rowBody, { color: C.text }]} numberOfLines={2}>{item.body}</Text>
          <Text style={[s.rowTime, { color: C.textMuted }]}>{timeAgo(item.created_at)}</Text>
          {isFriendReq && (
            <View style={s.actionRow}>
              <Pressable
                style={[s.actionBtn, { backgroundColor: C.primary }]}
                onPress={() => { acceptFriendMut.mutate(item.id); }}
              >
                <Text style={[s.actionBtnTxt, { color: C.bg }]}>Accept</Text>
              </Pressable>
              <Pressable
                style={[s.actionBtn, { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }]}
                onPress={() => { declineFriendMut.mutate(item.id); }}
              >
                <Text style={[s.actionBtnTxt, { color: C.textSecondary }]}>Decline</Text>
              </Pressable>
            </View>
          )}
          {isCrewInvite && item.crew_id && (
            <View style={s.actionRow}>
              <Pressable
                style={[s.actionBtn, { backgroundColor: C.primary }]}
                onPress={() => { respondCrewInviteMut.mutate({ crewId: item.crew_id!, accept: true }); }}
              >
                <Text style={[s.actionBtnTxt, { color: C.bg }]}>Join</Text>
              </Pressable>
              <Pressable
                style={[s.actionBtn, { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }]}
                onPress={() => { respondCrewInviteMut.mutate({ crewId: item.crew_id!, accept: false }); }}
              >
                <Text style={[s.actionBtnTxt, { color: C.textSecondary }]}>Decline</Text>
              </Pressable>
            </View>
          )}
        </View>
        {isUnread && <View style={s.unreadDot} />}
      </Pressable>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: C.bg }]}>
      <View style={[s.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 8) }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={[s.headerTitle, { color: C.text }]}>Notifications</Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={C.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="notifications-off-outline" size={48} color={C.textMuted} />
          <Text style={[s.emptyText, { color: C.textSecondary }]}>You're all caught up</Text>
          <Text style={[s.emptySubtext, { color: C.textMuted }]}>No new notifications</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => (
            <View style={[s.sectionHeader, { backgroundColor: C.bg }]}>
              <Text style={[s.sectionTitle, { color: C.textMuted }]}>{section.title}</Text>
            </View>
          )}
          contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40, justifyContent: "center" },
  headerTitle: { fontFamily: "Outfit_700Bold", fontSize: 20 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyText: { fontFamily: "Outfit_600SemiBold", fontSize: 16, marginTop: 8 },
  emptySubtext: { fontFamily: "Outfit_400Regular", fontSize: 14 },
  sectionHeader: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  sectionTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  rowContent: { flex: 1 },
  rowBody: { fontFamily: "Outfit_400Regular", fontSize: 14, lineHeight: 20 },
  rowTime: { fontFamily: "Outfit_400Regular", fontSize: 12, marginTop: 4 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#00D97E",
    marginTop: 6,
  },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  actionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  actionBtnTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13 },
});
