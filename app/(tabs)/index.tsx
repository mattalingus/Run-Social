import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Animated,
  Modal,
  Image,
} from "react-native";
import { PaceMapView as MapView, PaceMarker as Marker } from "@/components/MapComponents";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import C from "@/constants/colors";

const HOUSTON = { latitude: 29.7604, longitude: -95.3698, latitudeDelta: 0.09, longitudeDelta: 0.09 };
const RUN_TAGS = ["Talkative", "Quiet", "Motivational", "Training", "Ministry", "Recovery"];

interface Run {
  id: string;
  title: string;
  host_name: string;
  host_photo: string;
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

function isWithin24Hours(dateStr: string) {
  const ms = new Date(dateStr).getTime() - Date.now();
  return ms > 0 && ms < 24 * 60 * 60 * 1000;
}

function avatarUri(name: string) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1A2E21&color=00D97E&size=200`;
}

interface MarkerProps {
  run: Run;
  isSelected: boolean;
  onPress: () => void;
}

function CustomMarker({ run, isSelected, onPress }: MarkerProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const [imgLoaded, setImgLoaded] = useState(false);
  const upcoming = isWithin24Hours(run.date);
  const imgUri = run.host_photo || avatarUri(run.host_name);

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.sequence([
      Animated.spring(scaleAnim, { toValue: 1.3, useNativeDriver: true, tension: 400, friction: 10 }),
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 300, friction: 12 }),
    ]).start();
    onPress();
  }

  return (
    <Marker
      coordinate={{ latitude: run.location_lat, longitude: run.location_lng }}
      onPress={handlePress}
      tracksViewChanges={!imgLoaded}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <Animated.View style={[mStyles.wrap, { transform: [{ scale: scaleAnim }] }]}>
        {upcoming && <View style={mStyles.glowRing} />}
        <View style={[mStyles.circle, isSelected && mStyles.circleSelected]}>
          <Image
            source={{ uri: imgUri }}
            style={mStyles.img}
            onLoad={() => setImgLoaded(true)}
          />
        </View>
      </Animated.View>
    </Marker>
  );
}

const mStyles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", width: 56, height: 56 },
  glowRing: {
    position: "absolute",
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: C.primary,
    opacity: 0.5,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },
  circle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: C.primary,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 6,
    backgroundColor: C.card,
  },
  circleSelected: {
    borderColor: "#fff",
    shadowColor: C.primary,
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  img: { width: "100%", height: "100%" },
});

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<{ tag?: string }>({});
  const slideAnim = useRef(new Animated.Value(300)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;

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
    setSelectedRun(run);
    cardOpacity.setValue(0);
    slideAnim.setValue(300);
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 180 }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }

  function closeRun() {
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 300, useNativeDriver: true, damping: 20 }),
      Animated.timing(cardOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
    ]).start(() => setSelectedRun(null));
  }

  const filteredRuns = filters.tag ? runs.filter((r) => r.tags?.includes(filters.tag!)) : runs;

  const mapRegion = location
    ? { latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.09, longitudeDelta: 0.09 }
    : HOUSTON;

  return (
    <View style={styles.container}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={HOUSTON}
        region={mapRegion}
        showsUserLocation={!!location}
        mapType="standard"
        userInterfaceStyle="dark"
        onPress={() => { if (selectedRun) closeRun(); }}
      >
        {filteredRuns.map((run) => (
          <CustomMarker
            key={run.id}
            run={run}
            isSelected={selectedRun?.id === run.id}
            onPress={() => openRun(run)}
          />
        ))}
      </MapView>

      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
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
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push("/create-run/index");
          }}
        >
          <Feather name="plus" size={24} color={C.bg} />
        </Pressable>
      )}

      {selectedRun && (
        <Animated.View
          style={[
            styles.runCard,
            { bottom: insets.bottom + 16, opacity: cardOpacity, transform: [{ translateY: slideAnim }] },
          ]}
        >
          <View style={styles.cardHeader}>
            <View style={styles.cardHostRow}>
              <Image
                source={{ uri: selectedRun.host_photo || avatarUri(selectedRun.host_name) }}
                style={styles.cardHostImg}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>{selectedRun.title}</Text>
                <Text style={styles.cardHost}>
                  {selectedRun.host_name}
                  {selectedRun.host_rating > 0 ? `  ★ ${selectedRun.host_rating.toFixed(1)}` : ""}
                </Text>
              </View>
              <Pressable onPress={closeRun} style={styles.cardClose} hitSlop={12}>
                <Feather name="x" size={18} color={C.textSecondary} />
              </Pressable>
            </View>
          </View>

          <View style={styles.cardChips}>
            <View style={styles.chip}>
              <Feather name="clock" size={12} color={C.primary} />
              <Text style={styles.chipText}>{formatDate(selectedRun.date)} · {formatTime(selectedRun.date)}</Text>
            </View>
            <View style={styles.chip}>
              <Feather name="activity" size={12} color={C.orange} />
              <Text style={[styles.chipText, { color: C.orange }]}>
                {formatPace(selectedRun.min_pace)}–{formatPace(selectedRun.max_pace)} /mi
              </Text>
            </View>
            <View style={styles.chip}>
              <Feather name="map" size={12} color={C.blue} />
              <Text style={[styles.chipText, { color: C.blue }]}>
                {selectedRun.min_distance.toFixed(1)}–{selectedRun.max_distance.toFixed(1)} mi
              </Text>
            </View>
            {selectedRun.tags?.[0] && (
              <View style={[styles.chip, styles.chipTag]}>
                <Text style={[styles.chipText, { color: C.primary }]}>{selectedRun.tags[0]}</Text>
              </View>
            )}
          </View>

          <Pressable
            style={({ pressed }) => [styles.joinBtn, { opacity: pressed ? 0.85 : 1 }]}
            onPress={() => { closeRun(); router.push(`/run/${selectedRun.id}`); }}
          >
            <Text style={styles.joinBtnText}>Join Run</Text>
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
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 20,
  },
  cardHeader: { marginBottom: 12 },
  cardHostRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardHostImg: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.card },
  cardTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text, flex: 1 },
  cardHost: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary, marginTop: 2 },
  cardClose: { padding: 4 },
  cardChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 14 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.card,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: C.border,
  },
  chipTag: { borderColor: C.primary + "44", backgroundColor: C.primaryMuted },
  chipText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.text },
  joinBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  joinBtnText: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.bg },
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
