import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/contexts/ThemeContext";
import { darkColors, type ColorScheme } from "@/constants/colors";
import { apiRequest } from "@/lib/query-client";
import { useAuth } from "@/contexts/AuthContext";

interface DmMessage {
  id: string;
  sender_id: string;
  recipient_id: string;
  message: string;
  sender_name: string;
  sender_photo: string | null;
  read_at: string | null;
  created_at: string;
}

function formatMsgTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function makeStyles(C: ColorScheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: C.bg,
    },
    messagesList: {
      flex: 1,
    },
    messagesContent: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 6,
    },
    msgRow: {
      flexDirection: "row",
      marginBottom: 4,
    },
    msgRowMe: {
      justifyContent: "flex-end",
    },
    msgRowThem: {
      justifyContent: "flex-start",
    },
    bubble: {
      maxWidth: "75%",
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    bubbleMe: {
      backgroundColor: C.primary,
      borderBottomRightRadius: 4,
    },
    bubbleThem: {
      backgroundColor: C.surface,
      borderBottomLeftRadius: 4,
    },
    bubbleTxt: {
      fontFamily: "Outfit_400Regular",
      fontSize: 14,
      lineHeight: 20,
    },
    bubbleTxtMe: {
      color: "#fff",
    },
    bubbleTxtThem: {
      color: C.text,
    },
    bubbleTime: {
      fontFamily: "Outfit_400Regular",
      fontSize: 10,
      color: C.textMuted,
      marginTop: 2,
      alignSelf: "flex-end",
    },
    bubbleTimeThem: {
      alignSelf: "flex-start",
    },
    inputWrap: {
      flexDirection: "row",
      alignItems: "flex-end",
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: 10,
      gap: 8,
      borderTopWidth: 1,
      borderTopColor: C.border,
      backgroundColor: C.bg,
    },
    input: {
      flex: 1,
      backgroundColor: C.card,
      borderRadius: 22,
      paddingHorizontal: 16,
      paddingVertical: 10,
      fontFamily: "Outfit_400Regular",
      fontSize: 14,
      color: C.text,
      maxHeight: 100,
    },
    sendBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: C.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    sendBtnDisabled: {
      backgroundColor: C.card,
    },
    loadingWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 40,
      paddingTop: 60,
    },
    emptyTxt: {
      fontFamily: "Outfit_400Regular",
      fontSize: 14,
      color: C.textMuted,
      textAlign: "center",
    },
  });
}

export default function DmThread() {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const insets = useSafeAreaInsets();
  const { friendId, friendName } = useLocalSearchParams<{ friendId: string; friendName: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const flatRef = useRef<FlatList>(null);

  const { data: messages = [], isLoading } = useQuery<DmMessage[]>({
    queryKey: ["/api/dm", friendId],
    refetchInterval: 5000,
    enabled: !!friendId,
  });

  useEffect(() => {
    if (!friendId) return;
    apiRequest("POST", `/api/dm/${friendId}/read`).catch(() => {});
    qc.invalidateQueries({ queryKey: ["/api/dm/conversations"] });
    qc.invalidateQueries({ queryKey: ["/api/dm/unread-count"] });
  }, [friendId]);

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest("POST", `/api/dm/${friendId}`, { message: text });
      return res.json();
    },
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["/api/dm", friendId] });
      qc.invalidateQueries({ queryKey: ["/api/dm/conversations"] });
    },
  });

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text || sendMutation.isPending) return;
    sendMutation.mutate(text);
  }, [draft, sendMutation]);

  const bottomPad = Math.max(insets.bottom, 8);

  return (
    <>
      <Stack.Screen options={{ title: friendName ?? "Message" }} />
      <KeyboardAvoidingView
        style={s.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
      >
        {isLoading ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator color={C.primary} />
          </View>
        ) : messages.length === 0 ? (
          <View style={s.emptyWrap}>
            <Text style={s.emptyTxt}>
              No messages yet.{"\n"}Say hello to {friendName}!
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatRef}
            style={s.messagesList}
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={s.messagesContent}
            inverted
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const isMe = item.sender_id === user?.id;
              return (
                <View style={[s.msgRow, isMe ? s.msgRowMe : s.msgRowThem]}>
                  <View style={[s.bubble, isMe ? s.bubbleMe : s.bubbleThem]}>
                    <Text style={[s.bubbleTxt, isMe ? s.bubbleTxtMe : s.bubbleTxtThem]}>
                      {item.message}
                    </Text>
                    <Text style={[s.bubbleTime, !isMe && s.bubbleTimeThem]}>
                      {formatMsgTime(item.created_at)}
                    </Text>
                  </View>
                </View>
              );
            }}
          />
        )}

        <View style={[s.inputWrap, { paddingBottom: bottomPad }]}>
          <TextInput
            style={s.input}
            placeholder="Message..."
            placeholderTextColor={C.textMuted}
            value={draft}
            onChangeText={setDraft}
            multiline
            returnKeyType="default"
            testID="dm-text-input"
          />
          <TouchableOpacity
            style={[s.sendBtn, !draft.trim() && s.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!draft.trim() || sendMutation.isPending}
            testID="dm-send-btn"
          >
            <Ionicons
              name="arrow-up"
              size={18}
              color={draft.trim() ? "#fff" : C.textMuted}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}
