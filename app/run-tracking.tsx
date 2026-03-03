import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  TextInput,
  ScrollView,
  Image,
} from "react-native";
import ShareActivityModal from "@/components/ShareActivityModal";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { useActivity } from "@/contexts/ActivityContext";
import C from "@/constants/colors";
import { formatDistance } from "@/lib/formatDistance";

const IS_NATIVE = Platform.OS !== "web";

// Lazy-load react-native-maps only on native to avoid web crashes
let MapView: any = null;
let Marker: any = null;
let Polyline: any = null;
if (IS_NATIVE) {
  const maps = require("react-native-maps");
  MapView = maps.default;
  Marker = maps.Marker;
  Polyline = maps.Polyline;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "idle" | "active" | "paused" | "done";
type Coord = { latitude: number; longitude: number };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatElapsed(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

function calcPace(distanceMi: number, elapsedSec: number): string {
  if (distanceMi < 0.01 || elapsedSec < 1) return "--:--";
  const min = elapsedSec / 60 / distanceMi;
  const m = Math.floor(min);
  const s = Math.round((min - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function RunTrackingScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { activityFilter } = useActivity();

  const [permission, requestPermission] = Location.useForegroundPermissions();
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [displayDist, setDisplayDist] = useState(0);
  const [saving, setSaving] = useState(false);
  const [routeState, setRouteState] = useState<Coord[]>([]);

  // Saved paths state
  const [selectedPath, setSelectedPath] = useState<any | null>(null);
  const [showPathPicker, setShowPathPicker] = useState(false);
  const [showSaveNameModal, setShowSaveNameModal] = useState(false);
  const [pathName, setPathName] = useState("");
  const [savingPath, setSavingPath] = useState(false);
  const [pathSaved, setPathSaved] = useState(false);

  // Post-run photo state
  const [savedRunId, setSavedRunId] = useState<string | null>(null);
  const [runPhotos, setRunPhotos] = useState<any[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showShare, setShowShare] = useState(false);

  const { data: savedPaths = [] } = useQuery<any[]>({
    queryKey: ["/api/saved-paths"],
    staleTime: 60_000,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const webWatchIdRef = useRef<number | null>(null);
  const lastCoordRef = useRef<Coord | null>(null);
  const totalDistRef = useRef(0);
  const routePathRef = useRef<Coord[]>([]);
  const mapRef = useRef<any>(null);

  // ─── Timer ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase === "active") {
      intervalRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [phase]);

  // ─── GPS ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase === "active") {
      watchLocation();
    } else {
      stopWatching();
    }
    return () => { stopWatching(); };
  }, [phase]);

  const handleCoord = useCallback((latitude: number, longitude: number) => {
    const coord: Coord = { latitude, longitude };
    routePathRef.current.push(coord);
    setRouteState((prev) => [...prev, coord]);

    if (lastCoordRef.current) {
      const d = haversine(
        lastCoordRef.current.latitude,
        lastCoordRef.current.longitude,
        latitude,
        longitude
      );
      if (d >= 0 && d < 0.3) {
        totalDistRef.current += d;
        setDisplayDist(totalDistRef.current);
      }
    }
    lastCoordRef.current = coord;

    // Pan map to follow runner
    if (mapRef.current) {
      mapRef.current.animateToRegion(
        { latitude, longitude, latitudeDelta: 0.004, longitudeDelta: 0.004 },
        300
      );
    }
  }, []);

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
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: 5,
          timeInterval: 3000,
        },
        (loc) => handleCoord(loc.coords.latitude, loc.coords.longitude)
      );
      locationSubRef.current = sub;
    } catch (_) {}
  }

  function stopWatching() {
    if (Platform.OS === "web") {
      if (webWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(webWatchIdRef.current);
        webWatchIdRef.current = null;
      }
    } else {
      locationSubRef.current?.remove();
      locationSubRef.current = null;
    }
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  async function handleStart() {
    if (Platform.OS !== "web") {
      if (!permission?.granted) {
        const res = await requestPermission();
        if (!res.granted) {
          Alert.alert(
            "Location Required",
            "Enable location access so FARA can measure your run distance."
          );
          return;
        }
      }
    }
    lastCoordRef.current = null;
    totalDistRef.current = 0;
    routePathRef.current = [];
    setRouteState([]);
    setDisplayDist(0);
    setElapsed(0);
    setPathSaved(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPhase("active");
  }

  async function handleSavePath() {
    const name = pathName.trim();
    if (!name) { Alert.alert("Name required", "Enter a name for this path"); return; }
    setSavingPath(true);
    try {
      await apiRequest("POST", "/api/saved-paths", {
        name,
        routePath: routePathRef.current,
        distanceMiles: totalDistRef.current,
      });
      qc.invalidateQueries({ queryKey: ["/api/saved-paths"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPathSaved(true);
      setShowSaveNameModal(false);
      setPathName("");
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to save path");
    } finally {
      setSavingPath(false);
    }
  }

  function handlePause() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPhase("paused");
  }

  function handleResume() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    lastCoordRef.current = null;
    setPhase("active");
  }

  function handleFinish() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setPhase("done");
  }

  function handleCancel() {
    if (phase === "idle") {
      router.back();
      return;
    }
    Alert.alert("Discard Run", "Discard this run and go back?", [
      { text: "Keep Going", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          stopWatching();
          router.back();
        },
      },
    ]);
  }

  async function saveRun() {
    const distance = totalDistRef.current;
    const pace = distance > 0.01 ? (elapsed / 60) / distance : null;
    setSaving(true);
    try {
      const res = await apiRequest("POST", "/api/solo-runs", {
        title: `${formatDistance(distance)} mi solo ${activityFilter === "ride" ? "ride" : "run"}`,
        date: new Date().toISOString(),
        distanceMiles: Math.max(distance, 0.001),
        paceMinPerMile: pace,
        durationSeconds: elapsed,
        completed: true,
        planned: false,
        routePath: routePathRef.current.length > 1 ? routePathRef.current : null,
        activityType: activityFilter,
      });
      const saved = await res.json();
      setSavedRunId(saved.id);
      qc.invalidateQueries({ queryKey: ["/api/solo-runs"] });
      qc.invalidateQueries({ queryKey: ["/api/runs/mine"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Save Failed", e.message);
    } finally {
      setSaving(false);
    }
  }

  function finishAndNavigate() {
    router.replace("/(tabs)/solo" as any);
  }

  async function pickAndUploadSoloPhoto() {
    if (!savedRunId) return;
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
      const url = new URL(`/api/solo-runs/${savedRunId}/photos`, getApiUrl()).toString();
      const response = await fetch(url, { method: "POST", body: formData, credentials: "include" });
      if (!response.ok) throw new Error("Upload failed");
      const photo = await response.json();
      setRunPhotos((prev) => [...prev, photo]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Upload failed", e.message);
    } finally {
      setUploadingPhoto(false);
    }
  }

  // ─── Done summary ─────────────────────────────────────────────────────────

  if (phase === "done") {
    const distance = totalDistRef.current;
    const pace = distance > 0.01 ? (elapsed / 60) / distance : null;
    const paceM = pace ? Math.floor(pace) : 0;
    const paceS = pace ? Math.round((pace - paceM) * 60) : 0;
    const hasRoute = IS_NATIVE && routeState.length > 1;
    const lastPt = routeState[routeState.length - 1];

    return (
      <View style={[t.container, { paddingBottom: insets.bottom + 32 }]}>
        {/* Mini route map */}
        {hasRoute && MapView && (
          <View style={[t.miniMap, { marginTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
            <MapView
              style={StyleSheet.absoluteFillObject}
              initialRegion={{
                latitude: lastPt.latitude,
                longitude: lastPt.longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              }}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              customMapStyle={darkMapStyle}
            >
              <Polyline
                coordinates={routeState}
                strokeColor={C.primary}
                strokeWidth={3}
              />
              {lastPt && (
                <Marker coordinate={lastPt} anchor={{ x: 0.5, y: 0.5 }}>
                  <View style={t.currentDot} />
                </Marker>
              )}
            </MapView>
            <View style={t.miniMapOverlay}>
              <View style={t.miniMapBadge}>
                <Feather name="map-pin" size={11} color={C.primary} />
                <Text style={t.miniMapBadgeTxt}>Your Route</Text>
              </View>
            </View>
          </View>
        )}

        <View style={[t.summaryCard, !hasRoute && { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 48) }]}>
          <View style={t.checkCircle}>
            <Feather name="check" size={28} color={C.primary} />
          </View>
          <Text style={t.summaryTitle}>{activityFilter === "ride" ? "Ride Complete" : "Run Complete"}</Text>

          <View style={t.statsRow}>
            <View style={t.statBlock}>
              <Text style={t.statBig}>{formatDistance(distance)}</Text>
              <Text style={t.statUnit}>miles</Text>
            </View>
            <View style={t.statDivider} />
            <View style={t.statBlock}>
              <Text style={t.statBig}>{formatElapsed(elapsed)}</Text>
              <Text style={t.statUnit}>time</Text>
            </View>
            <View style={t.statDivider} />
            <View style={t.statBlock}>
              <Text style={t.statBig}>
                {pace ? `${paceM}:${paceS.toString().padStart(2, "0")}` : "--"}
              </Text>
              <Text style={t.statUnit}>min/mi</Text>
            </View>
          </View>

          {savedRunId ? (
            <>
              {/* ─── Photo section ─────────────────────────────────────── */}
              <View style={t.photoSection}>
                <Text style={t.photoSectionTitle}>Add a photo</Text>
                {runPhotos.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={t.photoScroll}>
                    {runPhotos.map((p: any) => (
                      <Image key={p.id} source={{ uri: p.photo_url }} style={t.photoThumb} />
                    ))}
                  </ScrollView>
                )}
                <Pressable
                  style={[t.photoAddBtn, uploadingPhoto && { opacity: 0.6 }]}
                  onPress={pickAndUploadSoloPhoto}
                  disabled={uploadingPhoto}
                >
                  {uploadingPhoto ? (
                    <ActivityIndicator color={C.primary} size="small" />
                  ) : (
                    <>
                      <Feather name="camera" size={16} color={C.primary} />
                      <Text style={t.photoAddTxt}>{runPhotos.length > 0 ? "Add another" : "Add photo"}</Text>
                    </>
                  )}
                </Pressable>
              </View>

              {routePathRef.current.length > 1 && (
                pathSaved ? (
                  <View style={t.pathSavedRow}>
                    <Feather name="check-circle" size={15} color={C.primary} />
                    <Text style={t.pathSavedTxt}>Path saved</Text>
                  </View>
                ) : (
                  <Pressable
                    style={t.savePathBtn}
                    onPress={() => {
                      setPathName(`My Route – ${formatDistance(totalDistRef.current)} mi`);
                      setShowSaveNameModal(true);
                    }}
                  >
                    <Feather name="bookmark" size={15} color={C.primary} />
                    <Text style={t.savePathBtnTxt}>Save this path</Text>
                  </Pressable>
                )
              )}

              <Pressable
                style={t.shareBtn}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowShare(true); }}
              >
                <Feather name="share-2" size={16} color={C.primary} />
                <Text style={t.shareBtnTxt}>{activityFilter === "ride" ? "Share Ride" : "Share Run"}</Text>
              </Pressable>

              <Pressable style={t.saveBtn} onPress={finishAndNavigate}>
                <Text style={t.saveBtnTxt}>Done</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                style={[t.saveBtn, saving && { opacity: 0.6 }]}
                onPress={saveRun}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={C.bg} />
                ) : (
                  <Text style={t.saveBtnTxt}>{activityFilter === "ride" ? "Save Ride" : "Save Run"}</Text>
                )}
              </Pressable>

              <Pressable
                style={t.discardBtn}
                onPress={() => { stopWatching(); router.back(); }}
              >
                <Text style={t.discardTxt}>Discard</Text>
              </Pressable>
            </>
          )}
        </View>

        {/* ─── Save path name modal ─────────────────────────────────────────── */}
        {showSaveNameModal && (
          <Modal visible transparent animationType="fade" onRequestClose={() => setShowSaveNameModal(false)}>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
            <Pressable style={t.modalOverlay} onPress={() => setShowSaveNameModal(false)} />
            <View style={[t.nameModal, { paddingBottom: insets.bottom + 24 }]}>
              <View style={t.nameModalHandle} />
              <Text style={t.nameModalTitle}>Name this path</Text>
              <TextInput
                style={t.nameInput}
                value={pathName}
                onChangeText={setPathName}
                placeholder="e.g. Riverside Loop"
                placeholderTextColor={C.textMuted}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleSavePath}
              />
              <Pressable
                style={[t.nameModalSaveBtn, savingPath && { opacity: 0.6 }]}
                onPress={handleSavePath}
                disabled={savingPath}
              >
                {savingPath
                  ? <ActivityIndicator color={C.bg} />
                  : <Text style={t.nameModalSaveTxt}>Save Path</Text>}
              </Pressable>
              <Pressable style={t.nameModalCancelBtn} onPress={() => setShowSaveNameModal(false)}>
                <Text style={t.nameModalCancelTxt}>Cancel</Text>
              </Pressable>
            </View>
            </KeyboardAvoidingView>
          </Modal>
        )}

        {/* ─── Share activity modal ─────────────────────────────────────────── */}
        <ShareActivityModal
          visible={showShare}
          onClose={() => setShowShare(false)}
          runData={{
            distanceMi: totalDistRef.current,
            paceMinPerMile: pace,
            durationSeconds: elapsed,
            routePath: routePathRef.current,
            activityType: activityFilter,
          }}
        />
      </View>
    );
  }

  // ─── Tracker UI ──────────────────────────────────────────────────────────

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const showMap = IS_NATIVE && MapView && (phase === "active" || phase === "paused") && routeState.length > 0;
  const currentPt = routeState[routeState.length - 1];

  return (
    <View style={t.container}>
      {/* Cancel */}
      <Pressable
        style={[t.cancelBtn, { top: (showMap ? insets.top : topPad) + 16, zIndex: 20 }]}
        onPress={handleCancel}
      >
        <Feather name="x" size={20} color={C.textSecondary} />
      </Pressable>

      {/* Live map — shown when running or paused */}
      {showMap && (
        <View style={t.mapContainer}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFillObject}
            initialRegion={{
              latitude: currentPt.latitude,
              longitude: currentPt.longitude,
              latitudeDelta: 0.004,
              longitudeDelta: 0.004,
            }}
            customMapStyle={darkMapStyle}
            showsUserLocation={false}
            showsCompass={false}
            toolbarEnabled={false}
          >
            {selectedPath?.route_path?.length > 1 && (
              <Polyline
                coordinates={selectedPath.route_path}
                strokeColor="#ffffff"
                strokeWidth={2}
                lineDashPattern={[8, 6]}
                strokeOpacity={0.28}
              />
            )}
            {routeState.length > 1 && (
              <Polyline
                coordinates={routeState}
                strokeColor={C.primary}
                strokeWidth={3}
              />
            )}
            {currentPt && (
              <Marker coordinate={currentPt} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={t.currentDot} />
              </Marker>
            )}
          </MapView>

          {/* Paused overlay badge */}
          {phase === "paused" && (
            <View style={t.pausedBadge}>
              <Ionicons name="pause" size={12} color={C.text} />
              <Text style={t.pausedBadgeTxt}>Paused</Text>
            </View>
          )}
        </View>
      )}

      {/* Stats + controls */}
      <View style={[
        t.body,
        showMap ? t.bodyWithMap : { paddingTop: topPad + 60 },
      ]}>
        {!showMap && (
          <View style={t.statusChip}>
            <View style={[
              t.statusDot,
              {
                backgroundColor:
                  phase === "active" ? C.primary :
                  phase === "paused" ? C.orange : C.textMuted,
              },
            ]} />
            <Text style={t.statusTxt}>
              {phase === "idle" ? "Ready" : phase === "active" ? (activityFilter === "ride" ? "Riding" : "Running") : "Paused"}
            </Text>
          </View>
        )}

        {/* Timer */}
        <Text style={[t.timerTxt, showMap && t.timerTxtCompact]}>
          {formatElapsed(elapsed)}
        </Text>

        {/* Live stats */}
        <View style={t.liveRow}>
          <View style={t.liveStat}>
            <Text style={t.liveVal}>{formatDistance(displayDist)}</Text>
            <Text style={t.liveUnit}>miles</Text>
          </View>
          <View style={t.liveDivider} />
          <View style={t.liveStat}>
            <Text style={t.liveVal}>{calcPace(displayDist, elapsed)}</Text>
            <Text style={t.liveUnit}>min/mi</Text>
          </View>
        </View>

        {/* Controls */}
        <View style={t.controls}>
          {phase === "idle" && (
            <Pressable
              style={({ pressed }) => [t.startBtn, { opacity: pressed ? 0.85 : 1 }]}
              onPress={handleStart}
            >
              <Ionicons name="play" size={26} color={C.bg} />
              <Text style={t.startBtnTxt}>{activityFilter === "ride" ? "Start Ride" : "Start Run"}</Text>
            </Pressable>
          )}

          {(phase === "active" || phase === "paused") && (
            <View style={t.runControls}>
              <Pressable
                style={t.secondaryCtrl}
                onPress={phase === "active" ? handlePause : handleResume}
              >
                <Ionicons
                  name={phase === "active" ? "pause" : "play"}
                  size={22}
                  color={C.text}
                />
                <Text style={t.secondaryCtrlTxt}>
                  {phase === "active" ? "Pause" : "Resume"}
                </Text>
              </Pressable>

              <Pressable style={t.finishBtn} onPress={handleFinish}>
                <Ionicons name="stop" size={22} color={C.bg} />
                <Text style={t.finishBtnTxt}>Finish</Text>
              </Pressable>
            </View>
          )}
        </View>

        {phase === "idle" && (
          <View style={{ alignItems: "center", gap: 10 }}>
            <Text style={t.hintTxt}>GPS will track your distance automatically</Text>
            {selectedPath ? (
              <Pressable
                style={t.ghostPathChip}
                onPress={() => setSelectedPath(null)}
              >
                <Feather name="map" size={13} color={C.primary} />
                <Text style={t.ghostPathChipTxt} numberOfLines={1}>{selectedPath.name}</Text>
                <Feather name="x" size={13} color={C.textMuted} />
              </Pressable>
            ) : (
              <Pressable onPress={() => setShowPathPicker(true)}>
                <Text style={t.followPathLink}>+ Follow a saved path</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      {/* ─── Path picker modal ────────────────────────────────────────────── */}
      {showPathPicker && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setShowPathPicker(false)}>
          <Pressable style={t.modalOverlay} onPress={() => setShowPathPicker(false)} />
          <View style={[t.pickerSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={t.nameModalHandle} />
            <Text style={t.nameModalTitle}>Follow a saved path</Text>
            {savedPaths.length === 0 ? (
              <Text style={t.pickerEmpty}>No saved paths yet. Complete a run and save its path first.</Text>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {savedPaths.map((p: any) => (
                  <Pressable
                    key={p.id}
                    style={t.pickerRow}
                    onPress={() => {
                      setSelectedPath(p);
                      setShowPathPicker(false);
                    }}
                  >
                    <Feather name="map" size={16} color={C.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={t.pickerRowName}>{p.name}</Text>
                      {p.distance_miles != null && (
                        <Text style={t.pickerRowMeta}>{formatDistance(p.distance_miles)} mi</Text>
                      )}
                    </View>
                    <Feather name="chevron-right" size={16} color={C.textMuted} />
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </Modal>
      )}
    </View>
  );
}

// ─── Dark map style ────────────────────────────────────────────────────────────

const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#0d1f18" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#4a7a60" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0d1f18" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1a3328" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0d1f18" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#071510" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

// ─── Styles ───────────────────────────────────────────────────────────────────

const t = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  mapContainer: {
    height: "55%",
    width: "100%",
    overflow: "hidden",
  },

  pausedBadge: {
    position: "absolute",
    bottom: 12,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.surface + "EE",
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  pausedBadgeTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: C.textSecondary,
  },

  cancelBtn: {
    position: "absolute",
    left: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },

  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 28,
  },
  bodyWithMap: {
    paddingTop: 20,
    gap: 20,
  },

  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.textSecondary,
    letterSpacing: 0.5,
  },

  timerTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 64,
    color: C.text,
    letterSpacing: -2,
    lineHeight: 72,
  },
  timerTxtCompact: {
    fontSize: 48,
    lineHeight: 54,
  },

  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 20,
    paddingHorizontal: 32,
    gap: 0,
    alignSelf: "stretch",
  },
  liveStat: { flex: 1, alignItems: "center", gap: 4 },
  liveVal: { fontFamily: "Outfit_700Bold", fontSize: 28, color: C.text },
  liveUnit: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  liveDivider: { width: 1, height: 40, backgroundColor: C.border },

  controls: { alignItems: "center" },

  startBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.primary,
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 48,
  },
  startBtnTxt: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.bg },

  runControls: {
    flexDirection: "row",
    gap: 16,
    alignItems: "center",
  },
  secondaryCtrl: {
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    width: 88,
    paddingVertical: 16,
  },
  secondaryCtrlTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: C.textSecondary,
  },
  finishBtn: {
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.primaryDark,
    borderRadius: 18,
    width: 88,
    paddingVertical: 16,
  },
  finishBtnTxt: { fontFamily: "Outfit_700Bold", fontSize: 12, color: C.bg },

  hintTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.textMuted,
    textAlign: "center",
  },

  // ─── Current position dot ─────────────────────────────────────────────────
  currentDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: C.primary,
    borderWidth: 2.5,
    borderColor: "#fff",
  },

  // ─── Done screen ──────────────────────────────────────────────────────────
  miniMap: {
    height: 220,
    marginHorizontal: 20,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
  },
  miniMapOverlay: {
    position: "absolute",
    bottom: 10,
    left: 10,
  },
  miniMapBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.surface + "DD",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  miniMapBadgeTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: C.textSecondary,
  },

  summaryCard: {
    flex: 1,
    marginHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.primaryMuted,
    borderWidth: 2,
    borderColor: C.primary + "66",
    alignItems: "center",
    justifyContent: "center",
  },
  summaryTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 28,
    color: C.text,
    letterSpacing: -0.5,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 22,
    paddingHorizontal: 24,
    alignSelf: "stretch",
    marginHorizontal: 4,
  },
  statBlock: { flex: 1, alignItems: "center", gap: 4 },
  statBig: { fontFamily: "Outfit_700Bold", fontSize: 26, color: C.text },
  statUnit: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textSecondary },
  statDivider: { width: 1, height: 36, backgroundColor: C.border },

  saveBtn: {
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    marginHorizontal: 4,
  },
  saveBtnTxt: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.bg },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 16,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: C.primary + "88",
    alignSelf: "stretch",
    marginHorizontal: 4,
    backgroundColor: C.primary + "11",
  },
  shareBtnTxt: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.primary },

  discardBtn: { paddingVertical: 10 },
  discardTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textMuted,
  },

  // ─── Post-run photos ────────────────────────────────────────────────────
  photoSection: {
    alignSelf: "stretch",
    gap: 10,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    backgroundColor: C.surface,
  },
  photoSectionTitle: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.textSecondary,
  },
  photoScroll: { marginBottom: 4 },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: 10,
    marginRight: 8,
    backgroundColor: C.card,
  },
  photoAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: C.primary + "55",
    borderRadius: 12,
    paddingVertical: 10,
    backgroundColor: C.primaryMuted,
  },
  photoAddTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.primary,
  },

  // ─── Save path button ───────────────────────────────────────────────────
  savePathBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: C.primary + "66",
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignSelf: "stretch",
    marginHorizontal: 4,
    backgroundColor: C.primaryMuted,
  },
  savePathBtnTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    color: C.primary,
    flex: 1,
    textAlign: "center",
  },
  pathSavedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 10,
  },
  pathSavedTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.primary,
  },

  // ─── Follow a saved path (idle) ────────────────────────────────────────
  followPathLink: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.primary,
    textDecorationLine: "underline",
  },
  ghostPathChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.primaryMuted,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: C.primary + "44",
    maxWidth: 220,
  },
  ghostPathChipTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.primary,
    flex: 1,
  },

  // ─── Modals ─────────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  nameModal: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: C.border,
  },
  nameModalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: "center",
    marginBottom: 18,
  },
  nameModalTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 20,
    color: C.text,
    marginBottom: 16,
  },
  nameInput: {
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: C.text,
    marginBottom: 16,
  },
  nameModalSaveBtn: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
    marginBottom: 10,
  },
  nameModalSaveTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: C.bg,
  },
  nameModalCancelBtn: {
    paddingVertical: 10,
    alignItems: "center",
    marginBottom: 4,
  },
  nameModalCancelTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textMuted,
  },

  pickerSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: C.border,
    maxHeight: "60%",
  },
  pickerEmpty: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textSecondary,
    textAlign: "center",
    paddingVertical: 24,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border + "88",
  },
  pickerRowName: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    color: C.text,
  },
  pickerRowMeta: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
});
