import React, { useState, useEffect, useMemo, useCallback } from "react";
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
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MapView, { Marker } from "react-native-maps";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import C from "@/constants/colors";
import RangeSlider from "@/components/RangeSlider";
import { formatDistance } from "@/lib/formatDistance";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/query-client";
import WebFAB from "@/components/WebFAB";

// ─── Constants ────────────────────────────────────────────────────────────────

const PACE_STEP = 5 / 60; // 5-second increments

type SortOption = "nearest" | "soonest" | "dist_asc" | "dist_desc";

const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: "nearest",  label: "Nearest"              },
  { key: "soonest",  label: "Soonest"               },
  { key: "dist_asc", label: "Distance: Low → High"  },
  { key: "dist_desc",label: "Distance: High → Low"  },
];

const HOST_STYLES = ["General", "Talkative", "Quiet", "Motivational", "Training", "Ministry", "Recovery", "Girlies", "Bros"];
const PROX_STEPS  = [1, 5, 10, 25, 50]; // miles

interface FilterState {
  paceMin: number;
  paceMax: number;
  distMin: number;
  distMax: number;
  maxDistFromMe: number | null;
  styles: string[];
  visibility: "all" | "public" | "friends";
}

const DEFAULT_FILTERS: FilterState = {
  paceMin: 4.0,
  paceMax: 15.0,
  distMin: 1,
  distMax: 20,
  maxDistFromMe: null,
  styles: [],
  visibility: "all",
};

// ─── Run interface ────────────────────────────────────────────────────────────

interface Run {
  id: string;
  title: string;
  host_id: string;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const mins = Math.floor(pace);
  const secs = Math.round((pace - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const days = Math.floor((d.getTime() - Date.now()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
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
}

function FilterModal({ visible, onClose, draft, setDraft, onApply, onReset, userLocation }: FilterModalProps) {
  const insets = useSafeAreaInsets();

  function toggleStyle(s: string) {
    setDraft((p) => ({
      ...p,
      styles: p.styles.includes(s) ? p.styles.filter((x) => x !== s) : [...p.styles, s],
    }));
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
          {/* ── A. Pace ─────────────────────────────────────────────────── */}
          <View style={fm.section}>
            <View style={fm.sectionHead}>
              <Text style={fm.sectionTitle}>Pace</Text>
              <Text style={fm.sectionValue}>
                {formatPace(draft.paceMin)} – {formatPace(draft.paceMax)} /mi
              </Text>
            </View>
            <RangeSlider
              min={4} max={15} step={PACE_STEP}
              low={draft.paceMin} high={draft.paceMax}
              onLowChange={(v) => setDraft((p) => ({ ...p, paceMin: v }))}
              onHighChange={(v) => setDraft((p) => ({ ...p, paceMax: v }))}
              color={C.primary}
              trackColor={C.border}
            />
            <View style={fm.edgeRow}>
              <Text style={fm.edgeLabel}>4:00</Text>
              <Text style={fm.edgeLabel}>15:00 /mi</Text>
            </View>
          </View>

          <View style={fm.divider} />

          {/* ── B. Distance (Run length) ────────────────────────────────── */}
          <View style={fm.section}>
            <View style={fm.sectionHead}>
              <Text style={fm.sectionTitle}>Run Length</Text>
              <Text style={fm.sectionValue}>
                {formatDistance(draft.distMin)} – {formatDistance(draft.distMax)} mi
              </Text>
            </View>
            <RangeSlider
              min={1} max={20} step={0.5}
              low={draft.distMin} high={draft.distMax}
              onLowChange={(v) => setDraft((p) => ({ ...p, distMin: v }))}
              onHighChange={(v) => setDraft((p) => ({ ...p, distMax: v }))}
              color={C.primary}
              trackColor={C.border}
            />
            <View style={fm.edgeRow}>
              <Text style={fm.edgeLabel}>1 mi</Text>
              <Text style={fm.edgeLabel}>20 mi</Text>
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
              <Pressable
                style={[fm.proxChip, draft.maxDistFromMe === null && fm.proxChipActive]}
                onPress={() => setDraft((p) => ({ ...p, maxDistFromMe: null }))}
                disabled={!userLocation}
              >
                <Text style={[fm.proxChipTxt, draft.maxDistFromMe === null && fm.proxChipTxtActive]}>
                  Any
                </Text>
              </Pressable>
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
                    setDraft((p) => ({ ...p, maxDistFromMe: p.maxDistFromMe === mi ? null : mi }));
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
                    {mi} mi
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={fm.divider} />

          {/* ── D. Host Style ────────────────────────────────────────────── */}
          <View style={fm.section}>
            <Text style={fm.sectionTitle}>Host Style</Text>
            <View style={fm.styleGrid}>
              {HOST_STYLES.map((style) => {
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

          <View style={fm.divider} />

          {/* ── E. Visibility ────────────────────────────────────────────── */}
          <View style={fm.section}>
            <Text style={fm.sectionTitle}>Visibility</Text>
            <View style={fm.proxRow}>
              {(["all", "public", "friends"] as const).map((opt) => {
                const labels = { all: "All", public: "Public", friends: "Friends" };
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

          {/* ── F. Future-Proof (structure only) ────────────────────────── */}
          <View style={[fm.section, fm.futureSection]}>
            <View style={fm.sectionHead}>
              <Text style={[fm.sectionTitle, fm.futureTxt]}>More Filters</Text>
              <View style={fm.soonBadge}>
                <Text style={fm.soonTxt}>Coming soon</Text>
              </View>
            </View>

            {/* Day of week */}
            <Text style={fm.futureLabel}>Day of Week</Text>
            <View style={fm.proxRow}>
              {["M","T","W","T","F","S","S"].map((d, i) => (
                <View key={i} style={[fm.proxChip, fm.proxChipDisabled, { minWidth: 34 }]}>
                  <Text style={[fm.proxChipTxt, fm.proxChipTxtDisabled]}>{d}</Text>
                </View>
              ))}
            </View>

            {/* Time of day */}
            <Text style={[fm.futureLabel, { marginTop: 14 }]}>Time of Day</Text>
            <View style={fm.proxRow}>
              {["Morning","Afternoon","Evening"].map((t) => (
                <View key={t} style={[fm.proxChip, fm.proxChipDisabled]}>
                  <Text style={[fm.proxChipTxt, fm.proxChipTxtDisabled]}>{t}</Text>
                </View>
              ))}
            </View>

            {/* Toggles row */}
            <View style={fm.futureToggles}>
              <View style={fm.futureToggleRow}>
                <Text style={[fm.futureLabel, { marginTop: 0 }]}>Spots remaining</Text>
                <Switch value={false} disabled trackColor={{ false: C.border, true: C.primary }} />
              </View>
              <View style={fm.futureToggleRow}>
                <Text style={[fm.futureLabel, { marginTop: 0 }]}>Verified host only</Text>
                <Switch value={false} disabled trackColor={{ false: C.border, true: C.primary }} />
              </View>
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

// ─── RunCard ──────────────────────────────────────────────────────────────────

function RunCard({
  run,
  onPress,
  distanceMi,
}: {
  run: Run;
  onPress: () => void;
  distanceMi?: number;
}) {
  const spotsLeft = run.max_participants - run.participant_count;
  return (
    <Pressable
      style={({ pressed }) => [s.card, { opacity: pressed ? 0.85 : 1 }]}
      onPress={onPress}
      testID={`run-card-${run.id}`}
    >
      <View style={s.cardTop}>
        <View style={s.cardTitleRow}>
          <Text style={s.cardTitle} numberOfLines={1}>{run.title}</Text>
          {spotsLeft <= 3 && spotsLeft > 0 && (
            <View style={s.urgentBadge}>
              <Text style={s.urgentText}>{spotsLeft} left</Text>
            </View>
          )}
        </View>
        <Text style={s.hostLine}>
          {run.host_name}
          {run.host_rating > 0 && (
            <Text style={s.ratingText}>{"  "}★ {run.host_rating.toFixed(1)}</Text>
          )}
        </Text>
      </View>

      <View style={s.cardMeta}>
        <View style={s.metaItem}>
          <Feather name="calendar" size={12} color={C.textMuted} />
          <Text style={s.metaText}>{formatDate(run.date)} · {formatTime(run.date)}</Text>
        </View>
        <View style={s.metaItem}>
          <Feather name="map-pin" size={12} color={C.textMuted} />
          <Text style={s.metaText} numberOfLines={1}>{run.location_name}</Text>
        </View>
        {distanceMi !== undefined && (
          <View style={s.metaItem}>
            <Feather name="navigation" size={12} color={C.textMuted} />
            <Text style={s.metaText}>{formatDistance(distanceMi)} mi away</Text>
          </View>
        )}
      </View>

      <View style={s.cardStats}>
        <View style={s.stat}>
          <Ionicons name="walk" size={13} color={C.orange} />
          <Text style={s.statLabel}>{formatPace(run.min_pace)}–{formatPace(run.max_pace)}</Text>
          <Text style={s.statUnit}>/mi</Text>
        </View>
        <View style={s.statDiv} />
        <View style={s.stat}>
          <Feather name="target" size={13} color={C.blue} />
          <Text style={s.statLabel}>
            {formatDistance(run.min_distance)}–{formatDistance(run.max_distance)}
          </Text>
          <Text style={s.statUnit}>mi</Text>
        </View>
        <View style={s.statDiv} />
        <View style={s.stat}>
          <Ionicons name="people" size={13} color={C.textMuted} />
          <Text style={s.statLabel}>{run.participant_count}/{run.max_participants}</Text>
        </View>
      </View>

      {run.tags?.length > 0 && (
        <View style={s.tags}>
          {run.tags.slice(0, 3).map((t) => (
            <View key={t} style={s.tag}>
              <Text style={s.tagTxt}>{t}</Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

const PARTICIPANT_STEPS = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 0]; // 0 = unlimited

export default function DiscoverScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("nearest");
  const [showSort, setShowSort] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  const [draft,    setDraft]    = useState<FilterState>({ ...DEFAULT_FILTERS });
  const [applied,  setApplied]  = useState<FilterState>({ ...DEFAULT_FILTERS });

  // ─── Host modal state ───────────────────────────────────────────────────────
  const [showHostModal, setShowHostModal] = useState(false);
  const [hTitle, setHTitle] = useState("");
  const [hLocation, setHLocation] = useState("");
  const [hDate, setHDate] = useState("");
  const [hTime, setHTime] = useState("");
  const [hPrivacy, setHPrivacy] = useState("public");
  const [hPassword, setHPassword] = useState("");
  const [hMaxParticipants, setHMaxParticipants] = useState(20);
  const [hTags, setHTags] = useState<string[]>([]);
  const [hMinDist, setHMinDist] = useState("3");
  const [hMaxDist, setHMaxDist] = useState("6");
  const [hMinPace, setHMinPace] = useState(8);
  const [hMaxPace, setHMaxPace] = useState(12);
  const [hLocationLat, setHLocationLat] = useState<number | null>(null);
  const [hLocationLng, setHLocationLng] = useState<number | null>(null);
  const [hostPage, setHostPage] = useState<"form" | "location">("form");
  const [pinCoord, setPinCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isGeocodingPin, setIsGeocodingPin] = useState(false);
  const [hAmPm, setHAmPm] = useState<"AM" | "PM">("AM");

  function resetHostForm() {
    setHTitle(""); setHLocation(""); setHDate(""); setHTime("");
    setHPrivacy("public"); setHPassword(""); setHMaxParticipants(20);
    setHTags([]); setHMinDist("3"); setHMaxDist("6"); setHMinPace(8); setHMaxPace(12);
    setHLocationLat(null); setHLocationLng(null); setPinCoord(null); setHostPage("form");
    setHAmPm("AM");
  }

  function handleDateChange(text: string) {
    const digits = text.replace(/\D/g, "").slice(0, 6);
    let formatted = digits;
    if (digits.length > 2) formatted = digits.slice(0, 2) + "/" + digits.slice(2);
    if (digits.length > 4) formatted = digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4);
    setHDate(formatted);
  }

  function autoFormatTime(digits: string): string {
    if (digits.length <= 1) return digits;
    if (digits.length === 2) {
      if (parseInt(digits[0], 10) > 1) return digits[0] + ":" + digits[1];
      return digits;
    }
    if (digits.length === 3) {
      if (parseInt(digits[0], 10) > 1) return digits[0] + ":" + digits.slice(1);
      return digits.slice(0, 2) + ":" + digits[2];
    }
    if (parseInt(digits[0], 10) > 1) return digits[0] + ":" + digits.slice(1, 3);
    return digits.slice(0, 2) + ":" + digits.slice(2, 4);
  }

  function handleTimeChange(text: string) {
    const digits = text.replace(/\D/g, "").slice(0, 4);
    setHTime(autoFormatTime(digits));
  }

  // ─── Date / Time parse helpers ─────────────────────────────────────────────
  function parseDMY(raw: string): Date | null {
    const cleaned = raw.trim().replace(/\//g, "/");
    const [d, m, y] = cleaned.split("/");
    if (!d || !m || !y) return null;
    const year = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
    const date = new Date(year, parseInt(m, 10) - 1, parseInt(d, 10));
    return isNaN(date.getTime()) ? null : date;
  }

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

  const PACE_STEP_30S = 0.5; // 30 seconds in minutes

  function formatPaceMM(pace: number): string {
    const mins = Math.floor(pace);
    const secs = Math.round((pace % 1) * 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  function stepMinPace(dir: 1 | -1) {
    const next = Math.round((hMinPace + dir * PACE_STEP_30S) * 10) / 10;
    setHMinPace(Math.max(5, Math.min(hMaxPace - PACE_STEP_30S, next)));
    Haptics.selectionAsync();
  }

  function stepMaxPace(dir: 1 | -1) {
    const next = Math.round((hMaxPace + dir * PACE_STEP_30S) * 10) / 10;
    setHMaxPace(Math.max(hMinPace + PACE_STEP_30S, Math.min(20, next)));
    Haptics.selectionAsync();
  }

  function stepParticipants(dir: 1 | -1) {
    const idx = PARTICIPANT_STEPS.indexOf(hMaxParticipants);
    const next = PARTICIPANT_STEPS[Math.max(0, Math.min(PARTICIPANT_STEPS.length - 1, idx + dir))];
    setHMaxParticipants(next ?? 0);
    Haptics.selectionAsync();
  }

  const [showRulesModal, setShowRulesModal] = useState(false);

  // ─── Host FAB helpers ───────────────────────────────────────────────────────
  const openHostModal = useCallback(async () => {
    const seen = await AsyncStorage.getItem("@paceup/hosting_rules_seen");
    if (!seen) {
      setShowRulesModal(true);
    } else {
      setShowHostModal(true);
    }
  }, []);

  const createRunMutation = useMutation({
    mutationFn: async () => {
      if (!hTitle.trim()) throw new Error("Run title is required");
      if (!hLocation.trim()) throw new Error("Location is required — tap the pin to set it on the map");
      if (hLocationLat === null || hLocationLng === null) throw new Error("Please pick a location on the map");
      if (!hDate.trim() || !hTime.trim()) throw new Error("Date and time are required");
      const parsedDate = parseDMY(hDate.trim());
      if (!parsedDate) throw new Error("Invalid date — use DD/MM/YY (e.g. 25/06/25)");
      const parsedTime = parseHHMMAMPM(hTime.trim(), hAmPm);
      if (!parsedTime) throw new Error("Invalid time — use H:MM (e.g. 7:30)");
      parsedDate.setHours(parsedTime.hours, parsedTime.minutes, 0, 0);
      if (isNaN(parsedDate.getTime())) throw new Error("Invalid date or time");
      if (parsedDate.getTime() < Date.now() - 5 * 60 * 1000) throw new Error("Run date must be in the future");
      const res = await apiRequest("POST", "/api/runs", {
        title: hTitle.trim(),
        privacy: hPrivacy,
        date: parsedDate.toISOString(),
        locationLat: hLocationLat,
        locationLng: hLocationLng,
        locationName: hLocation.trim(),
        minDistance: parseFloat(hMinDist) || 1,
        maxDistance: parseFloat(hMaxDist) || 6,
        minPace: hMinPace,
        maxPace: hMaxPace,
        tags: hTags,
        maxParticipants: hMaxParticipants === 0 ? 9999 : hMaxParticipants,
        invitePassword: hPrivacy === "private" && hPassword.trim() ? hPassword.trim() : undefined,
      });
      return res.json();
    },
    onSuccess: (run: any) => {
      qc.invalidateQueries({ queryKey: ["/api/runs"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowHostModal(false);
      resetHostForm();
      if (run?.privacy === "private" && run?.invite_token) {
        Alert.alert("Run Created!", `Share this invite code with your runners:\n\n${run.invite_token}`);
      } else {
        Alert.alert("Run Created!", "Your run is now live on the map.");
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
    if (Platform.OS === "web") { setSortOption("soonest"); return; }
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") { setSortOption("soonest"); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setUserLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    })();
  }, []);

  // ─── Data ──────────────────────────────────────────────────────────────────

  const { data: runs = [], isLoading, refetch, isRefetching } = useQuery<Run[]>({
    queryKey: ["/api/runs"],
    staleTime: 30_000,
  });

  const { data: friends = [] } = useQuery<{ id: string }[]>({
    queryKey: ["/api/friends"],
    staleTime: 60_000,
    enabled: !!user,
  });

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
      // Pace overlap
      const matchPace = r.min_pace <= applied.paceMax && r.max_pace >= applied.paceMin;
      // Distance (run length) overlap
      const matchDist = r.min_distance <= applied.distMax && r.max_distance >= applied.distMin;
      // Proximity
      const matchProx = !applied.maxDistFromMe || !userLocation ||
        (distanceMap[r.id] ?? Infinity) <= applied.maxDistFromMe;
      // Host style
      const matchStyle = applied.styles.length === 0 ||
        r.tags?.some((t) => applied.styles.includes(t));
      // Visibility
      const matchVisibility =
        applied.visibility === "all" ||
        (applied.visibility === "public" && r.privacy === "public") ||
        (applied.visibility === "friends" && friendIdSet.has(r.host_id));

      return matchSearch && matchPace && matchDist && matchProx && matchStyle && matchVisibility;
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
      case "dist_asc":
        list.sort((a, b) => a.min_distance - b.min_distance);
        break;
      case "dist_desc":
        list.sort((a, b) => b.min_distance - a.min_distance);
        break;
    }
    return list;
  }, [runs, search, applied, sortOption, distanceMap, userLocation, friendIdSet]);

  // ─── Filter state helpers ──────────────────────────────────────────────────

  const isFiltered =
    applied.paceMin !== DEFAULT_FILTERS.paceMin ||
    applied.paceMax !== DEFAULT_FILTERS.paceMax ||
    applied.distMin !== DEFAULT_FILTERS.distMin ||
    applied.distMax !== DEFAULT_FILTERS.distMax ||
    applied.maxDistFromMe !== null ||
    applied.styles.length > 0 ||
    applied.visibility !== "all";

  const isNonDefaultSort = sortOption !== "nearest";

  function openFilter() {
    setDraft({ ...applied });
    setShowSort(false);
    setShowFilter(true);
  }

  function applyFilters() {
    setApplied({ ...draft });
    setShowFilter(false);
  }

  function resetFilters() {
    setDraft({ ...DEFAULT_FILTERS });
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
    <View style={s.container}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[s.header, { paddingTop: headerTopPad }]}>
        <View style={s.titleRow}>
          <Text style={s.title}>PaceUp</Text>

          <View style={s.headerBtns}>
            {/* Filter */}
            <Pressable
              style={[s.hBtn, isFiltered && s.hBtnActive]}
              onPress={openFilter}
              testID="filter-button"
            >
              <Feather name="sliders" size={16} color={C.primary} />
              {isFiltered && <View style={s.dot} />}
            </Pressable>

            {/* Sort */}
            <Pressable
              style={[s.hBtnRow, showSort && s.hBtnActive]}
              onPress={() => { setShowSort((v) => !v); setShowFilter(false); }}
              testID="sort-button"
            >
              {isNonDefaultSort && <View style={s.dot} />}
              <Text style={s.hBtnTxt}>Sort by</Text>
              <Feather
                name={showSort ? "chevron-up" : "chevron-down"}
                size={13}
                color={C.primary}
              />
            </Pressable>

            {/* Host */}
            <Pressable style={s.hBtnRow} onPress={openHostModal} testID="host-button">
              <Feather name="plus" size={15} color={C.primary} />
              <Text style={s.hBtnTxt}>Host</Text>
            </Pressable>
          </View>
        </View>

        {/* Search */}
        <View style={s.searchWrap}>
          <Feather name="search" size={15} color={C.textMuted} />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={(t) => { setSearch(t); setShowSort(false); }}
            placeholder="Search runs, hosts, locations..."
            placeholderTextColor={C.textMuted}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x" size={15} color={C.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      {/* ── Sort dropdown ──────────────────────────────────────────────────── */}
      {showSort && (
        <>
          <Pressable style={s.sortOverlay} onPress={() => setShowSort(false)} />
          <View style={[s.sortMenu, { top: headerTopPad + 54 }]}>
            {SORT_OPTIONS.map((opt) => {
              const active = sortOption === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  style={[s.sortItem, active && s.sortItemActive]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSortOption(opt.key);
                    setShowSort(false);
                  }}
                >
                  <Text style={[s.sortItemTxt, active && s.sortItemTxtActive]}>
                    {opt.label}
                  </Text>
                  {active && (
                    <Feather name="check" size={13} color={C.primary} />
                  )}
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {/* ── List ───────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={C.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(r) => r.id}
          contentContainerStyle={[
            s.list,
            { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 100) },
          ]}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!!sorted.length}
          onScrollBeginDrag={() => setShowSort(false)}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={C.primary} />
          }
          renderItem={({ item }) => (
            <RunCard
              run={item}
              distanceMi={userLocation ? distanceMap[item.id] : undefined}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowSort(false);
                router.push(`/run/${item.id}`);
              }}
            />
          )}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="walk-outline" size={44} color={C.textMuted} />
              <Text style={s.emptyTitle}>No runs found</Text>
              <Text style={s.emptySub}>
                {search || isFiltered
                  ? "Try adjusting your filters"
                  : "Check back soon for upcoming runs"}
              </Text>
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
      />

      {/* ── Host Run Modal ───────────────────────────────────────────────────── */}
      <Modal visible={showHostModal} transparent animationType="slide" onRequestClose={() => setShowHostModal(false)}>
        <KeyboardAvoidingView style={s.modalWrap} behavior="padding">
        <Pressable style={s.modalOverlay} onPress={() => setShowHostModal(false)} />
        <View style={[s.modalSheet, { paddingBottom: insets.bottom + 24 }]}>

          {/* Sheet handle */}
          <View style={s.sheetHandle} />

          {/* Header */}
          <View style={s.sheetHeader}>
            {hostPage === "location" ? (
              <Pressable style={s.sheetHeaderBtn} onPress={() => setHostPage("form")}>
                <Feather name="arrow-left" size={20} color={C.textSecondary} />
              </Pressable>
            ) : (
              <Pressable style={s.sheetHeaderBtn} onPress={() => { setShowHostModal(false); resetHostForm(); }}>
                <Feather name="x" size={20} color={C.textSecondary} />
              </Pressable>
            )}
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 17, color: C.text }}>
              {hostPage === "location" ? "Drop a Pin" : "Host a Run"}
            </Text>
            {hostPage === "location" ? (
              <Pressable
                style={[s.sheetHeaderBtn, s.sheetPostBtn]}
                onPress={() => {
                  if (pinCoord) {
                    setHLocationLat(pinCoord.latitude);
                    setHLocationLng(pinCoord.longitude);
                  }
                  setHostPage("form");
                  Haptics.selectionAsync();
                }}
              >
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 14, color: C.bg }}>Done</Text>
              </Pressable>
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
          {hostPage === "form" && (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={s.sheetForm}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Title */}
            <Text style={s.hLabel}>Run Title *</Text>
            <TextInput
              style={s.hInput}
              value={hTitle}
              onChangeText={setHTitle}
              placeholder="e.g. Morning 5K in the Park"
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
              <TextInput
                style={[s.hInput, { flex: 1 }]}
                value={hDate}
                onChangeText={handleDateChange}
                placeholder="DD/MM/YY"
                placeholderTextColor={C.textMuted}
                keyboardType="number-pad"
                maxLength={8}
              />
              <View style={{ flex: 1, flexDirection: "row", gap: 6 }}>
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
            <Text style={s.hLabel}>Visibility</Text>
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 4 }}>
              {[
                { val: "public",  icon: "globe" as const,  label: "Public",  desc: "Anyone can join" },
                { val: "private", icon: "lock"  as const,  label: "Private", desc: "Invite only" },
              ].map((opt) => (
                <Pressable
                  key={opt.val}
                  style={[s.hPrivOpt, hPrivacy === opt.val && s.hPrivOptActive]}
                  onPress={() => { setHPrivacy(opt.val); Haptics.selectionAsync(); }}
                >
                  <Feather name={opt.icon} size={15} color={hPrivacy === opt.val ? C.primary : C.textSecondary} />
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: hPrivacy === opt.val ? C.primary : C.textSecondary, marginTop: 4 }}>{opt.label}</Text>
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted, marginTop: 2 }}>{opt.desc}</Text>
                </Pressable>
              ))}
            </View>

            {/* Password (private only) */}
            {hPrivacy === "private" && (
              <>
                <Text style={[s.hLabel, { marginTop: 10 }]}>Join Password <Text style={{ color: C.textMuted, fontFamily: "Outfit_400Regular" }}>(optional)</Text></Text>
                <TextInput
                  style={s.hInput}
                  value={hPassword}
                  onChangeText={setHPassword}
                  placeholder="Leave blank to use invite code only"
                  placeholderTextColor={C.textMuted}
                  autoCapitalize="none"
                />
              </>
            )}

            {/* Max Runners */}
            <Text style={s.hLabel}>Max Runners</Text>
            <View style={s.hStepper}>
              <Pressable
                style={[s.hStepBtn, hMaxParticipants <= 5 && { opacity: 0.4 }]}
                onPress={() => stepParticipants(-1)}
                disabled={hMaxParticipants <= 5 && hMaxParticipants !== 0}
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

            {/* Host Style */}
            <Text style={s.hLabel}>Host Style</Text>
            <View style={s.hTagRow}>
              {HOST_STYLES.map((tag) => (
                <Pressable
                  key={tag}
                  style={[s.hTag, hTags.includes(tag) && s.hTagActive]}
                  onPress={() => {
                    setHTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
                    Haptics.selectionAsync();
                  }}
                >
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: hTags.includes(tag) ? C.primary : C.textSecondary }}>{tag}</Text>
                </Pressable>
              ))}
            </View>

            {/* Distance Range */}
            <Text style={s.hLabel}>Distance Range (miles)</Text>
            <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
              <TextInput
                style={[s.hInput, { flex: 1, textAlign: "center" }]}
                value={hMinDist}
                onChangeText={setHMinDist}
                placeholder="Min"
                placeholderTextColor={C.textMuted}
                keyboardType="decimal-pad"
              />
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textMuted }}>to</Text>
              <TextInput
                style={[s.hInput, { flex: 1, textAlign: "center" }]}
                value={hMaxDist}
                onChangeText={setHMaxDist}
                placeholder="Max"
                placeholderTextColor={C.textMuted}
                keyboardType="decimal-pad"
              />
            </View>

            {/* Pace Range */}
            <Text style={s.hLabel}>Pace Range (min/mile) · 30 sec steps</Text>
            <View style={{ gap: 8 }}>
              <View style={s.hPaceRow}>
                <Text style={s.hPaceLabel}>Slowest</Text>
                <View style={s.hStepper}>
                  <Pressable style={s.hStepBtn} onPress={() => stepMaxPace(-1)}>
                    <Feather name="minus" size={18} color={C.primary} />
                  </Pressable>
                  <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text, minWidth: 64, textAlign: "center" }}>
                    {formatPaceMM(hMaxPace)}
                  </Text>
                  <Pressable style={s.hStepBtn} onPress={() => stepMaxPace(1)}>
                    <Feather name="plus" size={18} color={C.primary} />
                  </Pressable>
                </View>
              </View>
              <View style={s.hPaceRow}>
                <Text style={s.hPaceLabel}>Fastest</Text>
                <View style={s.hStepper}>
                  <Pressable style={s.hStepBtn} onPress={() => stepMinPace(-1)}>
                    <Feather name="minus" size={18} color={C.primary} />
                  </Pressable>
                  <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text, minWidth: 64, textAlign: "center" }}>
                    {formatPaceMM(hMinPace)}
                  </Text>
                  <Pressable style={s.hStepBtn} onPress={() => stepMinPace(1)}>
                    <Feather name="plus" size={18} color={C.primary} />
                  </Pressable>
                </View>
              </View>
            </View>
          </ScrollView>
          )}
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Community Rules Modal ──────────────────────────────────────────────
           NOTE: The closing )} above closes {hostPage === "form" && (        */}
      <Modal visible={showRulesModal} transparent animationType="slide" onRequestClose={() => setShowRulesModal(false)}>
        <View style={s.modalWrap}>
        <Pressable style={s.modalOverlay} onPress={() => setShowRulesModal(false)} />
        <View style={[s.modalSheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>Host Guidelines</Text>
            <Pressable style={s.sheetHeaderBtn} onPress={() => setShowRulesModal(false)}>
              <Feather name="x" size={18} color={C.textSecondary} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            <Text style={s.rulesIntro}>
              By hosting a run on PaceUp, you agree to uphold these community standards. Every runner deserves a safe and welcoming experience.
            </Text>

            {[
              { icon: "heart" as const,      title: "Be kind and respectful",       body: "Treat every participant with courtesy. No runner should feel unwelcome or judged." },
              { icon: "clock" as const,       title: "Be on time",                   body: "Start and finish as scheduled. If something comes up, notify your group as early as possible." },
              { icon: "target" as const,      title: "Set honest expectations",      body: "List accurate pace and distance ranges. Don't leave runners behind who joined based on your stated criteria." },
              { icon: "shield" as const,      title: "Prioritize safety",            body: "Choose safe routes. Watch out for traffic, uneven terrain, and the wellbeing of all participants." },
              { icon: "users" as const,       title: "Leave no one behind",          body: "Check in on slower runners. A great host makes sure everyone finishes, not just the front of the pack." },
              { icon: "x-circle" as const,    title: "Cancel responsibly",           body: "If you can't make it, cancel your run well in advance so participants can adjust their plans." },
            ].map((rule) => (
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
              onPress={async () => {
                await AsyncStorage.setItem("@paceup/hosting_rules_seen", "1");
                setShowRulesModal(false);
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

      {/* ── Map FAB ──────────────────────────────────────────────────────────── */}
      {Platform.OS === "web" ? (
        <WebFAB onPress={goToMap} />
      ) : (
        <Pressable
          testID="map-fab"
          style={[s.fab, { bottom: insets.bottom + 42 }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            goToMap();
          }}
        >
          <Feather name="map" size={28} color={C.bg} />
        </Pressable>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: { paddingHorizontal: 20, paddingBottom: 12 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: { fontFamily: "Outfit_700Bold", fontSize: 36, color: C.text, letterSpacing: -0.5 },

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

  sortOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 10,
  },
  sortMenu: {
    position: "absolute",
    right: 16,
    zIndex: 11,
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.primary + "55",
    minWidth: 200,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 14,
    overflow: "hidden",
  },
  sortItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  sortItemActive: { backgroundColor: C.primaryMuted },
  sortItemTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.textSecondary },
  sortItemTxtActive: { color: C.primary },

  list: { paddingHorizontal: 16, paddingTop: 10, gap: 10 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 15,
    borderWidth: 1,
    borderColor: C.border,
    gap: 9,
  },
  cardTop: { gap: 3 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.text, flex: 1 },
  urgentBadge: {
    backgroundColor: C.orange + "20",
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: C.orange + "40",
  },
  urgentText: { fontFamily: "Outfit_600SemiBold", fontSize: 10, color: C.orange },
  hostLine: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary },
  ratingText: { color: C.gold },

  cardMeta: { gap: 3 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary, flex: 1 },

  cardStats: { flexDirection: "row", alignItems: "center", gap: 10 },
  stat: { flexDirection: "row", alignItems: "center", gap: 4 },
  statLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: C.text },
  statUnit: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted },
  statDiv: { width: 1, height: 12, backgroundColor: C.border },

  tags: { flexDirection: "row", gap: 5, flexWrap: "wrap" },
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
  sheetTitle: { fontFamily: "Outfit_700Bold", fontSize: 17, color: C.text },
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
});

// ─── Filter Modal Styles ──────────────────────────────────────────────────────

const fm = StyleSheet.create({
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
    paddingHorizontal: 24,
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

  section: { paddingHorizontal: 24, paddingVertical: 20 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  sectionTitle: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.text },
  sectionValue: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.primary },

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
});
