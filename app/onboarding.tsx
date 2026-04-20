import React, { useRef, useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Pressable,
  Linking,
  Platform,
  ActivityIndicator,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
} from "react-native";
import { router } from "expo-router";
import { Ionicons, Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/contexts/AuthContext";
import { useActivity, ActivityType } from "@/contexts/ActivityContext";
import { useWalkthrough } from "@/contexts/WalkthroughContext";
import { useTheme } from "@/contexts/ThemeContext";
import { getApiUrl, apiFetch } from "@/lib/query-client";
import { buildOnboardingInviteSmsUrl } from "@/lib/shareLinks";
import * as Notifications from "@/lib/safeNotifications";

const { width: SCREEN_W } = Dimensions.get("window");
const NOTIF_DEFERRED_KEY = "@paceup_notif_deferred";
const EXPERIENCE_KEY = "@paceup_experience_level";

type Level = "new" | "casual" | "serious" | "competitive";
type Units = "miles" | "km";

const ACTIVITIES: { type: ActivityType; label: string; icon: keyof typeof Ionicons.glyphMap; emoji: string; tagline: string }[] = [
  { type: "run", label: "Running", icon: "body", emoji: "🏃", tagline: "Track pace, splits, and PRs" },
  { type: "ride", label: "Cycling", icon: "bicycle", emoji: "🚴", tagline: "Speed groups for big rides" },
  { type: "walk", label: "Walking", icon: "footsteps", emoji: "🚶", tagline: "Steady miles, social strolls" },
];

const LEVELS: { key: Level; label: string; detail: string; emoji: string }[] = [
  { key: "new", label: "Just Starting", detail: "Building the habit", emoji: "🌱" },
  { key: "casual", label: "Weekly", detail: "A few sessions a week", emoji: "🌤️" },
  { key: "serious", label: "Dedicated", detail: "Training with structure", emoji: "🔥" },
  { key: "competitive", label: "Competitive", detail: "Racing and chasing PRs", emoji: "🏆" },
];

const NOTIF_BENEFITS = [
  { icon: "timer-outline" as const, text: "Event starting soon reminders" },
  { icon: "people-outline" as const, text: "Friend requests & crew invites" },
  { icon: "flash-outline" as const, text: "Live alerts from your crew" },
  { icon: "trophy-outline" as const, text: "Milestone celebrations" },
];

function goalDefaults(act: ActivityType, lvl: Level): { monthly: string; yearly: string } {
  const base =
    act === "ride"
      ? { new: 60, casual: 150, serious: 300, competitive: 500 }
      : act === "walk"
      ? { new: 20, casual: 40, serious: 75, competitive: 120 }
      : { new: 20, casual: 50, serious: 100, competitive: 175 };
  const monthly = base[lvl];
  return { monthly: String(monthly), yearly: String(monthly * 12) };
}

function actVerb(a: ActivityType) {
  return a === "ride" ? "riding" : a === "walk" ? "walking" : "running";
}
function actNoun(a: ActivityType) {
  return a === "ride" ? "ride" : a === "walk" ? "walk" : "run";
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { user, refreshUser } = useAuth();
  const { setActivityFilter } = useActivity();
  const { startWalkthrough } = useWalkthrough();
  const { theme, toggleTheme } = useTheme();

  const [step, setStep] = useState(0);
  const [activity, setActivity] = useState<ActivityType>("run");
  const [level, setLevel] = useState<Level>("casual");
  const [units, setUnits] = useState<Units>("miles");
  const [goals, setGoals] = useState(goalDefaults("run", "casual"));
  const [goalsEdited, setGoalsEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const firstName = user?.name?.split(" ")[0] ?? "there";
  const totalSteps = 9;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: (step + 1) / totalSteps,
      duration: 280,
      useNativeDriver: false,
    }).start();
  }, [step]);

  // Smart goals: auto-reseed when activity or level changes, unless user edited
  useEffect(() => {
    if (!goalsEdited) setGoals(goalDefaults(activity, level));
  }, [activity, level, goalsEdited]);

  function pickActivity(a: ActivityType) {
    setActivity(a);
  }

  function next() {
    if (step < totalSteps - 1) setStep(step + 1);
  }
  function back() {
    if (step > 0) setStep(step - 1);
  }

  async function saveOnboarding() {
    setSaveError(null);
    setLoading(true);
    try {
      // Save activity + goals to server
      const url = new URL("/api/users/me/onboarding", getApiUrl()).toString();
      const res = await apiFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityType: activity,
          monthlyGoal: parseFloat(goals.monthly) || 0,
          yearlyGoal: parseFloat(goals.yearly) || 0,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError((body as any).message || "Failed to save.");
        setLoading(false);
        return false;
      }
      // Units via standard user patch
      if (units === "km") {
        await apiFetch(new URL("/api/users/me", getApiUrl()).toString(), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ distanceUnit: "km" }),
        }).catch(() => {});
      }
      // Experience level local-only for now
      await AsyncStorage.setItem(EXPERIENCE_KEY, level).catch(() => {});
      setActivityFilter(activity);
      setLoading(false);
      return true;
    } catch (_) {
      setSaveError("Network error. Please try again.");
      setLoading(false);
      return false;
    }
  }

  async function handleEnableNotifs() {
    setNotifLoading(true);
    try {
      await Notifications.requestPermissionsAsync();
    } catch (_) {}
    setNotifLoading(false);
    next();
  }

  async function handleLaterNotifs() {
    await AsyncStorage.setItem(NOTIF_DEFERRED_KEY, "true").catch(() => {});
    next();
  }

  function handleInvite() {
    Linking.openURL(buildOnboardingInviteSmsUrl()).catch(() => {});
  }

  async function handleFinish(startTour: boolean) {
    const ok = await saveOnboarding();
    if (!ok) return;
    await refreshUser().catch(() => {});
    router.replace("/(tabs)");
    if (startTour) {
      // small delay so tabs mount first
      setTimeout(() => startWalkthrough(), 450);
    }
  }

  async function handleGoalsNext() {
    // Last data-capture step — trigger notifications permission flow next
    next();
  }

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  // ── SLIDES ───────────────────────────────────────────────────────────
  const slides: React.ReactNode[] = [
    // 0 — Welcome
    <View key="welcome" style={s.slide}>
      <View style={s.heroIconWrap}>
        <Text style={s.heroEmoji}>👋</Text>
      </View>
      <View style={s.logoRow}>
        <Text style={s.logoText}>PACE</Text>
        <Text style={[s.logoText, s.logoGreen]}>UP</Text>
      </View>
      <Text style={s.headline}>Hey {firstName}, welcome.</Text>
      <Text style={s.sub}>
        The social fitness app that finds you group runs, rides, and walks — and makes every solo session count.
      </Text>
      <View style={s.featureRow}>
        <FeatureBadge emoji="🗺️" label="Discover" />
        <FeatureBadge emoji="⚡" label="Track" />
        <FeatureBadge emoji="👥" label="Connect" />
      </View>
    </View>,

    // 1 — Activity
    <View key="activity" style={s.slide}>
      <Text style={s.stepTitle}>What's your main thing?</Text>
      <Text style={s.stepSub}>We'll lead with this every time you open the app. You can switch any time.</Text>
      <View style={s.actCol}>
        {ACTIVITIES.map((a) => {
          const selected = activity === a.type;
          return (
            <Pressable
              key={a.type}
              style={[s.actBigCard, selected && s.actBigCardSel]}
              onPress={() => pickActivity(a.type)}
            >
              <Text style={s.actBigEmoji}>{a.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.actBigLabel, selected && s.actBigLabelSel]}>{a.label}</Text>
                <Text style={s.actBigTag}>{a.tagline}</Text>
              </View>
              <View style={[s.actBigCheck, selected && s.actBigCheckSel]}>
                {selected && <Ionicons name="checkmark" size={16} color="#050C09" />}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>,

    // 2 — Level
    <View key="level" style={s.slide}>
      <Text style={s.stepTitle}>How into it are you?</Text>
      <Text style={s.stepSub}>Helps us tune goals and suggestions to match where you're at.</Text>
      <View style={s.levelGrid}>
        {LEVELS.map((lvl) => {
          const selected = level === lvl.key;
          return (
            <Pressable
              key={lvl.key}
              style={[s.levelCard, selected && s.levelCardSel]}
              onPress={() => setLevel(lvl.key)}
            >
              <Text style={s.levelEmoji}>{lvl.emoji}</Text>
              <Text style={[s.levelLabel, selected && s.levelLabelSel]}>{lvl.label}</Text>
              <Text style={s.levelDetail}>{lvl.detail}</Text>
              {selected && (
                <View style={s.levelTick}>
                  <Ionicons name="checkmark" size={11} color="#050C09" />
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>,

    // 3 — Goals
    <View key="goals" style={s.slide}>
      <Text style={s.stepTitle}>Set your goals</Text>
      <Text style={s.stepSub}>
        Distance goals drive the progress ring on your profile. We seeded sensible targets for {actVerb(activity)} — tweak freely.
      </Text>
      <View style={s.goalCard}>
        <View style={s.goalRow}>
          <Text style={s.goalLabel}>Monthly {units === "km" ? "km" : "miles"}</Text>
          <TextInput
            style={s.goalInput}
            value={goals.monthly}
            onChangeText={(t) => {
              setGoalsEdited(true);
              setGoals({ ...goals, monthly: t });
            }}
            keyboardType="numeric"
            selectTextOnFocus
            placeholderTextColor="#3D6B52"
          />
        </View>
        <View style={s.goalDivider} />
        <View style={s.goalRow}>
          <Text style={s.goalLabel}>Annual {units === "km" ? "km" : "miles"}</Text>
          <TextInput
            style={s.goalInput}
            value={goals.yearly}
            onChangeText={(t) => {
              setGoalsEdited(true);
              setGoals({ ...goals, yearly: t });
            }}
            keyboardType="numeric"
            selectTextOnFocus
            placeholderTextColor="#3D6B52"
          />
        </View>
      </View>
      <Pressable
        onPress={() => {
          setGoalsEdited(false);
          setGoals(goalDefaults(activity, level));
        }}
        style={s.resetLink}
      >
        <Feather name="refresh-cw" size={12} color="#6FAB84" />
        <Text style={s.resetLinkTxt}>Reset to suggested</Text>
      </Pressable>
    </View>,

    // 4 — Units
    <View key="units" style={s.slide}>
      <Text style={s.stepTitle}>Miles or kilometers?</Text>
      <Text style={s.stepSub}>We'll show all distances and paces in your preference.</Text>
      <View style={s.unitsRow}>
        {(["miles", "km"] as Units[]).map((u) => {
          const selected = units === u;
          return (
            <Pressable
              key={u}
              style={[s.unitCard, selected && s.unitCardSel]}
              onPress={() => setUnits(u)}
            >
              <Text style={[s.unitBig, selected && s.unitBigSel]}>{u === "miles" ? "mi" : "km"}</Text>
              <Text style={s.unitSub}>{u === "miles" ? "Imperial" : "Metric"}</Text>
              {selected && (
                <View style={s.unitTick}>
                  <Ionicons name="checkmark" size={12} color="#050C09" />
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>,

    // 5 — Theme
    <View key="theme" style={s.slide}>
      <Text style={s.stepTitle}>Light or dark?</Text>
      <Text style={s.stepSub}>Pick the vibe. You can change this any time in Settings.</Text>
      <View style={s.themeRow}>
        {(["light", "dark"] as const).map((t) => {
          const selected = theme === t;
          const isLight = t === "light";
          const bg = isLight ? "#FFFFFF" : "#050C09";
          const surface = isLight ? "#F0F9F3" : "#0F1A14";
          const card = isLight ? "#FFFFFF" : "#132019";
          const border = isLight ? "#D4EBDC" : "#1E2E24";
          const text = isLight ? "#05120A" : "#F2FBF6";
          const subText = isLight ? "#4E6B58" : "#8FB9A0";
          const primary = "#00A85E";
          return (
            <Pressable
              key={t}
              style={[s.themeCard, selected && s.themeCardSel]}
              onPress={() => { if (theme !== t) toggleTheme(); }}
            >
              <View style={[s.themePreview, { backgroundColor: bg, borderColor: border }]}>
                {/* Status bar */}
                <View style={s.themeStatusBar}>
                  <View style={[s.themeStatusDot, { backgroundColor: subText }]} />
                  <View style={[s.themeStatusDot, { backgroundColor: subText, width: 10 }]} />
                  <View style={[s.themeStatusDot, { backgroundColor: subText, width: 14 }]} />
                </View>
                {/* Header: PaceUp wordmark + bell */}
                <View style={s.themeHeader}>
                  <Text style={[s.themeBrand, { color: text }]}>PaceUp</Text>
                  <View style={[s.themeBell, { backgroundColor: primary + "22", borderColor: primary + "55" }]} />
                </View>
                {/* Activity pills */}
                <View style={s.themePillsRow}>
                  <View style={[s.themePill, { backgroundColor: primary }]}>
                    <Text style={s.themePillOn}>Run</Text>
                  </View>
                  <View style={[s.themePill, { backgroundColor: primary + "22", borderColor: primary + "44", borderWidth: 1 }]}>
                    <Text style={[s.themePillOff, { color: subText }]}>Ride</Text>
                  </View>
                </View>
                {/* Event card mockup */}
                <View style={[s.themeEventCard, { backgroundColor: card, borderColor: border }]}>
                  <View style={s.themeEventRow}>
                    <View style={[s.themeAvatar, { backgroundColor: primary + "33" }]} />
                    <View style={{ flex: 1, gap: 3 }}>
                      <View style={[s.themeLineHeavy, { backgroundColor: text, width: "70%" }]} />
                      <View style={[s.themeLine, { backgroundColor: subText, width: "50%" }]} />
                    </View>
                  </View>
                  <View style={[s.themeStatsRow, { borderTopColor: border }]}>
                    <View style={[s.themeStatPill, { backgroundColor: primary + "18" }]}>
                      <View style={[s.themeLineHeavy, { backgroundColor: primary, width: 18 }]} />
                    </View>
                    <View style={[s.themeStatPill, { backgroundColor: border + "80" }]}>
                      <View style={[s.themeLineHeavy, { backgroundColor: subText, width: 18 }]} />
                    </View>
                    <View style={[s.themeStatPill, { backgroundColor: border + "80" }]}>
                      <View style={[s.themeLineHeavy, { backgroundColor: subText, width: 18 }]} />
                    </View>
                  </View>
                </View>
                {/* Bottom tab bar */}
                <View style={[s.themeTabBar, { backgroundColor: surface, borderColor: border }]}>
                  <View style={[s.themeTabDot, { backgroundColor: primary }]} />
                  <View style={[s.themeTabDotSm, { backgroundColor: subText }]} />
                  <View style={[s.themeTabDotSm, { backgroundColor: subText }]} />
                  <View style={[s.themeTabDotSm, { backgroundColor: subText }]} />
                </View>
              </View>
              <Text style={[s.themeLabel, selected && s.themeLabelSel]}>{isLight ? "Light" : "Dark"}</Text>
              {selected && (
                <View style={s.themeTick}>
                  <Ionicons name="checkmark" size={12} color="#050C09" />
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>,

    // 6 — Notifications
    <View key="notif" style={s.slide}>
      <View style={s.notifIconWrap}>
        <Ionicons name="notifications" size={36} color="#00D97E" />
      </View>
      <Text style={s.stepTitle}>Stay in the loop</Text>
      <Text style={s.stepSub}>Nudges at the right moments so you never miss a group session or crew alert.</Text>
      <View style={s.benefitsList}>
        {NOTIF_BENEFITS.map((b, i) => (
          <View key={i} style={s.benefitRow}>
            <View style={s.benefitIcon}>
              <Ionicons name={b.icon} size={16} color="#00D97E" />
            </View>
            <Text style={s.benefitText}>{b.text}</Text>
          </View>
        ))}
      </View>
    </View>,

    // 6 — Invite
    <View key="invite" style={s.slide}>
      <View style={s.heroIconWrap}>
        <Text style={s.heroEmoji}>🤝</Text>
      </View>
      <Text style={s.stepTitle}>Better with friends</Text>
      <Text style={s.stepSub}>
        PaceUp gets way more fun with your crew. Send an invite — they'll get a link to join you.
      </Text>
      <TouchableOpacity style={s.inviteBigBtn} onPress={handleInvite} activeOpacity={0.85}>
        <Ionicons name="share-outline" size={20} color="#050C09" />
        <Text style={s.inviteBigTxt}>Invite friends</Text>
      </TouchableOpacity>
      <Text style={s.sideNote}>You can invite anyone later from your profile.</Text>
    </View>,

    // 7 — Finish
    <View key="done" style={s.slide}>
      <View style={s.doneIconWrap}>
        <Ionicons name="checkmark" size={46} color="#00D97E" />
      </View>
      <Text style={s.headline}>You're in, {firstName}.</Text>
      <Text style={s.sub}>
        Last thing — a quick 60-second tour of the biggest features. Skip if you want to jump straight in.
      </Text>
      <View style={s.tourCard}>
        <View style={s.tourRow}>
          <Text style={s.tourEmoji}>🗺️</Text>
          <Text style={s.tourTxt}>Discover {actNoun(activity)}s nearby</Text>
        </View>
        <View style={s.tourRow}>
          <Text style={s.tourEmoji}>⚡</Text>
          <Text style={s.tourTxt}>Track solo workouts + save routes</Text>
        </View>
        <View style={s.tourRow}>
          <Text style={s.tourEmoji}>👥</Text>
          <Text style={s.tourTxt}>Crews, pace groups, rankings</Text>
        </View>
      </View>
      {saveError && <Text style={s.error}>{saveError}</Text>}
    </View>,
  ];

  const isLast = step === totalSteps - 1;
  const isFirst = step === 0;

  // ── Slide footer (CTA logic per step) ─────────────────────────────────
  function renderFooter() {
    if (step === 6) {
      // notifications
      return (
        <>
          <TouchableOpacity
            style={[s.ctaBtn, notifLoading && { opacity: 0.7 }]}
            onPress={handleEnableNotifs}
            disabled={notifLoading}
          >
            {notifLoading ? <ActivityIndicator color="#050C09" /> : <Text style={s.ctaTxt}>Enable notifications</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={handleLaterNotifs} style={s.skipTxtBtn} disabled={notifLoading}>
            <Text style={s.skipTxt}>Maybe later</Text>
          </TouchableOpacity>
        </>
      );
    }
    if (step === 7) {
      // invite
      return (
        <>
          <TouchableOpacity style={s.ctaBtn} onPress={next}>
            <Text style={s.ctaTxt}>Continue</Text>
          </TouchableOpacity>
        </>
      );
    }
    if (isLast) {
      return (
        <>
          <TouchableOpacity
            style={[s.ctaBtn, loading && { opacity: 0.7 }]}
            onPress={() => handleFinish(true)}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#050C09" />
            ) : (
              <>
                <Text style={s.ctaTxt}>Take the tour</Text>
                <Ionicons name="arrow-forward" size={18} color="#050C09" />
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleFinish(false)} style={s.skipTxtBtn} disabled={loading}>
            <Text style={s.skipTxt}>Jump straight in</Text>
          </TouchableOpacity>
        </>
      );
    }
    return (
      <TouchableOpacity style={s.ctaBtn} onPress={step === 3 ? handleGoalsNext : next}>
        <Text style={s.ctaTxt}>{isFirst ? "Let's set you up" : "Continue"}</Text>
        <Ionicons name="arrow-forward" size={18} color="#050C09" />
      </TouchableOpacity>
    );
  }

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      {/* Top bar: back + progress */}
      <View style={s.topBar}>
        <Pressable onPress={back} style={s.backBtn} hitSlop={12} disabled={isFirst}>
          {!isFirst && <Ionicons name="chevron-back" size={22} color="#6FAB84" />}
        </Pressable>
        <View style={s.progressTrack}>
          <Animated.View
            style={[
              s.progressFill,
              {
                width: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0%", "100%"],
                }),
              },
            ]}
          />
        </View>
        <Text style={s.stepCount}>
          {step + 1}/{totalSteps}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={topPad + 20}
      >
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingBottom: bottomPad + 24 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {slides[step]}
        </ScrollView>

        <View style={[s.footer, { paddingBottom: bottomPad + 12 }]}>{renderFooter()}</View>
      </KeyboardAvoidingView>
    </View>
  );
}

function FeatureBadge({ emoji, label }: { emoji: string; label: string }) {
  return (
    <View style={s.fbWrap}>
      <Text style={s.fbEmoji}>{emoji}</Text>
      <Text style={s.fbLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#050C09" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  backBtn: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#132019",
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: "#00D97E", borderRadius: 2 },
  stepCount: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: "#4A6957",
    minWidth: 32,
    textAlign: "right",
  },
  scroll: { paddingHorizontal: 24, paddingTop: 8 },
  slide: { flex: 1, minHeight: 400 },
  heroIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#0A1F14",
    borderWidth: 1.5,
    borderColor: "#1A3D22",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  heroEmoji: { fontSize: 40 },
  logoRow: { flexDirection: "row", marginBottom: 14 },
  logoText: { fontFamily: "Outfit_700Bold", fontSize: 22, letterSpacing: 3, color: "#FFFFFF" },
  logoGreen: { color: "#00D97E" },
  headline: {
    fontFamily: "Outfit_700Bold",
    fontSize: 30,
    lineHeight: 36,
    color: "#FFFFFF",
    marginBottom: 10,
  },
  sub: {
    fontFamily: "Outfit_400Regular",
    fontSize: 16,
    lineHeight: 24,
    color: "#6FAB84",
    marginBottom: 24,
  },
  featureRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  fbWrap: {
    flex: 1,
    backgroundColor: "#0D1510",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1A2E20",
    paddingVertical: 14,
    alignItems: "center",
    gap: 4,
  },
  fbEmoji: { fontSize: 22 },
  fbLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 12, color: "#D0E8DA" },
  stepTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 26,
    lineHeight: 32,
    color: "#FFFFFF",
    marginBottom: 8,
  },
  stepSub: {
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    lineHeight: 22,
    color: "#6FAB84",
    marginBottom: 24,
  },

  actCol: { gap: 12 },
  actBigCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: "#0D1510",
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#1A2E20",
    paddingVertical: 18,
    paddingHorizontal: 18,
  },
  actBigCardSel: { borderColor: "#00D97E", backgroundColor: "#0F1F14" },
  actBigEmoji: { fontSize: 36 },
  actBigLabel: { fontFamily: "Outfit_700Bold", fontSize: 18, color: "#D0E8DA" },
  actBigLabelSel: { color: "#FFFFFF" },
  actBigTag: { fontFamily: "Outfit_400Regular", fontSize: 13, color: "#6FAB84", marginTop: 2 },
  actBigCheck: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: "#1A3D22",
    alignItems: "center",
    justifyContent: "center",
  },
  actBigCheckSel: { backgroundColor: "#00D97E", borderColor: "#00D97E" },

  levelGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  levelCard: {
    width: (SCREEN_W - 48 - 10) / 2,
    backgroundColor: "#0D1510",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#1A2E20",
    padding: 16,
    minHeight: 108,
    position: "relative",
  },
  levelCardSel: { borderColor: "#00D97E", backgroundColor: "#0F1F14" },
  levelEmoji: { fontSize: 26, marginBottom: 6 },
  levelLabel: { fontFamily: "Outfit_700Bold", fontSize: 15, color: "#D0E8DA" },
  levelLabelSel: { color: "#FFFFFF" },
  levelDetail: { fontFamily: "Outfit_400Regular", fontSize: 12, color: "#6FAB84", marginTop: 2 },
  levelTick: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#00D97E",
    alignItems: "center",
    justifyContent: "center",
  },

  goalCard: {
    backgroundColor: "#0D1510",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#1A2E20",
    overflow: "hidden",
  },
  goalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  goalDivider: { height: 1, backgroundColor: "#1A2E20" },
  goalLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#D0E8DA" },
  goalInput: {
    fontFamily: "Outfit_700Bold",
    fontSize: 22,
    color: "#FFFFFF",
    textAlign: "right",
    minWidth: 100,
    paddingVertical: 4,
  },
  resetLink: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", marginTop: 14, padding: 6 },
  resetLinkTxt: { fontFamily: "Outfit_400Regular", fontSize: 13, color: "#6FAB84" },

  unitsRow: { flexDirection: "row", gap: 12 },
  unitCard: {
    flex: 1,
    backgroundColor: "#0D1510",
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#1A2E20",
    paddingVertical: 32,
    alignItems: "center",
    position: "relative",
  },
  unitCardSel: { borderColor: "#00D97E", backgroundColor: "#0F1F14" },
  unitBig: { fontFamily: "Outfit_700Bold", fontSize: 40, color: "#6FAB84" },
  unitBigSel: { color: "#00D97E" },
  unitSub: { fontFamily: "Outfit_400Regular", fontSize: 13, color: "#6FAB84", marginTop: 4 },
  unitTick: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#00D97E",
    alignItems: "center",
    justifyContent: "center",
  },

  themeRow: { flexDirection: "row", gap: 12 },
  themeCard: {
    flex: 1,
    backgroundColor: "#0D1510",
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#1A2E20",
    padding: 12,
    alignItems: "center",
    position: "relative",
  },
  themeCardSel: { borderColor: "#00D97E", backgroundColor: "#0F1F14" },
  themePreview: {
    width: "100%",
    aspectRatio: 0.5,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 8,
    overflow: "hidden",
    borderWidth: 1.5,
    gap: 8,
  },
  themeStatusBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 4,
    marginBottom: 2,
  },
  themeStatusDot: { width: 6, height: 6, borderRadius: 2 },
  themeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  themeBrand: { fontFamily: "Outfit_700Bold", fontSize: 14 },
  themeBell: { width: 18, height: 18, borderRadius: 9, borderWidth: 1 },
  themePillsRow: { flexDirection: "row", gap: 5, paddingHorizontal: 4 },
  themePill: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 10 },
  themePillOn: { fontSize: 8, fontFamily: "Outfit_700Bold", color: "#fff" },
  themePillOff: { fontSize: 8, fontFamily: "Outfit_600SemiBold" },
  themeEventCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 8,
    gap: 8,
    marginHorizontal: 2,
  },
  themeEventRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  themeAvatar: { width: 22, height: 22, borderRadius: 11 },
  themeLineHeavy: { height: 4, borderRadius: 2 },
  themeLine: { height: 3, borderRadius: 2 },
  themeStatsRow: { flexDirection: "row", gap: 4, paddingTop: 6, borderTopWidth: 1 },
  themeStatPill: {
    flex: 1,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  themeTabBar: {
    marginTop: "auto",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: 1,
    marginHorizontal: 6,
  },
  themeTabDot: { width: 7, height: 7, borderRadius: 4 },
  themeTabDotSm: { width: 5, height: 5, borderRadius: 2.5 },
  themeLabel: { fontFamily: "Outfit_600SemiBold", fontSize: 16, color: "#6FAB84", marginTop: 10 },
  themeLabelSel: { color: "#00D97E" },
  themeTick: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#00D97E",
    alignItems: "center",
    justifyContent: "center",
  },

  notifIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#0A1F14",
    borderWidth: 1.5,
    borderColor: "#1A3D22",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  benefitsList: {
    backgroundColor: "#0D1510",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#1A2E20",
    paddingVertical: 6,
    paddingHorizontal: 14,
    gap: 2,
  },
  benefitRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  benefitIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#132019",
    alignItems: "center",
    justifyContent: "center",
  },
  benefitText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: "#D0E8DA", flex: 1 },

  inviteBigBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#00D97E",
    borderRadius: 16,
    paddingVertical: 18,
    marginTop: 8,
  },
  inviteBigTxt: { fontFamily: "Outfit_700Bold", fontSize: 16, color: "#050C09" },
  sideNote: { fontFamily: "Outfit_400Regular", fontSize: 13, color: "#4A6957", textAlign: "center", marginTop: 14 },

  doneIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#0A1F14",
    borderWidth: 2,
    borderColor: "#00D97E",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  tourCard: {
    backgroundColor: "#0D1510",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1A2E20",
    padding: 16,
    gap: 12,
    marginTop: 8,
  },
  tourRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  tourEmoji: { fontSize: 22 },
  tourTxt: { fontFamily: "Outfit_500Medium", fontSize: 14, color: "#D0E8DA", flex: 1 },

  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#0D1510",
    backgroundColor: "#050C09",
  },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#00D97E",
    borderRadius: 16,
    paddingVertical: 17,
    marginBottom: 6,
  },
  ctaTxt: { fontFamily: "Outfit_700Bold", fontSize: 16, color: "#050C09" },
  skipTxtBtn: { alignItems: "center", paddingVertical: 10 },
  skipTxt: { fontFamily: "Outfit_400Regular", fontSize: 14, color: "#4A6957" },
  error: { fontFamily: "Outfit_400Regular", fontSize: 13, color: "#FF6B35", textAlign: "center", marginTop: 12 },
});
