import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
  Share,
  Platform,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { useTheme } from "@/contexts/ThemeContext";

type SharePath = {
  id: string;
  name: string;
  community_path_id?: string | null;
  route_path?: Array<{ latitude: number; longitude: number }> | null;
};

type FriendItem = {
  id: string;
  name: string;
  username?: string | null;
  photo_url?: string | null;
};

export default function SharePathSheet({
  visible,
  path,
  onClose,
}: {
  visible: boolean;
  path: SharePath | null;
  onClose: () => void;
}) {
  const { C } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [justPublished, setJustPublished] = useState(false);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: friends = [] } = useQuery<FriendItem[]>({
    queryKey: ["/api/friends"],
    enabled: visible,
    staleTime: 60_000,
  });

  const filteredFriends = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return friends;
    return friends.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.username ?? "").toLowerCase().includes(q)
    );
  }, [friends, search]);

  const isPublished = !!(path?.community_path_id || justPublished);
  const deepLink = path ? `paceup://path/${path.id}` : "";

  const handleClose = () => {
    setSearch("");
    setPublishing(false);
    setSendingTo(null);
    setCopied(false);
    setJustPublished(false);
    onClose();
  };

  const handlePublish = async () => {
    if (!path) return;
    if (isPublished) {
      Alert.alert("Already on Map", "This route is already visible on the community map.");
      return;
    }
    if (!path.route_path || path.route_path.length < 2) {
      Alert.alert("No Route", "This path has no GPS route data to publish.");
      return;
    }
    setPublishing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await apiRequest("POST", `/api/saved-paths/${path.id}/publish`);
      const data = await res.json();
      if (data.alreadyPublished) {
        Alert.alert("Already on Map", "This route is already visible on the community map.");
      } else {
        setJustPublished(true);
        qc.invalidateQueries({ queryKey: ["/api/saved-paths"] });
        qc.invalidateQueries({ queryKey: ["/api/community-paths"] });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not publish route.");
    } finally {
      setPublishing(false);
    }
  };

  const handleCopy = async () => {
    if (!path) return;
    try {
      await Clipboard.setStringAsync(deepLink);
      setCopied(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      Alert.alert("Error", "Could not copy link.");
    }
  };

  const handleShareExternal = async () => {
    if (!path) return;
    try {
      await Share.share({
        message: `Check out my route "${path.name}" on PaceUp: ${deepLink}`,
        url: Platform.OS === "ios" ? deepLink : undefined,
      });
    } catch {
      // user cancelled — ignore
    }
  };

  const handleSendToFriend = async (friend: FriendItem) => {
    if (!path) return;
    setSendingTo(friend.id);
    try {
      await apiRequest("POST", `/api/saved-paths/${path.id}/share`, { toUserId: friend.id });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Shared!", `Route sent to ${friend.name}.`);
      handleClose();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not share route.");
    } finally {
      setSendingTo(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.55)" }]}
          onPress={handleClose}
        />
        <View
          style={{
            backgroundColor: C.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 20,
            paddingBottom: insets.bottom + 20,
            maxHeight: "85%",
          }}
        >
          <View
            style={{
              alignSelf: "center",
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: C.border,
              marginBottom: 16,
            }}
          />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text }}>Share Route</Text>
            <Pressable onPress={handleClose} hitSlop={12}>
              <Feather name="x" size={22} color={C.textSecondary} />
            </Pressable>
          </View>
          {path && (
            <Text
              style={{
                fontFamily: "Outfit_400Regular",
                fontSize: 13,
                color: C.textSecondary,
                marginBottom: 16,
              }}
              numberOfLines={1}
            >
              {path.name}
            </Text>
          )}

          {/* Add to Public Map */}
          <Pressable
            disabled={publishing || isPublished}
            onPress={handlePublish}
            style={{
              backgroundColor: isPublished ? C.primaryMuted ?? C.primary + "22" : C.primary,
              borderRadius: 12,
              paddingVertical: 14,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "row",
              gap: 8,
              marginBottom: 12,
              borderWidth: isPublished ? 1 : 0,
              borderColor: C.primary + "55",
              opacity: publishing ? 0.7 : 1,
            }}
          >
            {publishing ? (
              <ActivityIndicator size="small" color={isPublished ? C.primary : C.bg} />
            ) : (
              <Ionicons
                name={isPublished ? "checkmark-circle" : "globe-outline"}
                size={18}
                color={isPublished ? C.primary : C.bg}
              />
            )}
            <Text
              style={{
                fontFamily: "Outfit_700Bold",
                fontSize: 14,
                color: isPublished ? C.primary : C.bg,
              }}
            >
              {isPublished ? "On Public Map" : "Add to Public Map"}
            </Text>
          </Pressable>

          {/* Copy + Share row */}
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 18 }}>
            <Pressable
              onPress={handleCopy}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                backgroundColor: C.card,
                borderWidth: 1,
                borderColor: C.border,
                borderRadius: 12,
                paddingVertical: 12,
              }}
            >
              <Feather name={copied ? "check" : "link-2"} size={16} color={copied ? C.primary : C.text} />
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 13,
                  color: copied ? C.primary : C.text,
                }}
              >
                {copied ? "Copied!" : "Copy Link"}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleShareExternal}
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                backgroundColor: C.card,
                borderWidth: 1,
                borderColor: C.border,
                borderRadius: 12,
                paddingVertical: 12,
              }}
            >
              <Feather name="share" size={16} color={C.text} />
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.text }}>
                Text / Share
              </Text>
            </Pressable>
          </View>

          {/* Friends */}
          <Text
            style={{
              fontFamily: "Outfit_600SemiBold",
              fontSize: 12,
              color: C.textMuted,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Send to a friend
          </Text>
          <TextInput
            style={{
              backgroundColor: C.card,
              borderRadius: 10,
              paddingHorizontal: 14,
              paddingVertical: 10,
              fontFamily: "Outfit_400Regular",
              fontSize: 14,
              color: C.text,
              borderWidth: 1,
              borderColor: C.border,
              marginBottom: 10,
            }}
            placeholder="Search friends…"
            placeholderTextColor={C.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 280 }}
          >
            {filteredFriends.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 24 }}>
                <Feather name="users" size={28} color={C.textMuted} />
                <Text
                  style={{
                    fontFamily: "Outfit_400Regular",
                    fontSize: 14,
                    color: C.textMuted,
                    marginTop: 8,
                  }}
                >
                  {friends.length === 0 ? "No friends yet" : "No friends match your search"}
                </Text>
              </View>
            ) : (
              filteredFriends.map((friend) => (
                <Pressable
                  key={friend.id}
                  disabled={!!sendingTo}
                  onPress={() => handleSendToFriend(friend)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 10,
                    paddingHorizontal: 4,
                    opacity: pressed || sendingTo === friend.id ? 0.55 : 1,
                    borderBottomWidth: 1,
                    borderBottomColor: C.border,
                  })}
                >
                  {friend.photo_url ? (
                    <Image
                      source={{ uri: friend.photo_url }}
                      style={{ width: 40, height: 40, borderRadius: 20 }}
                    />
                  ) : (
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: C.primaryMuted ?? C.primary + "22",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: "Outfit_700Bold",
                          fontSize: 15,
                          color: C.primary,
                        }}
                      >
                        {friend.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text }}>
                      {friend.name}
                    </Text>
                    {friend.username ? (
                      <Text
                        style={{
                          fontFamily: "Outfit_400Regular",
                          fontSize: 12,
                          color: C.textMuted,
                        }}
                      >
                        @{friend.username}
                      </Text>
                    ) : null}
                  </View>
                  {sendingTo === friend.id ? (
                    <ActivityIndicator size="small" color={C.primary} />
                  ) : (
                    <Feather name="send" size={16} color={C.textMuted} />
                  )}
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
