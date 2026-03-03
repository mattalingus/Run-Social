import React, { useState, useEffect, useRef, useMemo } from "react";
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
  Linking,
  Animated,
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
import { useLiveTracking } from "@/contexts/LiveTrackingContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { darkColors as C, type ColorScheme } from "@/constants/colors";
import { useTheme } from "@/contexts/ThemeContext";
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
  const { C } = useTheme();
  const styles = useMemo(() => makeStyles(C), [C]);
  const { id, token } = useLocalSearchParams<{ id: string; token?: string }>();
  const insets = useSafeAreaInsets();
  const { user, refreshUser } = useAuth();
  const liveTracking = useLiveTracking();
  const qc = useQueryClient();
  const pillPulse = useRef(new Animated.Value(1)).current;
  const [joining, setJoining] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [proximityTriggered, setProximityTriggered] = useState(false);
  const [showPlanInfoModal, setShowPlanInfoModal] = useState(false);
  const [planInfoPage, setPlanInfoPage] = useState(0);
  const [starting, setStarting] = useState(false);
  const [hostDist, setHostDist] = useState<number | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [tokenInput, setTokenInput] = useState(token || "");
  const [accessError, setAccessError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  const [hostProfileId, setHostProfileId] = useState<string | null>(null);
  const [showEditSheet, setShowEditSheet] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editAmPm, setEditAmPm] = useState<"AM" | "PM">("AM");
  const [editSaving, setEditSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

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
  const canRate = !!run?.is_completed && isParticipant && !isHost && !myRating;
  const hasConfirmed = myParticipation?.status === "confirmed";
  const isLive = !!run?.is_active && !run?.is_completed;
  const isMyTracking =
    liveTracking.runId === id &&
    liveTracking.phase === "active" &&
    liveTracking.isMinimized;

  useEffect(() => {
    if (!isMyTracking) return;
    Animated.loop(
      Animated.sequence([
        Animated.timing(pillPulse, { toValue: 0.35, duration: 800, useNativeDriver: true }),
        Animated.timing(pillPulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();
    return () => pillPulse.stopAnimation();
  }, [isMyTracking]);

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
    if (!user || !run || isHost || isParticipant || run.is_completed || proximityTriggered || Platform.OS === "web") return;
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
            if (d <= 0.1524) {
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
      Alert.alert(`Can't Start ${run?.activity_type === "ride" ? "Ride" : "Run"}`, e.message || `Failed to start ${run?.activity_type === "ride" ? "ride" : "run"}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setStarting(false);
    }
  }

  function handleOpenEdit() {
    if (!run) return;
    const d = new Date(run.date);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(2);
    setEditDate(`${mm}/${dd}/${yy}`);
    const raw24h = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, "0");
    const ap: "AM" | "PM" = raw24h >= 12 ? "PM" : "AM";
    const h12 = raw24h % 12 === 0 ? 12 : raw24h % 12;
    setEditTime(`${h12}:${mins}`);
    setEditAmPm(ap);
    setShowEditSheet(true);
  }

  function parseDMY(raw: string): Date | null {
    const parts = raw.split("/");
    if (parts.length !== 3) return null;
    const [mo, dy, yr] = parts.map(Number);
    if (isNaN(mo) || isNaN(dy) || isNaN(yr)) return null;
    const year = yr < 100 ? 2000 + yr : yr;
    const d = new Date(year, mo - 1, dy);
    if (d.getMonth() !== mo - 1) return null;
    return d;
  }

  function parseHHMMAMPM(raw: string, ap: "AM" | "PM"): { hours: number; minutes: number } | null {
    const parts = raw.split(":");
    if (parts.length !== 2) return null;
    let hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(minutes) || minutes < 0 || minutes > 59) return null;
    if (hours < 1 || hours > 12) return null;
    if (ap === "AM") { if (hours === 12) hours = 0; }
    else { if (hours !== 12) hours += 12; }
    return { hours, minutes };
  }

  function autoFormatEditTime(digits: string): string {
    if (digits.length <= 1) return digits;
    if (digits.length === 2) return parseInt(digits[0], 10) > 1 ? digits[0] + ":" + digits[1] : digits;
    if (digits.length === 3) return parseInt(digits[0], 10) > 1 ? digits[0] + ":" + digits.slice(1) : digits.slice(0, 2) + ":" + digits[2];
    return parseInt(digits[0], 10) > 1 ? digits[0] + ":" + digits.slice(1, 3) : digits.slice(0, 2) + ":" + digits.slice(2, 4);
  }

  async function handleSaveEdit() {
    if (!editDate.trim() || !editTime.trim()) {
      Alert.alert("Missing info", "Please enter both a date and time.");
      return;
    }
    const parsedDate = parseDMY(editDate.trim());
    if (!parsedDate) { Alert.alert("Invalid format", "Enter date as MM/DD/YY (e.g. 06/15/26)."); return; }
    const parsedTime = parseHHMMAMPM(editTime.trim(), editAmPm);
    if (!parsedTime) { Alert.alert("Invalid format", "Enter time as H:MM (e.g. 7:30)."); return; }
    parsedDate.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
    const parsed = parsedDate;
    if (isNaN(parsed.getTime())) {
      Alert.alert("Invalid format", "Could not parse the date or time.");
      return;
    }
    setEditSaving(true);
    try {
      await apiRequest("PATCH", `/api/runs/${id}`, { date: parsed.toISOString() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["/api/runs", id] });
      qc.invalidateQueries({ queryKey: ["/api/runs"] });
      setShowEditSheet(false);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not update the run.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setEditSaving(false);
    }
  }

  function handleCancelRun() {
    const label = run?.activity_type === "ride" ? "ride" : "run";
    Alert.alert(
      "Cancel Run",
      `Are you sure you want to cancel this ${label}? All participants will be notified and the event will be removed.`,
      [
        { text: "Keep It", style: "cancel" },
        {
          text: "Cancel Run",
          style: "destructive",
          onPress: async () => {
            setCancelling(true);
            try {
              await apiRequest("DELETE", `/api/runs/${id}`);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              qc.invalidateQueries({ queryKey: ["/api/runs"] });
              if (router.canGoBack()) router.back();
              else router.replace("/(tabs)/");
            } catch (e: any) {
              Alert.alert("Error", e.message || "Could not cancel the run.");
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  }

  async function doJoin() {
    setJoining(true);
    try {
      await apiRequest("POST", `/api/runs/${id}/join`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["/api/runs", id, "participants"] });
      qc.invalidateQueries({ queryKey: ["/api/runs"] });
      Alert.alert("You're in! 🎉", `You've been added to the live count.\n\nNow tap "Join Live Run" to check in with your host and let them know you're ready.`);
    } catch (e: any) {
      Alert.alert("Can't Join", e.message || `Unable to join ${run?.activity_type === "ride" ? "ride" : "run"}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setJoining(false);
    }
  }

  async function handleLeave() {
    Alert.alert(`Leave ${run?.activity_type === "ride" ? "Ride" : "Run"}`, `Are you sure you want to leave this ${run?.activity_type === "ride" ? "ride" : "run"}?`, [
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
      <View style={[styles.container, { backgroundColor: C.bg, justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  if (!run) {
    return (
      <View style={[styles.container, { backgroundColor: C.bg, justifyContent: "center", alignItems: "center" }]}>
        <Text style={styles.errorText}>Run not found</Text>
        <Pressable onPress={() => router.back()} style={styles.backLink}>
          <Text style={styles.backLinkText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  if (run.isPrivate) {
    return (
      <KeyboardAvoidingView behavior="padding" style={[styles.container, { backgroundColor: C.bg, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20, paddingHorizontal: 28 }]}>
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
    <View style={[styles.container, { backgroundColor: C.bg }]}>
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
              {(run.host_rating_count ?? 0) >= 5 && (run.host_rating ?? 0) >= 4.5 && (
                <View style={styles.topRatedChip}>
                  <Text style={styles.topRatedChipTxt}>⭐ Top Rated</Text>
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
          <Pressable
            style={styles.infoCard}
            onPress={() => {
              const lat = run.location_lat;
              const lng = run.location_lng;
              const label = encodeURIComponent(run.location_name);
              const url = Platform.select({
                ios: `maps://maps.apple.com/?ll=${lat},${lng}&q=${label}`,
                android: `geo:${lat},${lng}?q=${label}`,
                default: `https://www.google.com/maps?q=${lat},${lng}`,
              });
              if (url) Linking.openURL(url);
            }}
          >
            <Feather name="map-pin" size={18} color={C.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.infoValue} numberOfLines={2}>{run.location_name}</Text>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: C.primary, marginTop: 1 }}>Tap to view map</Text>
            </View>
          </Pressable>
        </View>

        <View style={styles.requirementsCard}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <Text style={styles.requirementsTitle}>Plan</Text>
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
              <Text style={styles.reqValue}>{run.min_distance === run.max_distance ? formatDistance(run.min_distance) : `${formatDistance(run.min_distance)} – ${formatDistance(run.max_distance)}`}</Text>
              <Text style={styles.reqLabel}>Distance (mi)</Text>
            </View>
            <View style={styles.reqDivider} />
            <View style={styles.reqItem}>
              <Ionicons name="people" size={20} color={C.textSecondary} />
              {run.crew_id ? (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Text style={styles.reqValue}>{run.participant_count ?? 1}</Text>
                    {parseInt(run.plan_count) > 0 && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: C.card, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}>
                        <Feather name="calendar" size={10} color={C.textMuted} />
                        <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.textMuted }}>{run.plan_count}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.reqLabel}>Coming</Text>
                </>
              ) : (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Text style={styles.reqValue}>{run.participant_count ?? 1}/{run.max_participants}</Text>
                    {parseInt(run.plan_count) > 0 && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: C.card, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 }}>
                        <Feather name="calendar" size={10} color={C.textMuted} />
                        <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.textMuted }}>{run.plan_count}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.reqLabel}>Participants</Text>
                </>
              )}
            </View>
          </View>
          {user && run.is_strict && (() => {
            const hasHistory = (recentDistances ?? []).length > 0;
            if (!hasHistory) {
              return (
                <View style={[styles.eligibilityRow, { backgroundColor: C.primaryMuted, borderColor: C.primary + "44" }]}>
                  <Feather name="check-circle" size={14} color={C.primary} />
                  <Text style={[styles.eligibilityText, { color: C.primary }]}>No history yet — you can still join this {run.activity_type === "ride" ? "ride" : "run"}</Text>
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
            <Text style={styles.descTitle}>{run.activity_type === "ride" ? "About this ride" : "About this run"}</Text>
            <Text style={styles.descText}>{run.description}</Text>
          </View>
        ) : null}

        {run.run_style && (
          <View style={styles.tagsSection}>
            <Text style={styles.sectionTitle}>{run.activity_type === "ride" ? "Ride Style" : "Run Style"}</Text>
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
            <Text style={styles.sectionTitle}>Participants ({run.participant_count ?? 1})</Text>
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
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Text style={styles.participantName}>{p.name}</Text>
                      {p.reliability_slug === "reliable_90" && <Text style={{ fontSize: 13 }}>⭐</Text>}
                      {p.reliability_slug === "reliable_80" && <Text style={{ fontSize: 13 }}>🟢</Text>}
                      {p.reliability_slug === "reliable_65" && <Text style={{ fontSize: 13 }}>🔵</Text>}
                      {p.reliability_slug === "reliable_50" && <Text style={{ fontSize: 13 }}>🟡</Text>}
                    </View>
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
        {isHost && !run.is_completed && (
          isLive ? (
            <Pressable
              style={({ pressed }) => [styles.liveBtn, { opacity: pressed ? 0.85 : 1 }]}
              onPress={() => router.push(`/run-live/${id}`)}
            >
              <View style={styles.liveDot} />
              <Text style={styles.liveBtnText}>{run?.activity_type === "ride" ? "Ready to Ride" : "Ready to Run"}</Text>
            </Pressable>
          ) : (
            <>
              {/* Host management: Edit time & Cancel */}
              <View style={styles.hostMgmtRow}>
                <Pressable
                  style={({ pressed }) => [styles.hostMgmtBtn, { opacity: pressed ? 0.75 : 1 }]}
                  onPress={handleOpenEdit}
                  testID="edit-run-btn"
                >
                  <Feather name="edit-2" size={15} color={C.textSecondary} />
                  <Text style={styles.hostMgmtTxt}>Edit Time</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.hostMgmtBtn, styles.hostMgmtDangerBtn, { opacity: pressed || cancelling ? 0.75 : 1 }]}
                  onPress={handleCancelRun}
                  disabled={cancelling}
                  testID="cancel-run-btn"
                >
                  {cancelling ? <ActivityIndicator size="small" color={C.danger} /> : (
                    <>
                      <Feather name="x-circle" size={15} color={C.danger} />
                      <Text style={styles.hostMgmtDangerTxt}>Cancel Run</Text>
                    </>
                  )}
                </Pressable>
              </View>
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
                    <Text style={styles.primaryBtnText}>{run?.activity_type === "ride" ? "Start Ride" : "Start Run"}</Text>
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
        {!isHost && isLive && isParticipant && !run.is_completed && (
          <Pressable
            style={({ pressed }) => [styles.liveBtn, { opacity: pressed ? 0.85 : 1 }]}
            onPress={() => router.push(`/run-live/${id}`)}
          >
            <View style={styles.liveDot} />
            <Text style={styles.liveBtnText}>{run?.activity_type === "ride" ? "Join Live Ride" : "Join Live Run"}</Text>
          </Pressable>
        )}
        {!isHost && !isLive && isParticipant && !run.is_completed && (
          <View style={styles.waitingBanner}>
            <Feather name="clock" size={15} color={C.gold} />
            <Text style={styles.waitingText}>Waiting on host to start</Text>
          </View>
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
          <View>
            <Text style={styles.ratePrompt}>How was the host?</Text>
            <Pressable
              style={({ pressed }) => [styles.rateBtn, { opacity: pressed ? 0.8 : 1 }]}
              onPress={() => router.push(`/rate/${id}`)}
            >
              <Ionicons name="star-outline" size={18} color={C.gold} />
              <Text style={styles.rateBtnText}>Rate Host</Text>
            </Pressable>
          </View>
        )}
        {myRating && (
          <View style={styles.ratedBanner}>
            <Ionicons name="star" size={14} color={C.gold} />
            <Text style={styles.ratedText}>You rated this host {myRating.stars}/5</Text>
          </View>
        )}
        {!isHost && !isParticipant && !run.is_completed && user && (
          <Pressable
            style={({ pressed }) => [
              isPlanned ? [styles.planBtn, styles.planBtnActive] : styles.primaryBtn,
              { opacity: pressed || planMutation.isPending ? 0.8 : 1 },
            ]}
            onPress={() => {
              if (isPlanned) {
                planMutation.mutate();
              } else {
                setPlanInfoPage(0);
                setShowPlanInfoModal(true);
              }
            }}
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
        {isParticipant && !run.is_completed && isLive && (
          <View style={styles.joinedBanner}>
            <Feather name="map-pin" size={14} color={C.primary} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.joinedText}>You've arrived — you're in the live count</Text>
              <Text style={styles.joinedHint}>
                Tap {run?.activity_type === "ride" ? "Join Live Ride" : "Join Live Run"} above to check in with your host
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* ── Plan info modal (How It Works) ───────────────────────────────── */}
      {showPlanInfoModal && (
        <Modal transparent animationType="slide" onRequestClose={() => setShowPlanInfoModal(false)}>
          <View style={styles.frModalWrap}>
            <Pressable style={styles.frOverlay} onPress={() => setShowPlanInfoModal(false)} />
            <View style={[styles.frSheet, { paddingBottom: insets.bottom + 24 }]}>
              <View style={styles.frHandle} />

              {planInfoPage === 0 ? (
                <>
                  <View style={styles.frHeader}>
                    <Text style={styles.frTitle}>
                      {run?.activity_type === "ride" ? "How Riding Works" : "How Running Works"}
                    </Text>
                    <Pressable onPress={() => setShowPlanInfoModal(false)} hitSlop={12}>
                      <Feather name="x" size={18} color={C.textSecondary} />
                    </Pressable>
                  </View>
                  <Text style={styles.frIntro}>
                    {run?.activity_type === "ride"
                      ? "Here's what happens after you tap 'I Plan To Ride'."
                      : "Here's what happens after you tap 'I Plan To Run'."}
                  </Text>
                  {[
                    {
                      icon: "calendar" as const,
                      title: "Reserve your spot",
                      body: run?.activity_type === "ride"
                        ? "Planning locks you into the ride lineup. The host can see you're coming."
                        : "Planning locks you into the run lineup. The host can see you're coming.",
                    },
                    {
                      icon: "map-pin" as const,
                      title: "Head to the start",
                      body: "On the day, head to the host's pin location shown on the map.",
                    },
                    {
                      icon: "clock" as const,
                      title: "Arrive within the window",
                      body: run?.activity_type === "ride"
                        ? "Check-in opens 1 hour before start. You're not officially in the ride until you're close to the start pin."
                        : "Check-in opens 1 hour before start. You're not officially in the run until you're close to the start pin.",
                    },
                    {
                      icon: "users" as const,
                      title: "Go with the group",
                      body: run?.activity_type === "ride"
                        ? "Once checked in, you're live. Ride together and enjoy the miles."
                        : "Once checked in, you're live. Run together and enjoy the miles.",
                    },
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
                  <View style={styles.planInfoPageRow}>
                    <View style={[styles.planInfoDot, styles.planInfoDotActive]} />
                    <View style={styles.planInfoDot} />
                  </View>
                  <Pressable
                    style={[styles.primaryBtn, { marginTop: 8 }]}
                    onPress={() => setPlanInfoPage(1)}
                  >
                    <Text style={styles.primaryBtnText}>Next</Text>
                    <Feather name="arrow-right" size={16} color={C.text} />
                  </Pressable>
                </>
              ) : (
                <>
                  <View style={styles.frHeader}>
                    <Text style={styles.frTitle}>Check-In Rules</Text>
                    <Pressable onPress={() => setShowPlanInfoModal(false)} hitSlop={12}>
                      <Feather name="x" size={18} color={C.textSecondary} />
                    </Pressable>
                  </View>
                  <Text style={styles.frIntro}>
                    Planning a spot doesn't make you official — arriving does.
                  </Text>
                  {[
                    {
                      icon: "navigation" as const,
                      title: "Location is required",
                      body: "Your phone needs location enabled so FARA can detect when you arrive near the start.",
                    },
                    {
                      icon: "clock" as const,
                      title: "1-hour window",
                      body: "Check-in opens exactly 1 hour before the start time. Arriving earlier won't count.",
                    },
                    {
                      icon: "check-circle" as const,
                      title: "Auto check-in",
                      body: run?.activity_type === "ride"
                        ? "When you're within ~1 km of the host's pin during the window, you're automatically added to the live rider count."
                        : "When you're within ~1 km of the host's pin during the window, you're automatically added to the live runner count.",
                    },
                    {
                      icon: "alert-circle" as const,
                      title: "No-shows are removed",
                      body: "If you planned but don't check in, your spot is released for others.",
                    },
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
                  <View style={styles.planInfoPageRow}>
                    <View style={styles.planInfoDot} />
                    <View style={[styles.planInfoDot, styles.planInfoDotActive]} />
                  </View>
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                    <Pressable
                      style={[styles.planBtn, { flex: 1 }]}
                      onPress={() => setPlanInfoPage(0)}
                    >
                      <Feather name="arrow-left" size={16} color={C.textSecondary} />
                      <Text style={styles.planBtnText}>Back</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.primaryBtn, { flex: 2 }]}
                      onPress={() => {
                        setShowPlanInfoModal(false);
                        planMutation.mutate();
                      }}
                    >
                      <Ionicons
                        name={run?.activity_type === "ride" ? "bicycle" : "walk"}
                        size={18}
                        color={C.text}
                      />
                      <Text style={styles.primaryBtnText}>
                        {run?.activity_type === "ride" ? "I'm In, Let's Ride!" : "I'm In, Let's Run!"}
                      </Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* ── Community rules popup ─────────────────────────────────────────── */}
      {showRulesModal && (
        <Modal transparent animationType="slide" onRequestClose={() => setShowRulesModal(false)}>
          <View style={styles.frModalWrap}>
            <Pressable style={styles.frOverlay} onPress={() => setShowRulesModal(false)} />
            <View style={[styles.frSheet, { paddingBottom: insets.bottom + 24 }]}>
              <View style={styles.frHandle} />
              <View style={styles.frHeader}>
                <Text style={styles.frTitle}>{run?.activity_type === "ride" ? "Before You Ride" : "Before You Run"}</Text>
                <Pressable onPress={() => setShowRulesModal(false)}>
                  <Feather name="x" size={18} color={C.textSecondary} />
                </Pressable>
              </View>
              <Text style={styles.frIntro}>
                {proximityTriggered
                  ? `You're within 1 km of this ${run?.activity_type === "ride" ? "ride" : "run"} — want to join the group?`
                  : `A quick reminder before you join the group.`}
              </Text>
              {[
                { icon: "smile" as const,      title: "Have fun",   body: run?.activity_type === "ride" ? "Riding with others is a great time. Enjoy the pace, the people, and the miles." : "Running with others is a great time. Enjoy the pace, the people, and the miles." },
                { icon: "heart" as const,      title: "Be kind",    body: run?.activity_type === "ride" ? "Cheer each other on. Every rider is working hard — support your group." : "Cheer each other on. Every runner is working hard — support your group." },
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

      {/* ── Edit Date/Time Sheet ──────────────────────────────────────────── */}
      {showEditSheet && (
        <Modal transparent animationType="slide" onRequestClose={() => setShowEditSheet(false)}>
          <View style={styles.frModalWrap}>
            <Pressable style={styles.frOverlay} onPress={() => setShowEditSheet(false)} />
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.editSheetOuter}>
              <View style={[styles.editSheet, { paddingBottom: insets.bottom + 24 }]}>
                <View style={styles.frHandle} />
                <View style={styles.editSheetHeader}>
                  <Text style={styles.editSheetTitle}>Edit Date & Time</Text>
                  <Pressable onPress={() => setShowEditSheet(false)} hitSlop={12}>
                    <Feather name="x" size={18} color={C.textSecondary} />
                  </Pressable>
                </View>
                <Text style={styles.editSheetSub}>
                  All participants will be notified of the new time.
                </Text>
                <View style={styles.editFieldGroup}>
                  <Text style={styles.editFieldLabel}>Date & Time</Text>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <TextInput
                      style={[styles.editInput, { flex: 1 }]}
                      value={editDate}
                      onChangeText={(text) => {
                        const digits = text.replace(/\D/g, "").slice(0, 6);
                        let fmt = digits;
                        if (digits.length > 2) fmt = digits.slice(0, 2) + "/" + digits.slice(2);
                        if (digits.length > 4) fmt = digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4);
                        setEditDate(fmt);
                      }}
                      placeholder="MM/DD/YY"
                      placeholderTextColor={C.textMuted}
                      keyboardType="number-pad"
                      maxLength={8}
                      autoCorrect={false}
                    />
                    <View style={{ flex: 1, flexDirection: "row", gap: 6 }}>
                      <TextInput
                        style={[styles.editInput, { flex: 1 }]}
                        value={editTime}
                        onChangeText={(text) => {
                          const digits = text.replace(/\D/g, "").slice(0, 4);
                          setEditTime(autoFormatEditTime(digits));
                        }}
                        placeholder="7:30"
                        placeholderTextColor={C.textMuted}
                        keyboardType="number-pad"
                        maxLength={5}
                        autoCorrect={false}
                      />
                      <View style={{ flexDirection: "column", gap: 4 }}>
                        {(["AM", "PM"] as const).map((period) => (
                          <Pressable
                            key={period}
                            onPress={() => { setEditAmPm(period); Haptics.selectionAsync(); }}
                            style={{
                              flex: 1, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1,
                              alignItems: "center", justifyContent: "center",
                              backgroundColor: editAmPm === period ? C.primary + "33" : C.surface,
                              borderColor: editAmPm === period ? C.primary : C.border,
                            }}
                          >
                            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 12, color: editAmPm === period ? C.primary : C.textMuted }}>{period}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  </View>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.primaryBtn, { opacity: pressed || editSaving ? 0.85 : 1, marginTop: 8 }]}
                  onPress={handleSaveEdit}
                  disabled={editSaving}
                  testID="save-edit-btn"
                >
                  {editSaving ? <ActivityIndicator color={C.text} /> : (
                    <>
                      <Feather name="check" size={16} color={C.text} />
                      <Text style={styles.primaryBtnText}>Save Changes</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>
      )}

      {/* ── Floating "Back to Live" pill (shown when tracking is minimized) ── */}
      {isMyTracking && (
        <Pressable
          style={[styles.livePill, { bottom: insets.bottom + 80 + (Platform.OS === "web" ? 34 : 0) }]}
          onPress={() => {
            liveTracking.restore();
            router.push(`/run-live/${id}`);
          }}
        >
          <Animated.View style={[styles.livePillDot, { opacity: pillPulse }]} />
          <Text style={styles.livePillLabel}>
            {liveTracking.activityType === "ride" ? "Back to Live Ride" : "Back to Live Run"}
          </Text>
          <Text style={styles.livePillDist}>{liveTracking.displayDist.toFixed(2)} mi</Text>
          <Feather name="chevron-right" size={16} color={C.primary} />
        </Pressable>
      )}
    </View>
  );
}

function makeStyles(C: ColorScheme) { return StyleSheet.create({
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
  topRatedChip: { backgroundColor: "#FFB80020", borderWidth: 1, borderColor: "#FFB80055", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  topRatedChipTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: "#FFB800" },
  ratePrompt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text, textAlign: "center", marginBottom: 8, marginTop: 4 },
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
  joinedBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, justifyContent: "center", padding: 8 },
  joinedText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },
  joinedHint: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary, marginTop: 2 },
  waitingBanner: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", padding: 12, backgroundColor: C.gold + "18", borderRadius: 12, borderWidth: 1, borderColor: C.gold + "44" },
  waitingText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.gold },
  liveBtn: { backgroundColor: "#0A3A1F", borderRadius: 14, height: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderWidth: 1.5, borderColor: C.primary },
  liveBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.primary },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
  btnDisabled: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  hostMgmtRow: { flexDirection: "row", gap: 10 },
  hostMgmtBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, height: 44, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  hostMgmtTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textSecondary },
  hostMgmtDangerBtn: { borderColor: C.danger + "55", backgroundColor: C.danger + "11" },
  hostMgmtDangerTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.danger },
  editSheetOuter: { justifyContent: "flex-end" },
  editSheet: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 16 },
  editSheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  editSheetTitle: { fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text },
  editSheetSub: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, lineHeight: 20, marginTop: -8 },
  editFieldGroup: { gap: 6 },
  editFieldLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  editInput: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 16, paddingVertical: 14, fontFamily: "Outfit_400Regular", fontSize: 16, color: C.text },
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
  planInfoPageRow: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 16 },
  planInfoDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.border },
  planInfoDotActive: { backgroundColor: C.primary, width: 18 },

  // ─── Floating live tracking pill ─────────────────────────────────────────
  livePill: {
    position: "absolute", alignSelf: "center", left: 20, right: 20,
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.surface, borderRadius: 28,
    paddingHorizontal: 18, paddingVertical: 12,
    borderWidth: 1.5, borderColor: C.primary,
    shadowColor: C.primary, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
  },
  livePillDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary },
  livePillLabel: { flex: 1, fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  livePillDist: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.primary },
}); }
