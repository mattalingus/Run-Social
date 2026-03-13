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
  TextInput,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import MapView, { Marker, Polyline, Region } from "react-native-maps";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useActivity } from "@/contexts/ActivityContext";
import { useTheme } from "@/contexts/ThemeContext";
import { darkColors as C, type ColorScheme } from "@/constants/colors";
import RangeSlider from "@/components/RangeSlider";
import { formatDistance } from "@/lib/formatDistance";
import { toDisplayDist, toDisplayPace, unitLabel, type DistanceUnit } from "@/lib/units";
import HostProfileSheet from "@/components/HostProfileSheet";
import { getApiUrl } from "@/lib/query-client";

function resolveImgUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return new URL(url, getApiUrl()).toString();
}

// ─── Constants ────────────────────────────────────────────────────────────────

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

interface CommunityPath {
  id: string;
  name: string;
  route_path: Array<{ latitude: number; longitude: number }>;
  distance_miles: number | null;
  created_by_name?: string | null;
  run_count?: number;
  activity_type?: string;
  start_lat: number;
  start_lng: number;
  end_lat: number;
  end_lng: number;
}

interface Bounds {
  swLat: number; swLng: number; neLat: number; neLng: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function getPaceColor(minPace: number, maxPace: number, C: { orange: string; gold: string; primary: string }): string {
  if (maxPace >= 15 || (maxPace - minPace) >= 10) return C.primary;
  if (minPace < 6) return "#C0392B";
  if (minPace < 9) return C.orange;
  return C.gold;
}

// ─── Custom Marker ─────────────────────────────────────────────────────────

function LockedRunMarker({ run, isSelected, onPress }: { run: Run; isSelected: boolean; onPress: () => void }) {
  const { C } = useTheme();
  const mk = useMemo(() => makeMkStyles(C), [C]);
  const scale = useRef(new Animated.Value(1)).current;

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
      coordinate={{ latitude: run.location_lat, longitude: run.location_lng }}
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

function RunMarker({ run, isSelected, isFriend, onPress }: { run: Run; isSelected: boolean; isFriend?: boolean; onPress: () => void }) {
  const { C } = useTheme();
  const mk = useMemo(() => makeMkStyles(C), [C]);
  const scale = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(0.3)).current;
  const frozen = useRef(false);
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  const soon = isWithin24h(run.date);
  const isLiveNow = !!run.is_active && (run.participant_count ?? 0) > 0;
  const icon = run.host_marker_icon;
  const isEmojiIcon = !!icon && !icon.startsWith("http") && !icon.startsWith("/api/objects");
  const isUrlIcon = !!icon && (icon.startsWith("http") || icon.startsWith("/api/objects"));
  const crewPhoto = resolveImgUrl(run.crew_photo_url);
  const photoSrc = isUrlIcon ? icon : (crewPhoto || run.host_photo || avatarUrl(run.host_name));

  function freeze() {
    // Don't freeze live markers — animation requires tracksViewChanges=true
    if (isLiveNow) return;
    if (!frozen.current) {
      frozen.current = true;
      setTracksViewChanges(false);
    }
  }

  useEffect(() => {
    if (isEmojiIcon && !isLiveNow) { frozen.current = true; setTracksViewChanges(false); return; }
    if (!isLiveNow) {
      const t = setTimeout(freeze, 1500);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    if (isLiveNow) return;
    if (!isSelected) return;
    // Re-enable view tracking to prevent top-left flash during re-render
    frozen.current = false;
    setTracksViewChanges(true);
    Animated.spring(scale, { toValue: 1.15, useNativeDriver: true, tension: 400, friction: 10 }).start(() => {
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 12 }).start(() => {
        frozen.current = true;
        setTracksViewChanges(false);
      });
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
    // Unfreeze before onPress so the re-render from isSelected changing doesn't flash to top-left
    if (!isLiveNow) {
      frozen.current = false;
      setTracksViewChanges(true);
    }
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.3, useNativeDriver: true, tension: 500, friction: 8 }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 12 }),
    ]).start(() => {
      if (!isLiveNow) {
        frozen.current = true;
        setTracksViewChanges(false);
      }
    });
    onPress();
  }

  return (
    <Marker
      coordinate={{ latitude: run.location_lat, longitude: run.location_lng }}
      onPress={handlePress}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracksViewChanges}
    >
      <Animated.View style={[mk.wrap, { transform: [{ scale }] }]}>
        {soon && <View style={mk.glow} />}
        {isLiveNow && <Animated.View style={[mk.liveRing, { opacity: pulseAnim }]} />}
        <View style={[mk.circle, isFriend && mk.circleFriend, !!run.crew_id && mk.circleCrew, isSelected && mk.circleSelected]}>
          {isEmojiIcon ? (
            <Text style={mk.emoji}>{icon}</Text>
          ) : (
            <Image
              source={{ uri: photoSrc }}
              style={mk.img}
              onLoad={freeze}
            />
          )}
        </View>
        <View style={[mk.pin, isFriend && mk.pinFriend, !!run.crew_id && mk.pinCrew]} />
        {isLiveNow && (
          <View style={mk.liveBadge}>
            <Text style={mk.liveBadgeText}>LIVE</Text>
          </View>
        )}
      </Animated.View>
    </Marker>
  );
}

function makeMkStyles(C: ColorScheme) { return StyleSheet.create({
  wrap: { alignItems: "center", width: 62, height: 66 },
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
    shadowColor: C.textMuted, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.2, shadowRadius: 4,
    elevation: 10,
  },
  circleSelected: { borderColor: "#FFFFFF", shadowColor: C.primary, shadowOpacity: 1, shadowRadius: 16 },
  circleFriend: { borderColor: C.primary, shadowColor: C.primary, shadowOpacity: 0.6, shadowRadius: 10 },
  circleCrew: { borderColor: "#FFFFFF", shadowColor: "#FFFFFF", shadowOpacity: 0.45, shadowRadius: 8 },
  circleGray: { borderColor: "#444", shadowColor: "#000", shadowOpacity: 0.2 },
  circleGraySelected: { borderColor: "#888" },
  img: { width: "100%", height: "100%" },
  emoji: { fontSize: 26 },
  pin: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: C.textMuted, marginTop: 3,
    shadowColor: C.textMuted, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 3,
    elevation: 3,
  },
  pinFriend: { backgroundColor: C.primary, shadowColor: C.primary, shadowOpacity: 0.9, shadowRadius: 4 },
  pinCrew: { backgroundColor: "#FFFFFF", shadowColor: "#FFFFFF", shadowOpacity: 0.9, shadowRadius: 4 },
  pinGray: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#555", marginTop: 3 },
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
  const { activityFilter } = useActivity();
  const { C } = useTheme();
  const mk = useMemo(() => makeMkStyles(C), [C]);
  const s = useMemo(() => makeSStyles(C), [C]);
  const mapRef = useRef<MapView>(null);
  const params = useLocalSearchParams<{ styles?: string }>();

  const [userLoc, setUserLoc] = useState<{ latitude: number; longitude: number } | null>(null);
  const [mapMode, setMapMode] = useState<"runs" | "paths">("runs");
  const [locatedOnce, setLocatedOnce] = useState(false);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [selectedCommunityPath, setSelectedCommunityPath] = useState<CommunityPath | null>(null);
  const [hostProfileId, setHostProfileId] = useState<string | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(regionToBounds(HOUSTON));
  const boundsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pathSlideAnim = useRef(new Animated.Value(400)).current;
  const pathCardOpacity = useRef(new Animated.Value(0)).current;

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

  const communityPathsUrl = useMemo(() => {
    if (!bounds) return "/api/community-paths";
    const p = new URLSearchParams();
    p.set("swLat", bounds.swLat.toString());
    p.set("neLat", bounds.neLat.toString());
    p.set("swLng", bounds.swLng.toString());
    p.set("neLng", bounds.neLng.toString());
    return `/api/community-paths?${p.toString()}`;
  }, [bounds]);

  const { data: communityPathsData = [] } = useQuery<CommunityPath[]>({
    queryKey: [communityPathsUrl],
    staleTime: 120_000,
    placeholderData: (prev) => prev,
  });

  const communityPaths = useMemo(() => {
    return communityPathsData.map(path => ({
      ...path,
      route_path: typeof path.route_path === "string" ? JSON.parse(path.route_path) : path.route_path
    }));
  }, [communityPathsData]);

  // Only runs/rides matching the activity filter and visible in the map viewport
  const visibleRuns = useMemo(() => {
    if (!bounds) return [];
    return runs.filter((r) => {
      if ((r.activity_type ?? "run") !== activityFilter) return false;
      if (r.location_lat < bounds.swLat || r.location_lat > bounds.neLat) return false;
      if (r.location_lng < bounds.swLng || r.location_lng > bounds.neLng) return false;
      if (applied.visibility === "public" && (r.privacy !== "public" || !!r.crew_id)) return false;
      if (applied.visibility === "crew" && !r.crew_id) return false;
      if (applied.visibility === "friends" && (!!r.crew_id || r.privacy === "public")) return false;
      return true;
    });
  }, [runs, bounds, activityFilter, applied.visibility]);

  const insights = useMemo(() => {
    if (visibleRuns.length === 0) return [];
    const now = Date.now();
    const result: Array<{ icon: string; lib: "feather" | "ion"; text: string; color: string }> = [];

    const label = activityFilter === "ride" ? "ride" : "run";
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
    if (totalRunners > 0) result.push({ icon: "walk", lib: "ion", text: `${totalRunners} runner${totalRunners !== 1 ? "s" : ""} signed up`, color: C.primary });

    const fiveK = upcoming.filter((r) => r.min_distance <= 3.3 && r.max_distance >= 2.8);
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

  function onRegionChange(r: Region) {
    if (boundsTimer.current) clearTimeout(boundsTimer.current);
    boundsTimer.current = setTimeout(() => {
      setBounds(regionToBounds(r));
    }, 400);
  }

  function openCard(run: Run) {
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

  function openPathCard(path: CommunityPath) {
    if (selectedRun) closeCard();
    setSelectedCommunityPath(path);
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

          {/* Mode Toggle */}
          <View style={s.modeToggle}>
            <Pressable
              style={[s.modePill, mapMode === "runs" && s.modePillActive]}
              onPress={() => {
                setMapMode("runs");
                if (selectedCommunityPath) closePathCard();
              }}
            >
              <Feather name="list" size={12} color={mapMode === "runs" ? "#FFF" : C.textMuted} />
              <Text style={[s.modePillText, mapMode === "runs" && s.modePillTextActive]}>Runs</Text>
            </Pressable>
            <Pressable
              style={[s.modePill, mapMode === "paths" && s.modePillActive]}
              onPress={() => {
                setMapMode("paths");
                if (selectedRun) closeCard();
              }}
            >
              <Feather name="map" size={12} color={mapMode === "paths" ? "#FFF" : C.textMuted} />
              <Text style={[s.modePillText, mapMode === "paths" && s.modePillTextActive]}>Paths</Text>
            </Pressable>
          </View>

          <View style={s.headerRight}>
            {isFetching && <ActivityIndicator size="small" color={C.primary} style={{ marginRight: 6 }} />}
            {mapMode === "runs" && (
              <Pressable
                style={[s.filterBtn, isFiltered && s.filterBtnActive]}
                onPress={() => { setDraft({ ...applied }); setShowFilter(true); }}
              >
                <Feather name="sliders" size={16} color={isFiltered ? C.primary : C.textSecondary} />
                {isFiltered && <View style={s.filterDot} />}
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {/* ─── Map card ────────────────────────────────────────────────────── */}
      <View style={s.mapCard}>

        {/* Map */}
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
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
          onPress={() => { if (selectedRun) closeCard(); if (selectedCommunityPath) closePathCard(); }}
        >
          {mapMode === "paths" && (
            <>
              {communityPaths.map((path) => (
                <Polyline
                  key={path.id}
                  coordinates={path.route_path}
                  strokeColor={selectedCommunityPath?.id === path.id ? C.primary : "#00D97E"}
                  strokeWidth={4}
                  tappable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    openPathCard(path);
                  }}
                />
              ))}
            </>
          )}
          {mapMode === "runs" && visibleRuns.map((run) => (
            <RunMarker
              key={run.id}
              run={run}
              isSelected={selectedRun?.id === run.id}
              isFriend={friendIdSet.has(run.host_id)}
              onPress={() => openCard(run)}
            />
          ))}
        </MapView>

        {/* Dim overlay */}
        <View style={s.mapDim} pointerEvents="none" />


        {/* ─── Empty State (inside map card) ────────────────────────────────── */}
        {mapMode === "paths" && communityPaths.length === 0 && (
          <View style={s.emptyState}>
            <View style={s.emptyCircle}>
              <Feather name="map" size={32} color={C.textMuted} />
            </View>
            <Text style={s.emptyTitle}>No community routes here yet</Text>
            <Text style={s.emptySub}>Finish an activity and publish your first!</Text>
          </View>
        )}

        {/* ─── Sidebar (inside map card) ────────────────────────────────── */}
        <View style={s.sideBar}>
          {mapMode === "paths" && communityPaths.length > 0 && (
            <View style={s.routeCountChip}>
              <Text style={s.routeCountTxt}>{communityPaths.length} routes</Text>
            </View>
          )}
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
                router.push({ pathname: "/create-run", params: { activityType: activityFilter } });
              }}
            >
              <Feather name="plus" size={20} color={C.bg} />
            </Pressable>
          )}
        </View>

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
                  <Ionicons name="walk" size={11} color={getPaceColor(selectedRun.min_pace, selectedRun.max_pace, C)} />
                  <Text style={[s.chipTxt, { color: getPaceColor(selectedRun.min_pace, selectedRun.max_pace, C) }]}>
                    {selectedRun.min_pace === selectedRun.max_pace ? toDisplayPace(selectedRun.min_pace, distUnit) : `${toDisplayPace(selectedRun.min_pace, distUnit)}–${toDisplayPace(selectedRun.max_pace, distUnit)}`}
                  </Text>
                </View>
                <View style={s.chip}>
                  <Feather name="map" size={11} color={C.blue} />
                  <Text style={[s.chipTxt, { color: C.blue }]}>
                    {selectedRun.min_distance === selectedRun.max_distance ? toDisplayDist(selectedRun.min_distance, distUnit) : `${toDisplayDist(selectedRun.min_distance, distUnit)}–${toDisplayDist(selectedRun.max_distance, distUnit)}`}
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
                      : selectedRun.crew_id
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
                <Text style={s.joinTxt}>{selectedRun.activity_type === "ride" ? "View Ride" : "View Run"}</Text>
                <Feather name="arrow-right" size={16} color={C.bg} />
              </Pressable>
            </>
          )}
          </Animated.View>
        )}

        {/* ─── Community Path Card ──────────────────────────────────────── */}
        {selectedCommunityPath && (
          <Animated.View
            style={[
              s.pathSheet,
              { bottom: 0, opacity: pathCardOpacity, transform: [{ translateY: pathSlideAnim }] },
            ]}
          >
            <Pressable style={s.closeSheetBtn} onPress={closePathCard}>
              <Feather name="x" size={20} color={C.textMuted} />
            </Pressable>
            
            <Text style={s.pathSheetTitle}>{selectedCommunityPath.name}</Text>
            
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
            </View>

            <View style={{ marginBottom: 20 }}>
              <Text style={s.pathMutedTxt}>Created by {selectedCommunityPath.created_by_name || "Community Member"}</Text>
              <Text style={s.pathMutedTxt}>Run count: {selectedCommunityPath.run_count ?? 1}</Text>
            </View>

            <Pressable
              style={s.pathStartBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                router.push("/run-tracking");
              }}
            >
              <Text style={s.pathStartBtnTxt}>Start Run Here</Text>
              <Feather name="play" size={18} color="#FFF" />
            </Pressable>
          </Animated.View>
        )}

      </View>{/* ── end mapCard ──────────────────────────────────────────────── */}

      {/* ─── Mini run cards strip — always reserves space so map never resizes */}
      <View style={s.miniStrip}>
        {mapMode === "runs" && !selectedRun && !selectedCommunityPath && visibleRuns.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 12, gap: 8, alignItems: "center" }}
          >
            {visibleRuns.map((run) => (
              <Pressable
                key={run.id}
                style={({ pressed }) => [s.miniCard, { opacity: pressed ? 0.8 : 1 }]}
                onPress={() => openCard(run)}
              >
                {run.host_marker_icon ? (
                  <View style={s.miniAvatar}>
                    <Text style={{ fontSize: 18 }}>{run.host_marker_icon}</Text>
                  </View>
                ) : resolveImgUrl(run.crew_photo_url) || run.host_photo ? (
                  <Image source={{ uri: resolveImgUrl(run.crew_photo_url) || run.host_photo! }} style={s.miniAvatarImg} />
                ) : (
                  <View style={s.miniAvatar}>
                    <Text style={s.miniAvatarTxt}>{run.host_name?.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={s.miniStatRow}>
                    <Feather name="map" size={10} color={C.primary} />
                    <Text style={s.miniStatTxt}>{toDisplayDist(run.min_distance, distUnit)}</Text>
                  </View>
                  <View style={s.miniStatRow}>
                    <Feather name="zap" size={10} color="#F4C542" />
                    <Text style={[s.miniStatTxt, { color: "#F4C542" }]}>{toDisplayPace(run.min_pace, distUnit)}</Text>
                  </View>
                  <View style={s.miniStatRow}>
                    <Feather name="users" size={10} color={C.textSecondary} />
                    <Text style={[s.miniStatTxt, { color: C.textSecondary }]}>
                      {run.crew_id
                        ? `${run.participant_count} going`
                        : `${run.participant_count}/${run.max_participants}`}
                    </Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>

      {/* ─── Insights strip (below map card, fixed height so map never jumps) */}
      <View style={[s.insightArea, { marginBottom: insets.bottom + 4 }]}>
        {mapMode === "runs" && insights.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.insightScroll}
          >
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
    flex: 1,
    marginHorizontal: 10,
    marginBottom: 0,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
  },

  mapDim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.13)" },

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

  sideBar: { position: "absolute", right: 12, top: 12, gap: 10 },
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
