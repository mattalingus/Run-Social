import React, { useState, useCallback, useRef, useMemo, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Platform,
  Alert,
  KeyboardAvoidingView,
  Keyboard,
  Image,
  Pressable,
  Linking,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { useActivity } from "@/contexts/ActivityContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { useTheme } from "@/contexts/ThemeContext";
import { useWalkthrough } from "@/contexts/WalkthroughContext";
import WalkthroughPulse from "@/components/WalkthroughPulse";
import { MOCK_CREW } from "@/lib/walkthroughMockData";
import { usePurchases } from "@/contexts/PurchasesContext";
import { darkColors, type ColorScheme } from "@/constants/colors";
import { toDisplayPace, toDisplayDist, unitLabel, type DistanceUnit } from "@/lib/units";
import { Image as ExpoImage } from "expo-image";

const C = darkColors;

interface GifItem {
  id: string;
  title: string;
  gif_url: string;
  preview_url: string;
}

const GIF_TOPICS = ["Running", "Celebrate", "Hype", "Let's go", "Tired", "Stretch"];

function resolveImgUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return new URL(url, getApiUrl()).toString();
}

const EMOJIS = ["🏃", "🚴", "⚡", "🔥", "💪", "🌿", "🦅", "🐺", "🦁", "🏔", "🌊", "⭐", "🎯", "🚀", "🌙"];
const CREW_RUN_STYLES = ["Easy Pace", "Chill", "Steady", "Tempo", "Fast", "Recovery", "Long Run", "Progressive", "Intervals", "Race Prep"];
const CREW_VIBE_GROUPS: { label: string; options: string[] }[] = [
  { label: "Energy", options: ["High Energy", "Chill Pace", "Competitive", "Recovery", "No Drop", "Motivational"] },
  { label: "Style", options: ["Social", "Race Training", "Track Workouts", "Trail", "Long Runs", "Speed Work", "Beginners Welcome", "PR Chasers"] },
  { label: "Personality", options: ["Talkative", "Quiet", "Hype Squad", "Accountability", "Spiritual", "Welcoming", "Strict"] },
  { label: "Community", options: ["Women Only", "Men Only", "Co-Ed", "Ministry"] },
  { label: "Age Group", options: ["Young Adults", "Middle Aged", "Seniors"] },
];

interface Crew {
  id: string;
  name: string;
  description?: string;
  emoji: string;
  image_url?: string;
  created_by: string;
  created_at: string;
  member_count: number;
  created_by_name: string;
  run_style?: string;
  tags?: string[];
  pending_request_count?: number;
  chat_muted?: boolean;
  subscription_tier?: string;
}

interface SuggestedCrew {
  id: string;
  name: string;
  emoji: string;
  image_url?: string;
  description?: string;
  member_count: number;
  run_style?: string;
  recent_activity?: number;
}

interface SubscriptionStatus {
  subscription_tier: string;
  member_cap_override: number | null;
  member_count: number;
  member_cap: number;
  at_cap: boolean;
}

interface JoinRequest {
  user_id: string;
  name: string;
  username?: string;
  photo_url?: string;
  avg_pace?: number;
  completed_runs?: number;
  requested_at: string;
}

interface CrewMember {
  id: string;
  user_id: string;
  name: string;
  photo_url?: string;
  avg_pace?: number;
  hosted_runs?: number;
  joined_at: string;
}

interface CrewDetail extends Crew {
  members: CrewMember[];
}

interface CrewInvite {
  crew_id: string;
  crew_name: string;
  emoji: string;
  description?: string;
  member_count: number;
  invited_by_name: string;
}

interface Run {
  id: string;
  title: string;
  date: string;
  activity_type?: string;
  host_name: string;
  host_id?: string;
  distance_miles?: number;
  min_distance?: number;
  participant_count?: number;
}

interface CrewHistoryRun {
  id: string;
  title: string;
  date: string;
  min_distance: number;
  activity_type: string;
  host_id: string;
  host_name: string;
  avg_attendee_pace: number;
  attendee_count: number;
}

interface UserSearchResult {
  id: string;
  name: string;
  username?: string;
  photo_url?: string;
  hosted_runs?: number;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}


// ─── Invite Banner ────────────────────────────────────────────────────────────
function InviteBanner({ invite, onAccept, onDecline }: { invite: CrewInvite; onAccept: () => void; onDecline: () => void }) {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  return (
    <View style={s.inviteBanner}>
      <Text style={s.inviteEmoji}>{invite.emoji}</Text>
      <View style={s.inviteText}>
        <Text style={s.inviteName}>{invite.crew_name}</Text>
        <Text style={s.inviteBy}>{invite.invited_by_name} invited you · {invite.member_count} members</Text>
      </View>
      <TouchableOpacity style={s.inviteAccept} onPress={onAccept} testID="accept-invite">
        <Ionicons name="checkmark" size={18} color={C.bg} />
      </TouchableOpacity>
      <TouchableOpacity style={s.inviteDecline} onPress={onDecline} testID="decline-invite">
        <Ionicons name="close" size={18} color={C.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

// ─── Crew Card ────────────────────────────────────────────────────────────────
function CrewCard({ crew, onPress }: { crew: Crew; onPress: () => void }) {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const vibes = crew.tags ?? [];
  const pendingCount = parseInt(String(crew.pending_request_count ?? 0));
  return (
    <TouchableOpacity style={s.crewCard} onPress={onPress} activeOpacity={0.75} testID={`crew-card-${crew.id}`}>
      <View style={s.crewCardLeft}>
        <View style={s.crewEmojiBadge}>
          {resolveImgUrl(crew.image_url) ? (
            <Image source={{ uri: resolveImgUrl(crew.image_url)! }} style={{ width: 52, height: 52, borderRadius: 26 }} />
          ) : (
            <Text style={s.crewEmojiText}>{crew.emoji}</Text>
          )}
          {pendingCount > 0 && (
            <View style={s.requestCountBadge}>
              <Text style={s.requestCountBadgeTxt}>{pendingCount}</Text>
            </View>
          )}
        </View>
        <View style={s.crewCardInfo}>
          <Text style={s.crewCardName}>{crew.name}</Text>
          {crew.description ? (
            <Text style={s.crewCardDesc} numberOfLines={1}>{crew.description}</Text>
          ) : null}
          <Text style={s.crewCardMeta}>
            <Ionicons name="people-outline" size={12} color={C.textMuted} /> {crew.member_count} member{crew.member_count !== 1 ? "s" : ""}
          </Text>
          {(crew.run_style || vibes.length > 0) ? (
            <View style={s.crewCardChips}>
              {crew.run_style ? (
                <View style={s.crewStyleChip}>
                  <Text style={s.crewStyleChipTxt}>{crew.run_style}</Text>
                </View>
              ) : null}
              {vibes.slice(0, 2).map((v) => (
                <View key={v} style={s.crewVibeChip}>
                  <Text style={s.crewVibeChipTxt}>{v}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {crew.chat_muted && (
          <Ionicons name="notifications-off-outline" size={16} color={C.textMuted} />
        )}
        <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

// ─── Create Crew Sheet ────────────────────────────────────────────────────────
function CreateCrewSheet({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (crew: Crew) => void }) {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState("🏃");
  const [runStyle, setRunStyle] = useState<string | null>(null);
  const [vibes, setVibes] = useState<string[]>([]);
  const [homeMetro, setHomeMetro] = useState<string | null>(null);
  const [homeState, setHomeState] = useState<string | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const qc = useQueryClient();

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow photo library access to upload a crew image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setImageUri(asset.uri);
    setIsUploading(true);
    try {
      const formData = new FormData();
      const ext = asset.uri.split(".").pop() ?? "jpg";
      formData.append("photo", { uri: asset.uri, name: `crew-image.${ext}`, type: `image/${ext}` } as any);
      const base = getApiUrl();
      const res = await fetch(new URL("/api/upload/photo", base).toString(), {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await res.json();
      if (data.url) setImageUrl(data.url);
      else throw new Error("Upload failed");
    } catch {
      Alert.alert("Upload failed", "Could not upload image. Please try again.");
      setImageUri(null);
      setImageUrl(null);
    } finally {
      setIsUploading(false);
    }
  }

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; emoji: string; runStyle?: string; tags: string[]; imageUrl?: string; homeMetro?: string; homeState?: string }) => {
      const res = await apiRequest("POST", "/api/crews", data);
      return res.json() as Promise<Crew>;
    },
    onSuccess: (crew: Crew) => {
      qc.invalidateQueries({ queryKey: ["/api/crews"] });
      setName("");
      setDescription("");
      setEmoji("🏃");
      setRunStyle(null);
      setVibes([]);
      setHomeMetro(null);
      setHomeState(null);
      setImageUri(null);
      setImageUrl(null);
      onCreated(crew);
    },
    onError: (e: any) => {
      if (e.message?.startsWith("409:")) {
        Alert.alert("Name taken", "A crew with that name already exists. Please choose a different name.");
      } else {
        Alert.alert("Error", e.message ?? "Could not create crew");
      }
    },
  });

  const handleCreate = () => {
    if (!name.trim()) { Alert.alert("Name required", "Give your crew a name"); return; }
    createMutation.mutate({ 
      name: name.trim(), 
      description: description.trim(), 
      emoji, 
      runStyle: runStyle ?? undefined, 
      tags: vibes, 
      imageUrl: imageUrl ?? undefined,
      homeMetro: homeMetro ?? undefined,
      homeState: homeState ?? undefined
    });
  };

  const toggleVibe = (v: string) => setVibes((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);

  const { data: metros } = useQuery<{ name: string; state: string }[]>({
    queryKey: ["/api/metro-areas"],
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={s.sheet}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>Create Crew</Text>
            <TouchableOpacity onPress={onClose} testID="close-create-crew">
              <Ionicons name="close" size={24} color={C.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
            <Text style={s.fieldLabel}>Crew Icon</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 }}>
              {/* Upload photo button */}
              <TouchableOpacity style={s.imagePickerBtn} onPress={pickImage} disabled={isUploading}>
                {isUploading ? (
                  <ActivityIndicator color={C.primary} />
                ) : imageUri ? (
                  <Image source={{ uri: imageUri }} style={s.imagePickerPreview} />
                ) : (
                  <>
                    <Ionicons name="add" size={24} color={C.textMuted} />
                    <Text style={s.imagePickerTxt}>Photo</Text>
                  </>
                )}
              </TouchableOpacity>
              {/* Emoji scroll */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 8 }}>
                {EMOJIS.map((e) => (
                  <TouchableOpacity
                    key={e}
                    style={[s.emojiOption, !imageUri && emoji === e && s.emojiOptionActive]}
                    onPress={() => { setEmoji(e); setImageUri(null); setImageUrl(null); }}
                  >
                    <Text style={s.emojiOptionText}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <Text style={s.fieldLabel}>Crew name</Text>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Dawn Patrol, Weekend Warriors"
              placeholderTextColor={C.textMuted}
              maxLength={20}
              testID="crew-name-input"
            />

            <Text style={s.fieldLabel}>Description <Text style={s.fieldOptional}>(optional)</Text></Text>
            <TextInput
              style={[s.input, s.inputMulti]}
              value={description}
              onChangeText={setDescription}
              placeholder="What's your crew about?"
              placeholderTextColor={C.textMuted}
              multiline
              numberOfLines={3}
              maxLength={120}
              testID="crew-desc-input"
            />

            <Text style={s.fieldLabel}>Run Style <Text style={s.fieldOptional}>(optional)</Text></Text>
            <Text style={s.fieldHint}>What kind of activities does your crew do?</Text>
            <View style={s.chipsGrid}>
              {CREW_RUN_STYLES.map((st) => (
                <TouchableOpacity
                  key={st}
                  style={[s.chip, runStyle === st && s.chipStyleActive]}
                  onPress={() => setRunStyle(runStyle === st ? null : st)}
                >
                  <Text style={[s.chipTxt, runStyle === st && s.chipStyleActiveTxt]}>{st}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.fieldLabel}>Group Vibe <Text style={s.fieldOptional}>— select all that apply</Text></Text>
            <Text style={s.fieldHint}>Describe your crew's personality, community, and style.</Text>
            {CREW_VIBE_GROUPS.map(({ label, options }) => (
              <View key={label}>
                <Text style={s.vibeCategoryLabel}>{label}</Text>
                <View style={s.chipsGrid}>
                  {options.map((v) => (
                    <TouchableOpacity
                      key={v}
                      style={[s.chip, vibes.includes(v) && s.chipVibeActive]}
                      onPress={() => toggleVibe(v)}
                    >
                      <Text style={[s.chipTxt, vibes.includes(v) && s.chipVibeActiveTxt]}>{v}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}

            <Text style={s.fieldLabel}>Home Base <Text style={s.fieldOptional}>(optional)</Text></Text>
            <Text style={s.fieldHint}>Set a home city for regional rankings.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
              <View style={s.chipsGrid}>
                {metros?.map((m) => (
                  <TouchableOpacity
                    key={`${m.name}-${m.state}`}
                    style={[s.chip, homeMetro === m.name && s.chipVibeActive]}
                    onPress={() => {
                      if (homeMetro === m.name) {
                        setHomeMetro(null);
                        setHomeState(null);
                      } else {
                        setHomeMetro(m.name);
                        setHomeState(m.state);
                      }
                    }}
                  >
                    <Text style={[s.chipTxt, homeMetro === m.name && s.chipVibeActiveTxt]}>{m.name}, {m.state}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[s.primaryBtn, createMutation.isPending && { opacity: 0.6 }]}
              onPress={handleCreate}
              disabled={createMutation.isPending}
              testID="create-crew-btn"
            >
              {createMutation.isPending
                ? <ActivityIndicator color={C.bg} />
                : <Text style={s.primaryBtnTxt}>Create Crew</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Invite User Sheet ────────────────────────────────────────────────────────
function InviteUserSheet({
  onClose,
  crewId,
  existingMemberIds,
  pendingRequestIds,
}: {
  onClose: () => void;
  crewId: string;
  existingMemberIds: string[];
  pendingRequestIds: string[];
}) {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const qc = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const url = new URL("/api/users/search", getApiUrl());
        url.searchParams.set("q", q);
        const res = await fetch(url.toString(), { credentials: "include" });
        const data = await res.json();
        setResults(data.filter((u: UserSearchResult) => !existingMemberIds.includes(u.id)));
      } catch {}
      setSearching(false);
    }, 350);
  }, [existingMemberIds]);

  const inviteMutation = useMutation({
    mutationFn: (userId: string) => apiRequest("POST", `/api/crews/${crewId}/invite`, { userId }),
    onSuccess: (_: any, userId: string) => {
      setInvited((prev) => new Set(prev).add(userId));
      qc.invalidateQueries({ queryKey: ["/api/crews", crewId] });
    },
    onError: (e: any) => Alert.alert("Error", e.message ?? "Could not send invite"),
  });

  const handleClose = () => {
    setQuery("");
    setResults([]);
    setInvited(new Set());
    onClose();
  };

  return (
    <View style={s.inviteOverlay}>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={handleClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={s.inviteOverlaySheet}
      >
      <View style={{ flex: 1 }}>
        <View style={s.sheetHandle} />
        <View style={s.sheetHeader}>
          <Text style={s.sheetTitle}>Invite to Crew</Text>
          <TouchableOpacity onPress={handleClose} testID="close-invite-sheet">
            <Ionicons name="close" size={24} color={C.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={s.memberSearchBar}>
          <Ionicons name="search-outline" size={18} color={C.textMuted} style={{ marginRight: 8 }} />
          <TextInput
            style={s.memberSearchInput}
            value={query}
            onChangeText={search}
            placeholder="Search by username"
            placeholderTextColor={C.textMuted}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            testID="invite-search-input"
          />
          {searching && <ActivityIndicator size="small" color={C.primary} />}
        </View>

        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          {results.length === 0 && query.length >= 2 && !searching && (
            <Text style={s.noResults}>No users found</Text>
          )}
          {results.map((u) => (
            <View key={u.id} style={s.searchResultRow}>
              <View style={s.searchResultAvatar}>
                <Text style={s.searchResultAvatarText}>{u.name[0]?.toUpperCase()}</Text>
              </View>
              <View style={s.searchResultInfo}>
                <Text style={s.searchResultName}>{u.name}</Text>
                <Text style={s.searchResultMeta}>
                  {u.username ? `@${u.username}` : ""}
                  {u.username && (u.hosted_runs ?? 0) > 0 ? "  ·  " : ""}
                  {(u.hosted_runs ?? 0) > 0 ? `${u.hosted_runs} hosted` : ""}
                </Text>
              </View>
              {pendingRequestIds.includes(u.id) ? (
                <View style={[s.invitedBadge, { borderColor: C.orange + "88" }]}>
                  <Ionicons name="time-outline" size={14} color={C.orange} />
                  <Text style={[s.invitedBadgeTxt, { color: C.orange }]}>Requested</Text>
                </View>
              ) : invited.has(u.id) ? (
                <View style={s.invitedBadge}>
                  <Ionicons name="checkmark" size={14} color={C.primary} />
                  <Text style={s.invitedBadgeTxt}>Invited</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={s.inviteBtn}
                  onPress={() => inviteMutation.mutate(u.id)}
                  testID={`invite-user-${u.id}`}
                >
                  <Text style={s.inviteBtnTxt}>Invite</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </ScrollView>
      </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Member Mini-Profile Sheet ────────────────────────────────────────────────
function MemberProfileSheet({
  userId,
  visible,
  onClose,
  currentUserId,
}: {
  userId: string | null;
  visible: boolean;
  onClose: () => void;
  currentUserId: string;
}) {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const { user: authUser } = useAuth();
  const distUnit: DistanceUnit = ((authUser as any)?.distance_unit ?? "miles") as DistanceUnit;
  const qc = useQueryClient();

  const { data: profile, isLoading: profileLoading } = useQuery<{
    id: string; name: string; photo_url?: string; avg_pace?: number;
    total_miles?: number; completed_runs?: number; hosted_runs?: number; friends_count?: number;
  }>({
    queryKey: ["/api/users", userId, "profile"],
    queryFn: async () => {
      const res = await fetch(new URL(`/api/users/${userId}/profile`, getApiUrl()).toString(), { credentials: "include" });
      return res.json();
    },
    enabled: !!userId && visible,
    staleTime: 30000,
  });

  const { data: friendship, isLoading: friendLoading } = useQuery<{ status: string; friendshipId: string | null }>({
    queryKey: ["/api/users", userId, "friendship"],
    queryFn: async () => {
      const res = await fetch(new URL(`/api/users/${userId}/friendship`, getApiUrl()).toString(), { credentials: "include" });
      return res.json();
    },
    enabled: !!userId && visible && userId !== currentUserId,
    staleTime: 10000,
  });

  const friendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/friends/request", { userId });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/users", userId, "friendship"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Alert.alert("Error", "Could not send friend request"),
  });

  const isMe = userId === currentUserId;
  const fStatus = friendship?.status;

  function friendBtnLabel() {
    if (fStatus === "accepted") return "Friends";
    if (fStatus === "pending") return "Request Sent";
    return "Add Friend";
  }
  function friendBtnIcon(): any {
    if (fStatus === "accepted") return "people-outline";
    if (fStatus === "pending") return "time-outline";
    return "person-add-outline";
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.miniOverlay}>
        <View style={[s.miniSheet, { paddingBottom: 32 }]}>
          <View style={s.miniHandle} />

          {/* Close */}
          <Pressable style={s.miniClose} onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color={C.textMuted} />
          </Pressable>

          {profileLoading ? (
            <ActivityIndicator color={C.primary} style={{ marginTop: 40, marginBottom: 40 }} />
          ) : profile ? (
            <>
              {/* Avatar + name */}
              <View style={s.miniAvatarWrap}>
                {resolveImgUrl(profile.photo_url) ? (
                  <Image source={{ uri: resolveImgUrl(profile.photo_url)! }} style={s.miniAvatar} />
                ) : (
                  <View style={[s.miniAvatar, s.miniAvatarFallback]}>
                    <Text style={s.miniAvatarLetter}>{profile.name?.[0]?.toUpperCase()}</Text>
                  </View>
                )}
              </View>
              <Text style={s.miniName}>{profile.name}</Text>

              {/* Stats row */}
              <View style={s.miniStatsRow}>
                {[
                  { label: "Miles", value: (profile.total_miles ?? 0).toFixed(1) },
                  { label: "Runs", value: String(profile.completed_runs ?? 0) },
                  { label: "Hosted", value: String(profile.hosted_runs ?? 0) },
                  { label: "Friends", value: String(profile.friends_count ?? 0) },
                ].map((stat) => (
                  <View key={stat.label} style={s.miniStat}>
                    <Text style={s.miniStatVal}>{stat.value}</Text>
                    <Text style={s.miniStatLbl}>{stat.label}</Text>
                  </View>
                ))}
              </View>

              {profile.avg_pace && profile.avg_pace > 0 ? (
                <Text style={s.miniPace}>{toDisplayPace(profile.avg_pace, distUnit)} avg pace</Text>
              ) : null}

              {/* Action buttons */}
              {!isMe && (
                <View style={s.miniActions}>
                  {/* Add Friend */}
                  <Pressable
                    style={[
                      s.miniActionBtn,
                      fStatus === "accepted" && { backgroundColor: C.primaryMuted },
                    ]}
                    disabled={fStatus === "accepted" || fStatus === "pending" || friendLoading || friendMutation.isPending}
                    onPress={() => friendMutation.mutate()}
                  >
                    <Ionicons name={friendBtnIcon()} size={16} color={fStatus === "accepted" ? C.primary : C.bg} />
                    <Text style={[s.miniActionBtnTxt, fStatus === "accepted" && { color: C.primary }]}>
                      {friendMutation.isPending ? "Sending…" : friendBtnLabel()}
                    </Text>
                  </Pressable>

                  {/* Message */}
                  <Pressable
                    style={s.miniActionSecondary}
                    onPress={() => { onClose(); router.push(`/(tabs)/messages?userId=${userId}`); }}
                  >
                    <Ionicons name="chatbubble-outline" size={16} color={C.primary} />
                    <Text style={s.miniActionSecondaryTxt}>Message</Text>
                  </Pressable>
                </View>
              )}
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

// ─── Crew Achievement Definitions ────────────────────────────────────────────

const CREW_MILESTONES = [
  { key: "miles_50",    category: "miles",   threshold: 50,   label: "50 Miles",    emoji: "🏅" },
  { key: "miles_100",   category: "miles",   threshold: 100,  label: "100 Miles",   emoji: "🏅" },
  { key: "miles_250",   category: "miles",   threshold: 250,  label: "250 Miles",   emoji: "🏅" },
  { key: "miles_500",   category: "miles",   threshold: 500,  label: "500 Miles",   emoji: "🔥" },
  { key: "miles_1000",  category: "miles",   threshold: 1000, label: "1,000 Miles", emoji: "🏆" },
  { key: "miles_2500",  category: "miles",   threshold: 2500, label: "2,500 Miles", emoji: "🏆" },
  { key: "miles_5000",  category: "miles",   threshold: 5000, label: "5,000 Miles", emoji: "🏆" },
  { key: "events_1",   category: "events",  threshold: 1,    label: "First Run",   emoji: "🎯" },
  { key: "events_5",   category: "events",  threshold: 5,    label: "5 Events",    emoji: "🎉" },
  { key: "events_10",  category: "events",  threshold: 10,   label: "10 Events",   emoji: "🎉" },
  { key: "events_25",  category: "events",  threshold: 25,   label: "25 Events",   emoji: "🎉" },
  { key: "events_50",  category: "events",  threshold: 50,   label: "50 Events",   emoji: "🏆" },
  { key: "events_100", category: "events",  threshold: 100,  label: "100 Events",  emoji: "🏆" },
  { key: "members_5",  category: "members", threshold: 5,    label: "5 Members",   emoji: "👥" },
  { key: "members_10", category: "members", threshold: 10,   label: "10 Members",  emoji: "👥" },
  { key: "members_25", category: "members", threshold: 25,   label: "25 Members",  emoji: "👥" },
  { key: "members_50", category: "members", threshold: 50,   label: "50 Members",  emoji: "👥" },
];

function formatAchievedDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return ""; }
}

function CrewAchievementsSection({
  achievementsData,
  styles: s,
  C,
  distUnit = "miles",
}: {
  achievementsData?: { achievements: any[]; stats: { totalMiles: number; totalEvents: number; totalMembers: number } };
  styles: any;
  C: ColorScheme;
  distUnit?: DistanceUnit;
}) {
  const earned = achievementsData?.achievements ?? [];
  const stats = achievementsData?.stats ?? { totalMiles: 0, totalEvents: 0, totalMembers: 0 };
  const earnedKeys = new Set(earned.map((a: any) => a.achievement_key));

  const getBadgeColor = (key: string) => {
    if (key.startsWith("miles_500") || key.startsWith("miles_1000") || key.startsWith("miles_2500") || key.startsWith("miles_5000") || key.startsWith("events_50") || key.startsWith("events_100")) return "#FFB800";
    return C.primary;
  };

  const nextMilestone = (category: string) => {
    const catMilestones = CREW_MILESTONES.filter(m => m.category === category);
    return catMilestones.find(m => !earnedKeys.has(m.key)) ?? null;
  };

  const currentValue = (category: string) => {
    if (category === "miles") return stats.totalMiles;
    if (category === "events") return stats.totalEvents;
    return stats.totalMembers;
  };

  const prevMilestone = (category: string) => {
    const catMilestones = CREW_MILESTONES.filter(m => m.category === category);
    const idx = catMilestones.findIndex(m => !earnedKeys.has(m.key));
    return idx > 0 ? catMilestones[idx - 1] : null;
  };

  const progressBars = ["miles", "events", "members"].map(cat => {
    const next = nextMilestone(cat);
    if (!next) return null;
    const prev = prevMilestone(cat);
    const val = currentValue(cat);
    const from = prev?.threshold ?? 0;
    const to = next.threshold;
    const progress = Math.min(1, Math.max(0, (val - from) / (to - from)));
    const label = cat === "miles" ? `${toDisplayDist(val ?? 0, distUnit)} / ${toDisplayDist(to, distUnit)}` : cat === "events" ? `${val ?? 0} / ${to} events` : `${val ?? 0} / ${to} members`;
    return { key: next.key, label, progress, nextLabel: next.label, nextEmoji: next.emoji };
  }).filter(Boolean);

  return (
    <View style={s.detailSection}>
      <Text style={s.detailSectionTitle}>Achievements</Text>
      {earned.length === 0 ? (
        <View style={s.achieveEmpty}>
          <Text style={s.achieveEmptyText}>Run together to earn your first milestone!</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
          {earned.map((a: any) => {
            const def = CREW_MILESTONES.find(m => m.key === a.achievement_key);
            if (!def) return null;
            const color = getBadgeColor(a.achievement_key);
            return (
              <View key={a.id} style={[s.achieveBadge, { borderColor: color + "55", backgroundColor: color + "18" }]}>
                <Text style={s.achieveBadgeEmoji}>{def.emoji}</Text>
                <Text style={[s.achieveBadgeLabel, { color }]}>{def.label}</Text>
                <Text style={s.achieveBadgeDate}>{formatAchievedDate(a.achieved_at)}</Text>
              </View>
            );
          })}
          {/* Locked next badges per category */}
          {["miles", "events", "members"].map(cat => {
            const next = nextMilestone(cat);
            if (!next) return null;
            return (
              <View key={next.key} style={[s.achieveBadge, { borderColor: C.border, backgroundColor: C.surface, opacity: 0.3 }]}>
                <Text style={s.achieveBadgeEmoji}>{next.emoji}</Text>
                <Text style={[s.achieveBadgeLabel, { color: C.textSecondary }]}>{next.label}</Text>
                <Ionicons name="lock-closed-outline" size={10} color={C.textMuted} />
              </View>
            );
          })}
        </ScrollView>
      )}
      {progressBars.length > 0 && (
        <View style={s.achieveProgressWrap}>
          {progressBars.map((pb: any) => (
            <View key={pb.key} style={s.achieveProgressRow}>
              <View style={s.achieveProgressBarBg}>
                <View style={[s.achieveProgressBarFill, { width: `${Math.round(pb.progress * 100)}%` as any }]} />
              </View>
              <Text style={s.achieveProgressLabel}>{pb.label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Crew Detail Sheet ────────────────────────────────────────────────────────
function CrewDetailSheet({
  crew,
  onClose,
  currentUserId,
  onCapReached,
}: {
  crew: Crew | null;
  onClose: () => void;
  currentUserId: string;
  onCapReached?: (crewId: string) => void;
}) {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const { user: authUser } = useAuth();
  const distUnit: DistanceUnit = ((authUser as any)?.distance_unit ?? "miles") as DistanceUnit;
  const { activityFilter, setActivityFilter } = useActivity();
  const [showInvite, setShowInvite] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [roleSheetMember, setRoleSheetMember] = useState<{ user_id: string; name: string; role: string } | null>(null);
  const qc = useQueryClient();

  const isMockCrew = crew?.id?.startsWith("walkthrough-mock-") ?? false;

  const { data: detail, isLoading: detailLoading } = useQuery<CrewDetail>({
    queryKey: ["/api/crews", crew?.id],
    enabled: !!crew?.id && !isMockCrew,
  });

  const { data: crewRuns = [] } = useQuery<Run[]>({
    queryKey: ["/api/crews", crew?.id, "runs"],
    enabled: !!crew?.id && !isMockCrew,
  });

  const { data: crewHistory = [] } = useQuery<CrewHistoryRun[]>({
    queryKey: ["/api/crews", crew?.id, "history"],
    enabled: !!crew?.id && !isMockCrew,
  });

  const { data: crewAchievementsData } = useQuery<{ achievements: any[]; stats: { totalMiles: number; totalEvents: number; totalMembers: number } }>({
    queryKey: ["/api/crews", crew?.id, "achievements"],
    enabled: !!crew?.id && !isMockCrew,
  });

  const isCreatorLocal = crew?.created_by === currentUserId;

  const { data: joinRequests = [], refetch: refetchRequests } = useQuery<JoinRequest[]>({
    queryKey: ["/api/crews", crew?.id, "join-requests"],
    enabled: !!crew?.id && isCreatorLocal && !isMockCrew,
  });

  const respondMutation = useMutation({
    mutationFn: ({ userId, accept }: { userId: string; accept: boolean }) =>
      apiRequest("POST", `/api/crews/${crew?.id}/join-requests/${userId}/respond`, { accept }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crews", crew?.id, "join-requests"] });
      qc.invalidateQueries({ queryKey: ["/api/crews", crew?.id] });
      qc.invalidateQueries({ queryKey: ["/api/crews"] });
    },
    onError: (e: any) => {
      const msg = e?.message || "";
      if (msg.includes("MEMBER_CAP_REACHED") || msg.includes("member cap")) {
        if (isCreatorLocal && crew?.id && onCapReached) {
          onCapReached(crew.id);
        } else {
          Alert.alert("Crew Full", "This crew has reached its 100-member limit.");
        }
      } else {
        Alert.alert("Error", e?.message ?? "Could not respond to request");
      }
    },
  });

  const leaveMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/crews/${crew?.id}/leave`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crews"] });
      onClose();
    },
    onError: (e: any) => Alert.alert("Error", e.message ?? "Could not leave crew"),
  });

  const disbandMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/crews/${crew?.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crews"] });
      onClose();
    },
    onError: (e: any) => Alert.alert("Error", e.message ?? "Could not disband crew"),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) => apiRequest("DELETE", `/api/crews/${crew?.id}/members/${memberId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crews", crew?.id] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (e: any) => Alert.alert("Error", e.message ?? "Could not remove member"),
  });

  const muteMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/crews/${crew?.id}/mute`).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crews"] });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    onError: (e: any) => Alert.alert("Error", e.message ?? "Could not update notification setting"),
  });

  const isMuted = crew?.chat_muted ?? false;

  function handleRemoveMember(memberId: string, memberName: string) {
    Alert.alert(
      "Remove Member",
      `Remove ${memberName} from ${crew?.name}? They will need to be re-invited to rejoin.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => removeMemberMutation.mutate(memberId),
        },
      ]
    );
  }

  const promoteRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      apiRequest("PUT", `/api/crews/${crew?.id}/members/${userId}/role`, { role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crews", crew?.id] });
      qc.invalidateQueries({ queryKey: ["/api/crews"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (e: any) => Alert.alert("Error", e?.message ?? "Could not update role"),
  });

  function handleMemberRolePress(m: { user_id: string; name: string; role: string }) {
    const currentRole = m.role ?? "member";
    const options: { label: string; role: string; destructive?: boolean }[] = [];
    if (currentRole !== "crew_chief") {
      options.push({ label: "Make Crew Chief", role: "crew_chief" });
    }
    if (currentRole !== "officer") {
      options.push({ label: currentRole === "crew_chief" ? "Demote to Officer" : "Make Officer", role: "officer" });
    }
    if (currentRole !== "member") {
      options.push({ label: "Demote to Member", role: "member", destructive: true });
    }
    Alert.alert(
      m.name,
      `Current role: ${currentRole === "crew_chief" ? "Crew Chief" : currentRole === "officer" ? "Officer" : "Member"}`,
      [
        ...options.map((o) => ({
          text: o.label,
          style: (o.destructive ? "destructive" : "default") as "destructive" | "default",
          onPress: () => {
            if (o.role === "crew_chief") {
              Alert.alert(
                "Transfer Leadership",
                `Make ${m.name} the new Crew Chief? You will become an Officer.`,
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Confirm", onPress: () => promoteRoleMutation.mutate({ userId: m.user_id, role: o.role }) },
                ]
              );
            } else {
              promoteRoleMutation.mutate({ userId: m.user_id, role: o.role });
            }
          },
        })),
        { text: "View Profile", onPress: () => setSelectedMemberId(m.user_id) },
        { text: "Cancel", style: "cancel" },
      ]
    );
  }

  const handleLeave = () => {
    const isCreatorWithOthers = isCreator && members.length > 1;
    Alert.alert(
      "Leave Crew",
      isCreatorWithOthers
        ? `You are the Crew Chief of ${crew?.name}. If you leave, the next member to join will become the new Crew Chief and the crew stays active.`
        : `Are you sure you want to leave ${crew?.name}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: () => leaveMutation.mutate() },
      ]
    );
  };

  const handleDisband = () => {
    Alert.alert(
      "Disband Crew",
      `This will permanently delete ${crew?.name} and remove all members. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Disband", style: "destructive", onPress: () => disbandMutation.mutate() },
      ]
    );
  };

  const [eventsExpanded, setEventsExpanded] = useState(false);

  const { data: crewMessages = [], refetch: refetchMessages } = useQuery<any[]>({
    queryKey: ["/api/crews", crew?.id, "messages"],
    enabled: !!crew?.id && !isMockCrew,
    refetchInterval: isMockCrew ? false : 5000,
  });

  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatScrollRef = useRef<ScrollView>(null);
  const outerScrollRef = useRef<ScrollView>(null);
  const chatSectionY = useRef(0);
  const isChatFocused = useRef(false);
  const chatInputRef = useRef<TextInput>(null);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifSearch, setGifSearch] = useState("");
  const [gifResults, setGifResults] = useState<GifItem[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [selectedGif, setSelectedGif] = useState<GifItem | null>(null);

  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    if (crewMessages.length > 0) {
      setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: false }), 80);
    }
    const newMsgs = crewMessages.slice(prevMsgCountRef.current);
    const hasMilestone = newMsgs.some((m: any) => m.message_type === "milestone");
    if (hasMilestone && crew?.id) {
      qc.invalidateQueries({ queryKey: ["/api/crews", crew.id, "achievements"] });
    }
    prevMsgCountRef.current = crewMessages.length;
  }, [crewMessages.length]);

  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      if (!isChatFocused.current) return;
      outerScrollRef.current?.scrollTo({ y: chatSectionY.current, animated: true });
    });
    return () => sub.remove();
  }, []);

  async function fetchGifs(query: string) {
    setGifLoading(true);
    try {
      const url = new URL("/api/gifs/search", getApiUrl());
      if (query.trim()) url.searchParams.set("q", query.trim());
      url.searchParams.set("limit", "20");
      const resp = await fetch(url.toString(), { credentials: "include" });
      const data = await resp.json();
      setGifResults(Array.isArray(data) ? data : []);
    } catch {
      setGifResults([]);
    } finally {
      setGifLoading(false);
    }
  }

  useEffect(() => {
    if (!showGifPicker) return;
    const t = setTimeout(() => fetchGifs(gifSearch), gifSearch ? 400 : 0);
    return () => clearTimeout(t);
  }, [gifSearch, showGifPicker]);

  async function sendChatMessage() {
    const text = chatInput.trim();
    if (!text && !selectedGif || chatSending) return;
    const gifToSend = selectedGif;
    setChatInput("");
    setSelectedGif(null);
    setChatSending(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (gifToSend && text) {
        // Send GIF and text as two separate messages
        await apiRequest("POST", `/api/crews/${crew?.id}/messages`, {
          gif_url: gifToSend.gif_url,
          gif_preview_url: gifToSend.preview_url,
        });
        await apiRequest("POST", `/api/crews/${crew?.id}/messages`, {
          message: text,
        });
      } else {
        await apiRequest("POST", `/api/crews/${crew?.id}/messages`, {
          message: text,
          ...(gifToSend ? { gif_url: gifToSend.gif_url, gif_preview_url: gifToSend.preview_url } : {}),
        });
      }
      refetchMessages();
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Could not send message");
      setChatInput(text);
      setSelectedGif(gifToSend);
    } finally {
      setChatSending(false);
    }
  }

  const filteredRuns = crewRuns.filter((r) => (r.activity_type ?? "run") === activityFilter);
  const visibleRuns = eventsExpanded ? filteredRuns : filteredRuns.slice(0, 5);
  const members = detail?.members ?? [];
  const memberIds = members.map((m) => m.user_id);
  const isCreator = crew?.created_by === currentUserId;

  return (
    <>
      <Modal visible={!!crew} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <KeyboardAvoidingView style={s.sheet} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={s.sheetHandle} />
          {!crew ? null : (
            <>
              <ScrollView ref={outerScrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

                {/* Close button row */}
                <View style={s.detailCloseRow}>
                  <TouchableOpacity onPress={onClose} testID="close-crew-detail" style={s.detailCloseBtn}>
                    <Ionicons name="close" size={22} color={C.textMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => muteMutation.mutate()}
                    disabled={muteMutation.isPending}
                    style={s.muteToggleBtn}
                    testID="mute-crew-chat-btn"
                  >
                    <Ionicons
                      name={isMuted ? "notifications-off-outline" : "notifications-outline"}
                      size={20}
                      color={isMuted ? C.textMuted : C.text}
                    />
                    <Text style={[s.muteToggleTxt, isMuted && s.muteToggleTxtMuted]}>
                      {isMuted ? "Chat muted" : "Mute chat"}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Hero title */}
                <View style={s.detailHero}>
                  {crew.image_url ? (
                    <Image source={{ uri: resolveImgUrl(crew.image_url)! }} style={s.detailHeroImage} />
                  ) : (
                    <Text style={s.detailHeroEmoji}>{crew.emoji}</Text>
                  )}
                  <Text style={s.detailHeroName}>{crew.name}</Text>
                  {crew.description ? (
                    <Text style={s.detailDesc}>{crew.description}</Text>
                  ) : null}
                </View>

                {/* Runs / Rides / Walks toggle */}
                <View style={s.detailToggleRow}>
                  <TouchableOpacity
                    style={[s.detailToggleBtn, activityFilter === "run" && s.detailToggleBtnActive]}
                    onPress={() => setActivityFilter("run")}
                  >
                    <Ionicons name="walk" size={14} color={activityFilter === "run" ? C.bg : C.textMuted} />
                    <Text style={[s.detailToggleTxt, activityFilter === "run" && s.detailToggleTxtActive]}>Runs</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.detailToggleBtn, activityFilter === "ride" && s.detailToggleBtnActive]}
                    onPress={() => setActivityFilter("ride")}
                  >
                    <Ionicons name="bicycle" size={14} color={activityFilter === "ride" ? C.bg : C.textMuted} />
                    <Text style={[s.detailToggleTxt, activityFilter === "ride" && s.detailToggleTxtActive]}>Rides</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.detailToggleBtn, activityFilter === "walk" && s.detailToggleBtnActive]}
                    onPress={() => setActivityFilter("walk")}
                  >
                    <Ionicons name="footsteps" size={14} color={activityFilter === "walk" ? C.bg : C.textMuted} />
                    <Text style={[s.detailToggleTxt, activityFilter === "walk" && s.detailToggleTxtActive]}>Walks</Text>
                  </TouchableOpacity>
                </View>

                {/* Join Requests — crew chief only */}
                {isCreatorLocal && joinRequests.length > 0 && (
                  <View style={[s.detailSection, s.requestsSection]}>
                    <View style={s.detailSectionHeader}>
                      <Text style={s.detailSectionTitle}>
                        Join Requests
                      </Text>
                      <View style={s.requestCountBadge}>
                        <Text style={s.requestCountBadgeTxt}>{joinRequests.length}</Text>
                      </View>
                    </View>
                    {joinRequests.map((req) => (
                      <View key={req.user_id} style={s.requestRow}>
                        {resolveImgUrl(req.photo_url) ? (
                          <Image
                            source={{ uri: resolveImgUrl(req.photo_url)! }}
                            style={[s.memberAvatar, { overflow: "hidden" }]}
                          />
                        ) : (
                          <View style={s.memberAvatar}>
                            <Text style={s.memberAvatarText}>{req.name[0]?.toUpperCase()}</Text>
                          </View>
                        )}
                        <View style={s.requestInfo}>
                          <Text style={s.memberName}>{req.name}</Text>
                          {req.username ? <Text style={s.memberMeta}>@{req.username}</Text> : null}
                        </View>
                        <TouchableOpacity
                          style={s.requestAcceptBtn}
                          onPress={() => respondMutation.mutate({ userId: req.user_id, accept: true })}
                          disabled={respondMutation.isPending}
                        >
                          <Text style={s.requestAcceptTxt}>Accept</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={s.requestDeclineBtn}
                          onPress={() => respondMutation.mutate({ userId: req.user_id, accept: false })}
                          disabled={respondMutation.isPending}
                        >
                          <Ionicons name="close" size={16} color={C.danger} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                {/* ── Upcoming Events (big cards) ── */}
                <View style={[s.detailSection, { paddingBottom: 5 }]}>
                  <View style={s.detailSectionHeader}>
                    <Text style={s.detailSectionTitle}>
                      Upcoming {activityFilter === "ride" ? "Rides" : activityFilter === "walk" ? "Walks" : "Runs"}
                    </Text>
                    {filteredRuns.length > 5 && (
                      <TouchableOpacity onPress={() => setEventsExpanded((x) => !x)}>
                        <Text style={s.viewAllTxt}>
                          {eventsExpanded ? "Show less" : `View all ${filteredRuns.length} →`}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {filteredRuns.length === 0 ? (
                    <View style={s.emptyRuns}>
                      <Ionicons
                        name={activityFilter === "ride" ? "bicycle-outline" : activityFilter === "walk" ? "footsteps-outline" : "walk-outline"}
                        size={28}
                        color={C.textMuted}
                      />
                      <Text style={s.emptyRunsTxt}>
                        No upcoming {activityFilter === "ride" ? "rides" : activityFilter === "walk" ? "walks" : "runs"} from your crew
                      </Text>
                    </View>
                  ) : (
                    visibleRuns.map((run) => (
                      <TouchableOpacity
                        key={run.id}
                        style={s.eventCard}
                        activeOpacity={0.75}
                        testID={`crew-run-row-${run.id}`}
                        onPress={() => {
                          onClose();
                          router.push({ pathname: "/run/[id]", params: { id: run.id } });
                        }}
                      >
                        <View style={s.eventCardTop}>
                          <View style={s.eventActivityPill}>
                            <Ionicons
                              name={run.activity_type === "ride" ? "bicycle-outline" : run.activity_type === "walk" ? "footsteps-outline" : "walk-outline"}
                              size={13}
                              color={C.primary}
                            />
                            <Text style={s.eventActivityTxt}>
                              {run.activity_type === "ride" ? "Ride" : run.activity_type === "walk" ? "Walk" : "Run"}
                            </Text>
                          </View>
                          <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
                        </View>
                        <Text style={s.eventCardTitle} numberOfLines={2}>{run.title}</Text>
                        <View style={s.eventCardMeta}>
                          <View style={s.eventMetaChip}>
                            <Ionicons name="calendar-outline" size={12} color={C.textMuted} />
                            <Text style={s.eventMetaChipTxt}>{formatDate(run.date)}</Text>
                          </View>
                          {run.min_distance ? (
                            <View style={s.eventMetaChip}>
                              <Ionicons name="navigate-outline" size={12} color={C.textMuted} />
                              <Text style={s.eventMetaChipTxt}>{toDisplayDist(run.min_distance, distUnit)}</Text>
                            </View>
                          ) : null}
                          <View style={s.eventMetaChip}>
                            <Ionicons name="people-outline" size={12} color={C.textMuted} />
                            <Text style={s.eventMetaChipTxt}>{run.participant_count ?? 1} going</Text>
                          </View>
                        </View>
                        <Text style={s.eventCardHost}>{run.host_id === crew?.created_by ? "👑 " : ""}Hosted by {run.host_name}</Text>
                      </TouchableOpacity>
                    ))
                  )}
                </View>

                {/* Schedule Run/Ride */}
                <TouchableOpacity
                  style={s.scheduleBtn}
                  onPress={() => {
                    onClose();
                    router.push({
                      pathname: "/create-run",
                      params: {
                        activityType: activityFilter,
                        crewId: crew?.id,
                        crewName: crew?.name,
                      },
                    });
                  }}
                  testID="schedule-crew-run-btn"
                >
                  <Ionicons
                    name={activityFilter === "ride" ? "bicycle-outline" : activityFilter === "walk" ? "footsteps-outline" : "walk-outline"}
                    size={16}
                    color={C.primary}
                  />
                  <Text style={s.scheduleBtnTxt}>
                    Schedule a {activityFilter === "ride" ? "Ride" : activityFilter === "walk" ? "Walk" : "Run"}
                  </Text>
                </TouchableOpacity>

                {/* ── Inline Crew Chat ── */}
                <View
                  style={s.detailSection}
                  onLayout={(e) => { chatSectionY.current = e.nativeEvent.layout.y; }}
                >
                  <WalkthroughPulse stepId="crew-chat" style={{ borderRadius: 12 }}>
                  <View style={s.detailSectionHeader}>
                    <Text style={s.detailSectionTitle}>Crew Chat</Text>
                    {isMuted && (
                      <Ionicons name="notifications-off-outline" size={14} color={C.textMuted} />
                    )}
                  </View>
                  </WalkthroughPulse>

                  {/* Messages scroll area */}
                  <View style={s.inlineChatBox}>
                    {crewMessages.length === 0 ? (
                      <View style={s.inlineChatEmpty}>
                        <Ionicons name="chatbubble-outline" size={20} color={C.textMuted} />
                        <Text style={s.inlineChatEmptyTxt}>No messages yet — say hello!</Text>
                      </View>
                    ) : (
                      <ScrollView
                        ref={chatScrollRef}
                        style={{ flex: 1 }}
                        contentContainerStyle={{ padding: 10, gap: 8, flexGrow: 1, justifyContent: "flex-end" }}
                        showsVerticalScrollIndicator={false}
                        nestedScrollEnabled
                        onContentSizeChange={() =>
                          chatScrollRef.current?.scrollToEnd({ animated: false })
                        }
                      >
                        {[...crewMessages].reverse().map((msg: any) => {
                          const isMe = msg.user_id === currentUserId;
                          const isPrompt = msg.message_type === "prompt";
                          const isMilestone = msg.message_type === "milestone";
                          const isGif = msg.message_type === "gif";

                          if (isMilestone) {
                            return (
                              <View key={msg.id} style={s.inlineMilestoneRow}>
                                <View style={s.inlineMilestoneBubble}>
                                  <Text style={s.inlineMilestoneTxt}>{msg.message}</Text>
                                </View>
                              </View>
                            );
                          }

                          if (isGif) {
                            return (
                              <View key={msg.id} style={[s.inlineMsgRow, isMe && s.inlineMsgRowMe]}>
                                {!isMe && (
                                  <View style={s.inlineMsgAvatar}>
                                    <Text style={s.inlineMsgAvatarTxt}>
                                      {(msg.sender_name ?? "?")[0].toUpperCase()}
                                    </Text>
                                  </View>
                                )}
                                <View style={[s.inlineGifBubble, isMe && s.inlineGifBubbleMe]}>
                                  {!isMe && <Text style={s.inlineMsgSender}>{msg.sender_name}</Text>}
                                  {msg.metadata?.gif_url ? (
                                    <ExpoImage
                                      source={{ uri: msg.metadata.gif_url }}
                                      style={s.inlineGifImage}
                                      contentFit="cover"
                                      autoplay
                                    />
                                  ) : null}
                                  {!!msg.message && (
                                    <Text style={[s.inlineMsgTxt, { marginTop: 4 }]}>
                                      {msg.message}
                                    </Text>
                                  )}
                                </View>
                              </View>
                            );
                          }

                          return (
                            <View key={msg.id} style={[s.inlineMsgRow, isMe && s.inlineMsgRowMe]}>
                              {!isMe && (
                                <View style={s.inlineMsgAvatar}>
                                  <Text style={s.inlineMsgAvatarTxt}>
                                    {(msg.sender_name ?? "?")[0].toUpperCase()}
                                  </Text>
                                </View>
                              )}
                              <View style={[
                                s.inlineMsgBubble,
                                isMe && s.inlineMsgBubbleMe,
                                isPrompt && s.inlineMsgBubblePrompt,
                              ]}>
                                {!isMe && (
                                  <Text style={s.inlineMsgSender}>{msg.sender_name}</Text>
                                )}
                                <Text style={[s.inlineMsgTxt, isMe && s.inlineMsgTxtMe]}>
                                  {msg.message}
                                </Text>
                                {isPrompt && msg.metadata?.quickReplies?.length > 0 && (
                                  <View style={s.inlineQuickReplyRow}>
                                    {msg.metadata.quickReplies.map((reply: string) => (
                                      <TouchableOpacity
                                        key={reply}
                                        style={s.inlineQuickReplyChip}
                                        onPress={() => setChatInput(reply)}
                                      >
                                        <Text style={s.inlineQuickReplyTxt}>{reply}</Text>
                                      </TouchableOpacity>
                                    ))}
                                  </View>
                                )}
                              </View>
                            </View>
                          );
                        })}
                      </ScrollView>
                    )}
                  </View>

                  {/* Selected GIF preview */}
                  {selectedGif && (
                    <View style={s.gifPreviewRow}>
                      <ExpoImage
                        source={{ uri: selectedGif.preview_url }}
                        style={s.gifPreviewThumb}
                        contentFit="cover"
                      />
                      <TouchableOpacity style={s.gifPreviewRemove} onPress={() => setSelectedGif(null)}>
                        <Ionicons name="close-circle" size={18} color={C.textMuted} />
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Input row */}
                  <View style={s.inlineChatInputRow}>
                    <TextInput
                      ref={chatInputRef}
                      style={s.inlineChatInput}
                      value={chatInput}
                      onChangeText={setChatInput}
                      placeholder="Send a message…"
                      placeholderTextColor={C.textMuted}
                      onSubmitEditing={sendChatMessage}
                      blurOnSubmit={false}
                      returnKeyType="send"
                      editable={!chatSending}
                      onFocus={() => { isChatFocused.current = true; }}
                      onBlur={() => { isChatFocused.current = false; }}
                    />
                    <TouchableOpacity
                      testID="gif-btn"
                      style={s.gifPickerBtn}
                      onPress={() => {
                        setGifSearch("");
                        setGifResults([]);
                        if (!isChatFocused.current) {
                          setShowGifPicker(true);
                          return;
                        }
                        let done = false;
                        const open = () => { if (done) return; done = true; setShowGifPicker(true); };
                        const sub = Keyboard.addListener("keyboardDidHide", () => { sub.remove(); open(); });
                        Keyboard.dismiss();
                        setTimeout(() => { sub.remove(); open(); }, 400);
                      }}
                    >
                      <Text style={s.gifPickerBtnTxt}>GIF</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.inlineSendBtn, (!chatInput.trim() && !selectedGif || chatSending) && s.inlineSendBtnDisabled]}
                      onPress={sendChatMessage}
                      disabled={(!chatInput.trim() && !selectedGif) || chatSending}
                    >
                      <Ionicons name="send" size={16} color={(chatInput.trim() || selectedGif) && !chatSending ? C.bg : C.textMuted} />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* ── Achievements ── */}
                <CrewAchievementsSection
                  achievementsData={crewAchievementsData}
                  styles={s}
                  C={C}
                  distUnit={distUnit}
                />

                {/* ── Members ── */}
                <View style={s.detailSection}>
                  <View style={s.detailSectionHeader}>
                    <Text style={s.detailSectionTitle}>Members ({members.length})</Text>
                    <TouchableOpacity
                      style={s.inviteChip}
                      onPress={() => setShowInvite(true)}
                      testID="open-invite-btn"
                    >
                      <Ionicons name="person-add-outline" size={14} color={C.primary} />
                      <Text style={s.inviteChipTxt}>Invite</Text>
                    </TouchableOpacity>
                  </View>

                  {detailLoading ? (
                    <ActivityIndicator color={C.primary} style={{ marginTop: 16 }} />
                  ) : (
                    members.map((m) => {
                      const memberRole = m.role ?? (m.user_id === crew.created_by ? "crew_chief" : "member");
                      const isCurrentUser = m.user_id === currentUserId;
                      const myRole = members.find((x) => x.user_id === currentUserId)?.role ?? (isCreator ? "crew_chief" : "member");
                      const canManage = myRole === "crew_chief" && !isCurrentUser;
                      return (
                        <TouchableOpacity
                          key={m.user_id}
                          style={s.memberRow}
                          activeOpacity={0.7}
                          onPress={() => canManage ? handleMemberRolePress({ user_id: m.user_id, name: m.name, role: memberRole }) : setSelectedMemberId(m.user_id)}
                        >
                          {resolveImgUrl(m.photo_url) ? (
                            <Image
                              source={{ uri: resolveImgUrl(m.photo_url)! }}
                              style={[s.memberAvatar, { overflow: "hidden" }]}
                            />
                          ) : (
                            <View style={s.memberAvatar}>
                              <Text style={s.memberAvatarText}>{m.name[0]?.toUpperCase()}</Text>
                            </View>
                          )}
                          <View style={s.memberInfo}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <Text style={s.memberName} numberOfLines={1}>{m.name}</Text>
                              {memberRole === "crew_chief" && (
                                <Ionicons name="shield" size={13} color="#FFD700" />
                              )}
                              {memberRole === "officer" && (
                                <Ionicons name="shield-outline" size={13} color={C.primary} />
                              )}
                            </View>
                            <Text style={s.memberMeta}>
                              {memberRole === "crew_chief" ? "Crew Chief" : memberRole === "officer" ? "Officer" : "Member"}
                              {m.avg_pace && m.avg_pace > 0 ? ` · ${toDisplayPace(m.avg_pace, distUnit)} avg` : ""}
                            </Text>
                          </View>
                          {canManage && (
                            <Pressable
                              onPress={(e) => { e.stopPropagation?.(); handleRemoveMember(m.user_id, m.name); }}
                              hitSlop={10}
                              style={s.removeMemberBtn}
                            >
                              <Feather name="user-minus" size={15} color={C.orange} />
                            </Pressable>
                          )}
                        </TouchableOpacity>
                      );
                    })
                  )}
                </View>

                {/* Past Runs/Rides history */}
                {crewHistory.filter((r) => (r.activity_type ?? "run") === activityFilter).length > 0 && (
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>
                      Past {activityFilter === "ride" ? "Rides" : activityFilter === "walk" ? "Walks" : "Runs"}
                    </Text>
                    {crewHistory
                      .filter((r) => (r.activity_type ?? "run") === activityFilter)
                      .map((run) => (
                        <TouchableOpacity
                          key={run.id}
                          style={s.historyRow}
                          activeOpacity={0.7}
                          onPress={() => {
                            onClose();
                            router.push({ pathname: "/run/[id]", params: { id: run.id } });
                          }}
                        >
                          <Ionicons
                            name={run.activity_type === "ride" ? "bicycle-outline" : run.activity_type === "walk" ? "footsteps-outline" : "walk-outline"}
                            size={15}
                            color={C.textMuted}
                            style={{ marginRight: 10, marginTop: 2 }}
                          />
                          <View style={{ flex: 1, gap: 3 }}>
                            <Text style={s.historyRunTitle} numberOfLines={1}>{run.title}</Text>
                            <View style={s.historyRunMeta}>
                              <Text style={s.historyRunMetaTxt}>
                                {formatDate(run.date)}
                              </Text>
                              <Text style={s.historyRunDot}>·</Text>
                              <Text style={s.historyRunMetaTxt}>
                                {toDisplayDist(run.min_distance, distUnit)}
                              </Text>
                              {Number(run.avg_attendee_pace) > 0 && (
                                <>
                                  <Text style={s.historyRunDot}>·</Text>
                                  <Text style={s.historyRunMetaTxt}>
                                    {toDisplayPace(Number(run.avg_attendee_pace), distUnit)} avg pace
                                  </Text>
                                </>
                              )}
                            </View>
                            <Text style={s.historyChief}>
                              {run.host_id === crew?.created_by ? "👑 Crew Chief" : run.host_name}
                              {Number(run.attendee_count) > 0 ? ` · ${run.attendee_count} attended` : ""}
                            </Text>
                          </View>
                          <Ionicons name="chevron-forward" size={13} color={C.textMuted} />
                        </TouchableOpacity>
                      ))}
                  </View>
                )}

                {isCreator && crew && (
                  <CrewPlansSection crewId={crew.id} />
                )}

                {isCreator && (
                  <TouchableOpacity
                    style={s.disbandBtn}
                    onPress={handleDisband}
                    disabled={disbandMutation.isPending}
                    testID="disband-crew-btn"
                  >
                    {disbandMutation.isPending
                      ? <ActivityIndicator color="#fff" />
                      : (
                        <>
                          <Ionicons name="trash-outline" size={16} color="#fff" />
                          <Text style={s.disbandBtnTxt}>Disband Crew</Text>
                        </>
                      )
                    }
                  </TouchableOpacity>
                )}

                {/* Leave */}
                <TouchableOpacity
                  style={s.leaveBtn}
                  onPress={handleLeave}
                  disabled={leaveMutation.isPending}
                  testID="leave-crew-btn"
                >
                  {leaveMutation.isPending
                    ? <ActivityIndicator color={C.danger} />
                    : (
                      <>
                        <Ionicons name="exit-outline" size={16} color={C.danger} />
                        <Text style={s.leaveBtnTxt}>Leave Crew</Text>
                      </>
                    )
                  }
                </TouchableOpacity>
              </ScrollView>

            </>
          )}

          <MemberProfileSheet
            userId={selectedMemberId}
            visible={!!selectedMemberId}
            onClose={() => setSelectedMemberId(null)}
            currentUserId={currentUserId}
          />

          {showInvite && crew && (
            <InviteUserSheet
              onClose={() => setShowInvite(false)}
              crewId={crew.id}
              existingMemberIds={memberIds}
              pendingRequestIds={joinRequests.map((r) => r.user_id)}
            />
          )}

          {/* GIF Picker Overlay — inside the sheet so it works on iOS (no nested modals) */}
          {showGifPicker && (
            <View style={s.gifPickerOverlay}>
              {/* Drag handle */}
              <View style={{ alignItems: "center", paddingTop: 8, paddingBottom: 4 }}>
                <View style={{ width: 32, height: 4, borderRadius: 2, backgroundColor: C.border }} />
              </View>
              {/* Header */}
              <View style={s.gifPickerHeader}>
                <Text style={s.gifPickerTitle}>GIFs</Text>
                <TouchableOpacity onPress={() => { setShowGifPicker(false); setTimeout(() => chatInputRef.current?.focus(), 50); }} style={s.gifPickerClose}>
                  <Ionicons name="close" size={20} color={C.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Search bar */}
              <View style={s.gifSearchRow}>
                <Ionicons name="search" size={16} color={C.textMuted} style={{ marginRight: 8 }} />
                <TextInput
                  style={s.gifSearchInput}
                  value={gifSearch}
                  onChangeText={setGifSearch}
                  placeholder="Search GIFs…"
                  placeholderTextColor={C.textMuted}
                  returnKeyType="search"
                  autoFocus={false}
                />
                {!!gifSearch && (
                  <TouchableOpacity onPress={() => setGifSearch("")}>
                    <Ionicons name="close-circle" size={16} color={C.textMuted} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Topic pills (when no search) */}
              {!gifSearch && gifResults.length === 0 && !gifLoading && (
                <View style={s.gifTopicRow}>
                  {GIF_TOPICS.map((topic) => (
                    <TouchableOpacity
                      key={topic}
                      style={s.gifTopicPill}
                      onPress={() => setGifSearch(topic)}
                    >
                      <Text style={s.gifTopicTxt}>{topic}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Loading */}
              {gifLoading && (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                  <ActivityIndicator color={C.primary} size="large" />
                </View>
              )}

              {/* Empty */}
              {!gifLoading && gifResults.length === 0 && !!gifSearch && (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <Ionicons name="sad-outline" size={40} color={C.textMuted} />
                  <Text style={s.gifEmptyTxt}>No GIFs found for "{gifSearch}"</Text>
                </View>
              )}

              {/* Grid */}
              {!gifLoading && gifResults.length > 0 && (
                <FlatList
                  data={gifResults}
                  numColumns={2}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={{ padding: 8, gap: 6 }}
                  columnWrapperStyle={{ gap: 6 }}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={s.gifGridCell}
                      onPress={() => {
                        setSelectedGif(item);
                        setShowGifPicker(false);
                        setTimeout(() => chatInputRef.current?.focus(), 50);
                      }}
                    >
                      <ExpoImage
                        source={{ uri: item.gif_url }}
                        style={s.gifGridImg}
                        contentFit="cover"
                      />
                    </TouchableOpacity>
                  )}
                />
              )}
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

// ─── Suggested Crews Section ──────────────────────────────────────────────────
function SuggestedCrewsSection() {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const qc = useQueryClient();

  const { data: suggested = [], isLoading } = useQuery<SuggestedCrew[]>({
    queryKey: ["/api/crews/suggested"],
    staleTime: 60_000,
  });

  const joinRequestMutation = useMutation({
    mutationFn: (crewId: string) => apiRequest("POST", `/api/crews/${crewId}/join-request`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crews/suggested"] });
    },
  });

  if (isLoading || suggested.length === 0) return null;

  return (
    <View style={s.suggestedSection}>
      <View style={s.suggestedHeader}>
        <Ionicons name="compass-outline" size={18} color={C.primary} />
        <Text style={s.suggestedTitle}>Suggested Crews</Text>
      </View>
      <FlatList
        horizontal
        data={suggested.slice(0, 8)}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 4, gap: 10 }}
        renderItem={({ item }) => (
          <View style={s.suggestedCard}>
            {resolveImgUrl(item.image_url) ? (
              <Image source={{ uri: resolveImgUrl(item.image_url)! }} style={s.suggestedCardImg} />
            ) : (
              <View style={s.suggestedCardEmoji}>
                <Text style={{ fontSize: 24 }}>{item.emoji}</Text>
              </View>
            )}
            <Text style={s.suggestedCardName} numberOfLines={1}>{item.name}</Text>
            <Text style={s.suggestedCardMeta}>
              {item.member_count} {Number(item.member_count) === 1 ? "member" : "members"}
            </Text>
            {item.run_style ? (
              <Text style={s.suggestedCardStyle} numberOfLines={1}>{item.run_style}</Text>
            ) : null}
            <TouchableOpacity
              style={s.suggestedCardBtn}
              onPress={() => joinRequestMutation.mutate(item.id)}
              disabled={joinRequestMutation.isPending}
              activeOpacity={0.8}
            >
              <Text style={s.suggestedCardBtnTxt}>Request</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

// ─── Crew Plans Section ──────────────────────────────────────────────────────
const PLAN_TIERS = [
  {
    id: "growth",
    productId: "crew_growth_monthly",
    name: "Crew Growth",
    price: "$1.99/mo",
    icon: "people" as const,
    color: "#4CAF50",
    features: ["Unlimited members (remove 100 cap)", "Priority support"],
  },
  {
    id: "discovery_boost",
    productId: "crew_discovery_boost_monthly",
    name: "Discovery Boost",
    price: "$4.99/mo",
    icon: "rocket" as const,
    color: "#FF9800",
    features: ["~30% boost in Suggested Crews", "Public crew events featured", "Crew badge on discover page"],
  },
];

function CrewPlansSection({ crewId }: { crewId: string }) {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const qc = useQueryClient();
  const { purchasePackage, restorePurchases } = usePurchases();
  const [purchasing, setPurchasing] = useState<string | null>(null);

  const { data: subStatus } = useQuery<SubscriptionStatus>({
    queryKey: ["/api/crews", crewId, "subscription"],
    enabled: !!crewId,
  });

  const currentTier = subStatus?.subscription_tier || "none";

  function isTierActive(tierId: string): boolean {
    if (currentTier === "both") return true;
    return currentTier === tierId;
  }

  async function handleSubscribe(tier: typeof PLAN_TIERS[0]) {
    setPurchasing(tier.id);
    try {
      const purchased = await purchasePackage(tier.productId, crewId);
      if (purchased) {
        setTimeout(() => {
          qc.invalidateQueries({ queryKey: ["/api/crews", crewId, "subscription"] });
          qc.invalidateQueries({ queryKey: ["/api/crews"] });
        }, 2000);
        Alert.alert("Subscribed!", `${tier.name} plan is now active. It may take a moment to reflect.`);
      } else {
        Alert.alert("Purchase Not Completed", "The purchase was not completed. Please try again.");
      }
    } catch {
      Alert.alert("Error", "Could not complete purchase. Please try again.");
    } finally {
      setPurchasing(null);
    }
  }

  function handleManageSubscription() {
    if (Platform.OS === "ios") {
      Linking.openURL("https://apps.apple.com/account/subscriptions");
    } else if (Platform.OS === "android") {
      Linking.openURL("https://play.google.com/store/account/subscriptions");
    } else {
      Alert.alert(
        "Manage Subscription",
        "To cancel or change your subscription, open your device's subscription settings (App Store on iOS, Google Play on Android)."
      );
    }
  }

  async function handleRestore() {
    try {
      await restorePurchases();
      qc.invalidateQueries({ queryKey: ["/api/crews", crewId, "subscription"] });
      Alert.alert("Restored", "Your purchases have been restored.");
    } catch {
      Alert.alert("Error", "Could not restore purchases.");
    }
  }

  return (
    <View style={s.plansSection}>
      <View style={s.plansSectionHeader}>
        <Ionicons name="diamond-outline" size={18} color={C.primary} />
        <Text style={s.plansSectionTitle}>Crew Plans</Text>
      </View>

      <View style={s.planStatusRow}>
        <Text style={s.planStatusLabel}>Members</Text>
        <Text style={s.planStatusValue}>
          {subStatus?.member_count ?? "—"} / {subStatus?.member_cap === Infinity || (subStatus?.member_cap ?? 0) > 99999 ? "∞" : subStatus?.member_cap ?? 100}
        </Text>
      </View>

      {PLAN_TIERS.map((tier) => {
        const active = isTierActive(tier.id);
        return (
          <View key={tier.id} style={[s.planCard, active && { borderColor: tier.color }]}>
            <View style={s.planCardHeader}>
              <View style={[s.planIconCircle, { backgroundColor: tier.color + "22" }]}>
                <Ionicons name={tier.icon} size={18} color={tier.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.planCardName}>{tier.name}</Text>
                <Text style={s.planCardPrice}>{tier.price}</Text>
              </View>
              {active && (
                <View style={[s.planActiveBadge, { backgroundColor: tier.color + "22" }]}>
                  <Ionicons name="checkmark-circle" size={14} color={tier.color} />
                  <Text style={[s.planActiveBadgeTxt, { color: tier.color }]}>Active</Text>
                </View>
              )}
            </View>
            {tier.features.map((f, i) => (
              <View key={i} style={s.planFeatureRow}>
                <Ionicons name="checkmark" size={14} color={tier.color} />
                <Text style={s.planFeatureTxt}>{f}</Text>
              </View>
            ))}
            {!active ? (
              <TouchableOpacity
                style={[s.planSubscribeBtn, { backgroundColor: tier.color }]}
                onPress={() => handleSubscribe(tier)}
                disabled={purchasing === tier.id}
                activeOpacity={0.85}
              >
                {purchasing === tier.id ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={s.planSubscribeBtnTxt}>Subscribe</Text>
                )}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[s.planSubscribeBtn, { backgroundColor: C.cardBg, borderWidth: 1, borderColor: tier.color }]}
                onPress={handleManageSubscription}
                activeOpacity={0.85}
              >
                <Text style={[s.planSubscribeBtnTxt, { color: tier.color }]}>Manage Subscription</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}

      <TouchableOpacity onPress={handleRestore} style={s.restoreBtn}>
        <Text style={s.restoreBtnTxt}>Restore Purchases</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Member Cap Upsell Sheet ─────────────────────────────────────────────────
function MemberCapUpsell({ visible, onClose, crewId }: { visible: boolean; onClose: () => void; crewId: string }) {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const { purchasePackage } = usePurchases();
  const qc = useQueryClient();
  const [purchasing, setPurchasing] = useState(false);

  async function handleUpgrade() {
    setPurchasing(true);
    try {
      const purchased = await purchasePackage("crew_growth_monthly", crewId);
      if (purchased) {
        setTimeout(() => {
          qc.invalidateQueries({ queryKey: ["/api/crews", crewId, "subscription"] });
          qc.invalidateQueries({ queryKey: ["/api/crews"] });
        }, 2000);
        Alert.alert("Upgraded!", "Your crew can now have unlimited members. It may take a moment to reflect.");
        onClose();
      } else {
        Alert.alert("Purchase Not Completed", "The purchase was not completed. Please try again.");
      }
    } catch {
      Alert.alert("Error", "Could not complete purchase.");
    } finally {
      setPurchasing(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.upsellOverlay} onPress={onClose}>
        <View style={s.upsellCard} onStartShouldSetResponder={() => true}>
          <Ionicons name="people" size={40} color={C.primary} />
          <Text style={s.upsellTitle}>Crew Full!</Text>
          <Text style={s.upsellBody}>
            Your crew has reached the 100-member limit. Upgrade to Crew Growth to remove the cap and accept unlimited members.
          </Text>
          <TouchableOpacity
            style={s.upsellBtn}
            onPress={handleUpgrade}
            disabled={purchasing}
            activeOpacity={0.85}
          >
            {purchasing ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={s.upsellBtnTxt}>Upgrade — $1.99/mo</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={{ marginTop: 10 }}>
            <Text style={s.upsellDismissTxt}>Not now</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );
}

// ─── Search Result Card ────────────────────────────────────────────────────────
function SearchResultCard({
  crew,
  isMember,
  hasRequested,
  onOpen,
  onRequest,
}: {
  crew: Crew & { is_member: boolean; has_requested: boolean };
  isMember: boolean;
  hasRequested: boolean;
  onOpen: () => void;
  onRequest: () => void;
}) {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  return (
    <TouchableOpacity
      style={s.searchCard}
      onPress={isMember ? onOpen : undefined}
      activeOpacity={isMember ? 0.75 : 1}
    >
      {resolveImgUrl(crew.image_url) ? (
        <Image source={{ uri: resolveImgUrl(crew.image_url)! }} style={s.searchCardEmojiImg} />
      ) : (
        <Text style={s.searchCardEmoji}>{crew.emoji}</Text>
      )}
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={s.searchCardName} numberOfLines={1}>{crew.name}</Text>
        <Text style={s.searchCardMeta}>
          {crew.member_count} {Number(crew.member_count) === 1 ? "member" : "members"}
          {crew.run_style ? ` · ${crew.run_style}` : ""}
        </Text>
        {crew.description ? (
          <Text style={s.searchCardDesc} numberOfLines={1}>{crew.description}</Text>
        ) : null}
      </View>
      {isMember ? (
        <View style={s.searchCardBadge}>
          <Text style={s.searchCardBadgeTxt}>Joined</Text>
        </View>
      ) : hasRequested ? (
        <View style={[s.searchCardBadge, s.searchCardBadgePending]}>
          <Text style={[s.searchCardBadgeTxt, { color: C.textMuted }]}>Requested</Text>
        </View>
      ) : (
        <TouchableOpacity style={s.searchCardJoinBtn} onPress={onRequest}>
          <Text style={s.searchCardJoinTxt}>Request</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ─── Rankings Modal ───────────────────────────────────────────────────────────
interface RankedCrew {
  rank: number;
  id: string;
  name: string;
  emoji: string;
  image_url?: string;
  member_count: number;
  active_members: number;
  total_miles: number;
  qualifying_events: number;
  participation_rate: number;
  miles_per_member: number;
  events_per_week: number;
  crew_score: number;
  home_metro?: string;
  home_state?: string;
}

function RankingsModal({ visible, onClose, myCrewIds, myCrewId }: { visible: boolean; onClose: () => void; myCrewIds: string[]; myCrewId?: string }) {
  const { C } = useTheme();
  const { user: authUser } = useAuth();
  const distUnit: DistanceUnit = ((authUser as any)?.distance_unit ?? "miles") as DistanceUnit;
  const insets = useSafeAreaInsets();
  const [activityType, setActivityType] = useState<"run" | "ride" | "walk">("run");
  const [period, setPeriod] = useState<"week" | "month" | "all">("all");
  const [rankingTab, setRankingTab] = useState<"national" | "state" | "metro">("national");

  // Get user's preferred metro/state if available
  const userMetro = (authUser as any)?.home_metro || "Houston";
  const userState = (authUser as any)?.home_state || "TX";

  const rankingsUrl = `/api/crews/rankings?type=${rankingTab}&value=${rankingTab === 'state' ? userState : rankingTab === 'metro' ? userMetro : ''}`;
  const { data: rankings, isLoading } = useQuery<RankedCrew[]>({
    queryKey: ["/api/crews/rankings", rankingTab, userMetro, userState],
    queryFn: async () => {
      const res = await apiRequest("GET", rankingsUrl);
      return res.json();
    },
    enabled: visible,
    staleTime: 60_000,
  });

  function rankLabel(rank: number) {
    if (rank === 1) return "🥇";
    if (rank === 2) return "🥈";
    if (rank === 3) return "🥉";
    return `#${rank}`;
  }

  function formatMiles(m: number | null | undefined) {
    return `${toDisplayDist(m ?? 0, distUnit)} ${unitLabel(distUnit)}`;
  }

  const TABS: { key: "national" | "state" | "metro"; label: string }[] = [
    { key: "metro", label: "Local" },
    { key: "state", label: "State" },
    { key: "national", label: "National" },
  ];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        {/* Header */}
        <View style={[rStyles.rankHeader, { paddingTop: insets.top > 0 ? 16 : 20 }]}>
          <View>
            <Text style={[rStyles.rankTitle, { color: C.text, fontFamily: "Outfit_700Bold" }]}>Crew Rankings</Text>
            <Text style={[rStyles.rankSub, { color: C.textMuted, fontFamily: "Outfit_400Regular" }]}>Ranked by participation, miles & events</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={24} color={C.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Tab toggle */}
        <View style={[rStyles.toggleRow, { backgroundColor: C.surface, borderColor: C.border, marginBottom: 16 }]}>
          {TABS.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[rStyles.togglePill, rankingTab === t.key && { backgroundColor: C.primary }]}
              onPress={() => setRankingTab(t.key)}
            >
              <Text style={[rStyles.togglePillTxt, { color: rankingTab === t.key ? C.bg : C.textMuted, fontFamily: "Outfit_600SemiBold" }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* List */}
        {isLoading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={C.primary} size="large" />
          </View>
        ) : (rankings ?? []).length === 0 ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 40 }}>
            <Ionicons name="trophy-outline" size={48} color={C.textMuted} />
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: C.text, textAlign: "center" }}>No rankings found</Text>
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textMuted, textAlign: "center" }}>
              Be the first crew to log activity in this category!
            </Text>
          </View>
        ) : (
          <FlatList
            data={rankings}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 30, paddingTop: 8 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item, index }) => {
              const rank = index + 1;
              const isMyC = myCrewIds.includes(item.id);
              return (
                <View style={[rStyles.rankRow, { backgroundColor: C.surface, borderColor: isMyC ? C.primary : C.border, borderLeftWidth: isMyC ? 3 : 1 }]}>
                  <Text style={[rStyles.rankNum, { fontFamily: rank <= 3 ? "Outfit_700Bold" : "Outfit_600SemiBold", color: rank <= 3 ? C.text : C.textMuted, fontSize: rank <= 3 ? 22 : 14, width: 40, textAlign: "center" }]}>
                    {rankLabel(rank)}
                  </Text>
                  <View style={[rStyles.rankAvatar, { backgroundColor: C.card }]}>
                    {item.image_url ? (
                      <Image source={{ uri: resolveImgUrl(item.image_url)! }} style={{ width: 40, height: 40, borderRadius: 20 }} />
                    ) : (
                      <Text style={{ fontSize: 20 }}>{item.emoji}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: C.text }} numberOfLines={1}>{item.name}</Text>
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted }}>
                      {item.active_members ?? item.member_count} active • {item.qualifying_events ?? 0} event{(item.qualifying_events ?? 0) !== 1 ? "s" : ""}
                    </Text>
                    {isMyC && (
                      <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: C.primary }}>Your Crew</Text>
                    )}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: C.primary }}>{Number(item.crew_score ?? 0).toFixed(0)}</Text>
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 10, color: C.textMuted }}>pts</Text>
                  </View>
                </View>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

const rStyles = StyleSheet.create({
  rankHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  rankTitle: { fontSize: 22 },
  rankSub: { fontSize: 13, marginTop: 2 },
  toggleRow: {
    flexDirection: "row",
    marginHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    padding: 3,
    gap: 3,
    marginBottom: 12,
  },
  togglePill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 8,
    borderRadius: 9,
  },
  togglePillTxt: { fontSize: 13 },
  periodRow: {
    flexDirection: "row",
    marginHorizontal: 20,
    gap: 8,
    marginBottom: 16,
  },
  periodPill: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  periodPillTxt: { fontSize: 12 },
  rankRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
  },
  rankNum: { minWidth: 36 },
  rankAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function CrewScreen() {
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCrew, setSelectedCrew] = useState<Crew | null>(null);
  const [searchText, setSearchText] = useState("");
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [showRankings, setShowRankings] = useState(false);
  const [capUpsellCrewId, setCapUpsellCrewId] = useState<string | null>(null);
  const searchInputRef = useRef<TextInput>(null);

  const isSearching = searchText.trim().length > 0 || friendsOnly;
  const searchUrl = `/api/crews/search?q=${encodeURIComponent(searchText.trim())}&friends=${friendsOnly}`;

  const { user: currentUser } = useAuth();
  const [ghostCrewDone, setGhostCrewDone] = useState(true);

  const { isActive: walkthroughActive } = useWalkthrough();
  const { data: crewsRaw = [], isLoading } = useQuery<Crew[]>({
    queryKey: ["/api/crews"],
  });
  const crews = useMemo(() => {
    if (walkthroughActive && crewsRaw.length === 0) {
      return [MOCK_CREW as Crew];
    }
    return crewsRaw;
  }, [walkthroughActive, crewsRaw]);

  useEffect(() => {
    if (!currentUser?.id) return;
    AsyncStorage.getItem(`paceup_ghost_crew_done_${currentUser.id}`).then((v) => {
      setGhostCrewDone(v === "true");
    });
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id || ghostCrewDone) return;
    if (crews.length > 0) {
      setGhostCrewDone(true);
      AsyncStorage.setItem(`paceup_ghost_crew_done_${currentUser.id}`, "true");
    }
  }, [crews.length, currentUser?.id, ghostCrewDone]);

  const { data: invites = [], refetch: refetchInvites } = useQuery<CrewInvite[]>({
    queryKey: ["/api/crew-invites"],
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  useFocusEffect(
    useCallback(() => {
      refetchInvites();
      qc.invalidateQueries({ queryKey: ["/api/crews"] });
    }, [refetchInvites, qc])
  );

  const { data: searchResults = [], isFetching: searchFetching } = useQuery<any[]>({
    queryKey: [searchUrl],
    enabled: isSearching,
  });

  const respondMutation = useMutation({
    mutationFn: ({ crewId, accept }: { crewId: string; accept: boolean }) =>
      apiRequest("POST", `/api/crew-invites/${crewId}/respond`, { accept }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crew-invites"] });
      qc.invalidateQueries({ queryKey: ["/api/crews"] });
    },
    onError: (e: any) => {
      const msg = e?.message || "";
      if (msg.includes("MEMBER_CAP_REACHED") || msg.includes("member cap")) {
        Alert.alert("Crew Full", "This crew has reached its 100-member limit.");
      } else {
        Alert.alert("Error", e?.message ?? "Could not respond to invite");
      }
    },
  });

  const joinRequestMutation = useMutation({
    mutationFn: (crewId: string) => apiRequest("POST", `/api/crews/${crewId}/join-request`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [searchUrl] });
      qc.invalidateQueries({ queryKey: ["/api/crews/suggested"] });
    },
  });

  const clearSearch = () => {
    setSearchText("");
    setFriendsOnly(false);
    setSearchActive(false);
    Keyboard.dismiss();
  };

  const topPad = isWeb ? 67 : insets.top;
  const bottomPad = isWeb ? 34 : insets.bottom;

  return (
    <View style={[s.screen, { paddingTop: topPad, backgroundColor: C.bg }]}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Crew</Text>
      </View>

      {/* Create A Crew CTA — only when user already has crews */}
      {crews.length > 0 && (
        <WalkthroughPulse stepId="crew-cta" style={{ borderRadius: 16, marginHorizontal: 20 }}>
        <TouchableOpacity
          style={[s.createCrewBtn, { marginHorizontal: 0 }]}
          onPress={() => setShowCreate(true)}
          testID="open-create-crew"
          activeOpacity={0.88}
        >
          <Ionicons name="people" size={20} color={C.bg} />
          <Text style={s.createCrewBtnTxt}>Create A Crew</Text>
        </TouchableOpacity>
        </WalkthroughPulse>
      )}

      {/* Search bar */}
      <View style={s.searchRow}>
        <View style={s.searchBar}>
          <Ionicons name="search" size={15} color={C.textMuted} />
          <TextInput
            ref={searchInputRef}
            style={s.searchInput}
            value={searchText}
            onChangeText={setSearchText}
            onFocus={() => setSearchActive(true)}
            onBlur={() => { if (!searchText && !friendsOnly) setSearchActive(false); }}
            placeholder="Search crews..."
            placeholderTextColor={C.textMuted}
            returnKeyType="search"
            testID="crew-search-input"
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => setSearchText("")} hitSlop={8}>
              <Ionicons name="close-circle" size={15} color={C.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        {(searchActive || friendsOnly) && (
          <TouchableOpacity style={s.searchCancelBtn} onPress={clearSearch}>
            <Text style={s.searchCancelTxt}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Friends toggle — visible when search is active */}
      {(searchActive || friendsOnly) && (
        <View style={s.friendsRow}>
          <TouchableOpacity
            style={[s.friendsPill, friendsOnly && s.friendsPillActive]}
            onPress={() => setFriendsOnly(!friendsOnly)}
            testID="friends-only-toggle"
          >
            <Ionicons name="people" size={13} color={friendsOnly ? C.bg : C.textMuted} />
            <Text style={[s.friendsPillTxt, friendsOnly && s.friendsPillTxtActive]}>Friends' Crews</Text>
          </TouchableOpacity>
        </View>
      )}

      {isSearching ? (
        /* ── Search Results ── */
        <FlatList
          data={searchResults}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomPad + 90, paddingTop: 12 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <SearchResultCard
              crew={item}
              isMember={item.is_member}
              hasRequested={item.has_requested}
              onOpen={() => setSelectedCrew(item)}
              onRequest={() => joinRequestMutation.mutate(item.id)}
            />
          )}
          ListEmptyComponent={() =>
            searchFetching ? (
              <View style={s.emptyState}>
                <ActivityIndicator color={C.primary} />
              </View>
            ) : (
              <View style={s.emptyState}>
                <Ionicons name="search-outline" size={44} color={C.textMuted} />
                <Text style={s.emptyTitle}>
                  {friendsOnly ? "No crews found" : "No results"}
                </Text>
                <Text style={s.emptyBody}>
                  {friendsOnly
                    ? "None of your friends are in a crew yet."
                    : "Try a different crew name."}
                </Text>
              </View>
            )
          }
          showsVerticalScrollIndicator={false}
        />
      ) : (
        /* ── My Crews ── */
        <FlatList
          data={crews}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: bottomPad + 90,
            paddingTop: 8,
          }}
          ListHeaderComponent={() => (
            <>
              {invites.map((invite) => (
                <InviteBanner
                  key={invite.crew_id}
                  invite={invite}
                  onAccept={() => respondMutation.mutate({ crewId: invite.crew_id, accept: true })}
                  onDecline={() => respondMutation.mutate({ crewId: invite.crew_id, accept: false })}
                />
              ))}
              {crews.length < 3 && (
                <SuggestedCrewsSection />
              )}
            </>
          )}
          renderItem={({ item, index }) => (
            index === 0 ? (
              <WalkthroughPulse stepId="crew-intro" style={{ borderRadius: 16 }}>
                <CrewCard crew={item} onPress={() => setSelectedCrew(item)} />
              </WalkthroughPulse>
            ) : (
              <CrewCard crew={item} onPress={() => setSelectedCrew(item)} />
            )
          )}
          ListEmptyComponent={() =>
            isLoading ? (
              <View style={s.emptyState}>
                <ActivityIndicator color={C.primary} size="large" />
              </View>
            ) : (
              <View style={s.emptyState}>
                {!ghostCrewDone && (
                  <>
                    <View style={s.ghostCrewCard}>
                      <View style={s.crewCardLeft}>
                        <View style={s.ghostCrewEmoji}>
                          <Text style={{ fontSize: 28 }}>🏃</Text>
                        </View>
                        <View style={{ flex: 1, gap: 4 }}>
                          <Text style={s.ghostCrewName}>The Morning Milers</Text>
                          <Text style={s.ghostCrewDesc} numberOfLines={1}>Early risers crushing miles together</Text>
                          <View style={s.ghostCrewMeta}>
                            <Ionicons name="people-outline" size={13} color={C.textMuted} />
                            <Text style={s.ghostCrewMetaTxt}> 6 members</Text>
                          </View>
                          <View style={s.ghostCrewChips}>
                            <View style={s.ghostChip}><Text style={s.ghostChipTxt}>Social</Text></View>
                            <View style={s.ghostChip}><Text style={s.ghostChipTxt}>Casual</Text></View>
                          </View>
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
                    </View>
                    <View style={s.ghostCrewTipRow}>
                      <Feather name="info" size={11} color={C.textMuted} />
                      <Text style={s.ghostCrewTipTxt}>Join a crew to train, achieve, and grow together</Text>
                    </View>
                  </>
                )}
                <TouchableOpacity style={[s.createCrewBtn, { marginHorizontal: 0, marginBottom: 12, alignSelf: "stretch" }]} onPress={() => setShowCreate(true)} testID="create-first-crew" activeOpacity={0.88}>
                  <Ionicons name="people" size={20} color={C.bg} />
                  <Text style={s.createCrewBtnTxt}>Create a Crew</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.joinCrewBtn, { alignSelf: "stretch" }]} onPress={() => { setSearchActive(true); setTimeout(() => searchInputRef.current?.focus(), 100); }} activeOpacity={0.88}>
                  <Ionicons name="search" size={20} color={C.primary} />
                  <Text style={s.joinCrewBtnTxt}>Join a Crew</Text>
                </TouchableOpacity>
              </View>
            )
          }
          ListFooterComponent={() => (
            crews.length > 0 ? (
              <WalkthroughPulse stepId="rankings" style={{ borderRadius: 16 }}>
              <TouchableOpacity
                style={[s.rankingsBtn, { borderColor: C.primary + "55" }]}
                onPress={() => setShowRankings(true)}
                activeOpacity={0.8}
                testID="view-rankings-btn"
              >
                <Ionicons name="trophy-outline" size={18} color={C.primary} />
                <Text style={[s.rankingsBtnTxt, { color: C.primary }]}>National Rankings</Text>
                <Ionicons name="chevron-forward" size={16} color={C.primary + "99"} />
              </TouchableOpacity>
              </WalkthroughPulse>
            ) : null
          )}
          scrollEnabled={!!(crews.length > 0 || invites.length > 0)}
          showsVerticalScrollIndicator={false}
        />
      )}

      <CreateCrewSheet
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(crew) => {
          setShowCreate(false);
          setSelectedCrew(crew);
        }}
      />

      <CrewDetailSheet
        crew={selectedCrew}
        onClose={() => setSelectedCrew(null)}
        currentUserId={currentUser?.id ?? ""}
        onCapReached={(crewId) => setCapUpsellCrewId(crewId)}
      />

      <RankingsModal
        visible={showRankings}
        onClose={() => setShowRankings(false)}
        myCrewIds={(crews as Crew[]).map((c) => c.id)}
        myCrewId={(crews as Crew[])[0]?.id}
      />

      {capUpsellCrewId && (
        <MemberCapUpsell
          visible={!!capUpsellCrewId}
          onClose={() => setCapUpsellCrewId(null)}
          crewId={capUpsellCrewId}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function makeStyles(C: ColorScheme) { return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 28,
    color: C.text,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 10,
    gap: 10,
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  searchInput: {
    flex: 1,
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.text,
  },
  searchCancelBtn: {
    paddingVertical: 6,
  },
  searchCancelTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.primary,
  },
  friendsRow: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    flexDirection: "row",
    gap: 8,
  },
  friendsPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  friendsPillActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  friendsPillTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.textMuted,
  },
  friendsPillTxtActive: {
    color: C.bg,
  },
  searchCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  searchCardEmoji: {
    fontSize: 30,
  },
  searchCardEmojiImg: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  searchCardName: {
    fontFamily: "Outfit_700Bold",
    fontSize: 15,
    color: C.text,
  },
  searchCardMeta: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: C.textMuted,
  },
  searchCardDesc: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: C.textSecondary,
  },
  searchCardBadge: {
    backgroundColor: C.primary + "22",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: C.primary + "44",
  },
  searchCardBadgePending: {
    backgroundColor: C.surface,
    borderColor: C.border,
  },
  searchCardBadgeTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: C.primary,
  },
  searchCardJoinBtn: {
    backgroundColor: C.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  searchCardJoinTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 12,
    color: C.bg,
  },
  createCrewBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingVertical: 16,
    marginHorizontal: 20,
    marginBottom: 14,
  },
  createCrewBtnTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 17,
    color: C.bg,
  },
  joinCrewBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: C.primary,
    borderRadius: 16,
    paddingVertical: 16,
    width: "100%",
  },
  joinCrewBtnTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 17,
    color: C.primary,
  },

  // Invite banner
  inviteBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.primary + "40",
    padding: 14,
    marginBottom: 10,
  },
  inviteEmoji: {
    fontSize: 28,
    marginRight: 12,
  },
  inviteText: {
    flex: 1,
  },
  inviteName: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    color: C.text,
  },
  inviteBy: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: C.textMuted,
    marginTop: 2,
  },
  inviteAccept: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  inviteDecline: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
  },

  // Crew card
  crewCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 12,
  },
  crewCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  crewEmojiBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  crewEmojiText: {
    fontSize: 26,
  },
  ghostCrewCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: "dashed",
    padding: 16,
    marginBottom: 12,
    opacity: 0.95,
    alignSelf: "stretch",
  },
  ghostCrewEmoji: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  ghostCrewName: { fontFamily: "Outfit_700Bold", fontSize: 17, color: C.textMuted },
  ghostCrewDesc: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.textMuted },
  ghostCrewMeta: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  ghostCrewMetaTxt: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted },
  ghostCrewChips: { flexDirection: "row", gap: 6, marginTop: 4 },
  ghostChip: {
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: C.border,
  },
  ghostChipTxt: { fontFamily: "Outfit_500Medium", fontSize: 11, color: C.textMuted },
  ghostCrewTipRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 16, alignSelf: "stretch" },
  ghostCrewTipTxt: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, flex: 1 },
  crewCardInfo: {
    flex: 1,
  },
  crewCardName: {
    fontFamily: "Outfit_700Bold",
    fontSize: 17,
    color: C.text,
  },
  crewCardDesc: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.textSecondary,
    marginTop: 2,
  },
  crewCardMeta: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: C.textMuted,
    marginTop: 4,
  },
  crewCardChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 6,
  },
  crewStyleChip: {
    backgroundColor: C.card,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: C.text + "40",
  },
  crewStyleChipTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 10,
    color: C.text,
  },
  crewVibeChip: {
    backgroundColor: C.card,
    borderRadius: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: C.text + "40",
  },
  crewVibeChipTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 10,
    color: C.text,
  },

  // Empty state
  emptyState: {
    alignItems: "center",
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 22,
    color: C.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyBody: {
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: C.textMuted,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 32,
  },

  // Sheet
  sheet: {
    flex: 1,
    backgroundColor: C.bg,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  sheetTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 20,
    color: C.text,
  },

  // Create crew form
  fieldLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.textSecondary,
    marginTop: 20,
    marginBottom: 8,
  },
  fieldOptional: {
    fontFamily: "Outfit_400Regular",
    color: C.textMuted,
  },
  fieldHint: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: C.textMuted,
    marginTop: -4,
    marginBottom: 10,
  },
  vibeCategoryLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: C.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 14,
    marginBottom: 6,
  },
  chipsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  chipTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.text,
  },
  chipStyleActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  chipStyleActiveTxt: {
    color: C.bg,
  },
  chipVibeActive: {
    backgroundColor: C.primary + "22",
    borderColor: C.primary,
  },
  chipVibeActiveTxt: {
    color: C.primary,
  },
  emojiRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  emojiOption: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  emojiOptionActive: {
    borderColor: C.primary,
    backgroundColor: C.primary + "20",
  },
  emojiOptionText: {
    fontSize: 22,
  },
  imagePickerBtn: {
    width: 58,
    height: 58,
    borderRadius: 14,
    backgroundColor: C.surface,
    borderWidth: 1.5,
    borderColor: C.border,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  imagePickerPreview: {
    width: 58,
    height: 58,
    borderRadius: 14,
  },
  imagePickerTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 10,
    color: C.textMuted,
  },
  input: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: C.text,
  },
  inputMulti: {
    height: 80,
    textAlignVertical: "top",
  },

  // Buttons
  primaryBtn: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 28,
  },
  primaryBtnTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: C.bg,
  },
  scheduleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 0,
    marginBottom: 0,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: C.primary,
  },
  scheduleBtnTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 15,
    color: C.bg,
  },
  disbandBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: C.danger,
  },
  disbandBtnTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 15,
    color: "#fff",
  },
  leaveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.danger + "50",
    backgroundColor: C.danger + "10",
  },
  leaveBtnTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    color: C.danger,
  },

  // Detail
  detailCloseRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 2,
  },
  detailCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  muteToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: C.surface,
  },
  muteToggleTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.text,
  },
  muteToggleTxtMuted: {
    color: C.textMuted,
  },
  detailHero: {
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 8,
  },
  detailHeroEmoji: {
    fontSize: 52,
    marginBottom: 8,
  },
  detailHeroImage: {
    width: 88,
    height: 88,
    borderRadius: 44,
    marginBottom: 12,
  },
  detailHeroName: {
    fontFamily: "Outfit_700Bold",
    fontSize: 28,
    color: C.text,
    textAlign: "center",
    marginBottom: 6,
  },
  detailDesc: {
    fontFamily: "Outfit_400Regular",
    fontSize: 17,
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 24,
    paddingHorizontal: 32,
    marginTop: 4,
  },
  detailToggleRow: {
    flexDirection: "row",
    alignSelf: "center",
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    padding: 3,
    marginBottom: 4,
  },
  detailToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 17,
  },
  detailToggleBtnActive: {
    backgroundColor: C.primary,
  },
  detailToggleTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.textMuted,
  },
  detailToggleTxtActive: {
    color: C.bg,
  },
  detailSection: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 14,
  },
  detailSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  detailSectionTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 17,
    color: C.text,
  },
  achieveEmpty: {
    paddingVertical: 12,
  },
  achieveEmptyText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.textSecondary,
    fontStyle: "italic",
  },
  achieveBadge: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginHorizontal: 4,
    minWidth: 80,
    gap: 3,
  },
  achieveBadgeEmoji: {
    fontSize: 22,
  },
  achieveBadgeLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    textAlign: "center",
  },
  achieveBadgeDate: {
    fontFamily: "Outfit_400Regular",
    fontSize: 10,
    color: C.textMuted,
    textAlign: "center",
  },
  achieveProgressWrap: {
    marginTop: 14,
    gap: 8,
  },
  achieveProgressRow: {
    gap: 4,
  },
  achieveProgressBarBg: {
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    overflow: "hidden",
  },
  achieveProgressBarFill: {
    height: 4,
    backgroundColor: C.primary,
    borderRadius: 2,
  },
  achieveProgressLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: C.textSecondary,
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  historyRunTitle: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.text,
  },
  historyRunMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexWrap: "wrap",
  },
  historyRunMetaTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: C.textSecondary,
  },
  historyRunDot: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: C.textMuted,
  },
  historyChief: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: C.textMuted,
    marginTop: 1,
  },
  inviteChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.primary + "18",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: C.primary + "40",
  },
  inviteChipTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.primary,
  },
  inviteOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  inviteOverlaySheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
    height: "75%",
  },

  // Members
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  removeMemberBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: C.orange + "12",
    marginLeft: 4,
  },
  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  memberAvatarText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: C.primary,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    color: C.text,
  },
  creatorBadge: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.primary,
  },
  memberMeta: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: C.textMuted,
    marginTop: 2,
  },

  // ── Member Mini-Profile Sheet styles ──────────────────────────────────────
  miniOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  miniSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    alignItems: "center",
  },
  miniHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    marginBottom: 16,
  },
  miniClose: {
    position: "absolute",
    top: 16,
    right: 20,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  miniAvatarWrap: {
    marginTop: 8,
    marginBottom: 12,
  },
  miniAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  miniAvatarFallback: {
    backgroundColor: C.card,
    borderWidth: 2,
    borderColor: C.primary + "55",
    alignItems: "center",
    justifyContent: "center",
  },
  miniAvatarLetter: {
    fontFamily: "Outfit_700Bold",
    fontSize: 32,
    color: C.primary,
  },
  miniName: {
    fontFamily: "Nunito_800ExtraBold",
    fontSize: 22,
    color: C.text,
    marginBottom: 16,
    textAlign: "center",
  },
  miniStatsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 10,
  },
  miniStat: {
    alignItems: "center",
    minWidth: 60,
    backgroundColor: C.card,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  miniStatVal: {
    fontFamily: "Outfit_700Bold",
    fontSize: 18,
    color: C.primary,
  },
  miniStatLbl: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: C.textMuted,
    marginTop: 2,
  },
  miniPace: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.textMuted,
    marginBottom: 20,
  },
  miniActions: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
    marginTop: 4,
  },
  miniActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.primary,
  },
  miniActionBtnTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.bg,
  },
  miniActionSecondary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.primary + "66",
    backgroundColor: C.primaryMuted,
  },
  miniActionSecondaryTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.primary,
  },

  // Runs
  emptyRuns: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 8,
  },
  emptyRunsTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textMuted,
    textAlign: "center",
  },
  viewAllTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.primary,
  },
  // Event cards
  eventCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  eventCardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  eventActivityPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: C.primary + "18",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  eventActivityTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: C.primary,
  },
  eventCardTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: C.text,
    marginBottom: 10,
    lineHeight: 22,
  },
  eventCardMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  eventMetaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.surface,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  eventMetaChipTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: C.textMuted,
  },
  eventCardHost: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 2,
  },
  // Inline crew chat
  inlineChatBox: {
    height: 260,
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
  },
  inlineChatEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 20,
  },
  inlineChatEmptyTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textMuted,
    textAlign: "center",
  },
  inlineMsgRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 7,
    marginBottom: 6,
  },
  inlineMsgRowMe: {
    justifyContent: "flex-end",
  },
  inlineMsgAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.primary + "22",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  inlineMsgAvatarTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 11,
    color: C.primary,
  },
  inlineMsgBubble: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 11,
    paddingVertical: 7,
    maxWidth: "75%",
  },
  inlineMsgBubbleMe: {
    backgroundColor: C.primary,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 4,
  },
  inlineMsgBubblePrompt: {
    backgroundColor: C.primary + "18",
    borderWidth: 1,
    borderColor: C.primary + "35",
    borderBottomLeftRadius: 4,
  },
  inlineMsgSender: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 10,
    color: C.textMuted,
    marginBottom: 2,
  },
  inlineMsgTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.text,
    lineHeight: 18,
  },
  inlineMsgTxtMe: {
    color: "#FFFFFF",
  },
  inlineMilestoneRow: {
    alignItems: "center",
    marginBottom: 6,
  },
  inlineMilestoneBubble: {
    backgroundColor: C.gold + "18",
    borderWidth: 1,
    borderColor: C.gold + "40",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  inlineMilestoneTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: C.gold,
    textAlign: "center",
  },
  inlineQuickReplyRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 8,
  },
  inlineQuickReplyChip: {
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  inlineQuickReplyTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: C.bg,
  },
  chatInputBar: {
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: C.bg,
  },
  inlineChatInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 2,
  },
  inlineChatInput: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 9,
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.text,
  },
  inlineSendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  inlineSendBtnDisabled: {
    backgroundColor: C.surface,
  },
  // GIF button in input row
  gifPickerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  gifPickerBtnTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 11,
    color: C.textMuted,
    letterSpacing: 0.5,
  },
  // Selected GIF preview strip
  gifPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  gifPreviewThumb: {
    width: 52,
    height: 52,
    borderRadius: 8,
  },
  gifPreviewRemove: {
    padding: 2,
  },
  // GIF message bubble
  inlineGifBubble: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderBottomLeftRadius: 4,
    overflow: "hidden",
    maxWidth: "75%",
    padding: 4,
  },
  inlineGifBubbleMe: {
    borderWidth: 1,
    borderColor: C.primary + "60",
    backgroundColor: "transparent",
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 4,
  },
  inlineGifImage: {
    width: 200,
    height: 140,
    borderRadius: 10,
  },
  // GIF picker overlay (inside crew detail modal — avoids nested modal iOS limitation)
  gifPickerOverlay: {
    position: "absolute",
    top: "48%",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.surface,
    zIndex: 99,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderColor: C.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 16,
  },
  gifPickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  gifPickerTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 18,
    color: C.text,
  },
  gifPickerClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  gifSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    margin: 12,
  },
  gifSearchInput: {
    flex: 1,
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: C.text,
  },
  gifTopicRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  gifTopicPill: {
    backgroundColor: C.card,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  gifTopicTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.text,
  },
  gifGridCell: {
    flex: 1,
    borderRadius: 10,
    overflow: "hidden",
    aspectRatio: 1,
    backgroundColor: C.card,
  },
  gifGridImg: {
    width: "100%",
    height: "100%",
  },
  gifEmptyTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textMuted,
    textAlign: "center",
  },
  runRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  runTitle: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: C.text,
  },
  runMeta: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: C.textMuted,
    marginTop: 2,
  },

  // Search / Invite user
  memberSearchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  memberSearchInput: {
    flex: 1,
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: C.text,
  },
  noResults: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textMuted,
    textAlign: "center",
    paddingTop: 24,
  },
  searchResultRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  searchResultAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  searchResultAvatarText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 17,
    color: C.primary,
  },
  searchResultInfo: {
    flex: 1,
  },
  searchResultName: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    color: C.text,
  },
  searchResultMeta: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: C.textMuted,
    marginTop: 2,
  },
  inviteBtn: {
    backgroundColor: C.primary,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  inviteBtnTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.bg,
  },
  invitedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: C.primary + "50",
  },
  invitedBadgeTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.primary,
  },
  requestsSection: {
    borderWidth: 1,
    borderColor: C.primary + "30",
    borderRadius: 14,
    backgroundColor: C.surface,
  },
  requestCountBadge: {
    backgroundColor: C.danger,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  requestCountBadgeTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 11,
    color: "#fff",
  },
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 2,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: C.card,
  },
  requestInfo: {
    flex: 1,
  },
  requestAcceptBtn: {
    backgroundColor: C.primary,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  requestAcceptTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.bg,
  },
  requestDeclineBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.danger + "60",
    alignItems: "center",
    justifyContent: "center",
  },
  rankingsBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: C.surface,
  },
  rankingsBtnTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    flex: 1,
  },

  suggestedSection: {
    marginBottom: 16,
  },
  suggestedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  suggestedTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: C.text,
  },
  suggestedCard: {
    width: 130,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    alignItems: "center",
    gap: 4,
  },
  suggestedCardImg: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginBottom: 4,
  },
  suggestedCardEmoji: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  suggestedCardName: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: C.text,
    textAlign: "center",
  },
  suggestedCardMeta: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: C.textMuted,
  },
  suggestedCardStyle: {
    fontFamily: "Outfit_400Regular",
    fontSize: 10,
    color: C.textSecondary,
  },
  suggestedCardBtn: {
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 5,
    marginTop: 4,
  },
  suggestedCardBtnTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: C.bg,
  },

  plansSection: {
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 8,
  },
  plansSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  plansSectionTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 17,
    color: C.text,
  },
  planStatusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  planStatusLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.textMuted,
  },
  planStatusValue: {
    fontFamily: "Outfit_700Bold",
    fontSize: 14,
    color: C.text,
  },
  planCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.border,
    padding: 14,
    marginBottom: 10,
    gap: 8,
  },
  planCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  planIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  planCardName: {
    fontFamily: "Outfit_700Bold",
    fontSize: 15,
    color: C.text,
  },
  planCardPrice: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: C.textMuted,
  },
  planActiveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  planActiveBadgeTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
  },
  planFeatureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 4,
  },
  planFeatureTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.textSecondary,
  },
  planSubscribeBtn: {
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 4,
  },
  planSubscribeBtnTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 14,
    color: "#fff",
  },
  restoreBtn: {
    alignSelf: "center",
    paddingVertical: 8,
    marginTop: 4,
  },
  restoreBtnTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.textMuted,
    textDecorationLine: "underline" as const,
  },

  upsellOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
  },
  upsellCard: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    gap: 12,
    maxWidth: 340,
    width: "100%",
  },
  upsellTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 22,
    color: C.text,
  },
  upsellBody: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  upsellBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 28,
    marginTop: 6,
  },
  upsellBtnTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 15,
    color: "#fff",
  },
  upsellDismissTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: C.textMuted,
  },
}); }
