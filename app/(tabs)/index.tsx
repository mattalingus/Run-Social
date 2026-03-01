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
  ScrollView,
} from "react-native";
import { PaceMapView as MapView, PaceMarker as Marker } from "@/components/MapComponents";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import C from "@/constants/colors";

const HOUSTON = { latitude: 29.7604, longitude: -95.3698, latitudeDelta: 0.09, longitudeDelta: 0.09 };
const RUN_TAGS = ["Talkative", "Quiet", "Motivational", "Training", "Ministry", "Recovery"];

interface Run {
  id: string;
  title: string;
  host_name: string;
  host_photo: string;
  host_marker_icon: string | null;
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
  const hasCustomIcon = !!run.host_marker_icon;

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.sequence([
      Animated.spring(scaleAnim, { toValue: 1.35, useNativeDriver: true, tension: 450, friction: 9 }),
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 300, friction: 12 }),
    ]).start();
    onPress();
  }

  return (
    <Marker
      coordinate={{ latitude: run.location_lat, longitude: run.location_lng }}
      onPress={handlePress}
      tracksViewChanges={hasCustomIcon ? false : !imgLoaded}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <Animated.View style={[mStyles.wrap, { transform: [{ scale: scaleAnim }] }]}>
        {upcoming && <View style={mStyles.glowRing} />}
        {hasCustomIcon ? (
          <View style={[mStyles.circle, mStyles.emojiCircle, isSelected && mStyles.circleSelected]}>
            <Text style={mStyles.emoji}>{run.host_marker_icon}</Text>
          </View>
        ) : (
          <View style={[mStyles.circle, isSelected && mStyles.circleSelected]}>
            <Image
              source={{ uri: run.host_photo || avatarUri(run.host_name) }}
              style={mStyles.img}
              onLoad={() => setImgLoaded(true)}
            />
          </View>
        )}
        <View style={mStyles.callout}>
          <View style={[styles.calloutDot, isSelected && styles.calloutDotSelected]} />
        </View>
      </Animated.View>
    </Marker>
  );
}

const mStyles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", width: 60, height: 68 },
  glowRing: {
    position: "absolute",
    top: 0,
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderColor: C.primary,
    opacity: 0.55,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
  },
  circle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 3,
    borderColor: C.primary,
    overflow: "hidden",
    backgroundColor: C.card,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.55,
    shadowRadius: 6,
    elevation: 8,
  },
  emojiCircle: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.surface,
  },
  circleSelected: {
    borderColor: "#FFFFFF",
    borderWidth: 3,
    shadowColor: C.primary,
    shadowOpacity: 0.9,
    shadowRadius: 12,
  },
  img: { width: "100%", height: "100%" },
  emoji: { fontSize: 26 },
  callout: { marginTop: -2 },
});

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const mapRef = useRef<any>(null);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locatedOnce, setLocatedOnce] = useState(false);
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
        const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setLocation(coords);
      }
    })();
  }, []);

  useEffect(() => {
    if (location && !locatedOnce && mapRef.current) {
      setLocatedOnce(true);
      mapRef.current.animateToRegion(
        { ...location, latitudeDelta: 0.09, longitudeDelta: 0.09 },
        1200
      );
    }
  }, [location, locatedOnce]);

  function locateMe() {
    if (!location) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    mapRef.current?.animateToRegion(
      { ...location, latitudeDelta: 0.06, longitudeDelta: 0.06 },
      800
    );
  }

  function openRun(run: Run) {
    setSelectedRun(run);
    cardOpacity.setValue(0);
    slideAnim.setValue(300);
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 200 }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }

  function closeRun() {
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 300, useNativeDriver: true, damping: 22 }),
      Animated.timing(cardOpacity, { toValue: 0, duration: 140, useNativeDriver: true }),
    ]).start(() => setSelectedRun(null));
  }

  const filteredRuns = filters.tag ? runs.filter((r) => r.tags?.includes(filters.tag!)) : runs;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={HOUSTON}
        showsUserLocation={!!location}
        showsMyLocationButton={false}
        showsCompass={false}
        showsScale={false}
        mapType="standard"
        userInterfaceStyle="dark"
        onPress={() => { if (selectedRun) closeRun(); }}
        rotateEnabled={true}
        pitchEnabled={false}
        zoomEnabled={true}
        scrollEnabled={true}
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
        <Text style={styles.appName}>PaceUp</Text>
        <View style={styles.topRight}>
          {isLoading && <ActivityIndicator size="small" color={C.primary} style={{ marginRight: 8 }} />}
          <Pressable style={styles.iconBtn} onPress={() => setShowFilters(true)}>
            <Feather name="sliders" size={18} color={C.text} />
            {filters.tag && <View style={styles.filterDot} />}
          </Pressable>
        </View>
      </View>

      <View style={[styles.rightButtons, { top: insets.top + 72 }]}>
        {location && (
          <Pressable style={styles.mapBtn} onPress={locateMe}>
            <Feather name="navigation" size={18} color={C.primary} />
          </Pressable>
        )}
        {user?.host_unlocked && (
          <Pressable
            style={[styles.mapBtn, styles.mapBtnPrimary]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push("/create-run/index");
            }}
          >
            <Feather name="plus" size={20} color={C.bg} />
          </Pressable>
        )}
      </View>

      {selectedRun && (
        <Animated.View
          style={[
            styles.runCard,
            { bottom: insets.bottom + 16, opacity: cardOpacity, transform: [{ translateY: slideAnim }] },
          ]}
        >
          <View style={styles.cardHostRow}>
            {selectedRun.host_marker_icon ? (
              <View style={styles.cardIconBubble}>
                <Text style={styles.cardIconEmoji}>{selectedRun.host_marker_icon}</Text>
              </View>
            ) : (
              <Image
                source={{ uri: selectedRun.host_photo || avatarUri(selectedRun.host_name) }}
                style={styles.cardHostImg}
              />
            )}
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

          <View style={styles.cardChips}>
            <View style={styles.chip}>
              <Feather name="clock" size={11} color={C.primary} />
              <Text style={styles.chipText}>{formatDate(selectedRun.date)} · {formatTime(selectedRun.date)}</Text>
            </View>
            <View style={styles.chip}>
              <Feather name="activity" size={11} color={C.orange} />
              <Text style={[styles.chipText, { color: C.orange }]}>
                {formatPace(selectedRun.min_pace)}–{formatPace(selectedRun.max_pace)} /mi
              </Text>
            </View>
            <View style={styles.chip}>
              <Feather name="map" size={11} color={C.blue} />
              <Text style={[styles.chipText, { color: C.blue }]}>
                {selectedRun.min_distance.toFixed(1)}–{selectedRun.max_distance.toFixed(1)} mi
              </Text>
            </View>
            <View style={styles.chip}>
              <Feather name="users" size={11} color={C.textSecondary} />
              <Text style={styles.chipText}>{selectedRun.participant_count}/{selectedRun.max_participants}</Text>
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
            <Text style={styles.joinBtnText}>View & Join Run</Text>
            <Feather name="arrow-right" size={16} color={C.bg} />
          </Pressable>
        </Animated.View>
      )}

      <Modal visible={showFilters} transparent animationType="slide" onRequestClose={() => setShowFilters(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowFilters(false)} />
        <View style={[styles.filterSheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.filterHeader}>
            <Text style={styles.filterTitle}>Filter Runs</Text>
            <Pressable onPress={() => setShowFilters(false)}>
              <Feather name="x" size={20} color={C.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.filterLabel}>Run Style</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
            <View style={styles.filterTagRow}>
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
          </ScrollView>
          <View style={styles.filterStats}>
            <Text style={styles.filterStatText}>
              {filteredRuns.length} {filteredRuns.length === 1 ? "run" : "runs"} near Houston
            </Text>
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
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  appName: { fontFamily: "Outfit_700Bold", fontSize: 22, color: C.text },
  topRight: { flexDirection: "row", alignItems: "center" },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.surface + "F0",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.border,
  },
  filterDot: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.primary,
  },
  rightButtons: {
    position: "absolute",
    right: 16,
    gap: 10,
  },
  mapBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.surface + "F0",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  mapBtnPrimary: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  calloutDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.primary,
    borderWidth: 2,
    borderColor: "#fff",
    marginTop: 2,
  },
  calloutDotSelected: {
    backgroundColor: "#fff",
    borderColor: C.primary,
  },
  runCard: {
    position: "absolute",
    left: 16,
    right: 16,
    backgroundColor: C.surface,
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 28,
    elevation: 24,
  },
  cardHostRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  cardHostImg: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.card },
  cardIconBubble: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: C.border,
  },
  cardIconEmoji: { fontSize: 26 },
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
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: C.border,
  },
  chipTag: { borderColor: C.primary + "44", backgroundColor: C.primaryMuted },
  chipText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.text },
  joinBtn: {
    backgroundColor: C.primary,
    borderRadius: 14,
    height: 50,
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
  filterHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  filterTitle: { fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text },
  filterLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary, marginBottom: 10 },
  filterTagRow: { flexDirection: "row", gap: 8, paddingBottom: 4 },
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
  filterStats: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border },
  filterStatText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textMuted, textAlign: "center" },
});
