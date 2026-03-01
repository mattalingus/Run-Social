import React, { useState, useRef, useEffect, useMemo } from "react";
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
  Platform,
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
import RangeSlider from "@/components/RangeSlider";

const HOUSTON = { latitude: 29.7604, longitude: -95.3698, latitudeDelta: 0.09, longitudeDelta: 0.09 };
const RUN_STYLES = ["Talkative", "Quiet", "Motivational", "Training", "Ministry", "Recovery"];

const DEFAULT_FILTERS = {
  paceMin: 6.0,
  paceMax: 12.0,
  distMin: 1,
  distMax: 20,
  styles: [] as string[],
};

interface Bounds {
  swLat: number; swLng: number; neLat: number; neLng: number;
}

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
  emojiCircle: { alignItems: "center", justifyContent: "center", backgroundColor: C.surface },
  circleSelected: { borderColor: "#FFFFFF", borderWidth: 3, shadowColor: C.primary, shadowOpacity: 0.9, shadowRadius: 12 },
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
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const boundsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showFilter, setShowFilter] = useState(false);
  const [unit, setUnit] = useState<"mi" | "km">("mi");

  const [draft, setDraft] = useState({ ...DEFAULT_FILTERS });
  const [applied, setApplied] = useState({ ...DEFAULT_FILTERS });

  const slideAnim = useRef(new Animated.Value(300)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;

  const isFiltered =
    applied.paceMin !== DEFAULT_FILTERS.paceMin ||
    applied.paceMax !== DEFAULT_FILTERS.paceMax ||
    applied.distMin !== DEFAULT_FILTERS.distMin ||
    applied.distMax !== DEFAULT_FILTERS.distMax ||
    applied.styles.length > 0;

  const queryUrl = useMemo(() => {
    const p = new URLSearchParams();
    p.set("paceMin", applied.paceMin.toString());
    p.set("paceMax", applied.paceMax.toString());
    p.set("distMin", applied.distMin.toString());
    p.set("distMax", applied.distMax.toString());
    if (applied.styles.length > 0) p.set("styles", applied.styles.join(","));
    if (bounds) {
      p.set("swLat", bounds.swLat.toString());
      p.set("swLng", bounds.swLng.toString());
      p.set("neLat", bounds.neLat.toString());
      p.set("neLng", bounds.neLng.toString());
    }
    return `/api/runs?${p.toString()}`;
  }, [applied, bounds]);

  const { data: runs = [], isFetching } = useQuery<Run[]>({
    queryKey: [queryUrl],
    staleTime: 30_000,
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

  useEffect(() => {
    if (location && !locatedOnce && mapRef.current) {
      setLocatedOnce(true);
      mapRef.current.animateToRegion(
        { ...location, latitudeDelta: 0.065, longitudeDelta: 0.065 },
        1200
      );
    }
  }, [location, locatedOnce]);

  function handleRegionChangeComplete(region: {
    latitude: number; longitude: number;
    latitudeDelta: number; longitudeDelta: number;
  }) {
    if (boundsTimer.current) clearTimeout(boundsTimer.current);
    boundsTimer.current = setTimeout(() => {
      setBounds({
        swLat: region.latitude - region.latitudeDelta / 2,
        neLat: region.latitude + region.latitudeDelta / 2,
        swLng: region.longitude - region.longitudeDelta / 2,
        neLng: region.longitude + region.longitudeDelta / 2,
      });
    }, 300);
  }

  function locateMe() {
    if (!location) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    mapRef.current?.animateToRegion({ ...location, latitudeDelta: 0.06, longitudeDelta: 0.06 }, 800);
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

  function applyFilters() {
    setApplied({ ...draft });
    setShowFilter(false);
  }

  function resetFilters() {
    const reset = { ...DEFAULT_FILTERS };
    setDraft(reset);
  }

  function openFilterSheet() {
    setDraft({ ...applied });
    setShowFilter(true);
  }

  function toggleStyle(s: string) {
    setDraft((prev) => {
      const has = prev.styles.includes(s);
      return { ...prev, styles: has ? prev.styles.filter((x) => x !== s) : [...prev.styles, s] };
    });
  }

  function fmtDist(miles: number) {
    if (unit === "km") return `${(miles * 1.60934).toFixed(1)} km`;
    return `${miles.toFixed(1)} mi`;
  }

  const topPad = Platform.OS === "web" ? 67 : insets.top;

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
        onRegionChangeComplete={handleRegionChangeComplete}
      >
        {runs.map((run) => (
          <CustomMarker
            key={run.id}
            run={run}
            isSelected={selectedRun?.id === run.id}
            onPress={() => openRun(run)}
          />
        ))}
      </MapView>

      <View style={[styles.topBar, { paddingTop: topPad + 10 }]}>
        <Text style={styles.appName}>PaceUp</Text>
        <View style={styles.topRight}>
          {isFetching && <ActivityIndicator size="small" color={C.primary} style={{ marginRight: 8 }} />}
          <Pressable
            style={[styles.filterBtn, isFiltered && styles.filterBtnActive]}
            onPress={openFilterSheet}
          >
            <Feather name="sliders" size={15} color={isFiltered ? C.primary : C.text} />
            <Text style={[styles.filterBtnText, isFiltered && { color: C.primary }]}>Filter</Text>
            {isFiltered && <View style={styles.filterDot} />}
          </Pressable>
        </View>
      </View>

      <View style={[styles.rightButtons, { top: topPad + 72 }]}>
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
            { bottom: (Platform.OS === "web" ? 34 : insets.bottom) + 16, opacity: cardOpacity, transform: [{ translateY: slideAnim }] },
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
            <Text style={styles.joinBtnText}>View &amp; Join Run</Text>
            <Feather name="arrow-right" size={16} color={C.bg} />
          </Pressable>
        </Animated.View>
      )}

      <Modal
        visible={showFilter}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFilter(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowFilter(false)} />
        <View style={[styles.filterSheet, { paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 24 }]}>
          <View style={styles.filterHandle} />

          <View style={styles.filterHeader}>
            <Text style={styles.filterTitle}>Filters</Text>
            <Pressable onPress={() => setShowFilter(false)} hitSlop={12}>
              <Feather name="x" size={22} color={C.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            <View style={styles.filterSection}>
              <View style={styles.filterSectionHeader}>
                <Text style={styles.filterSectionTitle}>Pace</Text>
                <Text style={styles.filterSectionValue}>
                  {formatPace(draft.paceMin)} – {formatPace(draft.paceMax)} /mi
                </Text>
              </View>
              <RangeSlider
                min={6}
                max={12}
                step={0.5}
                low={draft.paceMin}
                high={draft.paceMax}
                onLowChange={(v) => setDraft((p) => ({ ...p, paceMin: v }))}
                onHighChange={(v) => setDraft((p) => ({ ...p, paceMax: v }))}
              />
              <View style={styles.sliderEdgeLabels}>
                <Text style={styles.sliderEdgeText}>6:00</Text>
                <Text style={styles.sliderEdgeText}>12:00</Text>
              </View>
            </View>

            <View style={styles.filterSection}>
              <View style={styles.filterSectionHeader}>
                <Text style={styles.filterSectionTitle}>Distance</Text>
                <View style={styles.unitToggle}>
                  {(["mi", "km"] as const).map((u) => (
                    <Pressable
                      key={u}
                      style={[styles.unitBtn, unit === u && styles.unitBtnActive]}
                      onPress={() => setUnit(u)}
                    >
                      <Text style={[styles.unitBtnText, unit === u && styles.unitBtnTextActive]}>{u}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <Text style={styles.filterSectionValue}>
                {fmtDist(draft.distMin)} – {fmtDist(draft.distMax)}
              </Text>
              <View style={{ height: 8 }} />
              <RangeSlider
                min={1}
                max={20}
                step={0.5}
                low={draft.distMin}
                high={draft.distMax}
                onLowChange={(v) => setDraft((p) => ({ ...p, distMin: v }))}
                onHighChange={(v) => setDraft((p) => ({ ...p, distMax: v }))}
              />
              <View style={styles.sliderEdgeLabels}>
                <Text style={styles.sliderEdgeText}>{unit === "km" ? "1.6 km" : "1 mi"}</Text>
                <Text style={styles.sliderEdgeText}>{unit === "km" ? "32.2 km" : "20 mi"}</Text>
              </View>
            </View>

            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Host Style</Text>
              <View style={{ height: 12 }} />
              <View style={styles.styleGrid}>
                {RUN_STYLES.map((s) => {
                  const active = draft.styles.includes(s);
                  return (
                    <Pressable
                      key={s}
                      style={[styles.styleChip, active && styles.styleChipActive]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        toggleStyle(s);
                      }}
                    >
                      {active && <Feather name="check" size={13} color={C.primary} style={{ marginRight: 4 }} />}
                      <Text style={[styles.styleChipText, active && styles.styleChipTextActive]}>{s}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>

          <View style={styles.filterFooter}>
            <Pressable
              style={styles.resetBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                resetFilters();
              }}
            >
              <Text style={styles.resetBtnText}>Reset</Text>
            </Pressable>
            <Pressable
              style={styles.applyBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                applyFilters();
              }}
            >
              <Text style={styles.applyBtnText}>Apply Filters</Text>
            </Pressable>
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
  topRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: C.surface + "F0",
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  filterBtnActive: { borderColor: C.primary, backgroundColor: C.primaryMuted + "EE" },
  filterBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  filterDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: C.primary,
    marginLeft: -2,
  },

  rightButtons: { position: "absolute", right: 16, gap: 10 },
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
  mapBtnPrimary: { backgroundColor: C.primary, borderColor: C.primary },

  calloutDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.primary,
    borderWidth: 2,
    borderColor: "#fff",
    marginTop: 2,
  },
  calloutDotSelected: { backgroundColor: "#fff", borderColor: C.primary },

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

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  filterSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderColor: C.border,
    maxHeight: "85%",
  },
  filterHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: "center",
    marginBottom: 16,
  },
  filterHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  filterTitle: { fontFamily: "Outfit_700Bold", fontSize: 22, color: C.text },

  filterSection: {
    marginBottom: 28,
  },
  filterSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  filterSectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },
  filterSectionValue: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.primary,
    marginBottom: 14,
  },
  sliderEdgeLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
    paddingHorizontal: 2,
  },
  sliderEdgeText: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },

  unitToggle: {
    flexDirection: "row",
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
  },
  unitBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: C.card,
  },
  unitBtnActive: { backgroundColor: C.primaryMuted },
  unitBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.textSecondary },
  unitBtnTextActive: { color: C.primary },

  styleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  styleChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  styleChipActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  styleChipText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  styleChipTextActive: { color: C.primary },

  filterFooter: {
    flexDirection: "row",
    gap: 12,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: C.border,
    marginTop: 8,
  },
  resetBtn: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  resetBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.textSecondary },
  applyBtn: {
    flex: 2,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.primary,
  },
  applyBtnText: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.bg },
});
