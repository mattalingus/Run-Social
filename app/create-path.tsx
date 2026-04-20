import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from "react-native-maps";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import ScreenHeader from "@/components/ScreenHeader";
import { useTheme } from "@/contexts/ThemeContext";
import { apiRequest } from "@/lib/query-client";

type LatLng = { latitude: number; longitude: number };
type Activity = "run" | "walk" | "ride";

const MAP_TYPE = Platform.OS === "ios" ? ("mutedStandard" as const) : ("standard" as const);

function haversineMiles(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const la1 = (a.latitude * Math.PI) / 180;
  const la2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function polylineMiles(pts: LatLng[]): number {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += haversineMiles(pts[i - 1], pts[i]);
  return m;
}

export default function CreatePathScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { C } = useTheme();
  const qc = useQueryClient();
  const mapRef = useRef<MapView>(null);
  const params = useLocalSearchParams<{ lat?: string; lng?: string; latDelta?: string; lngDelta?: string }>();
  const startLat = params.lat ? parseFloat(String(params.lat)) : null;
  const startLng = params.lng ? parseFloat(String(params.lng)) : null;
  const startLatDelta = params.latDelta ? parseFloat(String(params.latDelta)) : null;
  const startLngDelta = params.lngDelta ? parseFloat(String(params.lngDelta)) : null;
  const hasStartRegion = startLat != null && startLng != null && !Number.isNaN(startLat) && !Number.isNaN(startLng);

  const [userLoc, setUserLoc] = useState<LatLng | null>(null);
  const [waypoints, setWaypoints] = useState<LatLng[]>([]);
  // Segments parallel to waypoints: segments[i] connects waypoints[i] -> waypoints[i+1]
  const [segments, setSegments] = useState<LatLng[][]>([]);
  const [snapping, setSnapping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [pathName, setPathName] = useState("");
  const [activities, setActivities] = useState<Activity[]>(["run"]);

  function toggleActivity(a: Activity) {
    setActivities((cur) => {
      if (cur.includes(a)) {
        // Must keep at least one selected
        if (cur.length === 1) return cur;
        return cur.filter((x) => x !== a);
      }
      return [...cur, a];
    });
  }

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({});
      const here = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setUserLoc(here);
      // If the screen was opened with a start region (from the map), don't
      // yank the view back to the user's GPS — stay wherever the user was.
      if (!hasStartRegion) {
        mapRef.current?.animateToRegion({ ...here, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 600);
      }
    })();
  }, [hasStartRegion]);

  async function snapSegment(from: LatLng, to: LatLng): Promise<LatLng[]> {
    try {
      const res = await apiRequest("POST", "/api/routing/walk", {
        from: { lat: from.latitude, lng: from.longitude },
        to: { lat: to.latitude, lng: to.longitude },
      });
      const data = await res.json();
      if (Array.isArray(data.points) && data.points.length >= 2) {
        return data.points.map((p: { lat: number; lng: number }) => ({ latitude: p.lat, longitude: p.lng }));
      }
    } catch {}
    return [from, to];
  }

  async function handleMapPress(e: { nativeEvent: { coordinate: LatLng } }) {
    if (snapping) return;
    let coord = e.nativeEvent.coordinate;
    const prev = waypoints[waypoints.length - 1];
    if (!prev) {
      // Seed two identical points on the very first tap so the polyline is
      // mounted with ≥2 coords from the start (avoids the iOS first-segment
      // draw bug). Markers are unnumbered, so the duplicate is invisible.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setWaypoints([coord, coord]);
      return;
    }
    // Loop closure: if tapping within ~25m of the first waypoint AND we have
    // at least 2 segments already, snap exactly to the start to close cleanly.
    const first = waypoints[0];
    const closingLoop = waypoints.length >= 4 && haversineMiles(coord, first) * 5280 < 82; // ~25m
    if (closingLoop) {
      coord = first;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setSnapping(true);
    const seg = await snapSegment(prev, coord);
    setWaypoints((w) => [...w, coord]);
    setSegments((s) => [...s, seg]);
    setSnapping(false);
  }

  function handleUndo() {
    if (waypoints.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // If only the seeded duplicate pair remains, clear entirely.
    if (waypoints.length <= 2) {
      setWaypoints([]);
      setSegments([]);
      return;
    }
    setWaypoints((w) => w.slice(0, -1));
    setSegments((s) => s.slice(0, -1));
  }

  function handleClear() {
    if (waypoints.length === 0) return;
    Alert.alert("Clear path?", "This removes all waypoints.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: () => { setWaypoints([]); setSegments([]); } },
    ]);
  }

  function handleFinish() {
    if (waypoints.length < 3) {
      Alert.alert("Need at least 2 points", "Tap on the map to add waypoints first.");
      return;
    }
    setPathName("");
    setShowSave(true);
  }

  async function submitSave() {
    const name = pathName.trim();
    if (!name) { Alert.alert("Name required", "Enter a name for this path"); return; }
    const fullPts: LatLng[] = [];
    for (const seg of segments) {
      if (fullPts.length === 0) fullPts.push(...seg);
      else fullPts.push(...seg.slice(1));
    }
    const miles = polylineMiles(fullPts);
    setSaving(true);
    try {
      const res = await apiRequest("POST", "/api/saved-paths", {
        name,
        routePath: fullPts,
        distanceMiles: miles,
        activityType: activities[0],
        activityTypes: activities,
      });
      const saved = await res.json();
      if (!saved?.id) throw new Error("Failed to create path");
      await apiRequest("POST", `/api/saved-paths/${saved.id}/publish`);
      qc.invalidateQueries({ queryKey: ["/api/saved-paths"] });
      qc.invalidateQueries({ queryKey: ["/api/community-paths"] });
      setShowSave(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not save path");
    } finally {
      setSaving(false);
    }
  }

  const fullPolyline: LatLng[] = [];
  for (const seg of segments) {
    if (fullPolyline.length === 0) fullPolyline.push(...seg);
    else fullPolyline.push(...seg.slice(1));
  }
  const miles = polylineMiles(fullPolyline);

  const initialRegion = hasStartRegion
    ? {
        latitude: startLat!,
        longitude: startLng!,
        latitudeDelta: startLatDelta ?? 0.02,
        longitudeDelta: startLngDelta ?? 0.02,
      }
    : userLoc
    ? { ...userLoc, latitudeDelta: 0.01, longitudeDelta: 0.01 }
    : { latitude: 37.7749, longitude: -122.4194, latitudeDelta: 0.05, longitudeDelta: 0.05 };

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <ScreenHeader title="Create Path" variant="close" />

      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        provider={PROVIDER_DEFAULT}
        mapType={MAP_TYPE}
        showsUserLocation
        initialRegion={initialRegion}
        onPress={handleMapPress}
      >
        {/* Always mount the main polyline (dummy coords when empty) so iOS
            draws the first real segment without the conditional-mount bug. */}
        <Polyline
          coordinates={fullPolyline.length >= 2 ? fullPolyline : [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }]}
          strokeColor={fullPolyline.length >= 2 ? C.primary : "transparent"}
          strokeWidth={fullPolyline.length >= 2 ? 5 : 0}
        />
        {waypoints.map((w, i) => {
          // Skip duplicate-seeded marker at the start (first two coords are identical on first tap).
          if (i === 1 && waypoints[0] && w.latitude === waypoints[0].latitude && w.longitude === waypoints[0].longitude) {
            return null;
          }
          return (
            <Marker key={`wp-${i}`} coordinate={w} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={[styles.wpDot, { backgroundColor: C.primary, borderColor: C.bg }]} />
            </Marker>
          );
        })}
      </MapView>

      <View style={[styles.statusBar, { top: insets.top + 56, backgroundColor: C.surface, borderColor: C.borderLight }]}>
        <Text style={[styles.statusTxt, { color: C.text }]}>
          {(() => {
            const n = waypoints.length === 0 ? 0 : waypoints.length - 1;
            if (n === 0) return "Tap map to start";
            return `${n} point${n === 1 ? "" : "s"} · ${miles.toFixed(2)} mi`;
          })()}
        </Text>
        {snapping && <ActivityIndicator size="small" color={C.primary} style={{ marginLeft: 8 }} />}
      </View>

      <View style={[styles.toolbar, { bottom: insets.bottom + 16 }]}>
        <Pressable
          style={[styles.toolBtn, { backgroundColor: C.surface, borderColor: C.borderLight, opacity: waypoints.length === 0 ? 0.4 : 1 }]}
          onPress={handleUndo}
          disabled={waypoints.length === 0}
        >
          <Ionicons name="arrow-undo" size={22} color={C.text} />
        </Pressable>
        <Pressable
          style={[styles.toolBtn, { backgroundColor: C.surface, borderColor: C.borderLight, opacity: waypoints.length === 0 ? 0.4 : 1 }]}
          onPress={handleClear}
          disabled={waypoints.length === 0}
        >
          <Feather name="trash-2" size={20} color={C.text} />
        </Pressable>
        <Pressable
          style={[styles.finishBtn, { backgroundColor: C.primary, opacity: waypoints.length < 3 ? 0.4 : 1 }]}
          onPress={handleFinish}
          disabled={waypoints.length < 3}
        >
          <Text style={[styles.finishTxt, { color: C.bg }]}>Finish · {miles.toFixed(2)} mi</Text>
        </Pressable>
      </View>

      <Modal visible={showSave} transparent animationType="slide" onRequestClose={() => setShowSave(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1, justifyContent: "flex-end" }}
        >
          <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} onPress={() => setShowSave(false)} />
          <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 24, paddingBottom: insets.bottom + 24 }}>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text, marginBottom: 8 }}>Save Path</Text>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textMuted, marginBottom: 20 }}>
            {miles.toFixed(2)} miles · {Math.max(0, waypoints.length - 1)} waypoints. This will be published publicly.
          </Text>
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textMuted, marginBottom: 6 }}>Name</Text>
          <TextInput
            value={pathName}
            onChangeText={setPathName}
            placeholder="e.g. Mason Creek East Loop"
            placeholderTextColor={C.textMuted}
            autoFocus
            style={{ backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border, color: C.text, fontFamily: "Outfit_400Regular", fontSize: 15, padding: 12, marginBottom: 16 }}
          />
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textMuted, marginBottom: 6 }}>
            Activity <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12 }}>(select all that apply)</Text>
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 24 }}>
            {(["run", "walk", "ride"] as Activity[]).map((a) => {
              const selected = activities.includes(a);
              return (
                <Pressable
                  key={a}
                  onPress={() => toggleActivity(a)}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: selected ? C.primary : C.border,
                    backgroundColor: selected ? C.primary : C.card,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: selected ? C.bg : C.text, textTransform: "capitalize" }}>
                    {a}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            style={{ backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: "center", opacity: saving ? 0.6 : 1 }}
            onPress={submitSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color={C.bg} size="small" />
            ) : (
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: C.bg }}>Publish Path</Text>
            )}
          </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  statusBar: {
    position: "absolute",
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  statusTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13 },
  toolbar: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  toolBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  finishBtn: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  finishTxt: { fontFamily: "Outfit_700Bold", fontSize: 15 },
  wpDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  wpDotTxt: { color: "#fff", fontFamily: "Outfit_700Bold", fontSize: 12 },
});
