import React, { useRef, useMemo, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Animated,
  Platform,
} from "react-native";
import MapView, { Marker, Polyline, Circle } from "react-native-maps";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import { useTheme } from "@/contexts/ThemeContext";
import { type ColorScheme } from "@/constants/colors";
import MAP_STYLE from "@/lib/mapStyle";

// ─── Constants ───────────────────────────────────────────────────────────────

const DOT_COLORS = ["#FF6B6B", "#4ECDC4", "#FFE66D", "#A855F7", "#F97316", "#38BDF8", "#FB7185"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPace(paceNum: number): string {
  if (!paceNum || paceNum <= 0) return "--:--";
  let m = Math.floor(paceNum);
  let s = Math.round((paceNum - m) * 60);
  if (s === 60) { s = 0; m += 1; }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function RunSpectateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { C, theme } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const pulseAnim = useRef(new Animated.Value(0.3)).current;
  const mapRef = useRef<MapView>(null);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.2, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const { data: run } = useQuery<any>({
    queryKey: ["/api/runs", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}`);
      return res.json();
    },
  });

  const { data: liveData } = useQuery<any>({
    queryKey: ["/api/runs", id, "live"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}/live`);
      return res.json();
    },
    refetchInterval: 5000,
    staleTime: 0,
  });

  const { data: pathData } = useQuery<any>({
    queryKey: ["/api/runs", id, "tracking-path"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/runs/${id}/tracking-path`);
      return res.json();
    },
    refetchInterval: 10000,
    staleTime: 0,
  });

  const participants: any[] = liveData?.participants ?? [];
  const presentParticipants = participants.filter((p) => p.is_present && p.latitude && p.longitude);
  const presentCount = liveData?.presentCount ?? 0;
  const path: { latitude: number; longitude: number }[] = Array.isArray(pathData?.path) ? pathData.path : [];

  const avgDist = presentParticipants.length > 0
    ? presentParticipants.reduce((sum: number, p: any) => sum + (p.cumulative_distance ?? 0), 0) / presentParticipants.length
    : 0;

  const leadPace = presentParticipants.length > 0
    ? Math.min(...presentParticipants.filter((p: any) => (p.current_pace ?? 0) > 0).map((p: any) => p.current_pace))
    : 0;

  const startCoord = run?.location_lat && run?.location_lng
    ? { latitude: run.location_lat, longitude: run.location_lng }
    : null;

  const isCompleted = liveData?.isCompleted ?? false;
  const isActive = liveData?.isActive ?? false;
  const noData = path.length === 0 && presentCount === 0;
  const initialRegion = startCoord
    ? {
        latitude: startCoord.latitude,
        longitude: startCoord.longitude,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      }
    : undefined;

  return (
    <View style={s.container}>
      {Platform.OS !== "web" ? (
        <>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFillObject}
            customMapStyle={theme === "dark" ? MAP_STYLE : []}
            initialRegion={initialRegion}
            showsUserLocation={false}
            showsMyLocationButton={false}
          >
            {startCoord && (
              <Circle
                center={startCoord}
                radius={152}
                strokeColor="#00D97E55"
                fillColor="#00D97E0A"
                strokeWidth={1.5}
              />
            )}
            {startCoord && (
              <Marker coordinate={startCoord} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={s.pinMarker}>
                  <Feather name="map-pin" size={18} color="#00D97E" />
                </View>
              </Marker>
            )}
            {path.length > 1 && (
              <Polyline
                coordinates={path}
                strokeColor="#00D97E"
                strokeWidth={4}
              />
            )}
            {presentParticipants.map((p: any, i: number) => {
              const color = DOT_COLORS[i % DOT_COLORS.length];
              return (
                <Marker
                  key={p.user_id}
                  coordinate={{ latitude: p.latitude, longitude: p.longitude }}
                  anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges={false}
                >
                  <View style={[s.runnerDot, { backgroundColor: color }]}>
                    <Text style={s.runnerDotText}>{p.name?.[0]?.toUpperCase() ?? "?"}</Text>
                  </View>
                </Marker>
              );
            })}
          </MapView>

          {/* No-data overlay */}
          {noData && !isCompleted && (
            <View style={s.noDataOverlay} pointerEvents="none">
              <View style={s.noDataCard}>
                <ActivityIndicator size="small" color="#00D97E" />
                <Text style={s.noDataText}>Waiting for the event to start…</Text>
              </View>
            </View>
          )}

          {/* Ended overlay */}
          {isCompleted && (
            <View style={s.endedOverlay}>
              <View style={s.endedCard}>
                <Feather name="flag" size={28} color="#00D97E" />
                <Text style={s.endedTitle}>This event has ended</Text>
                <Pressable
                  style={s.endedBtn}
                  onPress={() => router.replace(`/run-results/${id}` as any)}
                >
                  <Text style={s.endedBtnText}>View Results</Text>
                </Pressable>
              </View>
            </View>
          )}
        </>
      ) : (
        <View style={[s.webPlaceholder, { paddingTop: topPad }]}>
          <Ionicons name="phone-portrait-outline" size={48} color={C.textMuted} />
          <Text style={s.webPlaceholderText}>Open on your phone to watch live</Text>
        </View>
      )}

      {/* Floating header */}
      <View style={[s.header, { top: topPad + (Platform.OS !== "web" ? 12 : 0) }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={12}>
          <Feather name="arrow-left" size={20} color="#fff" />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle} numberOfLines={1}>
            {run?.title ?? "Live Event"}
          </Text>
        </View>
        <View style={s.livePill}>
          <Animated.View style={[s.liveDot, { opacity: pulseAnim }]} />
          <Text style={s.livePillText}>LIVE</Text>
        </View>
      </View>

      {/* Floating stats panel */}
      {!isCompleted && (
        <View style={[s.statsPanelWrap, { bottom: botPad + 20 }]}>
          <View style={s.statsPanel}>
            <View style={s.statItem}>
              <Ionicons name="people" size={16} color="#00D97E" />
              <Text style={s.statValue}>{presentCount}</Text>
              <Text style={s.statLabel}>IN</Text>
            </View>
            <View style={s.statDivider} />
            <View style={s.statItem}>
              <Text style={s.statValue}>{avgDist.toFixed(2)}</Text>
              <Text style={s.statLabel}>avg dist mi</Text>
            </View>
            <View style={s.statDivider} />
            <View style={s.statItem}>
              <Text style={s.statValue}>{leadPace > 0 ? formatPace(leadPace) : "--:--"}</Text>
              <Text style={s.statLabel}>lead pace</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

function makeStyles(C: ColorScheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: "#050C09" },

    header: {
      position: "absolute",
      left: 16,
      right: 16,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "rgba(0,0,0,0.58)",
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 8,
    },
    backBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: "rgba(255,255,255,0.15)",
      alignItems: "center",
      justifyContent: "center",
    },
    headerCenter: { flex: 1 },
    headerTitle: {
      fontFamily: "Outfit_700Bold",
      fontSize: 15,
      color: "#fff",
    },
    livePill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      backgroundColor: "#FF4444" + "33",
      borderRadius: 10,
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderWidth: 1,
      borderColor: "#FF4444" + "77",
    },
    liveDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: "#FF4444",
    },
    livePillText: {
      fontFamily: "Outfit_700Bold",
      fontSize: 10,
      color: "#FF4444",
      letterSpacing: 1,
    },

    pinMarker: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: "rgba(0,0,0,0.6)",
      borderWidth: 2,
      borderColor: "#00D97E",
      alignItems: "center",
      justifyContent: "center",
    },
    runnerDot: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: "#fff",
    },
    runnerDotText: {
      fontFamily: "Outfit_700Bold",
      fontSize: 12,
      color: "#fff",
    },

    statsPanelWrap: {
      position: "absolute",
      left: 16,
      right: 16,
      gap: 10,
    },
    statsPanel: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-around",
      backgroundColor: "rgba(5, 12, 9, 0.90)",
      borderRadius: 20,
      paddingVertical: 16,
      paddingHorizontal: 8,
      borderWidth: 1,
      borderColor: "#00D97E33",
    },
    statItem: {
      flex: 1,
      alignItems: "center",
      gap: 4,
    },
    statValue: {
      fontFamily: "Outfit_700Bold",
      fontSize: 22,
      color: "#F0FFF4",
    },
    statLabel: {
      fontFamily: "Outfit_400Regular",
      fontSize: 11,
      color: "#8FAF97",
    },
    statDivider: {
      width: 1,
      height: 36,
      backgroundColor: "#182B1F",
    },

    noDataOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: "center",
      justifyContent: "center",
    },
    noDataCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: "rgba(5,12,9,0.85)",
      borderRadius: 14,
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderWidth: 1,
      borderColor: "#00D97E33",
    },
    noDataText: {
      fontFamily: "Outfit_600SemiBold",
      fontSize: 14,
      color: "#F0FFF4",
    },

    endedOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.65)",
      alignItems: "center",
      justifyContent: "center",
    },
    endedCard: {
      backgroundColor: "#0D1510",
      borderRadius: 20,
      padding: 28,
      alignItems: "center",
      gap: 12,
      borderWidth: 1,
      borderColor: "#182B1F",
      marginHorizontal: 32,
    },
    endedTitle: {
      fontFamily: "Outfit_700Bold",
      fontSize: 18,
      color: "#F0FFF4",
    },
    endedBtn: {
      backgroundColor: "#00D97E",
      borderRadius: 12,
      paddingHorizontal: 28,
      paddingVertical: 13,
      marginTop: 4,
    },
    endedBtnText: {
      fontFamily: "Outfit_700Bold",
      fontSize: 15,
      color: "#050C09",
    },

    webPlaceholder: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      backgroundColor: C.bg,
    },
    webPlaceholderText: {
      fontFamily: "Outfit_400Regular",
      fontSize: 15,
      color: C.textSecondary,
      textAlign: "center",
    },
  });
}
