import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
  FlatList,
  ScrollView,
  TextInput,
} from "react-native";
import MapView, { Marker, Polyline, Circle } from "react-native-maps";
import { KeyboardAvoidingView as KAV } from "react-native-keyboard-controller";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLiveTracking } from "@/contexts/LiveTrackingContext";
import { useActivity } from "@/contexts/ActivityContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import C from "@/constants/colors";
import MAP_STYLE from "@/lib/mapStyle";
import { LiveActivity } from "@/lib/liveActivity";
import { AndroidLiveNotification } from "@/lib/androidLiveNotification";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatElapsed(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

function calcPaceNum(distanceMi: number, elapsedSec: number): number {
  if (distanceMi < 0.01 || elapsedSec < 1) return 0;
  return elapsedSec / 60 / distanceMi;
}

function formatPaceStr(paceNum: number): string {
  if (paceNum <= 0) return "--:--";
  const m = Math.floor(paceNum);
  const s = Math.round((paceNum - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Runner dot colors (cycling palette, excluding primary green for self)
const DOT_COLORS = ["#FF6B6B", "#4ECDC4", "#FFE66D", "#A855F7", "#F97316", "#38BDF8", "#FB7185"];

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function RunLiveScreen() {
  const { id, autostart } = useLocalSearchParams<{ id: string; autostart?: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const mapRef = useRef<MapView>(null);
  const liveActivityStartedRef = useRef(false);
  const autostartAttemptedRef = useRef(false);

  // ── Tracking context (survives minimize/navigation) ──────────────────────
  const tracking = useLiveTracking();
  const {
    phase,
    elapsed,
    displayDist,
    userLocation,
    routePathRef,
    totalDistRef,
    elapsedRef,
    hasBeenPresent,
    presentConfirmed,
    startTracking,
    pauseTracking,
    resumeTracking,
    beginFinishing,
    resetTracking,
    recoverToActive,
    minimize,
    restore,
  } = tracking;

  // ── Nearby proximity state (for chat unlock independent of tracking) ─────
  const [canChatNearby, setCanChatNearby] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (run?.location_lat == null || run?.location_lng == null) return;
    const THRESHOLD_KM = 0.1524;
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 20 },
        (loc) => {
          const R = 6371;
          const toRad = (d: number) => (d * Math.PI) / 180;
          const dLat = toRad(loc.coords.latitude - run.location_lat);
          const dLon = toRad(loc.coords.longitude - run.location_lng);
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(run.location_lat)) *
              Math.cos(toRad(loc.coords.latitude)) *
              Math.sin(dLon / 2) ** 2;
          const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          if (distKm <= THRESHOLD_KM) {
            setCanChatNearby(true);
          }
        }
      );
    })();
    return () => { sub?.remove(); };
  }, [run?.location_lat, run?.location_lng]);

  // ── Local UI state ────────────────────────────────────────────────────────
  const [presentToast, setPresentToast] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"map" | "chat">("map");
  const [messages, setMessages] = useState<any[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [lastSeenMessageCount, setLastSeenMessageCount] = useState(0);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [promotedToHost, setPromotedToHost] = useState(false);
  const wasHostRef = useRef(false);
  const [tagAlongSending, setTagAlongSending] = useState<string | null>(null); // targetUserId being requested
  const [secsAgo, setSecsAgo] = useState(0);
  const lastFetchedRef = useRef<number>(Date.now());
  const [isFollowing, setIsFollowing] = useState(true);
  const [hostFinished, setHostFinished] = useState(false);

  // ── Server data ───────────────────────────────────────────────────────────

  const { data: liveState } = useQuery<any>({
    queryKey: ["/api/runs", id, "live"],
    queryFn: async () => {
      const res = await fetch(new URL(`/api/runs/${id}/live`, getApiUrl()).toString(), { credentials: "include" });
      return res.json();
    },
    refetchInterval: 5000,
    staleTime: 0,
  });

  const { data: run } = useQuery<any>({
    queryKey: ["/api/runs", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}`);
      return res.json();
    },
  });

  // Track liveState fetch time and compute staleness every second
  useEffect(() => {
    if (liveState !== undefined) {
      lastFetchedRef.current = Date.now();
      setSecsAgo(0);
    }
  }, [liveState]);

  useEffect(() => {
    const timer = setInterval(() => {
      setSecsAgo(Math.floor((Date.now() - lastFetchedRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Restore minimized state when screen mounts
  useEffect(() => {
    restore();
  }, []);

  // Auto-start tracking when host activates run and current user is a confirmed participant
  // (fires when liveState transitions from falsy → true while screen is already open)
  useEffect(() => {
    if (!liveState?.isActive) return;
    if (!run || !user) return;
    if (run.host_id === user.id) return;
    if (phase !== "idle") return;
    if (Platform.OS === "web") return;
    if (autostart) return; // handled by the autostart effect below
    const isParticipant = liveState?.participants?.some(
      (p: any) => p.user_id === user.id && p.is_present
    );
    if (!isParticipant) return;
    handleStartTracking();
  }, [liveState?.isActive]);

  // Auto-start via notification deep-link (?autostart=1):
  // When a present participant taps the "run is starting" notification, they land here
  // with liveState already active. Fire immediately once both liveState and run are ready.
  // One-shot guard prevents repeated retries if handleStartTracking() fails (e.g. location denied).
  useEffect(() => {
    if (!autostart) return;
    if (autostartAttemptedRef.current) return;
    if (!liveState?.isActive) return;
    if (!run || !user) return;
    if (run.host_id === user.id) return;
    if (phase !== "idle") return;
    if (Platform.OS === "web") return;
    const isPresent = liveState?.participants?.some(
      (p: any) => p.user_id === user.id && p.is_present
    );
    if (!isPresent) return;
    autostartAttemptedRef.current = true;
    handleStartTracking();
  }, [liveState, run, autostart]);

  // Live Activity (iOS) + Android lock screen notification: update on each GPS fix
  useEffect(() => {
    if (phase !== "active" || !liveActivityStartedRef.current) return;
    const actType = (run?.activity_type ?? "run") as "run" | "ride" | "walk";
    const paceNum = calcPaceNum(totalDistRef.current, elapsedRef.current);
    LiveActivity.update({
      elapsedSeconds: elapsedRef.current,
      distanceMiles: totalDistRef.current,
      paceMinPerMile: paceNum,
      activityType: actType,
    });
    if (Platform.OS === "android") {
      AndroidLiveNotification.update({
        elapsedSeconds: elapsedRef.current,
        distanceMiles: totalDistRef.current,
        paceMinPerMile: paceNum,
        activityType: actType,
        coordinates: routePathRef.current,
        runId: id ?? undefined,
      });
    }
  }, [displayDist]);

  // Show toast when presence is confirmed by context
  useEffect(() => {
    if (presentConfirmed) {
      setPresentToast(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const t = setTimeout(() => setPresentToast(false), 3000);
      return () => clearTimeout(t);
    }
  }, [presentConfirmed]);

  // Use liveState.hostId so host detection updates every 5s (auto-promotion)
  const isHost = (liveState?.hostId ?? run?.host_id) === user?.id;
  const { setActivityFilter } = useActivity();

  // Host always has chat access
  useEffect(() => {
    if (isHost) setCanChatNearby(true);
  }, [isHost]);

  // Detect host promotion and show banner
  useEffect(() => {
    if (!user?.id) return;
    const nowHost = (liveState?.hostId ?? run?.host_id) === user.id;
    if (nowHost && !wasHostRef.current && liveState?.isActive) {
      setPromotedToHost(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const t = setTimeout(() => setPromotedToHost(false), 5000);
      wasHostRef.current = true;
      return () => clearTimeout(t);
    }
    wasHostRef.current = nowHost;
  }, [liveState?.hostId, liveState?.isActive]);

  // Auto-redirect participants when run is force-completed by host
  useEffect(() => {
    if (!liveState?.isCompleted) return;
    // Host navigates themselves via handleEndForEveryone or when run auto-completes
    if (isHost && !hostFinished) return;
    if (phase === "active" || phase === "paused") {
      const finalPace = calcPaceNum(totalDistRef.current, elapsedRef.current);
      apiRequest("POST", `/api/runs/${id}/runner-finish`, {
        finalDistance: totalDistRef.current,
        finalPace,
      }).catch(() => {}).finally(() => {
        resetTracking();
        setTimeout(() => { router.replace(`/run-results/${id}?autoShare=1`); }, 0);
      });
    } else {
      resetTracking();
      setTimeout(() => { router.replace(`/run-results/${id}?autoShare=1`); }, 0);
    }
  }, [liveState?.isCompleted]);

  // ── Start Solo (leave group → go solo) ───────────────────────────────────

  function handleStartSolo() {
    const type = run?.activity_type === "ride" ? "ride" : run?.activity_type === "walk" ? "walk" : "run";
    Alert.alert(
      `Start Solo ${type === "ride" ? "Ride" : type === "walk" ? "Walk" : "Run"}`,
      `Leave this group event and start a solo ${type} instead?`,
      [
        { text: "Stay", style: "cancel" },
        {
          text: "Start Solo",
          onPress: async () => {
            try { await apiRequest("POST", `/api/runs/${id}/leave`); } catch (_) {}
            setActivityFilter(run?.activity_type ?? "run");
            router.replace("/run-tracking" as any);
          },
        },
      ]
    );
  }

  // ── Start tracking ────────────────────────────────────────────────────────

  async function handleStartTracking() {
    if (Platform.OS !== "web") {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        const type = run?.activity_type === "ride" ? "ride" : run?.activity_type === "walk" ? "walk" : "run";
        Alert.alert("Location Required", `Enable location access to track your ${type}.`);
        return;
      }
    }
    // Host activates the run the moment they start tracking
    if (isHost && !run?.is_active) {
      try {
        await apiRequest("POST", `/api/runs/${id}/start`);
        qc.invalidateQueries({ queryKey: ["/api/runs", id] });
      } catch (e: any) {
        Alert.alert("Error", e.message || "Could not start event");
        return;
      }
    }
    liveActivityStartedRef.current = false;
    await startTracking(id!, run?.activity_type ?? "run", user?.id);
    const actType = ((run?.activity_type ?? "run") as "run" | "ride" | "walk");
    LiveActivity.start({
      elapsedSeconds: 0,
      distanceMiles: 0,
      paceMinPerMile: 0,
      activityType: actType,
    });
    if (Platform.OS === "android") {
      AndroidLiveNotification.start({
        elapsedSeconds: 0,
        distanceMiles: 0,
        paceMinPerMile: 0,
        activityType: actType,
        coordinates: [],
        runId: id ?? undefined,
      });
    }
    liveActivityStartedRef.current = true;
  }

  // ── Finish tracking ───────────────────────────────────────────────────────

  function handleFinishRun() {
    const type = run?.activity_type === "ride" ? "ride" : run?.activity_type === "walk" ? "walk" : "run";
    Alert.alert(
      `Finish ${type === "ride" ? "Ride" : type === "walk" ? "Walk" : "Run"}`,
      `End your ${type} and see the results?`,
      [
        { text: "Keep Going", style: "cancel" },
        {
          text: "Finish",
          onPress: async () => {
            beginFinishing();
            setSaving(true);
            const finalPace = calcPaceNum(totalDistRef.current, elapsedRef.current);
            LiveActivity.end({
              elapsedSeconds: elapsedRef.current,
              distanceMiles: totalDistRef.current,
              paceMinPerMile: finalPace,
              activityType: (run?.activity_type ?? "run") as "run" | "ride" | "walk",
            });
            if (Platform.OS === "android") {
              AndroidLiveNotification.end({
                elapsedSeconds: elapsedRef.current,
                distanceMiles: totalDistRef.current,
                paceMinPerMile: finalPace,
                activityType: (run?.activity_type ?? "run") as "run" | "ride" | "walk",
              });
            }
            let lastErr: any;
            let saved = false;
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
                await apiRequest("POST", `/api/runs/${id}/runner-finish`, {
                  finalDistance: totalDistRef.current,
                  finalPace,
                });
                saved = true;
                break;
              } catch (e: any) {
                lastErr = e;
              }
            }
            if (saved) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              resetTracking();
              qc.invalidateQueries({ queryKey: ["/api/runs"] });
              if (isHost) {
                setHostFinished(true);
              } else {
                setTimeout(() => { router.replace(`/run-results/${id}?autoShare=1`); }, 0);
              }
            } else {
              Alert.alert("Error", lastErr?.message || "Could not save run. Please try again.");
              recoverToActive();
              setSaving(false);
            }
          },
        },
      ]
    );
  }

  // ── End for Everyone (host only, after they've finished) ─────────────────

  async function handleEndForEveryone() {
    Alert.alert(
      "End Run for Everyone?",
      "This will end the run for all participants still running.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "End for Everyone",
          style: "destructive",
          onPress: async () => {
            try {
              await apiRequest("POST", `/api/runs/${id}/host-end`, {});
              qc.invalidateQueries({ queryKey: ["/api/runs"] });
              setTimeout(() => { router.replace(`/run-results/${id}?autoShare=1`); }, 0);
            } catch (e: any) {
              Alert.alert("Error", e.message || "Could not end run for everyone");
            }
          },
        },
      ]
    );
  }

  // ── X / minimize button ───────────────────────────────────────────────────

  function handleClose() {
    if (phase === "active") {
      minimize();
    }
    router.back();
  }

  // ── Tag-Along Handlers ────────────────────────────────────────────────────

  async function handleTagAlongRequest(targetUserId: string) {
    setTagAlongSending(targetUserId);
    try {
      await apiRequest("POST", `/api/runs/${id}/tag-along/request`, { targetUserId });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not send tag-along request");
    } finally {
      setTagAlongSending(null);
    }
  }

  async function handleTagAlongCancel(requestId: string) {
    try {
      await apiRequest("POST", `/api/runs/${id}/tag-along/cancel/${requestId}`);
    } catch {}
  }

  async function handleTagAlongAccept(requestId: string) {
    try {
      await apiRequest("POST", `/api/runs/${id}/tag-along/accept/${requestId}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not accept request");
    }
  }

  async function handleTagAlongDecline(requestId: string) {
    try {
      await apiRequest("POST", `/api/runs/${id}/tag-along/decline/${requestId}`);
    } catch {}
  }

  // ── Chat Polling ──────────────────────────────────────────────────────────

  const fetchMessages = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiRequest("GET", `/api/runs/${id}/messages`);
      const data = await res.json();
      setMessages(data);
      if (activeTab === "chat") {
        setLastSeenMessageCount(data.length);
      }
    } catch {}
  }, [id, activeTab]);

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  // Map auto-follow — animate to user position on Android when isFollowing
  useEffect(() => {
    if (Platform.OS !== "web" && Platform.OS !== "ios" && isFollowing && userLocation && phase === "active") {
      mapRef.current?.animateToRegion({
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.004,
        longitudeDelta: 0.004,
      }, 600);
    }
  }, [userLocation, isFollowing, phase]);

  const handleSendMessage = async () => {
    if (!messageInput.trim() || !id || !user) return;

    const newMessage = {
      id: "temp-" + Date.now(),
      user_id: user.id,
      sender_name: user.name || "Me",
      sender_photo: user.photo_url,
      message: messageInput.trim(),
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [newMessage, ...prev]);
    setMessageInput("");
    setLastSeenMessageCount((prev) => prev + 1);

    try {
      await apiRequest("POST", `/api/runs/${id}/messages`, {
        message: newMessage.message,
      });
      fetchMessages();
    } catch {
      Alert.alert("Error", "Could not send message");
      setMessages((prev) => prev.filter((m) => m.id !== newMessage.id));
    }
  };

  // ── Derived values ────────────────────────────────────────────────────────

  const presentParticipants: any[] = liveState?.participants?.filter((p: any) => p.is_present) ?? [];
  const presentCount = liveState?.presentCount ?? 0;
  const activeCount = liveState?.activeCount ?? presentCount;
  const staleCount = liveState?.staleCount ?? 0;
  const runPin = run ? { latitude: run.location_lat, longitude: run.location_lng } : null;
  const paceNum = calcPaceNum(displayDist, elapsed);
  const otherRunners = presentParticipants.filter((p: any) => p.user_id !== user?.id);

  // ── Tag-Along derived state ────────────────────────────────────────────────
  const tagAlongRequests: any[] = liveState?.tagAlongRequests ?? [];
  // Pending requests targeting the current user (they need to respond)
  const incomingTagAlongRequests = tagAlongRequests.filter(
    (r: any) => r.target_id === user?.id && r.status === "pending"
  );
  // My outgoing request (I sent it)
  const myOutgoingRequest = tagAlongRequests.find(
    (r: any) => r.requester_id === user?.id
  );
  // Accepted tag-along for current user as requester
  const myTagAlongLink = tagAlongRequests.find(
    (r: any) => r.requester_id === user?.id && r.status === "accepted"
  );
  // Name of the person I'm tagging along with
  const myTagAlongPartnerName = myTagAlongLink?.target_name ?? null;
  const isTaggingAlong = !!myTagAlongLink;

  // ── Leaderboard: merge server distances with user's live distance ─────────
  const leaderboardRows = presentParticipants
    .map((p: any) => {
      const isSelf = p.user_id === user?.id;
      const distMi = isSelf
        ? displayDist
        : parseFloat(p.cumulative_distance ?? p.final_distance ?? 0);
      const pace = isSelf ? paceNum : parseFloat(p.current_pace ?? p.final_pace ?? 0);
      return { user_id: p.user_id, name: p.name || "Runner", distMi, pace, isStale: !!p.isStale };
    })
    .sort((a, b) => b.distMi - a.distMi);

  const myDistMi = leaderboardRows.find((r) => r.user_id === user?.id)?.distMi ?? displayDist;

  const initialRegion = runPin
    ? { latitude: runPin.latitude, longitude: runPin.longitude, latitudeDelta: 0.015, longitudeDelta: 0.015 }
    : undefined;

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const hasNewMessages = messages.length > lastSeenMessageCount && activeTab === "map";

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={[s.header, { paddingTop: topPad + 10 }]}>
        <Pressable onPress={handleClose} style={s.backBtn} hitSlop={12}>
          <Feather
            name={phase === "active" ? "chevron-down" : "x"}
            size={20}
            color={C.text}
          />
        </Pressable>
        <View style={s.headerCenter}>
          <View style={s.livePill}>
            <View style={s.liveDot} />
            <Text style={s.livePillText}>LIVE</Text>
          </View>
          <Text style={s.headerTitle}>{run?.title ?? (run?.activity_type === "ride" ? "Live Ride" : run?.activity_type === "walk" ? "Live Walk" : "Live Run")}</Text>
        </View>
        <View style={s.runnerCount}>
          <Feather name="users" size={14} color={C.primary} />
          <Text style={s.runnerCountText}>
            {staleCount > 0 ? `${activeCount} active · ${staleCount} lost` : presentCount}
          </Text>
        </View>
      </View>

      {/* Tab Toggle */}
      <View style={s.tabBarContainer}>
        <View style={s.tabBar}>
          <Pressable
            onPress={() => setActiveTab("map")}
            style={[s.tabPill, activeTab === "map" && s.activeTabPill]}
          >
            <Feather name="map" size={16} color={activeTab === "map" ? "#fff" : C.textMuted} />
            <Text style={[s.tabText, activeTab === "map" && s.activeTabText]}>Map</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setActiveTab("chat");
              setLastSeenMessageCount(messages.length);
            }}
            style={[s.tabPill, activeTab === "chat" && s.activeTabPill]}
          >
            <View>
              <Feather name="message-circle" size={16} color={activeTab === "chat" ? "#fff" : C.textMuted} />
              {hasNewMessages && <View style={s.unreadBadge} />}
            </View>
            <Text style={[s.tabText, activeTab === "chat" && s.activeTabText]}>Chat</Text>
          </Pressable>
        </View>
      </View>

      {activeTab === "map" ? (
        <>
          {/* Map */}
          <View style={s.mapCard}>
            {Platform.OS !== "web" ? (
              <MapView
                ref={mapRef}
                style={StyleSheet.absoluteFillObject}
                customMapStyle={MAP_STYLE}
                initialRegion={initialRegion}
                showsUserLocation
                showsMyLocationButton={false}
                followsUserLocation={Platform.OS === "ios" && isFollowing && phase === "active"}
                onPanDrag={() => { if (isFollowing) setIsFollowing(false); }}
              >
                {runPin && (
                  <Circle
                    center={runPin}
                    radius={152}
                    strokeColor={C.primary + "55"}
                    fillColor={C.primary + "0A"}
                    strokeWidth={1.5}
                  />
                )}
                {runPin && (
                  <Marker coordinate={runPin} anchor={{ x: 0.5, y: 0.5 }}>
                    <View style={s.pinMarker}>
                      <Feather name="map-pin" size={18} color={C.primary} />
                    </View>
                  </Marker>
                )}
                {otherRunners.map((runner: any, i: number) => {
                  if (!runner.latitude || !runner.longitude) return null;
                  const color = runner.isStale ? "#888888" : DOT_COLORS[i % DOT_COLORS.length];
                  return (
                    <Marker
                      key={runner.user_id}
                      coordinate={{ latitude: runner.latitude, longitude: runner.longitude }}
                      anchor={{ x: 0.5, y: 0.5 }}
                      tracksViewChanges={false}
                    >
                      <View style={[s.runnerDot, { backgroundColor: color, opacity: runner.isStale ? 0.5 : 1 }]}>
                        <Text style={s.runnerDotText}>{runner.name?.[0] ?? "?"}</Text>
                      </View>
                    </Marker>
                  );
                })}
                {routePathRef.current.length > 1 && (
                  <Polyline
                    coordinates={routePathRef.current}
                    strokeColor={C.primary}
                    strokeWidth={3}
                  />
                )}
              </MapView>
            ) : (
              <View style={[StyleSheet.absoluteFillObject, { alignItems: "center", justifyContent: "center" }]}>
                <Feather name="map" size={48} color={C.border} />
                <Text style={{ fontFamily: "Outfit_400Regular", color: C.textSecondary, marginTop: 8 }}>
                  Map not available on web
                </Text>
              </View>
            )}

            {/* Back-to-me FAB — shown when user has panned away during active or paused tracking */}
            {(phase === "active" || phase === "paused") && !isFollowing && Platform.OS !== "web" && (
              <Pressable
                style={s.backToMeBtn}
                onPress={() => {
                  setIsFollowing(true);
                  if (Platform.OS !== "ios" && userLocation) {
                    mapRef.current?.animateToRegion({
                      latitude: userLocation.latitude,
                      longitude: userLocation.longitude,
                      latitudeDelta: 0.004,
                      longitudeDelta: 0.004,
                    }, 600);
                  }
                }}
              >
                <Feather name="navigation" size={16} color={C.primary} />
              </Pressable>
            )}

            {presentToast && (
              <View style={s.toast}>
                <Feather name="check-circle" size={14} color={C.primary} />
                <Text style={s.toastText}>Marked as present</Text>
              </View>
            )}
            {promotedToHost && (
              <View style={[s.toast, s.promotionToast]}>
                <Feather name="star" size={14} color="#FFB800" />
                <Text style={[s.toastText, { color: "#FFB800" }]}>You're now the host!</Text>
              </View>
            )}
          </View>

          {/* Incoming tag-along request banners */}
          {incomingTagAlongRequests.map((req: any) => (
            <View key={req.id} style={s.tagAlongBanner}>
              <View style={s.tagAlongBannerLeft}>
                <Feather name="link" size={14} color={C.primary} />
                <Text style={s.tagAlongBannerText} numberOfLines={2}>
                  <Text style={{ fontFamily: "Outfit_700Bold" }}>{req.requester_name.split(" ")[0]}</Text>
                  {" wants to tag along with your GPS"}
                </Text>
              </View>
              <View style={s.tagAlongBannerActions}>
                <Pressable
                  style={[s.tagAlongActionBtn, s.tagAlongAcceptBtn]}
                  onPress={() => handleTagAlongAccept(req.id)}
                >
                  <Text style={s.tagAlongAcceptTxt}>Accept</Text>
                </Pressable>
                <Pressable
                  style={s.tagAlongActionBtn}
                  onPress={() => handleTagAlongDecline(req.id)}
                >
                  <Text style={s.tagAlongDeclineTxt}>Decline</Text>
                </Pressable>
              </View>
            </View>
          ))}

          {/* Stats strip — or "Tagging along" banner if linked */}
          {isTaggingAlong ? (
            <View style={s.taggingAlongStrip}>
              <Feather name="link-2" size={16} color={C.primary} />
              <Text style={s.taggingAlongText}>
                Tagging along with{" "}
                <Text style={{ fontFamily: "Outfit_700Bold" }}>
                  {myTagAlongPartnerName?.split(" ")[0] ?? "your partner"}
                </Text>
                {" — your run will be saved automatically"}
              </Text>
            </View>
          ) : (
          <View style={{ position: "relative" }}>
            <View style={[s.statsStrip, phase === "paused" && s.statsStripPaused]}>
              <View style={s.statItem}>
                <Text style={s.statValue}>{displayDist.toFixed(2)}</Text>
                <Text style={s.statLabel}>mi</Text>
              </View>
              <View style={s.statDivider} />
              <View style={s.statItem}>
                <Text style={s.statValue}>{formatElapsed(elapsed)}</Text>
                <Text style={s.statLabel}>time</Text>
              </View>
              <View style={s.statDivider} />
              <View style={s.statItem}>
                <Text style={s.statValue}>{formatPaceStr(paceNum)}</Text>
                <Text style={s.statLabel}>min/mi</Text>
              </View>
            </View>
            {phase === "paused" && (
              <View style={s.pausedBadge} pointerEvents="none">
                <Feather name="pause" size={11} color={C.text} />
                <Text style={s.pausedBadgeTxt}>Paused</Text>
              </View>
            )}
          </View>
          )}

          {/* Leaderboard toggle + inline panel */}
          <Pressable
            style={s.leaderboardToggle}
            onPress={() => setShowLeaderboard((v) => !v)}
            hitSlop={8}
          >
            <Text style={s.leaderboardToggleText}>
              {showLeaderboard ? "Hide leaderboard" : "Tap for leaderboard"}
            </Text>
            <Feather
              name={showLeaderboard ? "chevron-down" : "chevron-up"}
              size={12}
              color={C.textMuted}
            />
          </Pressable>

          {showLeaderboard && (
            <View style={s.leaderboardPanel}>
              <Text style={[s.leaderboardStaleness, secsAgo >= 30 ? { color: "#FF6B6B" } : secsAgo >= 10 ? { color: "#F5A623" } : { color: C.textMuted }]}>
                {secsAgo === 0 ? "Live" : `Last updated ${secsAgo}s ago`}
              </Text>
              {leaderboardRows.length === 0 ? (
                <Text style={s.leaderboardEmpty}>No runners tracked yet</Text>
              ) : (
              <ScrollView style={{ maxHeight: 200 }} scrollEnabled={leaderboardRows.length > 3}>
                {leaderboardRows.map((runner, i) => {
                  const isSelf = runner.user_id === user?.id;
                  const delta = runner.distMi - myDistMi;
                  return (
                    <View key={runner.user_id} style={[s.leaderboardRow, isSelf && s.leaderboardSelfRow]}>
                      <Text style={s.leaderboardRank}>#{i + 1}</Text>
                      <View style={[s.leaderboardAvatar, { backgroundColor: isSelf ? C.primary : DOT_COLORS[i % DOT_COLORS.length] }]}>
                        <Text style={s.leaderboardAvatarText}>{runner.name[0]?.toUpperCase()}</Text>
                      </View>
                      <View style={s.leaderboardInfo}>
                        <Text style={[s.leaderboardName, isSelf && { color: C.primary }]} numberOfLines={1}>
                          {isSelf ? "You" : runner.name.split(" ")[0]}
                        </Text>
                        <Text style={s.leaderboardPaceTxt}>
                          {runner.isStale ? "Signal lost" : `${formatPaceStr(runner.pace)} /mi`}
                        </Text>
                      </View>
                      <View style={s.leaderboardRight}>
                        <Text style={s.leaderboardDist}>{runner.distMi.toFixed(2)} mi</Text>
                        {!isSelf && (
                          <Text style={[s.leaderboardDelta, { color: delta > 0 ? "#FF6B6B" : C.primary }]}>
                            {Math.abs(delta) < 0.01
                              ? "neck & neck"
                              : delta > 0
                              ? `${Math.abs(delta).toFixed(2)} mi ahead`
                              : `${Math.abs(delta).toFixed(2)} mi behind`}
                          </Text>
                        )}
                      </View>
                      {/* Tag-Along button — only for non-self, non-host participants when run is active */}
                      {!isSelf && !isHost && runner.user_id !== liveState?.hostId && liveState?.isActive && !isTaggingAlong && (() => {
                        const myReq = myOutgoingRequest;
                        const isSendingToThis = tagAlongSending === runner.user_id;
                        const pendingToThis = myReq?.target_id === runner.user_id && myReq?.status === "pending";
                        const acceptedToThis = myReq?.target_id === runner.user_id && myReq?.status === "accepted";
                        if (acceptedToThis) return null; // already accepted, shown in banner above
                        if (pendingToThis) {
                          return (
                            <Pressable
                              style={s.tagAlongCancelBtn}
                              onPress={() => handleTagAlongCancel(myReq.id)}
                              hitSlop={8}
                            >
                              <Feather name="x" size={11} color={C.textMuted} />
                              <Text style={s.tagAlongCancelTxt}>Pending</Text>
                            </Pressable>
                          );
                        }
                        return (
                          <Pressable
                            style={[s.tagAlongBtn, (isSendingToThis || !!myReq) && { opacity: 0.5 }]}
                            onPress={() => !myReq && handleTagAlongRequest(runner.user_id)}
                            disabled={isSendingToThis || !!myReq}
                            hitSlop={8}
                          >
                            <Feather name="link" size={11} color={C.primary} />
                            <Text style={s.tagAlongBtnTxt}>
                              {isSendingToThis ? "…" : "Tag Along"}
                            </Text>
                          </Pressable>
                        );
                      })()}
                    </View>
                  );
                })}
              </ScrollView>
              )}
            </View>
          )}

          {/* Bottom action */}
          <View style={[s.bottomBar, { paddingBottom: botPad + 16 }]}>
            {isHost && hostFinished && (
              <View style={s.hostDoneBar}>
                <Text style={s.hostDoneText}>
                  You finished — {activeCount} still running
                </Text>
                <Pressable onPress={handleEndForEveryone} style={s.endAllBtn}>
                  <Text style={s.endAllBtnText}>End for Everyone</Text>
                </Pressable>
              </View>
            )}
            {phase === "idle" && isHost && !hostFinished && (
              <Pressable style={({ pressed }) => [s.startBtn, { opacity: pressed ? 0.85 : 1 }]} onPress={handleStartTracking}>
                <Feather name="play" size={20} color={C.bg} />
                <Text style={s.startBtnText}>{run?.activity_type === "ride" ? "Start Ride" : run?.activity_type === "walk" ? "Start Walk" : "Start Run"}</Text>
              </Pressable>
            )}
            {phase === "idle" && !!run && !isHost && (
              <View style={s.waitingColumn}>
                {!liveState?.isActive && run?.date && (Date.now() - new Date(run.date).getTime()) > 30 * 60 * 1000 && (
                  <View style={s.lateHostBanner}>
                    <Feather name="alert-circle" size={14} color="#F59E0B" />
                    <Text style={s.lateHostTxt}>Host hasn't started yet — no pressure to wait</Text>
                  </View>
                )}
                <View style={s.waitingRow}>
                  <ActivityIndicator size="small" color={C.primary} />
                  <Text style={s.waitingText}>
                    {liveState?.isActive ? "Starting your tracking…" : "Waiting for host to start…"}
                  </Text>
                </View>
                {!liveState?.isActive && (
                  <Pressable
                    style={({ pressed }) => [s.startSoloBtn, { opacity: pressed ? 0.75 : 1 }]}
                    onPress={handleStartSolo}
                  >
                    <Feather name="user" size={14} color={C.textSecondary} />
                    <Text style={s.startSoloBtnText}>
                      {run?.activity_type === "ride" ? "Start Solo Ride" : run?.activity_type === "walk" ? "Start Solo Walk" : "Start Solo Run"}
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
            {(phase === "active" || phase === "paused") && (
              <View style={s.actionRow}>
                <Pressable
                  style={({ pressed }) => [s.pauseResumeBtn, phase === "paused" && s.pauseResumeBtnActive, { opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    if (phase === "active") pauseTracking();
                    else resumeTracking();
                  }}
                >
                  <Feather name={phase === "active" ? "pause" : "play"} size={20} color={phase === "paused" ? C.bg : C.text} />
                </Pressable>
                <Pressable style={({ pressed }) => [s.finishBtn, s.finishBtnFlex, { opacity: pressed ? 0.85 : 1 }]} onPress={handleFinishRun}>
                  <Feather name="flag" size={20} color="#fff" />
                  <Text style={s.finishBtnText}>{run?.activity_type === "ride" ? "Finish My Ride" : run?.activity_type === "walk" ? "Finish My Walk" : "Finish My Run"}</Text>
                </Pressable>
              </View>
            )}
            {phase === "finishing" && (
              <View style={s.savingRow}>
                <ActivityIndicator color={C.primary} />
                <Text style={s.savingText}>Saving your {run?.activity_type === "ride" ? "ride" : run?.activity_type === "walk" ? "walk" : "run"}…</Text>
              </View>
            )}
          </View>
        </>
      ) : (
        <KAV style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}>
          <View style={s.chatContainer}>
            {!(canChatNearby || hasBeenPresent) ? (
              <View style={s.notPresentContainer}>
                <Text style={s.notPresentText}>
                  You'll be able to chat once you arrive at the start point 📍
                </Text>
                <Pressable onPress={() => setActiveTab("map")} style={s.backToMapLink}>
                  <Text style={s.backToMapLinkText}>Back to Map</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <FlatList
                  data={messages}
                  inverted
                  contentContainerStyle={s.chatListContent}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => {
                    const isOwn = item.user_id === user?.id;
                    return (
                      <View style={[s.msgWrapper, isOwn ? s.msgOwnWrapper : s.msgOtherWrapper]}>
                        {!isOwn && (
                          <View style={s.msgAvatar}>
                            <Text style={s.msgAvatarText}>{item.sender_name?.[0] ?? "?"}</Text>
                          </View>
                        )}
                        <View style={[s.msgBubbleWrapper, isOwn ? { alignItems: "flex-end" } : { alignItems: "flex-start" }]}>
                          {!isOwn && <Text style={s.msgSenderName}>{item.sender_name}</Text>}
                          <View style={[s.msgBubble, isOwn ? s.msgOwnBubble : s.msgOtherBubble]}>
                            <Text style={[s.msgText, isOwn ? s.msgOwnText : s.msgOtherText]}>{item.message}</Text>
                          </View>
                          <Text style={s.msgTime}>
                            {new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </Text>
                        </View>
                      </View>
                    );
                  }}
                  ListEmptyComponent={
                    <View style={s.emptyChat}>
                      <Text style={s.emptyChatText}>No messages yet — be the first to say something!</Text>
                    </View>
                  }
                />
                <View style={[s.inputContainer, { paddingBottom: botPad + 10 }]}>
                  <TextInput
                    style={s.textInput}
                    placeholder="Type a message..."
                    placeholderTextColor={C.textMuted}
                    value={messageInput}
                    onChangeText={setMessageInput}
                    multiline
                  />
                  <Pressable
                    onPress={handleSendMessage}
                    style={({ pressed }) => [s.sendBtn, { opacity: pressed || !messageInput.trim() ? 0.6 : 1 }]}
                    disabled={!messageInput.trim()}
                  >
                    <Feather name="send" size={20} color={C.primary} />
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </KAV>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
  },
  headerCenter: { flex: 1, alignItems: "center", gap: 2 },
  headerTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.text },
  livePill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: C.primary + "22", borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 3, borderWidth: 1, borderColor: C.primary + "55",
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.primary },
  livePillText: { fontFamily: "Outfit_700Bold", fontSize: 10, color: C.primary, letterSpacing: 1 },
  runnerCount: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: C.border,
  },
  runnerCountText: { fontFamily: "Outfit_700Bold", fontSize: 13, color: C.primary },

  tabBarContainer: { paddingHorizontal: 10, paddingBottom: 10 },
  tabBar: {
    flexDirection: "row", backgroundColor: C.surface, borderRadius: 12, padding: 4,
    borderWidth: 1, borderColor: C.border,
  },
  tabPill: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 8, borderRadius: 8,
  },
  activeTabPill: { backgroundColor: C.primary },
  tabText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textMuted },
  activeTabText: { color: "#fff" },
  unreadBadge: {
    position: "absolute", top: -2, right: -4, width: 8, height: 8,
    borderRadius: 4, backgroundColor: C.primary, borderWidth: 1.5, borderColor: "#fff",
  },

  mapCard: { flex: 1, marginHorizontal: 10, borderRadius: 20, overflow: "hidden", backgroundColor: C.surface },
  pinMarker: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.card, borderWidth: 2, borderColor: C.primary,
    alignItems: "center", justifyContent: "center",
  },
  runnerDot: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#fff",
  },
  runnerDotText: { fontFamily: "Outfit_700Bold", fontSize: 12, color: "#fff" },
  backToMeBtn: {
    position: "absolute", bottom: 12, right: 12,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4,
    elevation: 4,
  },
  toast: {
    position: "absolute", top: 12, alignSelf: "center",
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: C.primary + "55",
  },
  toastText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },
  statsStrip: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-around",
    backgroundColor: C.surface, marginHorizontal: 10, marginTop: 10,
    borderRadius: 16, paddingVertical: 14, borderWidth: 1, borderColor: C.border,
  },
  statItem: { alignItems: "center", flex: 1 },
  statValue: { fontFamily: "Outfit_700Bold", fontSize: 22, color: C.text },
  statLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textSecondary, marginTop: 1 },
  statDivider: { width: 1, height: 32, backgroundColor: C.border },
  bottomBar: { paddingHorizontal: 16, paddingTop: 12 },
  startBtn: {
    backgroundColor: C.primary, borderRadius: 14, height: 52,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
  },
  startBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.bg },
  finishBtn: {
    backgroundColor: "#C0392B", borderRadius: 14, height: 52,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
  },
  finishBtnFlex: { flex: 1 },
  finishBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" },
  actionRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
  },
  pauseResumeBtn: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
  },
  pauseResumeBtnActive: {
    backgroundColor: C.primary, borderColor: C.primary,
  },
  statsStripPaused: { opacity: 0.7 },
  pausedBadge: {
    position: "absolute", top: 8, right: 18,
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: C.card + "EE", borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: C.orange + "88",
  },
  pausedBadgeTxt: { fontFamily: "Outfit_700Bold", fontSize: 10, color: C.text, letterSpacing: 0.5 },
  savingRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, height: 52 },
  savingText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textSecondary },
  hostDoneBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 14, paddingVertical: 12, backgroundColor: C.primary + "18",
    borderRadius: 14, borderWidth: 1, borderColor: C.primary + "30",
  },
  hostDoneText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary, flex: 1 },
  endAllBtn: {
    backgroundColor: "#C0392B", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
  },
  endAllBtnText: { fontFamily: "Outfit_700Bold", fontSize: 13, color: "#fff" },
  waitingColumn: { alignItems: "center", gap: 10 },
  waitingRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, height: 52 },
  waitingText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textSecondary },
  lateHostBanner: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#F59E0B18", borderRadius: 10, borderWidth: 1, borderColor: "#F59E0B40", marginBottom: 2 },
  lateHostTxt: { fontFamily: "Outfit_400Regular", fontSize: 12, color: "#F59E0B", flex: 1 },
  startSoloBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  startSoloBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },

  promotionToast: { borderColor: "#FFB80055", top: 54 },

  leaderboardToggle: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    marginHorizontal: 10, marginTop: 8, paddingVertical: 6,
  },
  leaderboardToggleText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted },
  leaderboardPanel: {
    marginHorizontal: 10, marginTop: 4, marginBottom: 2,
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    overflow: "hidden",
  },
  leaderboardEmpty: {
    fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textMuted,
    textAlign: "center", padding: 16,
  },
  leaderboardStaleness: {
    fontFamily: "Outfit_400Regular", fontSize: 11,
    textAlign: "right", paddingHorizontal: 14, paddingTop: 8, paddingBottom: 2,
  },
  leaderboardRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  leaderboardSelfRow: { backgroundColor: C.primary + "0A" },
  leaderboardRank: {
    fontFamily: "Outfit_700Bold", fontSize: 12, color: C.textMuted, width: 24, textAlign: "center",
  },
  leaderboardAvatar: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  leaderboardAvatarText: { fontFamily: "Outfit_700Bold", fontSize: 12, color: "#fff" },
  leaderboardInfo: { flex: 1, gap: 1 },
  leaderboardName: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.text },
  leaderboardPaceTxt: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },
  leaderboardRight: { alignItems: "flex-end", gap: 2 },
  leaderboardDist: { fontFamily: "Outfit_700Bold", fontSize: 13, color: C.text },
  leaderboardDelta: { fontFamily: "Outfit_400Regular", fontSize: 10 },

  chatContainer: { flex: 1, backgroundColor: C.bg },
  chatListContent: { padding: 16, paddingBottom: 20 },
  notPresentContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  notPresentText: { fontFamily: "Outfit_400Regular", fontSize: 16, color: C.textSecondary, textAlign: "center", lineHeight: 24 },
  backToMapLink: { marginTop: 16 },
  backToMapLinkText: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.primary },
  emptyChat: { padding: 40, alignItems: "center" },
  emptyChatText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textMuted, textAlign: "center" },

  msgWrapper: { flexDirection: "row", marginBottom: 16, gap: 10 },
  msgOwnWrapper: { justifyContent: "flex-end" },
  msgOtherWrapper: { justifyContent: "flex-start" },
  msgAvatar: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: C.border,
    alignItems: "center", justifyContent: "center", marginTop: 4,
  },
  msgAvatarText: { fontFamily: "Outfit_700Bold", fontSize: 12, color: C.textSecondary },
  msgBubbleWrapper: { maxWidth: "80%", gap: 4 },
  msgSenderName: { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: C.textMuted, marginLeft: 4 },
  msgBubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  msgOwnBubble: { backgroundColor: C.primary, borderBottomRightRadius: 4 },
  msgOtherBubble: { backgroundColor: C.card, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: C.border },
  msgText: { fontFamily: "Outfit_400Regular", fontSize: 15 },
  msgOwnText: { color: "#fff" },
  msgOtherText: { color: C.text },
  msgTime: { fontFamily: "Outfit_400Regular", fontSize: 10, color: C.textMuted, marginTop: 2 },

  inputContainer: {
    flexDirection: "row", alignItems: "flex-end", gap: 10,
    paddingHorizontal: 16, paddingTop: 12, backgroundColor: C.bg,
    borderTopWidth: 1, borderColor: C.border,
  },
  textInput: {
    flex: 1, backgroundColor: C.surface, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10, paddingTop: 10,
    fontFamily: "Outfit_400Regular", fontSize: 15, color: C.text,
    borderWidth: 1, borderColor: C.border, maxHeight: 100,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: C.surface, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.border,
  },

  tagAlongBanner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginHorizontal: 10, marginTop: 8, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: C.primary + "14", borderRadius: 12,
    borderWidth: 1, borderColor: C.primary + "44", gap: 10,
  },
  tagAlongBannerLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  tagAlongBannerText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.text, flex: 1 },
  tagAlongBannerActions: { flexDirection: "row", gap: 8 },
  tagAlongActionBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  tagAlongAcceptBtn: { backgroundColor: C.primary, borderColor: C.primary },
  tagAlongAcceptTxt: { fontFamily: "Outfit_700Bold", fontSize: 12, color: "#fff" },
  tagAlongDeclineTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.textSecondary },

  taggingAlongStrip: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.primary + "18", marginHorizontal: 10, marginTop: 10,
    borderRadius: 16, paddingVertical: 16, paddingHorizontal: 16,
    borderWidth: 1, borderColor: C.primary + "44",
  },
  taggingAlongText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.text, flex: 1, lineHeight: 20 },

  tagAlongBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
    backgroundColor: C.primary + "18", borderWidth: 1, borderColor: C.primary + "44",
  },
  tagAlongBtnTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: C.primary },
  tagAlongCancelBtn: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  tagAlongCancelTxt: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },
});
