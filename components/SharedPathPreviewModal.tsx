import React, { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  Image,
} from "react-native";
import MapView, { Polyline, Marker } from "react-native-maps";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { darkColors as C } from "@/constants/colors";
import { apiRequest } from "@/lib/query-client";
import MAP_STYLE from "@/lib/mapStyle";
import { toDisplayDist, type DistanceUnit } from "@/lib/units";

const MAP_TYPE = Platform.OS === "ios" ? ("mutedStandard" as const) : ("standard" as const);

type RoutePoint = { latitude: number; longitude: number };

type Preview = {
  share_id: string;
  cloned: boolean;
  path_id: string;
  name: string;
  distance_miles: number | null;
  activity_type: string | null;
  route_path: RoutePoint[] | null;
  from_name: string;
  from_photo: string | null;
};

function haversineMiles(a: RoutePoint, b: RoutePoint) {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

export default function SharedPathPreviewModal({
  visible,
  shareId,
  onClose,
  distUnit = "miles",
}: {
  visible: boolean;
  shareId: string | null;
  onClose: () => void;
  distUnit?: DistanceUnit;
}) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [userLoc, setUserLoc] = useState<RoutePoint | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedLocally, setSavedLocally] = useState(false);

  const { data: preview, isLoading, error } = useQuery<Preview>({
    queryKey: ["/api/path-shares", shareId, "preview"],
    enabled: !!shareId && visible,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!visible) return;
    if (Platform.OS === "web") return;
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") return;
        const loc = await Location.getLastKnownPositionAsync();
        if (!cancelled && loc) {
          setUserLoc({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      setSavedLocally(false);
    }
  }, [visible]);

  const route = preview?.route_path ?? [];
  const startPoint = route[0] ?? null;
  const distFromStart = useMemo(() => {
    if (!userLoc || !startPoint) return null;
    return haversineMiles(userLoc, startPoint);
  }, [userLoc, startPoint]);

  const region = useMemo(() => {
    if (route.length < 2) return null;
    const lats = route.map((p) => p.latitude);
    const lngs = route.map((p) => p.longitude);
    const minLat = Math.min(...lats),
      maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs),
      maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(maxLat - minLat, 0.005) * 1.6,
      longitudeDelta: Math.max(maxLng - minLng, 0.005) * 1.6,
    };
  }, [route]);

  const handleSave = async () => {
    if (!preview) return;
    setSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await apiRequest("POST", `/api/saved-paths/${preview.share_id}/clone`);
      qc.invalidateQueries({ queryKey: ["/api/saved-paths"] });
      qc.invalidateQueries({ queryKey: ["/api/notifications"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSavedLocally(true);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save route.");
    } finally {
      setSaving(false);
    }
  };

  const isSaved = savedLocally || !!preview?.cloned;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(0,0,0,0.55)" }]}
          onPress={onClose}
        />
        <View
          style={{
            backgroundColor: C.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 20,
            paddingBottom: insets.bottom + 20,
            maxHeight: "88%",
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
              marginBottom: 4,
            }}
          >
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text }}>Shared Route</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Feather name="x" size={22} color={C.textSecondary} />
            </Pressable>
          </View>

          {isLoading ? (
            <View style={{ paddingVertical: 60, alignItems: "center" }}>
              <ActivityIndicator color={C.primary} />
            </View>
          ) : error || !preview ? (
            <View style={{ paddingVertical: 40, alignItems: "center" }}>
              <Feather name="alert-circle" size={28} color={C.textMuted} />
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 14,
                  color: C.text,
                  marginTop: 10,
                }}
              >
                Route unavailable
              </Text>
              <Text
                style={{
                  fontFamily: "Outfit_400Regular",
                  fontSize: 12,
                  color: C.textMuted,
                  marginTop: 4,
                  textAlign: "center",
                }}
              >
                This share may have been removed.
              </Text>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
                {preview.from_photo ? (
                  <Image
                    source={{ uri: preview.from_photo }}
                    style={{ width: 28, height: 28, borderRadius: 14 }}
                  />
                ) : (
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: C.primaryMuted ?? C.primary + "22",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 12, color: C.primary }}>
                      {preview.from_name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                )}
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary }}>
                  Shared by {preview.from_name}
                </Text>
              </View>

              <Text
                style={{
                  fontFamily: "Outfit_700Bold",
                  fontSize: 20,
                  color: C.text,
                  marginBottom: 10,
                }}
                numberOfLines={2}
              >
                {preview.name}
              </Text>

              {Platform.OS !== "web" && region && route.length >= 2 ? (
                <View style={{ height: 220, borderRadius: 14, overflow: "hidden", marginBottom: 14 }}>
                  <MapView
                    style={{ flex: 1 }}
                    initialRegion={region}
                    customMapStyle={MAP_STYLE}
                    mapType={MAP_TYPE}
                    scrollEnabled={false}
                    zoomEnabled={false}
                    rotateEnabled={false}
                    pitchEnabled={false}
                    pointerEvents="none"
                  >
                    <Polyline coordinates={route} strokeColor={C.primary} strokeWidth={4} />
                    {startPoint && (
                      <Marker coordinate={startPoint} pinColor={C.primary}>
                        <View
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 7,
                            backgroundColor: C.primary,
                            borderWidth: 2,
                            borderColor: "#fff",
                          }}
                        />
                      </Marker>
                    )}
                  </MapView>
                </View>
              ) : (
                <View
                  style={{
                    height: 120,
                    borderRadius: 14,
                    backgroundColor: C.card,
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 14,
                  }}
                >
                  <Feather name="map" size={28} color={C.textMuted} />
                  <Text
                    style={{
                      fontFamily: "Outfit_400Regular",
                      fontSize: 12,
                      color: C.textMuted,
                      marginTop: 6,
                    }}
                  >
                    Map preview unavailable
                  </Text>
                </View>
              )}

              <View
                style={{
                  flexDirection: "row",
                  backgroundColor: C.card,
                  borderRadius: 12,
                  padding: 14,
                  marginBottom: 18,
                  borderWidth: 1,
                  borderColor: C.border,
                }}
              >
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text
                    style={{
                      fontFamily: "Outfit_400Regular",
                      fontSize: 11,
                      color: C.textMuted,
                      letterSpacing: 0.4,
                      textTransform: "uppercase",
                    }}
                  >
                    Length
                  </Text>
                  <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text, marginTop: 4 }}>
                    {preview.distance_miles != null
                      ? toDisplayDist(preview.distance_miles, distUnit)
                      : "—"}
                  </Text>
                </View>
                <View style={{ width: 1, backgroundColor: C.border }} />
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text
                    style={{
                      fontFamily: "Outfit_400Regular",
                      fontSize: 11,
                      color: C.textMuted,
                      letterSpacing: 0.4,
                      textTransform: "uppercase",
                    }}
                  >
                    Start
                  </Text>
                  <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text, marginTop: 4 }}>
                    {distFromStart != null ? `${toDisplayDist(distFromStart, distUnit)} away` : "—"}
                  </Text>
                </View>
              </View>

              <Pressable
                disabled={saving || isSaved}
                onPress={handleSave}
                style={{
                  backgroundColor: isSaved ? C.primaryMuted ?? C.primary + "22" : C.primary,
                  borderWidth: isSaved ? 1 : 0,
                  borderColor: C.primary + "55",
                  borderRadius: 12,
                  paddingVertical: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 8,
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={C.bg} />
                ) : (
                  <Feather name={isSaved ? "check" : "bookmark"} size={16} color={isSaved ? C.primary : C.bg} />
                )}
                <Text
                  style={{
                    fontFamily: "Outfit_700Bold",
                    fontSize: 14,
                    color: isSaved ? C.primary : C.bg,
                  }}
                >
                  {isSaved ? "Saved to My Paths" : "Save to My Paths"}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
