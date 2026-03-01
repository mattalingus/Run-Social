import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Animated,
  Modal,
  ScrollView,
} from "react-native";
import { PaceMapView as MapView, PaceMarker as Marker } from "@/components/MapComponents";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import C from "@/constants/colors";

const RUN_TAGS = ["Talkative", "Quiet", "Motivational", "Training", "Ministry", "Recovery"];

interface Run {
  id: string;
  title: string;
  host_name: string;
  host_rating: number;
  date: string;
  location_lat: number;
  location_lng: number;
  location_name: string;
  min_distance: number;
  max_distance: number;
  min_pace: number;
  max_pace: number;
  tags: string[];
  participant_count: number;
  max_participants: number;
  privacy: string;
}

function formatPace(pace: number) {
  const mins = Math.floor(pace);
  const secs = Math.round((pace - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<{ tag?: string }>({});
  const slideAnim = useRef(new Animated.Value(300)).current;

  const { data: runs = [], isLoading } = useQuery<Run[]>({
    queryKey: ["/api/runs"],
  });

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({});
        setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      }
    })();
  }, []);

  function openRun(run: Run) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedRun(run);
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, damping: 20 }).start();
  }

  function closeRun() {
    Animated.spring(slideAnim, { toValue: 300, useNativeDriver: true }).start(() => setSelectedRun(null));
  }

  const filteredRuns = filters.tag ? runs.filter((r) => r.tags?.includes(filters.tag!)) : runs;

  const mapRegion = location
    ? { latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.08, longitudeDelta: 0.08 }
    : { latitude: 37.7749, longitude: -122.4194, latitudeDelta: 0.08, longitudeDelta: 0.08 };

  return (
    <View style={styles.container}>
      <MapView
        style={StyleSheet.absoluteFill}
        region={mapRegion}
        showsUserLocation={!!location}
        mapType="standard"
        userInterfaceStyle="dark"
      >
        {filteredRuns.map((run) => (
          <Marker
            key={run.id}
            coordinate={{ latitude: run.location_lat, longitude: run.location_lng }}
            onPress={() => openRun(run)}
          >
            <View style={styles.markerWrap}>
              <View style={styles.marker}>
                <Ionicons name="walk" size={14} color={C.bg} />
              </View>
              <View style={styles.markerDot} />
            </View>
          </Marker>
        ))}
      </MapView>

      <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
        <View style={styles.topLeft}>
          <Text style={styles.appName}>PaceUp</Text>
          {isLoading && <ActivityIndicator size="small" color={C.primary} style={{ marginLeft: 8 }} />}
        </View>
        <Pressable style={styles.filterBtn} onPress={() => setShowFilters(true)}>
          <Feather name="sliders" size={18} color={C.text} />
          {filters.tag && <View style={styles.filterDot} />}
        </Pressable>
      </View>

      {user?.host_unlocked && (
        <Pressable
          style={[styles.fab, { bottom: insets.bottom + 100 }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push("/create-run/index"); }}
        >
          <Feather name="plus" size={24} color={C.bg} />
        </Pressable>
      )}

      {selectedRun && (
        <Animated.View style={[styles.runCard, { bottom: insets.bottom + 20, transform: [{ translateY: slideAnim }] }]}>
          <Pressable onPress={closeRun} style={styles.cardClose}>
            <Feather name="x" size={16} color={C.textSecondary} />
          </Pressable>
          <Text style={styles.cardTitle}>{selectedRun.title}</Text>
          <Text style={styles.cardHost}>by {selectedRun.host_name} {selectedRun.host_rating > 0 ? `· ${selectedRun.host_rating.toFixed(1)}` : ""}</Text>
          <View style={styles.cardMeta}>
            <View style={styles.cardMetaItem}>
              <Feather name="calendar" size={13} color={C.primary} />
              <Text style={styles.cardMetaText}>{formatDate(selectedRun.date)} at {formatTime(selectedRun.date)}</Text>
            </View>
            <View style={styles.cardMetaItem}>
              <Feather name="map-pin" size={13} color={C.primary} />
              <Text style={styles.cardMetaText}>{selectedRun.location_name}</Text>
            </View>
          </View>
          <View style={styles.cardStats}>
            <View style={styles.statChip}>
              <Text style={styles.statVal}>{selectedRun.min_distance}–{selectedRun.max_distance} mi</Text>
            </View>
            <View style={styles.statChip}>
              <Text style={styles.statVal}>{formatPace(selectedRun.min_pace)}–{formatPace(selectedRun.max_pace)} /mi</Text>
            </View>
            <View style={styles.statChip}>
              <Ionicons name="people" size={12} color={C.textSecondary} />
              <Text style={styles.statVal}>{selectedRun.participant_count}/{selectedRun.max_participants}</Text>
            </View>
          </View>
          {selectedRun.tags?.length > 0 && (
            <View style={styles.tags}>
              {selectedRun.tags.map((t) => (
                <View key={t} style={styles.tag}>
                  <Text style={styles.tagText}>{t}</Text>
                </View>
              ))}
            </View>
          )}
          <Pressable
            style={({ pressed }) => [styles.viewBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => { closeRun(); router.push(`/run/${selectedRun.id}`); }}
          >
            <Text style={styles.viewBtnText}>View Details</Text>
            <Feather name="arrow-right" size={16} color={C.bg} />
          </Pressable>
        </Animated.View>
      )}

      <Modal visible={showFilters} transparent animationType="slide" onRequestClose={() => setShowFilters(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowFilters(false)} />
        <View style={[styles.filterSheet, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={styles.filterTitle}>Filter Runs</Text>
          <Text style={styles.filterLabel}>Run Style</Text>
          <View style={styles.filterTags}>
            <Pressable
              style={[styles.filterTag, !filters.tag && styles.filterTagActive]}
              onPress={() => { setFilters({}); setShowFilters(false); }}
            >
              <Text style={[styles.filterTagText, !filters.tag && styles.filterTagTextActive]}>All</Text>
            </Pressable>
            {RUN_TAGS.map((t) => (
              <Pressable
                key={t}
                style={[styles.filterTag, filters.tag === t && styles.filterTagActive]}
                onPress={() => { setFilters({ tag: t }); setShowFilters(false); }}
              >
                <Text style={[styles.filterTagText, filters.tag === t && styles.filterTagTextActive]}>{t}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  topLeft: { flexDirection: "row", alignItems: "center" },
  appName: { fontFamily: "Outfit_700Bold", fontSize: 22, color: C.text },
  filterBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.surface + "EE",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  filterDot: { position: "absolute", top: 8, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
  markerWrap: { alignItems: "center" },
  marker: {
    backgroundColor: C.primary,
    borderRadius: 20,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: C.bg,
  },
  markerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.primary, marginTop: 2 },
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  runCard: {
    position: "absolute",
    left: 16,
    right: 16,
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 20,
  },
  cardClose: { position: "absolute", top: 16, right: 16, padding: 4 },
  cardTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text, marginBottom: 4, paddingRight: 24 },
  cardHost: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary, marginBottom: 12 },
  cardMeta: { gap: 6, marginBottom: 12 },
  cardMetaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardMetaText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.text },
  cardStats: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 10 },
  statChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.card,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: C.border,
  },
  statVal: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.textSecondary },
  tags: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 12 },
  tag: { backgroundColor: C.primaryMuted, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: C.primary + "33" },
  tagText: { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: C.primary },
  viewBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  viewBtnText: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.bg },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  filterSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: C.border,
  },
  filterTitle: { fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text, marginBottom: 20 },
  filterLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary, marginBottom: 10 },
  filterTags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterTag: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  filterTagActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  filterTagText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  filterTagTextActive: { color: C.primary },
});
