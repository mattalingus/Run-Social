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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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

interface Crew {
  id: string;
  name: string;
  description?: string;
  emoji: string;
  created_by: string;
  created_at: string;
  member_count: number;
  created_by_name: string;
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
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; emoji: string }) => {
      const res = await apiRequest("POST", "/api/crews", data);
      return res.json() as Promise<Crew>;
    },
    onSuccess: (crew: Crew) => {
      qc.invalidateQueries({ queryKey: ["/api/crews"] });
      setName("");
      setDescription("");
      setEmoji("🏃");
      onCreated(crew);
    },
    onError: (e: any) => Alert.alert("Error", e.message ?? "Could not create crew"),
  });

  const handleCreate = () => {
    if (!name.trim()) { Alert.alert("Name required", "Give your crew a name"); return; }
    createMutation.mutate({ name: name.trim(), description: description.trim(), emoji });
  };

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
  visible,
  onClose,
  crewId,
  existingMemberIds,
}: {
  visible: boolean;
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
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={s.sheet}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>Invite to Crew</Text>
            <TouchableOpacity onPress={handleClose} testID="close-invite-sheet">
              <Ionicons name="close" size={24} color={C.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={s.searchBar}>
            <Ionicons name="search-outline" size={18} color={C.textMuted} style={{ marginRight: 8 }} />
            <TextInput
              style={s.searchInput}
              value={query}
              onChangeText={search}
              placeholder="Search by name"
              placeholderTextColor={C.textMuted}
              autoFocus
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
                  {(u.hosted_runs ?? 0) > 0 && (
                    <Text style={s.searchResultMeta}>{u.hosted_runs} runs hosted</Text>
                  )}
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
    </Modal>
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
  const { activityFilter } = useActivity();
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

  const handleLeave = () => {
    Alert.alert(
      "Leave Crew",
      `Are you sure you want to leave ${crew?.name}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: () => leaveMutation.mutate() },
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
              <View style={s.sheetHeader}>
                <View style={s.detailTitleRow}>
                  <Text style={s.detailEmoji}>{crew.emoji}</Text>
                  <Text style={s.sheetTitle}>{crew.name}</Text>
                </View>
                <TouchableOpacity onPress={onClose} testID="close-crew-detail">
                  <Ionicons name="close" size={24} color={C.textMuted} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
                {crew.description ? (
                  <Text style={s.detailDesc}>{crew.description}</Text>
                ) : null}

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
                      <View key={run.id} style={s.runRow}>
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
                      </View>
                    ))
                  )}
                </View>

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
        </View>
      </Modal>

      {showInvite && crew && (
        <InviteUserSheet
          visible={showInvite}
          onClose={() => setShowInvite(false)}
          crewId={crew.id}
          existingMemberIds={memberIds}
        />
      )}
    </>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function CrewScreen() {
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCrew, setSelectedCrew] = useState<Crew | null>(null);

  const { data: currentUser } = useQuery<{ id: string; name: string }>({
    queryKey: ["/api/me"],
  });

  const { data: crews = [], isLoading } = useQuery<Crew[]>({
    queryKey: ["/api/crews"],
  });

  const { data: invites = [] } = useQuery<CrewInvite[]>({
    queryKey: ["/api/crew-invites"],
  });

  const respondMutation = useMutation({
    mutationFn: ({ crewId, accept }: { crewId: string; accept: boolean }) =>
      apiRequest("POST", `/api/crew-invites/${crewId}/respond`, { accept }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/crew-invites"] });
      qc.invalidateQueries({ queryKey: ["/api/crews"] });
    },
  });

  const topPad = isWeb ? 67 : insets.top;
  const bottomPad = isWeb ? 34 : insets.bottom;

  return (
    <View style={[s.screen, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Crew</Text>
        <TouchableOpacity
          style={s.headerAdd}
          onPress={() => setShowCreate(true)}
          testID="open-create-crew"
        >
          <Ionicons name="add" size={22} color={C.bg} />
        </TouchableOpacity>
      </View>

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
            {/* Invite banners */}
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
  headerAdd: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
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
  leaveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 24,
    marginTop: 8,
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
  detailTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  detailEmoji: {
    fontSize: 24,
  },
  detailDesc: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: C.textDim,
    paddingHorizontal: 24,
    paddingTop: 12,
    lineHeight: 20,
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
  searchBar: {
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
  searchInput: {
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
