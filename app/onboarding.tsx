import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Linking,
  Platform,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/contexts/AuthContext";
import { useActivity, ActivityType } from "@/contexts/ActivityContext";
import { useWalkthrough } from "@/contexts/WalkthroughContext";
import { getApiUrl, apiFetch } from "@/lib/query-client";
import { buildOnboardingInviteSmsUrl } from "@/lib/shareLinks";

type ActivityOption = {
  type: ActivityType;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  emoji: string;
};

const ACTIVITIES: ActivityOption[] = [
  { type: "run", label: "Running", icon: "body", emoji: "🏃" },
  { type: "ride", label: "Cycling", icon: "bicycle", emoji: "🚴" },
  { type: "walk", label: "Walking", icon: "footsteps", emoji: "🚶" },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { user, refreshUser } = useAuth();
  const { setActivityFilter } = useActivity();
  const { startWalkthrough } = useWalkthrough();

  const [selectedActivity, setSelectedActivity] = useState<ActivityType>("run");
  const [monthlyGoal, setMonthlyGoal] = useState("50");
  const [yearlyGoal, setYearlyGoal] = useState("500");

  function handleActivitySelect(activity: ActivityType) {
    setSelectedActivity(activity);
    if (activity === "ride") {
      setMonthlyGoal("200");
      setYearlyGoal("2000");
    } else if (activity === "walk") {
      setMonthlyGoal("30");
      setYearlyGoal("300");
    } else {
      setMonthlyGoal("50");
      setYearlyGoal("500");
    }
  }
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const firstName = user?.name?.split(" ")[0] ?? "there";

  function parseGoal(raw: string, fallback: number): number {
    const n = parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  async function handleGetStarted() {
    setSaveError(null);
    setLoading(true);
    try {
      const url = new URL("/api/users/me/onboarding", getApiUrl()).toString();
      const res = await apiFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityType: selectedActivity,
          monthlyGoal: parseGoal(monthlyGoal, 50),
          yearlyGoal: parseGoal(yearlyGoal, 500),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError((body as any).message || "Failed to save. Please try again.");
        setLoading(false);
        return;
      }
      setActivityFilter(selectedActivity);
      await refreshUser();
    } catch (_) {
      setSaveError("Network error. Please try again.");
      setLoading(false);
      return;
    }
    setLoading(false);
    router.replace("/(tabs)");
    startWalkthrough();
  }

  async function handleSkip() {
    try {
      const url = new URL("/api/users/me/onboarding", getApiUrl()).toString();
      const res = await apiFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityType: selectedActivity }),
      });
      if (res.ok) {
        setActivityFilter(selectedActivity);
        await refreshUser();
      }
    } catch (_) {}
    router.replace("/(tabs)");
  }

  function handleInvite() {
    Linking.openURL(buildOnboardingInviteSmsUrl()).catch(() => {});
  }

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo mark */}
        <View style={styles.logoRow}>
          <Text style={styles.logoText}>PACE</Text>
          <Text style={[styles.logoText, styles.logoGreen]}>UP</Text>
        </View>

        {/* Email verified badge */}
        <View style={styles.verifiedBadge}>
          <Ionicons name="checkmark-circle" size={14} color="#00D97E" />
          <Text style={styles.verifiedBadgeText}>Email verified</Text>
        </View>

        {/* Welcome */}
        <Text style={styles.welcome}>Welcome to PaceUp, {firstName}!</Text>
        <Text style={styles.subtitle}>Let's set up your experience</Text>

        {/* Activity picker */}
        <Text style={styles.sectionLabel}>What's your main focus?</Text>
        <View style={styles.activityRow}>
          {ACTIVITIES.map((a) => {
            const selected = selectedActivity === a.type;
            return (
              <TouchableOpacity
                key={a.type}
                style={[styles.activityCard, selected && styles.activityCardSelected]}
                onPress={() => handleActivitySelect(a.type)}
                activeOpacity={0.8}
              >
                <Text style={styles.activityEmoji}>{a.emoji}</Text>
                <Text style={[styles.activityLabel, selected && styles.activityLabelSelected]}>
                  {a.label}
                </Text>
                {selected && (
                  <View style={styles.checkBadge}>
                    <Ionicons name="checkmark" size={12} color="#050C09" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Goals */}
        <Text style={styles.sectionLabel}>Set your goals</Text>
        <View style={styles.goalsRow}>
          <View style={styles.goalInput}>
            <Text style={styles.goalLabel}>Monthly Miles</Text>
            <TextInput
              style={styles.input}
              value={monthlyGoal}
              onChangeText={setMonthlyGoal}
              keyboardType="numeric"
              placeholder="50"
              placeholderTextColor="#3D6B52"
              selectTextOnFocus
            />
          </View>
          <View style={styles.goalInput}>
            <Text style={styles.goalLabel}>Annual Miles</Text>
            <TextInput
              style={styles.input}
              value={yearlyGoal}
              onChangeText={setYearlyGoal}
              keyboardType="numeric"
              placeholder="500"
              placeholderTextColor="#3D6B52"
              selectTextOnFocus
            />
          </View>
        </View>

        {/* Invite friends */}
        <TouchableOpacity style={styles.inviteCard} onPress={handleInvite} activeOpacity={0.8}>
          <View style={styles.inviteIconWrap}>
            <Ionicons name="share-outline" size={22} color="#00D97E" />
          </View>
          <View style={styles.inviteText}>
            <Text style={styles.inviteHeadline}>Better together</Text>
            <Text style={styles.inviteBody}>Invite your friends to move with you</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#3D6B52" />
        </TouchableOpacity>

        {/* Error message */}
        {saveError !== null && (
          <Text style={styles.errorText}>{saveError}</Text>
        )}

        {/* CTA */}
        <TouchableOpacity
          style={[styles.ctaBtn, loading && styles.ctaBtnDisabled]}
          onPress={handleGetStarted}
          activeOpacity={0.85}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#050C09" />
          ) : (
            <Text style={styles.ctaLabel}>Let's Go →</Text>
          )}
        </TouchableOpacity>

        {/* Skip */}
        <TouchableOpacity onPress={handleSkip} style={styles.skipBtn}>
          <Text style={styles.skipLabel}>Skip for now</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#050C09",
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 32,
  },
  logoText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 22,
    letterSpacing: 3,
    color: "#FFFFFF",
  },
  logoGreen: {
    color: "#00D97E",
  },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#0A1F14",
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#1A3D22",
    alignSelf: "flex-start",
    marginBottom: 20,
  },
  verifiedBadgeText: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: "#00D97E",
  },
  welcome: {
    fontFamily: "Outfit_700Bold",
    fontSize: 30,
    color: "#FFFFFF",
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: "Outfit_400Regular",
    fontSize: 16,
    color: "#6FAB84",
    marginBottom: 32,
  },
  sectionLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: "#6FAB84",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  activityRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 32,
  },
  activityCard: {
    flex: 1,
    backgroundColor: "#0D1510",
    borderRadius: 16,
    paddingVertical: 20,
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#1A2E20",
    position: "relative",
  },
  activityCardSelected: {
    borderColor: "#00D97E",
    backgroundColor: "#0F1F14",
  },
  activityEmoji: {
    fontSize: 28,
    marginBottom: 8,
  },
  activityLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: "#6FAB84",
  },
  activityLabelSelected: {
    color: "#00D97E",
  },
  checkBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#00D97E",
    alignItems: "center",
    justifyContent: "center",
  },
  goalsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 24,
  },
  goalInput: {
    flex: 1,
  },
  goalLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: "#6FAB84",
    marginBottom: 6,
  },
  input: {
    backgroundColor: "#0D1510",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#1A2E20",
    color: "#FFFFFF",
    fontFamily: "Outfit_600SemiBold",
    fontSize: 20,
    paddingVertical: 14,
    paddingHorizontal: 16,
    textAlign: "center",
  },
  inviteCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0D1510",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#1A2E20",
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 32,
    gap: 12,
  },
  inviteIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#132019",
    alignItems: "center",
    justifyContent: "center",
  },
  inviteText: {
    flex: 1,
  },
  inviteHeadline: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
    color: "#FFFFFF",
    marginBottom: 2,
  },
  inviteBody: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: "#6FAB84",
  },
  ctaBtn: {
    backgroundColor: "#00D97E",
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: "center",
    marginBottom: 16,
  },
  ctaBtnDisabled: {
    opacity: 0.7,
  },
  ctaLabel: {
    fontFamily: "Outfit_700Bold",
    fontSize: 17,
    color: "#050C09",
    letterSpacing: 0.3,
  },
  skipBtn: {
    alignItems: "center",
    paddingVertical: 8,
  },
  skipLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: "#3D6B52",
  },
  errorText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: "#FF6B35",
    textAlign: "center",
    marginBottom: 12,
  },
});
