import React, { useEffect, useRef, useState, useMemo } from "react";
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
import MapView, { Marker, Region } from "react-native-maps";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import C from "@/constants/colors";
import RangeSlider from "@/components/RangeSlider";
import { formatDistance } from "@/lib/formatDistance";

const HOUSTON: Region = {
  latitude: 29.7604,
  longitude: -95.3698,
  latitudeDelta: 0.09,
  longitudeDelta: 0.09,
};

const MAP_STYLE = [
  { elementType: "geometry",           stylers: [{ color: "#0c1810" }] },
  { elementType: "labels.text.fill",   stylers: [{ color: "#4a6957" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#080f0c" }] },
  { elementType: "labels.icon",        stylers: [{ visibility: "off" }] },
  { featureType: "administrative",     elementType: "geometry.stroke", stylers: [{ color: "#1a2e21" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#5a8a6a" }] },
  { featureType: "administrative.neighborhood", stylers: [{ visibility: "off" }] },
  { featureType: "poi",                stylers: [{ visibility: "off" }] },
  { featureType: "poi.park",           elementType: "geometry", stylers: [{ color: "#0f1f15" }] },
  { featureType: "poi.park",           elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "road",               elementType: "geometry", stylers: [{ color: "#152418" }] },
  { featureType: "road",               elementType: "geometry.stroke", stylers: [{ color: "#0c1810" }] },
  { featureType: "road",               elementType: "labels.text.fill", stylers: [{ color: "#3a5a47" }] },
  { featureType: "road",               elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "road.arterial",      elementType: "geometry", stylers: [{ color: "#18291e" }] },
  { featureType: "road.highway",       elementType: "geometry", stylers: [{ color: "#1e3328" }] },
  { featureType: "road.highway",       elementType: "geometry.stroke", stylers: [{ color: "#152418" }] },
  { featureType: "road.local",         elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit",            stylers: [{ visibility: "off" }] },
  { featureType: "water",              elementType: "geometry", stylers: [{ color: "#08140f" }] },
  { featureType: "water",              elementType: "labels.text.fill", stylers: [{ color: "#1e3328" }] },
];

const RUN_STYLES = ["Talkative", "Quiet", "Motivational", "Training", "Ministry", "Recovery"];

const DEFAULT_FILTERS = {
  paceMin: 6.0,
  paceMax: 12.0,
  distMin: 1,
  distMax: 20,
  styles: [] as string[],
};

interface Run {
  id: string;
  title: string;
  host_name: string;
  host_photo: string | null;
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

interface Bounds {
  swLat: number; swLng: number; neLat: number; neLng: number;
}

function formatPace(p: number) {
  const m = Math.floor(p);
  const s = Math.round((p - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(d: string) {
  return new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function isWithin24h(d: string) {
  const ms = new Date(d).getTime() - Date.now();
  return ms > 0 && ms < 86400000;
}

function avatarUrl(name: string) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1A2E21&color=00D97E&bold=true&size=200`;
}

// ─── Custom Marker ────────────────────────────────────────────────────────────

interface MarkerProps { run: Run; isSelected: boolean; onPress: () => void; }

function RunMarker({ run, isSelected, onPress }: MarkerProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const [loaded, setLoaded] = useState(false);
  const soon = isWithin24h(run.date);
  const hasEmoji = !!run.host_marker_icon;
  const photoSrc = run.host_photo || avatarUrl(run.host_name);

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.3, useNativeDriver: true, tension: 500, friction: 8 }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 12 }),
    ]).start();
    onPress();
  }

  return (
    <Marker
      coordinate={{ latitude: run.location_lat, longitude: run.location_lng }}
      onPress={handlePress}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={hasEmoji ? false : !loaded}
    >
      <Animated.View style={[mk.wrap, { transform: [{ scale }] }]}>
        {soon && <View style={mk.glow} />}
        <View style={[mk.circle, isSelected && mk.circleSelected]}>
          {hasEmoji ? (
            <Text style={mk.emoji}>{run.host_marker_icon}</Text>
          ) : (
            <Image
              source={{ uri: photoSrc }}
              style={mk.img}
              onLoad={() => setLoaded(true)}
            />
          )}
        </View>
        <View style={mk.pin} />
      </Animated.View>
    </Marker>
  );
}

const mk = StyleSheet.create({
  wrap: { alignItems: "center", width: 62, height: 66 },
  glow: {
    position: "absolute",
    top: -3,
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2.5,
    borderColor: C.primary,
    opacity: 0.55,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 14,
  },
  circle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: C.primary,
    overflow: "hidden",
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 10,
  },
  circleSelected: {
    borderColor: "#FFFFFF",
    shadowColor: C.primary,
    shadowOpacity: 1,
    shadowRadius: 16,
  },
  img: { width: "100%", height: "100%" },
  emoji: { fontSize: 26 },
  pin: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.primary,
    marginTop: 3,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 3,
  },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const mapRef = useRef<MapView>(null);

  const [userLoc, setUserLoc] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locatedOnce, setLocatedOnce] = useState(false);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const boundsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showFilter, setShowFilter] = useState(false);
  const [unit, setUnit] = useState<"mi" | "km">("mi");
  const [draft, setDraft] = useState({ ...DEFAULT_FILTERS });
  const [applied, setApplied] = useState({ ...DEFAULT_FILTERS });

  const slideAnim = useRef(new Animated.Value(400)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;

  // ─── Filters active? ────────────────────────────────────────────────────────
  const isFiltered =
    applied.paceMin !== DEFAULT_FILTERS.paceMin ||
    applied.paceMax !== DEFAULT_FILTERS.paceMax ||
    applied.distMin !== DEFAULT_FILTERS.distMin ||
    applied.distMax !== DEFAULT_FILTERS.distMax ||
    applied.styles.length > 0;

  // ─── Build query URL ────────────────────────────────────────────────────────
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

  // ─── Location permission ─────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({});
      setUserLoc({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    })();
  }, []);

  // ─── Animate to user location once ─────────────────────────────────────────
  useEffect(() => {
    if (userLoc && !locatedOnce && mapRef.current) {
      setLocatedOnce(true);
      mapRef.current.animateToRegion(
        { ...userLoc, latitudeDelta: 0.065, longitudeDelta: 0.065 },
        1200
      );
    }
  }, [userLoc, locatedOnce]);

  // ─── Debounced bounds update ─────────────────────────────────────────────────
  function onRegionChange(r: Region) {
    if (boundsTimer.current) clearTimeout(boundsTimer.current);
    boundsTimer.current = setTimeout(() => {
      setBounds({
        swLat: r.latitude - r.latitudeDelta / 2,
        neLat: r.latitude + r.latitudeDelta / 2,
        swLng: r.longitude - r.longitudeDelta / 2,
        neLng: r.longitude + r.longitudeDelta / 2,
      });
    }, 300);
  }

  // ─── Run card animation ───────────────────────────────────────────────────
  function openCard(run: Run) {
    setSelectedRun(run);
    cardOpacity.setValue(0);
    slideAnim.setValue(400);
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 200 }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  }

  function closeCard() {
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 400, useNativeDriver: true, damping: 22 }),
      Animated.timing(cardOpacity, { toValue: 0, duration: 140, useNativeDriver: true }),
    ]).start(() => setSelectedRun(null));
  }

  // ─── Filter helpers ────────────────────────────────────────────────────────
  function toggleStyle(s: string) {
    setDraft((p) => ({
      ...p,
      styles: p.styles.includes(s) ? p.styles.filter((x) => x !== s) : [...p.styles, s],
    }));
  }

  function applyFilters() {
    setApplied({ ...draft });
    setShowFilter(false);
  }

  function resetFilters() {
    setDraft({ ...DEFAULT_FILTERS });
  }

  function fmtDist(mi: number) {
    return unit === "km"
      ? `${formatDistance(mi * 1.60934)} km`
      : `${formatDistance(mi)} mi`;
  }

  const topPad = insets.top;

  return (
    <View style={s.container}>
      {/* ─── Map ─────────────────────────────────────────────────────────── */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={HOUSTON}
        mapType="mutedStandard"
        customMapStyle={MAP_STYLE}
        showsUserLocation={!!userLoc}
        showsMyLocationButton={false}
        showsCompass={false}
        showsScale={false}
        showsTraffic={false}
        showsBuildings={false}
        showsIndoors={false}
        showsPointsOfInterest={false}
        toolbarEnabled={false}
        userInterfaceStyle="dark"
        rotateEnabled={false}
        pitchEnabled={false}
        onRegionChangeComplete={onRegionChange}
        onPress={() => { if (selectedRun) closeCard(); }}
      >
        {runs.map((run) => (
          <RunMarker
            key={run.id}
            run={run}
            isSelected={selectedRun?.id === run.id}
            onPress={() => openCard(run)}
          />
        ))}
      </MapView>

      {/* ─── Map dim overlay ─────────────────────────────────────────────── */}
      <View style={s.mapDim} pointerEvents="none" />

      {/* ─── Bottom gradient ─────────────────────────────────────────────── */}
      <View style={s.gradBottom} pointerEvents="none">
        <View style={[s.gradLayer, { opacity: 0.04, height: 12 }]} />
        <View style={[s.gradLayer, { opacity: 0.14, height: 18 }]} />
        <View style={[s.gradLayer, { opacity: 0.32, height: 24 }]} />
        <View style={[s.gradLayer, { opacity: 0.60, height: 32 }]} />
        <View style={[s.gradLayer, { opacity: 0.84, height: 52 }]} />
      </View>

      {/* ─── Solid header ────────────────────────────────────────────────── */}
      <View style={[s.header, { paddingTop: topPad + 8 }]}>
        <View style={s.headerRow}>
          <Text style={s.appTitle}>PaceUp</Text>
          <View style={s.topRight}>
            {isFetching && (
              <ActivityIndicator size="small" color={C.primary} style={{ marginRight: 8 }} />
            )}
            <Pressable
              style={[s.filterBtn, isFiltered && s.filterBtnActive]}
              onPress={() => { setDraft({ ...applied }); setShowFilter(true); }}
            >
              <Feather name="sliders" size={15} color={isFiltered ? C.primary : C.text} />
              <Text style={[s.filterBtnText, isFiltered && { color: C.primary }]}>Filter</Text>
              {isFiltered && <View style={s.filterDot} />}
            </Pressable>
          </View>
        </View>
        {/* Header bottom fade into map */}
        <View pointerEvents="none" style={s.headerFade}>
          <View style={[s.gradLayer, { opacity: 0.95, height: 28 }]} />
          <View style={[s.gradLayer, { opacity: 0.65, height: 18 }]} />
          <View style={[s.gradLayer, { opacity: 0.30, height: 14 }]} />
          <View style={[s.gradLayer, { opacity: 0.10, height: 12 }]} />
          <View style={[s.gradLayer, { opacity: 0.03, height: 10 }]} />
        </View>
      </View>

      {/* ─── Right sidebar ───────────────────────────────────────────────── */}
      <View style={[s.sideBar, { top: topPad + 108 }]}>
        {userLoc && (
          <Pressable
            style={s.mapBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              mapRef.current?.animateToRegion(
                { ...userLoc, latitudeDelta: 0.06, longitudeDelta: 0.06 },
                800
              );
            }}
          >
            <Feather name="navigation" size={18} color={C.primary} />
          </Pressable>
        )}
        {user?.host_unlocked && (
          <Pressable
            style={[s.mapBtn, s.mapBtnGreen]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push("/create-run/index");
            }}
          >
            <Feather name="plus" size={20} color={C.bg} />
          </Pressable>
        )}
      </View>

      {/* ─── Run info card ───────────────────────────────────────────────── */}
      {selectedRun && (
        <Animated.View
          style={[
            s.card,
            { bottom: insets.bottom + 16, opacity: cardOpacity, transform: [{ translateY: slideAnim }] },
          ]}
        >
          <View style={s.cardTop}>
            {selectedRun.host_marker_icon ? (
              <View style={s.cardAvatar}>
                <Text style={{ fontSize: 24 }}>{selectedRun.host_marker_icon}</Text>
              </View>
            ) : (
              <Image
                source={{ uri: selectedRun.host_photo || avatarUrl(selectedRun.host_name) }}
                style={s.cardAvatarImg}
              />
            )}
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle} numberOfLines={1}>{selectedRun.title}</Text>
              <Text style={s.cardHost}>
                {selectedRun.host_name}
                {selectedRun.host_rating > 0 ? `  ★ ${selectedRun.host_rating.toFixed(1)}` : ""}
              </Text>
            </View>
            <Pressable onPress={closeCard} hitSlop={12}>
              <Feather name="x" size={18} color={C.textSecondary} />
            </Pressable>
          </View>

          <View style={s.chips}>
            <View style={s.chip}>
              <Feather name="clock" size={11} color={C.primary} />
              <Text style={s.chipTxt}>{formatDate(selectedRun.date)} · {formatTime(selectedRun.date)}</Text>
            </View>
            <View style={s.chip}>
              <Ionicons name="walk" size={11} color={C.orange} />
              <Text style={[s.chipTxt, { color: C.orange }]}>
                {formatPace(selectedRun.min_pace)}–{formatPace(selectedRun.max_pace)} /mi
              </Text>
            </View>
            <View style={s.chip}>
              <Feather name="map" size={11} color={C.blue} />
              <Text style={[s.chipTxt, { color: C.blue }]}>
                {formatDistance(selectedRun.min_distance)}–{formatDistance(selectedRun.max_distance)} mi
              </Text>
            </View>
            <View style={s.chip}>
              <Feather name="users" size={11} color={C.textSecondary} />
              <Text style={s.chipTxt}>{selectedRun.participant_count}/{selectedRun.max_participants}</Text>
            </View>
            {selectedRun.tags?.[0] && (
              <View style={[s.chip, s.chipTag]}>
                <Text style={[s.chipTxt, { color: C.primary }]}>{selectedRun.tags[0]}</Text>
              </View>
            )}
          </View>

          <Pressable
            style={({ pressed }) => [s.joinBtn, { opacity: pressed ? 0.85 : 1 }]}
            onPress={() => { closeCard(); router.push(`/run/${selectedRun.id}`); }}
          >
            <Text style={s.joinTxt}>View &amp; Join Run</Text>
            <Feather name="arrow-right" size={16} color={C.bg} />
          </Pressable>
        </Animated.View>
      )}

      {/* ─── Filter sheet ────────────────────────────────────────────────── */}
      <Modal
        visible={showFilter}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFilter(false)}
      >
        <Pressable style={s.overlay} onPress={() => setShowFilter(false)} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={s.sheetHandle} />

          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>Filters</Text>
            <Pressable onPress={() => setShowFilter(false)} hitSlop={12}>
              <Feather name="x" size={22} color={C.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            {/* Pace */}
            <View style={s.section}>
              <View style={s.sectionHead}>
                <Text style={s.sectionLabel}>Pace</Text>
                <Text style={s.sectionValue}>
                  {formatPace(draft.paceMin)} – {formatPace(draft.paceMax)} /mi
                </Text>
              </View>
              <RangeSlider
                min={6} max={12} step={0.5}
                low={draft.paceMin} high={draft.paceMax}
                onLowChange={(v) => setDraft((p) => ({ ...p, paceMin: v }))}
                onHighChange={(v) => setDraft((p) => ({ ...p, paceMax: v }))}
              />
              <View style={s.edgeRow}>
                <Text style={s.edgeLabel}>6:00</Text>
                <Text style={s.edgeLabel}>12:00</Text>
              </View>
            </View>

            {/* Distance */}
            <View style={s.section}>
              <View style={s.sectionHead}>
                <Text style={s.sectionLabel}>Distance</Text>
                <View style={s.unitRow}>
                  {(["mi", "km"] as const).map((u) => (
                    <Pressable
                      key={u}
                      style={[s.unitBtn, unit === u && s.unitBtnOn]}
                      onPress={() => setUnit(u)}
                    >
                      <Text style={[s.unitTxt, unit === u && s.unitTxtOn]}>{u}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <Text style={s.sectionValue}>{fmtDist(draft.distMin)} – {fmtDist(draft.distMax)}</Text>
              <RangeSlider
                min={1} max={20} step={0.5}
                low={draft.distMin} high={draft.distMax}
                onLowChange={(v) => setDraft((p) => ({ ...p, distMin: v }))}
                onHighChange={(v) => setDraft((p) => ({ ...p, distMax: v }))}
              />
              <View style={s.edgeRow}>
                <Text style={s.edgeLabel}>{unit === "km" ? "1.6 km" : "1 mi"}</Text>
                <Text style={s.edgeLabel}>{unit === "km" ? "32.2 km" : "20 mi"}</Text>
              </View>
            </View>

            {/* Style */}
            <View style={s.section}>
              <Text style={s.sectionLabel}>Style</Text>
              <View style={{ height: 12 }} />
              <View style={s.styleGrid}>
                {RUN_STYLES.map((st) => {
                  const on = draft.styles.includes(st);
                  return (
                    <Pressable
                      key={st}
                      style={[s.stylePill, on && s.stylePillOn]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        toggleStyle(st);
                      }}
                    >
                      {on && <Feather name="check" size={12} color={C.primary} style={{ marginRight: 4 }} />}
                      <Text style={[s.styleTxt, on && s.styleTxtOn]}>{st}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>

          {/* Buttons */}
          <View style={s.sheetFooter}>
            <Pressable
              style={s.resetBtn}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); resetFilters(); }}
            >
              <Text style={s.resetTxt}>Reset</Text>
            </Pressable>
            <Pressable
              style={s.applyBtn}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); applyFilters(); }}
            >
              <Text style={s.applyTxt}>Apply Filters</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  mapDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.13)",
  },

  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: C.bg,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  headerFade: { width: "100%" },

  gradBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
  gradLayer: {
    width: "100%",
    backgroundColor: C.bg,
  },

  appTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 28,
    color: C.text,
    letterSpacing: -0.5,
  },
  topRight: { flexDirection: "row", alignItems: "center" },

  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 24,
    backgroundColor: C.surface,
    borderWidth: 1.5,
    borderColor: C.primary + "40",
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  filterBtnActive: {
    borderColor: C.primary,
    backgroundColor: C.card,
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },
  filterBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  filterDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: C.primary, marginLeft: -2 },

  sideBar: { position: "absolute", right: 16, gap: 10 },
  mapBtn: {
    width: 44, height: 44,
    borderRadius: 22,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: C.borderLight,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  mapBtnGreen: {
    backgroundColor: C.primary,
    borderColor: C.primary,
    shadowColor: C.primary,
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },

  card: {
    position: "absolute",
    left: 16, right: 16,
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
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  cardAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: C.border,
  },
  cardAvatarImg: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.card },
  cardTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },
  cardHost: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 14 },
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
  chipTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.text },
  joinBtn: {
    backgroundColor: C.primary,
    borderRadius: 14,
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  joinTxt: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.bg },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderColor: C.border,
    maxHeight: "85%",
  },
  sheetHandle: {
    width: 40, height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  sheetTitle: { fontFamily: "Outfit_700Bold", fontSize: 22, color: C.text },

  section: { marginBottom: 28 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  sectionLabel: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },
  sectionValue: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.primary, marginBottom: 14 },
  edgeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingHorizontal: 2 },
  edgeLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },

  unitRow: { flexDirection: "row", borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: C.border },
  unitBtn: { paddingHorizontal: 12, paddingVertical: 5, backgroundColor: C.card },
  unitBtnOn: { backgroundColor: C.primaryMuted },
  unitTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.textSecondary },
  unitTxtOn: { color: C.primary },

  styleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stylePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  stylePillOn: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  styleTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  styleTxtOn: { color: C.primary },

  sheetFooter: { flexDirection: "row", gap: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.border, marginTop: 8 },
  resetBtn: { flex: 1, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  resetTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.textSecondary },
  applyBtn: { flex: 2, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: C.primary },
  applyTxt: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.bg },
});
