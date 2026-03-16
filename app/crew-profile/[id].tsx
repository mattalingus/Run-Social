import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Platform,
  Alert,
} from "react-native";
import { useLocalSearchParams, router, Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons, Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image as ExpoImage } from "expo-image";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { useAuth } from "@/contexts/AuthContext";
import { darkColors } from "@/constants/colors";

const C = darkColors;

interface Crew {
  id: string;
  name: string;
  description?: string;
  emoji: string;
  image_url?: string;
  member_count?: number;
  run_style?: string;
  tags?: string[];
  created_by_name?: string;
}

function resolveImgUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `${getApiUrl()}${url}`;
}

export default function CrewProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: crew, isLoading } = useQuery<Crew>({
    queryKey: ["/api/crews", id],
    enabled: !!id,
  });

  const joinMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/crews/${id}/join-request`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crews", id] });
      Alert.alert("Request sent", "The crew chief will review your request.");
    },
    onError: (e: any) => {
      const msg = e?.message || "Could not send join request";
      Alert.alert("Error", msg);
    },
  });

  const webTopInset = Platform.OS === "web" ? 67 : 0;

  if (isLoading) {
    return (
      <View style={[s.container, { paddingTop: insets.top + webTopInset + 60 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  if (!crew) {
    return (
      <View style={[s.container, { paddingTop: insets.top + webTopInset + 60 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={s.errorTxt}>Crew not found</Text>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Text style={s.backBtnTxt}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const imgSrc = resolveImgUrl(crew.image_url);

  return (
    <View style={[s.container, { paddingTop: insets.top + webTopInset }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <Pressable onPress={() => router.back()} style={s.topBack} hitSlop={12}>
        <Ionicons name="chevron-back" size={24} color={C.textPrimary} />
      </Pressable>

      <View style={s.hero}>
        {imgSrc ? (
          <ExpoImage source={{ uri: imgSrc }} style={s.heroImg} contentFit="cover" />
        ) : (
          <View style={s.emojiCircle}>
            <Text style={s.emojiTxt}>{crew.emoji}</Text>
          </View>
        )}
        <Text style={s.crewName}>{crew.name}</Text>
        <Text style={s.memberCount}>
          {crew.member_count} member{crew.member_count !== 1 ? "s" : ""}
        </Text>
      </View>

      {crew.description ? (
        <Text style={s.desc}>{crew.description}</Text>
      ) : null}

      {crew.run_style ? (
        <View style={s.tagRow}>
          <Ionicons name="fitness-outline" size={14} color={C.textSecondary} />
          <Text style={s.tagTxt}>{crew.run_style}</Text>
        </View>
      ) : null}

      {crew.tags && crew.tags.length > 0 ? (
        <View style={s.tagsWrap}>
          {crew.tags.map((t) => (
            <View key={t} style={s.tagPill}>
              <Text style={s.tagPillTxt}>{t}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={s.createdBy}>
        Created by {crew.created_by_name}
      </Text>

      {user ? (
        <Pressable
          style={[s.joinBtn, joinMut.isPending && { opacity: 0.5 }]}
          onPress={() => joinMut.mutate()}
          disabled={joinMut.isPending || joinMut.isSuccess}
        >
          {joinMut.isSuccess ? (
            <>
              <Ionicons name="checkmark-circle" size={18} color="#fff" />
              <Text style={s.joinBtnTxt}>Request sent</Text>
            </>
          ) : (
            <>
              <Feather name="user-plus" size={18} color="#fff" />
              <Text style={s.joinBtnTxt}>
                {joinMut.isPending ? "Sending..." : "Request to join"}
              </Text>
            </>
          )}
        </Pressable>
      ) : (
        <Text style={s.loginHint}>Log in to request to join this crew</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
    paddingHorizontal: 24,
  },
  topBack: {
    marginTop: 12,
    marginBottom: 8,
    alignSelf: "flex-start",
  },
  hero: {
    alignItems: "center",
    marginTop: 16,
    marginBottom: 20,
  },
  heroImg: {
    width: 96,
    height: 96,
    borderRadius: 48,
    marginBottom: 14,
  },
  emojiCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: C.surface,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
  },
  emojiTxt: { fontSize: 40 },
  crewName: {
    fontFamily: "Outfit_700Bold",
    fontSize: 26,
    color: C.textPrimary,
    textAlign: "center",
  },
  memberCount: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textSecondary,
    marginTop: 4,
  },
  desc: {
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: C.textSecondary,
    lineHeight: 22,
    marginBottom: 16,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  tagTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textSecondary,
  },
  tagsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  tagPill: {
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagPillTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.textSecondary,
  },
  createdBy: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.textTertiary,
    marginBottom: 28,
  },
  joinBtn: {
    backgroundColor: C.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  joinBtnTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 16,
    color: "#fff",
  },
  errorTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 16,
    color: C.textSecondary,
    textAlign: "center",
  },
  backBtn: {
    marginTop: 16,
    alignSelf: "center",
  },
  backBtnTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    color: C.primary,
  },
  loginHint: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textTertiary,
    textAlign: "center",
  },
});
