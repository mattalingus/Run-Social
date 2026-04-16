import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
  Image,
  Modal,
  TouchableOpacity,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { useTheme } from "@/contexts/ThemeContext";
import { type ColorScheme } from "@/constants/colors";
import ShareActivityModal from "@/components/ShareActivityModal";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPace(pace: number | null): string {
  if (!pace || pace <= 0) return "--:--";
  const m = Math.floor(pace);
  const s = Math.round((pace - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDist(dist: number | null): string {
  if (!dist || dist <= 0) return "0.00";
  return dist.toFixed(2);
}

const RANK_COLORS: Record<number, string> = {
  1: "#FFD700",
  2: "#C0C0C0",
  3: "#CD7F32",
};

// ─── Screen ──────────────────────────────────────────────────────────────────

function resolvePhotoUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return new URL(url, getApiUrl()).toString();
}

export default function RunResultsScreen() {
  const { id, autoShare } = useLocalSearchParams<{ id: string; autoShare?: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);

  const [showShare, setShowShare] = useState(false);
  const autoShownRef = useRef(false);
  const [viewerPhoto, setViewerPhoto] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const { data: results = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/runs", id, "results"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}/results`);
      return res.json();
    },
    refetchInterval: 10000,
    staleTime: 0,
  });

  useEffect(() => {
    if (autoShare === "1" && !autoShownRef.current && !isLoading) {
      autoShownRef.current = true;
      const timer = setTimeout(() => setShowShare(true), 600);
      return () => clearTimeout(timer);
    }
  }, [autoShare, isLoading]);

  const { data: run } = useQuery<any>({
    queryKey: ["/api/runs", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}`);
      return res.json();
    },
  });

  const { data: photos = [] } = useQuery<any[]>({
    queryKey: ["/api/runs", id, "photos"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}/photos`);
      return res.json();
    },
    refetchInterval: 10000,
    staleTime: 0,
  });

  async function pickAndUploadPhoto() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      setUploadingPhoto(true);
      const asset = result.assets[0];
      const formData = new FormData();
      formData.append("photo", {
        uri: asset.uri,
        name: `photo_${Date.now()}.jpg`,
        type: "image/jpeg",
      } as any);
      const url = new URL(`/api/runs/${id}/photos`, getApiUrl());
      await fetch(url.toString(), {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      qc.invalidateQueries({ queryKey: ["/api/runs", id, "photos"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (_) {
    } finally {
      setUploadingPhoto(false);
    }
  }

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const isRide = run?.activity_type === "ride";
  const isWalk = run?.activity_type === "walk";
  const actLabel = isRide ? "Ride" : isWalk ? "Walk" : "Run";
  const actorLabel = isRide ? "Riders" : isWalk ? "Walkers" : "Runners";
  const actIngLabel = isRide ? "riding" : isWalk ? "walking" : "running";
  const stillRunning = results.filter((r) => r.is_present && r.final_rank == null);
  const finished = results.filter((r) => r.final_rank != null).sort((a, b) => a.final_rank - b.final_rank);
  const isParticipant = results.some((r: any) => r.user_id === user?.id);
  const hasPaceGroups = run?.pace_groups && (run.pace_groups as any[]).length > 0;
  const hasAnyGroupLabel = finished.some((r: any) => r.pace_group_label);

  const { data: aiSummary, isLoading: summaryLoading } = useQuery<{ summary: string } | undefined>({
    queryKey: ["/api/solo-runs", id, "ai-summary"],
    enabled: !!id,
    retry: false,
    staleTime: Infinity,
    queryFn: async () => {
      try {
        const res = await apiRequest("POST", `/api/solo-runs/${id}/ai-summary`);
        const data = await res.json();
        if (typeof data?.summary !== "string" || data.summary.length === 0) return undefined;
        return { summary: data.summary as string };
      } catch {
        return undefined;
      }
    },
  });

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={[s.header, { paddingTop: topPad + 12 }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={C.text} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>{actLabel} Results</Text>
          {run?.title && <Text style={s.headerSub}>{run.title}</Text>}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable
            style={s.backBtn}
            hitSlop={12}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowShare(true);
            }}
          >
            <Feather name="share-2" size={18} color={C.primary} />
          </Pressable>
          <Pressable
            style={s.doneBtn}
            onPress={() => router.push(`/run/${id}`)}
          >
            <Text style={s.doneBtnText}>Done</Text>
          </Pressable>
        </View>
      </View>

      {isLoading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator color={C.primary} size="large" />
          <Text style={s.loadingText}>Loading results…</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[s.content, { paddingBottom: botPad + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Summary */}
          <View style={s.summaryCard}>
            <View style={s.summaryItem}>
              <Feather name="users" size={18} color={C.primary} />
              <Text style={s.summaryValue}>{results.length}</Text>
              <Text style={s.summaryLabel}>{actorLabel}</Text>
            </View>
            <View style={s.summaryDivider} />
            <View style={s.summaryItem}>
              <Feather name="check-circle" size={18} color={C.primary} />
              <Text style={s.summaryValue}>{finished.length}</Text>
              <Text style={s.summaryLabel}>Finished</Text>
            </View>
            <View style={s.summaryDivider} />
            <View style={s.summaryItem}>
              <Feather name="activity" size={18} color={stillRunning.length > 0 ? C.primary : C.textSecondary} />
              <Text style={[s.summaryValue, { color: stillRunning.length > 0 ? C.primary : C.textSecondary }]}>
                {stillRunning.length}
              </Text>
              <Text style={s.summaryLabel}>Still {actIngLabel}</Text>
            </View>
          </View>

          {/* AI Coach Summary Card */}
          {aiSummary?.summary && (
            <View style={s.aiCoachCard}>
              <Text style={s.aiCoachText}>{aiSummary.summary}</Text>
            </View>
          )}
          {summaryLoading && !aiSummary && (
            <View style={[s.aiCoachCard, { height: 100, justifyContent: "center", alignItems: "center" }]}>
               <ActivityIndicator size="small" color={C.primary} />
            </View>
          )}

          {/* Leaderboard */}
          {finished.length > 0 && (() => {
            const renderRunner = (runner: any) => {
              const isMe = runner.user_id === user?.id;
              const rankColor = RANK_COLORS[runner.final_rank] ?? C.textSecondary;
              return (
                <View key={runner.user_id} style={[s.runnerCard, isMe && s.runnerCardMe]}>
                  <View style={[s.rankBadge, { borderColor: rankColor + "66" }]}>
                    {runner.final_rank <= 3 ? (
                      <Ionicons name="trophy" size={14} color={rankColor} />
                    ) : (
                      <Text style={[s.rankNumber, { color: rankColor }]}>#{runner.final_rank}</Text>
                    )}
                  </View>
                  <View style={[s.avatar, isMe && s.avatarMe]}>
                    <Text style={[s.avatarText, isMe && s.avatarTextMe]}>
                      {runner.name?.[0]?.toUpperCase() ?? "?"}
                    </Text>
                  </View>
                  <View style={s.runnerInfo}>
                    <Text style={[s.runnerName, isMe && s.runnerNameMe]}>
                      {runner.name}{isMe ? " (you)" : ""}
                    </Text>
                    <View style={s.runnerStats}>
                      <Text style={s.runnerStatText}>{formatDist(runner.final_distance)} mi</Text>
                      <Text style={s.runnerStatDot}>·</Text>
                      <Text style={s.runnerStatText}>{formatPace(runner.final_pace)} /mi</Text>
                    </View>
                  </View>
                  {runner.final_rank <= 3 && (
                    <Text style={[s.rankLabel, { color: rankColor }]}>
                      {runner.final_rank === 1 ? "1st" : runner.final_rank === 2 ? "2nd" : "3rd"}
                    </Text>
                  )}
                </View>
              );
            };

            if (hasPaceGroups && hasAnyGroupLabel) {
              const paceGroupDefs = run.pace_groups as any[];
              const groups: Record<string, any[]> = {};
              const ungrouped: any[] = [];
              for (const r of finished) {
                if (r.pace_group_label) {
                  if (!groups[r.pace_group_label]) groups[r.pace_group_label] = [];
                  groups[r.pace_group_label].push(r);
                } else {
                  ungrouped.push(r);
                }
              }
              const orderedLabels = [
                ...paceGroupDefs.map((g: any) => g.label).filter((l: string) => groups[l]),
                ...Object.keys(groups).filter((l) => !paceGroupDefs.find((g: any) => g.label === l)),
              ];

              return (
                <View style={s.section}>
                  <Text style={s.sectionTitle}>Leaderboard by Pace Group</Text>
                  {orderedLabels.map((label) => {
                    const groupDef = paceGroupDefs.find((g: any) => g.label === label);
                    return (
                      <View key={label} style={{ marginBottom: 20 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                          <View style={{ backgroundColor: C.primaryMuted, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: C.primary + "44" }}>
                            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 14, color: C.primary }}>{label}</Text>
                          </View>
                          {groupDef && (
                            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted }}>
                              {groupDef.minPace}–{groupDef.maxPace} min/mi
                            </Text>
                          )}
                        </View>
                        {groups[label].map(renderRunner)}
                      </View>
                    );
                  })}
                  {ungrouped.length > 0 && (
                    <View>
                      <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textMuted, marginBottom: 6 }}>No Group</Text>
                      {ungrouped.map(renderRunner)}
                    </View>
                  )}
                </View>
              );
            }

            return (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Leaderboard</Text>
                {finished.map(renderRunner)}
              </View>
            );
          })()}

          {/* Still going */}
          {stillRunning.length > 0 && (
            <View style={s.section}>
              <View style={s.sectionTitleRow}>
                <View style={s.liveDot} />
                <Text style={s.sectionTitle}>Still {actIngLabel.charAt(0).toUpperCase() + actIngLabel.slice(1)}</Text>
              </View>
              {stillRunning.map((runner) => {
                const isMe = runner.user_id === user?.id;
                return (
                  <View key={runner.user_id} style={[s.runnerCard, isMe && s.runnerCardMe]}>
                    <View style={s.stillRunningIcon}>
                      <ActivityIndicator size="small" color={C.primary} />
                    </View>
                    <View style={[s.avatar, isMe && s.avatarMe]}>
                      <Text style={[s.avatarText, isMe && s.avatarTextMe]}>
                        {runner.name?.[0]?.toUpperCase() ?? "?"}
                      </Text>
                    </View>
                    <View style={s.runnerInfo}>
                      <Text style={[s.runnerName, isMe && s.runnerNameMe]}>
                        {runner.name}{isMe ? " (you)" : ""}
                      </Text>
                      <Text style={s.runnerStatText}>In progress…</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {results.length === 0 && (
            <View style={s.emptyWrap}>
              <Feather name="flag" size={40} color={C.border} />
              <Text style={s.emptyTitle}>No results yet</Text>
              <Text style={s.emptyText}>
                {`${actorLabel} haven't finished yet. Results will appear here as they cross the finish line.`}
              </Text>
            </View>
          )}

          {/* ── Event Photos ─────────────────────────────────────────────────── */}
          <View style={s.photosSection}>
            <View style={s.photosSectionHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="camera-outline" size={16} color={C.primary} />
                <Text style={s.sectionTitle}>
                  Event Photos{photos.length > 0 ? ` (${photos.length})` : ""}
                </Text>
              </View>
              {isParticipant && (
                <TouchableOpacity
                  style={s.addPhotoBtn}
                  onPress={pickAndUploadPhoto}
                  disabled={uploadingPhoto}
                >
                  {uploadingPhoto ? (
                    <ActivityIndicator size="small" color={C.primary} />
                  ) : (
                    <Feather name="plus" size={14} color={C.primary} />
                  )}
                  <Text style={s.addPhotoBtnText}>Add</Text>
                </TouchableOpacity>
              )}
            </View>
            {photos.length === 0 ? (
              <Text style={s.photosEmpty}>Be the first to add a photo! 📸</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
                {photos.map((photo: any) => (
                  <TouchableOpacity
                    key={photo.id}
                    onPress={() => setViewerPhoto(resolvePhotoUrl(photo.photo_url))}
                    activeOpacity={0.85}
                  >
                    <Image
                      source={{ uri: resolvePhotoUrl(photo.photo_url) }}
                      style={s.photoThumb}
                    />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </ScrollView>
      )}

      {/* ── Photo Viewer Modal ────────────────────────────────────────────────── */}
      <Modal visible={!!viewerPhoto} transparent animationType="fade" onRequestClose={() => setViewerPhoto(null)}>
        <View style={s.photoViewerOverlay}>
          <TouchableOpacity style={s.photoViewerClose} onPress={() => setViewerPhoto(null)}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          {viewerPhoto && (
            <Image source={{ uri: viewerPhoto }} style={s.photoViewerImg} resizeMode="contain" />
          )}
        </View>
      </Modal>

      {/* ── Share Activity Modal ──────────────────────────────────────────────── */}
      {(() => {
        const myResult = results.find((r: any) => r.user_id === user?.id);
        const isGroupRun = results.length > 1;
        return (
          <ShareActivityModal
            visible={showShare}
            onClose={() => setShowShare(false)}
            eventPhotos={photos.map((p: any) => resolvePhotoUrl(p.photo_url)).filter(Boolean)}
            runData={{
              distanceMi: myResult?.final_distance ?? run?.min_distance ?? 0,
              paceMinPerMile: myResult?.final_pace ?? null,
              durationSeconds: (myResult?.final_pace && myResult?.final_distance)
                ? Math.round(myResult.final_pace * myResult.final_distance * 60)
                : null,
              routePath: myResult?.route_path ?? run?.route_path ?? run?.saved_path_route ?? [],
              activityType: (run?.activity_type ?? "run") as "run" | "ride" | "walk",
              participantCount: isGroupRun ? results.length : undefined,
              finishRank: isGroupRun && myResult?.final_rank ? myResult.final_rank : undefined,
              eventTitle: run?.crew_id && run?.crew_name ? run.crew_name : run?.title,
            }}
          />
        );
      })()}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function makeStyles(C: ColorScheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    header: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 16, paddingBottom: 14,
      borderBottomWidth: 1, borderBottomColor: C.border,
      backgroundColor: C.bg,
    },
    backBtn: {
      width: 38, height: 38, borderRadius: 19,
      backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
      alignItems: "center", justifyContent: "center",
    },
    headerCenter: { flex: 1, alignItems: "center", gap: 2 },
    headerTitle: { fontFamily: "Outfit_700Bold", fontSize: 17, color: C.text },
    headerSub: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
    doneBtn: {
      backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8,
      borderWidth: 1, borderColor: C.border,
    },
    doneBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
    loadingText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary },
    content: { paddingHorizontal: 16, paddingTop: 16, gap: 20 },
    summaryCard: {
      flexDirection: "row", backgroundColor: C.card, borderRadius: 16,
      padding: 16, borderWidth: 1, borderColor: C.border, alignItems: "center",
    },
    summaryItem: { flex: 1, alignItems: "center", gap: 4 },
    summaryValue: { fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text },
    summaryLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textSecondary },
    summaryDivider: { width: 1, height: 40, backgroundColor: C.border },
    section: { gap: 10 },
    sectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },
    sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
    runnerCard: {
      flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: C.card, borderRadius: 14, padding: 14,
      borderWidth: 1, borderColor: C.border,
    },
    runnerCardMe: { borderColor: C.primary + "66", backgroundColor: C.primaryMuted },
    rankBadge: {
      width: 32, height: 32, borderRadius: 8, borderWidth: 1.5,
      alignItems: "center", justifyContent: "center",
    },
    rankNumber: { fontFamily: "Outfit_700Bold", fontSize: 13 },
    avatar: {
      width: 40, height: 40, borderRadius: 20,
      backgroundColor: C.surface, alignItems: "center", justifyContent: "center",
      borderWidth: 1, borderColor: C.border,
    },
    avatarMe: { backgroundColor: C.primaryMuted, borderColor: C.primary + "55" },
    avatarText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.textSecondary },
    avatarTextMe: { color: C.primary },
    runnerInfo: { flex: 1, gap: 3 },
    runnerName: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
    runnerNameMe: { color: C.primary },
    runnerStats: { flexDirection: "row", alignItems: "center", gap: 4 },
    runnerStatText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
    runnerStatDot: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.border },
    rankLabel: { fontFamily: "Outfit_700Bold", fontSize: 14 },
    stillRunningIcon: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
    emptyWrap: { alignItems: "center", paddingVertical: 48, gap: 12 },
    emptyTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text },
    emptyText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center", lineHeight: 20 },
    photosSection: { gap: 10 },
    photosSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    addPhotoBtn: {
      flexDirection: "row", alignItems: "center", gap: 4,
      backgroundColor: C.primaryMuted, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
      borderWidth: 1, borderColor: C.primary + "55",
    },
    addPhotoBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },
    photosEmpty: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary, fontStyle: "italic" },
    photoThumb: { width: 80, height: 80, borderRadius: 8, margin: 4 },
    photoViewerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.95)", justifyContent: "center", alignItems: "center" },
    photoViewerClose: {
      position: "absolute", top: 52, right: 20,
      width: 40, height: 40, borderRadius: 20,
      backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center",
    },
    photoViewerImg: { width: "100%" as any, height: "80%" as any },
    aiCoachCard: {
      backgroundColor: C.primaryMuted,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: C.primary + "33",
      marginBottom: 20,
    },
    aiCoachHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 8,
    },
    aiIconBox: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: C.primary + "22",
      alignItems: "center",
      justifyContent: "center",
    },
    aiCoachTitle: {
      fontFamily: "Outfit_700Bold",
      fontSize: 12,
      color: C.primary,
      letterSpacing: 1,
    },
    aiCoachText: {
      fontFamily: "Outfit_400Regular",
      fontSize: 14,
      color: C.text,
      lineHeight: 20,
    },
  });
}
