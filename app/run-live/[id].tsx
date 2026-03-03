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
  TextInput,
  KeyboardAvoidingView,
} from "react-native";
import MapView, { Marker, Polyline, Circle } from "react-native-maps";
import { KeyboardAvoidingView as KAV } from "react-native-keyboard-controller";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import C from "@/constants/colors";
import MAP_STYLE from "@/lib/mapStyle";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineKm(lat1, lon1, lat2, lon2) * 0.621371;
}

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
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const mapRef = useRef<MapView>(null);

  // GPS tracking state
  const [phase, setPhase] = useState<"idle" | "active" | "finishing">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [displayDist, setDisplayDist] = useState(0);
  const [presentToast, setPresentToast] = useState(false);
  const [saving, setSaving] = useState(false);

  // Chat state
  const [activeTab, setActiveTab] = useState<"map" | "chat">("map");
  const [messages, setMessages] = useState<any[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [lastSeenMessageCount, setLastSeenMessageCount] = useState(0);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const webWatchIdRef = useRef<number | null>(null);
  const lastCoordRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const totalDistRef = useRef(0);
  const routePathRef = useRef<Array<{ latitude: number; longitude: number }>>([]);
  const elapsedRef = useRef(0);
  const markedPresentRef = useRef(false);

  // Live poll from server
  const { data: liveState, refetch: refetchLive } = useQuery<any>({
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

  // ─── Timer ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase === "active") {
      intervalRef.current = setInterval(() => {
        setElapsed((e) => { elapsedRef.current = e + 1; return e + 1; });
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [phase]);

  // ─── Ping server with location ───────────────────────────────────────────────

  const pingServer = useCallback(async (lat: number, lng: number) => {
    if (!id) return;
    try {
      const paceNum = calcPaceNum(totalDistRef.current, elapsedRef.current);
      const res = await apiRequest("POST", `/api/runs/${id}/ping`, {
        latitude: lat,
        longitude: lng,
        cumulativeDistance: totalDistRef.current,
        pace: paceNum,
      });
      const data = await res.json();
      if (data.isPresent && !markedPresentRef.current) {
        markedPresentRef.current = true;
        setPresentToast(true);
        setTimeout(() => setPresentToast(false), 3000);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch { }
  }, [id]);

  // ─── GPS ────────────────────────────────────────────────────────────────────

  function handleCoord(latitude: number, longitude: number) {
    routePathRef.current.push({ latitude, longitude });
    if (lastCoordRef.current) {
      const d = haversineMi(lastCoordRef.current.latitude, lastCoordRef.current.longitude, latitude, longitude);
      if (d >= 0 && d < 0.3) {
        totalDistRef.current += d;
        setDisplayDist(totalDistRef.current);
      }
    }
    lastCoordRef.current = { latitude, longitude };
  }

  async function watchLocation() {
    if (Platform.OS === "web") {
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        webWatchIdRef.current = navigator.geolocation.watchPosition(
          (pos) => handleCoord(pos.coords.latitude, pos.coords.longitude),
          () => {},
          { enableHighAccuracy: true, maximumAge: 3000 }
        );
      }
      return;
    }
    try {
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 5, timeInterval: 5000 },
        (loc) => handleCoord(loc.coords.latitude, loc.coords.longitude)
      );
      locationSubRef.current = sub;
    } catch { }
  }

  function stopWatching() {
    if (Platform.OS === "web") {
      if (webWatchIdRef.current !== null) {
        navigator.geolocation?.clearWatch(webWatchIdRef.current);
        webWatchIdRef.current = null;
      }
    } else {
      locationSubRef.current?.remove();
      locationSubRef.current = null;
    }
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
  }

  // ─── Start tracking ─────────────────────────────────────────────────────────

  async function handleStartTracking() {
    if (Platform.OS !== "web") {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Location Required", "Enable location access to track your run.");
        return;
      }
    }
    lastCoordRef.current = null;
    totalDistRef.current = 0;
    elapsedRef.current = 0;
    routePathRef.current = [];
    setDisplayDist(0);
    setElapsed(0);
    setPhase("active");
    await watchLocation();

    // Send initial ping immediately to register presence
    if (Platform.OS !== "web") {
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        handleCoord(loc.coords.latitude, loc.coords.longitude);
        await pingServer(loc.coords.latitude, loc.coords.longitude);
      } catch { }
    }

    // Ping server every 10 seconds
    pingIntervalRef.current = setInterval(async () => {
      if (lastCoordRef.current) {
        await pingServer(lastCoordRef.current.latitude, lastCoordRef.current.longitude);
      }
    }, 10000);
  }

  // ─── Finish tracking ────────────────────────────────────────────────────────

  function handleFinishRun() {
    const type = run?.activity_type === "ride" ? "ride" : "run";
    Alert.alert(
      `Finish ${type === "ride" ? "Ride" : "Run"}`,
      `End your ${type} and see the results?`,
      [
        { text: "Keep Going", style: "cancel" },
        {
          text: "Finish",
          onPress: async () => {
            setPhase("finishing");
            stopWatching();
            setSaving(true);
            try {
              const finalPace = calcPaceNum(totalDistRef.current, elapsedRef.current);
              await apiRequest("POST", `/api/runs/${id}/runner-finish`, {
                finalDistance: totalDistRef.current,
                finalPace,
              });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              router.replace(`/run-results/${id}`);
            } catch (e: any) {
              Alert.alert("Error", e.message || "Could not save run");
              setPhase("active");
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }

  // ─── Chat Polling ─────────────────────────────────────────────────────────

  const fetchMessages = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiRequest("GET", `/api/runs/${id}/messages`);
      const data = await res.json();
      setMessages(data);
      if (activeTab === "chat") {
        setLastSeenMessageCount(data.length);
      }
    } catch (e) {
      console.error("Error fetching messages:", e);
    }
  }, [id, activeTab]);

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

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
    } catch (e) {
      Alert.alert("Error", "Could not send message");
      setMessages((prev) => prev.filter((m) => m.id !== newMessage.id));
    }
  };

  // ─── Cleanup ────────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => { stopWatching(); };
  }, []);

  // ─── Derived values ─────────────────────────────────────────────────────────

  const presentParticipants: any[] = liveState?.participants?.filter((p: any) => p.is_present) ?? [];
  const presentCount = liveState?.presentCount ?? 0;
  const runPin = run ? { latitude: run.location_lat, longitude: run.location_lng } : null;
  const paceNum = calcPaceNum(displayDist, elapsed);

  // Assign each other runner a stable color index
  const otherRunners = presentParticipants.filter((p: any) => p.user_id !== user?.id);

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
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
          <Feather name="x" size={20} color={C.text} />
        </Pressable>
        <View style={s.headerCenter}>
          <View style={s.livePill}>
            <View style={s.liveDot} />
            <Text style={s.livePillText}>LIVE</Text>
          </View>
          <Text style={s.headerTitle}>{run?.title ?? (run?.activity_type === "ride" ? "Live Ride" : "Live Run")}</Text>
        </View>
        <View style={s.runnerCount}>
          <Feather name="users" size={14} color={C.primary} />
          <Text style={s.runnerCountText}>{presentCount}</Text>
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
              >
                {/* 500ft presence circle around pin */}
                {runPin && (
                  <Circle
                    center={runPin}
                    radius={152}
                    strokeColor={C.primary + "55"}
                    fillColor={C.primary + "0A"}
                    strokeWidth={1.5}
                  />
                )}
                {/* Run pin */}
                {runPin && (
                  <Marker coordinate={runPin} anchor={{ x: 0.5, y: 0.5 }}>
                    <View style={s.pinMarker}>
                      <Feather name="map-pin" size={18} color={C.primary} />
                    </View>
                  </Marker>
                )}
                {/* Other runners' dots */}
                {otherRunners.map((runner: any, i: number) => {
                  if (!runner.latitude || !runner.longitude) return null;
                  const color = DOT_COLORS[i % DOT_COLORS.length];
                  return (
                    <Marker
                      key={runner.user_id}
                      coordinate={{ latitude: runner.latitude, longitude: runner.longitude }}
                      anchor={{ x: 0.5, y: 0.5 }}
                      tracksViewChanges={false}
                    >
                      <View style={[s.runnerDot, { backgroundColor: color }]}>
                        <Text style={s.runnerDotText}>{runner.name?.[0] ?? "?"}</Text>
                      </View>
                    </Marker>
                  );
                })}
                {/* Own path polyline */}
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

            {/* Present toast */}
            {presentToast && (
              <View style={s.toast}>
                <Feather name="check-circle" size={14} color={C.primary} />
                <Text style={s.toastText}>Marked as present</Text>
              </View>
            )}
          </View>

          {/* Stats strip */}
          <View style={s.statsStrip}>
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

          {/* Legend */}
          <View style={s.legendContainer}>
            <View style={s.legend}>
              {otherRunners.slice(0, 4).map((runner: any, i: number) => (
                <View key={runner.user_id} style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: DOT_COLORS[i % DOT_COLORS.length] }]} />
                  <Text style={s.legendName} numberOfLines={1}>{runner.name?.split(" ")[0]}</Text>
                </View>
              ))}
              {otherRunners.length > 4 && (
                <Text style={s.legendMore}>+{otherRunners.length - 4} more</Text>
              )}
            </View>
          </View>

          {/* Bottom action */}
          <View style={[s.bottomBar, { paddingBottom: botPad + 16 }]}>
            {phase === "idle" && (
              <Pressable style={({ pressed }) => [s.startBtn, { opacity: pressed ? 0.85 : 1 }]} onPress={handleStartTracking}>
                <Feather name="play" size={20} color={C.bg} />
                <Text style={s.startBtnText}>Start Tracking</Text>
              </Pressable>
            )}
            {phase === "active" && (
              <Pressable style={({ pressed }) => [s.finishBtn, { opacity: pressed ? 0.85 : 1 }]} onPress={handleFinishRun}>
                <Feather name="flag" size={20} color="#fff" />
                <Text style={s.finishBtnText}>Finish My Run</Text>
              </Pressable>
            )}
            {phase === "finishing" && (
              <View style={s.savingRow}>
                <ActivityIndicator color={C.primary} />
                <Text style={s.savingText}>Saving your run…</Text>
              </View>
            )}
          </View>
        </>
      ) : (
        <KAV style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}>
          <View style={s.chatContainer}>
            {!markedPresentRef.current ? (
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
                            {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
  finishBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" },
  savingRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, height: 52 },
  savingText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textSecondary },

  legendContainer: { marginHorizontal: 10, marginTop: 10 },
  legend: {
    flexDirection: "row", flexWrap: "wrap", gap: 8,
  },
  legendItem: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: C.card + "EE", borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: C.border,
  },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendName: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.text, maxWidth: 70 },
  legendMore: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary, alignSelf: "center" },

  chatContainer: { flex: 1, backgroundColor: C.bg },
  chatListContent: { padding: 16, paddingBottom: 20 },
  notPresentContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  notPresentText: { fontFamily: "Outfit_500Medium", fontSize: 16, color: C.textSecondary, textAlign: "center", lineHeight: 24 },
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
});
