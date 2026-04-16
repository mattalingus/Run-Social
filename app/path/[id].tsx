import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Alert,
  Image,
  ScrollView,
} from "react-native";
import MapView, { Polyline, Marker } from "react-native-maps";
import { Stack, useLocalSearchParams, router } from "expo-router";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { darkColors as C } from "@/constants/colors";
import { apiRequest } from "@/lib/query-client";
import MAP_STYLE from "@/lib/mapStyle";
import { toDisplayDist, type DistanceUnit } from "@/lib/units";
import { useAuth } from "@/contexts/AuthContext";

const MAP_TYPE = Platform.OS === "ios" ? ("mutedStandard" as const) : ("standard" as const);

type RoutePoint = { latitude: number; longitude: number };

type PublicPreview = {
  path_id: string;
  name: string;
  distance_miles: number | null;
  activity_type: string | null;
  route_path: RoutePoint[] | null;
  community_path_id: string | null;
  owner_name: string;
  owner_photo: string | null;
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

export default function SharedPathScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const distUnit: DistanceUnit = ((user as any)?.distance_unit ?? "miles") as DistanceUnit;

  const [userLoc, setUserLoc] = useState<RoutePoint | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedLocally, setSavedLocally] = useState(false);

  const { data: preview, isLoading, error } = useQuery<PublicPreview>({
    queryKey: ["/api/saved-paths", id, "public-preview"],
    enabled: !!id && !!user,
  });

  useEffect(() => {
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
  }, []);

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
      await apiRequest("POST", `/api/saved-paths/${preview.path_id}/clone-direct`);
      qc.invalidateQueries({ queryKey: ["/api/saved-paths"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSavedLocally(true);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not save route.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 }}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} hitSlop={12}>
          <Feather name="x" size={24} color={C.text} />
        </Pressable>
        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 17, color: C.text }}>Shared Route</Text>
        <View style={{ width: 24 }} />
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={C.primary} />
        </View>
      ) : error || !preview ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <Feather name="alert-circle" size={32} color={C.textMuted} />
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.text, marginTop: 12 }}>
            Route unavailable
          </Text>
          <Text
            style={{
              fontFamily: "Outfit_400Regular",
              fontSize: 13,
              color: C.textMuted,
              marginTop: 6,
              textAlign: "center",
            }}
          >
            This route may have been deleted or is no longer accessible.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 }}>
            {preview.owner_photo ? (
              <Image source={{ uri: preview.owner_photo }} style={{ width: 28, height: 28, borderRadius: 14 }} />
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
                  {preview.owner_name.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary }}>
              By {preview.owner_name}
            </Text>
          </View>

          <Text
            style={{
              fontFamily: "Outfit_700Bold",
              fontSize: 22,
              color: C.text,
              marginBottom: 14,
            }}
            numberOfLines={3}
          >
            {preview.name}
          </Text>

          {Platform.OS !== "web" && region && route.length >= 2 ? (
            <View style={{ height: 260, borderRadius: 14, overflow: "hidden", marginBottom: 16 }}>
              <MapView
                style={{ flex: 1 }}
                initialRegion={region}
                customMapStyle={MAP_STYLE}
                mapType={MAP_TYPE}
                pointerEvents="none"
              >
                <Polyline coordinates={route} strokeColor={C.primary} strokeWidth={4} />
                {startPoint && (
                  <Marker coordinate={startPoint}>
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
                height: 140,
                borderRadius: 14,
                backgroundColor: C.card,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <Feather name="map" size={28} color={C.textMuted} />
            </View>
          )}

          <View
            style={{
              flexDirection: "row",
              backgroundColor: C.card,
              borderRadius: 12,
              padding: 14,
              marginBottom: 20,
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
                {preview.distance_miles != null ? toDisplayDist(preview.distance_miles, distUnit) : "—"}
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
            disabled={saving || savedLocally}
            onPress={handleSave}
            style={{
              backgroundColor: savedLocally ? C.primaryMuted ?? C.primary + "22" : C.primary,
              borderWidth: savedLocally ? 1 : 0,
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
              <Feather
                name={savedLocally ? "check" : "bookmark"}
                size={16}
                color={savedLocally ? C.primary : C.bg}
              />
            )}
            <Text
              style={{
                fontFamily: "Outfit_700Bold",
                fontSize: 14,
                color: savedLocally ? C.primary : C.bg,
              }}
            >
              {savedLocally ? "Saved to My Paths" : "Save to My Paths"}
            </Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}
