import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Platform,
  Alert,
  Linking,
  ActivityIndicator,
  Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons, FontAwesome5 } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { router } from "expo-router";
import { usePurchases } from "@/contexts/PurchasesContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
  onSignOut: () => void;
}

type Privacy = "public" | "friends" | "private";
type Unit = "miles" | "km";

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ label, C }: { label: string; C: any }) {
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 28, paddingBottom: 8 }}>
      <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 11, color: C.primary, letterSpacing: 1.5, textTransform: "uppercase" }}>
        {label}
      </Text>
    </View>
  );
}

function SettingRow({
  icon,
  iconBg,
  label,
  sublabel,
  right,
  onPress,
  danger,
  C,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  sublabel?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
  C: any;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 20,
          paddingVertical: 13,
          backgroundColor: pressed && onPress ? C.card + "80" : "transparent",
          gap: 14,
        },
      ]}
      onPress={onPress}
      disabled={!onPress && !right}
    >
      <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: iconBg, alignItems: "center", justifyContent: "center" }}>
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: danger ? "#FF4D4D" : C.text }}>
          {label}
        </Text>
        {sublabel && (
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, marginTop: 1 }}>
            {sublabel}
          </Text>
        )}
      </View>
      {right ?? (onPress ? <Feather name="chevron-right" size={16} color={C.textMuted} /> : null)}
    </Pressable>
  );
}

function Divider({ C }: { C: any }) {
  return <View style={{ height: 1, backgroundColor: C.border, marginHorizontal: 20 }} />;
}

function SectionCard({ children, C }: { children: React.ReactNode; C: any }) {
  return (
    <View style={{ backgroundColor: C.card, marginHorizontal: 16, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: "hidden" }}>
      {children}
    </View>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SettingsModal({ visible, onClose, onSignOut }: Props) {
  const insets = useSafeAreaInsets();
  const { C, theme, toggleTheme } = useTheme();
  const { user, refreshUser } = useAuth();
  const qc = useQueryClient();
  const { restorePurchases, isReady: purchasesReady } = usePurchases();
  const [restoringPurchases, setRestoringPurchases] = useState(false);

  const distanceUnit: Unit = (user as any)?.distance_unit ?? "miles";
  const profilePrivacy: Privacy = (user as any)?.profile_privacy ?? "public";
  const notifEnabled: boolean = user?.notifications_enabled ?? true;
  const notifRunReminders: boolean = (user as any)?.notif_run_reminders ?? true;
  const notifFriendRequests: boolean = (user as any)?.notif_friend_requests ?? true;
  const notifCrewActivity: boolean = (user as any)?.notif_crew_activity ?? true;
  const notifWeeklySummary: boolean = (user as any)?.notif_weekly_summary ?? true;
  const showRunRoutes: boolean = (user as any)?.show_run_routes ?? true;

  const stravaConnected = !!(user as any)?.strava_id;
  const appleHealthConnected = !!(user as any)?.apple_health_connected;
  const healthConnectConnected = !!(user as any)?.health_connect_connected;

  const { data: garminStatus, refetch: refetchGarmin } = useQuery<{ connected: boolean; lastSync: string | null }>({
    queryKey: ["/api/garmin/status"],
    enabled: visible,
  });
  const garminConnected = garminStatus?.connected ?? false;
  const garminLastSync = garminStatus?.lastSync ? new Date(garminStatus.lastSync) : null;

  const [updatingField, setUpdatingField] = useState<string | null>(null);
  const [showTerms, setShowTerms] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [garminSyncing, setGarminSyncing] = useState(false);
  const [garminSyncMsg, setGarminSyncMsg] = useState<string | null>(null);

  // Listen for the deep link fired after Garmin OAuth completes in the in-app browser.
  // The callback page redirects to paceup://garmin-connected which triggers this listener.
  useEffect(() => {
    const sub = Linking.addEventListener("url", ({ url }) => {
      if (url.startsWith("paceup://garmin-connected")) {
        refetchGarmin().then(() => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        });
      }
    });
    return () => sub.remove();
  }, [refetchGarmin]);

  const updateUser = useCallback(async (updates: Record<string, any>, fieldKey: string) => {
    setUpdatingField(fieldKey);
    try {
      await apiRequest("PUT", "/api/users/me", updates);
      await refreshUser();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not save setting");
    } finally {
      setUpdatingField(null);
    }
  }, [refreshUser]);

  // ─── Social connect handlers ───────────────────────────────────────────────

  function handleConnectStrava() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      "Strava — Coming Soon",
      "Strava integration is coming in a future update. You'll be able to import activities and sync your training data.",
      [{ text: "Got it" }]
    );
  }

  const [healthSyncing, setHealthSyncing] = useState(false);
  const [healthSyncMsg, setHealthSyncMsg] = useState<string | null>(null);

  const [hcSyncing, setHcSyncing] = useState(false);
  const [hcSyncMsg, setHcSyncMsg] = useState<string | null>(null);

  async function handleConnectAppleHealth() {
    if (Platform.OS !== "ios" || Platform.isPad) {
      Alert.alert("Apple Health", "Apple Health is only available on iPhone, not iPad.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (appleHealthConnected) {
      Alert.alert(
        "Disconnect Apple Health",
        "Stop syncing workouts with Apple Health? Your imported activities will remain.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Disconnect",
            style: "destructive",
            onPress: async () => {
              try {
                await apiRequest("PUT", "/api/users/me", { appleHealthConnected: false });
                await refreshUser();
                setHealthSyncMsg(null);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } catch (e: any) {
                Alert.alert("Error", e.message || "Could not disconnect Apple Health.");
              }
            },
          },
        ]
      );
      return;
    }
    const { isHealthKitAvailable, requestHealthKitPermissions } = require("@/lib/healthKit");
    if (!isHealthKitAvailable()) {
      Alert.alert("Apple Health", "Apple Health is not available on this device.");
      return;
    }
    try {
      const granted = await requestHealthKitPermissions();
      if (!granted) {
        Alert.alert(
          "Permission Denied",
          "PaceUp needs access to Apple Health to import your workouts.\n\nGo to Settings → Privacy & Security → Health → PaceUp and allow access.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openURL("app-settings:").catch(() => {}) },
          ]
        );
        return;
      }
      await apiRequest("PUT", "/api/users/me", { appleHealthConnected: true });
      await refreshUser();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Connected!", "Apple Health is now connected. Tap Sync to import your workouts.");
    } catch (e: any) {
      const msg = e?.message ?? "";
      if (msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("denied") || msg.toLowerCase().includes("authoriz")) {
        Alert.alert(
          "Permission Denied",
          "PaceUp needs access to Apple Health.\n\nGo to Settings → Privacy & Security → Health → PaceUp and allow access.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openURL("app-settings:").catch(() => {}) },
          ]
        );
      } else {
        Alert.alert("Apple Health", msg || "Could not connect to Apple Health. Please try again.");
      }
    }
  }

  async function handleHealthSync() {
    if (healthSyncing) return;
    setHealthSyncing(true);
    setHealthSyncMsg(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const { isHealthKitAvailable, requestHealthKitPermissions, fetchWorkouts } = require("@/lib/healthKit");
      if (!isHealthKitAvailable()) {
        setHealthSyncMsg("Apple Health is not available on this device.");
        return;
      }
      try {
        await requestHealthKitPermissions();
      } catch (initErr: any) {
        setHealthSyncMsg(`Could not access Health: ${initErr?.message ?? "permission denied"}`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      const workouts = await fetchWorkouts(90);
      setHealthSyncing(false);

      if (workouts.length === 0) {
        setHealthSyncMsg("No workouts found in the last 90 days.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }

      const runs = workouts.filter((w: any) => w.activityType === "run").length;
      const rides = workouts.filter((w: any) => w.activityType === "ride").length;
      const walks = workouts.filter((w: any) => w.activityType === "walk").length;
      const devices = [...new Set(workouts.map((w: any) => w.sourceName).filter(Boolean))];

      const breakdown: string[] = [];
      if (runs > 0) breakdown.push(`${runs} run${runs !== 1 ? "s" : ""}`);
      if (rides > 0) breakdown.push(`${rides} ride${rides !== 1 ? "s" : ""}`);
      if (walks > 0) breakdown.push(`${walks} walk${walks !== 1 ? "s" : ""}`);
      const breakdownStr = breakdown.join(", ");
      const sourceStr = devices.length > 0 ? `\nSources: ${devices.slice(0, 3).join(", ")}` : "";

      await new Promise<void>((resolve, reject) => {
        Alert.alert(
          `Found ${workouts.length} Workout${workouts.length !== 1 ? "s" : ""}`,
          `${breakdownStr} from the last 90 days.${sourceStr}\n\nImport all into PaceUp?`,
          [
            { text: "Cancel", style: "cancel", onPress: () => reject(new Error("cancelled")) },
            { text: "Import All", onPress: () => resolve() },
          ]
        );
      });

      setHealthSyncing(true);
      const resp = await apiRequest("POST", "/api/health/import", { workouts });
      const data = await resp.json();
      const msg = data.imported > 0
        ? `${data.imported} new activit${data.imported === 1 ? "y" : "ies"} imported!`
        : "All activities already synced.";
      setHealthSyncMsg(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["/api/solo-runs"] });
    } catch (e: any) {
      if (e?.message !== "cancelled") {
        setHealthSyncMsg(`Sync failed: ${e.message}`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setHealthSyncing(false);
    }
  }

  async function handleConnectGarmin() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (garminConnected) {
      Alert.alert(
        "Disconnect Garmin",
        "Remove your Garmin account from PaceUp? Your imported activities will remain.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Disconnect",
            style: "destructive",
            onPress: async () => {
              try {
                await apiRequest("POST", "/api/garmin/disconnect", {});
                await refetchGarmin();
                setGarminSyncMsg(null);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } catch (e: any) {
                Alert.alert("Error", e.message || "Could not disconnect Garmin.");
              }
            },
          },
        ]
      );
      return;
    }
    try {
      const base = getApiUrl();
      const resp = await fetch(new URL("/api/garmin/auth", base).toString(), { credentials: "include" });
      const data = await resp.json();
      if (!resp.ok) {
        Alert.alert("Garmin Connect", data.message || "Could not start Garmin authorization.");
        return;
      }
      const { authUrl } = data;
      await WebBrowser.openBrowserAsync(authUrl);
      await refetchGarmin();
      if (garminStatus?.connected) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not open Garmin authorization.");
    }
  }

  async function handleGarminSync() {
    if (garminSyncing) return;
    setGarminSyncing(true);
    setGarminSyncMsg(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const base = getApiUrl();
      const resp = await fetch(new URL("/api/garmin/sync", base).toString(), { method: "POST", credentials: "include" });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.message || "Sync failed");
      const msg = data.imported > 0 ? `${data.imported} new activit${data.imported === 1 ? "y" : "ies"} imported!` : "All activities already synced.";
      setGarminSyncMsg(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["/api/solo-runs"] });
    } catch (e: any) {
      setGarminSyncMsg(`Sync failed: ${e.message}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setGarminSyncing(false);
    }
  }

  async function handleConnectHealthConnect() {
    if (Platform.OS !== "android") return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (healthConnectConnected) {
      Alert.alert(
        "Disconnect Health Connect",
        "Stop syncing workouts with Google Health Connect? Your imported activities will remain.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Disconnect",
            style: "destructive",
            onPress: async () => {
              try {
                await apiRequest("PUT", "/api/users/me", { healthConnectConnected: false });
                await refreshUser();
                setHcSyncMsg(null);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } catch (e: any) {
                Alert.alert("Error", e.message || "Could not disconnect Health Connect.");
              }
            },
          },
        ]
      );
      return;
    }
    const { isHealthConnectAvailable, getHealthConnectSdkStatus, requestHealthConnectPermissions } = require("@/lib/healthConnect");
    if (!isHealthConnectAvailable()) {
      Alert.alert("Health Connect", "Google Health Connect is not available on this device. Install it from the Play Store to use this feature.");
      return;
    }
    const sdkStatus = await getHealthConnectSdkStatus();
    if (sdkStatus === "update_required") {
      Alert.alert(
        "Health Connect Update Required",
        "Please update the Google Health Connect app from the Play Store to continue.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Play Store", onPress: () => Linking.openURL("market://details?id=com.google.android.apps.healthdata").catch(() => Linking.openURL("https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata")) },
        ]
      );
      return;
    }
    if (sdkStatus === "unavailable") {
      Alert.alert(
        "Health Connect Not Installed",
        "Google Health Connect is required to sync with Samsung Health and other fitness apps. Install it from the Play Store.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Install", onPress: () => Linking.openURL("market://details?id=com.google.android.apps.healthdata").catch(() => Linking.openURL("https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata")) },
        ]
      );
      return;
    }
    try {
      const granted = await requestHealthConnectPermissions();
      if (!granted) {
        Alert.alert(
          "Permission Denied",
          "PaceUp needs access to Health Connect to import your workouts.\n\nOpen Health Connect and allow access for PaceUp.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Open Settings", onPress: () => {
              try { require("react-native-health-connect").openHealthConnectSettings(); } catch {}
            }},
          ]
        );
        return;
      }
      await apiRequest("PUT", "/api/users/me", { healthConnectConnected: true });
      await refreshUser();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Connected!", "Google Health Connect is now connected. Tap Sync to import your workouts.");
    } catch (e: any) {
      Alert.alert("Health Connect", e.message || "Could not connect to Health Connect. Please try again.");
    }
  }

  async function handleHealthConnectSync() {
    if (hcSyncing) return;
    setHcSyncing(true);
    setHcSyncMsg(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const { isHealthConnectAvailable, getHealthConnectSdkStatus, requestHealthConnectPermissions, fetchHealthConnectWorkouts } = require("@/lib/healthConnect");
      if (!isHealthConnectAvailable()) {
        setHcSyncMsg("Health Connect is not available on this device.");
        return;
      }
      const sdkStatus = await getHealthConnectSdkStatus();
      if (sdkStatus !== "available" && sdkStatus !== "unknown") {
        setHcSyncMsg(sdkStatus === "update_required" ? "Update Health Connect from the Play Store to sync." : "Install Google Health Connect from the Play Store.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }
      let granted: boolean;
      try {
        granted = await requestHealthConnectPermissions();
      } catch (initErr: any) {
        setHcSyncMsg(`Could not access Health Connect: ${initErr?.message ?? "permission denied"}`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }
      if (!granted) {
        setHcSyncing(false);
        setHcSyncMsg("Permission denied — open Health Connect to allow PaceUp access.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      }

      const workouts = await fetchHealthConnectWorkouts(90);
      setHcSyncing(false);

      if (workouts.length === 0) {
        setHcSyncMsg("No workouts found in the last 90 days.");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }

      const runs = workouts.filter((w: any) => w.activityType === "run").length;
      const rides = workouts.filter((w: any) => w.activityType === "ride").length;
      const walks = workouts.filter((w: any) => w.activityType === "walk").length;
      const breakdown: string[] = [];
      if (runs > 0) breakdown.push(`${runs} run${runs !== 1 ? "s" : ""}`);
      if (rides > 0) breakdown.push(`${rides} ride${rides !== 1 ? "s" : ""}`);
      if (walks > 0) breakdown.push(`${walks} walk${walks !== 1 ? "s" : ""}`);

      await new Promise<void>((resolve, reject) => {
        Alert.alert(
          `Found ${workouts.length} Workout${workouts.length !== 1 ? "s" : ""}`,
          `${breakdown.join(", ")} from the last 90 days.\n\nImport all into PaceUp?`,
          [
            { text: "Cancel", style: "cancel", onPress: () => reject(new Error("cancelled")) },
            { text: "Import All", onPress: () => resolve() },
          ]
        );
      });

      setHcSyncing(true);
      const resp = await apiRequest("POST", "/api/health/import", { workouts, source: "health_connect" });
      const data = await resp.json();
      const msg = data.imported > 0
        ? `${data.imported} new activit${data.imported === 1 ? "y" : "ies"} imported!`
        : "All activities already synced.";
      setHcSyncMsg(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      qc.invalidateQueries({ queryKey: ["/api/solo-runs"] });
    } catch (e: any) {
      if (e?.message !== "cancelled") {
        setHcSyncMsg(`Sync failed: ${e.message}`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setHcSyncing(false);
    }
  }

  function handleConnectSocial(name: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      `Connect ${name}`,
      `Share your PaceUp activities directly to ${name}. Full integration coming soon!`,
      [{ text: "OK" }]
    );
  }

  function handleDeleteAccount() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      "Delete Account",
      "This will permanently delete your account, all your activities, crews, and data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Account",
          style: "destructive",
          onPress: () =>
            Alert.alert("Final confirmation", "All your data will be permanently deleted. Are you absolutely sure?", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Yes, Delete Everything",
                style: "destructive",
                onPress: async () => {
                  try {
                    await apiRequest("DELETE", "/api/users/me", undefined);
                    onClose();
                    onSignOut();
                  } catch (e: any) {
                    Alert.alert("Error", e.message || "Could not delete account. Please try again.");
                  }
                },
              },
            ]),
        },
      ]
    );
  }

  function handleChangePassword() {
    Alert.alert(
      "Change Password",
      "To reset your password, email us at support@paceupapp.com with your account username and we'll send you a reset link.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Email Support", onPress: () => Linking.openURL("mailto:support@paceupapp.com?subject=Password%20Reset%20Request").catch(() => {}) },
      ]
    );
  }

  async function handleRestorePurchases() {
    if (restoringPurchases) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRestoringPurchases(true);
    try {
      await restorePurchases();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Purchases Restored", "Your subscriptions have been restored successfully.");
    } catch {
      Alert.alert("Restore Failed", "Could not restore purchases. Make sure you're signed in to the same Apple ID used for the original purchase.");
    } finally {
      setRestoringPurchases(false);
    }
  }

  const privacyLabel: Record<Privacy, string> = {
    public: "Public",
    friends: "Friends Only",
    private: "Private",
  };

  function handlePrivacyPicker() {
    const options: Privacy[] = ["public", "friends", "private"];
    Alert.alert(
      "Profile Visibility",
      "Who can see your profile and activity history?",
      [
        ...options.map((opt) => ({
          text: (opt === profilePrivacy ? "✓ " : "") + privacyLabel[opt],
          onPress: () => updateUser({ profilePrivacy: opt }, "profilePrivacy"),
        })),
        { text: "Cancel", style: "cancel" },
      ]
    );
  }

  // ─── Toggle helper ─────────────────────────────────────────────────────────

  function Toggle({ value, fieldKey, onToggle }: { value: boolean; fieldKey: string; onToggle: () => void }) {
    const isLoading = updatingField === fieldKey;
    if (isLoading) return <ActivityIndicator size="small" color={C.primary} />;
    return (
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: C.border, true: C.primary + "88" }}
        thumbColor={value ? C.primary : C.textMuted}
        ios_backgroundColor={C.border}
      />
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[st.container, { backgroundColor: C.bg }]}>
        {/* Header */}
        <View style={[st.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16), borderBottomColor: C.border }]}>
          <View style={{ width: 40 }} />
          <Text style={[st.headerTitle, { color: C.text }]}>Settings</Text>
          <Pressable onPress={onClose} hitSlop={12} style={[st.closeBtn, { backgroundColor: C.card, borderColor: C.border }]}>
            <Feather name="x" size={18} color={C.textSecondary} />
          </Pressable>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 40) }}
        >
          {/* ── APPEARANCE ───────────────────────────────────────────────── */}
          <SectionHeader label="Appearance" C={C} />
          <SectionCard C={C}>
            <SettingRow
              C={C}
              iconBg={theme === "dark" ? "#1C2E3A" : "#FFF8E1"}
              icon={<Feather name={theme === "dark" ? "moon" : "sun"} size={18} color={theme === "dark" ? "#4DA6FF" : "#FFB800"} />}
              label={theme === "dark" ? "Dark Mode" : "Light Mode"}
              sublabel={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              right={
                <Switch
                  value={theme === "dark"}
                  onValueChange={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleTheme(); }}
                  trackColor={{ false: C.border, true: "#4DA6FF88" }}
                  thumbColor={theme === "dark" ? "#4DA6FF" : C.textMuted}
                  ios_backgroundColor={C.border}
                />
              }
            />
            <Divider C={C} />
            <SettingRow
              C={C}
              iconBg={C.primary + "22"}
              icon={<Feather name="activity" size={18} color={C.primary} />}
              label="Distance Units"
              sublabel={distanceUnit === "miles" ? "Showing miles" : "Showing kilometers"}
              right={
                <Toggle
                  value={distanceUnit === "km"}
                  fieldKey="distanceUnit"
                  onToggle={() => updateUser({ distanceUnit: distanceUnit === "miles" ? "km" : "miles" }, "distanceUnit")}
                />
              }
            />
          </SectionCard>

          {/* ── NOTIFICATIONS ────────────────────────────────────────────── */}
          <SectionHeader label="Notifications" C={C} />
          <SectionCard C={C}>
            <SettingRow
              C={C}
              iconBg="#1A2E1A"
              icon={<Ionicons name="notifications" size={18} color={C.primary} />}
              label="Push Notifications"
              sublabel="Master toggle for all alerts"
              right={
                <Toggle
                  value={notifEnabled}
                  fieldKey="notificationsEnabled"
                  onToggle={() => updateUser({ notificationsEnabled: !notifEnabled }, "notificationsEnabled")}
                />
              }
            />
            <Divider C={C} />
            <SettingRow
              C={C}
              iconBg="#1A1A2E"
              icon={<Feather name="clock" size={17} color="#9B7FFF" />}
              label="Reminders"
              sublabel="Upcoming scheduled workouts"
              right={
                <Toggle
                  value={notifEnabled && notifRunReminders}
                  fieldKey="notifRunReminders"
                  onToggle={() => updateUser({ notifRunReminders: !notifRunReminders }, "notifRunReminders")}
                />
              }
            />
            <Divider C={C} />
            <SettingRow
              C={C}
              iconBg="#1A2A1A"
              icon={<Feather name="user-plus" size={17} color="#00D97E" />}
              label="Friend Requests"
              sublabel="New friend requests and acceptances"
              right={
                <Toggle
                  value={notifEnabled && notifFriendRequests}
                  fieldKey="notifFriendRequests"
                  onToggle={() => updateUser({ notifFriendRequests: !notifFriendRequests }, "notifFriendRequests")}
                />
              }
            />
            <Divider C={C} />
            <SettingRow
              C={C}
              iconBg="#2A1A1A"
              icon={<Ionicons name="people" size={17} color="#FFB800" />}
              label="Crew Activity"
              sublabel="New events from your crews"
              right={
                <Toggle
                  value={notifEnabled && notifCrewActivity}
                  fieldKey="notifCrewActivity"
                  onToggle={() => updateUser({ notifCrewActivity: !notifCrewActivity }, "notifCrewActivity")}
                />
              }
            />
            <Divider C={C} />
            <SettingRow
              C={C}
              iconBg="#1A2A2A"
              icon={<Feather name="bar-chart-2" size={17} color="#4DA6FF" />}
              label="Weekly Summary"
              sublabel="Your progress and highlights each week"
              right={
                <Toggle
                  value={notifEnabled && notifWeeklySummary}
                  fieldKey="notifWeeklySummary"
                  onToggle={() => updateUser({ notifWeeklySummary: !notifWeeklySummary }, "notifWeeklySummary")}
                />
              }
            />
          </SectionCard>

          {/* ── PRIVACY ──────────────────────────────────────────────────── */}
          <SectionHeader label="Privacy" C={C} />
          <SectionCard C={C}>
            <SettingRow
              C={C}
              iconBg="#1C1A2E"
              icon={<Feather name={profilePrivacy === "public" ? "globe" : profilePrivacy === "friends" ? "users" : "lock"} size={17} color="#9B7FFF" />}
              label="Profile Visibility"
              sublabel={privacyLabel[profilePrivacy]}
              onPress={handlePrivacyPicker}
            />
            <Divider C={C} />
            <SettingRow
              C={C}
              iconBg="#1A1A1A"
              icon={<Feather name="map-pin" size={17} color={C.textMuted} />}
              label="Show Routes"
              sublabel={showRunRoutes ? "Friends can see your GPS route maps" : "Route maps hidden from others"}
              right={
                <Toggle
                  value={showRunRoutes}
                  fieldKey="showRunRoutes"
                  onToggle={() => updateUser({ showRunRoutes: !showRunRoutes }, "showRunRoutes")}
                />
              }
            />
          </SectionCard>

          {/* ── CONNECTED ACCOUNTS ───────────────────────────────────────── */}
          <SectionHeader label="Connected Accounts" C={C} />
          <SectionCard C={C}>
            {/* Strava */}
            <SettingRow
              C={C}
              iconBg="#3A1A0A"
              icon={<FontAwesome5 name="strava" size={18} color="#FC4C02" />}
              label="Strava"
              sublabel="Coming soon"
              right={
                <Pressable
                  style={[st.connectBtn, { borderColor: C.border, backgroundColor: C.surface, opacity: 0.5 }]}
                  onPress={handleConnectStrava}
                >
                  <Text style={[st.connectBtnTxt, { color: C.textMuted }]}>
                    Soon
                  </Text>
                </Pressable>
              }
            />
            <Divider C={C} />

            {/* Apple Health — iOS only */}
            {Platform.OS !== "android" && (
              <>
                <SettingRow
                  C={C}
                  iconBg="#2A0A0A"
                  icon={<Ionicons name="heart" size={18} color="#FF3B30" />}
                  label="Apple Health"
                  sublabel={appleHealthConnected ? (healthSyncMsg ?? "Connected — tap Sync to import workouts") : "Import runs, rides & walks from Health"}
                  right={
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {appleHealthConnected && (
                        <Pressable
                          style={[st.connectBtn, { borderColor: "#FF3B30", backgroundColor: "#FF3B3022" }]}
                          onPress={handleHealthSync}
                          disabled={healthSyncing}
                        >
                          {healthSyncing
                            ? <ActivityIndicator size="small" color="#FF3B30" />
                            : <Text style={[st.connectBtnTxt, { color: "#FF3B30" }]}>Sync</Text>
                          }
                        </Pressable>
                      )}
                      <Pressable
                        style={[st.connectBtn, { borderColor: appleHealthConnected ? "#FF4D4D" : C.border, backgroundColor: appleHealthConnected ? "#FF4D4D22" : C.surface }]}
                        onPress={handleConnectAppleHealth}
                      >
                        <Text style={[st.connectBtnTxt, { color: appleHealthConnected ? "#FF4D4D" : C.textSecondary }]}>
                          {appleHealthConnected ? "Disconnect" : "Connect"}
                        </Text>
                      </Pressable>
                    </View>
                  }
                />
                <Divider C={C} />
              </>
            )}

            {/* Google Health Connect — Android only */}
            {Platform.OS === "android" && (
              <>
                <SettingRow
                  C={C}
                  iconBg="#0A2A1A"
                  icon={<FontAwesome5 name="heartbeat" size={16} color="#4CAF50" />}
                  label="Health Connect"
                  sublabel={healthConnectConnected ? (hcSyncMsg ?? "Connected — tap Sync to import workouts") : "Import from Google / Samsung Health"}
                  right={
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {healthConnectConnected && (
                        <Pressable
                          style={[st.connectBtn, { borderColor: "#4CAF50", backgroundColor: "#4CAF5022" }]}
                          onPress={handleHealthConnectSync}
                          disabled={hcSyncing}
                        >
                          {hcSyncing
                            ? <ActivityIndicator size="small" color="#4CAF50" />
                            : <Text style={[st.connectBtnTxt, { color: "#4CAF50" }]}>Sync</Text>
                          }
                        </Pressable>
                      )}
                      <Pressable
                        style={[st.connectBtn, { borderColor: healthConnectConnected ? "#FF4D4D" : C.border, backgroundColor: healthConnectConnected ? "#FF4D4D22" : C.surface }]}
                        onPress={handleConnectHealthConnect}
                      >
                        <Text style={[st.connectBtnTxt, { color: healthConnectConnected ? "#FF4D4D" : C.textSecondary }]}>
                          {healthConnectConnected ? "Disconnect" : "Connect"}
                        </Text>
                      </Pressable>
                    </View>
                  }
                />
                <Divider C={C} />
              </>
            )}

            {/* Garmin */}
            <SettingRow
              C={C}
              iconBg="#0A1A2A"
              icon={<FontAwesome5 name="satellite-dish" size={15} color="#009CDE" />}
              label="Garmin"
              sublabel={garminConnected ? (garminSyncMsg ?? (garminLastSync ? `Last synced ${garminLastSync.toLocaleDateString()}` : "Connected — tap Sync to import")) : "Sync from your Garmin device"}
              right={
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {garminConnected && (
                    <Pressable
                      style={[st.connectBtn, { borderColor: "#009CDE", backgroundColor: "#009CDE22" }]}
                      onPress={handleGarminSync}
                      disabled={garminSyncing}
                    >
                      {garminSyncing
                        ? <ActivityIndicator size="small" color="#009CDE" />
                        : <Text style={[st.connectBtnTxt, { color: "#009CDE" }]}>Sync</Text>
                      }
                    </Pressable>
                  )}
                  <Pressable
                    style={[st.connectBtn, { borderColor: garminConnected ? "#FF4D4D" : C.border, backgroundColor: garminConnected ? "#FF4D4D22" : C.surface }]}
                    onPress={handleConnectGarmin}
                  >
                    <Text style={[st.connectBtnTxt, { color: garminConnected ? "#FF4D4D" : C.textSecondary }]}>
                      {garminConnected ? "Disconnect" : "Connect"}
                    </Text>
                  </Pressable>
                </View>
              }
            />
            <Divider C={C} />

            {/* Instagram */}
            <SettingRow
              C={C}
              iconBg="#2A0A1A"
              icon={<FontAwesome5 name="instagram" size={18} color="#E1306C" />}
              label="Instagram"
              sublabel="Coming soon"
              right={
                <Pressable style={[st.connectBtn, { borderColor: C.border, backgroundColor: C.surface, opacity: 0.5 }]} onPress={() => handleConnectSocial("Instagram")}>
                  <Text style={[st.connectBtnTxt, { color: C.textMuted }]}>Soon</Text>
                </Pressable>
              }
            />
            <Divider C={C} />

            {/* Facebook */}
            <SettingRow
              C={C}
              iconBg="#0A1A2A"
              icon={<FontAwesome5 name="facebook" size={18} color="#1877F2" />}
              label="Facebook"
              sublabel={(user as any)?.facebook_id ? "Connected" : "Find friends"}
              right={
                (user as any)?.facebook_id ? (
                  <Pressable
                    style={[st.connectBtn, { borderColor: "#E74C3C44", backgroundColor: "#E74C3C11" }]}
                    onPress={async () => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      Alert.alert("Disconnect Facebook", "Remove your Facebook connection?", [
                        { text: "Cancel", style: "cancel" },
                        { text: "Disconnect", style: "destructive", onPress: async () => {
                          try {
                            await apiRequest("DELETE", "/api/auth/facebook/disconnect");
                            qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
                            refreshUser();
                          } catch {}
                        }},
                      ]);
                    }}
                  >
                    <Text style={[st.connectBtnTxt, { color: "#E74C3C" }]}>Disconnect</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={[st.connectBtn, { borderColor: "#1877F244", backgroundColor: "#1877F211" }]}
                    onPress={async () => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      try {
                        const res = await apiRequest("GET", "/api/auth/facebook/start");
                        const data = await res.json();
                        if (data.url) {
                          await WebBrowser.openBrowserAsync(data.url);
                          qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
                          refreshUser();
                        }
                      } catch (e: any) {
                        if (e.message?.includes("501") || e.message?.includes("not configured")) {
                          Alert.alert("Coming Soon", "Facebook integration will be available in a future update.");
                        } else {
                          Alert.alert("Error", e.message || "Could not connect Facebook");
                        }
                      }
                    }}
                  >
                    <Text style={[st.connectBtnTxt, { color: "#1877F2" }]}>Connect</Text>
                  </Pressable>
                )
              }
            />
          </SectionCard>

          {/* ── ACCOUNT ──────────────────────────────────────────────────── */}
          <SectionHeader label="Account" C={C} />
          <SectionCard C={C}>
            <SettingRow
              C={C}
              iconBg="#1A1A2E"
              icon={<Feather name="key" size={17} color="#9B7FFF" />}
              label="Change Password"
              sublabel="Send reset link to your email"
              onPress={handleChangePassword}
            />
            <Divider C={C} />
            <SettingRow
              C={C}
              iconBg="#1A2A1A"
              icon={<Feather name="share-2" size={17} color={C.primary} />}
              label="Invite Friends"
              sublabel="Share PaceUp with your crew"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                const appLink = Platform.OS === "ios"
                  ? "https://apps.apple.com/us/app/paceup-move-together/id6760092871"
                  : "https://paceupapp.com";
                const msg = `Join me on PaceUp — discover group runs & rides! Download it here: ${appLink}`;
                if (Platform.OS === "web") {
                  (navigator as any).clipboard?.writeText(msg);
                  Alert.alert("Copied!", "Invite link copied to clipboard.");
                } else {
                  Share.share({ message: msg, title: "Join PaceUp" }).catch(() => {});
                }
              }}
            />
            <Divider C={C} />
            {Platform.OS !== "web" && (
              <>
                <SettingRow
                  C={C}
                  iconBg="#0A1A2A"
                  icon={<Feather name="star" size={17} color={C.primary} />}
                  label="Subscription Center"
                  sublabel="View plans, manage or restore purchases"
                  onPress={() => {
                    onClose();
                    setTimeout(() => router.push("/subscription-center"), 300);
                  }}
                />
                <Divider C={C} />
                <SettingRow
                  C={C}
                  iconBg="#0A1A2A"
                  icon={restoringPurchases
                    ? <ActivityIndicator size="small" color={C.primary} />
                    : <Feather name="refresh-cw" size={17} color={C.primary} />
                  }
                  label="Restore Purchases"
                  sublabel="Recover crew subscriptions after reinstall"
                  onPress={handleRestorePurchases}
                />
                <Divider C={C} />
              </>
            )}
            <SettingRow
              C={C}
              iconBg="#2A1A0A"
              icon={<Feather name="log-out" size={17} color="#FFB800" />}
              label="Sign Out"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                Alert.alert("Sign Out", "Are you sure you want to sign out?", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Sign Out", style: "destructive", onPress: () => { onClose(); onSignOut(); } },
                ]);
              }}
            />
            <Divider C={C} />
            <SettingRow
              C={C}
              iconBg="#2A0A0A"
              icon={<Feather name="trash-2" size={17} color="#FF4D4D" />}
              label="Delete Account"
              danger
              onPress={handleDeleteAccount}
            />
          </SectionCard>

          {/* ── ABOUT ────────────────────────────────────────────────────── */}
          <SectionHeader label="About" C={C} />
          <SectionCard C={C}>
            <SettingRow
              C={C}
              iconBg={C.primary + "22"}
              icon={<Text style={{ fontFamily: "Outfit_700Bold", fontSize: 13, color: C.primary }}>F</Text>}
              label="Version"
              sublabel="PaceUp v1.0.0"
              right={<View />}
            />
            <Divider C={C} />
            <SettingRow
              C={C}
              iconBg="#1A1A2E"
              icon={<Feather name="file-text" size={17} color="#9B7FFF" />}
              label="Terms of Service"
              onPress={() => setShowTerms(true)}
            />
            <Divider C={C} />
            <SettingRow
              C={C}
              iconBg="#1A1A2E"
              icon={<Feather name="shield" size={17} color="#9B7FFF" />}
              label="Privacy Policy"
              onPress={() => setShowPrivacy(true)}
            />
            <Divider C={C} />
            <SettingRow
              C={C}
              iconBg="#1A2A2A"
              icon={<Feather name="mail" size={17} color="#4DA6FF" />}
              label="Contact Support"
              sublabel="support@paceupapp.com"
              onPress={() => Linking.openURL("mailto:support@paceupapp.com").catch(() => {})}
            />
          </SectionCard>

          <View style={{ height: 20 }} />
        </ScrollView>
      </View>

      {/* ── Terms of Service Modal ────────────────────────────────────────── */}
      <Modal visible={showTerms} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowTerms(false)}>
        <View style={[st.container, { backgroundColor: C.bg }]}>
          <View style={[st.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16), borderBottomColor: C.border }]}>
            <View style={{ width: 40 }} />
            <Text style={[st.headerTitle, { color: C.text }]}>Terms of Service</Text>
            <Pressable onPress={() => setShowTerms(false)} hitSlop={12} style={[st.closeBtn, { backgroundColor: C.card, borderColor: C.border }]}>
              <Feather name="x" size={18} color={C.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 22, color: C.text, marginBottom: 6 }}>Terms of Service</Text>
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, marginBottom: 20 }}>Effective date: January 1, 2025</Text>

            {[
              { title: "1. Acceptance of Terms", body: "By creating an account or using PaceUp, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the app. We may update these terms from time to time; continued use of the app constitutes acceptance of any revised terms." },
              { title: "2. Eligibility", body: "You must be at least 18 years of age to use PaceUp. By using the app, you represent and warrant that you meet this requirement and that all information you provide is accurate and complete." },
              { title: "3. Your Account", body: "You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account. Notify us immediately at support@paceupapp.com if you suspect unauthorized access to your account." },
              { title: "4. Acceptable Use", body: "You agree to use PaceUp only for lawful purposes. You may not: harass, threaten, or harm other users; post false, misleading, or offensive content; spam or send unsolicited messages; impersonate another person; attempt to gain unauthorized access to any part of the app; or use the app for any commercial purpose without our written consent." },
              { title: "5. Content", body: "You retain ownership of content you post on PaceUp (photos, routes, messages). By posting content, you grant PaceUp a non-exclusive, royalty-free license to display and distribute that content within the app. We reserve the right to remove any content that violates these terms or our community standards." },
              { title: "6. Physical Activity Disclaimer", body: "PaceUp facilitates connections between people for physical activities. You acknowledge that participating in runs, rides, and other physical activities carries inherent risk. You participate at your own risk and are responsible for your own safety. PaceUp does not supervise events, verify participants' fitness levels, or assume any liability for injuries or incidents that occur during activities organized through the app." },
              { title: "7. Host Responsibilities", body: "If you host events through PaceUp, you are responsible for planning safe routes, communicating clearly with participants, and ensuring participants are aware of any risks. Hosts are independent organizers and are not employees or agents of PaceUp." },
              { title: "8. Account Suspension", body: "We reserve the right to suspend or terminate your account at any time for violations of these terms, community guidelines, or for any behavior we deem harmful to other users or the PaceUp community." },
              { title: "9. Disclaimer of Warranties", body: "PaceUp is provided \"as is\" without warranty of any kind. We do not guarantee that the app will be available at all times, error-free, or that information provided by other users is accurate. To the fullest extent permitted by law, PaceUp disclaims all warranties, express or implied." },
              { title: "10. Limitation of Liability", body: "To the maximum extent permitted by applicable law, PaceUp and its affiliates shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the app or participation in any events organized through it." },
              { title: "11. Governing Law", body: "These terms shall be governed by the laws of your jurisdiction. Any disputes shall be resolved through binding arbitration or in the courts of competent jurisdiction." },
              { title: "12. Contact", body: "If you have questions about these Terms of Service, please contact us at support@paceupapp.com." },
            ].map((sec, i) => (
              <View key={i} style={{ marginBottom: 20 }}>
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: C.text, marginBottom: 6 }}>{sec.title}</Text>
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, lineHeight: 22 }}>{sec.body}</Text>
              </View>
            ))}

            <Pressable
              onPress={() => setShowTerms(false)}
              style={{ backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 8 }}
            >
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: C.bg }}>Done</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      {/* ── Privacy Policy Modal ──────────────────────────────────────────── */}
      <Modal visible={showPrivacy} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPrivacy(false)}>
        <View style={[st.container, { backgroundColor: C.bg }]}>
          <View style={[st.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16), borderBottomColor: C.border }]}>
            <View style={{ width: 40 }} />
            <Text style={[st.headerTitle, { color: C.text }]}>Privacy Policy</Text>
            <Pressable onPress={() => setShowPrivacy(false)} hitSlop={12} style={[st.closeBtn, { backgroundColor: C.card, borderColor: C.border }]}>
              <Feather name="x" size={18} color={C.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 22, color: C.text, marginBottom: 6 }}>Privacy Policy</Text>
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textMuted, marginBottom: 20 }}>Effective date: January 1, 2025</Text>

            {[
              { title: "1. Information We Collect", body: "We collect information you provide directly, including your name, username, email address, profile photo, and activity preferences. When you use the app's tracking features, we collect GPS location data. We also collect usage data such as which features you use and when." },
              { title: "2. How We Use Your Information", body: "We use your information to: operate and improve the PaceUp app; match you with nearby runs and rides; display your activity history and statistics; send notifications you've opted into; provide customer support; and ensure the safety of our community. We do not use your data for advertising purposes." },
              { title: "3. Location Data", body: "Location access is used solely to show nearby events, enable GPS activity tracking, and display your routes. You can disable location access in your device settings at any time, though this will limit tracking functionality. We do not share your precise location with other users without your consent." },
              { title: "4. Information Sharing", body: "We do not sell your personal information to third parties. We may share data with service providers who help us operate the app (e.g., hosting, database, push notifications), subject to confidentiality agreements. We may disclose information if required by law or to protect the safety of users." },
              { title: "5. Public vs. Private Content", body: "Your profile, activity stats, and runs you host may be visible to other PaceUp users depending on your privacy settings. You can control your profile visibility in Settings. Private runs are only visible to invited participants." },
              { title: "6. Data Retention", body: "We retain your account data for as long as your account is active. If you delete your account, we will delete your personal data within 30 days, except where we are required by law to retain it." },
              { title: "7. Your Rights", body: "You have the right to access, correct, or delete your personal data at any time. You can update your profile information in the app or delete your account in Settings. To request a data export or for any privacy-related inquiries, contact us at support@paceupapp.com." },
              { title: "8. Security", body: "We implement industry-standard security measures to protect your data, including encrypted connections (HTTPS) and secure authentication. No method of transmission over the internet is 100% secure, and we cannot guarantee absolute security." },
              { title: "9. Children's Privacy", body: "PaceUp is not intended for users under the age of 18. We do not knowingly collect personal information from children. If you believe a child has provided us with their information, please contact us and we will delete it promptly." },
              { title: "10. Changes to This Policy", body: "We may update this Privacy Policy from time to time. We will notify you of significant changes via the app or email. Your continued use of PaceUp after changes constitutes acceptance of the revised policy." },
              { title: "11. Contact Us", body: "If you have any questions, concerns, or requests regarding your privacy, please contact us at support@paceupapp.com. We are committed to addressing your concerns promptly." },
            ].map((sec, i) => (
              <View key={i} style={{ marginBottom: 20 }}>
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: C.text, marginBottom: 6 }}>{sec.title}</Text>
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary, lineHeight: 22 }}>{sec.body}</Text>
              </View>
            ))}

            <Pressable
              onPress={() => setShowPrivacy(false)}
              style={{ backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 8 }}
            >
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: C.bg }}>Done</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 17,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  connectBtn: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  connectBtnTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
  },
});
