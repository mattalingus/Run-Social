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
  Keyboard,
} from "react-native";
import { Image as ExpoImage } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/contexts/ThemeContext";
import { darkColors, type ColorScheme } from "@/constants/colors";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { useAuth } from "@/contexts/AuthContext";

interface DmMessage {
  id: string;
  sender_id: string;
  recipient_id: string;
  message: string;
  message_type: string;
  metadata: { gif_url?: string; gif_preview_url?: string } | null;
  sender_name: string;
  sender_photo: string | null;
  read_at: string | null;
  created_at: string;
}

interface GifItem {
  id: string;
  title: string;
  gif_url: string;
  preview_url: string;
}

const GIF_TOPICS = ["Running", "Celebrate", "Hype", "Let's go", "Tired", "Stretch"];

function resolveImgUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return new URL(url, getApiUrl()).toString();
}

function formatMsgTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function avatarLetter(name: string) {
  return (name ?? "?")[0].toUpperCase();
}

function makeStyles(C: ColorScheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    kav: { flex: 1 },
    headerWrap: {
      alignItems: "center",
      gap: 4,
    },
    headerAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: C.primaryMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    headerAvatarImg: {
      width: 36,
      height: 36,
      borderRadius: 18,
    },
    headerAvatarLetter: {
      fontFamily: "Outfit_600SemiBold",
      fontSize: 15,
      color: C.primary,
    },
    headerName: {
      fontFamily: "Outfit_600SemiBold",
      fontSize: 15,
      color: C.text,
    },
    messagesList: { flex: 1 },
    messagesContent: {
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    msgRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      marginBottom: 6,
      gap: 8,
    },
    msgRowMe: { justifyContent: "flex-end" },
    msgRowThem: { justifyContent: "flex-start" },
    avatar: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: C.primaryMuted,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    avatarImg: {
      width: 28,
      height: 28,
      borderRadius: 14,
    },
    avatarLetter: {
      fontFamily: "Outfit_600SemiBold",
      fontSize: 12,
      color: C.primary,
    },
    avatarSpacer: { width: 28 },
    bubble: {
      maxWidth: "72%",
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
    bubbleTxtMe: { color: "#fff" },
    bubbleTxtThem: { color: C.text },
    bubbleTime: {
      fontFamily: "Outfit_400Regular",
      fontSize: 10,
      color: C.textMuted,
      marginTop: 2,
    },
    bubbleTimeMe: { alignSelf: "flex-end" },
    bubbleTimeThem: { alignSelf: "flex-start" },
    gifBubble: {
      maxWidth: "72%",
      borderRadius: 14,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: C.border,
    },
    gifBubbleMe: { borderColor: C.primary + "60" },
    gifImg: { width: 200, height: 150 },
    gifCaption: {
      fontFamily: "Outfit_400Regular",
      fontSize: 13,
      color: C.text,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    gifPreviewRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      paddingTop: 6,
      gap: 8,
    },
    gifPreviewThumb: { width: 48, height: 36, borderRadius: 6 },
    gifSelectedTxt: {
      fontFamily: "Outfit_400Regular",
      fontSize: 13,
      color: C.textSecondary,
      flex: 1,
    },
    inputWrap: {
      flexDirection: "row",
      alignItems: "flex-end",
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 8,
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
    gifBtn: {
      backgroundColor: C.card,
      borderRadius: 18,
      paddingHorizontal: 11,
      paddingVertical: 9,
    },
    gifBtnTxt: {
      fontFamily: "Outfit_700Bold",
      fontSize: 12,
      color: C.primary,
    },
    sendBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: C.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    sendBtnDisabled: { backgroundColor: C.card },
    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
    emptyWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 40,
    },
    emptyTxt: {
      fontFamily: "Outfit_400Regular",
      fontSize: 14,
      color: C.textMuted,
      textAlign: "center",
      lineHeight: 22,
    },
    gifOverlay: {
      position: "absolute",
      top: "35%",
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: C.surface,
      zIndex: 99,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderTopWidth: 1,
      borderColor: C.border,
    },
    gifOverlayHandle: {
      alignItems: "center",
      paddingTop: 10,
      paddingBottom: 4,
    },
    gifOverlayHandleBar: {
      width: 32,
      height: 4,
      borderRadius: 2,
      backgroundColor: C.border,
    },
    gifOverlayHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: C.border,
    },
    gifOverlayTitle: {
      fontFamily: "Outfit_700Bold",
      fontSize: 16,
      color: C.text,
    },
    gifSearchRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: C.card,
      borderRadius: 12,
      margin: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    gifSearchInput: {
      flex: 1,
      fontFamily: "Outfit_400Regular",
      fontSize: 14,
      color: C.text,
      marginLeft: 8,
    },
    gifTopicRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      paddingHorizontal: 12,
      gap: 8,
    },
    gifTopicPill: {
      backgroundColor: C.card,
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 7,
    },
    gifTopicTxt: {
      fontFamily: "Outfit_600SemiBold",
      fontSize: 13,
      color: C.text,
    },
    gifGridCell: {
      flex: 1,
      borderRadius: 10,
      overflow: "hidden",
      backgroundColor: C.card,
    },
    gifGridImg: { width: "100%", height: 120 },
    gifEmptyTxt: {
      fontFamily: "Outfit_400Regular",
      fontSize: 14,
      color: C.textMuted,
    },
  });
}

export default function DmThread() {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const insets = useSafeAreaInsets();
  const { friendId, friendName, friendUsername, friendPhoto } = useLocalSearchParams<{
    friendId: string;
    friendName: string;
    friendUsername: string;
    friendPhoto: string;
  }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifSearch, setGifSearch] = useState("");
  const [gifResults, setGifResults] = useState<GifItem[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [selectedGif, setSelectedGif] = useState<GifItem | null>(null);
  const [sending, setSending] = useState(false);

  const { data: messages = [], isLoading, refetch } = useQuery<DmMessage[]>({
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

  async function fetchGifs(query: string) {
    setGifLoading(true);
    try {
      const url = new URL("/api/gifs/search", getApiUrl());
      if (query.trim()) url.searchParams.set("q", query.trim());
      url.searchParams.set("limit", "20");
      const resp = await fetch(url.toString(), { credentials: "include" });
      const data = await resp.json();
      setGifResults(Array.isArray(data) ? data : []);
    } catch {
      setGifResults([]);
    } finally {
      setGifLoading(false);
    }
  }

  useEffect(() => {
    if (!showGifPicker) return;
    const t = setTimeout(() => fetchGifs(gifSearch), gifSearch ? 400 : 0);
    return () => clearTimeout(t);
  }, [gifSearch, showGifPicker]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if ((!text && !selectedGif) || sending) return;
    const gifToSend = selectedGif;
    setDraft("");
    setSelectedGif(null);
    setSending(true);
    try {
      await apiRequest("POST", `/api/dm/${friendId}`, {
        message: text,
        ...(gifToSend ? { gif_url: gifToSend.gif_url, gif_preview_url: gifToSend.preview_url } : {}),
      });
      refetch();
      qc.invalidateQueries({ queryKey: ["/api/dm/conversations"] });
    } catch {
      setDraft(text);
      setSelectedGif(gifToSend);
    } finally {
      setSending(false);
    }
  }, [draft, selectedGif, sending, friendId, refetch, qc]);

  const openGifPicker = useCallback(() => {
    Keyboard.dismiss();
    setGifSearch("");
    setGifResults([]);
    setShowGifPicker(true);
  }, []);

  const bottomPad = Math.max(insets.bottom, 8);
  const canSend = (!!draft.trim() || !!selectedGif) && !sending;
  const displayUsername = friendUsername ? `@${friendUsername}` : friendName;
  const photoUrl = resolveImgUrl(friendPhoto);

  const headerTitle = useCallback(() => (
    <View style={s.headerWrap}>
      <View style={s.headerAvatar}>
        {photoUrl ? (
          <ExpoImage source={{ uri: photoUrl }} style={s.headerAvatarImg} contentFit="cover" />
        ) : (
          <Text style={s.headerAvatarLetter}>{avatarLetter(friendName ?? "?")}</Text>
        )}
      </View>
      <Text style={s.headerName}>{displayUsername}</Text>
    </View>
  ), [photoUrl, displayUsername, friendName, s]);

  return (
    <>
      <Stack.Screen options={{ headerTitle }} />
      <View style={s.root}>
        <KeyboardAvoidingView
          style={s.kav}
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
                No messages yet.{"\n"}Say hello!
              </Text>
            </View>
          ) : (
            <FlatList
              style={s.messagesList}
              data={messages}
              keyExtractor={(item) => item.id}
              contentContainerStyle={s.messagesContent}
              inverted
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const isMe = item.sender_id === user?.id;
                const isGif = item.message_type === "gif";
                const senderPhoto = resolveImgUrl(item.sender_photo);

                const avatarEl = (
                  <View style={s.avatar}>
                    {senderPhoto ? (
                      <ExpoImage source={{ uri: senderPhoto }} style={s.avatarImg} contentFit="cover" />
                    ) : (
                      <Text style={s.avatarLetter}>{avatarLetter(item.sender_name)}</Text>
                    )}
                  </View>
                );

                if (isGif) {
                  return (
                    <View style={[s.msgRow, isMe ? s.msgRowMe : s.msgRowThem]}>
                      {!isMe && avatarEl}
                      <View style={[s.gifBubble, isMe && s.gifBubbleMe]}>
                        {item.metadata?.gif_url ? (
                          <ExpoImage
                            source={{ uri: item.metadata.gif_url }}
                            style={s.gifImg}
                            contentFit="cover"
                            autoplay
                          />
                        ) : null}
                        {!!item.message && (
                          <Text style={s.gifCaption}>{item.message}</Text>
                        )}
                      </View>
                    </View>
                  );
                }

                return (
                  <View style={[s.msgRow, isMe ? s.msgRowMe : s.msgRowThem]}>
                    {!isMe && avatarEl}
                    <View style={[s.bubble, isMe ? s.bubbleMe : s.bubbleThem]}>
                      <Text style={[s.bubbleTxt, isMe ? s.bubbleTxtMe : s.bubbleTxtThem]}>
                        {item.message}
                      </Text>
                      <Text style={[s.bubbleTime, isMe ? s.bubbleTimeMe : s.bubbleTimeThem]}>
                        {formatMsgTime(item.created_at)}
                      </Text>
                    </View>
                    {isMe && <View style={s.avatarSpacer} />}
                  </View>
                );
              }}
            />
          )}

          {selectedGif && (
            <View style={s.gifPreviewRow}>
              <ExpoImage source={{ uri: selectedGif.preview_url }} style={s.gifPreviewThumb} contentFit="cover" />
              <Text style={s.gifSelectedTxt}>GIF selected</Text>
              <TouchableOpacity onPress={() => setSelectedGif(null)}>
                <Ionicons name="close-circle" size={20} color={C.textMuted} />
              </TouchableOpacity>
            </View>
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
            <TouchableOpacity style={s.gifBtn} onPress={openGifPicker} testID="dm-gif-btn">
              <Text style={s.gifBtnTxt}>GIF</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.sendBtn, !canSend && s.sendBtnDisabled]}
              onPress={handleSend}
              disabled={!canSend}
              testID="dm-send-btn"
            >
              <Ionicons name="arrow-up" size={18} color={canSend ? "#fff" : C.textMuted} />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>

        {showGifPicker && (
          <View style={s.gifOverlay}>
            <View style={s.gifOverlayHandle}>
              <View style={s.gifOverlayHandleBar} />
            </View>
            <View style={s.gifOverlayHeader}>
              <Text style={s.gifOverlayTitle}>GIFs</Text>
              <TouchableOpacity onPress={() => setShowGifPicker(false)}>
                <Ionicons name="close" size={22} color={C.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={s.gifSearchRow}>
              <Ionicons name="search" size={16} color={C.textMuted} />
              <TextInput
                style={s.gifSearchInput}
                value={gifSearch}
                onChangeText={setGifSearch}
                placeholder="Search GIFs…"
                placeholderTextColor={C.textMuted}
                returnKeyType="search"
              />
              {!!gifSearch && (
                <TouchableOpacity onPress={() => setGifSearch("")}>
                  <Ionicons name="close-circle" size={16} color={C.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {!gifSearch && gifResults.length === 0 && !gifLoading && (
              <View style={s.gifTopicRow}>
                {GIF_TOPICS.map((topic) => (
                  <TouchableOpacity key={topic} style={s.gifTopicPill} onPress={() => setGifSearch(topic)}>
                    <Text style={s.gifTopicTxt}>{topic}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {gifLoading && (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator color={C.primary} size="large" />
              </View>
            )}

            {!gifLoading && gifResults.length === 0 && !!gifSearch && (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Ionicons name="sad-outline" size={40} color={C.textMuted} />
                <Text style={s.gifEmptyTxt}>No GIFs found for "{gifSearch}"</Text>
              </View>
            )}

            {!gifLoading && gifResults.length > 0 && (
              <FlatList
                data={gifResults}
                numColumns={2}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ padding: 8, gap: 6 }}
                columnWrapperStyle={{ gap: 6 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={s.gifGridCell}
                    onPress={() => {
                      setSelectedGif(item);
                      setShowGifPicker(false);
                    }}
                  >
                    <ExpoImage source={{ uri: item.preview_url }} style={s.gifGridImg} contentFit="cover" />
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        )}
      </View>
    </>
  );
}
