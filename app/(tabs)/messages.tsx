import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  Platform,
  ActivityIndicator,
  Animated,
  PanResponder,
  Alert,
  Pressable,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/contexts/ThemeContext";
import { darkColors, type ColorScheme } from "@/constants/colors";
import { apiRequest, getApiUrl } from "@/lib/query-client";

const SWIPE_THRESHOLD = -72;
const DELETE_WIDTH = 72;

function resolveImgUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return new URL(url, getApiUrl()).toString();
}

interface Conversation {
  friend_id: string;
  friend_name: string;
  friend_username: string | null;
  friend_photo: string | null;
  last_message: string;
  last_message_at: string;
  last_sender_id: string;
  unread_count: number;
}

interface CrewRow {
  id: string;
  name: string;
  emoji: string;
  image_url?: string | null;
  member_count: number;
  last_message?: string | null;
  last_message_at?: string | null;
  last_sender_name?: string | null;
  unread_count?: number | string;
  chat_muted?: boolean;
}

interface Friend {
  id: string;
  name: string;
  username: string | null;
  photo_url: string | null;
  friendship_id: string;
}

type InboxFilter = "all" | "crews" | "dms";

type InboxItem =
  | { kind: "crew"; id: string; data: CrewRow; ts: number }
  | { kind: "dm"; id: string; data: Conversation; ts: number };

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function avatarLetter(name: string) {
  return (name ?? "?")[0].toUpperCase();
}

function makeStyles(C: ColorScheme) {
  const isWeb = Platform.OS === "web";
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    header: {
      paddingHorizontal: 20,
      paddingBottom: 8,
      paddingTop: isWeb ? 67 : 0,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    headerTitle: { fontFamily: "Outfit_700Bold", fontSize: 28, color: C.text },
    composeBtn: {
      width: 38, height: 38, borderRadius: 19,
      backgroundColor: C.card,
      alignItems: "center", justifyContent: "center",
    },
    tabsRow: {
      flexDirection: "row",
      gap: 8,
      paddingHorizontal: 20,
      marginBottom: 8,
    },
    tabPill: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: C.border,
      backgroundColor: C.surface,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    tabPillActive: { backgroundColor: C.primary, borderColor: C.primary },
    tabPillTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
    tabPillTxtActive: { color: C.bg },
    tabPillBadge: {
      minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5,
      backgroundColor: C.primary + "33",
      alignItems: "center", justifyContent: "center",
    },
    tabPillBadgeActive: { backgroundColor: "rgba(255,255,255,0.3)" },
    tabPillBadgeTxt: { fontFamily: "Outfit_700Bold", fontSize: 10, color: C.primary },
    tabPillBadgeTxtActive: { color: C.bg },
    listContent: { paddingBottom: isWeb ? 34 : 100 },
    swipeContainer: { overflow: "hidden" },
    deleteBack: {
      position: "absolute",
      right: 0, top: 0, bottom: 0,
      width: DELETE_WIDTH,
      backgroundColor: C.danger,
      alignItems: "center",
      justifyContent: "center",
    },
    convoRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingVertical: 14,
      gap: 14,
      backgroundColor: C.bg,
    },
    convoRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
    avatarCircle: {
      width: 50, height: 50, borderRadius: 25,
      backgroundColor: C.primaryMuted,
      alignItems: "center", justifyContent: "center",
    },
    crewAvatar: {
      width: 50, height: 50, borderRadius: 14,
      backgroundColor: C.primary + "22",
      alignItems: "center", justifyContent: "center",
    },
    crewAvatarEmoji: { fontSize: 24 },
    avatarLetter: { fontFamily: "Outfit_700Bold", fontSize: 20, color: C.primary },
    convoMeta: { flex: 1 },
    convoNameRow: {
      flexDirection: "row", alignItems: "center",
      justifyContent: "space-between", marginBottom: 3,
    },
    convoNameInner: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
    convoName: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.text, flexShrink: 1 },
    crewTag: {
      fontFamily: "Outfit_600SemiBold", fontSize: 10,
      color: C.primary, letterSpacing: 0.3,
      backgroundColor: C.primary + "22",
      paddingHorizontal: 6, paddingVertical: 1,
      borderRadius: 6, overflow: "hidden",
    },
    convoTime: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted },
    convoPreviewRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    convoPreview: { flex: 1, fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary },
    convoPreviewUnread: { fontFamily: "Outfit_600SemiBold", color: C.text },
    unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
    unreadBadge: {
      minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6,
      backgroundColor: C.primary,
      alignItems: "center", justifyContent: "center",
    },
    unreadBadgeTxt: { fontFamily: "Outfit_700Bold", fontSize: 11, color: C.bg },
    emptyWrap: {
      flex: 1, alignItems: "center", justifyContent: "center",
      paddingHorizontal: 40, gap: 12,
    },
    emptyIcon: {
      width: 64, height: 64, borderRadius: 32,
      backgroundColor: C.card,
      alignItems: "center", justifyContent: "center", marginBottom: 4,
    },
    emptyTitle: { fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text, textAlign: "center" },
    emptyDesc: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textMuted, textAlign: "center", lineHeight: 20 },
    emptyBtn: {
      marginTop: 8, backgroundColor: C.primary,
      borderRadius: 22, paddingHorizontal: 24, paddingVertical: 11,
    },
    emptyBtnTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: "#fff" },
    modalOverlay: { flex: 1, backgroundColor: C.overlay, justifyContent: "flex-end" },
    modalSheet: {
      backgroundColor: C.surface,
      borderTopLeftRadius: 20, borderTopRightRadius: 20,
      paddingBottom: 30, maxHeight: "80%",
    },
    modalHandle: {
      width: 36, height: 4, borderRadius: 2,
      backgroundColor: C.border,
      alignSelf: "center", marginTop: 10, marginBottom: 6,
    },
    modalHeader: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 20, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: C.border,
    },
    modalTitle: { fontFamily: "Outfit_700Bold", fontSize: 17, color: C.text },
    modalClose: { padding: 4 },
    friendRow: {
      flexDirection: "row", alignItems: "center",
      paddingHorizontal: 20, paddingVertical: 14,
      gap: 14, borderBottomWidth: 1, borderBottomColor: C.border,
    },
    friendName: { fontFamily: "Outfit_400Regular", fontSize: 15, color: C.text },
    friendsEmpty: { padding: 30, alignItems: "center" },
    friendsEmptyTxt: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textMuted, textAlign: "center" },
  });
}

// ─── Swipeable DM Row ───────────────────────────────────────────────────────────
function SwipeableConvoRow({
  item,
  showBorder,
  s,
  C,
  onOpen,
  onDelete,
}: {
  item: Conversation;
  showBorder: boolean;
  s: ReturnType<typeof makeStyles>;
  C: ColorScheme;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dy) < Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        const newX = Math.max(SWIPE_THRESHOLD, Math.min(0, g.dx + (isOpen.current ? SWIPE_THRESHOLD : 0)));
        translateX.setValue(newX);
      },
      onPanResponderRelease: (_, g) => {
        const currentX = isOpen.current ? g.dx + SWIPE_THRESHOLD : g.dx;
        if (currentX < SWIPE_THRESHOLD / 2) {
          Animated.spring(translateX, { toValue: SWIPE_THRESHOLD, useNativeDriver: true }).start();
          isOpen.current = true;
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
          isOpen.current = false;
        }
      },
    })
  ).current;

  const close = useCallback(() => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
    isOpen.current = false;
  }, [translateX]);

  const hasUnread = Number(item.unread_count) > 0;

  return (
    <View style={s.swipeContainer}>
      <View style={s.deleteBack}>
        <TouchableOpacity
          onPress={() => { close(); onDelete(); }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="trash" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={[s.convoRow, showBorder && s.convoRowBorder]}
          onPress={() => {
            if (isOpen.current) { close(); return; }
            onOpen();
          }}
          activeOpacity={0.85}
          testID={`dm-convo-${item.friend_id}`}
        >
          <View style={s.avatarCircle}>
            {resolveImgUrl(item.friend_photo) ? (
              <ExpoImage
                source={{ uri: resolveImgUrl(item.friend_photo)! }}
                style={{ width: 50, height: 50, borderRadius: 25 }}
                contentFit="cover"
              />
            ) : (
              <Text style={s.avatarLetter}>{avatarLetter(item.friend_name)}</Text>
            )}
          </View>
          <View style={s.convoMeta}>
            <View style={s.convoNameRow}>
              <View style={s.convoNameInner}>
                <Text style={s.convoName} numberOfLines={1}>
                  {item.friend_username ? `@${item.friend_username}` : item.friend_name}
                </Text>
              </View>
              <Text style={s.convoTime}>{formatTime(item.last_message_at)}</Text>
            </View>
            <View style={s.convoPreviewRow}>
              <Text
                style={[s.convoPreview, hasUnread && s.convoPreviewUnread]}
                numberOfLines={1}
              >
                {item.last_message}
              </Text>
              {hasUnread && <View style={s.unreadDot} />}
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ─── Crew Row ──────────────────────────────────────────────────────────────────
function CrewConvoRow({
  item,
  showBorder,
  s,
  C,
  onOpen,
}: {
  item: CrewRow;
  showBorder: boolean;
  s: ReturnType<typeof makeStyles>;
  C: ColorScheme;
  onOpen: () => void;
}) {
  const unread = Number(item.unread_count ?? 0);
  const hasUnread = unread > 0;
  const photo = resolveImgUrl(item.image_url);
  const preview = item.last_message
    ? (item.last_sender_name ? `${item.last_sender_name}: ${item.last_message}` : item.last_message)
    : `${item.member_count} member${item.member_count === 1 ? "" : "s"} · tap to chat`;
  return (
    <TouchableOpacity
      style={[s.convoRow, showBorder && s.convoRowBorder]}
      onPress={onOpen}
      activeOpacity={0.85}
      testID={`crew-convo-${item.id}`}
    >
      <View style={s.crewAvatar}>
        {photo ? (
          <ExpoImage
            source={{ uri: photo }}
            style={{ width: 50, height: 50, borderRadius: 14 }}
            contentFit="cover"
          />
        ) : (
          <Text style={s.crewAvatarEmoji}>{item.emoji || "🏃"}</Text>
        )}
      </View>
      <View style={s.convoMeta}>
        <View style={s.convoNameRow}>
          <View style={s.convoNameInner}>
            <Text style={s.convoName} numberOfLines={1}>{item.name}</Text>
            <Text style={s.crewTag}>CREW</Text>
          </View>
          {item.last_message_at && <Text style={s.convoTime}>{formatTime(item.last_message_at)}</Text>}
        </View>
        <View style={s.convoPreviewRow}>
          <Text
            style={[s.convoPreview, hasUnread && s.convoPreviewUnread]}
            numberOfLines={1}
          >
            {preview}
          </Text>
          {hasUnread && (
            <View style={s.unreadBadge}>
              <Text style={s.unreadBadgeTxt}>{unread > 99 ? "99+" : unread}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────
export default function MessagesScreen() {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const [showCompose, setShowCompose] = useState(false);
  const [filter, setFilter] = useState<InboxFilter>("all");

  const { data: conversations = [], isLoading: isLoadingDms } = useQuery<Conversation[]>({
    queryKey: ["/api/dm/conversations"],
    refetchInterval: 10000,
  });

  const { data: crews = [], isLoading: isLoadingCrews } = useQuery<CrewRow[]>({
    queryKey: ["/api/crews"],
    refetchInterval: 15000,
  });

  const { data: friends = [] } = useQuery<Friend[]>({
    queryKey: ["/api/friends"],
    enabled: showCompose,
  });

  const deleteMutation = useMutation({
    mutationFn: async (friendId: string) => {
      await apiRequest("DELETE", `/api/dm/${friendId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/dm/conversations"] });
      qc.invalidateQueries({ queryKey: ["/api/dm/unread-count"] });
    },
  });

  const openThread = useCallback((friendId: string, friendName: string, friendUsername?: string | null, friendPhoto?: string | null) => {
    setShowCompose(false);
    router.push({ pathname: "/dm/[friendId]", params: { friendId, friendName, friendUsername: friendUsername ?? "", friendPhoto: friendPhoto ?? "" } });
  }, [router]);

  const openCrew = useCallback((crewId: string) => {
    Haptics.selectionAsync();
    router.push({ pathname: "/(tabs)/crew", params: { crewId } });
  }, [router]);

  const handleDelete = useCallback((friendId: string, friendName: string) => {
    Alert.alert(
      "Delete conversation",
      `Delete your conversation with ${friendName}? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate(friendId) },
      ]
    );
  }, [deleteMutation]);

  // Merge + sort inbox
  const inbox = useMemo<InboxItem[]>(() => {
    const items: InboxItem[] = [];
    if (filter === "all" || filter === "crews") {
      for (const c of crews) {
        const ts = c.last_message_at ? new Date(c.last_message_at).getTime() : 0;
        items.push({ kind: "crew", id: `crew-${c.id}`, data: c, ts });
      }
    }
    if (filter === "all" || filter === "dms") {
      for (const d of conversations) {
        const ts = d.last_message_at ? new Date(d.last_message_at).getTime() : 0;
        items.push({ kind: "dm", id: `dm-${d.friend_id}`, data: d, ts });
      }
    }
    items.sort((a, b) => b.ts - a.ts);
    return items;
  }, [crews, conversations, filter]);

  const totalCrewUnread = useMemo(
    () => crews.reduce((sum, c) => sum + Number(c.unread_count ?? 0), 0),
    [crews]
  );
  const totalDmUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + Number(c.unread_count ?? 0), 0),
    [conversations]
  );

  const topPad = Platform.OS === "web" ? 0 : insets.top;
  const isLoading = isLoadingDms || isLoadingCrews;

  if (isLoading) {
    return (
      <View style={[s.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={C.primary} />
      </View>
    );
  }

  return (
    <View style={[s.container, { paddingTop: topPad }]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Messages</Text>
        <TouchableOpacity style={s.composeBtn} onPress={() => setShowCompose(true)} testID="compose-dm-btn">
          <Feather name="edit" size={18} color={C.text} />
        </TouchableOpacity>
      </View>

      {/* Tabs: All / Crews / DMs */}
      <View style={s.tabsRow}>
        {([
          { k: "all" as const, label: "All", count: totalCrewUnread + totalDmUnread },
          { k: "crews" as const, label: "Crews", count: totalCrewUnread },
          { k: "dms" as const, label: "DMs", count: totalDmUnread },
        ]).map((t) => {
          const active = filter === t.k;
          return (
            <Pressable
              key={t.k}
              onPress={() => { Haptics.selectionAsync(); setFilter(t.k); }}
              style={[s.tabPill, active && s.tabPillActive]}
            >
              <Text style={[s.tabPillTxt, active && s.tabPillTxtActive]}>{t.label}</Text>
              {t.count > 0 && (
                <View style={[s.tabPillBadge, active && s.tabPillBadgeActive]}>
                  <Text style={[s.tabPillBadgeTxt, active && s.tabPillBadgeTxtActive]}>
                    {t.count > 99 ? "99+" : t.count}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      {inbox.length === 0 ? (
        <View style={s.emptyWrap}>
          <View style={s.emptyIcon}>
            <Ionicons name="chatbubble-outline" size={28} color={C.textMuted} />
          </View>
          <Text style={s.emptyTitle}>
            {filter === "crews" ? "No crew chats" : filter === "dms" ? "No messages yet" : "Inbox is empty"}
          </Text>
          <Text style={s.emptyDesc}>
            {filter === "crews"
              ? "Join a crew to chat with other runners"
              : "Send a message to a friend to get started"}
          </Text>
          {filter !== "crews" && (
            <TouchableOpacity style={s.emptyBtn} onPress={() => setShowCompose(true)}>
              <Text style={s.emptyBtnTxt}>Start a conversation</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={inbox}
          keyExtractor={(it) => it.id}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => {
            const showBorder = index < inbox.length - 1;
            if (item.kind === "crew") {
              return (
                <CrewConvoRow
                  item={item.data}
                  showBorder={showBorder}
                  s={s}
                  C={C}
                  onOpen={() => openCrew(item.data.id)}
                />
              );
            }
            return (
              <SwipeableConvoRow
                item={item.data}
                showBorder={showBorder}
                s={s}
                C={C}
                onOpen={() => openThread(item.data.friend_id, item.data.friend_name, item.data.friend_username, item.data.friend_photo)}
                onDelete={() => handleDelete(item.data.friend_id, item.data.friend_name)}
              />
            );
          }}
        />
      )}

      <Modal
        visible={showCompose}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCompose(false)}
      >
        <View style={s.modalSheet}>
          <View style={s.modalHandle} />
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>New Message</Text>
            <TouchableOpacity style={s.modalClose} onPress={() => setShowCompose(false)}>
              <Ionicons name="close" size={22} color={C.textMuted} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={friends}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={s.friendsEmpty}>
                <Text style={s.friendsEmptyTxt}>
                  No friends yet. Add friends from your Profile tab to message them.
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity style={s.friendRow} onPress={() => openThread(item.id, item.name, item.username, item.photo_url)}>
                <View style={s.avatarCircle}>
                  {resolveImgUrl(item.photo_url) ? (
                    <ExpoImage
                      source={{ uri: resolveImgUrl(item.photo_url)! }}
                      style={{ width: 50, height: 50, borderRadius: 25 }}
                      contentFit="cover"
                    />
                  ) : (
                    <Text style={s.avatarLetter}>{avatarLetter(item.name)}</Text>
                  )}
                </View>
                <Text style={s.friendName}>{item.username ? `@${item.username}` : item.name}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}
