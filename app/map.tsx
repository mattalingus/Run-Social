import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
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
  TextInput,
  Dimensions,
  Alert,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import MapView, { Marker, Polyline, Region } from "react-native-maps";
const MAP_TYPE = Platform.OS === "ios" ? ("mutedStandard" as const) : ("standard" as const);
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useActivity } from "@/contexts/ActivityContext";
import { useWalkthrough } from "@/contexts/WalkthroughContext";
import { useTheme } from "@/contexts/ThemeContext";
import { type ColorScheme } from "@/constants/colors";
import RangeSlider from "@/components/RangeSlider";
import { formatDistance } from "@/lib/formatDistance";
import { toDisplayDist, toDisplayDistSmart, toDisplayPace, unitLabel, type DistanceUnit } from "@/lib/units";
import HostProfileSheet from "@/components/HostProfileSheet";
import PathBadge from "@/components/PathBadge";
import { getApiUrl, apiRequest } from "@/lib/query-client";

function resolveImgUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return new URL(url, getApiUrl()).toString();
}

// ─── Constants ────────────────────────────────────────────────────────────────

const { height: WIN_H } = Dimensions.get("window");

const INITIAL_DELTA = 0.06;

const HOUSTON: Region = {
  latitude: 29.7604,
  longitude: -95.3698,
  latitudeDelta: INITIAL_DELTA,
  longitudeDelta: INITIAL_DELTA,
};

function regionToBounds(r: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number }) {
  return {
    swLat: r.latitude - r.latitudeDelta / 2,
    neLat: r.latitude + r.latitudeDelta / 2,
    swLng: r.longitude - r.longitudeDelta / 2,
    neLng: r.longitude + r.longitudeDelta / 2,
  };
}

import MAP_STYLE from "@/lib/mapStyle";

const RUN_STYLES = ["Talkative", "Quiet", "Motivational", "Training", "Ministry", "Recovery"];

const DEFAULT_FILTERS = {
  paceMin: 6.0,
  paceMax: 12.0,
  distMin: 1,
  distMax: 20,
  styles: [] as string[],
  visibility: "all" as "all" | "public" | "crew" | "friends",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Run {
  id: string;
  title: string;
  host_id: string;
  host_name: string;
  host_photo: string | null;
  host_marker_icon: string | null;
  host_rating: number;
  host_rating_count?: number;
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
  is_locked?: boolean;
  privacy?: string;
  is_active?: boolean;
  activity_type?: string;
  crew_photo_url?: string | null;
  crew_id?: string | null;
}

interface PathVariant {
  id: string;
  name: string;
  route_path: Array<{ latitude: number; longitude: number }>;
  distance_miles: number;
  activity_types?: string[] | null;
}

interface CommunityPath {
  id: string;
  name: string;
  route_path: Array<{ latitude: number; longitude: number }>;
  distance_miles: number | null;
  created_by_name?: string | null;
  run_count?: number;
  activity_type?: string;
  activity_types?: string[] | null;
  source?: "osm" | "user";
  is_osm?: boolean;
  start_lat: number;
  start_lng: number;
  end_lat: number;
  end_lng: number;
  variants?: PathVariant[];
}

interface Bounds {
  swLat: number; swLng: number; neLat: number; neLng: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPace(p: number) {
  let m = Math.floor(p);
  let s = Math.round((p - m) * 60);
  if (s === 60) { s = 0; m += 1; }
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

function getPaceColor(
  minPace: number,
  maxPace: number,
  C: { orange: string; gold: string; primary: string },
  activityType: "run" | "ride" | "walk" = "run",
): string {
  // Very wide range → treat as mixed / beginner-friendly → green default
  if (activityType === "ride") {
    // Ride pace is mph (higher = faster = harder)
    if ((maxPace - minPace) >= 10) return C.primary;
    const median = (minPace + maxPace) / 2;
    if (median >= 20) return "#C0392B"; // elite
    if (median >= 17) return C.orange;  // hard
    if (median >= 14) return C.gold;    // moderate
    return C.primary;                   // easy
  }
  // Run/walk pace is min/mi (lower = faster = harder)
  if (maxPace >= 15 || (maxPace - minPace) >= 10) return C.primary;
  const median = (minPace + maxPace) / 2;
  if (activityType === "walk") {
    // Walk: easier thresholds (walkers don't hit sub-6 paces)
    if (median < 13) return "#C0392B"; // power walk / race walk
    if (median < 15) return C.orange;  // brisk
    if (median < 18) return C.gold;    // moderate
    return C.primary;                  // casual
  }
  // Run
  if (median < 6) return "#C0392B";    // elite (sub-6 /mi)
  if (median < 8.5) return C.orange;   // hard (e.g. 7–10 range → median 8.5 → orange boundary)
  if (median < 10) return C.gold;      // moderate
  return C.primary;                    // easy
}

// ─── Custom Marker ─────────────────────────────────────────────────────────

function VariantMiniMap({ pts, active, C }: { pts: Array<{ latitude: number; longitude: number }>; active: boolean; C: any }) {
  const { lats, lngs, region } = useMemo(() => {
    const lats = pts.map((p) => p.latitude);
    const lngs = pts.map((p) => p.longitude);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const pad = 0.2;
    return {
      lats, lngs,
      region: {
        latitude: (minLat + maxLat) / 2,
        longitude: (minLng + maxLng) / 2,
        latitudeDelta: Math.max(0.003, (maxLat - minLat) * (1 + pad)),
        longitudeDelta: Math.max(0.003, (maxLng - minLng) * (1 + pad)),
      },
    };
  }, [pts]);
  return (
    <View pointerEvents="none" style={{ width: 120, height: 80, borderRadius: 10, overflow: "hidden", backgroundColor: C.card }}>
      <MapView
        style={{ flex: 1 }}
        initialRegion={region}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        liteMode
      >
        <Polyline coordinates={pts} strokeColor={active ? "#FFD166" : C.primary} strokeWidth={3} />
      </MapView>
    </View>
  );
}

function LockedRunMarker({ run, isSelected, onPress }: { run: Run; isSelected: boolean; onPress: () => void }) {
  const { C } = useTheme();
  const mk = useMemo(() => makeMkStyles(C), [C]);
  const scale = useRef(new Animated.Value(1)).current;
  const coord = useMemo(
    () => ({ latitude: run.location_lat, longitude: run.location_lng }),
    [run.location_lat, run.location_lng]
  );

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.2, useNativeDriver: true, tension: 500, friction: 8 }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 12 }),
    ]).start();
    onPress();
  }

  return (
    <Marker
      coordinate={coord}
      onPress={handlePress}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
    >
      <Animated.View style={[mk.wrap, { transform: [{ scale }] }]}>
        <View style={[mk.circle, mk.circleGray, isSelected && mk.circleGraySelected]}>
          <Feather name="lock" size={20} color="#777" />
        </View>
        <View style={mk.pinGray} />
      </Animated.View>
    </Marker>
  );
}

function RunMarker({ run, isSelected, isFriend, zoom, onPress }: { run: Run; isSelected: boolean; isFriend?: boolean; zoom: number; onPress: () => void }) {
  const { C } = useTheme();
  const mk = useMemo(() => makeMkStyles(C), [C]);
  const scale = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(0.3)).current;
  // contentReady: true once image/emoji has rendered and we can freeze the snapshot
  const [contentReady, setContentReady] = useState(false);
  // Stable coordinate reference — critical on iOS. Without memoization a new
  // object is created on every render; combined with a tracksViewChanges flip
  // (true→false when contentReady fires) the native marker briefly unregisters
  // and snaps to (0,0) = top-left before re-syncing.
  const coord = useMemo(
    () => ({ latitude: run.location_lat, longitude: run.location_lng }),
    [run.location_lat, run.location_lng]
  );
  const soon = isWithin24h(run.date);
  const isLiveNow = !!run.is_active && (run.participant_count ?? 0) > 0;
  const diffColor = getPaceColor(run.min_pace, run.max_pace, C, (run.activity_type as any) ?? "run");
  // Scale marker with zoom: full size at zoom>=14, shrinks down to 0.4 at zoom 11, hidden below 11.
  const zoomScale = Math.min(1, Math.max(0.4, 0.4 + (zoom - 11) * 0.2));
  const icon = run.host_marker_icon;
  const isEmojiIcon = !!icon && !icon.startsWith("http") && !icon.startsWith("/api/objects");
  const isUrlIcon = !!icon && (icon.startsWith("http") || icon.startsWith("/api/objects"));
  const crewPhoto = resolveImgUrl(run.crew_photo_url);
  const photoSrc = isUrlIcon ? icon : (crewPhoto || run.host_photo || avatarUrl(run.host_name));

  // tracksViewChanges must NOT include isSelected — toggling it on tap causes
  // the native marker to briefly unregister and jump to (0,0) = top-left.
  // Scale animation uses native driver so it doesn't need tracksViewChanges=true.
  // Track view changes while in the zoom-scaling range so the native marker
  // picks up the shrinking transform; freeze it once we're close-in (zoom >= 14)
  // where zoomScale is clamped at 1.0 and won't change.
  const tracksViewChanges = isLiveNow || !contentReady || zoom < 14;

  useEffect(() => {
    if (isLiveNow) return;
    // Emoji renders instantly — freeze after a short delay
    if (isEmojiIcon) {
      const t = setTimeout(() => setContentReady(true), 200);
      return () => clearTimeout(t);
    }
    // URL images: contentReady set via onLoad callback below
  }, []);

  useEffect(() => {
    if (isLiveNow) return;
    if (!isSelected) return;
    Animated.spring(scale, { toValue: 1.15, useNativeDriver: true, tension: 400, friction: 10 }).start(() => {
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 12 }).start();
    });
  }, [isSelected]);


  useEffect(() => {
    if (!isLiveNow) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.15, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isLiveNow]);

  if (run.is_locked) {
    return <LockedRunMarker run={run} isSelected={isSelected} onPress={onPress} />;
  }

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
      coordinate={coord}
      onPress={handlePress}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracksViewChanges}
    >
      <Animated.View style={[mk.wrap, { transform: [{ scale: zoomScale }, { scale }] }]}>
        {soon && <View style={[mk.glow, { borderColor: diffColor, shadowColor: diffColor }]} />}
        {isLiveNow && <Animated.View style={[mk.liveRing, { opacity: pulseAnim, borderColor: diffColor, shadowColor: diffColor }]} />}
        <View style={[mk.circle, { borderColor: diffColor, shadowColor: diffColor }, isSelected && mk.circleSelected]}>
          {isEmojiIcon ? (
            <Text style={mk.emoji}>{icon}</Text>
          ) : (
            <Image
              source={{ uri: photoSrc }}
              style={mk.img}
              onLoad={() => { if (!isLiveNow) setContentReady(true); }}
            />
          )}
        </View>
        {/* Branded teardrop tail — difficulty-colored */}
        <View style={[mk.tail, { borderTopColor: diffColor }]} />
        {isLiveNow && (
          <View style={[mk.liveBadge, { backgroundColor: diffColor }]}>
            <Text style={mk.liveBadgeText}>LIVE</Text>
          </View>
        )}
      </Animated.View>
    </Marker>
  );
}

function makeMkStyles(C: ColorScheme) { return StyleSheet.create({
  wrap: { alignItems: "center", width: 62, height: 70 },
  glow: {
    position: "absolute", top: -3,
    width: 58, height: 58, borderRadius: 29,
    borderWidth: 2.5, borderColor: C.primary,
    opacity: 0.55,
    shadowColor: C.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 14,
  },
  circle: {
    width: 48, height: 48, borderRadius: 24,
    borderWidth: 3, borderColor: C.textMuted,
    overflow: "hidden", backgroundColor: C.card,
    alignItems: "center", justifyContent: "center",
    shadowColor: C.textMuted, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.35, shadowRadius: 4,
    elevation: 10,
  },
  circleSelected: { borderColor: "#FFFFFF", shadowOpacity: 1, shadowRadius: 16 },
  circleGray: { borderColor: "#444", shadowColor: "#000", shadowOpacity: 0.2 },
  circleGraySelected: { borderColor: "#888" },
  img: { width: "100%", height: "100%" },
  emoji: { fontSize: 26 },
  // Teardrop tail — triangle pointing down, colored by difficulty via inline borderTopColor
  tail: {
    marginTop: -2,
    width: 0, height: 0,
    borderLeftWidth: 8, borderRightWidth: 8, borderTopWidth: 10,
    borderLeftColor: "transparent", borderRightColor: "transparent",
    borderTopColor: C.primary,
  },
  pinGray: { width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderTopWidth: 10, borderLeftColor: "transparent", borderRightColor: "transparent", borderTopColor: "#555", marginTop: -2 },
  liveRing: {
    position: "absolute", top: -5,
    width: 62, height: 62, borderRadius: 31,
    borderWidth: 2.5, borderColor: "#C0392B",
    shadowColor: "#C0392B", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 8,
  },
  liveBadge: {
    position: "absolute", top: -8, right: -6,
    backgroundColor: C.primary, borderRadius: 6,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  liveBadgeText: { fontFamily: "Outfit_700Bold", fontSize: 8, color: C.bg, letterSpacing: 0.5 },
}); }

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const distUnit: DistanceUnit = ((user as any)?.distance_unit ?? "miles") as DistanceUnit;
  const { activityFilter, setActivityFilter } = useActivity();
  const { isActive: walkthroughActive, nextStep: walkthroughNext } = useWalkthrough();
  const { C } = useTheme();
  const mk = useMemo(() => makeMkStyles(C), [C]);
  const s = useMemo(() => makeSStyles(C), [C]);
  const mapRef = useRef<MapView>(null);
  const params = useLocalSearchParams<{ styles?: string }>();

  const [activityRailOpen, setActivityRailOpen] = useState(false);
  const [userLoc, setUserLoc] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locatedOnce, setLocatedOnce] = useState(false);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [selectedCommunityPath, setSelectedCommunityPath] = useState<CommunityPath | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [hostProfileId, setHostProfileId] = useState<string | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(regionToBounds(HOUSTON));
  const boundsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [layers, setLayers] = useState<{ foot: boolean; ride: boolean; events: boolean }>({ foot: true, ride: true, events: true });
  const [selectedPublicRouteId, setSelectedPublicRouteId] = useState<string | null>(null);
  const [currentZoom, setCurrentZoom] = useState<number>(13);
  const pubRouteSheetAnim = useRef(new Animated.Value(500)).current;
  const pubRouteSheetOpacity = useRef(new Animated.Value(0)).current;

  const pathSlideAnim = useRef(new Animated.Value(400)).current;
  const pathCardOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AsyncStorage.getItem("paceup_map_layers").then(v => {
      if (v) { try { setLayers(JSON.parse(v)); } catch {} }
    }).catch(() => {});
  }, []);

  function toggleLayer(key: "foot" | "ride" | "events") {
    setLayers(prev => {
      const next = { ...prev, [key]: !prev[key] };
      AsyncStorage.setItem("paceup_map_layers", JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  const publicRoutesLayer = layers.foot || layers.ride ? (layers.foot && layers.ride ? "all" : layers.foot ? "foot" : "ride") : null;

  const zoomTier = currentZoom >= 14 ? 14 : currentZoom >= 12 ? 12 : currentZoom >= 10 ? 10 : 8;

  const publicRoutesQueryKey = useMemo(() => {
    if (!bounds || !publicRoutesLayer) return null;
    const snap = (v: number) => Math.round(v / 0.05) * 0.05;
    return `/api/map/routes?swLat=${snap(bounds.swLat)}&swLng=${snap(bounds.swLng)}&neLat=${snap(bounds.neLat)}&neLng=${snap(bounds.neLng)}&layer=${publicRoutesLayer}&limit=500&zoom=${zoomTier}`;
  }, [bounds, publicRoutesLayer, zoomTier]);

  const { data: publicRoutes = [] } = useQuery<any[]>({
    queryKey: [publicRoutesQueryKey],
    enabled: !!publicRoutesQueryKey,
    staleTime: 120_000,
    placeholderData: (prev) => prev,
  });

  const { data: publicRouteDetail } = useQuery<any>({
    queryKey: [`/api/map/routes/${selectedPublicRouteId}`],
    enabled: !!selectedPublicRouteId,
    staleTime: 60_000,
  });

  const [showFilter, setShowFilter] = useState(false);

  const initStyles = params.styles ? params.styles.split(",").filter(Boolean) : [];
  const [draft, setDraft] = useState({ ...DEFAULT_FILTERS, styles: initStyles });
  const [applied, setApplied] = useState({ ...DEFAULT_FILTERS, styles: initStyles });

  const slideAnim = useRef(new Animated.Value(400)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;

  const isFiltered =
    applied.paceMin !== DEFAULT_FILTERS.paceMin ||
    applied.paceMax !== DEFAULT_FILTERS.paceMax ||
    applied.distMin !== DEFAULT_FILTERS.distMin ||
    applied.distMax !== DEFAULT_FILTERS.distMax ||
    applied.styles.length > 0 ||
    applied.visibility !== "all";

  const queryUrl = useMemo(() => {
    const p = new URLSearchParams();
    p.set("minPace", applied.paceMin.toString());
    p.set("maxPace", applied.paceMax.toString());
    p.set("minDistance", applied.distMin.toString());
    p.set("maxDistance", applied.distMax.toString());
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
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  const { data: friends = [] } = useQuery<{ id: string }[]>({
    queryKey: ["/api/friends"],
    staleTime: 60_000,
    enabled: !!user,
  });

  const friendIdSet = useMemo(() => new Set(friends.map((f) => f.id)), [friends]);

  const { data: communityPathsData = [] } = useQuery<CommunityPath[]>({
    queryKey: ["/api/community-paths"],
    staleTime: 300_000,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/community-paths");
      return res.json();
    },
  });

  const communityPaths = useMemo(() => {
    return communityPathsData.map(path => ({
      ...path,
      route_path: typeof path.route_path === "string" ? JSON.parse(path.route_path) : path.route_path
    }));
  }, [communityPathsData]);

  const visiblePaths = useMemo(() => {
    if (!bounds) return communityPaths;
    const centerLat = (bounds.swLat + bounds.neLat) / 2;
    const centerLng = (bounds.swLng + bounds.neLng) / 2;
    const filtered = communityPaths.filter((path) => {
      const pts: Array<{ latitude: number; longitude: number }> = path.route_path;
      if (!pts || pts.length === 0) return false;
      return pts.some(
        (pt) => pt.latitude >= bounds.swLat && pt.latitude <= bounds.neLat &&
                 pt.longitude >= bounds.swLng && pt.longitude <= bounds.neLng
      );
    });
    return filtered.sort((a, b) => {
      const da = Math.hypot((a.start_lat + a.end_lat) / 2 - centerLat, (a.start_lng + a.end_lng) / 2 - centerLng);
      const db = Math.hypot((b.start_lat + b.end_lat) / 2 - centerLat, (b.start_lng + b.end_lng) / 2 - centerLng);
      return da - db;
    });
  }, [communityPaths, bounds]);

  // Only runs/rides matching the activity filter and visible in the map viewport.
  // Explicitly exclude (0,0) pins and non-finite coordinates to prevent the map
  // from zooming out to span the globe.
  const visibleRuns = useMemo(() => {
    if (!bounds) return [];
    const base = walkthroughActive
      ? (() => { try {
          const { getDemoEventCard } = require("@/lib/walkthroughDemo") as typeof import("@/lib/walkthroughDemo");
          return [getDemoEventCard(activityFilter, bounds ? (bounds.swLat + bounds.neLat) / 2 : undefined, bounds ? (bounds.swLng + bounds.neLng) / 2 : undefined) as any, ...runs];
        } catch { return runs; } })()
      : runs;
    return base.filter((r: any) => {
      if (!Number.isFinite(r.location_lat) || !Number.isFinite(r.location_lng)) return false;
      if (r.location_lat === 0 && r.location_lng === 0) return false;
      if ((r.activity_type ?? "run") !== activityFilter) return false;
      if (r.location_lat < bounds.swLat || r.location_lat > bounds.neLat) return false;
      if (r.location_lng < bounds.swLng || r.location_lng > bounds.neLng) return false;
      if (applied.visibility === "public" && (r.privacy !== "public" || !!r.crew_id)) return false;
      if (applied.visibility === "crew" && !r.crew_id) return false;
      if (applied.visibility === "friends" && (!!r.crew_id || r.privacy === "public")) return false;
      return true;
    });
  }, [runs, bounds, activityFilter, applied.visibility, walkthroughActive]);

  const insights = useMemo(() => {
    if (visibleRuns.length === 0) return [];
    const now = Date.now();
    const result: Array<{ icon: string; lib: "feather" | "ion"; text: string; color: string }> = [];

    const label = activityFilter === "ride" ? "ride" : activityFilter === "walk" ? "walk" : "run";
    result.push({ icon: "map-pin", lib: "feather", text: `${visibleRuns.length} ${label}${visibleRuns.length !== 1 ? "s" : ""} on map`, color: C.primary });

    const upcoming = visibleRuns
      .filter((r) => new Date(r.date).getTime() > now)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (upcoming.length > 0) {
      const diffMin = Math.round((new Date(upcoming[0].date).getTime() - now) / 60000);
      if (diffMin <= 60) {
        result.push({ icon: "clock", lib: "feather", text: `Starts in ${diffMin}m`, color: C.orange });
      } else if (diffMin < 1440) {
        const h = Math.floor(diffMin / 60); const m = diffMin % 60;
        result.push({ icon: "clock", lib: "feather", text: m > 0 ? `Next in ${h}h ${m}m` : `Next in ${h}h`, color: C.textSecondary });
      }
    }

    const totalOpen = visibleRuns.filter(r => r.max_participants < 9999).reduce((acc, r) => acc + Math.max(0, r.max_participants - r.participant_count), 0);
    if (totalOpen > 0) result.push({ icon: "users", lib: "feather", text: `${totalOpen} open spot${totalOpen !== 1 ? "s" : ""}`, color: C.blue });

    const fastest = visibleRuns.reduce((a, b) => a.min_pace < b.min_pace ? a : b);
    result.push({ icon: "zap", lib: "feather", text: `${toDisplayPace(fastest.min_pace, distUnit)} fastest`, color: "#F4C542" });

    if (visibleRuns.length > 1) {
      const minD = Math.min(...visibleRuns.map((r) => r.min_distance));
      const maxD = Math.max(...visibleRuns.map((r) => r.max_distance));
      result.push({ icon: "target", lib: "feather", text: `${toDisplayDist(minD, distUnit)}–${toDisplayDist(maxD, distUnit)} range`, color: C.textSecondary });
    }

    const totalRunners = visibleRuns.reduce((acc, r) => acc + Number(r.participant_count), 0);
    const participantNoun = activityFilter === "ride" ? "rider" : activityFilter === "walk" ? "walker" : "runner";
    const participantIcon = activityFilter === "ride" ? "bicycle" : activityFilter === "walk" ? "footsteps" : "body";
    if (totalRunners > 0) result.push({ icon: participantIcon, lib: "ion", text: `${totalRunners} ${participantNoun}${totalRunners !== 1 ? "s" : ""} signed up`, color: C.primary });

    const fiveK = upcoming.filter((r) => r.activity_type === "run" && r.min_distance <= 3.3 && r.max_distance >= 2.8);
    if (fiveK.length > 0) {
      const diffMin = Math.round((new Date(fiveK[0].date).getTime() - now) / 60000);
      if (diffMin < 1440) result.push({ icon: "flag", lib: "feather", text: `5K in ${diffMin < 60 ? diffMin + "m" : Math.floor(diffMin / 60) + "h"}`, color: C.orange });
    }

    return result;
  }, [visibleRuns]);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc = await Location.getCurrentPositionAsync({});
      setUserLoc({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    })();
  }, []);

  useEffect(() => {
    if (userLoc && !locatedOnce && mapRef.current) {
      setLocatedOnce(true);
      const region = { ...userLoc, latitudeDelta: INITIAL_DELTA, longitudeDelta: INITIAL_DELTA };
      mapRef.current.animateToRegion(region, 1000);
      setBounds(regionToBounds(region));
    }
  }, [userLoc, locatedOnce]);

  const currentRegionRef = useRef<Region | null>(null);
  function onRegionChange(r: Region) {
    currentRegionRef.current = r;
    if (boundsTimer.current) clearTimeout(boundsTimer.current);
    boundsTimer.current = setTimeout(() => {
      setBounds(regionToBounds(r));
      const zoom = Math.round(Math.log2(360 / r.longitudeDelta));
      setCurrentZoom(Math.max(1, Math.min(22, zoom)));
    }, 400);
  }

  function openCard(run: Run) {
    if ((run as any).__demo) { walkthroughNext?.(); return; }
    if (selectedCommunityPath) closePathCard();
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

  function openPublicRouteSheet(routeId: string) {
    if (selectedRun) closeCard();
    if (selectedCommunityPath) closePathCard();
    setSelectedPublicRouteId(routeId);
    pubRouteSheetAnim.setValue(500);
    pubRouteSheetOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(pubRouteSheetAnim, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 200 }),
      Animated.timing(pubRouteSheetOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  }

  function closePublicRouteSheet() {
    Animated.parallel([
      Animated.spring(pubRouteSheetAnim, { toValue: 500, useNativeDriver: true, damping: 22 }),
      Animated.timing(pubRouteSheetOpacity, { toValue: 0, duration: 140, useNativeDriver: true }),
    ]).start(() => setSelectedPublicRouteId(null));
  }

  const nearbyPaths = useMemo(() => {
    if (!selectedCommunityPath) return [] as CommunityPath[];
    const sp = selectedCommunityPath;
    const sLat = sp.start_lat ?? sp.route_path?.[0]?.latitude;
    const sLng = sp.start_lng ?? sp.route_path?.[0]?.longitude;
    if (sLat == null || sLng == null) return [];
    return communityPaths.filter((p) => {
      if (p.id === sp.id) return false;
      const pLat = p.start_lat ?? p.route_path?.[0]?.latitude;
      const pLng = p.start_lng ?? p.route_path?.[0]?.longitude;
      if (pLat == null || pLng == null) return false;
      return Math.abs(pLat - sLat) < 0.004 && Math.abs(pLng - sLng) < 0.004;
    }).slice(0, 8);
  }, [selectedCommunityPath, communityPaths]);

  const [savingPathId, setSavingPathId] = useState<string | null>(null);
  const saveCommunityPathToMyRoutes = useCallback(async (path: CommunityPath) => {
    if (!user) {
      Alert.alert("Sign in required", "Sign in to save routes.");
      return;
    }
    try {
      setSavingPathId(path.id);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const activityTypes = (path.activity_types && path.activity_types.length > 0)
        ? path.activity_types
        : [path.activity_type ?? "run"];
      await apiRequest("POST", "/api/saved-paths", {
        name: path.name,
        routePath: path.route_path,
        distanceMiles: path.distance_miles ?? null,
        activityType: activityTypes[0],
        activityTypes,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Saved", `"${path.name}" added to your routes.`);
    } catch (e: any) {
      Alert.alert("Could not save", e?.message ?? "Try again.");
    } finally {
      setSavingPathId(null);
    }
  }, [user]);

  function openPathCard(path: CommunityPath) {
    if (selectedRun) closeCard();
    if (selectedPublicRouteId) closePublicRouteSheet();
    setSelectedCommunityPath(path);
    setSelectedVariantId(null);
    pathCardOpacity.setValue(0);
    pathSlideAnim.setValue(400);
    Animated.parallel([
      Animated.spring(pathSlideAnim, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 200 }),
      Animated.timing(pathCardOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  }

  function closePathCard() {
    Animated.parallel([
      Animated.spring(pathSlideAnim, { toValue: 400, useNativeDriver: true, damping: 22 }),
      Animated.timing(pathCardOpacity, { toValue: 0, duration: 140, useNativeDriver: true }),
    ]).start(() => setSelectedCommunityPath(null));
  }

  function toggleStyle(st: string) {
    setDraft((p) => ({
      ...p,
      styles: p.styles.includes(st) ? p.styles.filter((x) => x !== st) : [...p.styles, st],
    }));
  }

  function applyFilters() { setApplied({ ...draft }); setShowFilter(false); }
  function resetFilters() { setDraft({ ...DEFAULT_FILTERS }); }
  const topPad = insets.top;

  return (
    <View style={[s.container, { backgroundColor: C.bg }]}>

      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <View style={[s.header, { paddingTop: topPad + (Platform.OS === "web" ? 67 : 0) }]}>
        <View style={s.headerRow}>
          <Pressable style={s.backBtn} onPress={() => router.back()}>
            <Feather name="arrow-left" size={16} color={C.textSecondary} />
            <Text style={s.backTxt}>Discover</Text>
          </Pressable>

          <View style={s.headerRight}>
            {isFetching && <ActivityIndicator size="small" color={C.primary} style={{ marginRight: 6 }} />}
            <Pressable
              style={[s.filterBtn, isFiltered && s.filterBtnActive]}
              onPress={() => { setDraft({ ...applied }); setShowFilter(true); }}
            >
              <Feather name="sliders" size={16} color={isFiltered ? C.primary : C.textSecondary} />
              {isFiltered && <View style={s.filterDot} />}
            </Pressable>
          </View>
        </View>
      </View>

      {/* ─── Map card ────────────────────────────────────────────────────── */}
      <View style={[s.mapCard, { height: WIN_H - topPad - insets.bottom - 244 }]}>

        {/* Map */}
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          initialRegion={HOUSTON}
          mapType={MAP_TYPE}
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
          onPress={() => {
            if (selectedRun) closeCard();
            if (selectedCommunityPath) closePathCard();
            if (selectedPublicRouteId) closePublicRouteSheet();
          }}
        >
          {publicRoutes.map((route: any) => {
            const isFootRoute = route.activity_type !== "ride";
            const isRideRoute = route.activity_type === "ride";
            if (isFootRoute && !layers.foot) return null;
            if (isRideRoute && !layers.ride) return null;
            const baseColor = isRideRoute ? "#2E86AB" : "#FF6B35";
            const maxCompleted = Math.max(...publicRoutes.map((r: any) => r.times_completed || 1));
            const opacity = 0.3 + 0.7 * Math.min(1, (route.times_completed || 1) / Math.max(maxCompleted, 1));
            const strokeColor = baseColor + Math.round(opacity * 255).toString(16).padStart(2, "0");
            const path = typeof route.path === "string" ? JSON.parse(route.path) : (route.path || []);
            if (!path || path.length < 2) return null;
            if (currentZoom < 11) return null;
            const baseWidth = currentZoom >= 14 ? 4 : 2.5;
            return (
              <Polyline
                key={route.id}
                coordinates={path}
                strokeColor={selectedPublicRouteId === route.id ? "#FFFFFF" : strokeColor}
                strokeWidth={selectedPublicRouteId === route.id ? 5 : baseWidth}
                tappable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  openPublicRouteSheet(route.id);
                }}
              />
            );
          })}
          {currentZoom >= 11 && communityPaths.map((path) => (
            <Polyline
              key={path.id}
              coordinates={path.route_path}
              strokeColor={selectedCommunityPath?.id === path.id ? "#FFFFFF" : "#00D97E"}
              strokeWidth={selectedCommunityPath?.id === path.id ? 5 : 3}
              tappable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                openPathCard(path);
              }}
            />
          ))}
          {selectedCommunityPath && selectedVariantId && (() => {
            const v = selectedCommunityPath.variants?.find((x) => x.id === selectedVariantId);
            if (!v) return null;
            return (
              <Polyline
                key={`variant-${v.id}`}
                coordinates={v.route_path}
                strokeColor="#FFD166"
                strokeWidth={6}
              />
            );
          })()}
          {currentZoom >= 12 && visiblePaths.map((path) => {
            const pts = path.route_path;
            if (!pts || pts.length === 0) return null;
            const mid = pts[Math.floor(pts.length / 2)];
            const typesArr = (path.activity_types && path.activity_types.length > 0)
              ? (path.activity_types as ("run" | "walk" | "ride")[])
              : ([(path.activity_type ?? "run")] as ("run" | "walk" | "ride")[]);
            return (
              <Marker
                key={`badge-${path.id}`}
                coordinate={mid}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  openPathCard(path);
                }}
              >
                <PathBadge
                  distanceMiles={path.distance_miles ?? null}
                  types={typesArr}
                  compact={currentZoom < 14}
                  unit={distUnit === "km" ? "km" : "mi"}
                />
              </Marker>
            );
          })}
          {currentZoom >= 11 && layers.events && visibleRuns.map((run) => (
            <RunMarker
              key={run.id}
              run={run}
              isSelected={selectedRun?.id === run.id}
              isFriend={friendIdSet.has(run.host_id)}
              zoom={currentZoom}
              onPress={() => openCard(run)}
            />
          ))}
        </MapView>

        {/* Dim overlay */}
        <View style={s.mapDim} pointerEvents="none" />

        {/* OSM attribution (required by ODbL for OSM-sourced routes) */}
        <View style={s.osmAttr} pointerEvents="none">
          <Text style={s.osmAttrTxt}>© OpenStreetMap contributors</Text>
        </View>


        {/* ─── Sidebar (inside map card) ────────────────────────────────── */}
        <View style={s.sideBar}>
          {userLoc && (
            <Pressable
              style={s.sideBtn}
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
          {user && (
            <Pressable
              style={[s.sideBtn, s.sideBtnGreen]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                Alert.alert("Create", undefined, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Event", onPress: () => router.push({ pathname: "/create-run", params: { activityType: activityFilter } }) },
                  { text: "Path", onPress: () => {
                      const r = currentRegionRef.current;
                      if (r) {
                        router.push({ pathname: "/create-path", params: {
                          lat: String(r.latitude),
                          lng: String(r.longitude),
                          latDelta: String(r.latitudeDelta),
                          lngDelta: String(r.longitudeDelta),
                        }});
                      } else {
                        router.push("/create-path");
                      }
                    } },
                ]);
              }}
            >
              <Feather name="plus" size={20} color={C.bg} />
            </Pressable>
          )}
        </View>

        {/* ─── Activity filter rail (right edge, mid) — collapsed by default ── */}
        {(() => {
          const options = [
            { key: "run", iconSet: "mci", icon: "run-fast", label: "Runs" },
            { key: "ride", iconSet: "ion", icon: "bicycle", label: "Rides" },
            { key: "walk", iconSet: "ion", icon: "footsteps", label: "Walks" },
          ] as const;
          const selected = options.find((o) => o.key === activityFilter) ?? options[0];
          const others = options.filter((o) => o.key !== activityFilter);
          const renderIcon = (a: typeof options[number], color: string) =>
            a.iconSet === "mci" ? (
              <MaterialCommunityIcons name={a.icon as any} size={22} color={color} />
            ) : (
              <Ionicons name={a.icon as any} size={20} color={color} />
            );
          return (
            <View style={s.activityRail}>
              {/* Selected pill with dropdown chevron */}
              <Pressable
                onPress={() => { Haptics.selectionAsync(); setActivityRailOpen((o) => !o); }}
                style={[s.activityRailBtn, s.activityRailBtnActive, { flexDirection: "row", gap: 4, paddingHorizontal: 8 }]}
                hitSlop={6}
              >
                {renderIcon(selected, C.bg)}
                <Feather name={activityRailOpen ? "chevron-up" : "chevron-down"} size={14} color={C.bg} />
              </Pressable>
              {/* Expanded options */}
              {activityRailOpen && others.map((a) => (
                <Pressable
                  key={a.key}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setActivityFilter(a.key);
                    setActivityRailOpen(false);
                  }}
                  style={s.activityRailBtn}
                  hitSlop={6}
                >
                  {renderIcon(a, C.text)}
                </Pressable>
              ))}
            </View>
          );
        })()}

        {/* ─── Run card (inside map card) ───────────────────────────────── */}
        {selectedRun && (
          <Animated.View
            style={[
              s.card,
              { bottom: 16, opacity: cardOpacity, transform: [{ translateY: slideAnim }] },
            ]}
          >
          {selectedRun.is_locked ? (
            <>
              <View style={s.cardTop}>
                <View style={s.cardAvatarLocked}>
                  <Feather name="lock" size={22} color="#666" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle} numberOfLines={1}>Friend's Private Run</Text>
                  <Text style={s.cardHost}>{selectedRun.host_name}</Text>
                </View>
                <Pressable onPress={closeCard} hitSlop={12}>
                  <Feather name="x" size={18} color={C.textSecondary} />
                </Pressable>
              </View>
              <View style={s.lockedHint}>
                <Feather name="info" size={12} color={C.textMuted} />
                <Text style={s.lockedHintTxt}>You need an invite code or password to join. Tap to request access.</Text>
              </View>
              <View style={s.chips}>
                <View style={s.chip}>
                  <Feather name="clock" size={11} color={C.textSecondary} />
                  <Text style={s.chipTxt}>{formatDate(selectedRun.date)} · {formatTime(selectedRun.date)}</Text>
                </View>
                <View style={s.chip}>
                  <Feather name="map-pin" size={11} color={C.textSecondary} />
                  <Text style={s.chipTxt} numberOfLines={1}>{selectedRun.location_name}</Text>
                </View>
              </View>
              <Pressable
                style={({ pressed }) => [s.joinBtn, s.joinBtnGray, { opacity: pressed ? 0.85 : 1 }]}
                onPress={() => { closeCard(); router.push(`/run/${selectedRun.id}`); }}
              >
                <Feather name="unlock" size={16} color={C.text} />
                <Text style={[s.joinTxt, { color: C.text }]}>Enter Code to Join</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={s.cardTop}>
                <Pressable
                  style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", flex: 1, gap: 10, opacity: pressed ? 0.75 : 1 }]}
                  onPress={() => setHostProfileId(selectedRun.host_id)}
                >
                  {selectedRun.host_marker_icon ? (
                    <View style={s.cardAvatar}>
                      <Text style={{ fontSize: 24 }}>{selectedRun.host_marker_icon}</Text>
                    </View>
                  ) : (
                    <Image
                      source={{ uri: resolveImgUrl(selectedRun.crew_photo_url) || selectedRun.host_photo || avatarUrl(selectedRun.host_name) }}
                      style={s.cardAvatarImg}
                    />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTitle} numberOfLines={1}>{selectedRun.title}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Text style={s.cardHost}>{selectedRun.host_name}</Text>
                      {(selectedRun.host_rating_count ?? 0) >= 5 && (selectedRun.host_rating ?? 0) >= 4.5 && (
                        <View style={s.topRatedChip}>
                          <Text style={s.topRatedChipTxt}>⭐ Top Rated</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </Pressable>
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
                  <Ionicons name={selectedRun.activity_type === "ride" ? "bicycle" : selectedRun.activity_type === "walk" ? "footsteps" : "body"} size={11} color={getPaceColor(selectedRun.min_pace, selectedRun.max_pace, C, (selectedRun.activity_type as any) ?? "run")} />
                  <Text style={[s.chipTxt, { color: getPaceColor(selectedRun.min_pace, selectedRun.max_pace, C, (selectedRun.activity_type as any) ?? "run") }]}>
                    {selectedRun.min_pace === selectedRun.max_pace ? toDisplayPace(selectedRun.min_pace, distUnit) : `${toDisplayPace(selectedRun.min_pace, distUnit)}–${toDisplayPace(selectedRun.max_pace, distUnit)}`}
                  </Text>
                </View>
                <View style={s.chip}>
                  <Feather name="map" size={11} color={C.blue} />
                  <Text style={[s.chipTxt, { color: C.blue }]}>
                    {(!selectedRun.min_distance || selectedRun.min_distance === selectedRun.max_distance) ? toDisplayDistSmart(selectedRun.max_distance, distUnit) : `${toDisplayDist(selectedRun.min_distance, distUnit)}–${toDisplayDist(selectedRun.max_distance, distUnit)}`}
                  </Text>
                </View>
                <View style={[s.chip, selectedRun.is_active && s.chipLive]}>
                  {selectedRun.is_active ? (
                    <View style={s.chipLiveDot} />
                  ) : (
                    <Feather name="users" size={11} color={C.textSecondary} />
                  )}
                  <Text style={[s.chipTxt, selectedRun.is_active && { color: C.primary }]}>
                    {selectedRun.is_active
                      ? `${selectedRun.participant_count} arrived`
                      : (selectedRun.crew_id || (selectedRun.max_participants ?? 0) >= 9999)
                        ? `${selectedRun.participant_count} going`
                        : `${selectedRun.participant_count}/${selectedRun.max_participants}`}
                  </Text>
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
                <Text style={s.joinTxt}>{selectedRun.activity_type === "ride" ? "View Ride" : selectedRun.activity_type === "walk" ? "View Walk" : "View Run"}</Text>
                <Feather name="arrow-right" size={16} color={C.bg} />
              </Pressable>
            </>
          )}
          </Animated.View>
        )}


        {/* ─── Public Route Info Sheet ──────────────────────────────────── */}
        {selectedPublicRouteId && (
          <Animated.View
            style={[
              s.pathSheet,
              { bottom: 0, opacity: pubRouteSheetOpacity, transform: [{ translateY: pubRouteSheetAnim }] },
            ]}
          >
            <Pressable style={s.closeSheetBtn} onPress={closePublicRouteSheet}>
              <Feather name="x" size={20} color={C.textMuted} />
            </Pressable>

            {!publicRouteDetail ? (
              <ActivityIndicator color={C.primary} style={{ marginVertical: 24 }} />
            ) : (
              <>
                {/* Busyness badge */}
                {(() => {
                  const labelMap: Record<string, { text: string; color: string }> = {
                    green: { text: "Quiet", color: "#27AE60" },
                    yellow: { text: "Moderate", color: "#F4C542" },
                    orange: { text: "Busy", color: "#E67E22" },
                    red: { text: "Very Busy", color: "#C0392B" },
                  };
                  const info = labelMap[publicRouteDetail.busyness_label] ?? labelMap.green;
                  return (
                    <View style={[s.busynessBadge, { backgroundColor: info.color + "22", borderColor: info.color + "55" }]}>
                      <View style={[s.busynessDot, { backgroundColor: info.color }]} />
                      <Text style={[s.busynessTxt, { color: info.color }]}>{info.text}</Text>
                    </View>
                  );
                })()}

                <Text style={s.pathSheetTitle}>
                  {publicRouteDetail.activity_type === "ride" ? "Bike Route" : publicRouteDetail.activity_type === "walk" ? "Walk Route" : "Run Route"}
                </Text>

                <View style={s.pathStatRow}>
                  {publicRouteDetail.distance_miles && (
                    <View style={s.pathChip}>
                      <Feather name="move" size={13} color={C.primary} />
                      <Text style={s.pathChipTxt}>{toDisplayDist(publicRouteDetail.distance_miles, distUnit)}</Text>
                    </View>
                  )}
                  {publicRouteDetail.elevation_gain_ft && (
                    <View style={s.pathChip}>
                      <Feather name="trending-up" size={13} color={C.textSecondary} />
                      <Text style={s.pathChipTxt}>{Math.round(publicRouteDetail.elevation_gain_ft)} ft</Text>
                    </View>
                  )}
                  <View style={s.pathChip}>
                    <Feather name="users" size={13} color={C.textSecondary} />
                    <Text style={s.pathChipTxt}>{publicRouteDetail.times_completed} {publicRouteDetail.times_completed === 1 ? "time" : "times"}</Text>
                  </View>
                </View>

                {/* Busiest times bar chart */}
                {publicRouteDetail.busy_by_dow && (
                  <View style={{ marginBottom: 16 }}>
                    <Text style={[s.pathMutedTxt, { marginBottom: 8 }]}>Busiest days</Text>
                    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4, height: 48 }}>
                      {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day, i) => {
                        const counts: number[] = publicRouteDetail.busy_by_dow;
                        const maxCount = Math.max(...counts, 1);
                        const h = Math.max(4, (counts[i] / maxCount) * 44);
                        return (
                          <View key={day} style={{ flex: 1, alignItems: "center", gap: 2 }}>
                            <View style={{ width: "100%", height: h, borderRadius: 3, backgroundColor: C.primary + "88" }} />
                            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 9, color: C.textMuted }}>{day}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                )}
              </>
            )}
          </Animated.View>
        )}

      </View>{/* ── end mapCard ──────────────────────────────────────────────── */}

      {/* ─── Bottom strip: Events row → Paths row → Insights pills — stacked full-width */}
      <View style={[s.splitStrip, { paddingBottom: insets.bottom + 18 }]}>

        {/* Events row — full width, horizontally scrollable; ghost card when empty */}
        {!selectedRun && !selectedCommunityPath && (
          <View style={s.stackRow}>
            {visibleRuns.length === 0 ? (
              <View style={s.ghostCard}><Text style={s.ghostTxt}>No events in view</Text></View>
            ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.stackScroll}>
              {visibleRuns.map((run) => (
                <Pressable key={run.id} style={({ pressed }) => [s.miniCard, { opacity: pressed ? 0.8 : 1 }]} onPress={() => openCard(run)}>
                  {run.host_marker_icon ? (
                    <View style={s.miniAvatar}><Text style={{ fontSize: 18 }}>{run.host_marker_icon}</Text></View>
                  ) : resolveImgUrl(run.crew_photo_url) || run.host_photo ? (
                    <Image source={{ uri: resolveImgUrl(run.crew_photo_url) || run.host_photo! }} style={s.miniAvatarImg} />
                  ) : (
                    <View style={s.miniAvatar}><Text style={s.miniAvatarTxt}>{run.host_name?.charAt(0).toUpperCase()}</Text></View>
                  )}
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={s.miniStatRow}><Feather name="map" size={10} color={C.primary} /><Text style={s.miniStatTxt}>{toDisplayDistSmart(run.min_distance, distUnit)}</Text></View>
                    <View style={s.miniStatRow}><Feather name="zap" size={10} color="#F4C542" /><Text style={[s.miniStatTxt, { color: "#F4C542" }]}>{toDisplayPace(run.min_pace, distUnit)}</Text></View>
                    <View style={s.miniStatRow}><Feather name="users" size={10} color={C.textSecondary} /><Text style={[s.miniStatTxt, { color: C.textSecondary }]}>{(run.crew_id || (run.max_participants ?? 0) >= 9999) ? `${run.participant_count} going` : `${run.participant_count}/${run.max_participants}`}</Text></View>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
            )}
          </View>
        )}

        {/* Paths row — full width, horizontally scrollable; ghost card when empty */}
        {!selectedRun && !selectedCommunityPath && (
          <View style={s.stackRow}>
            {visiblePaths.length === 0 ? (
              <View style={s.ghostCard}><Text style={s.ghostTxt}>No paths in view</Text></View>
            ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.stackScroll}>
              {visiblePaths.map((path) => {
                const d = path.distance_miles ?? 0;
                const dispMi = distUnit === "km" ? d * 1.60934 : d;
                const distLabel = dispMi > 0 && dispMi < 1
                  ? `.${Math.round(dispMi * 100).toString().padStart(2, "0")}${distUnit === "km" ? "km" : "mi"}`
                  : `${dispMi.toFixed(dispMi < 10 ? 1 : 0)}${distUnit === "km" ? "km" : "mi"}`;
                return (
                  <Pressable key={path.id} style={({ pressed }) => [s.pathMiniCard, { opacity: pressed ? 0.8 : 1 }]} onPress={() => openPathCard(path)}>
                    <View style={s.pathMiniTopRow}>
                      <View style={s.pathMiniIcon}><Feather name="map" size={12} color={C.primary} /></View>
                      <Text style={s.pathMiniDist}>{distLabel}</Text>
                    </View>
                    <Text style={s.pathMiniName} numberOfLines={2}>{path.name}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            )}
          </View>
        )}

        {/* Insights pills */}
        <View style={s.insightArea}>
          {!selectedCommunityPath && insights.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.insightScroll}>
              {insights.map((item, i) => (
                <View key={i} style={s.insightPill}>
                  {item.lib === "ion"
                    ? <Ionicons name={item.icon as any} size={12} color={item.color} />
                    : <Feather name={item.icon as any} size={12} color={item.color} />}
                  <Text style={[s.insightTxt, { color: item.color }]}>{item.text}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>

      </View>

      {/* ─── Filter sheet ────────────────────────────────────────────────── */}
      <Modal visible={showFilter} transparent animationType="slide" onRequestClose={() => setShowFilter(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
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
            <View style={s.section}>
              <Text style={s.sectionLabel}>View</Text>
              <View style={{ height: 12 }} />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {(["all", "public", "crew", "friends"] as const).map((opt) => {
                  const labels = { all: "All", public: "Public", crew: "Crew", friends: "Friends" };
                  const active = draft.visibility === opt;
                  return (
                    <Pressable
                      key={opt}
                      style={[s.stylePill, active && s.stylePillOn]}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDraft((p) => ({ ...p, visibility: opt })); }}
                    >
                      {active && <Feather name="check" size={12} color={C.primary} style={{ marginRight: 4 }} />}
                      <Text style={[s.styleTxt, active && s.styleTxtOn]}>{labels[opt]}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={s.section}>
              <View style={s.sectionHead}>
                <Text style={s.sectionLabel}>Pace</Text>
                <Text style={s.sectionValue}>{toDisplayPace(draft.paceMin, distUnit)} – {toDisplayPace(draft.paceMax, distUnit)}</Text>
              </View>
              <RangeSlider
                min={6} max={12} step={0.5}
                low={draft.paceMin} high={draft.paceMax}
                onLowChange={(v) => setDraft((p) => ({ ...p, paceMin: v }))}
                onHighChange={(v) => setDraft((p) => ({ ...p, paceMax: v }))}
                color={C.primary}
                trackColor={C.border}
                thumbColor={C.surface}
              />
              <View style={s.edgeRow}>
                <Text style={s.edgeLabel}>6:00</Text>
                <Text style={s.edgeLabel}>12:00</Text>
              </View>
            </View>

            <View style={s.section}>
              <Text style={s.sectionLabel}>Run Length</Text>
              <View style={{ height: 10 }} />
              <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.inputLabel}>Min (mi)</Text>
                  <TextInput
                    style={s.numInput}
                    value={draft.distMin === 1 ? "" : draft.distMin.toString()}
                    onChangeText={(t) => {
                      const n = parseFloat(t);
                      setDraft((p) => ({ ...p, distMin: isNaN(n) ? 1 : Math.max(0.1, n) }));
                    }}
                    placeholder="e.g. 3"
                    placeholderTextColor={C.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>
                <Text style={{ color: C.textMuted, fontFamily: "Outfit_400Regular", fontSize: 14, marginTop: 18 }}>–</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.inputLabel}>Max (mi)</Text>
                  <TextInput
                    style={s.numInput}
                    value={draft.distMax === 200 ? "" : draft.distMax.toString()}
                    onChangeText={(t) => {
                      const n = parseFloat(t);
                      setDraft((p) => ({ ...p, distMax: isNaN(n) ? 200 : Math.min(200, n) }));
                    }}
                    placeholder="e.g. 10"
                    placeholderTextColor={C.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
            </View>

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
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleStyle(st); }}
                    >
                      {on && <Feather name="check" size={12} color={C.primary} style={{ marginRight: 4 }} />}
                      <Text style={[s.styleTxt, on && s.styleTxtOn]}>{st}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

          </ScrollView>

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
        </KeyboardAvoidingView>
      </Modal>

      <HostProfileSheet hostId={hostProfileId} onClose={() => setHostProfileId(null)} />

      {/* Floating path detail sheet — overlays the map with a tap-out backdrop */}
      {selectedCommunityPath && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Pressable style={s.pathFloatBackdrop} onPress={closePathCard} />
          <Animated.View
            style={[
              s.pathFloatSheet,
              {
                paddingBottom: insets.bottom + 16,
                maxHeight: WIN_H * 0.7,
                opacity: pathCardOpacity,
                transform: [{ translateY: pathSlideAnim }],
              },
            ]}
          >
            <View style={s.pathFloatHandle} />
            <View style={s.inlinePathHeader}>
              <Text style={s.pathSheetTitle} numberOfLines={2}>{selectedCommunityPath.name}</Text>
              <Pressable onPress={closePathCard} hitSlop={12}>
                <Feather name="x" size={22} color={C.textMuted} />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 6 }}
            >
              <View style={s.pathStatRow}>
                <View style={s.pathChip}>
                  <Feather name="move" size={14} color={C.primary} />
                  <Text style={s.pathChipTxt}>{toDisplayDist(selectedCommunityPath.distance_miles ?? 0, distUnit)}</Text>
                </View>
                <View style={[s.pathChip, { backgroundColor: C.primaryMuted + "55" }]}>
                  <Text style={[s.pathChipTxt, { color: C.primary, textTransform: "capitalize" }]}>
                    {selectedCommunityPath.activity_type ?? "run"}
                  </Text>
                </View>
                <View style={s.pathChip}>
                  <Feather name="users" size={13} color={C.textMuted} />
                  <Text style={s.pathChipTxt}>{selectedCommunityPath.run_count ?? 1}</Text>
                </View>
                <Pressable
                  style={({ pressed }) => [s.pathChip, { backgroundColor: C.primary, borderColor: C.primary, opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    const r = currentRegionRef.current;
                    const p: Record<string, string> = { parentPathId: selectedCommunityPath.id };
                    if (r) {
                      p.lat = String(r.latitude);
                      p.lng = String(r.longitude);
                      p.latDelta = String(r.latitudeDelta);
                      p.lngDelta = String(r.longitudeDelta);
                    }
                    router.push({ pathname: "/create-path", params: p });
                  }}
                >
                  <Feather name="plus" size={13} color={C.bg} />
                  <Text style={[s.pathChipTxt, { color: C.bg, fontFamily: "Outfit_700Bold" }]}>Route Option</Text>
                </Pressable>
              </View>

              {nearbyPaths.length > 0 && (
                <View style={{ marginBottom: 14 }}>
                  <Text style={[s.pathMutedTxt, { marginBottom: 8, fontWeight: "700", color: C.text }]}>
                    {nearbyPaths.length === 1 ? "Another route here" : "Other routes here"}
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 16 }}>
                    {nearbyPaths.map((np) => (
                      <Pressable
                        key={np.id}
                        onPress={() => { Haptics.selectionAsync(); openPathCard(np); }}
                        style={s.variantCard}
                      >
                        <VariantMiniMap pts={np.route_path} active={false} C={C} />
                        <Text style={s.variantCardName} numberOfLines={1}>{np.name}</Text>
                        <Text style={s.variantCardDist}>{toDisplayDist(np.distance_miles ?? 0, distUnit)}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}

              {(selectedCommunityPath.variants?.length ?? 0) > 0 && (
                <View style={{ marginBottom: 14 }}>
                  <Text style={[s.pathMutedTxt, { marginBottom: 8, fontWeight: "700", color: C.text }]}>Route options</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 16 }}>
                    {selectedCommunityPath.variants!.map((v) => {
                      const active = selectedVariantId === v.id;
                      return (
                        <Pressable
                          key={v.id}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setSelectedVariantId(active ? null : v.id);
                          }}
                          style={[s.variantCard, active && { borderColor: C.primary, borderWidth: 2 }]}
                        >
                          <VariantMiniMap pts={v.route_path} active={active} C={C} />
                          <Text style={s.variantCardName} numberOfLines={1}>{v.name}</Text>
                          <Text style={s.variantCardDist}>{toDisplayDist(v.distance_miles, distUnit)}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              )}
            </ScrollView>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <Pressable
                style={[s.pathStartBtn, { flex: 1 }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push("/run-tracking");
                }}
              >
                <Text style={s.pathStartBtnTxt}>Start Here</Text>
                <Feather name="play" size={18} color="#FFF" />
              </Pressable>
              <Pressable
                style={[s.pathStartBtn, { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14 }]}
                disabled={savingPathId === selectedCommunityPath.id}
                onPress={() => saveCommunityPathToMyRoutes(selectedCommunityPath)}
              >
                {savingPathId === selectedCommunityPath.id ? (
                  <ActivityIndicator size="small" color={C.primary} />
                ) : (
                  <>
                    <Feather name="bookmark" size={16} color={C.primary} />
                    <Text style={[s.pathStartBtnTxt, { color: C.primary }]}>Save</Text>
                  </>
                )}
              </Pressable>
            </View>
          </Animated.View>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeSStyles(C: ColorScheme) { return StyleSheet.create({
  container: { flex: 1, flexDirection: "column", backgroundColor: C.bg },

  header: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: C.bg,
  },
  headerRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    height: 44,
  },

  mapCard: {
    marginHorizontal: 10,
    marginBottom: 0,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
  },

  mapDim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.13)" },
  osmAttr: {
    position: "absolute",
    left: 8,
    bottom: 8,
    backgroundColor: "rgba(255,255,255,0.75)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  osmAttrTxt: { fontSize: 9, color: "#333" },

  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 36,
    paddingHorizontal: 11,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  backTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },

  headerRight: { flexDirection: "row", alignItems: "center" },
  filterBtn: {
    width: 38, height: 36,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  filterBtnActive: { borderColor: C.primary + "55", backgroundColor: C.primaryMuted + "AA" },
  filterDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: C.primary,
    position: "absolute", top: 5, right: 5,
  },

  sideBar: { position: "absolute", right: 12, top: 12, gap: 10, alignItems: "flex-end" },

  activityRail: {
    position: "absolute",
    right: 12,
    top: "30%",
    gap: 8,
    alignItems: "center",
  },
  activityRailBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  activityRailBtnActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },

  layerToggleGroup: {
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
    flexDirection: "column",
  },
  layerBtn: {
    width: 40,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.45,
  },
  layerBtnOn: {
    opacity: 1,
    backgroundColor: "rgba(255,255,255,0.12)",
  },

  busynessBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 10,
  },
  busynessDot: { width: 8, height: 8, borderRadius: 4 },
  busynessTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 12 },

  sideBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: C.surface, alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: C.borderLight,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10,
    elevation: 8,
  },
  sideBtnGreen: { backgroundColor: C.primary, borderColor: C.primary, shadowColor: C.primary, shadowOpacity: 0.5, shadowRadius: 12 },

  card: {
    position: "absolute", left: 16, right: 16,
    backgroundColor: C.surface, borderRadius: 22, padding: 16,
    borderWidth: 1, borderColor: C.border,
    shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 28,
    elevation: 24,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  cardAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: C.card, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: C.border,
  },
  cardAvatarImg: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.card },
  cardTitle: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },
  cardHost: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  topRatedChip: { backgroundColor: "#FFB80020", borderWidth: 1, borderColor: "#FFB80055", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  topRatedChipTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 10, color: "#FFB800" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 14 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: C.card, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6,
    borderWidth: 1, borderColor: C.border,
  },
  chipTag: { borderColor: C.primary + "44", backgroundColor: C.primaryMuted },
  chipTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.text },
  chipLive: { borderColor: C.primary + "55", backgroundColor: C.primaryMuted },
  chipLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.primary },
  cardAvatarLocked: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: C.card, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: C.border,
  },
  lockedHint: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10, marginTop: -6 },
  lockedHintTxt: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted, flex: 1 },
  joinBtn: {
    backgroundColor: C.primary, borderRadius: 14, height: 50,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  joinBtnGray: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  joinBtnPurple: { backgroundColor: "#7C3AED" },
  pathIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: "#7C3AED22", alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#7C3AED66",
  },
  chipCommunity: { borderColor: "#7C3AED55", backgroundColor: "#7C3AED15" },
  joinTxt: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.bg },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 12, paddingHorizontal: 24,
    borderTopWidth: 1, borderColor: C.border, maxHeight: "85%",
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginBottom: 16 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  sheetTitle: { fontFamily: "Outfit_700Bold", fontSize: 22, color: C.text },

  section: { marginBottom: 28 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  sectionLabel: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text },
  sectionValue: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.primary, marginBottom: 14 },
  edgeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingHorizontal: 2 },
  edgeLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },

  inputLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.textSecondary, marginBottom: 6 },
  numInput: {
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 11,
    fontFamily: "Outfit_400Regular", fontSize: 14, color: C.text,
  },

  styleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stylePill: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
  },
  stylePillOn: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  styleTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  styleTxtOn: { color: C.primary },

  sheetFooter: { flexDirection: "row", gap: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.border, marginTop: 8 },
  resetBtn: { flex: 1, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  resetTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.textSecondary },
  applyBtn: { flex: 2, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: C.primary },
  applyTxt: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.bg },

  miniStrip: { height: 86, justifyContent: "center" },
  splitStrip: {
    flexDirection: "column",
    backgroundColor: C.card,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  splitRow: {
    flexDirection: "row",
    height: 106,
    paddingTop: 10,
  },
  stackRow: {
    paddingTop: 6,
    paddingHorizontal: 10,
  },
  stackScroll: {
    gap: 8,
    paddingRight: 10,
  },
  splitCol: {
    flex: 1,
    paddingHorizontal: 10,
    gap: 5,
    overflow: "hidden",
  },
  splitColBorder: {
    borderRightWidth: 1,
    borderRightColor: C.border,
  },
  splitLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: C.textMuted,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  ghostCard: {
    height: 66,
    marginHorizontal: 0,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  ghostTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: C.textMuted,
  },
  pathMiniCard: {
    width: 130,
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
    height: 66,
    justifyContent: "center",
  },
  pathMiniTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pathMiniIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.primary + "22",
    alignItems: "center",
    justifyContent: "center",
  },
  pathMiniName: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: C.text,
    lineHeight: 14,
  },
  pathMiniDist: {
    fontFamily: "Outfit_400Regular",
    fontSize: 10,
    color: C.primary,
  },
  miniCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    width: 136,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 10,
    paddingVertical: 10,
    height: 70,
  },
  miniAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.primary + "44",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  miniAvatarImg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    flexShrink: 0,
  },
  miniAvatarTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 15,
    color: C.primary,
  },
  miniStatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  miniStatTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: C.textSecondary,
  },

  insightArea: { height: 54, justifyContent: "center" },
  insightScroll: { paddingHorizontal: 16, gap: 8, alignItems: "center" },
  insightPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.surface + "F2",
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: C.border,
  },
  insightTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 12 },

  /* Paths Mode Styles */
  modeToggle: {
    flexDirection: "row",
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 2,
    alignItems: "center",
  },
  modePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 18,
  },
  modePillActive: {
    backgroundColor: C.primary,
  },
  modePillText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.textMuted,
  },
  modePillTextActive: {
    color: "#FFF",
  },
  routeCountChip: {
    backgroundColor: C.card,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    alignSelf: "flex-end",
  },
  routeCountTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 10,
    color: "#FFF",
  },
  inlinePathSheet: {
    width: "100%",
  },
  pathFloatBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  pathFloatSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: C.border,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },
  pathFloatHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.border,
    marginBottom: 10,
  },
  inlinePathHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 10,
    gap: 10,
  },
  variantCard: {
    width: 120,
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 6,
    gap: 4,
  },
  variantCardName: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: C.text,
  },
  variantCardDist: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: C.primary,
  },
  pathSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 20,
    borderTopWidth: 1,
    borderColor: C.border,
  },
  pathSheetTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 24,
    color: C.text,
    marginBottom: 12,
    paddingRight: 30,
  },
  pathStatRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  pathChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  pathChipTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.text,
  },
  pathMutedTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.textMuted,
    marginBottom: 4,
  },
  pathStartBtn: {
    backgroundColor: C.primary,
    height: 56,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  pathStartBtnTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: "#FFF",
  },
  closeSheetBtn: {
    position: "absolute",
    top: 20,
    right: 20,
    zIndex: 10,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    position: "absolute",
    top: "30%",
    left: 40,
    right: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: C.border,
  },
  emptyTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 18,
    color: "#FFFFFF",
    textAlign: "center",
    marginBottom: 8,
  },
  emptySub: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: "rgba(255,255,255,0.75)",
    textAlign: "center",
  },
}); }
