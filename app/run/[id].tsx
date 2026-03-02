import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  TextInput,
  Platform,
  Image,
  Modal,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import C from "@/constants/colors";
import { formatDistance } from "@/lib/formatDistance";
import HostProfileSheet from "@/components/HostProfileSheet";

function haversineKmDetail(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getHostBadge(hostedRuns?: number): { label: string; color: string } | null {
  if (!hostedRuns || hostedRuns < 1) return null;
  if (hostedRuns === 1) return { label: "1st Run", color: "#A0C4FF" };
  if (hostedRuns < 5)   return { label: "Bronze",  color: "#CD7F32" };
  if (hostedRuns < 20)  return { label: "Silver",  color: "#9E9E9E" };
  if (hostedRuns < 100) return { label: "Gold",    color: "#FFD700" };
  if (hostedRuns < 500) return { label: "Platinum", color: "#B0E0E6" };
  return { label: "Elite", color: "#C084FC" };
}

const RUN_TAG_ICONS: Record<string, string> = {
  Talkative: "message-circle",
  Quiet: "moon",
  Motivational: "zap",
  Training: "activity",
  Ministry: "heart",
  Recovery: "wind",
};

function formatPace(pace: number) {
  const mins = Math.floor(pace);
  const secs = Math.round((pace - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDateFull(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function RunDetailScreen() {
  const { id, token } = useLocalSearchParams<{ id: string; token?: string }>();
  const insets = useSafeAreaInsets();
  const { user, refreshUser } = useAuth();
  const qc = useQueryClient();
  const [joining, setJoining] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [proximityTriggered, setProximityTriggered] = useState(false);
  const [starting, setStarting] = useState(false);
  const [hostDist, setHostDist] = useState<number | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [tokenInput, setTokenInput] = useState(token || "");
  const [accessError, setAccessError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  const [hostProfileId, setHostProfileId] = useState<string | null>(null);

  const { data: run, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/runs", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}`);
      if (!res.ok) {
        const body = await res.json();
        return body;
      }
      return res.json();
    },
  });

  async function handleUnlockWithPassword() {
    if (!passwordInput.trim() && !tokenInput.trim()) {
      setAccessError("Enter a password or invite code");
      return;
    }
    setUnlocking(true);
    setAccessError("");
    try {
      const res = await apiRequest("POST", `/api/runs/${id}/join-private`, {
        password: passwordInput.trim() || undefined,
        token: tokenInput.trim() || undefined,
      });
      if (!res.ok) {
        const body = await res.json();
        setAccessError(body.message || "Incorrect password or code");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        refetch();
      }
    } catch {
      setAccessError("Something went wrong. Try again.");
    } finally {
      setUnlocking(false);
    }
  }

  const { data: participants = [] } = useQuery<any[]>({
    queryKey: ["/api/runs", id, "participants"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}/participants`);
      return res.json();
    },
    enabled: !!id,
  });

  const { data: myRating } = useQuery<any>({
    queryKey: ["/api/runs", id, "my-rating"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}/my-rating`);
      return res.json();
    },
    enabled: !!user && !!id,
  });

  const { data: recentDistances } = useQuery<number[]>({
    queryKey: ["/api/users/me/recent-distances"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/users/me/recent-distances");
      return res.json();
    },
    enabled: !!user,
  });

  const { data: runStatus } = useQuery<{ is_bookmarked: boolean; is_planned: boolean }>({
    queryKey: ["/api/runs", id, "status"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}/status`);
      return res.json();
    },
    enabled: !!user && !!id,
  });

  const bookmarkMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/runs/${id}/bookmark`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/runs", id, "status"] });
      qc.invalidateQueries({ queryKey: ["/api/runs/bookmarked"] });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
  });

  const planMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/runs/${id}/plan`),
    onSuccess: async (res) => {
      const body = await res.json();
      if (body.planned) {
        qc.setQueryData<any[]>(["/api/runs/planned"], (old) => {
          if (!old) return run ? [run] : [];
          if (old.some((r: any) => r.id === id)) return old;
          return run ? [...old, run] : old;
        });
      } else {
        qc.setQueryData<any[]>(["/api/runs/planned"], (old) =>
          old ? old.filter((r: any) => r.id !== id) : []
        );
      }
      qc.invalidateQueries({ queryKey: ["/api/runs", id, "status"] });
      qc.invalidateQueries({ queryKey: ["/api/runs", id] });
      qc.invalidateQueries({ queryKey: ["/api/runs/planned"] });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
  });

  const isBookmarked = runStatus?.is_bookmarked ?? false;
  const isPlanned = runStatus?.is_planned ?? false;

  const { data: runPhotos = [], refetch: refetchPhotos } = useQuery<any[]>({
    queryKey: ["/api/runs", id, "photos"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}/photos`);
      return res.json();
    },
    enabled: !!id,
  });

  async function pickAndUploadPhoto() {
    if (Platform.OS !== "web") {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Please allow photo library access to upload run photos.");
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const formData = new FormData();
    formData.append("photo", { uri: asset.uri, type: asset.mimeType || "image/jpeg", name: "photo.jpg" } as any);
    setUploadingPhoto(true);
    try {
      const url = new URL(`/api/runs/${id}/photos`, getApiUrl()).toString();
      const response = await fetch(url, { method: "POST", body: formData, credentials: "include" });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Upload failed");
      }
      await refetchPhotos();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Upload failed", e.message);
    } finally {
      setUploadingPhoto(false);
    }
  }

  const isHost = run?.host_id === user?.id;
  const isParticipant = participants.some((p) => p.id === user?.id);
  const myParticipation = participants.find((p) => p.id === user?.id);
  const isPastRun = run ? new Date(run.date) < new Date() : false;
  const canRate = isPastRun && isParticipant && !isHost && !myRating;
  const hasConfirmed = myParticipation?.status === "confirmed";
  const isLive = !!run?.is_active && !run?.is_completed;

  useEffect(() => {
    if (!isHost || !run || Platform.OS === "web") return;
    Location.getForegroundPermissionsAsync().then(async (perm) => {
      try {
        let granted = perm.granted;
        if (!granted) {
          const req = await Location.requestForegroundPermissionsAsync();
          granted = req.granted;
        }
        if (!granted) return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const d = haversineKmDetail(loc.coords.latitude, loc.coords.longitude, run.location_lat, run.location_lng);
        setHostDist(d);
      } catch { setHostDist(null); }
    });
  }, [isHost, run?.id]);

  // Geo-proximity auto-trigger: show rules modal when non-participant arrives within 1 km
  useEffect(() => {
    if (!user || !run || isHost || isParticipant || isPastRun || proximityTriggered || Platform.OS === "web") return;
    let sub: any = null;
    Location.getForegroundPermissionsAsync().then(async (perm) => {
      try {
        let granted = perm.granted;
        if (!granted) {
          const req = await Location.requestForegroundPermissionsAsync();
          granted = req.granted;
        }
        if (!granted) return;
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 50 },
          (loc) => {
            const d = haversineKmDetail(loc.coords.latitude, loc.coords.longitude, run.location_lat, run.location_lng);
            if (d <= 1) {
              setProximityTriggered(true);
              setShowRulesModal(true);
              sub?.remove();
            }
          }
        );
      } catch { /* location unavailable */ }
    });
    return () => { sub?.remove(); };
  }, [user?.id, run?.id, isParticipant, isHost, isPastRun, proximityTriggered]);

  async function handleStartRun() {
    if (!user) return;
    setStarting(true);
    try {
      await apiRequest("POST", `/api/runs/${id}/start`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["/api/runs", id] });
      router.push(`/run-live/${id}`);
    } catch (e: any) {
      Alert.alert("Can't Start Run", e.message || "Failed to start run");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setStarting(false);
    }
  }

  async function doJoin() {
    setJoining(true);
    try {
      await apiRequest("POST", `/api/runs/${id}/join`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["/api/runs", id, "participants"] });
      qc.invalidateQueries({ queryKey: ["/api/runs"] });
      Alert.alert("You're in!", "You've been added to the live count for this run.");
    } catch (e: any) {
      Alert.alert("Can't Join", e.message || "Unable to join run");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setJoining(false);
    }
  }

  async function handleLeave() {
    Alert.alert("Leave Run", "Are you sure you want to leave this run?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: async () => {
          await apiRequest("POST", `/api/runs/${id}/leave`);
          qc.invalidateQueries({ queryKey: ["/api/runs", id, "participants"] });
          qc.invalidateQueries({ queryKey: ["/api/runs"] });
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        },
      },
    ]);
  }

  async function handleConfirmComplete() {
    Alert.prompt(
      "Log Miles",
      "How many miles did you run?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          onPress: async (miles: string | undefined) => {
            setConfirming(true);
            try {
              await apiRequest("POST", `/api/runs/${id}/complete`, { milesLogged: parseFloat(miles || "3") });
              await refreshUser();
              qc.invalidateQueries({ queryKey: ["/api/runs/mine"] });
              qc.invalidateQueries({ queryKey: ["/api/users/me/achievements"] });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert("Great job!", "Run logged successfully. Check your achievements!");
            } catch (e: any) {
              Alert.alert("Error", e.message);
            } finally {
              setConfirming(false);
            }
          },
        },
      ],
      "plain-text",
      run?.min_distance?.toString() || "3"
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  if (!run) {
    return (
      <View style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <Text style={styles.errorText}>Run not found</Text>
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <Text style={styles.backLinkText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  if (run.isPrivate) {
    return (
      <KeyboardAvoidingView behavior="padding" style={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20, paddingHorizontal: 28 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Feather name="arrow-left" size={20} color={C.textSecondary} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16 }}>
          <View style={styles.lockIcon}>
            <Feather name="lock" size={36} color={C.primary} />
          </View>
          <Text style={styles.lockTitle}>Private Run</Text>
          {run.hostName && (
            <Text style={styles.lockHost}>Hosted by {run.hostName}</Text>
          )}
          {run.title && (
            <Text style={styles.lockRunTitle}>{run.title}</Text>
          )}
          <Text style={styles.lockSub}>Enter the invite code or password to access this run.</Text>

          <View style={styles.lockInputGroup}>
            {run.hasPassword && (
              <TextInput
                style={styles.lockInput}
                value={passwordInput}
                onChangeText={setPasswordInput}
                placeholder="Enter password..."
                placeholderTextColor={C.textMuted}
                autoCapitalize="none"
                secureTextEntry={false}
              />
            )}
            <TextInput
              style={styles.lockInput}
              value={tokenInput}
              onChangeText={v => setTokenInput(v.toUpperCase())}
              placeholder="Enter invite code (e.g. ABC123XY)"
              placeholderTextColor={C.textMuted}
              autoCapitalize="characters"
            />
          </View>

          {accessError ? <Text style={styles.lockError}>{accessError}</Text> : null}

          <Pressable
            style={[styles.lockUnlockBtn, { opacity: unlocking ? 0.7 : 1 }]}
            onPress={handleUnlockWithPassword}
            disabled={unlocking}
          >
            {unlocking ? (
              <ActivityIndicator size="small" color={C.text} />
            ) : (
              <>
                <Feather name="unlock" size={18} color={C.text} />
                <Text style={styles.lockUnlockTxt}>Unlock Run</Text>
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="x" size={20} color={C.text} />
          </Pressable>
          <View style={styles.topBarRight}>
            <View style={[styles.privacyBadge, { backgroundColor: run.privacy === "public" ? C.primaryMuted : C.border }]}>
              <Feather name={run.privacy === "public" ? "globe" : run.privacy === "private" ? "lock" : "user"} size={12} color={run.privacy === "public" ? C.primary : C.textSecondary} />
              <Text style={[styles.privacyText, { color: run.privacy === "public" ? C.primary : C.textSecondary }]}>
                {run.privacy.charAt(0).toUpperCase() + run.privacy.slice(1)}
              </Text>
            </View>
            {user && (
              <Pressable
                style={[styles.bookmarkBtn, isBookmarked && styles.bookmarkBtnActive]}
                onPress={() => bookmarkMutation.mutate()}
                hitSlop={8}
              >
                <Ionicons
                  name={isBookmarked ? "bookmark" : "bookmark-outline"}
                  size={20}
                  color={isBookmarked ? C.primary : C.textSecondary}
                />
              </Pressable>
            )}
          </View>
        </View>

        <Text style={styles.title}>{run.title}</Text>

        <Pressable
          style={({ pressed }) => [styles.hostCard, { opacity: pressed ? 0.8 : 1 }]}
          onPress={() => !isHost && setHostProfileId(run.host_id)}
        >
          {run.host_photo ? (
            <Image source={{ uri: run.host_photo }} style={[styles.hostAvatar, { borderWidth: 0 }]} />
          ) : (
            <View style={styles.hostAvatar}>
              <Text style={styles.hostAvatarText}>{run.host_name?.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <View style={styles.hostInfo}>
            <Text style={styles.hostName}>{run.host_name}</Text>
            <View style={styles.hostMeta}>
              {run.host_rating > 0 && (
                <View style={styles.ratingRow}>
                  <Ionicons name="star" size={12} color={C.gold} />
                  <Text style={styles.ratingText}>{parseFloat(run.host_rating).toFixed(1)} rating</Text>
                </View>
              )}
              {(() => { const b = getHostBadge(run.host_hosted_runs); return b ? <Text style={[styles.hostBadgeText, { color: b.color }]}>{b.label}</Text> : null; })()}
            </View>
            <Text style={styles.hostPlannedDist}>{formatDistance(run.min_distance)} mi planned</Text>
          </View>
          {isHost && (
            <View style={styles.yourRunBadge}>
              <Text style={styles.yourRunText}>Your Run</Text>
            </View>
          )}
          {!isHost && (
            <Feather name="chevron-right" size={16} color={C.textMuted} />
          )}
        </Pressable>

        <View style={styles.infoGrid}>
          <View style={styles.infoCard}>
            <Feather name="calendar" size={18} color={C.primary} />
            <View>
              <Text style={styles.infoValue}>{formatDateFull(run.date)}</Text>
              <Text style={styles.infoLabel}>at {formatTime(run.date)}</Text>
            </View>
          </View>
          <View style={styles.infoCard}>
            <Feather name="map-pin" size={18} color={C.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.infoValue} numberOfLines={2}>{run.location_name}</Text>
            </View>
          </View>
        </View>

        <View style={styles.requirementsCard}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <Text style={styles.requirementsTitle}>Requirements</Text>
            {run.is_strict && (
              <View style={{ backgroundColor: C.orange + "22", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: C.orange + "55" }}>
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: C.orange }}>Strict</Text>
              </View>
            )}
          </View>
          <View style={styles.requirementsGrid}>
            <View style={styles.reqItem}>
              <Ionicons name="walk" size={20} color={C.orange} />
              <Text style={styles.reqValue}>{formatPace(run.min_pace)} – {formatPace(run.max_pace)}</Text>
              <Text style={styles.reqLabel}>Pace (min/mi)</Text>
            </View>
            <View style={styles.reqDivider} />
            <View style={styles.reqItem}>
              <Feather name="target" size={20} color={C.blue} />
              <Text style={styles.reqValue}>{formatDistance(run.min_distance)} – {formatDistance(run.max_distance)}</Text>
              <Text style={styles.reqLabel}>Distance (mi)</Text>
            </View>
            <View style={styles.reqDivider} />
            <View style={styles.reqItem}>
              <Ionicons name="people" size={20} color={C.textSecondary} />
              <Text style={styles.reqValue}>{run.participant_count}/{run.max_participants}</Text>
              <Text style={styles.reqLabel}>Participants</Text>
            </View>
          </View>
          {parseInt(run.plan_count) > 0 && (
            <View style={styles.planCountRow}>
              <Feather name="calendar" size={13} color={C.textMuted} />
              <Text style={styles.planCountText}>{run.plan_count} {parseInt(run.plan_count) === 1 ? "person" : "people"} planning to run</Text>
            </View>
          )}
          {user && run.is_strict && (() => {
            const hasHistory = (recentDistances ?? []).length > 0;
            if (!hasHistory) {
              return (
                <View style={[styles.eligibilityRow, { backgroundColor: C.primaryMuted, borderColor: C.primary + "44" }]}>
                  <Feather name="check-circle" size={14} color={C.primary} />
                  <Text style={[styles.eligibilityText, { color: C.primary }]}>No run history yet — you can still join this run</Text>
                </View>
              );
            }
            const paceOk = user.avg_pace >= run.min_pace && user.avg_pace <= run.max_pace;
            const distOk = (recentDistances ?? []).some((d) => d >= run.min_distance * 0.7);
            const eligible = paceOk && distOk;
            let msg = "";
            if (eligible) msg = "Pace and distance both qualify";
            else if (!paceOk && !distOk) msg = "Pace and distance both fall short";
            else if (!paceOk) msg = `Your pace (${formatPace(user.avg_pace)}/mi) doesn't match this run`;
            else msg = `No recent run covers 70%+ of the planned ${formatDistance(run.min_distance)} mi`;
            return (
              <View style={[styles.eligibilityRow, {
                backgroundColor: eligible ? C.primaryMuted : C.danger + "22",
                borderColor: eligible ? C.primary + "44" : C.danger + "44",
              }]}>
                <Feather
                  name={eligible ? "check-circle" : "alert-circle"}
                  size={14}
                  color={eligible ? C.primary : C.danger}
                />
                <Text style={[styles.eligibilityText, { color: eligible ? C.primary : C.danger }]}>
                  {msg}
                </Text>
              </View>
            );
          })()}
        </View>

        {run.description ? (
          <View style={styles.descCard}>
            <Text style={styles.descTitle}>About this run</Text>
            <Text style={styles.descText}>{run.description}</Text>
          </View>
        ) : null}

        {run.run_style && (
          <View style={styles.tagsSection}>
            <Text style={styles.sectionTitle}>Run Style</Text>
            <View style={styles.runStyleBadgeRow}>
              <View style={styles.runStyleBadge}>
                <Feather name="activity" size={14} color={C.bg} />
                <Text style={styles.runStyleBadgeText}>{run.run_style}</Text>
              </View>
            </View>
          </View>
        )}

        {run.tags?.length > 0 && (
          <View style={styles.tagsSection}>
            <Text style={styles.sectionTitle}>Group Vibe</Text>
            <View style={styles.tagsGrid}>
              {run.tags.map((tag: string) => (
                <View key={tag} style={styles.tagChip}>
                  <Feather name={RUN_TAG_ICONS[tag] as any || "tag"} size={13} color={C.primary} />
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {participants.length > 0 && (
          <View style={styles.participantsSection}>
            <Text style={styles.sectionTitle}>Participants ({run.participant_count})</Text>
            <View style={styles.participantsList}>
              {participants.slice(0, 8).map((p: any) => (
                <Pressable
                  key={p.id}
                  style={({ pressed }) => [styles.participantItem, { opacity: pressed ? 0.8 : 1 }]}
                  onPress={() => setHostProfileId(p.id)}
                >
                  {p.photo_url ? (
                    <Image source={{ uri: p.photo_url }} style={styles.participantAvatarImg} />
                  ) : (
                    <View style={styles.participantAvatar}>
                      <Text style={styles.participantAvatarText}>{p.name?.charAt(0).toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={styles.participantInfo}>
                    <Text style={styles.participantName}>{p.name}</Text>
                    <Text style={styles.participantPace}>{formatPace(p.avg_pace)}/mi · {formatDistance(p.avg_distance)} mi avg</Text>
                  </View>
                  <View style={[styles.participantStatus, { backgroundColor: p.status === "confirmed" ? C.primary + "22" : C.border }]}>
                    <Text style={[styles.participantStatusText, { color: p.status === "confirmed" ? C.primary : C.textMuted }]}>
                      {p.status === "confirmed" ? "Done" : "Joined"}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={14} color={C.textMuted} />
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* ─── Run Photos ──────────────────────────────────────────────────── */}
        {isPastRun && (
          <View style={styles.photosSection}>
            <View style={styles.photosSectionHeader}>
              <Text style={styles.sectionTitle}>
                Run Photos {runPhotos.length > 0 ? `(${runPhotos.length})` : ""}
              </Text>
              {(isHost || isParticipant) && (
                <Pressable
                  style={[styles.addPhotoBtn, uploadingPhoto && { opacity: 0.6 }]}
                  onPress={pickAndUploadPhoto}
                  disabled={uploadingPhoto}
                >
                  {uploadingPhoto ? (
                    <ActivityIndicator color={C.primary} size="small" />
                  ) : (
                    <>
                      <Feather name="camera" size={14} color={C.primary} />
                      <Text style={styles.addPhotoBtnTxt}>Add</Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
            {runPhotos.length === 0 ? (
              <View style={styles.photosEmpty}>
                <Feather name="image" size={22} color={C.textMuted} />
                <Text style={styles.photosEmptyTxt}>No photos yet</Text>
                {(isHost || isParticipant) && (
                  <Text style={styles.photosEmptyHint}>Be the first to add a photo from this run</Text>
                )}
              </View>
            ) : (
              <View style={styles.photosGrid}>
                {runPhotos.map((p: any) => (
                  <Pressable key={p.id} onPress={() => setViewingPhoto(p.photo_url)}>
                    <Image source={{ uri: p.photo_url }} style={styles.photoGridImg} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <HostProfileSheet hostId={hostProfileId} onClose={() => setHostProfileId(null)} />

      {/* ─── Full-screen photo viewer ─────────────────────────────────────── */}
      {viewingPhoto && (
        <Pressable style={styles.photoViewer} onPress={() => setViewingPhoto(null)}>
          <Image source={{ uri: viewingPhoto }} style={styles.photoViewerImg} resizeMode="contain" />
          <Pressable style={[styles.photoViewerClose, { top: insets.top + 16 }]} onPress={() => setViewingPhoto(null)}>
            <Feather name="x" size={22} color="#fff" />
          </Pressable>
        </Pressable>
      )}

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        {isHost && !isPastRun && !run.is_completed && (
          isLive ? (
            <Pressable
              style={({ pressed }) => [styles.liveBtn, { opacity: pressed ? 0.85 : 1 }]}
              onPress={() => router.push(`/run-live/${id}`)}
            >
              <View style={styles.liveDot} />
              <Text style={styles.liveBtnText}>View Live Run</Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                style={({ pressed }) => [
                  styles.primaryBtn,
                  (hostDist === null || hostDist > 1) && styles.btnDisabled,
                  { opacity: pressed || starting ? 0.85 : 1 },
                ]}
                onPress={handleStartRun}
                disabled={starting || hostDist === null || hostDist > 1}
              >
                {starting ? <ActivityIndicator color={C.text} /> : (
                  <>
                    <Feather name="play" size={18} color={C.text} />
                    <Text style={styles.primaryBtnText}>Start Run</Text>
                  </>
                )}
              </Pressable>
              {hostDist !== null && hostDist > 1 && (
                <View style={styles.proximityWarn}>
                  <Feather name="map-pin" size={13} color={C.textSecondary} />
                  <Text style={styles.proximityText}>
                    Move within 1 km of the start pin ({hostDist.toFixed(1)} km away)
                  </Text>
                </View>
              )}
              {hostDist === null && Platform.OS !== "web" && (
                <View style={styles.proximityWarn}>
                  <Feather name="map-pin" size={13} color={C.textSecondary} />
                  <Text style={styles.proximityText}>Checking your location…</Text>
                </View>
              )}
            </>
          )
        )}
        {!isHost && !isPastRun && isLive && isParticipant && (
          <Pressable
            style={({ pressed }) => [styles.liveBtn, { opacity: pressed ? 0.85 : 1 }]}
            onPress={() => router.push(`/run-live/${id}`)}
          >
            <View style={styles.liveDot} />
            <Text style={styles.liveBtnText}>Join Live Run</Text>
          </Pressable>
        )}
        {isPastRun && isParticipant && !hasConfirmed && (
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, { opacity: pressed || confirming ? 0.85 : 1 }]}
            onPress={handleConfirmComplete}
            disabled={confirming}
          >
            {confirming ? <ActivityIndicator color={C.text} /> : (
              <>
                <Feather name="check-circle" size={18} color={C.text} />
                <Text style={styles.primaryBtnText}>Log Completion</Text>
              </>
            )}
          </Pressable>
        )}
        {canRate && !myRating && (
          <Pressable
            style={({ pressed }) => [styles.rateBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => router.push(`/rate/${id}`)}
          >
            <Ionicons name="star-outline" size={18} color={C.gold} />
            <Text style={styles.rateBtnText}>Rate Host</Text>
          </Pressable>
        )}
        {myRating && (
          <View style={styles.ratedBanner}>
            <Ionicons name="star" size={14} color={C.gold} />
            <Text style={styles.ratedText}>You rated this host {myRating.stars}/5</Text>
          </View>
        )}
        {!isHost && !isParticipant && !isPastRun && user && (
          <Pressable
            style={({ pressed }) => [
              isPlanned ? [styles.planBtn, styles.planBtnActive] : styles.primaryBtn,
              { opacity: pressed || planMutation.isPending ? 0.8 : 1 },
            ]}
            onPress={() => planMutation.mutate()}
            disabled={planMutation.isPending}
          >
            {planMutation.isPending ? <ActivityIndicator color={isPlanned ? C.primary : C.text} /> : (
              <>
                <Ionicons
                  name={isPlanned ? "calendar" : "calendar-outline"}
                  size={18}
                  color={isPlanned ? C.primary : C.text}
                />
                <Text style={isPlanned ? [styles.planBtnText, styles.planBtnTextActive] : styles.primaryBtnText}>
                  {isPlanned ? "I'm Not Coming" : run?.activity_type === "ride" ? "I Plan To Ride" : "I Plan To Run"}
                </Text>
              </>
            )}
          </Pressable>
        )}
        {isParticipant && !isPastRun && (
          <View style={styles.joinedBanner}>
            <Feather name="map-pin" size={14} color={C.primary} />
            <Text style={styles.joinedText}>You've arrived — you're in the live count</Text>
          </View>
        )}
      </View>

      {/* ── Community rules popup ─────────────────────────────────────────── */}
      {showRulesModal && (
        <Modal transparent animationType="slide" onRequestClose={() => setShowRulesModal(false)}>
          <View style={styles.frModalWrap}>
            <Pressable style={styles.frOverlay} onPress={() => setShowRulesModal(false)} />
            <View style={[styles.frSheet, { paddingBottom: insets.bottom + 24 }]}>
              <View style={styles.frHandle} />
              <View style={styles.frHeader}>
                <Text style={styles.frTitle}>Before You Run</Text>
                <Pressable onPress={() => setShowRulesModal(false)}>
                  <Feather name="x" size={18} color={C.textSecondary} />
                </Pressable>
              </View>
              <Text style={styles.frIntro}>
                {proximityTriggered
                  ? `You're within 1 km of this run — want to join the group?`
                  : `A quick reminder before you join the group.`}
              </Text>
              {[
                { icon: "smile" as const,      title: "Have fun",   body: "Running with others is a great time. Enjoy the pace, the people, and the miles." },
                { icon: "heart" as const,      title: "Be kind",    body: "Cheer each other on. Every runner is working hard — support your group." },
                { icon: "trending-up" as const, title: "Keep up",   body: "Do your best to match the group's pace. If you fall behind, it's okay — just keep moving." },
              ].map((item) => (
                <View key={item.title} style={styles.frRuleRow}>
                  <View style={styles.frRuleIcon}>
                    <Feather name={item.icon} size={15} color={C.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.frRuleTitle}>{item.title}</Text>
                    <Text style={styles.frRuleBody}>{item.body}</Text>
                  </View>
                </View>
              ))}
              <Pressable
                style={[styles.primaryBtn, { marginTop: 20 }]}
                onPress={() => {
                  setShowRulesModal(false);
                  doJoin();
                }}
              >
                <Ionicons name="walk" size={18} color={C.text} />
                <Text style={styles.primaryBtnText}>Let's go!</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 20 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  topBarRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  privacyBadge: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: "transparent" },
  privacyText: { fontFamily: "Outfit_600SemiBold", fontSize: 12 },
  bookmarkBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  bookmarkBtnActive: { backgroundColor: C.primaryMuted, borderColor: C.primary + "55" },
  planCountRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  planCountText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted },
  planBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: 14, height: 52, paddingHorizontal: 16,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  planBtnActive: { backgroundColor: C.primaryMuted, borderColor: C.primary + "55" },
  planBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  planBtnTextActive: { color: C.primary },
  title: { fontFamily: "Outfit_700Bold", fontSize: 26, color: C.text, marginBottom: 16, lineHeight: 32 },
  hostCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border, marginBottom: 16 },
  hostAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primaryMuted, borderWidth: 1, borderColor: C.primary + "44", alignItems: "center", justifyContent: "center" },
  hostAvatarText: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.primary },
  hostInfo: { flex: 1, gap: 2 },
  hostName: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.text },
  hostPlannedDist: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.text, marginTop: 3 },
  hostMeta: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  hostBadgeText: { fontFamily: "Outfit_600SemiBold", fontSize: 11 },
  yourRunBadge: { backgroundColor: C.primaryMuted, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: C.primary + "44" },
  yourRunText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.primary },
  infoGrid: { gap: 10, marginBottom: 16 },
  infoCard: { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: C.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border },
  infoValue: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  infoLabel: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  requirementsCard: { backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border, marginBottom: 16, gap: 14 },
  requirementsTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },
  requirementsGrid: { flexDirection: "row", alignItems: "center" },
  reqItem: { flex: 1, alignItems: "center", gap: 4 },
  reqDivider: { width: 1, height: 40, backgroundColor: C.border },
  reqValue: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.text, textAlign: "center" },
  reqLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textSecondary, textAlign: "center" },
  eligibilityRow: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, padding: 10, borderWidth: 1 },
  eligibilityText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, flex: 1 },
  descCard: { backgroundColor: C.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border, marginBottom: 16, gap: 8 },
  descTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.text },
  descText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, lineHeight: 20 },
  tagsSection: { gap: 10, marginBottom: 16 },
  sectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },
  tagsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tagChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.primaryMuted, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: C.primary + "33" },
  tagText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },
  runStyleBadgeRow: { flexDirection: "row" },
  runStyleBadge: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  runStyleBadgeText: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.bg },
  participantsSection: { gap: 10, marginBottom: 16 },
  participantsList: { gap: 8 },
  participantItem: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border },
  participantAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  participantAvatarImg: { width: 40, height: 40, borderRadius: 20 },
  participantAvatarText: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.textSecondary },
  participantInfo: { flex: 1, gap: 2 },
  participantName: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  participantPace: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  participantStatus: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  participantStatusText: { fontFamily: "Outfit_600SemiBold", fontSize: 11 },
  bottomBar: { padding: 20, paddingTop: 12, gap: 10, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg },
  primaryBtn: { backgroundColor: C.primary, borderRadius: 14, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },
  secondaryBtn: { borderRadius: 14, height: 52, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.danger + "66" },
  secondaryBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.danger },
  rateBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, height: 52, backgroundColor: C.gold + "22", borderWidth: 1, borderColor: C.gold + "44" },
  rateBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.gold },
  ratedBanner: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", padding: 12 },
  ratedText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  joinedBanner: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", padding: 8 },
  joinedText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },
  liveBtn: { backgroundColor: "#0A3A1F", borderRadius: 14, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderWidth: 1.5, borderColor: C.primary },
  liveBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.primary },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
  btnDisabled: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  proximityWarn: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", paddingTop: 4 },
  proximityText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary, flex: 1 },
  errorText: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text },
  backLink: { marginTop: 16 },
  backLinkText: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.primary },
  lockIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: C.primaryMuted, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: C.primary + "44" },
  lockTitle: { fontFamily: "Outfit_700Bold", fontSize: 26, color: C.text, textAlign: "center" },
  lockHost: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center" },
  lockRunTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 16, color: C.text, textAlign: "center" },
  lockSub: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center" },
  lockInputGroup: { width: "100%", gap: 10 },
  lockInput: {
    backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 16, paddingVertical: 14, fontFamily: "Outfit_400Regular", fontSize: 15, color: C.text,
    textAlign: "center", letterSpacing: 1,
  },
  lockError: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: "#FF6B6B", textAlign: "center" },
  lockUnlockBtn: { backgroundColor: C.primary, borderRadius: 14, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 32, width: "100%" },
  lockUnlockTxt: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },

  // ─── Run Photos ───────────────────────────────────────────────────────────
  photosSection: { marginTop: 24, marginBottom: 16 },
  photosSectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  addPhotoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.primaryMuted,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: C.primary + "44",
  },
  addPhotoBtnTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },
  photosEmpty: { alignItems: "center", paddingVertical: 20, gap: 6 },
  photosEmptyTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textMuted },
  photosEmptyHint: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, textAlign: "center" },
  photosGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  photoGridImg: { width: 105, height: 105, borderRadius: 10, backgroundColor: C.card },
  photoViewer: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.95)", alignItems: "center", justifyContent: "center", zIndex: 999,
  },
  photoViewerImg: { width: "100%", height: "80%" },
  photoViewerClose: {
    position: "absolute", right: 20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center",
  },

  // ─── First-run modal ──────────────────────────────────────────────────────
  frModalWrap: { flex: 1, justifyContent: "flex-end" },
  frOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
  frSheet: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 0 },
  frHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginBottom: 16 },
  frHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  frTitle: { fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text },
  frIntro: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, lineHeight: 20, marginBottom: 16 },
  frRuleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 14 },
  frRuleIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.primaryMuted, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.primary + "44" },
  frRuleTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text, marginBottom: 2 },
  frRuleBody: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary, lineHeight: 18 },
});
