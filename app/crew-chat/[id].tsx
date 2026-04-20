import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, router, useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { useQuery } from "@tanstack/react-query";
import ScreenHeader from "@/components/ScreenHeader";

interface Message {
  id: string;
  crew_id: string;
  user_id: string;
  sender_name: string;
  sender_photo?: string;
  message: string;
  created_at: string;
  message_type?: string;
  metadata?: { runId?: string; quickReplies?: string[] } | null;
  isTemp?: boolean;
}

interface Crew {
  id: string;
  name: string;
  member_count: number;
}

export default function CrewChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { C } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(C), [C]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);

  const { data: crew } = useQuery<Crew>({
    queryKey: ["/api/crews", id],
  });

  const fetchMessages = useCallback(async () => {
    try {
      const res = await apiRequest("GET", `/api/crews/${id}/messages`);
      const newMessages: Message[] = await res.json();
      
      setMessages(prev => {
        // Filter out temp messages that are now in the server response
        const serverIds = new Set(newMessages.map(m => m.id));
        const remainingTemp = prev.filter(m => m.isTemp && !serverIds.has(m.id));
        
        // Merge and sort
        const combined = [...newMessages, ...remainingTemp];
        return combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      });
    } catch (e) {
      console.error("Failed to fetch messages", e);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      fetchMessages();
      const interval = setInterval(fetchMessages, 5000);
      return () => clearInterval(interval);
    }, [fetchMessages])
  );

  const handleSend = async () => {
    if (!inputText.trim() || !user || isSending) return;

    const text = inputText.trim();
    setInputText("");
    
    const tempId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    const tempMsg: Message = {
      id: tempId,
      crew_id: id,
      user_id: user.id,
      sender_name: user.name || "Me",
      message: text,
      created_at: new Date().toISOString(),
      isTemp: true,
    };

    setMessages(prev => [tempMsg, ...prev]);

    try {
      const res = await apiRequest("POST", `/api/crews/${id}/messages`, { message: text });
      const savedMsg: Message = await res.json();
      
      setMessages(prev => prev.map(m => m.id === tempId ? savedMsg : m));
    } catch (e) {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      Alert.alert("Error", "Failed to send message. Please try again.");
    }
  };

  const renderMessage = ({ item }: { item: Message }) => {
    const isMe = item.user_id === user?.id;
    const date = new Date(item.created_at);
    const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const initials = item.sender_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

    // ── Milestone message ───────────────────────────────────────────
    if (item.message_type === 'milestone') {
      return (
        <View style={s.milestoneContainer}>
          <View style={s.milestoneBubble}>
            <Text style={s.milestoneText}>{item.message}</Text>
            <Text style={s.milestoneSubText}>via {item.sender_name}</Text>
          </View>
          <Text style={s.timestamp}>{timeStr}</Text>
        </View>
      );
    }

    // ── Prompt message (context-aware event prompt) ─────────────────
    if (item.message_type === 'prompt') {
      const quickReplies = item.metadata?.quickReplies ?? [];
      return (
        <View style={s.otherMessageContainer}>
          <View style={s.avatarContainer}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{initials}</Text>
            </View>
          </View>
          <View style={s.otherContent}>
            <Text style={s.senderName}>{item.sender_name}</Text>
            <View style={s.promptBubble}>
              <Text style={s.promptText}>{item.message}</Text>
              {quickReplies.length > 0 && (
                <View style={s.quickReplyRow}>
                  {quickReplies.map((reply: string) => (
                    <TouchableOpacity
                      key={reply}
                      style={s.quickReplyChip}
                      onPress={() => {
                        setInputText(reply);
                      }}
                    >
                      <Text style={s.quickReplyTxt}>{reply}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
            <Text style={s.timestamp}>{timeStr}</Text>
          </View>
        </View>
      );
    }

    // ── Standard message ────────────────────────────────────────────
    if (isMe) {
      return (
        <View style={s.myMessageContainer}>
          <View style={s.myBubble}>
            <Text style={s.myMessageText}>{item.message}</Text>
          </View>
          <Text style={s.timestamp}>{timeStr}</Text>
        </View>
      );
    }

    return (
      <View style={s.otherMessageContainer}>
        <View style={s.avatarContainer}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
        </View>
        <View style={s.otherContent}>
          <Text style={s.senderName}>{item.sender_name}</Text>
          <View style={s.otherBubble}>
            <Text style={s.otherMessageText}>{item.message}</Text>
          </View>
          <Text style={s.timestamp}>{timeStr}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={s.container}>
      {/* Header */}
      <ScreenHeader
        title={crew?.name || "Crew Chat"}
        topPaddingExtra={Platform.OS === "web" ? 67 : 0}
        right={<Text style={s.memberCount}>{crew?.member_count || 0} members</Text>}
      />

      <FlatList
        data={messages}
        renderItem={renderMessage}
        keyExtractor={item => item.id}
        inverted={true}
        contentContainerStyle={s.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={s.emptyState}>
            <Feather name="message-circle" size={40} color={C.textMuted} />
            <Text style={s.emptyText}>No messages yet{"\n"}Say hello! 👋</Text>
          </View>
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <View style={[
          s.inputContainer,
          { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 8) }
        ]}>
          <TextInput
            style={s.input}
            placeholder="Message..."
            placeholderTextColor={C.textMuted}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={1000}
          />
          <TouchableOpacity
            onPress={handleSend}
            disabled={!inputText.trim()}
            style={[s.sendBtn, !inputText.trim() && { opacity: 0.5 }]}
          >
            <Feather name="send" size={20} color={C.primary} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (C: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  memberCount: {
    fontSize: 12,
    color: C.textMuted,
    fontFamily: "Outfit_400Regular",
  },
  listContent: {
    padding: 16,
    paddingTop: 8,
  },
  myMessageContainer: {
    alignItems: "flex-end",
    marginBottom: 16,
  },
  myBubble: {
    backgroundColor: C.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    maxWidth: "80%",
  },
  myMessageText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontFamily: "Outfit_400Regular",
  },
  otherMessageContainer: {
    flexDirection: "row",
    marginBottom: 16,
  },
  avatarContainer: {
    marginRight: 8,
    justifyContent: "flex-end",
    paddingBottom: 14, // align with bubble bottom
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 12,
    fontWeight: "600",
    color: C.textMuted,
    fontFamily: "Outfit_600SemiBold",
  },
  otherContent: {
    flex: 1,
    maxWidth: "80%",
  },
  senderName: {
    fontSize: 12,
    color: C.textMuted,
    marginBottom: 4,
    marginLeft: 4,
    fontFamily: "Outfit_400Regular",
  },
  otherBubble: {
    backgroundColor: C.card,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    alignSelf: "flex-start",
  },
  otherMessageText: {
    color: C.text,
    fontSize: 15,
    fontFamily: "Outfit_400Regular",
  },
  timestamp: {
    fontSize: 10,
    color: C.textMuted,
    marginTop: 4,
    marginHorizontal: 4,
    fontFamily: "Outfit_400Regular",
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    backgroundColor: C.bg,
  },
  input: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    marginRight: 8,
    maxHeight: 100,
    color: C.text,
    fontSize: 15,
    fontFamily: "Outfit_400Regular",
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  emptyState: {
    flex: 1,
    height: 400, // Reasonable height for centering in inverted FlatList
    justifyContent: "center",
    alignItems: "center",
    transform: [{ scaleY: -1 }], // Flip because FlatList is inverted
  },
  emptyText: {
    fontSize: 16,
    color: C.textMuted,
    textAlign: "center",
    marginTop: 12,
    lineHeight: 24,
    fontFamily: "Outfit_400Regular",
  },
  // Milestone message — centred gold card
  milestoneContainer: {
    alignItems: "center",
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  milestoneBubble: {
    backgroundColor: C.gold + "18",
    borderWidth: 1,
    borderColor: C.gold + "40",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
  },
  milestoneText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.gold,
    textAlign: "center",
  },
  milestoneSubText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: C.textMuted,
    marginTop: 2,
    textAlign: "center",
  },
  // Prompt message bubble
  promptBubble: {
    backgroundColor: C.primary + "18",
    borderWidth: 1,
    borderColor: C.primary + "35",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  promptText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: C.text,
    marginBottom: 10,
  },
  quickReplyRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  quickReplyChip: {
    backgroundColor: C.primary,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  quickReplyTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.bg,
  },
});
