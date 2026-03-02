import React, { useState, useCallback, useRef } from "react";
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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useActivity } from "@/contexts/ActivityContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";

const C = {
  bg: "#080F0C",
  surface: "#111A15",
  card: "#1A2E21",
  border: "#1E3528",
  primary: "#00D97E",
  orange: "#FF6B35",
  text: "#E8F5EE",
  textMuted: "#6B8F78",
  textDim: "#A8C4B4",
  danger: "#FF4444",
};

const EMOJIS = ["🏃", "🚴", "⚡", "🔥", "💪", "🌿", "🦅", "🐺", "🦁", "🏔", "🌊", "⭐", "🎯", "🚀", "🌙"];
const CREW_RUN_STYLES = ["Easy Pace", "Chill", "Steady", "Tempo", "Fast", "Recovery", "Long Run", "Progressive", "Intervals", "Race Prep"];
const CREW_VIBES = ["Talkative", "Quiet", "Motivational", "Training", "Ministry", "Recovery"];

interface Crew {
  id: string;
  name: string;
  description?: string;
  emoji: string;
  created_by: string;
  created_at: string;
  member_count: number;
  created_by_name: string;
  run_style?: string;
  tags?: string[];
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
  distance_miles?: number;
  participant_count?: number;
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

function formatPace(p?: number) {
  if (!p || p <= 0) return "--";
  const m = Math.floor(p);
  const s = Math.round((p - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}/mi`;
}

// ─── Invite Banner ────────────────────────────────────────────────────────────
function InviteBanner({ invite, onAccept, onDecline }: { invite: CrewInvite; onAccept: () => void; onDecline: () => void }) {
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
  const vibes = crew.tags ?? [];
  return (
    <TouchableOpacity style={s.crewCard} onPress={onPress} activeOpacity={0.75} testID={`crew-card-${crew.id}`}>
      <View style={s.crewCardLeft}>
        <View style={s.crewEmojiBadge}>
          <Text style={s.crewEmojiText}>{crew.emoji}</Text>
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
      <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
    </TouchableOpacity>
  );
}

// ─── Create Crew Sheet ────────────────────────────────────────────────────────
function CreateCrewSheet({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (crew: Crew) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState("🏃");
  const [runStyle, setRunStyle] = useState<string | null>(null);
  const [vibes, setVibes] = useState<string[]>([]);
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; emoji: string; runStyle?: string; tags: string[] }) => {
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
      onCreated(crew);
    },
    onError: (e: any) => Alert.alert("Error", e.message ?? "Could not create crew"),
  });

  const handleCreate = () => {
    if (!name.trim()) { Alert.alert("Name required", "Give your crew a name"); return; }
    createMutation.mutate({ name: name.trim(), description: description.trim(), emoji, runStyle: runStyle ?? undefined, tags: vibes });
  };

  const toggleVibe = (v: string) => setVibes((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);

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
            <Text style={s.fieldLabel}>Pick an emoji</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.emojiRow}>
              {EMOJIS.map((e) => (
                <TouchableOpacity
                  key={e}
                  style={[s.emojiOption, emoji === e && s.emojiOptionActive]}
                  onPress={() => setEmoji(e)}
                >
                  <Text style={s.emojiOptionText}>{e}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={s.fieldLabel}>Crew name</Text>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Dawn Patrol, Weekend Warriors"
              placeholderTextColor={C.textMuted}
              maxLength={40}
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

            <Text style={s.fieldLabel}>Group Vibe <Text style={s.fieldOptional}>(optional)</Text></Text>
            <Text style={s.fieldHint}>What best describes the energy of your crew?</Text>
            <View style={s.chipsGrid}>
              {CREW_VIBES.map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[s.chip, vibes.includes(v) && s.chipVibeActive]}
                  onPress={() => toggleVibe(v)}
                >
                  <Text style={[s.chipTxt, vibes.includes(v) && s.chipVibeActiveTxt]}>{v}</Text>
                </TouchableOpacity>
              ))}
            </View>

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
}: {
  onClose: () => void;
  crewId: string;
  existingMemberIds: string[];
}) {
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
              {invited.has(u.id) ? (
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

// ─── Crew Detail Sheet ────────────────────────────────────────────────────────
function CrewDetailSheet({
  crew,
  onClose,
  currentUserId,
}: {
  crew: Crew | null;
  onClose: () => void;
  currentUserId: string;
}) {
  const { activityFilter, setActivityFilter } = useActivity();
  const [showInvite, setShowInvite] = useState(false);
  const qc = useQueryClient();

  const { data: detail, isLoading: detailLoading } = useQuery<CrewDetail>({
    queryKey: ["/api/crews", crew?.id],
    enabled: !!crew?.id,
  });

  const { data: crewRuns = [] } = useQuery<Run[]>({
    queryKey: ["/api/crews", crew?.id, "runs"],
    enabled: !!crew?.id,
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

  const handleLeave = () => {
    const isCreatorWithOthers = isCreator && members.length > 1;
    Alert.alert(
      "Leave Crew",
      isCreatorWithOthers
        ? `You created ${crew?.name}. If you leave, the next member to join will become the new creator and the crew stays active.`
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

  const filteredRuns = crewRuns.filter((r) => (r.activity_type ?? "run") === activityFilter);
  const members = detail?.members ?? [];
  const memberIds = members.map((m) => m.user_id);
  const isCreator = crew?.created_by === currentUserId;

  return (
    <>
      <Modal visible={!!crew} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <View style={s.sheet}>
          <View style={s.sheetHandle} />
          {!crew ? null : (
            <>
              {/* Close button row */}
              <View style={s.detailCloseRow}>
                <TouchableOpacity onPress={onClose} testID="close-crew-detail" style={s.detailCloseBtn}>
                  <Ionicons name="close" size={22} color={C.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Hero title */}
              <View style={s.detailHero}>
                <Text style={s.detailHeroEmoji}>{crew.emoji}</Text>
                <Text style={s.detailHeroName}>{crew.name}</Text>
                {crew.description ? (
                  <Text style={s.detailDesc}>{crew.description}</Text>
                ) : null}
              </View>

              {/* Runs / Rides toggle */}
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
              </View>

              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>

                {/* Members */}
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
                    members.map((m) => (
                      <View key={m.user_id} style={s.memberRow}>
                        <View style={s.memberAvatar}>
                          <Text style={s.memberAvatarText}>{m.name[0]?.toUpperCase()}</Text>
                        </View>
                        <View style={s.memberInfo}>
                          <Text style={s.memberName}>
                            {m.name}
                            {m.user_id === crew.created_by && (
                              <Text style={s.creatorBadge}> · Creator</Text>
                            )}
                          </Text>
                          {m.avg_pace && m.avg_pace > 0 ? (
                            <Text style={s.memberMeta}>{formatPace(m.avg_pace)} avg</Text>
                          ) : null}
                        </View>
                      </View>
                    ))
                  )}
                </View>

                {/* Upcoming runs */}
                <View style={s.detailSection}>
                  <Text style={s.detailSectionTitle}>
                    Upcoming {activityFilter === "ride" ? "Rides" : "Runs"}
                  </Text>
                  {filteredRuns.length === 0 ? (
                    <View style={s.emptyRuns}>
                      <Ionicons
                        name={activityFilter === "ride" ? "bicycle-outline" : "walk-outline"}
                        size={28}
                        color={C.textMuted}
                      />
                      <Text style={s.emptyRunsTxt}>
                        No upcoming {activityFilter === "ride" ? "rides" : "runs"} from your crew
                      </Text>
                    </View>
                  ) : (
                    filteredRuns.map((run) => (
                      <TouchableOpacity
                        key={run.id}
                        style={s.runRow}
                        activeOpacity={0.7}
                        testID={`crew-run-row-${run.id}`}
                        onPress={() => {
                          onClose();
                          router.push({ pathname: "/run/[id]", params: { id: run.id } });
                        }}
                      >
                        <Ionicons
                          name={run.activity_type === "ride" ? "bicycle-outline" : "walk-outline"}
                          size={16}
                          color={C.primary}
                          style={{ marginRight: 8, marginTop: 2 }}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={s.runTitle}>{run.title}</Text>
                          <Text style={s.runMeta}>
                            {formatDate(run.date)} · {run.host_name}
                            {run.participant_count ? ` · ${run.participant_count} going` : ""}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
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
                    name={activityFilter === "ride" ? "bicycle-outline" : "walk-outline"}
                    size={16}
                    color={C.primary}
                  />
                  <Text style={s.scheduleBtnTxt}>
                    Schedule a {activityFilter === "ride" ? "Ride" : "Run"}
                  </Text>
                </TouchableOpacity>

                {/* Disband (creator only) */}
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

          {showInvite && crew && (
            <InviteUserSheet
              onClose={() => setShowInvite(false)}
              crewId={crew.id}
              existingMemberIds={memberIds}
            />
          )}
        </View>
      </Modal>
    </>
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
  return (
    <TouchableOpacity
      style={s.searchCard}
      onPress={isMember ? onOpen : undefined}
      activeOpacity={isMember ? 0.75 : 1}
    >
      <Text style={s.searchCardEmoji}>{crew.emoji}</Text>
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

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function CrewScreen() {
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCrew, setSelectedCrew] = useState<Crew | null>(null);
  const [searchText, setSearchText] = useState("");
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [searchActive, setSearchActive] = useState(false);

  const isSearching = searchText.trim().length > 0 || friendsOnly;
  const searchUrl = `/api/crews/search?q=${encodeURIComponent(searchText.trim())}&friends=${friendsOnly}`;

  const { data: currentUser } = useQuery<{ id: string; name: string }>({
    queryKey: ["/api/me"],
  });

  const { data: crews = [], isLoading } = useQuery<Crew[]>({
    queryKey: ["/api/crews"],
  });

  const { data: invites = [] } = useQuery<CrewInvite[]>({
    queryKey: ["/api/crew-invites"],
  });

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
  });

  const joinRequestMutation = useMutation({
    mutationFn: (crewId: string) => apiRequest("POST", `/api/crews/${crewId}/join-request`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [searchUrl] });
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
    <View style={[s.screen, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Crew</Text>
      </View>

      {/* Create A Crew CTA */}
      <TouchableOpacity
        style={s.createCrewBtn}
        onPress={() => setShowCreate(true)}
        testID="open-create-crew"
        activeOpacity={0.88}
      >
        <Ionicons name="people" size={20} color={C.bg} />
        <Text style={s.createCrewBtnTxt}>Create A Crew</Text>
      </TouchableOpacity>

      {/* Search bar */}
      <View style={s.searchRow}>
        <View style={s.searchBar}>
          <Ionicons name="search" size={15} color={C.textMuted} />
          <TextInput
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
            </>
          )}
          renderItem={({ item }) => (
            <CrewCard crew={item} onPress={() => setSelectedCrew(item)} />
          )}
          ListEmptyComponent={() =>
            isLoading ? (
              <View style={s.emptyState}>
                <ActivityIndicator color={C.primary} size="large" />
              </View>
            ) : (
              <View style={s.emptyState}>
                <Ionicons name="people-outline" size={52} color={C.textMuted} />
                <Text style={s.emptyTitle}>No crews yet</Text>
                <Text style={s.emptyBody}>
                  Create a crew and invite your running friends — or accept an invite when one arrives.
                </Text>
                <TouchableOpacity style={s.primaryBtn} onPress={() => setShowCreate(true)} testID="create-first-crew">
                  <Text style={s.primaryBtnTxt}>Create a Crew</Text>
                </TouchableOpacity>
              </View>
            )
          }
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
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
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
    color: C.textDim,
  },
  searchCardBadge: {
    backgroundColor: "#00D97E22",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "#00D97E44",
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
    color: C.textDim,
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
    paddingHorizontal: 24,
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
    color: C.textDim,
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
    backgroundColor: C.primaryMuted,
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
    marginHorizontal: 24,
    marginTop: 24,
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
    marginHorizontal: 24,
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
    marginHorizontal: 24,
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
    justifyContent: "flex-end",
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
  detailHero: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 16,
    paddingTop: 8,
  },
  detailHeroEmoji: {
    fontSize: 52,
    marginBottom: 8,
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
    color: C.textDim,
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
    paddingHorizontal: 24,
    paddingTop: 24,
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
    marginHorizontal: 24,
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
    paddingHorizontal: 24,
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
});
