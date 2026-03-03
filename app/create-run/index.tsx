import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  Share,
  KeyboardAvoidingView,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import * as Location from "expo-location";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/query-client";
import C from "@/constants/colors";

const RUN_TAGS = ["Talkative", "Quiet", "Motivational", "Training", "Ministry", "Recovery"];
const RUN_STYLES = ["Easy Pace", "Chill", "Steady", "Tempo", "Fast", "Recovery", "Long Run", "Progressive", "Intervals", "Race Prep"];
const PRIVACY_OPTIONS = [
  { value: "public",  label: "Public",       icon: "globe",   desc: "Anyone can join" },
  { value: "friends", label: "Friends Only",  icon: "users",   desc: "Your friends see this" },
  { value: "crew",    label: "Crew",          icon: "shield",  desc: "Crew members only" },
];

export default function CreateRunScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ pathLat?: string; pathLng?: string; pathName?: string; pathDistance?: string; activityType?: string; crewId?: string; crewName?: string }>();

  const [activityType, setActivityType] = useState<"run" | "ride">(params.activityType === "ride" ? "ride" : "run");
  const [title, setTitle] = useState(params.pathName ? `${params.activityType === "ride" ? "Ride on" : "Run on"} ${params.pathName}` : "");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState("public");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [locationName, setLocationName] = useState(params.pathName ?? "");
  const [locationLat, setLocationLat] = useState(params.pathLat ?? "");
  const [locationLng, setLocationLng] = useState(params.pathLng ?? "");
  const [minDistance, setMinDistance] = useState("3");
  const [maxDistance, setMaxDistance] = useState("6");
  const [minPace, setMinPace] = useState("8");
  const [maxPace, setMaxPace] = useState("12");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [runStyle, setRunStyle] = useState<string | null>(null);
  const [maxParticipants, setMaxParticipants] = useState("20");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteModal, setInviteModal] = useState<{ token: string; title: string } | null>(null);
  const [page, setPage] = useState<"form" | "location">("form");
  const [pinCoord, setPinCoord] = useState<{ latitude: number; longitude: number } | null>(
    params.pathLat ? { latitude: parseFloat(params.pathLat), longitude: parseFloat(params.pathLng ?? "-122.4194") } : null
  );
  const [isGeocodingPin, setIsGeocodingPin] = useState(false);
  const [amPm, setAmPm] = useState<"AM" | "PM">("AM");
  const [plannedDistance, setPlannedDistance] = useState(params.pathDistance ?? "3");
  const [plannedPace, setPlannedPace] = useState("9");
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [pickerLat, setPickerLat] = useState(parseFloat(locationLat) || 0);
  const [pickerLng, setPickerLng] = useState(parseFloat(locationLng) || 0);
  const [pickerName, setPickerName] = useState(locationName);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [selectedCrewId, setSelectedCrewId] = useState<string | null>(params.crewId ?? null);

  const { data: myCrews = [] } = useQuery<{ id: string; name: string; emoji?: string }[]>({
    queryKey: ["/api/crews"],
    staleTime: 60_000,
    enabled: !!user,
  });

  const isCrew = !!(params.crewId || (privacy === "crew" && selectedCrewId));
  const effectiveCrewId = params.crewId || (privacy === "crew" ? selectedCrewId : null);

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

  function handleDateChange(text: string) {
    const digits = text.replace(/\D/g, "").slice(0, 6);
    let formatted = digits;
    if (digits.length > 2) formatted = digits.slice(0, 2) + "/" + digits.slice(2);
    if (digits.length > 4) formatted = digits.slice(0, 2) + "/" + digits.slice(2, 4) + "/" + digits.slice(4);
    setDate(formatted);
  }

  function handleTimeChange(text: string) {
    const digits = text.replace(/\D/g, "").slice(0, 4);
    setTime(autoFormatTime(digits));
  }

  function parseDMY(raw: string): Date | null {
    const [m, d, y] = raw.trim().split("/");
    if (!m || !d || !y) return null;
    const year = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
    const dt = new Date(year, parseInt(m, 10) - 1, parseInt(d, 10));
    return isNaN(dt.getTime()) ? null : dt;
  }

  function parseHHMMAMPM(raw: string, ap: "AM" | "PM"): { hours: number; minutes: number } | null {
    const match = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (ap === "PM" && hours !== 12) hours += 12;
    if (ap === "AM" && hours === 12) hours = 0;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return { hours, minutes };
  }

  async function reverseGeocode(lat: number, lng: number) {
    setIsGeocodingPin(true);
    try {
      const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (results.length > 0) {
        const r = results[0];
        const parts = [r.name, r.street, r.city, r.region].filter(Boolean);
        setPickerName(parts.join(", "));
      }
    } catch { } finally {
      setIsGeocodingPin(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      } catch {}
    })();
  }, []);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Title is required");
      if (!date.trim()) throw new Error("Date is required (MM/DD/YY)");
      if (!time.trim()) throw new Error("Time is required (H:MM)");
      if (!locationName.trim()) throw new Error("Location name is required — tap the pin to set it on the map");
      if (!locationLat || !locationLng) throw new Error("Please set the location on the map");

      const parsedDate = parseDMY(date.trim());
      if (!parsedDate) throw new Error("Invalid date — use MM/DD/YY format");
      const parsedTime = parseHHMMAMPM(time.trim(), amPm);
      if (!parsedTime) throw new Error("Invalid time — use H:MM format");

      const dateTime = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate(), parsedTime.hours, parsedTime.minutes);
      if (isNaN(dateTime.getTime())) throw new Error("Invalid date or time");

      const dist = isCrew ? parseFloat(plannedDistance) || 3 : parseFloat(minDistance);
      const distMax = isCrew ? dist : parseFloat(maxDistance);
      const pace = isCrew ? parseFloat(plannedPace) || 9 : parseFloat(minPace);
      const paceMax = isCrew ? pace : parseFloat(maxPace);

      if (privacy === "crew" && !selectedCrewId && !params.crewId) throw new Error("Please select a crew for this run");
      const res = await apiRequest("POST", "/api/runs", {
        title: title.trim(),
        description: description.trim() || undefined,
        privacy: isCrew ? "private" : (privacy === "public" ? "public" : "private"),
        date: dateTime.toISOString(),
        locationLat: parseFloat(locationLat),
        locationLng: parseFloat(locationLng),
        locationName: locationName.trim(),
        minDistance: dist,
        maxDistance: distMax,
        minPace: pace,
        maxPace: paceMax,
        tags: isCrew ? [] : selectedTags,
        maxParticipants: isCrew ? 9999 : parseInt(maxParticipants),
        runStyle: isCrew ? undefined : (runStyle ?? undefined),
        activityType,
        crewId: effectiveCrewId || undefined,
        isStrict: false,
      });
      return res.json();
    },
    onSuccess: (run: any) => {
      qc.invalidateQueries({ queryKey: ["/api/runs"] });
      qc.invalidateQueries({ queryKey: ["/api/runs/mine"] });
      if (effectiveCrewId) {
        qc.invalidateQueries({ queryKey: ["/api/crews", effectiveCrewId, "runs"] });
        qc.invalidateQueries({ queryKey: ["/api/crews"] });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (run?.privacy === "private" && run?.invite_token) {
        setInviteModal({ token: run.invite_token, title: run.title });
      } else {
        Alert.alert(
          activityType === "ride" ? "Ride Created!" : "Run Created!",
          activityType === "ride" ? "Your ride is now live on the map." : "Your run is now live on the map.",
          [{ text: "Great!", onPress: () => router.back() }]
        );
      }
    },
    onError: (e: any) => {
      Alert.alert("Error", e.message || "Failed to create run");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  function toggleTag(tag: string) {
    setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
    Haptics.selectionAsync();
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => router.back()} style={styles.cancelBtn}>
          <Feather name="x" size={20} color={C.textSecondary} />
        </Pressable>
        <Text style={styles.headerTitle}>{activityType === "ride" ? "Create Ride" : "Create Run"}</Text>
        <Pressable
          style={({ pressed }) => [styles.createBtn, { opacity: pressed || createMutation.isPending ? 0.8 : 1 }]}
          onPress={() => createMutation.mutate()}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? (
            <ActivityIndicator size="small" color={C.bg} />
          ) : (
            <Text style={styles.createBtnText}>Post</Text>
          )}
        </Pressable>
      </View>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.form, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        bottomOffset={20}
      >
        {params.crewId ? (
          <View style={styles.crewBanner}>
            <Ionicons name="people" size={16} color="#00D97E" />
            <Text style={styles.crewBannerTxt}>
              Scheduling for <Text style={styles.crewBannerName}>{params.crewName ?? "your crew"}</Text> — only members will see this
            </Text>
          </View>
        ) : null}
        <View style={styles.field}>
          <Text style={styles.label}>Activity Type</Text>
          <View style={styles.activityRow}>
            <Pressable
              style={[styles.activityPill, activityType === "run" && styles.activityPillActive]}
              onPress={() => { setActivityType("run"); Haptics.selectionAsync(); }}
            >
              <Ionicons name="walk" size={14} color={activityType === "run" ? C.bg : C.textMuted} />
              <Text style={[styles.activityPillTxt, activityType === "run" && styles.activityPillTxtActive]}>Run</Text>
            </Pressable>
            <Pressable
              style={[styles.activityPill, activityType === "ride" && styles.activityPillActive]}
              onPress={() => { setActivityType("ride"); Haptics.selectionAsync(); }}
            >
              <Ionicons name="bicycle" size={14} color={activityType === "ride" ? C.bg : C.textMuted} />
              <Text style={[styles.activityPillTxt, activityType === "ride" && styles.activityPillTxtActive]}>Bike Ride</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{activityType === "ride" ? "Ride Title *" : "Run Title *"}</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder={activityType === "ride" ? "e.g. Sunday Morning Group Ride" : "e.g. Morning 5K in the Park"}
            placeholderTextColor={C.textMuted}
            maxLength={60}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={description}
            onChangeText={setDescription}
            placeholder={isCrew ? "Tell the crew what to expect..." : "Tell runners what to expect..."}
            placeholderTextColor={C.textMuted}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        {!params.crewId && (
          <View style={styles.field}>
            <Text style={styles.label}>Visibility</Text>
            <View style={styles.privacyRow}>
              {PRIVACY_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  style={[styles.privacyOption, privacy === opt.value && styles.privacyOptionActive]}
                  onPress={() => {
                    setPrivacy(opt.value);
                    if (opt.value !== "crew") setSelectedCrewId(null);
                    Haptics.selectionAsync();
                  }}
                >
                  <Feather name={opt.icon as any} size={16} color={privacy === opt.value ? C.primary : C.textSecondary} />
                  <Text style={[styles.privacyLabel, privacy === opt.value && styles.privacyLabelActive]}>{opt.label}</Text>
                  <Text style={styles.privacyDesc}>{opt.desc}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {!params.crewId && privacy === "crew" && (
          <View style={styles.field}>
            <Text style={styles.label}>Select Crew</Text>
            {myCrews.length === 0 ? (
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textMuted }}>
                You're not in any crews yet. Join or create one from the Crew tab.
              </Text>
            ) : (
              <View style={{ gap: 8 }}>
                {myCrews.map((crew) => {
                  const active = selectedCrewId === crew.id;
                  return (
                    <Pressable
                      key={crew.id}
                      style={[styles.crewPickRow, active && styles.crewPickRowActive]}
                      onPress={() => { setSelectedCrewId(crew.id); Haptics.selectionAsync(); }}
                    >
                      <Text style={{ fontSize: 18 }}>{crew.emoji ?? "🏃"}</Text>
                      <Text style={[styles.crewPickName, active && { color: C.primary }]}>{crew.name}</Text>
                      {active && <Feather name="check-circle" size={16} color={C.primary} />}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        )}

        <View style={styles.field}>
          <Text style={styles.label}>Date & Time *</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={date}
              onChangeText={handleDateChange}
              placeholder="MM/DD/YY"
              placeholderTextColor={C.textMuted}
              keyboardType="number-pad"
              maxLength={8}
            />
            <View style={{ flex: 1, flexDirection: "row", gap: 6 }}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={time}
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
                    onPress={() => { setAmPm(period); Haptics.selectionAsync(); }}
                    style={{
                      flex: 1, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1,
                      alignItems: "center", justifyContent: "center",
                      backgroundColor: amPm === period ? C.primary + "33" : C.surface,
                      borderColor: amPm === period ? C.primary : C.border,
                    }}
                  >
                    <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 12, color: amPm === period ? C.primary : C.textMuted }}>{period}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* Location picker — map-based */}
        <View style={styles.field}>
          <Text style={styles.label}>Start Location *</Text>
          <Pressable
            style={({ pressed }) => [styles.locationBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={() => {
              if (parseFloat(locationLat) && parseFloat(locationLng)) {
                setPickerLat(parseFloat(locationLat));
                setPickerLng(parseFloat(locationLng));
              } else if (userLocation) {
                setPickerLat(userLocation.latitude);
                setPickerLng(userLocation.longitude);
              }
              setPickerName(locationName);
              setLocationPickerOpen(true);
            }}
          >
            <Feather name="map-pin" size={16} color={locationName ? C.primary : C.textMuted} />
            <Text style={[styles.locationBtnTxt, locationName ? { color: C.text } : {}]} numberOfLines={1}>
              {locationName || "Tap to set location on map"}
            </Text>
            <Feather name="chevron-right" size={14} color={C.textMuted} />
          </Pressable>
        </View>

        {/* Pace & Distance — simplified for crew, ranges for public runs */}
        {isCrew ? (
          <View style={styles.row}>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>Planned Distance (mi)</Text>
              <TextInput
                style={styles.input}
                value={plannedDistance}
                onChangeText={setPlannedDistance}
                keyboardType="decimal-pad"
                placeholder="3"
                placeholderTextColor={C.textMuted}
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.label}>Planned Pace (min/mi)</Text>
              <TextInput
                style={styles.input}
                value={plannedPace}
                onChangeText={setPlannedPace}
                keyboardType="decimal-pad"
                placeholder="9"
                placeholderTextColor={C.textMuted}
              />
            </View>
          </View>
        ) : (
          <>
            <View style={styles.sectionDivider}>
              <Text style={styles.sectionLabel}>Pace Requirements (min/mile)</Text>
            </View>
            <View style={styles.row}>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={styles.label}>Min Pace</Text>
                <TextInput
                  style={styles.input}
                  value={minPace}
                  onChangeText={setMinPace}
                  keyboardType="decimal-pad"
                  placeholder="8.0"
                  placeholderTextColor={C.textMuted}
                />
              </View>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={styles.label}>Max Pace</Text>
                <TextInput
                  style={styles.input}
                  value={maxPace}
                  onChangeText={setMaxPace}
                  keyboardType="decimal-pad"
                  placeholder="12.0"
                  placeholderTextColor={C.textMuted}
                />
              </View>
            </View>
            <View style={styles.sectionDivider}>
              <Text style={styles.sectionLabel}>Distance Requirements (miles)</Text>
            </View>
            <View style={styles.row}>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={styles.label}>Min Distance</Text>
                <TextInput
                  style={styles.input}
                  value={minDistance}
                  onChangeText={setMinDistance}
                  keyboardType="decimal-pad"
                  placeholder="3"
                  placeholderTextColor={C.textMuted}
                />
              </View>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={styles.label}>Max Distance</Text>
                <TextInput
                  style={styles.input}
                  value={maxDistance}
                  onChangeText={setMaxDistance}
                  keyboardType="decimal-pad"
                  placeholder="6"
                  placeholderTextColor={C.textMuted}
                />
              </View>
            </View>
          </>
        )}

        {!isCrew && (
          <View style={styles.field}>
            <Text style={styles.label}>Max Participants</Text>
            <TextInput
              style={styles.input}
              value={maxParticipants}
              onChangeText={setMaxParticipants}
              keyboardType="number-pad"
              placeholder="20"
              placeholderTextColor={C.textMuted}
            />
          </View>
        )}

        {!isCrew && (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>Run Style</Text>
              <Text style={styles.fieldHint}>What kind of run is this?</Text>
              <View style={styles.tagsGrid}>
                {RUN_STYLES.map((s) => (
                  <Pressable
                    key={s}
                    style={[styles.tagChip, styles.runStyleChip, runStyle === s && styles.runStyleChipActive]}
                    onPress={() => { setRunStyle(runStyle === s ? null : s); Haptics.selectionAsync(); }}
                  >
                    <Text style={[styles.tagChipText, runStyle === s && styles.runStyleChipTextActive]}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Group Vibe</Text>
              <Text style={styles.fieldHint}>What's the vibe of your group?</Text>
              <View style={styles.tagsGrid}>
                {RUN_TAGS.map((tag) => (
                  <Pressable
                    key={tag}
                    style={[styles.tagChip, selectedTags.includes(tag) && styles.tagChipActive]}
                    onPress={() => toggleTag(tag)}
                  >
                    <Text style={[styles.tagChipText, selectedTags.includes(tag) && styles.tagChipTextActive]}>{tag}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </>
        )}
      </KeyboardAwareScrollViewCompat>

      {/* ── Location Picker Modal ─────────────────────────────────────── */}
      {locationPickerOpen && (
        <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLocationPickerOpen(false)}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Set Start Location</Text>
              <Pressable onPress={() => setLocationPickerOpen(false)} hitSlop={12}>
                <Feather name="x" size={20} color={C.textSecondary} />
              </Pressable>
            </View>

            {Platform.OS !== "web" ? (
              <>
                <Text style={styles.pickerHint}>Tap on the map to place your start pin</Text>
                <MapView
                  style={styles.pickerMap}
                  initialRegion={{
                    latitude: pickerLat,
                    longitude: pickerLng,
                    latitudeDelta: 0.01,
                    longitudeDelta: 0.01,
                  }}
                  onPress={(e) => {
                    const { latitude, longitude } = e.nativeEvent.coordinate;
                    setPickerLat(latitude);
                    setPickerLng(longitude);
                    reverseGeocode(latitude, longitude);
                    Haptics.selectionAsync();
                  }}
                >
                  <Marker coordinate={{ latitude: pickerLat, longitude: pickerLng }} pinColor="#00D97E" />
                </MapView>
              </>
            ) : (
              <View style={styles.pickerWebFields}>
                <Text style={styles.pickerLabel}>Latitude</Text>
                <TextInput
                  style={styles.pickerInput}
                  value={String(pickerLat)}
                  onChangeText={(v) => setPickerLat(parseFloat(v) || 0)}
                  keyboardType="decimal-pad"
                  placeholderTextColor={C.textMuted}
                />
                <Text style={styles.pickerLabel}>Longitude</Text>
                <TextInput
                  style={styles.pickerInput}
                  value={String(pickerLng)}
                  onChangeText={(v) => setPickerLng(parseFloat(v) || 0)}
                  keyboardType="decimal-pad"
                  placeholderTextColor={C.textMuted}
                />
              </View>
            )}

            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}>
              <View style={[styles.pickerBottom, { paddingBottom: insets.bottom + 16 }]}>
                {isGeocodingPin && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <ActivityIndicator size="small" color={C.primary} />
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted }}>Finding location name…</Text>
                  </View>
                )}
                <TextInput
                  style={styles.pickerInput}
                  value={pickerName}
                  onChangeText={setPickerName}
                  placeholder="Location name (e.g. Central Park South Entrance)"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="done"
                />
                <Pressable
                  style={({ pressed }) => [styles.pickerConfirm, { opacity: pressed ? 0.85 : 1 }]}
                  onPress={() => {
                    if (!pickerName.trim()) { Alert.alert("Name required", "Type a name for this location"); return; }
                    setLocationLat(String(pickerLat));
                    setLocationLng(String(pickerLng));
                    setLocationName(pickerName.trim());
                    setLocationPickerOpen(false);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  }}
                >
                  <Feather name="check" size={16} color={C.bg} />
                  <Text style={styles.pickerConfirmTxt}>Use This Location</Text>
                </Pressable>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>
      )}

      {inviteModal && (
        <Modal transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.inviteModal}>
              <View style={styles.inviteIconWrap}>
                <Feather name="lock" size={28} color={C.primary} />
              </View>
              <Text style={styles.inviteTitle}>Private Run Created!</Text>
              <Text style={styles.inviteSub}>Share this invite code with runners you want to join:</Text>

              <View style={styles.tokenBox}>
                <Text style={styles.tokenText} selectable>{inviteModal.token}</Text>
              </View>

              <View style={styles.inviteActions}>
                <Pressable
                  style={styles.inviteCopyBtn}
                  onPress={async () => {
                    await Clipboard.setStringAsync(inviteModal.token);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    Alert.alert("Copied!", "Invite code copied to clipboard.");
                  }}
                >
                  <Feather name="copy" size={16} color={C.primary} />
                  <Text style={styles.inviteCopyTxt}>Copy Code</Text>
                </Pressable>
                <Pressable
                  style={styles.inviteShareBtn}
                  onPress={() => Share.share({ message: `Join my private run "${inviteModal.title}" on FARA! Use invite code: ${inviteModal.token}` })}
                >
                  <Feather name="share-2" size={16} color={C.bg} />
                  <Text style={styles.inviteShareTxt}>Share</Text>
                </Pressable>
              </View>

              <Pressable style={styles.inviteDoneBtn} onPress={() => { setInviteModal(null); router.back(); }}>
                <Text style={styles.inviteDoneTxt}>Done</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  crewBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#00D97E18", borderRadius: 12, borderWidth: 1, borderColor: "#00D97E40", padding: 12, marginBottom: 16 },
  crewBannerTxt: { fontFamily: "Outfit_400Regular", fontSize: 13, color: "#A8C4B4", flex: 1 },
  crewBannerName: { fontFamily: "Outfit_700Bold", color: "#00D97E" },
  center: { alignItems: "center", justifyContent: "center", gap: 16, padding: 40 },
  lockedTitle: { fontFamily: "Outfit_700Bold", fontSize: 20, color: C.text, textAlign: "center" },
  lockedSub: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center" },
  closeBtn: { marginTop: 8, backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, borderWidth: 1, borderColor: C.border },
  closeBtnText: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.text },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  cancelBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text, textAlign: "center" },
  createBtn: { backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8, minWidth: 52, alignItems: "center" },
  createBtnText: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.bg },
  form: { padding: 20, gap: 16 },
  field: { gap: 6 },
  label: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  input: {
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: C.text,
  },
  textarea: { height: 80, paddingTop: 12 },
  privacyRow: { flexDirection: "row", gap: 8 },
  privacyOption: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  privacyOptionActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  privacyLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  privacyLabelActive: { color: C.primary },
  privacyDesc: { fontFamily: "Outfit_400Regular", fontSize: 10, color: C.textMuted, textAlign: "center" },
  crewPickRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  crewPickRowActive: { borderColor: C.primary, backgroundColor: C.primaryMuted },
  crewPickName: { flex: 1, fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.text },
  activityRow: { flexDirection: "row", gap: 8 },
  activityPill: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border,
  },
  activityPillActive: { backgroundColor: C.primary, borderColor: C.primary },
  activityPillTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textMuted },
  activityPillTxtActive: { color: C.bg },
  row: { flexDirection: "row", gap: 12 },
  sectionDivider: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 16 },
  sectionLabel: { fontFamily: "Outfit_700Bold", fontSize: 14, color: C.text },
  tagsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tagChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  tagChipActive: { backgroundColor: C.primaryMuted, borderColor: C.primary },
  tagChipText: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  tagChipTextActive: { color: C.primary },
  runStyleChip: { borderRadius: 12 },
  runStyleChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  runStyleChipTextActive: { color: C.bg },
  fieldHint: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, marginTop: -6, marginBottom: 8 },
  passwordHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  passwordHint: { fontFamily: "Outfit_400Regular", fontSize: 11, color: C.textMuted, marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", alignItems: "center", justifyContent: "center", padding: 24 },
  inviteModal: { backgroundColor: C.surface, borderRadius: 20, padding: 28, width: "100%", alignItems: "center", gap: 16, borderWidth: 1, borderColor: C.border },
  inviteIconWrap: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.primaryMuted, alignItems: "center", justifyContent: "center" },
  inviteTitle: { fontFamily: "Outfit_700Bold", fontSize: 22, color: C.text, textAlign: "center" },
  inviteSub: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center" },
  tokenBox: { backgroundColor: C.card, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 16, width: "100%", alignItems: "center", borderWidth: 1, borderColor: C.border },
  tokenText: { fontFamily: "Outfit_700Bold", fontSize: 28, color: C.primary, letterSpacing: 4 },
  inviteActions: { flexDirection: "row", gap: 12, width: "100%" },
  inviteCopyBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.primaryMuted, borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: C.primary },
  inviteCopyTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.primary },
  inviteShareBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12 },
  inviteShareTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.bg },
  inviteDoneBtn: { width: "100%", alignItems: "center", paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.border, marginTop: 4 },
  inviteDoneTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.textSecondary },
  locationBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 13,
  },
  locationBtnTxt: { flex: 1, fontFamily: "Outfit_400Regular", fontSize: 15, color: C.textMuted },
  pickerSheet: { flex: 1, backgroundColor: C.bg },
  pickerHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: "center", marginTop: 8, marginBottom: 4 },
  pickerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  pickerTitle: { fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text },
  pickerHint: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textSecondary, textAlign: "center", paddingVertical: 10 },
  pickerMap: { flex: 1 },
  pickerWebFields: { padding: 20, gap: 10 },
  pickerLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary, marginBottom: 4 },
  pickerInput: {
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 12, fontFamily: "Outfit_400Regular", fontSize: 15, color: C.text,
  },
  pickerBottom: { paddingHorizontal: 16, paddingTop: 12, gap: 10, borderTopWidth: 1, borderTopColor: C.border },
  pickerConfirm: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14,
  },
  pickerConfirmTxt: { fontFamily: "Outfit_700Bold", fontSize: 15, color: C.bg },
});
