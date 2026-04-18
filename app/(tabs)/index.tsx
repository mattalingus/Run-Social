import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Modal,
  ScrollView,
  Switch,
  Alert,
  Image,
  Animated,
  useWindowDimensions,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import Svg, { Polyline as SvgPolyline } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MapView, { Marker, Polyline } from "react-native-maps";
import MAP_STYLE from "@/lib/mapStyle";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/contexts/ThemeContext";
import { darkColors as C, type ColorScheme } from "@/constants/colors";
import RangeSlider from "@/components/RangeSlider";
import { formatDistance } from "@/lib/formatDistance";
import { toDisplayDist, toDisplayPace, unitLabel, type DistanceUnit } from "@/lib/units";
import { useAuth } from "@/contexts/AuthContext";
import { useActivity } from "@/contexts/ActivityContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { onOpenNotifications } from "@/contexts/NotificationBannerContext";
import WebFAB from "@/components/WebFAB";
import WalkthroughPulse from "@/components/WalkthroughPulse";
import { useWalkthrough } from "@/contexts/WalkthroughContext";
import MiniCalendarPicker from "@/components/MiniCalendarPicker";
import SharedPathPreviewModal from "@/components/SharedPathPreviewModal";
import { formatEventDateTime } from "@/lib/formatDate";

function formatDaysAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  return `${diffDays} days ago`;
}

function resolveImgUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return new URL(url, getApiUrl()).toString();
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PACE_STEP = 5 / 60; // 5-second increments

type SortOption = "nearest" | "soonest";

const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: "nearest", label: "Nearest" },
  { key: "soonest", label: "Soonest" },
];

const HOST_STYLES = [
  "Easy Pace", "Beginner Friendly", "No-Drop", "Recovery", "Long Run", "Long Ride", "PR Chaser", "Tempo", "Intervals",
  "Talkative", "Headphones OK", "Motivational", "Social After",
  "Women", "Men", "Co-Ed", "Young Adult", "College", "Seniors", "All Ages", "Middle Aged",
  "Dog Friendly", "Stroller Friendly", "Walk-Run", "Walk-Ride", "Run & Coffee", "Ride & Coffee",
  "Morning Run", "Morning Ride", "Sunrise Run", "Sunrise Ride", "Sunset Run", "Sunset Ride", "Lunch Run", "Lunch Ride", "Night Run", "Night Ride",
  "Trail", "Road", "Park Loop",
];

const RUN_STYLE_CATEGORIES_RUN = [
  { label: "Effort",      options: ["Easy Pace", "Beginner Friendly", "No-Drop", "Recovery", "Long Run", "PR Chaser", "Tempo", "Intervals"] },
  { label: "Social",      options: ["Talkative", "Headphones OK", "Motivational", "Social After"] },
  { label: "Community",   options: ["Women", "Men", "Co-Ed", "Young Adult", "College", "Seniors", "All Ages", "Middle Aged"] },
  { label: "Lifestyle",   options: ["Dog Friendly", "Stroller Friendly", "Walk-Run", "Run & Coffee"] },
  { label: "Time of Day", options: ["Morning Run", "Sunrise Run", "Sunset Run", "Lunch Run", "Night Run"] },
  { label: "Terrain",     options: ["Trail", "Road", "Park Loop"] },
];
const RUN_STYLE_CATEGORIES_RIDE = [
  { label: "Effort",      options: ["Easy Pace", "Beginner Friendly", "No-Drop", "Recovery", "Long Ride", "PR Chaser", "Tempo", "Intervals"] },
  { label: "Social",      options: ["Talkative", "Headphones OK", "Motivational", "Social After"] },
  { label: "Community",   options: ["Women", "Men", "Co-Ed", "Young Adult", "College", "Seniors", "All Ages", "Middle Aged"] },
  { label: "Lifestyle",   options: ["Dog Friendly", "Stroller Friendly", "Walk-Ride", "Ride & Coffee"] },
  { label: "Time of Day", options: ["Morning Ride", "Sunrise Ride", "Sunset Ride", "Lunch Ride", "Night Ride"] },
  { label: "Terrain",     options: ["Trail", "Road", "Park Loop"] },
];
const RUN_STYLE_CATEGORIES_WALK = [
  { label: "Effort",      options: ["Easy Pace", "Beginner Friendly", "No-Drop", "Recovery", "Long Walk", "Social Walk", "Power Walk", "Intervals"] },
  { label: "Social",      options: ["Talkative", "Headphones OK", "Motivational", "Social After"] },
  { label: "Community",   options: ["Women", "Men", "Co-Ed", "Young Adult", "College", "Seniors", "All Ages", "Stroller Friendly", "Dog Friendly", "Middle Aged"] },
  { label: "Time of Day", options: ["Morning Walk", "Sunrise Walk", "Sunset Walk", "Lunch Walk", "Night Walk"] },
  { label: "Terrain",     options: ["Trail", "Road", "Park Loop"] },
];

const TAG_CATEGORY_ORDER: string[] = [
  "Easy Pace", "Beginner Friendly", "No-Drop", "Recovery", "Long Run", "Long Ride", "Long Walk", "PR Chaser", "Tempo", "Intervals", "Power Walk", "Social Walk",
  "Talkative", "Headphones OK", "Motivational", "Social After",
  "Women", "Men", "Co-Ed", "Young Adult", "College", "Seniors", "All Ages", "Middle Aged",
  "Dog Friendly", "Stroller Friendly", "Walk-Run", "Walk-Ride", "Run & Coffee", "Ride & Coffee",
  "Morning Run", "Morning Ride", "Morning Walk", "Sunrise Run", "Sunrise Ride", "Sunrise Walk",
  "Sunset Run", "Sunset Ride", "Sunset Walk", "Lunch Run", "Lunch Ride", "Lunch Walk",
  "Night Run", "Night Ride", "Night Walk",
  "Trail", "Road", "Park Loop",
];

function sortTagsByCategory(tags: string[]): string[] {
  return [...tags].sort((a, b) => {
    const ai = TAG_CATEGORY_ORDER.indexOf(a);
    const bi = TAG_CATEGORY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}
const PROX_STEPS  = [1, 5, 10, 25, 50, 100, 250]; // miles (null = Nationwide)
// Cascade tiers for auto-proximity expansion (miles; -1 = same-state; null = nationwide)
const CASCADE_TIERS: (number | null)[] = [10, 25, 50, 100, 250, -1, null];

const US_STATE_ABBR: Record<string, string> = {
  "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA",
  "Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA",
  "Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS",
  "Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA",
  "Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT",
  "Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM",
  "New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK",
  "Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD",
  "Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA",
  "West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY","District of Columbia":"DC",
  "Puerto Rico":"PR",
};
const US_ABBR_STATE: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATE_ABBR).map(([name, abbr]) => [abbr, name])
);

function normalizeStateToAbbr(s: string): string | null {
  const t = s.trim();
  const upper = t.toUpperCase();
  if (US_ABBR_STATE[upper]) return upper;
  const full = Object.keys(US_STATE_ABBR).find((name) => name.toLowerCase() === t.toLowerCase());
  if (full) return US_STATE_ABBR[full];
  return null;
}

function extractRunState(locationName: string): string | null {
  const parts = locationName.split(",").map((p) => p.trim());
  for (let i = parts.length - 1; i >= 0; i--) {
    const norm = normalizeStateToAbbr(parts[i]);
    if (norm) return norm;
  }
  return null;
}

interface FilterState {
  paceMin: number;
  paceMax: number;
  distMin: number;
  distMax: number;
  maxDistFromMe: number | null;
  styles: string[];
  visibility: "all" | "public" | "crew" | "friends";
  days: string[];
  times: string[];
}

const DEFAULT_FILTERS: FilterState = {
  paceMin: 4.0,
  paceMax: 15.0,
  distMin: 0,
  distMax: 999,
  maxDistFromMe: 10,
  styles: [],
  visibility: "all",
  days: [],
  times: [],
};

// ─── Run interface ────────────────────────────────────────────────────────────

interface Run {
  id: string;
  title: string;
  host_id: string;
  host_name: string;
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
  privacy: string;
  host_hosted_runs?: number;
  host_photo?: string;
  crew_photo_url?: string | null;
  is_active?: boolean;
  is_completed?: boolean;
  run_style?: string;
  activity_type?: string;
  crew_id?: string | null;
  crew_name?: string | null;
  crew_emoji?: string | null;
  pace_groups?: { label: string; minPace: number; maxPace: number }[] | null;
  plan_count?: string;
  user_is_crew_member?: boolean;
  timezone?: string | null;
}

// ─── Route thumbnail helpers ──────────────────────────────────────────────────

type RoutePoint = { latitude: number; longitude: number };

function normalizeRouteThumb(pts: RoutePoint[], w: number, h: number): string {
  if (pts.length < 2) return "";
  const lats = pts.map(p => p.latitude);
  const lngs = pts.map(p => p.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const pad = 8;
  const rngLat = maxLat - minLat || 0.001;
  const rngLng = maxLng - minLng || 0.001;
  return pts.map(p => {
    const x = pad + ((p.longitude - minLng) / rngLng) * (w - pad * 2);
    const y = (h - pad) - ((p.latitude - minLat) / rngLat) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function RouteThumb({ path, primary, size = 56 }: { path: RoutePoint[] | null; primary: string; size?: number }) {
  const pts = normalizeRouteThumb(path || [], size, size);
  return (
    <View style={{ width: size, height: size, borderRadius: 10, backgroundColor: "#0D1510", overflow: "hidden", borderWidth: 1, borderColor: primary + "33", alignItems: "center", justifyContent: "center" }}>
      {pts ? (
        <Svg width={size} height={size}>
          <SvgPolyline points={pts} fill="none" stroke={primary + "50"} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
          <SvgPolyline points={pts} fill="none" stroke={primary} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      ) : (
        <Feather name="map" size={20} color={primary + "40"} />
      )}
    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getHostBadge(hostedRuns?: number): { label: string; color: string } | null {
  if (!hostedRuns || hostedRuns < 1) return null;
  if (hostedRuns === 1) return { label: "1st Run", color: "#A0C4FF" };
  if (hostedRuns < 5)   return { label: "Bronze",  color: "#CD7F32" };
  if (hostedRuns < 20)  return { label: "Silver",  color: "#9E9E9E" };
  if (hostedRuns < 100) return { label: "Gold",    color: "#FFD700" };
  if (hostedRuns < 500) return { label: "Platinum", color: "#B0E0E6" };
  return { label: "Elite", color: "#C084FC" };
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toR = (v: number) => (v * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatPace(pace: number) {
  let mins = Math.floor(pace);
  let secs = Math.round((pace - mins) * 60);
  if (secs === 60) { secs = 0; mins += 1; }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function getPaceColor(minPace: number, maxPace: number, C: { orange: string; gold: string; primary: string }): string {
  if (maxPace >= 15 || (maxPace - minPace) >= 10) return C.primary;
  if (minPace < 6) return "#C0392B";
  if (minPace < 9) return C.orange;
  return C.gold;
}

// ─── Filter Modal ─────────────────────────────────────────────────────────────

interface FilterModalProps {
  visible: boolean;
  onClose: () => void;
  draft: FilterState;
  setDraft: React.Dispatch<React.SetStateAction<FilterState>>;
  onApply: () => void;
  onReset: () => void;
  userLocation: { latitude: number; longitude: number } | null;
  sortOption: SortOption;
  setSortOption: (s: SortOption) => void;
  onDistanceTouched: () => void;
}

function FilterModal({ visible, onClose, draft, setDraft, onApply, onReset, userLocation, sortOption, setSortOption, onDistanceTouched }: FilterModalProps) {
  const { C } = useTheme();
  const fm = useMemo(() => makeFmStyles(C), [C]);
  const insets = useSafeAreaInsets();
  const { activityFilter } = useActivity();
  const { user: fmUser } = useAuth();
  const distUnit: DistanceUnit = ((fmUser as any)?.distance_unit ?? "miles") as DistanceUnit;

  function toggleStyle(s: string) {
    setDraft((p) => ({
      ...p,
      styles: p.styles.includes(s) ? p.styles.filter((x) => x !== s) : [...p.styles, s],
    }));
  }

  function toggleDay(d: string) {
    setDraft((p) => {
      const days = p.days ?? [];
      return { ...p, days: days.includes(d) ? days.filter((x) => x !== d) : [...days, d] };
    });
  }

  function toggleTime(t: string) {
    setDraft((p) => {
      const times = p.times ?? [];
      return { ...p, times: times.includes(t) ? times.filter((x) => x !== t) : [...times, t] };
    });
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={fm.overlay} onPress={onClose} />
      <View style={[fm.sheet, { paddingBottom: insets.bottom + 16 }]}>
        {/* Handle + header */}
        <View style={fm.handle} />
        <View style={fm.header}>
          <Text style={fm.title}>Filters</Text>
          <Pressable onPress={onClose} hitSlop={12} style={fm.closeBtn}>
            <Feather name="x" size={18} color={C.textSecondary} />
          </Pressable>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={fm.scrollContent}
          bounces={false}
        >
          {/* ── Sort by ─────────────────────────────────────────────────── */}
          <View style={fm.section}>
            <Text style={fm.sectionTitle}>Sort by</Text>
            <View style={fm.proxRow}>
              {SORT_OPTIONS.map((opt) => {
                const active = sortOption === opt.key;
                const labels: Record<string, string> = {
                  soonest: "Soonest",
                  nearest: "Nearest",
                };
                return (
                  <Pressable
                    key={opt.key}
                    style={[fm.proxChip, active && fm.proxChipActive]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setSortOption(opt.key);
                    }}
                  >
                    <Text style={[fm.proxChipTxt, active && fm.proxChipTxtActive]}>
                      {labels[opt.key] || opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={fm.divider} />

          {/* ── A. Visibility ────────────────────────────────────────────── */}
          <View style={fm.section}>
            <Text style={fm.sectionTitle}>View</Text>
            <View style={fm.proxRow}>
              {(["all", "public", "crew", "friends"] as const).map((opt) => {
                const labels = { all: "All", public: "Public", crew: "Crew", friends: "Friends" };
                const active = draft.visibility === opt;
                return (
                  <Pressable
                    key={opt}
                    style={[fm.proxChip, active && fm.proxChipActive]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setDraft((p) => ({ ...p, visibility: opt }));
                    }}
                  >
                    <Text style={[fm.proxChipTxt, active && fm.proxChipTxtActive]}>
                      {labels[opt]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={fm.divider} />

          {/* ── B. Pace ─────────────────────────────────────────────────── */}
          <View style={fm.section}>
            <View style={fm.sectionHead}>
              <Text style={fm.sectionTitle}>Pace</Text>
              <Text style={fm.sectionValue}>
                {toDisplayPace(draft.paceMin, distUnit)} – {toDisplayPace(draft.paceMax, distUnit)}
              </Text>
            </View>
            {(() => {
              const MI_TO_KM = 1 / 1.60934;
              const toSlider = (mi: number) => distUnit === "km" ? mi * MI_TO_KM : mi;
              const fromSlider = (v: number) => distUnit === "km" ? v / MI_TO_KM : v;
              return (
                <>
                  <RangeSlider
                    min={toSlider(4)} max={toSlider(15)} step={PACE_STEP}
                    low={toSlider(draft.paceMin)} high={toSlider(draft.paceMax)}
                    onLowChange={(v) => setDraft((p) => ({ ...p, paceMin: fromSlider(v) }))}
                    onHighChange={(v) => setDraft((p) => ({ ...p, paceMax: fromSlider(v) }))}
                    color={C.primary}
                    trackColor={C.border}
                  />
                  <View style={fm.edgeRow}>
                    <Text style={fm.edgeLabel}>{toDisplayPace(4, distUnit)}</Text>
                    <Text style={fm.edgeLabel}>{toDisplayPace(15, distUnit)}</Text>
                  </View>
                </>
              );
            })()}
          </View>

          <View style={fm.divider} />

          {/* ── B. Distance (Run length) ────────────────────────────────── */}
          <View style={fm.section}>
            <Text style={fm.sectionTitle}>{activityFilter === "ride" ? "Ride Length" : activityFilter === "walk" ? "Walk Length" : "Run Length"}</Text>
            <View style={fm.distRow}>
              <View style={fm.distField}>
                <Text style={fm.distLabel}>Min (mi)</Text>
                <TextInput
                  style={fm.distInput}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={C.textMuted}
                  value={draft.distMin === DEFAULT_FILTERS.distMin ? "" : String(draft.distMin)}
                  onChangeText={(t) => {
                    const n = parseFloat(t);
                    setDraft((p) => ({ ...p, distMin: t === "" ? 0 : (Number.isFinite(n) && n >= 0 ? n : p.distMin) }));
                  }}
                  returnKeyType="done"
                />
              </View>
              <Text style={fm.distSep}>–</Text>
              <View style={fm.distField}>
                <Text style={fm.distLabel}>Max (mi)</Text>
                <TextInput
                  style={fm.distInput}
                  keyboardType="decimal-pad"
                  placeholder="No limit"
                  placeholderTextColor={C.textMuted}
                  value={draft.distMax >= 999 ? "" : String(draft.distMax)}
                  onChangeText={(t) => {
                    const n = parseFloat(t);
                    setDraft((p) => ({ ...p, distMax: t === "" ? 999 : (Number.isFinite(n) && n > 0 ? n : p.distMax) }));
                  }}
                  returnKeyType="done"
                />
              </View>
            </View>
          </View>

          <View style={fm.divider} />

          {/* ── C. Distance From Me ─────────────────────────────────────── */}
          <View style={fm.section}>
            <View style={fm.sectionHead}>
              <Text style={fm.sectionTitle}>Distance From Me</Text>
              {!userLocation && (
                <View style={fm.noLocBadge}>
                  <Feather name="map-pin" size={10} color={C.textMuted} />
                  <Text style={fm.noLocTxt}>Location off</Text>
                </View>
              )}
            </View>
            <View style={fm.proxRow}>
              {PROX_STEPS.map((mi) => (
                <Pressable
                  key={mi}
                  style={[
                    fm.proxChip,
                    draft.maxDistFromMe === mi && fm.proxChipActive,
                    !userLocation && fm.proxChipDisabled,
                  ]}
                  onPress={() => {
                    if (!userLocation) return;
                    Haptics.selectionAsync();
                    onDistanceTouched();
                    setDraft((p) => ({ ...p, maxDistFromMe: mi }));
                  }}
                  disabled={!userLocation}
                >
                  <Text
                    style={[
                      fm.proxChipTxt,
                      draft.maxDistFromMe === mi && fm.proxChipTxtActive,
                      !userLocation && fm.proxChipTxtDisabled,
                    ]}
                  >
                    {toDisplayDist(mi, distUnit)}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                style={[fm.proxChip, draft.maxDistFromMe === null && fm.proxChipActive, !userLocation && fm.proxChipDisabled]}
                onPress={() => {
                  if (!userLocation) return;
                  Haptics.selectionAsync();
                  onDistanceTouched();
                  setDraft((p) => ({ ...p, maxDistFromMe: null }));
                }}
                disabled={!userLocation}
              >
                <Text style={[fm.proxChipTxt, draft.maxDistFromMe === null && fm.proxChipTxtActive, !userLocation && fm.proxChipTxtDisabled]}>
                  Nationwide
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={fm.divider} />

          {/* ── D. Host Style ────────────────────────────────────────────── */}
          <View style={fm.section}>
            <Text style={fm.sectionTitle}>Host Style</Text>
            {(activityFilter === "ride" ? RUN_STYLE_CATEGORIES_RIDE : activityFilter === "walk" ? RUN_STYLE_CATEGORIES_WALK : RUN_STYLE_CATEGORIES_RUN).map((cat) => (
              <View key={cat.label} style={{ marginTop: 14 }}>
                <Text style={fm.catLabel}>{cat.label}</Text>
                <View style={[fm.styleGrid, { marginTop: 8 }]}>
                  {cat.options.map((style) => {
                    const active = draft.styles.includes(style);
                    return (
                      <Pressable
                        key={style}
                        style={[fm.stylePill, active && fm.stylePillActive]}
                        onPress={() => { Haptics.selectionAsync(); toggleStyle(style); }}
                      >
                        {active && (
                          <Feather name="check" size={11} color={C.primary} style={{ marginRight: 4 }} />
                        )}
                        <Text style={[fm.stylePillTxt, active && fm.stylePillTxtActive]}>{style}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>

          <View style={fm.divider} />

          {/* ── F. Day of Week ──────────────────────────────────────────── */}
          <View style={fm.section}>
            <Text style={fm.sectionTitle}>Day of Week</Text>
            <View style={[fm.proxRow, { flexWrap: "wrap" }]}>
              {(["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] as const).map((d) => {
                const active = (draft.days ?? []).includes(d);
                return (
                  <Pressable
                    key={d}
                    style={[fm.proxChip, active && fm.proxChipActive, { minWidth: 40 }]}
                    onPress={() => { Haptics.selectionAsync(); toggleDay(d); }}
                  >
                    <Text style={[fm.proxChipTxt, active && fm.proxChipTxtActive]}>{d}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={fm.divider} />

          {/* ── G. Time of Day ──────────────────────────────────────────── */}
          <View style={fm.section}>
            <Text style={fm.sectionTitle}>Time of Day</Text>
            <View style={fm.proxRow}>
              {(["Morning","Afternoon","Evening","Night"] as const).map((t) => {
                const active = (draft.times ?? []).includes(t);
                return (
                  <Pressable
                    key={t}
                    style={[fm.proxChip, active && fm.proxChipActive]}
                    onPress={() => { Haptics.selectionAsync(); toggleTime(t); }}
                  >
                    <Text style={[fm.proxChipTxt, active && fm.proxChipTxtActive]}>{t}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ScrollView>

        {/* Footer buttons */}
        <View style={fm.footer}>
          <Pressable
            style={fm.resetBtn}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onReset(); }}
          >
            <Text style={fm.resetTxt}>Reset</Text>
          </Pressable>
          <Pressable
            style={fm.applyBtn}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onApply(); }}
          >
            <Text style={fm.applyTxt}>Apply Filters</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ─── Live Card Expansion ──────────────────────────────────────────────────────

const LIVE_DOT_COLORS = ["#FF6B6B","#4ECDC4","#FFE66D","#A855F7","#F97316","#38BDF8","#FB7185"];

function LiveCardExpansion({ runId }: { runId: string }) {
  const { C, theme } = useTheme();
  const { data: liveData } = useQuery<any>({
    queryKey: ["/api/runs", runId, "live"],
    queryFn: async () => { const r = await apiRequest("GET", `/api/runs/${runId}/live`); return r.json(); },
    refetchInterval: 5000,
    staleTime: 0,
  });
  const { data: pathData } = useQuery<any>({
    queryKey: ["/api/runs", runId, "tracking-path"],
    queryFn: async () => { const r = await apiRequest("GET", `/api/runs/${runId}/tracking-path`); return r.json(); },
    refetchInterval: 10000,
    staleTime: 0,
  });
  const participants: any[] = liveData?.participants ?? [];
  const present = participants.filter((p) => p.is_present && p.latitude && p.longitude);
  const presentCount: number = liveData?.presentCount ?? 0;
  const path: { latitude: number; longitude: number }[] = Array.isArray(pathData?.path) ? pathData.path : [];
  const avgDist = present.length > 0
    ? present.reduce((s: number, p: any) => s + (p.cumulative_distance ?? 0), 0) / present.length : 0;
  const validPaces = present.filter((p: any) => (p.current_pace ?? 0) > 0).map((p: any) => p.current_pace);
  const leadPace = validPaces.length > 0 ? Math.min(...validPaces) : 0;
  const startCoord = path.length > 0 ? path[0] : null;
  const initialRegion = startCoord
    ? { latitude: startCoord.latitude, longitude: startCoord.longitude, latitudeDelta: 0.012, longitudeDelta: 0.012 }
    : undefined;

  const fmtPace = (p: number) => {
    let m = Math.floor(p); let s = Math.round((p - m) * 60);
    if (s === 60) { s = 0; m += 1; }
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <View style={{ backgroundColor: C.surface, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, overflow: "hidden", marginTop: -2, borderWidth: 1, borderTopWidth: 0, borderColor: C.border }}>
      {Platform.OS !== "web" ? (
        <MapView
          style={{ height: 180, pointerEvents: "none" as any }}
          customMapStyle={theme === "dark" ? MAP_STYLE : []}
          initialRegion={initialRegion}
          scrollEnabled={false}
          zoomEnabled={false}
          pitchEnabled={false}
          rotateEnabled={false}
          showsUserLocation={false}
        >
          {path.length > 1 && <Polyline coordinates={path} strokeColor="#00D97E" strokeWidth={3} />}
          {present.map((p: any, i: number) => (
            <Marker key={p.user_id} coordinate={{ latitude: p.latitude, longitude: p.longitude }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: LIVE_DOT_COLORS[i % LIVE_DOT_COLORS.length], alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" }}>
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 10, color: "#fff" }}>{p.name?.[0]?.toUpperCase() ?? "?"}</Text>
              </View>
            </Marker>
          ))}
        </MapView>
      ) : (
        <View style={{ height: 90, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textMuted }}>Open on mobile to watch live</Text>
        </View>
      )}
      <View style={{ flexDirection: "row", paddingVertical: 12, paddingHorizontal: 8, borderTopWidth: 1, borderColor: C.border }}>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text }}>{presentCount}</Text>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted }}>in</Text>
        </View>
        <View style={{ width: 1, backgroundColor: C.border, marginVertical: 4 }} />
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text }}>{avgDist.toFixed(2)}</Text>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted }}>avg mi</Text>
        </View>
        <View style={{ width: 1, backgroundColor: C.border, marginVertical: 4 }} />
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text }}>{leadPace > 0 ? fmtPace(leadPace) : "--:--"}</Text>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted }}>lead pace</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Live Card Pulse Wrapper ──────────────────────────────────────────────────

function LiveCardPulseWrapper({
  isLive,
  isExpanded,
  children,
}: {
  isLive: boolean;
  isExpanded: boolean;
  children: React.ReactNode;
}) {
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (!isLive) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.15, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isLive]);

  return (
    <View style={{ position: "relative" }}>
      {isLive && (
        <Animated.View
          style={{
            position: "absolute",
            top: -2, left: -2, right: -2, bottom: -2,
            borderRadius: 16,
            borderBottomLeftRadius: isExpanded ? 14 : 16,
            borderBottomRightRadius: isExpanded ? 14 : 16,
            borderWidth: 2,
            borderColor: "#C0392B",
            shadowColor: "#C0392B",
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 1,
            shadowRadius: 10,
            opacity: pulseAnim,
          }}
          pointerEvents="none"
        />
      )}
      {children}
    </View>
  );
}

// ─── Weather helpers ──────────────────────────────────────────────────────────

function wmoToEmoji(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 3) return "⛅";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 57) return "🌦️";
  if (code >= 61 && code <= 67) return "🌧️";
  if (code >= 71 && code <= 77) return "🌨️";
  if (code >= 80 && code <= 82) return "🌦️";
  if (code === 85 || code === 86) return "🌨️";
  if (code >= 95) return "⛈️";
  return "🌡️";
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function useEventWeather(lat: number, lng: number, eventDateStr: string) {
  const eventDate = new Date(eventDateStr);
  const now = new Date();
  const diffDays = (eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  const dateStr = toDateStr(eventDate);
  const eventHour = eventDate.getHours();

  return useQuery<{ emoji: string; tempF: number } | null>({
    queryKey: ["weather", Math.round(lat * 100) / 100, Math.round(lng * 100) / 100, dateStr],
    queryFn: async () => {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,weathercode&temperature_unit=fahrenheit&timezone=auto&start_date=${dateStr}&end_date=${dateStr}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const times: string[] = data?.hourly?.time ?? [];
      const temps: number[] = data?.hourly?.temperature_2m ?? [];
      const codes: number[] = data?.hourly?.weathercode ?? [];
      const idx = times.findIndex((t: string) => new Date(t).getHours() === eventHour);
      const i = idx >= 0 ? idx : 0;
      if (temps.length === 0) return null;
      return { emoji: wmoToEmoji(codes[i] ?? 0), tempF: Math.round(temps[i] ?? temps[0]) };
    },
    enabled: diffDays >= 0 && diffDays <= 16,
    staleTime: 1000 * 60 * 60,
    retry: false,
  });
}

// ─── RunCard ──────────────────────────────────────────────────────────────────

function RunCard({
  run,
  onPress,
  distanceMi,
  isBookmarked,
  onBookmark,
  isFriend,
  isCrew,
  walkthroughActive,
  hidePulse,
}: {
  run: Run;
  onPress: () => void;
  distanceMi?: number;
  isBookmarked?: boolean;
  onBookmark?: () => void;
  isFriend?: boolean;
  walkthroughActive?: boolean;
  isCrew?: boolean;
  hidePulse?: boolean;
}) {
  const { C } = useTheme();
  const { user: cardUser } = useAuth();
  const distUnit: DistanceUnit = ((cardUser as any)?.distance_unit ?? "miles") as DistanceUnit;
  const s = useMemo(() => makeStyles(C), [C]);
  const qc = useQueryClient();
  // Use the server's live presentCount when available (populated after card expansion),
  // so the badge reflects the server's is_present list rather than cached join state.
  const liveCache = run.is_active ? qc.getQueryData<any>(["/api/runs", run.id, "live"]) : undefined;
  const liveParticipantCount: number | undefined = liveCache?.presentCount;
  const spotsLeft = run.max_participants - run.participant_count;
  const badge = getHostBadge(run.host_hosted_runs);
  const isLiveNow = !!run.is_active && !run.is_completed;
  const runMs = run.date ? new Date(run.date).getTime() : 0;
  const nowMs = Date.now();
  const isStillJoinableCard = runMs > 0 && runMs < nowMs && !run.is_completed && nowMs - runMs < 2 * 60 * 60 * 1000;
  const minsAgoCard = runMs > 0 ? Math.floor((nowMs - runMs) / 60000) : 0;
  const pulseAnim = useRef(new Animated.Value(0.3)).current;
  const { data: weather } = useEventWeather(run.location_lat, run.location_lng, run.date);

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

  return (
    <View style={{ position: "relative" }}>
      {isLiveNow && !hidePulse && (
        <Animated.View style={[s.liveCardGlow, { opacity: pulseAnim }]} pointerEvents="none" />
      )}
      <View style={[s.card, isFriend && s.cardFriend, isCrew && s.cardCrew]}>
        {/* Outer row stretches all children to the same height so the divider
            spans the full card — including the tags row in the right column */}
        <View style={s.cardBody}>

          {/* ── Left: Host/Crew column ── */}
          <Pressable onPress={onPress} style={({ pressed }) => [s.hostColumn, { opacity: pressed ? 0.85 : 1 }]}>
            {(() => {
              const avatarUri = run.crew_id
                ? resolveImgUrl(run.crew_photo_url) ?? resolveImgUrl(run.host_photo)
                : resolveImgUrl(run.host_photo);
              return avatarUri ? (
                <Image source={{ uri: avatarUri }} style={s.hostAvatar} />
              ) : (
                <View style={s.hostAvatarFallback}>
                  <Text style={s.hostAvatarLetter}>{run.host_name?.charAt(0).toUpperCase()}</Text>
                </View>
              );
            })()}
            <Text style={s.hostColumnName} numberOfLines={2}>{run.host_name}</Text>
            {run.crew_id && run.crew_name && (
              <View style={s.crewBadge}>
                <Text style={s.crewBadgeEmoji}>{run.crew_emoji || "🏃"}</Text>
                <Text style={s.crewBadgeName} numberOfLines={1}>{run.crew_name}</Text>
              </View>
            )}
            {(() => {
              const isTopRated = (run.host_rating_count ?? 0) >= 5 && (run.host_rating ?? 0) >= 4.5;
              if (isTopRated) return <Text style={[s.hostColumnBadge, { color: "#FFB800" }]}>⭐ Top</Text>;
              if (badge) return <Text style={[s.hostColumnBadge, { color: badge.color }]}>{badge.label}</Text>;
              return null;
            })()}
            <Text style={s.hostColumnDist}>{toDisplayDist(run.min_distance, distUnit)}</Text>
            {weather && (
              <Text style={s.hostColumnWeather}>{weather.emoji} {weather.tempF}°</Text>
            )}
          </Pressable>

          {/* Vertical divider — stretches to full row height (left col vs right col+tags) */}
          <View style={s.cardDivider} />

          {/* ── Right: details + tags (tags outside Pressable so scroll works) ── */}
          <View style={s.cardDetails}>
            <Pressable
              onPress={onPress}
              testID={`run-card-${run.id}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, gap: 8 })}
            >
              <View style={s.cardTitleRow}>
                <Text style={s.cardTitle} numberOfLines={2}>{run.title}</Text>
                <View style={s.cardTitleRight}>
                  {run.is_active && (
                    <View style={s.livePill}>
                      <Text style={s.livePillTxt}>LIVE</Text>
                    </View>
                  )}
                  {spotsLeft <= 3 && spotsLeft > 0 && !run.is_active && (
                    <View style={s.urgentBadge}>
                      <Text style={s.urgentText}>{spotsLeft} left</Text>
                    </View>
                  )}
                  {onBookmark && (
                    <WalkthroughPulse stepId="bookmark" style={{ borderRadius: 8 }}>
                    <Pressable onPress={(e) => { e.stopPropagation?.(); onBookmark(); }} hitSlop={8} style={s.cardBookmarkBtn}>
                      <Ionicons
                        name={isBookmarked ? "bookmark" : "bookmark-outline"}
                        size={16}
                        color={isBookmarked ? C.primary : C.textMuted}
                      />
                    </Pressable>
                    </WalkthroughPulse>
                  )}
                </View>
              </View>

              <View style={s.cardMeta}>
                <View style={s.metaItem}>
                  <Feather name="calendar" size={11} color={isStillJoinableCard ? "#F5A623" : C.textMuted} />
                  {isStillJoinableCard ? (
                    <Text style={[s.metaText, { color: "#F5A623", fontFamily: "Outfit_600SemiBold" }]}>
                      {isLiveNow
                        ? `Started ${minsAgoCard < 60 ? `${minsAgoCard}m` : `${Math.floor(minsAgoCard / 60)}h ${minsAgoCard % 60}m`} ago · Live`
                        : `Ended ${minsAgoCard < 60 ? `${minsAgoCard}m` : `${Math.floor(minsAgoCard / 60)}h ${minsAgoCard % 60}m`} ago · Still joinable`}
                    </Text>
                  ) : (
                    <Text style={s.metaText}>{formatEventDateTime(run.date, run.timezone)}</Text>
                  )}
                </View>
                <View style={s.metaItem}>
                  <Feather name="map-pin" size={11} color={C.textMuted} />
                  <Text style={s.metaText} numberOfLines={1}>{run.location_name}</Text>
                </View>
                {distanceMi !== undefined && (
                  <View style={s.metaItem}>
                    <Feather name="navigation" size={11} color={C.textMuted} />
                    <Text style={s.metaText}>{toDisplayDist(distanceMi!, distUnit)} away</Text>
                  </View>
                )}
              </View>

              <View style={s.cardStats}>
                <View style={s.statPillPace}>
                  {run.crew_id && run.pace_groups && run.pace_groups.length > 0 ? (
                    <Text numberOfLines={1} style={[s.statPillValue, { color: C.primary }]}>Groups</Text>
                  ) : (
                    <Text numberOfLines={1} style={[s.statPillValue, { color: getPaceColor(run.min_pace, run.max_pace, C) }]}>
                      {run.min_pace === run.max_pace
                        ? toDisplayPace(run.min_pace, distUnit).replace(/ \/(mi|km)$/, "")
                        : `${toDisplayPace(run.min_pace, distUnit).replace(/ \/(mi|km)$/, "")}–${toDisplayPace(run.max_pace, distUnit).replace(/ \/(mi|km)$/, "")}`}
                    </Text>
                  )}
                  <Text numberOfLines={1} style={s.statPillLabel}>{run.activity_type === "ride" ? "Speed mph" : `Pace ${distUnit === "km" ? "min/km" : "min/mi"}`}</Text>
                </View>
                <View style={s.statDiv} />
                <View style={s.statPill}>
                  <Text numberOfLines={1} style={[s.statPillValue, { color: C.blue }]}>
                    {run.min_distance === run.max_distance
                      ? toDisplayDist(run.min_distance, distUnit)
                      : `${toDisplayDist(run.min_distance, distUnit)}–${toDisplayDist(run.max_distance, distUnit)}`}
                  </Text>
                  <Text numberOfLines={1} style={s.statPillLabel}>Dist</Text>
                </View>
                <View style={s.statDiv} />
                <View style={s.statPill}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                    <Ionicons name="people" size={13} color={run.is_active ? C.primary : C.textMuted} />
                    <Text numberOfLines={1} style={[s.statPillValue, run.is_active && { color: C.primary }]}>
                      {run.is_active
                        ? (liveParticipantCount !== undefined ? liveParticipantCount : run.participant_count)
                        : run.crew_id
                          ? run.participant_count
                          : `${run.participant_count}/${run.max_participants}`}
                    </Text>
                  </View>
                  <Text numberOfLines={1} style={s.statPillLabel}>{run.is_active ? "Running" : "Going"}</Text>
                </View>
              </View>

              {run.crew_id && run.user_is_crew_member === false ? (
                <Pressable
                  style={s.joinCrewCta}
                  onPress={(e) => { e.stopPropagation?.(); router.push(`/crew-profile/${run.crew_id}`); }}
                >
                  <Ionicons name="shield-outline" size={12} color={C.primary} />
                  <Text style={s.joinCrewCtaTxt}>Join crew to participate</Text>
                  <Feather name="chevron-right" size={12} color={C.primary} />
                </Pressable>
              ) : (
                <View style={s.metaItem}>
                  <Feather name="users" size={11} color={C.textMuted} />
                  <Text style={s.metaText}>
                    {run.participant_count ?? 1} {parseInt(run.participant_count ?? "1") === 1 ? "person" : "people"} going
                  </Text>
                </View>
              )}
            </Pressable>

            {/* Tags outside Pressable — scroll works, still inside right column so divider spans them */}
            {run.tags?.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={s.tagsScroll}
                contentContainerStyle={s.tags}
              >
                {sortTagsByCategory(run.tags).map((tag) => (
                  <View key={tag} style={s.tag}>
                    <Text style={s.tagTxt}>{tag}</Text>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>

          {walkthroughActive && (
            <WalkthroughPulse stepId="planning-to-come" style={{ borderRadius: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: C.surface, borderRadius: 12, marginTop: 8 }}>
                <Ionicons name="calendar-outline" size={16} color={C.primary} />
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.text, flex: 1 }}>
                  {run.activity_type === "ride" ? "I Plan To Ride" : run.activity_type === "walk" ? "I Plan To Walk" : "I Plan To Run"}
                </Text>
                <Feather name="chevron-right" size={14} color={C.primary} />
              </View>
            </WalkthroughPulse>
          )}

        </View>
      </View>
    </View>
  );
}

// ─── Mini Run Card (Saved / Planned header cards) ─────────────────────────────

function MiniRunCard({
  run,
  variant,
  width,
  activityFilter,
  onPress,
  onRemove,
}: {
  run: any;
  variant: "planned" | "saved";
  width: "100%" | number;
  activityFilter: "run" | "ride" | "walk";
  onPress: () => void;
  onRemove: () => void;
}) {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const isLive = !!run.is_active && !run.is_completed;
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (!isLive) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.15, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isLive]);

  const cardStyle = variant === "planned" ? s.plannedCard : s.savedCard;

  return (
    <View style={{ position: "relative", width }}>
      {isLive && (
        <Animated.View
          style={{
            position: "absolute",
            inset: -2,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: C.primary,
            opacity: pulseAnim,
            shadowColor: C.primary,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 1,
            shadowRadius: 8,
          }}
          pointerEvents="none"
        />
      )}
      <Pressable
        style={({ pressed }) => [cardStyle, { opacity: pressed ? 0.85 : 1, width: "100%" }]}
        onPress={onPress}
      >
        {isLive && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.primary }} />
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.primary, letterSpacing: 0.5 }}>LIVE</Text>
          </View>
        )}
        {variant === "planned" ? (
          <>
            <View style={s.plannedCardHeader}>
              <View style={s.plannedDot} />
              <Text style={s.plannedLabel} numberOfLines={1}>{activityFilter === "ride" ? "Riding" : activityFilter === "walk" ? "Walking" : "Running"}</Text>
              <Pressable hitSlop={10} onPress={(e) => { e.stopPropagation?.(); onRemove(); }}>
                <Ionicons name="calendar" size={14} color={C.primary} />
              </Pressable>
            </View>
            <Text style={s.plannedCardTitle} numberOfLines={2}>{run.title}</Text>
            <View style={s.savedCardMeta}>
              <Feather name="calendar" size={11} color={C.textMuted} />
              <Text style={s.savedCardMetaTxt} numberOfLines={1}>{formatEventDateTime(run.date, run.timezone)}</Text>
            </View>
            <View style={s.savedCardMeta}>
              <Feather name="map-pin" size={11} color={C.textMuted} />
              <Text style={s.savedCardMetaTxt} numberOfLines={1}>{run.location_name}</Text>
            </View>
          </>
        ) : (
          <>
            <View style={s.savedCardTop}>
              <Text style={s.savedCardTitle} numberOfLines={2}>{run.title}</Text>
              <Pressable hitSlop={8} onPress={(e) => { e.stopPropagation?.(); onRemove(); }}>
                <Ionicons name="bookmark" size={14} color={C.primary} />
              </Pressable>
            </View>
            <View style={s.savedCardMeta}>
              <Feather name="calendar" size={11} color={C.textMuted} />
              <Text style={s.savedCardMetaTxt} numberOfLines={1}>{formatEventDateTime(run.date, run.timezone)}</Text>
            </View>
            <View style={s.savedCardMeta}>
              <Feather name="map-pin" size={11} color={C.textMuted} />
              <Text style={s.savedCardMetaTxt} numberOfLines={1}>{run.location_name}</Text>
            </View>
          </>
        )}
      </Pressable>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

const PARTICIPANT_STEPS = [1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 0]; // 0 = unlimited
const PACE_SLIDER_MIN = 4;  // min/mile (fastest)
const PACE_SLIDER_MAX = 20; // min/mile (slowest)

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const distUnit: DistanceUnit = ((user as any)?.distance_unit ?? "miles") as DistanceUnit;
  const qc = useQueryClient();
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const fm = useMemo(() => makeFmStyles(C), [C]);
  const { isActive: walkthroughActive } = useWalkthrough();

  const [search, setSearch] = useState("");
  const [aiSearchDisabled, setAiSearchDisabled] = useState(false);
  async function handleSearch(text: string) {
    setSearch(text);
    if (text.length > 5) {
      try {
        const res = await apiRequest("POST", "/api/runs/search-ai", { q: text });
        if (res.status === 501) {
          setAiSearchDisabled(true);
          return;
        }
        if (res.ok) {
          setAiSearchDisabled(false);
          const aiFilters = await res.json();
          setDraft(prev => ({
            ...prev,
            paceMax: aiFilters.paceMax ?? prev.paceMax,
            distMin: aiFilters.distMin ?? prev.distMin,
            distMax: aiFilters.distMax ?? prev.distMax,
            styles: aiFilters.tags ? [...new Set([...prev.styles, ...aiFilters.tags])] : prev.styles,
          }));
        }
      } catch (e) {}
    } else {
      setAiSearchDisabled(false);
    }
  }
  const [sortOption, setSortOption] = useState<SortOption>("nearest");
  const [userHasSetDistance, setUserHasSetDistance] = useState(false);
  const [visibleCount, setVisibleCount] = useState(5);
  const { activityFilter, setActivityFilter } = useActivity();
  const [showFilter, setShowFilter] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);

  useEffect(() => {
    return onOpenNotifications(() => setShowNotifs(true));
  }, []);

  const [expandedLiveId, setExpandedLiveId] = useState<string | null>(null);
  const { width: screenWidth } = useWindowDimensions();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardSlide, setOnboardSlide] = useState(0);
  const onboardScrollRef = useRef<ScrollView>(null);
  const flatListRef = useRef<FlatList<any>>(null);
  const [checklistDismissed, setChecklistDismissed] = useState(true);
  const [checklistAllDone, setChecklistAllDone] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [ghostBookmarkDone, setGhostBookmarkDone] = useState(true);
  const [ghostPlannedDone, setGhostPlannedDone] = useState(true);

  const { data: notifDataRaw, refetch: refetchNotifs } = useQuery<{ items: any[]; lastReadAt: string | null }>({
    queryKey: ["/api/notifications"],
    refetchInterval: 30000,
    enabled: !!user,
  });
  const notifications = notifDataRaw?.items ?? [];
  const lastReadAt = notifDataRaw?.lastReadAt ? new Date(notifDataRaw.lastReadAt).getTime() : 0;

  const { data: unreadDmData } = useQuery<{ count: number }>({
    queryKey: ["/api/dm/unread-count"],
    refetchInterval: 30000,
    enabled: !!user,
  });
  const unreadDmCount = unreadDmData?.count ?? 0;

  const notifCount = notifications.filter(
    (n: any) => new Date(n.created_at).getTime() > lastReadAt
  ).length;

  const markNotifsReadMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/notifications/mark-read", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/notifications"] }),
  });

  const [previewShareId, setPreviewShareId] = useState<string | null>(null);
  const notifData = useMemo(() => {
    return {
      hostArrivals: notifications.filter((n: any) => n.type === "host_arrived"),
      friendRequests: notifications.filter((n: any) => n.type === "friend_request"),
      crewInvites: notifications.filter((n: any) => n.type === "crew_invite"),
      joinRequests: notifications.filter((n: any) => n.type === "join_request"),
      eventReminders: notifications.filter((n: any) => n.type === "event_reminder"),
      prNotifs: notifications.filter((n: any) => n.type === "pr_notification"),
      pathShared: notifications.filter((n: any) => n.type === "path_shared"),
    };
  }, [notifications]);

  const respondFriendMutation = useMutation({
    mutationFn: (vars: { id: string; action: "accept" | "decline" }) =>
      apiRequest("POST", "/api/friends/respond", { friendshipId: vars.id, action: vars.action }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/notifications"] });
      qc.invalidateQueries({ queryKey: ["/api/friends"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const respondCrewMutation = useMutation({
    mutationFn: (vars: { crewId: string; action: "accept" | "decline" }) =>
      apiRequest("POST", "/api/crews/invites/respond", { crewId: vars.crewId, action: vars.action }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/notifications"] });
      qc.invalidateQueries({ queryKey: ["/api/crews/mine"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const respondJoinMutation = useMutation({
    mutationFn: (vars: { participantId: string; action: "approve" | "deny" }) =>
      apiRequest("POST", "/api/runs/requests/respond", { participantId: vars.participantId, action: vars.action }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/notifications"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const respondFriend = (id: string, action: "accept" | "decline") => {
    respondFriendMutation.mutate({ id, action });
  };

  const respondCrew = (crewId: string, action: "accept" | "decline") => {
    respondCrewMutation.mutate({ crewId, action });
  };

  const respondJoin = (participantId: string, action: "approve" | "deny") => {
    respondJoinMutation.mutate({ participantId, action });
  };
  const [draft,    setDraft]    = useState<FilterState>({ ...DEFAULT_FILTERS });
  const [applied,  setApplied]  = useState<FilterState>({ ...DEFAULT_FILTERS });
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  // ─── Host modal state ───────────────────────────────────────────────────────
  const [showHostModal, setShowHostModal] = useState(false);
  const [hTitle, setHTitle] = useState("");
  const [hLocation, setHLocation] = useState("");
  const [hDate, setHDate] = useState<Date>(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d; });
  const [hTime, setHTime] = useState("7:30");
  const [hPrivacy, setHPrivacy] = useState<"public" | "friends" | "crew">("public");
  const [hPassword, setHPassword] = useState("");
  const [hMaxParticipants, setHMaxParticipants] = useState(20);
  const [hTags, setHTags] = useState<string[]>([]);
  const [hDist, setHDist] = useState("3");
  const [hMinPace, setHMinPace] = useState(4);
  const [hMaxPace, setHMaxPace] = useState(20);
  const [hLocationLat, setHLocationLat] = useState<number | null>(null);
  const [hLocationLng, setHLocationLng] = useState<number | null>(null);
  const [hostPage, setHostPage] = useState<"form" | "location" | "routePicker">("form");
  const [pinCoord, setPinCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isGeocodingPin, setIsGeocodingPin] = useState(false);
  const [hAmPm, setHAmPm] = useState<"AM" | "PM">("AM");
  const [hStrict, setHStrict] = useState(false);
  const [hActivityType, setHActivityType] = useState<"run" | "ride" | "walk">("run");
  const [hCrewId, setHCrewId] = useState<string | null>(null);
  const [hSavedPathId, setHSavedPathId] = useState<string | null>(null);
  const [hSavedPathName, setHSavedPathName] = useState<string | null>(null);
  const [hRouteSearch, setHRouteSearch] = useState("");
  const [hRouteFilter, setHRouteFilter] = useState<"recent" | "az">("recent");

  const { data: hSavedPaths = [] } = useQuery<{ id: string; name: string; distance_miles: number; activity_type: string; route_path: RoutePoint[] | null }[]>({
    queryKey: ["/api/saved-paths"],
    staleTime: 60_000,
    enabled: !!user,
  });

  function resetHostForm() {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    setHTitle(""); setHLocation(""); setHDate(tomorrow); setHTime("7:30");
    setHPrivacy("public"); setHPassword(""); setHMaxParticipants(20);
    setHTags([]); setHDist("3"); setHMinPace(4); setHMaxPace(20);
    setHLocationLat(null); setHLocationLng(null); setPinCoord(null); setHostPage("form");
    setHAmPm("AM"); setHStrict(false); setHActivityType("run"); setHCrewId(null);
    setHSavedPathId(null); setHSavedPathName(null); setHRouteSearch(""); setHRouteFilter("recent");
  }

  function autoFormatTime(digits: string): string {
    if (digits.length <= 1) return digits;
    const first = parseInt(digits[0], 10);
    const second = parseInt(digits[1], 10);
    if (digits.length === 2) {
      // Insert colon immediately for unambiguous single-digit hours (2–9, or 1 followed by 3–9)
      if (first > 1 || (first === 1 && second > 2)) return digits[0] + ":" + digits[1];
      return digits; // 10, 11, 12 — wait for 3rd digit
    }
    if (digits.length === 3) {
      // Always single-digit hour at 3 digits — "120" → "1:20", "130" → "1:30"
      return digits[0] + ":" + digits.slice(1);
    }
    // 4 digits: use 2-digit hour only for valid 10/11/12; otherwise single-digit
    if (first === 1 && second <= 2) return digits.slice(0, 2) + ":" + digits.slice(2, 4);
    return digits[0] + ":" + digits.slice(1, 3);
  }

  function handleTimeChange(text: string) {
    const digits = text.replace(/\D/g, "").slice(0, 4);
    setHTime(autoFormatTime(digits));
  }

  // ─── Date / Time parse helpers ─────────────────────────────────────────────
  function parseHHMMAMPM(raw: string, ampm: "AM" | "PM"): { hours: number; minutes: number } | null {
    const match = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (ampm === "PM" && hours !== 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return { hours, minutes };
  }

  // ─── Reverse-geocode a pin coordinate ──────────────────────────────────────
  async function reverseGeocode(lat: number, lng: number) {
    setIsGeocodingPin(true);
    try {
      const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (results.length > 0) {
        const r = results[0];
        const parts = [r.name, r.street, r.city, r.region].filter(Boolean);
        setHLocation(parts.join(", "));
      }
    } catch {
      // silently ignore geocoding errors
    } finally {
      setIsGeocodingPin(false);
    }
  }

  function formatPaceMM(pace: number): string {
    let mins = Math.floor(pace);
    let secs = Math.round((pace % 1) * 60);
    if (secs === 60) { secs = 0; mins += 1; }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  function stepParticipants(dir: 1 | -1) {
    const idx = PARTICIPANT_STEPS.indexOf(hMaxParticipants);
    const next = PARTICIPANT_STEPS[Math.max(0, Math.min(PARTICIPANT_STEPS.length - 1, idx + dir))];
    setHMaxParticipants(next ?? 0);
    Haptics.selectionAsync();
  }

  const [showRulesModal, setShowRulesModal] = useState(false);

  // ─── Host FAB helpers ───────────────────────────────────────────────────────
  const openHostModal = useCallback(() => {
    setShowRulesModal(true);
  }, []);

  const createRunMutation = useMutation({
    mutationFn: async () => {
      if (!hTitle.trim()) throw new Error("Run title is required");
      if (!hLocation.trim()) throw new Error("Location is required — tap the pin to set it on the map");
      if (hLocationLat === null || hLocationLng === null) throw new Error("Please pick a location on the map");
      if (!hTime.trim()) throw new Error("Date and time are required");
      const distVal = parseFloat(hDist);
      if (!hDist.trim() || isNaN(distVal) || distVal <= 0) throw new Error("Planned distance is required (e.g. 3.1 miles)");
      const parsedDate = new Date(hDate);
      const parsedTime = parseHHMMAMPM(hTime.trim(), hAmPm);
      if (!parsedTime) throw new Error("Invalid time — use H:MM (e.g. 7:30)");
      parsedDate.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
      if (isNaN(parsedDate.getTime())) throw new Error("Invalid date or time");
      if (parsedDate.getTime() < Date.now() - 5 * 60 * 1000) throw new Error("Run date must be in the future");
      if (hPrivacy === "crew" && !hCrewId) throw new Error("Please select a crew for this run");
      const res = await apiRequest("POST", "/api/runs", {
        title: hTitle.trim(),
        privacy: hPrivacy === "public" ? "public" : "private",
        date: parsedDate.toISOString(),
        locationLat: hLocationLat,
        locationLng: hLocationLng,
        locationName: hLocation.trim(),
        minDistance: distVal,
        maxDistance: distVal,
        minPace: hMinPace,
        maxPace: hMaxPace,
        tags: hTags,
        maxParticipants: hMaxParticipants === 0 ? 9999 : hMaxParticipants,
        isStrict: hStrict,
        activityType: hActivityType,
        crewId: hPrivacy === "crew" ? hCrewId : undefined,
        savedPathId: hSavedPathId || undefined,
      });
      return res.json();
    },
    onSuccess: (run: any) => {
      qc.refetchQueries({ queryKey: ["/api/runs"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowHostModal(false);
      resetHostForm();
      const isRide = run?.activity_type === "ride";
      const label = isRide ? "Ride" : "Run";
      const participants = isRide ? "riders" : "runners";
      if (run?.privacy === "private" && run?.invite_token) {
        Alert.alert(`${label} Created!`, `Share this invite code with your ${participants}:\n\n${run.invite_token}`);
      } else {
        Alert.alert(`${label} Created!`, `Your ${label.toLowerCase()} is now live on the map.`);
      }
    },
    onError: (e: any) => {
      Alert.alert("Error", e.message || "Failed to create run");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const headerTopPad = insets.top + (Platform.OS === "web" ? 67 : 16);

  // ─── Location ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (Platform.OS === "web") { setSortOption("soonest"); setApplied(p => ({ ...p, maxDistFromMe: null })); setDraft(p => ({ ...p, maxDistFromMe: null })); return; }
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") { setSortOption("soonest"); setApplied(p => ({ ...p, maxDistFromMe: null })); setDraft(p => ({ ...p, maxDistFromMe: null })); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setUserLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    })();
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    Promise.all([
      AsyncStorage.getItem(`paceup_has_onboarded_${user.id}`),
      AsyncStorage.getItem(`fara_has_onboarded_${user.id}`),
    ]).then(([newKey, oldKey]) => {
      if (!newKey && !oldKey) {
        setShowOnboarding(true);
      } else if (oldKey && !newKey) {
        AsyncStorage.setItem(`paceup_has_onboarded_${user.id}`, "true");
      }
    });
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    Promise.all([
      AsyncStorage.getItem(`paceup_checklist_dismissed_${user.id}`),
      AsyncStorage.getItem(`fara_checklist_dismissed_${user.id}`),
    ]).then(([newKey, oldKey]) => {
      if (newKey === "true" || oldKey === "true") {
        setChecklistDismissed(true);
        if (oldKey === "true" && newKey !== "true") {
          AsyncStorage.setItem(`paceup_checklist_dismissed_${user.id}`, "true");
        }
      } else {
        setChecklistDismissed(false);
      }
    });
  }, [user?.id]);

  const finishOnboarding = () => {
    if (user?.id) AsyncStorage.setItem(`paceup_has_onboarded_${user.id}`, "true");
    setShowOnboarding(false);
    setOnboardSlide(0);
  };

  const dismissChecklist = () => {
    if (user?.id) AsyncStorage.setItem(`paceup_checklist_dismissed_${user.id}`, "true");
    setChecklistDismissed(true);
  };

  useEffect(() => {
    if (!user?.id) return;
    Promise.all([
      AsyncStorage.getItem(`paceup_ghost_bookmark_done_${user.id}`),
      AsyncStorage.getItem(`paceup_ghost_planned_done_${user.id}`),
    ]).then(([b, p]) => {
      setGhostBookmarkDone(b === "true");
      setGhostPlannedDone(p === "true");
    });
  }, [user?.id]);

  // ─── Data ──────────────────────────────────────────────────────────────────

  const { data: runs = [], isLoading, refetch, isRefetching } = useQuery<Run[]>({
    queryKey: ["/api/runs"],
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!isRefetching) setIsManualRefreshing(false);
  }, [isRefetching]);

  const { data: friends = [] } = useQuery<{ id: string }[]>({
    queryKey: ["/api/friends"],
    staleTime: 60_000,
    enabled: !!user,
  });

  const { data: myCrews = [] } = useQuery<{ id: string; name: string; emoji?: string }[]>({
    queryKey: ["/api/crews"],
    staleTime: 60_000,
    enabled: !!user,
  });

  const { data: bookmarkedRuns = [] } = useQuery<Run[]>({
    queryKey: ["/api/runs/bookmarked"],
    staleTime: 30_000,
    enabled: !!user,
  });

  const bookmarkedIds = useMemo(() => new Set(bookmarkedRuns.map((r) => r.id)), [bookmarkedRuns]);
  const sortedBookmarkedRuns = useMemo(() =>
    [...bookmarkedRuns]
      .filter((r) => (r.activity_type ?? "run") === activityFilter)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
    [bookmarkedRuns, activityFilter]
  );

  const bookmarkMutation = useMutation({
    mutationFn: (runId: string) => apiRequest("POST", `/api/runs/${runId}/bookmark`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/runs/bookmarked"] });
    },
    onError: () => {
      Alert.alert("Error", "Could not update saved runs. Please try again.");
    },
  });

  const { data: plannedRuns = [] } = useQuery<Run[]>({
    queryKey: ["/api/runs/planned"],
    staleTime: 0,
    enabled: !!user,
  });


  useEffect(() => {
    if (!user?.id || ghostBookmarkDone) return;
    if (bookmarkedRuns.length > 0) {
      setGhostBookmarkDone(true);
      AsyncStorage.setItem(`paceup_ghost_bookmark_done_${user.id}`, "true");
    }
  }, [bookmarkedRuns.length, user?.id, ghostBookmarkDone]);

  useEffect(() => {
    if (!user?.id || ghostPlannedDone) return;
    if (plannedRuns.length > 0) {
      setGhostPlannedDone(true);
      AsyncStorage.setItem(`paceup_ghost_planned_done_${user.id}`, "true");
    }
  }, [plannedRuns.length, user?.id, ghostPlannedDone]);

  const { data: communityData } = useQuery<{ runs: any[] }>({
    queryKey: ["/api/runs/community-activity"],
    staleTime: 300_000,
  });
  const communityRuns = communityData?.runs ?? [];

  const checklistItems = useMemo(() => [
    {
      label: "Set your pace",
      done: (user as any)?.avg_pace != null && ((user as any)?.avg_pace !== 10 || (user as any)?.avg_distance !== 3),
      action: () => router.push("/(tabs)/profile" as any),
    },
    {
      label: "Log a solo activity",
      done: ((user as any)?.completed_runs ?? 0) > 0,
      action: () => router.push("/(tabs)/solo" as any),
    },
    {
      label: "Host your first event",
      done: ((user as any)?.hosted_runs ?? 0) > 0,
      action: () => setShowHostModal(true),
    },
    {
      label: "Add a friend",
      done: friends.length > 0,
      action: () => router.push("/(tabs)/profile" as any),
    },
  ], [user, friends]);

  const completedCount = checklistItems.filter((i) => i.done).length;

  useEffect(() => {
    if (completedCount === 4 && !checklistDismissed && !checklistAllDone) {
      setChecklistAllDone(true);
      const t = setTimeout(() => {
        dismissChecklist();
        setChecklistAllDone(false);
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [completedCount, checklistDismissed]);

  const removePlanMutation = useMutation({
    mutationFn: (runId: string) => apiRequest("POST", `/api/runs/${runId}/plan`),
    onSuccess: (_data, runId) => {
      qc.setQueryData<Run[]>(["/api/runs/planned"], (old) =>
        old ? old.filter((r) => r.id !== runId) : []
      );
      qc.invalidateQueries({ queryKey: ["/api/runs/planned"] });
      qc.invalidateQueries({ queryKey: ["/api/runs", runId, "status"] });
      qc.invalidateQueries({ queryKey: ["/api/runs"] });
      qc.invalidateQueries({ queryKey: ["/api/runs", runId] });
    },
    onError: () => {
      Alert.alert("Error", "Could not remove from planned runs. Please try again.");
    },
  });

  useFocusEffect(
    useCallback(() => {
      if (user) {
        qc.invalidateQueries({ queryKey: ["/api/runs/planned"] });
        qc.invalidateQueries({ queryKey: ["/api/runs"] });
      }
    }, [user, qc])
  );

  const friendIdSet = useMemo(
    () => new Set(friends.map((f) => f.id)),
    [friends]
  );

  // ─── Distance map ──────────────────────────────────────────────────────────

  const distanceMap = useMemo<Record<string, number>>(() => {
    if (!userLocation) return {};
    const m: Record<string, number> = {};
    for (const run of runs) {
      m[run.id] = haversine(
        userLocation.latitude, userLocation.longitude,
        run.location_lat, run.location_lng
      );
    }
    return m;
  }, [runs, userLocation]);

  // ─── Filter + Sort ─────────────────────────────────────────────────────────

  const sorted = useMemo(() => {
    const list = runs.filter((r) => {
      // Search
      const q = search.toLowerCase();
      const matchSearch = !search ||
        r.title.toLowerCase().includes(q) ||
        r.location_name.toLowerCase().includes(q) ||
        r.host_name.toLowerCase().includes(q);
      // Pace overlap: event's pace range intersects the user's selected window
      const matchPace = r.min_pace <= applied.paceMax && r.max_pace >= applied.paceMin;
      // Distance (run length) overlap
      const matchDist = r.min_distance <= applied.distMax && r.max_distance >= applied.distMin;
      // Proximity
      const matchProx = !applied.maxDistFromMe || !userLocation ||
        (distanceMap[r.id] ?? Infinity) <= applied.maxDistFromMe;
      // Host style — ALL selected tags must be present on the run (AND semantics)
      const matchStyle = applied.styles.length === 0 ||
        applied.styles.every((tag) => r.tags?.includes(tag));
      // Visibility
      const matchVisibility =
        applied.visibility === "all" ||
        (applied.visibility === "public" && r.privacy === "public" && !r.crew_id) ||
        (applied.visibility === "crew" && !!r.crew_id) ||
        (applied.visibility === "friends" && friendIdSet.has(r.host_id) && !r.crew_id);
      // Day of Week — use local-timezone weekday string to avoid UTC off-by-one
      const runDay = new Date(r.date).toLocaleDateString("en-US", { weekday: "short" });
      const appliedDays = applied.days ?? [];
      const matchDay = appliedDays.length === 0 || appliedDays.includes(runDay);
      // Time of Day
      const runHour = new Date(r.date).getHours();
      function runTimeSlot(h: number): string {
        if (h >= 5 && h < 12) return "Morning";
        if (h >= 12 && h < 17) return "Afternoon";
        if (h >= 17 && h < 21) return "Evening";
        return "Night";
      }
      const appliedTimes = applied.times ?? [];
      const matchTime = appliedTimes.length === 0 ||
        appliedTimes.includes(runTimeSlot(runHour));

      const matchActivity = (r.activity_type ?? "run") === activityFilter;
      // Hide runs that ended more than 2 hours ago (mirrors the server-side grace window)
      const matchFuture = !r.date || (Date.now() - new Date(r.date).getTime()) < 2 * 60 * 60 * 1000;
      return matchSearch && matchPace && matchDist && matchProx && matchStyle && matchVisibility && matchDay && matchTime && matchActivity && matchFuture;
    });

    switch (sortOption) {
      case "nearest":
        list.sort((a, b) =>
          userLocation
            ? (distanceMap[a.id] ?? Infinity) - (distanceMap[b.id] ?? Infinity)
            : new Date(a.date).getTime() - new Date(b.date).getTime()
        );
        break;
      case "soonest":
        list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        break;
    }
    // Float friend runs to the top, maintaining their relative order
    list.sort((a, b) => {
      const af = friendIdSet.has(a.host_id) ? 0 : 1;
      const bf = friendIdSet.has(b.host_id) ? 0 : 1;
      return af - bf;
    });
    return list;
  }, [runs, search, applied, sortOption, distanceMap, userLocation, friendIdSet, activityFilter]);

  const [userState, setUserState] = useState<string | null>(null);
  useEffect(() => {
    if (!userLocation || Platform.OS === "web") return;
    (async () => {
      try {
        const geo = await Location.reverseGeocodeAsync({ latitude: userLocation.latitude, longitude: userLocation.longitude });
        const st = geo?.[0]?.region ?? null;
        setUserState(st);
      } catch (_) {}
    })();
  }, [userLocation]);

  const displayList = useMemo(() => {
    if (sorted.length > 0) return sorted;
    if (isLoading || search) return sorted;

    if (!userHasSetDistance && userLocation) {
      function runTimeSlot(h: number): string {
        if (h >= 5 && h < 12) return "Morning";
        if (h >= 12 && h < 17) return "Afternoon";
        if (h >= 17 && h < 21) return "Evening";
        return "Night";
      }
      const passesNonProxFilters = (r: Run): boolean => {
        const q = search.toLowerCase();
        const matchSearch = !search ||
          r.title.toLowerCase().includes(q) ||
          r.location_name.toLowerCase().includes(q) ||
          r.host_name.toLowerCase().includes(q);
        // Pace overlap: event's pace range intersects the user's selected window
        const matchPace = r.min_pace <= applied.paceMax && r.max_pace >= applied.paceMin;
        const matchDist = r.min_distance <= applied.distMax && r.max_distance >= applied.distMin;
        const matchStyle = applied.styles.length === 0 || applied.styles.every((tag) => r.tags?.includes(tag));
        const matchVisibility =
          applied.visibility === "all" ||
          (applied.visibility === "public" && r.privacy === "public" && !r.crew_id) ||
          (applied.visibility === "crew" && !!r.crew_id) ||
          (applied.visibility === "friends" && friendIdSet.has(r.host_id) && !r.crew_id);
        const runDay = new Date(r.date).toLocaleDateString("en-US", { weekday: "short" });
        const appliedDays = applied.days ?? [];
        const matchDay = appliedDays.length === 0 || appliedDays.includes(runDay);
        const runHour = new Date(r.date).getHours();
        const appliedTimes = applied.times ?? [];
        const matchTime = appliedTimes.length === 0 || appliedTimes.includes(runTimeSlot(runHour));
        const matchActivity = (r.activity_type ?? "run") === activityFilter;
        const matchFuture = !r.date || (Date.now() - new Date(r.date).getTime()) < 2 * 60 * 60 * 1000;
        return matchSearch && matchPace && matchDist && matchStyle && matchVisibility && matchDay && matchTime && matchActivity && matchFuture;
      };

      const filteredBase = runs.filter(passesNonProxFilters);

      const sortCascade = (list: Run[]) => {
        const copy = [...list];
        switch (sortOption) {
          case "nearest":
            copy.sort((a, b) =>
              userLocation
                ? (distanceMap[a.id] ?? Infinity) - (distanceMap[b.id] ?? Infinity)
                : new Date(a.date).getTime() - new Date(b.date).getTime()
            );
            break;
          case "soonest":
          default:
            copy.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        }
        copy.sort((a, b) => {
          const af = friendIdSet.has(a.host_id) ? 0 : 1;
          const bf = friendIdSet.has(b.host_id) ? 0 : 1;
          return af - bf;
        });
        return copy;
      };

      const userStateAbbr = userState ? normalizeStateToAbbr(userState) : null;

      for (const tier of CASCADE_TIERS) {
        let tierRuns: Run[];
        if (tier === -1) {
          if (!userStateAbbr) continue;
          tierRuns = filteredBase.filter((r) => {
            const runState = extractRunState(r.location_name ?? "");
            return runState !== null && runState === userStateAbbr;
          });
        } else if (tier === null) {
          tierRuns = filteredBase;
        } else {
          tierRuns = filteredBase.filter((r) => (distanceMap[r.id] ?? Infinity) <= tier);
        }
        if (tierRuns.length > 0) {
          return sortCascade(tierRuns);
        }
      }
      return [];
    }

    return sorted;
  }, [sorted, isLoading, search, userHasSetDistance, userLocation, runs, activityFilter, sortOption, distanceMap, friendIdSet, userState, applied]);

  const isFallback = false;

  // Reset to 5 whenever the user changes search/filters/activity
  useEffect(() => { setVisibleCount(5); }, [search, applied, activityFilter]);

  // ─── Filter state helpers ──────────────────────────────────────────────────

  const isFiltered =
    applied.paceMin !== DEFAULT_FILTERS.paceMin ||
    applied.paceMax !== DEFAULT_FILTERS.paceMax ||
    applied.distMin !== DEFAULT_FILTERS.distMin ||
    applied.distMax !== DEFAULT_FILTERS.distMax ||
    userHasSetDistance ||
    applied.styles.length > 0 ||
    applied.visibility !== "all" ||
    (applied.days ?? []).length > 0 ||
    (applied.times ?? []).length > 0;

  const isNonDefaultSort = sortOption !== "nearest";

  function openFilter() {
    setDraft({ ...applied });
    setShowFilter(true);
  }

  function applyFilters() {
    setApplied({ ...draft });
    setShowFilter(false);
  }

  // Scroll discover list back to top whenever active filters change
  useEffect(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [applied, activityFilter]);

  function resetFilters() {
    setDraft({ ...DEFAULT_FILTERS });
    setUserHasSetDistance(false);
  }

  // ─── Navigate to map ───────────────────────────────────────────────────────

  function goToMap() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const p = new URLSearchParams();
    if (applied.styles.length > 0) p.set("styles", applied.styles.join(","));
    const qs = p.toString();
    router.push(qs ? `/map?${qs}` : "/map");
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[s.container, { backgroundColor: C.bg }]}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[s.header, { paddingTop: headerTopPad }]}>
        <View style={s.titleRow}>
          <Text style={[s.title, { fontSize: screenWidth < 390 ? 26 : 36 }]} numberOfLines={1}>PaceUp</Text>

          <View style={[s.headerBtns, { gap: screenWidth < 390 ? 4 : 6 }]}>
            {/* Messages */}
            <Pressable
              style={[s.hBtnRow, { paddingHorizontal: screenWidth < 390 ? 8 : 11 }]}
              onPress={() => router.push("/(tabs)/messages")}
              testID="messages-button"
            >
              <View>
                <Ionicons name="chatbubble-outline" size={screenWidth < 390 ? 13 : 15} color={C.primary} />
                {unreadDmCount > 0 && <View style={s.dmDot} />}
              </View>
              <Text style={[s.hBtnTxt, { fontSize: screenWidth < 390 ? 11 : 13 }]}>Messages</Text>
            </Pressable>

            {/* Host */}
            <Pressable style={[s.hBtnRow, { paddingHorizontal: screenWidth < 390 ? 8 : 11 }]} onPress={openHostModal} testID="host-button">
              <Feather name="plus" size={screenWidth < 390 ? 13 : 15} color={C.primary} />
              <Text style={[s.hBtnTxt, { fontSize: screenWidth < 390 ? 11 : 13 }]}>Host</Text>
            </Pressable>

            {/* Bell */}
            <Pressable
              style={[s.hBtn, { width: screenWidth < 390 ? 34 : 38 }]}
              onPress={() => { setShowNotifs(true); markNotifsReadMutation.mutate(); Haptics.selectionAsync(); }}
              testID="notifications-bell"
            >
              <View>
                <Feather name="bell" size={screenWidth < 390 ? 16 : 18} color={C.primary} />
                {notifCount > 0 && <View style={s.notifBadge} />}
              </View>
            </Pressable>
          </View>
        </View>

        {/* Search */}
        <View style={s.searchWrap}>
          <Feather name="search" size={15} color={C.textMuted} />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={handleSearch}
            placeholder={activityFilter === "ride" ? "Search rides, hosts, locations..." : activityFilter === "walk" ? "Search walks, hosts, locations..." : "Search runs, hosts, locations..."}
            placeholderTextColor={C.textMuted}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x" size={15} color={C.textMuted} />
            </Pressable>
          )}
        </View>
        {aiSearchDisabled && search.length > 5 && (
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted, paddingHorizontal: 16, marginTop: -4, marginBottom: 4 }}>
            AI search unavailable — showing keyword results
          </Text>
        )}

        {/* Activity toggle + filter */}
        <WalkthroughPulse stepId="activity-toggle" style={{ borderRadius: 20 }}>
        <View style={s.activityToggleRow}>
          <Pressable
            style={[s.activityPill, activityFilter === "run" && s.activityPillActive]}
            onPress={() => { setActivityFilter("run"); Haptics.selectionAsync(); }}
          >
            <Ionicons name="body" size={13} color={activityFilter === "run" ? C.bg : C.textMuted} />
            <Text style={[s.activityPillTxt, activityFilter === "run" && s.activityPillTxtActive]}>Runs</Text>
          </Pressable>
          <Pressable
            style={[s.activityPill, activityFilter === "ride" && s.activityPillActive]}
            onPress={() => { setActivityFilter("ride"); Haptics.selectionAsync(); }}
          >
            <Ionicons name="bicycle" size={13} color={activityFilter === "ride" ? C.bg : C.textMuted} />
            <Text style={[s.activityPillTxt, activityFilter === "ride" && s.activityPillTxtActive]}>Rides</Text>
          </Pressable>
          <Pressable
            style={[s.activityPill, activityFilter === "walk" && s.activityPillActive]}
            onPress={() => { setActivityFilter("walk"); Haptics.selectionAsync(); }}
          >
            <Ionicons name="footsteps" size={13} color={activityFilter === "walk" ? C.bg : C.textMuted} />
            <Text style={[s.activityPillTxt, activityFilter === "walk" && s.activityPillTxtActive]}>Walks</Text>
          </Pressable>
          <Pressable
            style={[s.filterToggleBtn, isFiltered && s.hBtnActive]}
            onPress={openFilter}
            testID="filter-button"
          >
            <Feather name="sliders" size={15} color={isFiltered ? C.primary : C.textMuted} />
            {isFiltered && <View style={s.dot} />}
          </Pressable>
        </View>
        </WalkthroughPulse>
      </View>

      {/* ── List ───────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={C.primary} size="large" />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={displayList.slice(0, visibleCount)}
          keyExtractor={(r) => r.id}
          contentContainerStyle={[
            s.list,
            { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 100) },
          ]}
          showsVerticalScrollIndicator={false}
          scrollEnabled={true}
          refreshControl={
            <RefreshControl refreshing={isManualRefreshing && isRefetching} onRefresh={() => { setIsManualRefreshing(true); refetch(); }} tintColor={C.primary} />
          }
          ListHeaderComponent={
            <View>
            {user && ((!ghostBookmarkDone || sortedBookmarkedRuns.length > 0) || (!ghostPlannedDone || plannedRuns.filter((r) => (r.activity_type ?? "run") === activityFilter && !r.is_completed).length > 0)) && (() => {
              const filteredPlanned = plannedRuns.filter((r) => (r.activity_type ?? "run") === activityFilter && !r.is_completed);
              const SCROLL_CARD_W = 140;
              return (
                <View style={s.sideBySideRow}>
                  {/* ── Left: Planning to ── */}
                  {(!ghostPlannedDone || filteredPlanned.length > 0) && (
                    <View style={s.sideCol}>
                      <Text style={s.savedSectionTitle}>{activityFilter === "ride" ? "Planning to Ride" : activityFilter === "walk" ? "Planning to Walk" : "Planning to Run"}</Text>
                      {filteredPlanned.length === 0 ? (
                        <View style={s.ghostPlannedCard}>
                          <View style={s.plannedCardHeader}>
                            <View style={[s.plannedDot, { backgroundColor: C.textMuted }]} />
                            <Text style={s.ghostPlannedLabel}>{activityFilter === "ride" ? "Planning to ride" : activityFilter === "walk" ? "Planning to walk" : "Planning to run"}</Text>
                            <Ionicons name="calendar-outline" size={14} color={C.textMuted} />
                          </View>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                            <Text style={s.ghostPlannedTitle}>Tap</Text>
                            <Ionicons name="calendar-outline" size={14} color={C.textMuted} />
                            <Text style={s.ghostPlannedTitle}>{activityFilter === "ride" ? "on any ride" : activityFilter === "walk" ? "on any walk" : "on any event"}</Text>
                          </View>
                          <View style={s.savedCardMeta}>
                            <Feather name="map-pin" size={11} color={C.textMuted} />
                            <Text style={s.ghostMetaTxt} numberOfLines={1}>Columbus Circle</Text>
                          </View>
                        </View>
                      ) : filteredPlanned.length <= 2 ? (
                        <View style={{ gap: 8 }}>
                          {filteredPlanned.map((r) => (
                            <MiniRunCard
                              key={r.id}
                              run={r}
                              variant="planned"
                              width="100%"
                              activityFilter={activityFilter}
                              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/run/${r.id}`); }}
                              onRemove={() => removePlanMutation.mutate(r.id)}
                            />
                          ))}
                        </View>
                      ) : (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
                          {filteredPlanned.map((r) => (
                            <MiniRunCard
                              key={r.id}
                              run={r}
                              variant="planned"
                              width={SCROLL_CARD_W}
                              activityFilter={activityFilter}
                              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/run/${r.id}`); }}
                              onRemove={() => removePlanMutation.mutate(r.id)}
                            />
                          ))}
                        </ScrollView>
                      )}
                    </View>
                  )}

                  {/* ── Right: Saved ── */}
                  {(!ghostBookmarkDone || sortedBookmarkedRuns.length > 0) && (
                    <View style={s.sideCol}>
                      <Text style={s.savedSectionTitle}>{activityFilter === "ride" ? "Saved Rides" : activityFilter === "walk" ? "Saved Walks" : "Saved Runs"}</Text>
                      {sortedBookmarkedRuns.length === 0 ? (
                        <View style={s.ghostSavedCard}>
                          <View style={s.savedCardTop}>
                            <Text style={s.ghostSavedCardTitle} numberOfLines={2}>Save to Explore Later</Text>
                            <Ionicons name="bookmark-outline" size={14} color={C.primary + "70"} />
                          </View>
                          <View style={s.savedCardMeta}>
                            <Feather name="calendar" size={11} color={C.textMuted} />
                            <Text style={s.ghostMetaTxt} numberOfLines={1}>Sat, Mar 14 · 7 AM</Text>
                          </View>
                          <View style={s.ghostTipRow}>
                            <Feather name="info" size={10} color={C.textMuted} />
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 3, flex: 1 }}>
                              <Text style={[s.ghostTipTxt, { flex: 0 }]}>Tap</Text>
                              <Ionicons name="bookmark-outline" size={11} color={C.textMuted} />
                              <Text style={[s.ghostTipTxt, { flex: 0 }]}>on any event</Text>
                            </View>
                          </View>
                        </View>
                      ) : sortedBookmarkedRuns.length <= 2 ? (
                        <View style={{ gap: 8 }}>
                          {sortedBookmarkedRuns.map((r) => (
                            <MiniRunCard
                              key={r.id}
                              run={r}
                              variant="saved"
                              width="100%"
                              activityFilter={activityFilter}
                              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/run/${r.id}`); }}
                              onRemove={() => bookmarkMutation.mutate(r.id)}
                            />
                          ))}
                        </View>
                      ) : (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
                          {sortedBookmarkedRuns.map((r) => (
                            <MiniRunCard
                              key={r.id}
                              run={r}
                              variant="saved"
                              width={SCROLL_CARD_W}
                              activityFilter={activityFilter}
                              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/run/${r.id}`); }}
                              onRemove={() => bookmarkMutation.mutate(r.id)}
                            />
                          ))}
                        </ScrollView>
                      )}
                    </View>
                  )}
                </View>
              );
            })()}
            {isFallback && (
              <View style={s.fallbackBanner}>
                <Feather name="info" size={13} color={C.textMuted} />
                <Text style={s.fallbackBannerTxt}>No exact matches — showing all upcoming {activityFilter === "ride" ? "rides" : activityFilter === "walk" ? "walks" : "events"}</Text>
              </View>
            )}
            <Text style={s.nearbyLabel}>{isFallback ? (activityFilter === "ride" ? "All Upcoming Rides" : activityFilter === "walk" ? "All Upcoming Walks" : "All Upcoming Events") : (activityFilter === "ride" ? "Upcoming Rides Nearby" : activityFilter === "walk" ? "Upcoming Walks Nearby" : "Upcoming Runs Nearby")}</Text>
            <WalkthroughPulse stepId="map-view" style={{ borderRadius: 16 }}>
            <Pressable
              style={s.viewOnMapBtn}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); goToMap(); }}
            >
              <Feather name="map" size={15} color={C.bg} />
              <Text style={s.viewOnMapBtnTxt}>MAP VIEW</Text>
              <Feather name="chevron-right" size={15} color={C.bg} />
            </Pressable>
            </WalkthroughPulse>
            </View>
          }
          renderItem={({ item, index }) => {
            const isLiveItem = !!item.is_active && !item.is_completed;
            const isExpanded = isLiveItem && expandedLiveId === item.id;
            return (
              <LiveCardPulseWrapper isLive={isLiveItem} isExpanded={isExpanded}>
                <WalkthroughPulse stepId={index === 0 ? "event-cards" : ""} style={{ borderRadius: 16 }}>
                <RunCard
                  run={item}
                  distanceMi={userLocation ? distanceMap[item.id] : undefined}
                  isBookmarked={bookmarkedIds.has(item.id)}
                  isFriend={friendIdSet.has(item.host_id)}
                  isCrew={!!item.crew_id}
                  walkthroughActive={walkthroughActive}
                  hidePulse={isLiveItem}
                  onBookmark={user ? () => bookmarkMutation.mutate(item.id) : undefined}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    if (isLiveItem) {
                      setExpandedLiveId((prev) => prev === item.id ? null : item.id);
                    } else {
                      router.push(`/run/${item.id}`);
                    }
                  }}
                />
                </WalkthroughPulse>
                {isExpanded && (
                  <LiveCardExpansion runId={item.id} />
                )}
              </LiveCardPulseWrapper>
            );
          }}
          ListEmptyComponent={
            search || isFiltered ? (
              <View style={s.empty}>
                <Ionicons name={activityFilter === "ride" ? "bicycle-outline" : "walk-outline"} size={44} color={C.textMuted} />
                <Text style={s.emptyTitle}>{activityFilter === "ride" ? "No rides found" : activityFilter === "walk" ? "No walks found" : "No runs found"}</Text>
                <Text style={s.emptySub}>Try adjusting your filters</Text>
                {isFiltered && (
                  <Pressable style={s.clearFiltersBtn} onPress={resetFilters}>
                    <Text style={s.clearFiltersTxt}>Clear Filters</Text>
                  </Pressable>
                )}
                {user && (user as any).gender && ((user as any).gender === "Man" || (user as any).gender === "Woman") && (
                  <Pressable
                    style={{
                      marginTop: 24, padding: 16, backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border,
                      alignItems: "center", width: "100%",
                    }}
                    onPress={() => router.push("/(tabs)/solo")}
                  >
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.primaryMuted, alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                      <Feather name="users" size={20} color={C.primary} />
                    </View>
                    <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: C.text, marginBottom: 4 }}>Find a Training Partner</Text>
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary, textAlign: "center" }}>
                      We've found athletes in your area with similar goals and pace.
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <View style={s.richEmpty}>
                {/* Host CTA */}
                <Pressable style={s.hostCtaCard} onPress={() => { if (user) setShowHostModal(true); else router.push("/login" as any); }}>
                  <View style={s.hostCtaIcon}>
                    <Feather name="map-pin" size={26} color={C.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.hostCtaTitle}>Be the first to host in your area</Text>
                    <Text style={s.hostCtaBody}>Create an event and invite others — it only takes a minute.</Text>
                  </View>
                </Pressable>
                <Pressable
                  style={s.hostCtaBtn}
                  onPress={() => { if (user) setShowHostModal(true); else router.push("/login" as any); }}
                >
                  <Feather name="plus" size={16} color={C.bg} />
                  <Text style={s.hostCtaBtnTxt}>Host a {activityFilter === "ride" ? "Ride" : activityFilter === "walk" ? "Walk" : "Run"}</Text>
                </Pressable>

                <Text style={s.communityFallback}>Be the first to create a run — others will follow.</Text>
              </View>
            )
          }
          ListFooterComponent={
            <View>
              {displayList.length > visibleCount && (
                <Pressable
                  style={s.showMoreBtn}
                  onPress={() => setVisibleCount((n) => n + 10)}
                >
                  <Text style={s.showMoreTxt}>Show more</Text>
                  <Feather name="chevron-down" size={15} color={C.primary} />
                </Pressable>
              )}
              {user && !checklistDismissed && (
                <View style={[s.checklistCard, { marginTop: 8 }]}>
                  {checklistAllDone ? (
                    <View style={{ alignItems: "center", paddingVertical: 12 }}>
                      <Ionicons name="checkmark-circle" size={28} color={C.primary} />
                      <Text style={[s.checklistHeader, { color: C.primary, marginTop: 6 }]}>You're all set!</Text>
                    </View>
                  ) : (
                    <>
                      <View style={s.checklistHeaderRow}>
                        <Text style={s.checklistHeader}>Getting started</Text>
                        <Text style={s.checklistFraction}>{completedCount} / {checklistItems.length}</Text>
                        <Pressable onPress={dismissChecklist} hitSlop={12}>
                          <Feather name="x" size={16} color={C.textMuted} />
                        </Pressable>
                      </View>
                      <View style={s.checklistBar}>
                        <View style={[s.checklistBarFill, { width: `${(completedCount / checklistItems.length) * 100}%` as any }]} />
                      </View>
                      {checklistItems.map((item, idx) => (
                        <Pressable
                          key={idx}
                          style={s.checklistItem}
                          onPress={item.done ? undefined : item.action}
                          disabled={item.done}
                        >
                          <Ionicons
                            name={item.done ? "checkmark-circle" : "ellipse-outline"}
                            size={20}
                            color={item.done ? C.primary : C.textMuted}
                          />
                          <Text style={[s.checklistLabel, item.done && s.checklistLabelDone]}>
                            {item.label}
                          </Text>
                          {!item.done && <Feather name="chevron-right" size={14} color={C.textMuted} style={{ marginLeft: "auto" }} />}
                        </Pressable>
                      ))}
                    </>
                  )}
                </View>
              )}
              {communityRuns.filter((cr: any) => cr.activity_type === activityFilter).length > 0 && (
                <View style={s.communitySection}>
                  <Text style={s.communitySectionLabel}>
                    {activityFilter === "ride" ? "Recent Rides" : activityFilter === "walk" ? "Recent Walks" : "Recent Runs"}
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 10, paddingRight: 4 }}
                  >
                    {communityRuns.filter((cr: any) => cr.activity_type === activityFilter).map((cr: any) => (
                      <View key={cr.id} style={s.communityCard}>
                        <Ionicons
                          name={cr.activity_type === "ride" ? "bicycle" : "walk"}
                          size={18}
                          color={C.primary}
                        />
                        <Text style={s.communityTitle} numberOfLines={1}>{cr.title}</Text>
                        <Text style={s.communityMeta}>
                          {cr.participant_count > 0 ? `${cr.participant_count} ${cr.activity_type === "ride" ? "rode" : cr.activity_type === "walk" ? "walked" : "ran"} this` : "Completed"}{cr.location_name ? ` · ${cr.location_name}` : ""}
                        </Text>
                        <Text style={s.communityTime}>{cr.completed_at ? formatDaysAgo(cr.completed_at) : ""}</Text>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
          }
        />
      )}

      {/* ── Filter Modal ───────────────────────────────────────────────────── */}
      <FilterModal
        visible={showFilter}
        onClose={() => setShowFilter(false)}
        draft={draft}
        setDraft={setDraft}
        onApply={applyFilters}
        onReset={resetFilters}
        userLocation={userLocation}
        sortOption={sortOption}
        setSortOption={setSortOption}
        onDistanceTouched={() => setUserHasSetDistance(true)}
      />

      {/* ── Welcome Onboarding Modal ───────────────────────────────────────────── */}
      <Modal
        visible={showOnboarding}
        transparent
        animationType="fade"
        onRequestClose={finishOnboarding}
        testID="onboarding-modal"
      >
        <View style={s.onboardOverlay} testID="onboarding-overlay">
          <View style={[s.onboardSheet, { paddingBottom: insets.bottom + 24 }]} testID="onboarding-sheet">

            {/* Swipeable slides */}
            <ScrollView
              ref={onboardScrollRef}
              horizontal
              pagingEnabled
              scrollEnabled={true}
              showsHorizontalScrollIndicator={false}
              style={s.onboardPager}
              onMomentumScrollEnd={(e) => {
                const slideW = screenWidth - 48;
                const idx = Math.round(e.nativeEvent.contentOffset.x / slideW);
                setOnboardSlide(Math.min(4, Math.max(0, idx)));
              }}
            >
              {/* Slide 0 — Welcome */}
              <ScrollView style={{ width: screenWidth - 48 }} contentContainerStyle={s.onboardContent} showsVerticalScrollIndicator={false} bounces={false}>
                <View style={s.onboardIconWrap}>
                  <Ionicons name="body" size={56} color={C.primary} />
                </View>
                <Text style={s.onboardTitle}>Welcome to PaceUp</Text>
                <Text style={s.onboardBody}>
                  Find runs and rides near you, track your progress, and build your crew.
                </Text>
              </ScrollView>

              {/* Slide 1 — Solo Runs & Rides */}
              <ScrollView style={{ width: screenWidth - 48 }} contentContainerStyle={s.onboardContent} showsVerticalScrollIndicator={false} bounces={false}>
                <View style={s.onboardIconWrap}>
                  <Ionicons name="stopwatch-outline" size={52} color={C.primary} />
                </View>
                <Text style={s.onboardTitle}>Solo Runs & Rides</Text>
                <View style={s.onboardCardGrid}>
                  {[
                    { title: "Start anytime", desc: "Launch a solo run or ride right from Discover" },
                    { title: "Live GPS tracking", desc: "See your pace and distance in real time" },
                    { title: "Automatically saved", desc: "Every activity is saved to your profile and stats" },
                    { title: "Share the effort", desc: "Post your activity and keep friends in the loop" },
                  ].map((card, i) => (
                    <View key={i} style={s.onboardMiniCard}>
                      <Text style={s.onboardMiniCardTitle}>{card.title}</Text>
                      <Text style={s.onboardMiniCardDesc}>{card.desc}</Text>
                    </View>
                  ))}
                </View>
              </ScrollView>

              {/* Slide 2 — Join Hosted Runs and Rides */}
              <ScrollView style={{ width: screenWidth - 48 }} contentContainerStyle={s.onboardContent} showsVerticalScrollIndicator={false} bounces={false}>
                <View style={s.onboardIconWrap}>
                  <Ionicons name="people-outline" size={52} color={C.primary} />
                </View>
                <Text style={s.onboardTitle}>Join Hosted Runs and Rides</Text>
                <View style={s.onboardCardGrid}>
                  {[
                    { title: "Discover nearby", desc: "Find upcoming runs and rides happening around you" },
                    { title: "Reserve your spot", desc: "Plan ahead or simply show up to be added to the live count" },
                    { title: "Run together", desc: "Follow the host or go at your own pace" },
                    { title: "See the results", desc: "Every finisher's time, pace, and distance are logged" },
                  ].map((card, i) => (
                    <View key={i} style={s.onboardMiniCard}>
                      <Text style={s.onboardMiniCardTitle}>{card.title}</Text>
                      <Text style={s.onboardMiniCardDesc}>{card.desc}</Text>
                    </View>
                  ))}
                </View>
              </ScrollView>

              {/* Slide 3 — Your Crew */}
              <ScrollView style={{ width: screenWidth - 48 }} contentContainerStyle={s.onboardContent} showsVerticalScrollIndicator={false} bounces={false}>
                <View style={s.onboardIconWrap}>
                  <Ionicons name="shield-outline" size={52} color={C.primary} />
                </View>
                <Text style={s.onboardTitle}>Your Crew</Text>
                <View style={s.onboardCardGrid}>
                  {[
                    { title: "Start or join a crew", desc: "Build your community" },
                    { title: "Crew chat", desc: "Plan runs and rides and stay connected" },
                    { title: "Group events", desc: "Schedule runs and rides together" },
                    { title: "Shared history", desc: "See everything your crew has done together" },
                  ].map((card, i) => (
                    <View key={i} style={s.onboardMiniCard}>
                      <Text style={s.onboardMiniCardTitle}>{card.title}</Text>
                      <Text style={s.onboardMiniCardDesc}>{card.desc}</Text>
                    </View>
                  ))}
                </View>
              </ScrollView>

              {/* Slide 4 — Ready */}
              <ScrollView style={{ width: screenWidth - 48 }} contentContainerStyle={s.onboardContent} showsVerticalScrollIndicator={false} bounces={false}>
                <View style={s.onboardIconWrap}>
                  <Ionicons name="trophy" size={52} color="#FFB800" />
                </View>
                <Text style={s.onboardTitle}>You're ready to go</Text>
                <Text style={s.onboardBody}>
                  Explore runs & rides near you, join a crew, or host your own. The community is waiting.
                </Text>
              </ScrollView>
            </ScrollView>

            {/* Dots */}
            <View style={s.onboardDots}>
              {[0, 1, 2, 3, 4].map((i) => (
                <View key={i} style={[s.onboardDot, onboardSlide === i && s.onboardDotActive]} />
              ))}
            </View>

            {/* CTA button */}
            {onboardSlide < 4 ? (
              <Pressable
                style={s.onboardBtn}
                onPress={() => {
                  const next = onboardSlide + 1;
                  onboardScrollRef.current?.scrollTo({ x: next * (screenWidth - 48), animated: true });
                  setOnboardSlide(next);
                }}
                testID="onboarding-next"
              >
                <Text style={s.onboardBtnTxt}>Next</Text>
                <Feather name="arrow-right" size={16} color={C.bg} />
              </Pressable>
            ) : (
              <Pressable
                style={s.onboardBtn}
                onPress={finishOnboarding}
                testID="onboarding-letsgo"
              >
                <Text style={s.onboardBtnTxt}>Let's Go</Text>
                <Feather name="arrow-right" size={16} color={C.bg} />
              </Pressable>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Notifications Modal ────────────────────────────────────────────────── */}
      <Modal
        visible={showNotifs}
        transparent
        animationType="slide"
        onRequestClose={() => setShowNotifs(false)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setShowNotifs(false)} />
        <View style={[s.notifSheet, { paddingBottom: insets.bottom + 20 }]}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={s.sheetTitle}>Notifications</Text>
              {notifCount > 0 && (
                <View style={s.countBadge}>
                  <Text style={s.countBadgeText}>{notifCount}</Text>
                </View>
              )}
            </View>
            <Pressable onPress={() => setShowNotifs(false)} hitSlop={12}>
              <Feather name="x" size={20} color={C.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}>
            {notifCount === 0 ? (
              <View style={s.emptyNotifs}>
                <Feather name="bell" size={48} color={C.textMuted} />
                <Text style={s.emptyNotifsText}>You're all caught up!</Text>
              </View>
            ) : (
              <>
                {notifData.friendRequests.length > 0 && (
                  <View style={s.notifSection}>
                    <Text style={s.notifSectionTitle}>Friend Requests</Text>
                    {notifData.friendRequests.map((req) => (
                      <View key={req.id} style={s.notifItem}>
                        {req.from_photo ? (
                          <Image source={{ uri: resolveImgUrl(req.from_photo)! }} style={s.notifAvatar} />
                        ) : (
                          <View style={s.notifAvatarFallback}>
                            <Text style={s.notifAvatarLetter}>{req.from_name?.charAt(0).toUpperCase()}</Text>
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={s.notifText}>
                            <Text style={{ fontFamily: "Outfit_600SemiBold" }}>{req.from_name}</Text> wants to be your training partner
                          </Text>
                          <View style={s.notifActions}>
                            <Pressable style={[s.notifBtn, s.notifBtnPrimary]} onPress={() => respondFriend(req.id, "accept")}>
                              <Text style={s.notifBtnText}>Accept</Text>
                            </Pressable>
                            <Pressable style={s.notifBtn} onPress={() => respondFriend(req.id, "decline")}>
                              <Text style={[s.notifBtnText, { color: C.textSecondary }]}>Decline</Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {notifData.crewInvites.length > 0 && (
                  <View style={s.notifSection}>
                    <Text style={s.notifSectionTitle}>Crew Invites</Text>
                    {notifData.crewInvites.map((inv) => (
                      <View key={inv.id} style={s.notifItem}>
                        <View style={s.notifAvatarFallback}>
                          <Text style={{ fontSize: 20 }}>{(inv as any).emoji || "🏃"}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.notifText}>
                            <Text style={{ fontFamily: "Outfit_600SemiBold" }}>{(inv as any).invited_by_name}</Text> invited you to join <Text style={{ fontFamily: "Outfit_600SemiBold" }}>{(inv as any).crew_name}</Text>
                          </Text>
                          <View style={s.notifActions}>
                            <Pressable style={[s.notifBtn, s.notifBtnPrimary]} onPress={() => respondCrew(inv.crew_id, "accept")}>
                              <Text style={s.notifBtnText}>Join</Text>
                            </Pressable>
                            <Pressable style={s.notifBtn} onPress={() => respondCrew(inv.crew_id, "decline")}>
                              <Text style={[s.notifBtnText, { color: C.textSecondary }]}>Decline</Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {notifData.hostArrivals.length > 0 && (
                  <View style={s.notifSection}>
                    <Text style={s.notifSectionTitle}>Host Has Arrived</Text>
                    {notifData.hostArrivals.map((n: any) => (
                      <Pressable
                        key={n.id}
                        style={s.notifInfoCard}
                        onPress={() => { setShowNotifs(false); router.push(`/run/${n.data.run_id}` as any); }}
                      >
                        <View style={[s.notifIconWrap, { backgroundColor: "#00D97E22" }]}>
                          <Feather name="map-pin" size={18} color={C.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.notifInfoTitle}>{n.title}</Text>
                          <Text style={s.notifInfoBody}>{n.body}</Text>
                        </View>
                        <Feather name="chevron-right" size={14} color={C.textMuted} />
                      </Pressable>
                    ))}
                  </View>
                )}

                {notifData.eventReminders.length > 0 && (
                  <View style={s.notifSection}>
                    <Text style={s.notifSectionTitle}>Upcoming</Text>
                    {notifData.eventReminders.map((n: any) => (
                      <Pressable
                        key={n.id}
                        style={s.notifInfoCard}
                        onPress={() => { setShowNotifs(false); router.push(`/run/${n.data.run_id}` as any); }}
                      >
                        <View style={[s.notifIconWrap, { backgroundColor: "#00D97E22" }]}>
                          <Feather name="clock" size={18} color={C.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.notifInfoTitle}>{n.title}</Text>
                          <Text style={s.notifInfoBody}>{n.body}</Text>
                        </View>
                        <Feather name="chevron-right" size={14} color={C.textMuted} />
                      </Pressable>
                    ))}
                  </View>
                )}

                {notifData.prNotifs.length > 0 && (
                  <View style={s.notifSection}>
                    <Text style={s.notifSectionTitle}>Personal Records</Text>
                    {notifData.prNotifs.map((n: any) => (
                      <View key={n.id} style={s.notifInfoCard}>
                        <View style={[s.notifIconWrap, { backgroundColor: "#FFB80022" }]}>
                          <Feather name="award" size={18} color="#FFB800" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.notifInfoTitle}>{n.title}</Text>
                          <Text style={s.notifInfoBody}>{n.body}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {notifData.pathShared.length > 0 && (
                  <View style={s.notifSection}>
                    <Text style={s.notifSectionTitle}>Shared Routes</Text>
                    {notifData.pathShared.map((n: any) => (
                      <Pressable
                        key={n.id}
                        style={({ pressed }) => [s.notifInfoCard, { opacity: pressed ? 0.85 : 1 }]}
                        onPress={() => {
                          if (!n.share_id) return;
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setPreviewShareId(n.share_id);
                        }}
                      >
                        <View style={[s.notifIconWrap, { backgroundColor: C.primary + "22" }]}>
                          <Feather name="map" size={18} color={C.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.notifInfoTitle}>{n.title ?? "Route shared with you"}</Text>
                          <Text style={s.notifInfoBody}>{n.body ?? n.message}</Text>
                          {n.share_id && !n.cloned && (
                            <Pressable
                              style={{ marginTop: 8, alignSelf: "flex-start", backgroundColor: C.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 }}
                              onPress={async (e) => {
                                e.stopPropagation();
                                try {
                                  await apiRequest("POST", `/api/saved-paths/${n.share_id}/clone`);
                                  qc.invalidateQueries({ queryKey: ["/api/saved-paths"] });
                                  qc.invalidateQueries({ queryKey: ["/api/notifications"] });
                                  Alert.alert("Saved!", "Route added to your Saved Paths.");
                                } catch (e: any) {
                                  Alert.alert("Error", e?.message ?? "Could not save route.");
                                }
                              }}
                            >
                              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.bg }}>Save to My Paths</Text>
                            </Pressable>
                          )}
                          {n.cloned && (
                            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, marginTop: 4 }}>Saved to your paths</Text>
                          )}
                        </View>
                        <Feather name="chevron-right" size={16} color={C.textMuted} style={{ alignSelf: "center" }} />
                      </Pressable>
                    ))}
                  </View>
                )}

                {notifData.joinRequests.length > 0 && (
                  <View style={s.notifSection}>
                    <Text style={s.notifSectionTitle}>Join Requests</Text>
                    {notifData.joinRequests.map((req) => (
                      <View key={req.id} style={s.notifItem}>
                        {req.user_photo ? (
                          <Image source={{ uri: resolveImgUrl(req.user_photo)! }} style={s.notifAvatar} />
                        ) : (
                          <View style={s.notifAvatarFallback}>
                            <Text style={s.notifAvatarLetter}>{req.user_name?.charAt(0).toUpperCase()}</Text>
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={s.notifText}>
                            <Text style={{ fontFamily: "Outfit_600SemiBold" }}>{req.user_name}</Text> wants to join your {req.activity_type === "ride" ? "ride" : req.activity_type === "walk" ? "walk" : "run"} <Text style={{ fontFamily: "Outfit_600SemiBold" }}>"{req.run_title}"</Text>
                          </Text>
                          <View style={s.notifActions}>
                            <Pressable style={[s.notifBtn, s.notifBtnPrimary]} onPress={() => respondJoin(req.id, "approve")}>
                              <Text style={s.notifBtnText}>Approve</Text>
                            </Pressable>
                            <Pressable style={s.notifBtn} onPress={() => respondJoin(req.id, "deny")}>
                              <Text style={[s.notifBtnText, { color: C.textSecondary }]}>Deny</Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* ── Host Run Modal ───────────────────────────────────────────────────── */}
      <Modal visible={showHostModal} transparent animationType="slide" onRequestClose={() => setShowHostModal(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowHostModal(false)} />
        <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "88%", backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderTopColor: C.border, paddingBottom: insets.bottom + 24 }}>

          {/* Sheet handle */}
          <View style={s.sheetHandle} />

          {/* Header */}
          <View style={s.sheetHeader}>
            {(hostPage === "location" || hostPage === "routePicker") ? (
              <Pressable style={s.sheetHeaderBtn} onPress={() => setHostPage("form")}>
                <Feather name="arrow-left" size={20} color={C.textSecondary} />
              </Pressable>
            ) : (
              <Pressable style={s.sheetHeaderBtn} onPress={() => { setShowHostModal(false); resetHostForm(); }}>
                <Feather name="x" size={20} color={C.textSecondary} />
              </Pressable>
            )}
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 17, color: C.text }}>
              {hostPage === "location" ? "Drop a Pin" : hostPage === "routePicker" ? "Saved Paths" : hActivityType === "ride" ? "Host a Ride" : hActivityType === "walk" ? "Host a Walk" : "Host a Run"}
            </Text>
            {hostPage === "location" ? (
              <Pressable
                style={[s.sheetHeaderBtn, s.sheetPostBtn]}
                onPress={() => {
                  if (pinCoord) {
                    setHLocationLat(pinCoord.latitude);
                    setHLocationLng(pinCoord.longitude);
                    const match = hSavedPaths.find(p =>
                      p.route_path && p.route_path.length > 0 &&
                      haversine(pinCoord.latitude, pinCoord.longitude, p.route_path[0].latitude, p.route_path[0].longitude) < 0.3
                    );
                    if (match) {
                      setHSavedPathId(match.id);
                      setHSavedPathName(match.name);
                      if (match.distance_miles) setHDist(match.distance_miles.toFixed(2));
                    } else {
                      setHSavedPathId(null);
                      setHSavedPathName(null);
                    }
                  }
                  setHostPage("form");
                  Haptics.selectionAsync();
                }}
              >
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 14, color: C.bg }}>Done</Text>
              </Pressable>
            ) : hostPage === "routePicker" ? (
              <View style={s.sheetHeaderBtn} />
            ) : (
              <Pressable
                style={[s.sheetHeaderBtn, s.sheetPostBtn, createRunMutation.isPending && { opacity: 0.6 }]}
                onPress={() => createRunMutation.mutate()}
                disabled={createRunMutation.isPending}
              >
                {createRunMutation.isPending
                  ? <ActivityIndicator size="small" color={C.bg} />
                  : <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 14, color: C.bg }}>Post</Text>}
              </Pressable>
            )}
          </View>

          {hostPage === "location" && (
            <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 8 }}>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary, marginBottom: 12 }}>
                Tap anywhere on the map to set the meeting point.
              </Text>
              {Platform.OS !== "web" && pinCoord ? (
                <MapView
                  style={{ height: 360, borderRadius: 14, overflow: "hidden" }}
                  initialRegion={{
                    latitude: pinCoord.latitude,
                    longitude: pinCoord.longitude,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                  }}
                  onPress={(e) => {
                    const coord = e.nativeEvent.coordinate;
                    setPinCoord(coord);
                    reverseGeocode(coord.latitude, coord.longitude);
                  }}
                >
                  <Marker coordinate={pinCoord} pinColor={C.primary} />
                </MapView>
              ) : (
                <View style={{ height: 280, borderRadius: 14, backgroundColor: C.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border }}>
                  <Feather name="map" size={32} color={C.textMuted} />
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textMuted, marginTop: 8 }}>Map picker on mobile only</Text>
                </View>
              )}
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary, marginTop: 16, marginBottom: 6 }}>Location Name</Text>
              <TextInput
                style={s.hInput}
                value={hLocation}
                onChangeText={setHLocation}
                placeholder={isGeocodingPin ? "Getting address…" : "e.g. Riverside Park North Entrance"}
                placeholderTextColor={C.textMuted}
                editable={!isGeocodingPin}
              />
            </View>
          )}
          {hostPage === "routePicker" && (
            <View style={{ flex: 1 }}>
              {/* Search */}
              <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, marginHorizontal: 16, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, gap: 8, marginBottom: 12 }}>
                <Feather name="search" size={14} color={C.textMuted} />
                <TextInput
                  style={{ flex: 1, fontFamily: "Outfit_400Regular", fontSize: 14, color: C.text }}
                  placeholder="Search paths…"
                  placeholderTextColor={C.textMuted}
                  value={hRouteSearch}
                  onChangeText={setHRouteSearch}
                  autoCorrect={false}
                />
                {hRouteSearch.length > 0 && (
                  <Pressable onPress={() => setHRouteSearch("")} hitSlop={8}>
                    <Feather name="x-circle" size={14} color={C.textMuted} />
                  </Pressable>
                )}
              </View>
              {/* Toggle */}
              <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 14 }}>
                {(["recent", "az"] as const).map((f) => (
                  <Pressable
                    key={f}
                    onPress={() => { setHRouteFilter(f); Haptics.selectionAsync(); }}
                    style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: hRouteFilter === f ? C.primary : C.border, backgroundColor: hRouteFilter === f ? C.primaryMuted : C.surface }}
                  >
                    <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 12, color: hRouteFilter === f ? C.primary : C.textMuted }}>
                      {f === "recent" ? "Recent" : "A–Z"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {/* List */}
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingBottom: 8 }}>
                {(() => {
                  let paths = hSavedPaths.filter(p => p.activity_type === hActivityType);
                  if (hRouteSearch.trim()) paths = paths.filter(p => p.name.toLowerCase().includes(hRouteSearch.toLowerCase()));
                  if (hRouteFilter === "az") paths = [...paths].sort((a, b) => a.name.localeCompare(b.name));
                  if (paths.length === 0) return (
                    <View style={{ alignItems: "center", paddingVertical: 32, gap: 8 }}>
                      <Feather name="map" size={32} color={C.border} />
                      <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textMuted }}>
                        {hRouteSearch ? "No paths match your search" : `No saved ${hActivityType} paths yet`}
                      </Text>
                    </View>
                  );
                  return paths.map((p) => (
                    <Pressable
                      key={p.id}
                      style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: p.id === hSavedPathId ? C.primary : C.border, padding: 10 }}
                      onPress={() => {
                        setHSavedPathId(p.id);
                        setHSavedPathName(p.name);
                        if (p.distance_miles) setHDist(p.distance_miles.toFixed(2));
                        if (p.route_path && p.route_path.length > 0) {
                          const start = p.route_path[0];
                          setHLocationLat(start.latitude);
                          setHLocationLng(start.longitude);
                          setPinCoord({ latitude: start.latitude, longitude: start.longitude });
                          reverseGeocode(start.latitude, start.longitude);
                        }
                        setHostPage("form");
                        Haptics.selectionAsync();
                      }}
                    >
                      <RouteThumb path={p.route_path} primary={C.primary} size={60} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.text }} numberOfLines={1}>{p.name}</Text>
                        {p.distance_miles != null && (
                          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, marginTop: 2 }}>{toDisplayDist(p.distance_miles, distUnit)}</Text>
                        )}
                      </View>
                      {p.id === hSavedPathId
                        ? <Feather name="check-circle" size={18} color={C.primary} />
                        : <Feather name="chevron-right" size={16} color={C.textMuted} />
                      }
                    </Pressable>
                  ));
                })()}
              </ScrollView>
            </View>
          )}

          {hostPage === "form" && (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={s.sheetForm}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Activity Type */}
            <Text style={s.hLabel}>Activity Type</Text>
            <View style={s.activityToggleRow}>
              <Pressable
                style={[s.activityPill, hActivityType === "run" && s.activityPillActive, { flex: 1 }]}
                onPress={() => { setHActivityType("run"); setHMinPace((p) => Math.max(4, p)); Haptics.selectionAsync(); }}
              >
                <Ionicons name="body" size={14} color={hActivityType === "run" ? C.bg : C.textMuted} />
                <Text style={[s.activityPillTxt, hActivityType === "run" && s.activityPillTxtActive]}>Run</Text>
              </Pressable>
              <Pressable
                style={[s.activityPill, hActivityType === "ride" && s.activityPillActive, { flex: 1 }]}
                onPress={() => { setHActivityType("ride"); Haptics.selectionAsync(); }}
              >
                <Ionicons name="bicycle" size={14} color={hActivityType === "ride" ? C.bg : C.textMuted} />
                <Text style={[s.activityPillTxt, hActivityType === "ride" && s.activityPillTxtActive]}>Ride</Text>
              </Pressable>
              <Pressable
                style={[s.activityPill, hActivityType === "walk" && s.activityPillActive, { flex: 1 }]}
                onPress={() => { setHActivityType("walk"); Haptics.selectionAsync(); }}
              >
                <Ionicons name="footsteps" size={14} color={hActivityType === "walk" ? C.bg : C.textMuted} />
                <Text style={[s.activityPillTxt, hActivityType === "walk" && s.activityPillTxtActive]}>Walk</Text>
              </Pressable>
            </View>

            {/* Title */}
            <Text style={s.hLabel}>{hActivityType === "ride" ? "Ride Title *" : hActivityType === "walk" ? "Walk Title *" : "Run Title *"}</Text>
            <TextInput
              style={s.hInput}
              value={hTitle}
              onChangeText={setHTitle}
              placeholder={hActivityType === "ride" ? "e.g. Sunday Morning Group Ride" : hActivityType === "walk" ? "e.g. Morning Walk Around the Park" : "e.g. Morning 5K in the Park"}
              placeholderTextColor={C.textMuted}
              maxLength={60}
            />

            {/* Location */}
            <Text style={s.hLabel}>Location *</Text>
            <Pressable
              style={[s.hInput, { flexDirection: "row", alignItems: "center", gap: 10 }]}
              onPress={() => {
                setPinCoord(hLocationLat !== null ? { latitude: hLocationLat, longitude: hLocationLng! } : (userLocation ?? { latitude: 40.7128, longitude: -74.006 }));
                setHostPage("location");
              }}
            >
              <Feather name="map-pin" size={16} color={hLocation ? C.primary : C.textMuted} />
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: hLocation ? C.text : C.textMuted, flex: 1 }} numberOfLines={1}>
                {hLocation || "Tap to drop a pin on the map"}
              </Text>
              {hLocation ? <Feather name="edit-2" size={14} color={C.textMuted} /> : null}
            </Pressable>

            {/* Date + Time */}
            <Text style={s.hLabel}>Date & Time *</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}><MiniCalendarPicker value={hDate} onChange={setHDate} /></View>
              <View style={{ flex: 1, flexDirection: "row", gap: 6, alignSelf: "flex-start" }}>
                <TextInput
                  style={[s.hInput, { flex: 1 }]}
                  value={hTime}
                  onChangeText={handleTimeChange}
                  placeholder="7:30"
                  placeholderTextColor={C.textMuted}
                  keyboardType="number-pad"
                  maxLength={5}
                />
                <View style={{ flexDirection: "column", gap: 4 }}>
                  {(["AM", "PM"] as const).map((period) => (
                    <Pressable
                      key={period}
                      style={{ flex: 1, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, alignItems: "center", justifyContent: "center", backgroundColor: hAmPm === period ? C.primaryMuted : C.card, borderColor: hAmPm === period ? C.primary : C.border }}
                      onPress={() => { setHAmPm(period); Haptics.selectionAsync(); }}
                    >
                      <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 12, color: hAmPm === period ? C.primary : C.textSecondary }}>{period}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>

            {/* Privacy */}
            <Text style={s.hLabel}>View</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
              {([
                { val: "public",  icon: "globe"   as const, label: "Public",       desc: "Anyone can join" },
                { val: "friends", icon: "users"   as const, label: "Friends Only",  desc: "Your friends see this" },
                { val: "crew",    icon: "shield"  as const, label: "Crew",          desc: "Crew members only" },
              ] as { val: "public" | "friends" | "crew"; icon: "globe" | "users" | "shield"; label: string; desc: string }[]).map((opt) => (
                <Pressable
                  key={opt.val}
                  style={[s.hPrivOpt, { flex: 1 }, hPrivacy === opt.val && s.hPrivOptActive]}
                  onPress={() => {
                    setHPrivacy(opt.val);
                    if (opt.val !== "crew") setHCrewId(null);
                    Haptics.selectionAsync();
                  }}
                >
                  <Feather name={opt.icon} size={15} color={hPrivacy === opt.val ? C.primary : C.textSecondary} />
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 12, color: hPrivacy === opt.val ? C.primary : C.textSecondary, marginTop: 4 }}>{opt.label}</Text>
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 10, color: C.textMuted, marginTop: 2, textAlign: "center" }}>{opt.desc}</Text>
                </Pressable>
              ))}
            </View>

            {/* Crew picker (crew only) */}
            {hPrivacy === "crew" && myCrews.length > 0 && (
              <>
                <Text style={[s.hLabel, { marginTop: 12 }]}>Select Crew</Text>
                <View style={{ gap: 6, marginBottom: 4 }}>
                  {myCrews.map((crew) => {
                    const active = hCrewId === crew.id;
                    return (
                      <Pressable
                        key={crew.id}
                        style={[s.crewPickRow, active && s.crewPickRowActive]}
                        onPress={() => { setHCrewId(crew.id); Haptics.selectionAsync(); }}
                      >
                        <Text style={s.crewPickEmoji}>{crew.emoji ?? "🏃"}</Text>
                        <Text style={[s.crewPickName, active && { color: C.primary }]}>{crew.name}</Text>
                        {active && <Feather name="check-circle" size={16} color={C.primary} />}
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
            {hPrivacy === "crew" && myCrews.length === 0 && (
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, marginTop: 6, marginBottom: 4 }}>
                You're not in any crews yet. Join or create one from the Crew tab.
              </Text>
            )}

            {/* Strict Mode */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: C.card, borderRadius: 12, padding: 14 }}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text }}>Strict Mode</Text>
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, marginTop: 2 }}>
                  {hActivityType === "ride"
                    ? "Riders avg. pace must be within set range AND have a recent ride covering 70% of the planned distance"
                    : "Runners avg. pace must be within set range AND have a recent run covering 70% of the planned distance"}
                </Text>
              </View>
              <View style={{ borderWidth: !hStrict ? 2 : 0, borderColor: C.primary, borderRadius: 20, padding: 2 }}>
                <Switch
                  value={hStrict}
                  onValueChange={(v) => { setHStrict(v); Haptics.selectionAsync(); }}
                  trackColor={{ false: C.textMuted, true: C.primary }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </View>

            {/* Max Runners */}
            <Text style={s.hLabel}>{hActivityType === "ride" ? "Max Riders" : hActivityType === "walk" ? "Max Walkers" : "Max Runners"}</Text>
            <View style={s.hStepper}>
              <Pressable
                style={[s.hStepBtn, hMaxParticipants <= 1 && hMaxParticipants !== 0 && { opacity: 0.4 }]}
                onPress={() => stepParticipants(-1)}
                disabled={hMaxParticipants <= 1 && hMaxParticipants !== 0}
              >
                <Feather name="minus" size={18} color={C.primary} />
              </Pressable>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text, minWidth: 90, textAlign: "center" }}>
                {hMaxParticipants === 0 ? "Unlimited" : hMaxParticipants}
              </Text>
              <Pressable style={s.hStepBtn} onPress={() => stepParticipants(1)}>
                <Feather name="plus" size={18} color={C.primary} />
              </Pressable>
            </View>

            {/* Route + Planned Distance — side by side */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.hLabel}>Route (optional)</Text>
                {hSavedPathId ? (
                  <Pressable
                    style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.primaryMuted, borderRadius: 12, borderWidth: 1, borderColor: C.primary + "55", paddingHorizontal: 12, paddingVertical: 10 }}
                    onPress={() => { setHSavedPathId(null); setHSavedPathName(null); Haptics.selectionAsync(); }}
                  >
                    <Feather name="map" size={13} color={C.primary} />
                    <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary, flex: 1 }} numberOfLines={1}>{hSavedPathName}</Text>
                    <Feather name="x" size={13} color={C.primary} />
                  </Pressable>
                ) : (
                  <Pressable
                    style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10 }}
                    onPress={() => { setHostPage("routePicker"); Haptics.selectionAsync(); }}
                  >
                    <Feather name="map" size={13} color={C.textMuted} />
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textMuted }}>Saved Paths</Text>
                  </Pressable>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.hLabel}>Planned Distance (mi)</Text>
                <TextInput
                  style={s.hInput}
                  value={hDist}
                  onChangeText={setHDist}
                  placeholder="e.g. 3.1"
                  placeholderTextColor={C.textMuted}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            {/* Pace Range */}
            <View style={fm.sectionHead}>
              <Text style={s.hLabel}>
                {hActivityType === "ride" ? "Speed Range (mph) · Riders" : hActivityType === "walk" ? "Pace Range (Min/Mile) · Walkers" : "Pace Range (Min/Mile) · Runners"}
              </Text>
              {hActivityType === "ride"
                ? <Text style={fm.sectionValue}>{(60 / hMaxPace).toFixed(1)} – {(60 / hMinPace).toFixed(1)} mph</Text>
                : <Text style={fm.sectionValue}>{formatPaceMM(hMinPace)} – {formatPaceMM(hMaxPace)}</Text>}
            </View>
            <RangeSlider
              min={PACE_SLIDER_MIN} max={PACE_SLIDER_MAX} step={0.5}
              low={hMinPace} high={hMaxPace}
              onLowChange={(v) => setHMinPace(v)}
              onHighChange={(v) => setHMaxPace(v)}
              color={C.primary}
              trackColor={C.border}
            />
            <View style={fm.edgeRow}>
              <Text style={fm.edgeLabel}>{hActivityType === "ride" ? `${(60 / PACE_SLIDER_MIN).toFixed(1)} mph` : "4:00"}</Text>
              <Text style={fm.edgeLabel}>{hActivityType === "ride" ? `${(60 / PACE_SLIDER_MAX).toFixed(1)} mph` : "20:00"}</Text>
            </View>

            {/* Host Style */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={s.hLabel}>Host Style</Text>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted }}>(select all that apply)</Text>
            </View>
            {(hActivityType === "ride" ? RUN_STYLE_CATEGORIES_RIDE : hActivityType === "walk" ? RUN_STYLE_CATEGORIES_WALK : RUN_STYLE_CATEGORIES_RUN).map(function(cat) {
              return (
                <View key={cat.label} style={{ marginTop: 14 }}>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: "#3D6B50", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>{cat.label}</Text>
                  <View style={s.hTagRow}>
                    {cat.options.map(function(v) {
                      const active = hTags.includes(v);
                      return (
                        <Pressable
                          key={v}
                          style={[s.hTag, active && s.hTagActive]}
                          onPress={() => {
                            setHTags((prev) => prev.includes(v) ? prev.filter((t) => t !== v) : [...prev, v]);
                            Haptics.selectionAsync();
                          }}
                        >
                          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: active ? C.primary : C.textSecondary }}>{v}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </ScrollView>
          )}
        </View>
      </Modal>

      {/* ── Community Rules Modal ──────────────────────────────────────────────
           NOTE: The closing )} above closes {hostPage === "form" && (        */}
      <Modal visible={showRulesModal} transparent animationType="slide" onRequestClose={() => setShowRulesModal(false)}>
        <View style={s.modalWrap}>
        <Pressable style={s.modalOverlay} onPress={() => setShowRulesModal(false)} />
        <View style={[s.modalSheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>{activityFilter === "ride" ? "Ride Host Guidelines" : activityFilter === "walk" ? "Walk Host Guidelines" : "Run Host Guidelines"}</Text>
            <Pressable style={s.sheetHeaderBtn} onPress={() => setShowRulesModal(false)}>
              <Feather name="x" size={18} color={C.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            <Text style={s.rulesIntro}>
              {activityFilter === "ride"
                ? "By hosting a ride on PaceUp, you agree to uphold these community standards. Every rider deserves a safe and welcoming experience."
                : activityFilter === "walk"
                ? "By hosting a walk on PaceUp, you agree to uphold these community standards. Every walker deserves a safe and welcoming experience."
                : "By hosting a run on PaceUp, you agree to uphold these community standards. Every runner deserves a safe and welcoming experience."}
            </Text>

            {(activityFilter === "ride" ? [
              { icon: "heart" as const,      title: "Be kind and respectful",       body: "Treat every rider with courtesy. No one should feel unwelcome or judged on your ride." },
              { icon: "clock" as const,       title: "Be on time",                   body: "Start and finish as scheduled. If something comes up, notify your group as early as possible." },
              { icon: "target" as const,      title: "Set honest expectations",      body: "List accurate pace and distance ranges. Don't drop riders who joined based on your stated criteria." },
              { icon: "shield" as const,      title: "Prioritize safety",            body: "Choose safe routes. Call out hazards, watch for traffic, and look after the wellbeing of all riders." },
              { icon: "users" as const,       title: "Ride together",                body: "Wait at intersections and regroup regularly. A great host makes sure everyone arrives, not just the front." },
              { icon: "x-circle" as const,    title: "Cancel responsibly",           body: "If you can't make it, cancel your ride well in advance so riders can adjust their plans." },
            ] : activityFilter === "walk" ? [
              { icon: "heart" as const,      title: "Be kind and respectful",       body: "Treat every walker with courtesy. No one should feel unwelcome or judged on your walk." },
              { icon: "clock" as const,       title: "Be on time",                   body: "Start and finish as scheduled. If something comes up, notify your group as early as possible." },
              { icon: "target" as const,      title: "Set honest expectations",      body: "List accurate pace and distance ranges. Don't leave walkers behind who joined based on your stated criteria." },
              { icon: "shield" as const,      title: "Prioritize safety",            body: "Choose safe routes. Watch out for traffic, uneven terrain, and the wellbeing of all participants." },
              { icon: "users" as const,       title: "Walk together",                body: "Check in on slower walkers. A great host makes sure everyone finishes, not just those at the front." },
              { icon: "x-circle" as const,    title: "Cancel responsibly",           body: "If you can't make it, cancel your walk well in advance so participants can adjust their plans." },
            ] : [
              { icon: "heart" as const,      title: "Be kind and respectful",       body: "Treat every participant with courtesy. No one should feel unwelcome or judged on your run." },
              { icon: "clock" as const,       title: "Be on time",                   body: "Start and finish as scheduled. If something comes up, notify your group as early as possible." },
              { icon: "target" as const,      title: "Set honest expectations",      body: "List accurate pace and distance ranges. Don't leave participants behind who joined based on your stated criteria." },
              { icon: "shield" as const,      title: "Prioritize safety",            body: "Choose safe routes. Watch out for traffic, uneven terrain, and the wellbeing of all participants." },
              { icon: "users" as const,       title: "Leave no one behind",          body: "Check in on slower participants. A great host makes sure everyone finishes, not just the front of the pack." },
              { icon: "x-circle" as const,    title: "Cancel responsibly",           body: "If you can't make it, cancel your run well in advance so participants can adjust their plans." },
            ]).map((rule) => (
              <View key={rule.title} style={s.ruleRow}>
                <View style={s.ruleIcon}>
                  <Feather name={rule.icon} size={16} color={C.primary} />
                </View>
                <View style={s.ruleText}>
                  <Text style={s.ruleTitle}>{rule.title}</Text>
                  <Text style={s.ruleBody}>{rule.body}</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={s.rulesFooter}>
            <Pressable
              style={s.rulesAgreeBtn}
              onPress={() => {
                setShowRulesModal(false);
                setHActivityType(activityFilter);
                setShowHostModal(true);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              }}
            >
              <Text style={s.rulesAgreeTxt}>I Agree — Continue</Text>
            </Pressable>
          </View>
        </View>
        </View>
      </Modal>

      {/* ── Solo Run FAB ─────────────────────────────────────────────────────── */}
      {Platform.OS === "web" ? (
        <WebFAB onPress={() => router.push("/run-tracking" as any)} />
      ) : (
        <Pressable
          testID="map-fab"
          style={[s.fab, { bottom: insets.bottom + 92 }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push("/run-tracking" as any);
          }}
        >
          <Ionicons name="stopwatch-outline" size={28} color={C.bg} />
        </Pressable>
      )}

      <SharedPathPreviewModal
        visible={!!previewShareId}
        shareId={previewShareId}
        onClose={() => setPreviewShareId(null)}
        distUnit={distUnit}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(C: ColorScheme) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: { paddingHorizontal: 20, paddingBottom: 12 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: { fontFamily: "Nunito_800ExtraBold", fontSize: 36, color: C.text },

  headerBtns: { flexDirection: "row", alignItems: "center", gap: 6 },

  hBtn: {
    width: 38,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.primaryMuted,
    borderWidth: 1.5,
    borderColor: C.primary + "66",
    alignItems: "center",
    justifyContent: "center",
  },
  hBtnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 36,
    paddingHorizontal: 11,
    borderRadius: 10,
    backgroundColor: C.primaryMuted,
    borderWidth: 1.5,
    borderColor: C.primary + "66",
  },
  hBtnActive: { borderColor: C.primary, backgroundColor: C.primaryMuted },
  notifBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.primary,
    borderWidth: 1.5,
    borderColor: C.bg,
  },
  dmDot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.primary,
  },
  notifSheet: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "75%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 20,
  },
  sheetTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 20,
    color: C.text,
  },
  countBadge: {
    backgroundColor: C.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countBadgeText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 12,
    color: "#FFF",
  },
  notifSection: {
    marginTop: 20,
  },
  notifSectionTitle: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.textSecondary,
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  notifItem: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: C.card,
    padding: 12,
    borderRadius: 16,
    marginBottom: 8,
  },
  notifAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  notifAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  notifAvatarLetter: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: C.textSecondary,
  },
  notifText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.text,
    lineHeight: 20,
  },
  notifActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  notifBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: C.border,
  },
  notifBtnPrimary: {
    backgroundColor: C.primary,
  },
  notifBtnText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: "#FFF",
  },
  notifInfoCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.card,
    padding: 12,
    borderRadius: 16,
    marginBottom: 8,
  },
  notifIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  notifInfoTitle: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.text,
    marginBottom: 2,
  },
  notifInfoBody: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.textSecondary,
    lineHeight: 18,
  },
  emptyNotifs: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  emptyNotifsText: {
    fontFamily: "Outfit_500Medium",
    fontSize: 16,
    color: C.textMuted,
    marginTop: 12,
  },
  hBtnTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.text },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.primary,
    position: "absolute",
    top: 5,
    right: 5,
  },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: C.primary + "33",
    paddingHorizontal: 13,
    height: 44,
    gap: 10,
  },
  searchInput: { flex: 1, fontFamily: "Outfit_400Regular", fontSize: 14, color: C.text },

  activityToggleRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  activityPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border,
  },
  activityPillActive: { backgroundColor: C.primary, borderColor: C.primary },
  activityPillTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textMuted },
  activityPillTxtActive: { color: C.bg },
  filterToggleBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.surface,
    borderWidth: 1.5, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
    marginLeft: "auto" as any,
    ...(Platform.OS === "android" && { marginRight: -8 }),
  },

  list: { paddingHorizontal: 16, paddingTop: 10, gap: 10 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  liveCardGlow: {
    position: "absolute", top: -2, left: -2, right: -2, bottom: -2,
    borderRadius: 16, borderWidth: 2, borderColor: "#C0392B",
    shadowColor: "#C0392B", shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 10,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  cardFriend: {
    backgroundColor: C.card,
    borderColor: C.primary + "44",
  },
  cardCrew: {
    backgroundColor: C.card,
    borderColor: C.text + "BB",
    borderWidth: 2,
  },
  cardBody: { flexDirection: "row", alignItems: "stretch", gap: 12 },
  hostColumn: { width: 66, alignItems: "center", gap: 4, paddingTop: 2 },
  cardDivider: { width: 1, backgroundColor: C.border },
  cardDetails: { flex: 1, gap: 8 },
  cardTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.text, flex: 1, lineHeight: 20 },
  cardTitleRight: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 2 },
  cardBookmarkBtn: { padding: 2 },
  savedSection: { marginBottom: 16 },
  savedSectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.text, marginBottom: 10 },
  nearbyLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary, marginBottom: 10 },
  fallbackBanner: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: C.surface, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  fallbackBannerTxt: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, flex: 1 },
  viewOnMapBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: C.primary,
    marginBottom: 7,
  },
  viewOnMapBtnTxt: { fontFamily: "Outfit_700Bold", fontSize: 17, color: C.bg, flex: 1, textAlign: "center", letterSpacing: 0.5 },
  sideBySideRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
    alignItems: "flex-start",
  },
  sideCol: {
    flex: 1,
    overflow: "hidden",
    gap: 6,
  },
  savedScroll: { gap: 10, paddingRight: 4 },
  savedCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
    gap: 6,
  },
  savedCardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 6 },
  savedCardTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.text, flex: 1, lineHeight: 18 },
  savedCardMeta: { flexDirection: "row", alignItems: "center", gap: 5 },
  savedCardMetaTxt: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textSecondary, flex: 1 },
  ghostSavedCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: "dashed",
    opacity: 0.95,
    gap: 6,
  },
  ghostSavedCardTitle: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textMuted, flex: 1, lineHeight: 18 },
  ghostPlannedCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: "dashed",
    opacity: 0.95,
    gap: 6,
  },
  ghostPlannedLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: C.textMuted, flex: 1 },
  ghostPlannedTitle: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.textMuted, lineHeight: 19 },
  ghostMetaTxt: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted, flex: 1 },
  ghostTipRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  ghostTipTxt: { fontFamily: "Outfit_400Regular", fontSize: 10, color: C.textMuted, flex: 1 },
  plannedCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: C.primary + "44",
    gap: 6,
  },
  plannedCardHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  plannedDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.primary },
  plannedLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: C.primary, flex: 1 },
  plannedCardTitle: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.text, lineHeight: 19 },
  plannedPace: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  plannedPaceTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: C.orange },
  urgentBadge: {
    backgroundColor: C.orange + "20",
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: C.orange + "40",
  },
  urgentText: { fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.orange },
  livePill: {
    backgroundColor: C.primary + "22",
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: C.primary + "55",
  },
  livePillTxt: { fontFamily: "Outfit_700Bold", fontSize: 10, color: C.primary },
  hostAvatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.primaryMuted },
  hostAvatarFallback: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.primaryMuted, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.primary + "55" },
  hostAvatarLetter: { fontFamily: "Outfit_700Bold", fontSize: 20, color: C.primary },
  hostColumnName: { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: C.text, textAlign: "center" },
  hostColumnRating: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.gold, textAlign: "center" },
  hostColumnBadge: { fontFamily: "Outfit_600SemiBold", fontSize: 10, textAlign: "center" },
  crewBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: C.primaryMuted, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginTop: 3, alignSelf: "center" as const },
  crewBadgeEmoji: { fontSize: 10 },
  crewBadgeName: { fontFamily: "Outfit_600SemiBold", fontSize: 9, color: C.primary, maxWidth: 60 },
  hostColumnDist: { fontFamily: "Outfit_700Bold", fontSize: 13, color: C.text, textAlign: "center", marginTop: 2 },
  hostColumnWeather: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted, textAlign: "center", marginTop: 3 },

  cardMeta: { gap: 3 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary, flex: 1 },
  joinCrewCta: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: `${C.primary}18`, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 },
  joinCrewCtaTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.primary, flex: 1 },

  cardStats: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  stat: { flexDirection: "row", alignItems: "center", gap: 3, flex: 1, minWidth: 0 },
  statLg: { flexDirection: "row", alignItems: "center", gap: 3, flex: 4, minWidth: 0 },
  statSm: { flexDirection: "row", alignItems: "center", gap: 3, flex: 2, minWidth: 0 },
  statLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 11, color: C.text, flexShrink: 1 },
  statUnit: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },
  statDiv: { width: 1, height: 24, backgroundColor: C.border },
  statPill: { flex: 1, alignItems: "center", gap: 2 },
  statPillPace: { width: 96, alignItems: "center", gap: 2 },
  statPillValue: { fontFamily: "Outfit_700Bold", fontSize: 12, color: C.text },
  statPillLabel: { fontFamily: "Outfit_400Regular", fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.3 },

  tagsScroll: { marginTop: 2 },
  tags: { flexDirection: "row", gap: 5 },
  showMoreBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingVertical: 14, marginBottom: 4,
    borderWidth: 1, borderColor: C.border, borderRadius: 12,
    backgroundColor: C.card,
  },
  showMoreTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.primary },
  tag: {
    backgroundColor: C.card,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  tagTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.textSecondary },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 10 },
  emptyTitle: { fontFamily: "Outfit_700Bold", fontSize: 17, color: C.text },
  emptySub: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.textSecondary,
    textAlign: "center",
    paddingHorizontal: 40,
  },
  clearFiltersBtn: {
    marginTop: 4,
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.primary,
  },
  clearFiltersTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },

  // ─── Rich Empty State ─────────────────────────────────────────────────────
  richEmpty: { paddingTop: 24 },
  hostCtaCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    borderLeftWidth: 3,
    borderLeftColor: C.primary,
    marginBottom: 12,
  },
  hostCtaIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#00D97E18",
    alignItems: "center",
    justifyContent: "center",
  },
  hostCtaTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 15,
    color: C.text,
    marginBottom: 4,
  },
  hostCtaBody: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.textSecondary,
    lineHeight: 18,
  },
  hostCtaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 13,
    marginBottom: 24,
  },
  hostCtaBtnTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 15,
    color: C.bg,
  },
  communitySection: { marginBottom: 16 },
  communitySectionLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  communityCard: {
    width: 160,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  communityTitle: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.text,
  },
  communityMeta: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: C.textSecondary,
  },
  communityTime: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: C.textMuted,
    marginTop: 2,
  },
  communityFallback: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.textMuted,
    textAlign: "center",
    paddingVertical: 16,
  },

  // ─── Checklist Card ───────────────────────────────────────────────────────
  checklistCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderTopWidth: 1,
    borderTopColor: C.primary,
  },
  checklistHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    gap: 8,
  },
  checklistHeader: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.text,
    flex: 1,
  },
  checklistFraction: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: C.textMuted,
  },
  checklistBar: {
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    marginBottom: 10,
    overflow: "hidden",
  },
  checklistBarFill: {
    height: 4,
    backgroundColor: C.primary,
    borderRadius: 2,
  },
  checklistItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  checklistLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.text,
    flex: 1,
  },
  checklistLabelDone: {
    color: C.textMuted,
    textDecorationLine: "line-through",
  },

  // ─── Onboarding Modal ─────────────────────────────────────────────────────
  onboardOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "flex-end",
  },
  onboardSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  onboardPager: {
    flexGrow: 0,
  },
  onboardSkip: {
    position: "absolute",
    top: 16,
    right: 24,
    zIndex: 10,
  },
  onboardSkipTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textMuted,
  },
  onboardContent: {
    alignItems: "center",
    paddingTop: 24,
    paddingBottom: 20,
    gap: 12,
  },
  onboardIconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#00D97E14",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  onboardTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 24,
    color: C.text,
    textAlign: "center",
  },
  onboardBody: {
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  onboardCardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    width: "100%",
    marginTop: 4,
  },
  onboardMiniCard: {
    width: "47.5%",
    backgroundColor: "#00D97E14",
    borderRadius: 14,
    padding: 14,
    gap: 5,
    borderWidth: 1,
    borderColor: "#00D97E22",
  },
  onboardMiniCardTitle: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.text,
  },
  onboardMiniCardDesc: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: C.textMuted,
    lineHeight: 17,
  },
  onboardDots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginBottom: 20,
  },
  onboardDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.border,
  },
  onboardDotActive: {
    backgroundColor: C.primary,
    width: 20,
  },
  onboardBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  onboardBtnTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: C.bg,
  },
  // ─── FAB ──────────────────────────────────────────────────────────────────
  fabLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
  },
  fab: {
    position: "absolute",
    right: 20,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },

  // ─── Host Modal ──────────────────────────────────────────────────────────
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  modalWrap: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: C.border,
    maxHeight: "90%",
    flex: 1,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  sheetHeaderBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetPostBtn: {
    backgroundColor: C.primary,
    paddingHorizontal: 14,
    width: "auto",
  },
  sheetForm: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
    gap: 4,
  },
  hLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.textSecondary,
    marginBottom: 8,
    marginTop: 14,
  },
  hInput: {
    backgroundColor: C.card,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.text,
  },
  hPrivOpt: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    alignItems: "center",
  },
  hPrivOptActive: {
    backgroundColor: C.primaryMuted,
    borderColor: C.primary,
  },
  crewPickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  crewPickRowActive: {
    borderColor: C.primary,
    backgroundColor: C.primaryMuted,
  },
  crewPickEmoji: {
    fontSize: 18,
  },
  crewPickName: {
    flex: 1,
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.text,
  },
  hStepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  hStepBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  hTagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  hTag: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  hTagActive: {
    backgroundColor: C.primaryMuted,
    borderColor: C.primary,
  },

  hPaceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  hPaceLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.textSecondary,
    width: 56,
  },

  rulesIntro: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textSecondary,
    lineHeight: 21,
    marginHorizontal: 24,
    marginTop: 4,
    marginBottom: 20,
  },
  ruleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    marginHorizontal: 24,
    marginBottom: 18,
  },
  ruleIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: C.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  ruleText: { flex: 1 },
  ruleTitle: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.text, marginBottom: 2 },
  ruleBody: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  rulesFooter: {
    paddingHorizontal: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  rulesAgreeBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.primary,
  },
  rulesAgreeTxt: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.bg },
}); }

// ─── Filter Modal Styles ──────────────────────────────────────────────────────

function makeFmStyles(C: ColorScheme) { return StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: C.borderLight,
    maxHeight: "90%",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  title: { fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
  },

  scrollContent: { paddingBottom: 8 },

  section: { paddingHorizontal: 20, paddingVertical: 16 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  sectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.text },
  sectionValue: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },

  distRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 14,
  },
  distField: { flex: 1 },
  distLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: C.textMuted,
    marginBottom: 6,
  },
  distInput: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    color: C.text,
    textAlign: "center",
  },
  distSep: {
    fontFamily: "Outfit_400Regular",
    fontSize: 18,
    color: C.textMuted,
    marginTop: 18,
  },

  edgeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
    paddingHorizontal: 2,
  },
  edgeLabel: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },

  divider: { height: 1, backgroundColor: C.border, marginHorizontal: 0 },

  noLocBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.card,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  noLocTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.textMuted },

  proxRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  proxChip: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  proxChipActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  proxChipDisabled: { opacity: 0.35 },
  proxChipTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  proxChipTxtActive: { color: C.primary },
  proxChipTxtDisabled: { color: C.textMuted },

  catLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: "#3D6B50",
    textTransform: "uppercase",
    letterSpacing: 0.9,
  },
  styleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  stylePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  stylePillActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  stylePillTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  stylePillTxtActive: { color: C.primary },

  futureSection: { opacity: 0.45 },
  futureTxt: { color: C.textSecondary },
  futureLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: C.textMuted,
    marginBottom: 8,
    marginTop: 6,
  },
  soonBadge: {
    backgroundColor: C.card,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  soonTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.textMuted },
  futureToggles: { marginTop: 14, gap: 12 },
  futureToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  footer: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 24,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  resetBtn: {
    flex: 1,
    height: 50,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  resetTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textSecondary },
  applyBtn: {
    flex: 2,
    height: 50,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.primary,
  },
  applyTxt: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.bg },
}); }
