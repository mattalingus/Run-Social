import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  Platform,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";
import { darkColors, type ColorScheme } from "@/constants/colors";
import { apiRequest } from "@/lib/query-client";

const C_FALLBACK = darkColors;

interface Conversation {
  friend_id: string;
  friend_name: string;
  friend_photo: string | null;
  last_message: string;
  last_message_at: string;
  last_sender_id: string;
  unread_count: number;
}

interface Friend {
  id: string;
  name: string;
  photo_url: string | null;
  friendship_id: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return d.toLocaleDateString([], { weekday: "short" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function avatarLetter(name: string) {
  return (name ?? "?")[0].toUpperCase();
}

function makeStyles(C: ColorScheme) {
  const isWeb = Platform.OS === "web";
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: C.bg,
    },
    header: {
      paddingHorizontal: 20,
      paddingBottom: 12,
      paddingTop: isWeb ? 67 : 0,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    headerTitle: {
      fontFamily: "Outfit_700Bold",
      fontSize: 28,
      color: C.text,
    },
    composeBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: C.card,
      alignItems: "center",
      justifyContent: "center",
    },
    listContent: {
      paddingBottom: isWeb ? 34 : 100,
    },
    convoRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingVertical: 14,
      gap: 14,
    },
    convoRowBorder: {
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    avatarCircle: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: C.primaryMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarLetter: {
      fontFamily: "Outfit_700Bold",
      fontSize: 20,
      color: C.primary,
    },
    convoMeta: {
      flex: 1,
    },
    convoNameRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 3,
    },
    convoName: {
      fontFamily: "Outfit_600SemiBold",
      fontSize: 15,
      color: C.text,
    },
    convoTime: {
      fontFamily: "Outfit_400Regular",
      fontSize: 12,
      color: C.textMuted,
    },
    convoPreviewRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    convoPreview: {
      flex: 1,
      fontFamily: "Outfit_400Regular",
      fontSize: 13,
      color: C.textSecondary,
    },
    convoPreviewUnread: {
      fontFamily: "Outfit_600SemiBold",
      color: C.text,
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: C.primary,
    },
    emptyWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 40,
      gap: 12,
    },
    emptyIcon: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: C.card,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 4,
    },
    emptyTitle: {
      fontFamily: "Outfit_700Bold",
      fontSize: 20,
      color: C.text,
      textAlign: "center",
    },
    emptyDesc: {
      fontFamily: "Outfit_400Regular",
      fontSize: 14,
      color: C.textMuted,
      textAlign: "center",
      lineHeight: 20,
    },
    emptyBtn: {
      marginTop: 8,
      backgroundColor: C.primary,
      borderRadius: 22,
      paddingHorizontal: 24,
      paddingVertical: 11,
    },
    emptyBtnTxt: {
      fontFamily: "Outfit_600SemiBold",
      fontSize: 14,
      color: "#fff",
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: C.overlay,
      justifyContent: "flex-end",
    },
    modalSheet: {
      backgroundColor: C.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: 30,
      maxHeight: "80%",
    },
    modalHandle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: C.border,
      alignSelf: "center",
      marginTop: 10,
      marginBottom: 6,
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    modalTitle: {
      fontFamily: "Outfit_700Bold",
      fontSize: 17,
      color: C.text,
    },
    modalClose: {
      padding: 4,
    },
    friendRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 20,
      paddingVertical: 14,
      gap: 14,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    friendName: {
      fontFamily: "Outfit_400Regular",
      fontSize: 15,
      color: C.text,
    },
    friendsEmpty: {
      padding: 30,
      alignItems: "center",
    },
    friendsEmptyTxt: {
      fontFamily: "Outfit_400Regular",
      fontSize: 14,
      color: C.textMuted,
      textAlign: "center",
    },
  });
}

export default function MessagesScreen() {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const [showCompose, setShowCompose] = useState(false);

  const { data: conversations = [], isLoading } = useQuery<Conversation[]>({
    queryKey: ["/api/dm/conversations"],
    refetchInterval: 10000,
  });

  const { data: friends = [] } = useQuery<Friend[]>({
    queryKey: ["/api/friends"],
    enabled: showCompose,
  });

  const openThread = useCallback((friendId: string, friendName: string) => {
    setShowCompose(false);
    router.push({ pathname: "/dm/[friendId]", params: { friendId, friendName } });
  }, [router]);

  const topPad = Platform.OS === "web" ? 0 : insets.top;

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

      {conversations.length === 0 ? (
        <View style={s.emptyWrap}>
          <View style={s.emptyIcon}>
            <Ionicons name="chatbubble-outline" size={28} color={C.textMuted} />
          </View>
          <Text style={s.emptyTitle}>No messages yet</Text>
          <Text style={s.emptyDesc}>Send a message to a friend to get started</Text>
          <TouchableOpacity style={s.emptyBtn} onPress={() => setShowCompose(true)}>
            <Text style={s.emptyBtnTxt}>Start a conversation</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.friend_id}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => {
            const hasUnread = Number(item.unread_count) > 0;
            return (
              <TouchableOpacity
                style={[s.convoRow, index < conversations.length - 1 && s.convoRowBorder]}
                onPress={() => openThread(item.friend_id, item.friend_name)}
                testID={`dm-convo-${item.friend_id}`}
              >
                <View style={s.avatarCircle}>
                  <Text style={s.avatarLetter}>{avatarLetter(item.friend_name)}</Text>
                </View>
                <View style={s.convoMeta}>
                  <View style={s.convoNameRow}>
                    <Text style={s.convoName}>{item.friend_name}</Text>
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
                  No friends yet. Add friends from the Discover tab to message them.
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity style={s.friendRow} onPress={() => openThread(item.id, item.name)}>
                <View style={s.avatarCircle}>
                  <Text style={s.avatarLetter}>{avatarLetter(item.name)}</Text>
                </View>
                <Text style={s.friendName}>{item.name}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}
