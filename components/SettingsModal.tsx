import React, { useState, useCallback } from "react";
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
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons, FontAwesome5 } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/query-client";

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

  const distanceUnit: Unit = (user as any)?.distance_unit ?? "miles";
  const profilePrivacy: Privacy = (user as any)?.profile_privacy ?? "public";
  const notifEnabled: boolean = user?.notifications_enabled ?? true;
  const notifRunReminders: boolean = (user as any)?.notif_run_reminders ?? true;
  const notifFriendRequests: boolean = (user as any)?.notif_friend_requests ?? true;
  const notifCrewActivity: boolean = (user as any)?.notif_crew_activity ?? true;
  const notifWeeklySummary: boolean = (user as any)?.notif_weekly_summary ?? true;

  const stravaConnected = !!(user as any)?.strava_id;
  const appleHealthConnected = !!(user as any)?.apple_health_id;
  const garminConnected = !!(user as any)?.garmin_id;

  const [updatingField, setUpdatingField] = useState<string | null>(null);

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
      stravaConnected ? "Disconnect Strava" : "Connect Strava",
      stravaConnected
        ? "Disconnect your Strava account from FARA?"
        : "Strava sync will import your activities and track performance across both apps. Full integration coming soon!",
      stravaConnected
        ? [{ text: "Cancel", style: "cancel" }, { text: "Disconnect", style: "destructive", onPress: () => Alert.alert("Coming soon", "Strava disconnect will be available in the next update.") }]
        : [{ text: "Cancel", style: "cancel" }, { text: "Connect Strava", onPress: () => Linking.openURL("https://www.strava.com") }]
    );
  }

  function handleConnectAppleHealth() {
    if (Platform.OS !== "ios") {
      Alert.alert("Apple Health", "Apple Health is only available on iPhone.");
      return;
    }
    Alert.alert(
      appleHealthConnected ? "Disconnect Apple Health" : "Connect Apple Health",
      appleHealthConnected
        ? "Stop syncing workouts with Apple Health?"
        : "Sync your FARA runs to Apple Health and get credit for your workouts. Full integration coming soon!",
      [{ text: "Got it", style: "cancel" }]
    );
  }

  function handleConnectGarmin() {
    Alert.alert(
      garminConnected ? "Disconnect Garmin" : "Connect Garmin",
      garminConnected
        ? "Disconnect your Garmin device from FARA?"
        : "Import detailed GPS data and heart rate from your Garmin watch. Full integration coming soon!",
      [{ text: "Got it", style: "cancel" }]
    );
  }

  function handleConnectSocial(name: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      `Connect ${name}`,
      `Share your FARA activities directly to ${name}. Full integration coming soon!`,
      [{ text: "OK" }]
    );
  }

  function handleDeleteAccount() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      "Delete Account",
      "This will permanently delete your account, all your runs, crews, and data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Account",
          style: "destructive",
          onPress: () =>
            Alert.alert("Are you sure?", "All your data will be permanently deleted.", [
              { text: "Cancel", style: "cancel" },
              { text: "Yes, Delete", style: "destructive", onPress: () => Alert.alert("Coming soon", "Account deletion will be available in a future update. Contact support to remove your account.") },
            ]),
        },
      ]
    );
  }

  function handleChangePassword() {
    Alert.alert("Change Password", "A password reset link will be sent to your registered email address.", [
      { text: "Cancel", style: "cancel" },
      { text: "Send Email", onPress: () => Alert.alert("Sent", "Check your inbox for a password reset link.") },
    ]);
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
              label="Run Reminders"
              sublabel="Upcoming scheduled runs"
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
              sublabel="New runs and events from your crews"
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
              label="Show Run Routes"
              sublabel="Friends can see your GPS route maps"
              right={<Feather name="chevron-right" size={16} color={C.textMuted} />}
              onPress={() => Alert.alert("Coming soon", "Route privacy controls are coming in the next update.")}
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
              sublabel={stravaConnected ? "Connected" : "Import activities & routes"}
              right={
                <Pressable
                  style={[st.connectBtn, { borderColor: stravaConnected ? "#FC4C02" : C.border, backgroundColor: stravaConnected ? "#FC4C0222" : C.surface }]}
                  onPress={handleConnectStrava}
                >
                  <Text style={[st.connectBtnTxt, { color: stravaConnected ? "#FC4C02" : C.textSecondary }]}>
                    {stravaConnected ? "Connected" : "Connect"}
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
                  sublabel={appleHealthConnected ? "Connected" : "Sync workouts to Health app"}
                  right={
                    <Pressable
                      style={[st.connectBtn, { borderColor: appleHealthConnected ? "#FF3B30" : C.border, backgroundColor: appleHealthConnected ? "#FF3B3022" : C.surface }]}
                      onPress={handleConnectAppleHealth}
                    >
                      <Text style={[st.connectBtnTxt, { color: appleHealthConnected ? "#FF3B30" : C.textSecondary }]}>
                        {appleHealthConnected ? "Connected" : "Connect"}
                      </Text>
                    </Pressable>
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
              sublabel={garminConnected ? "Connected" : "Sync from your Garmin device"}
              right={
                <Pressable
                  style={[st.connectBtn, { borderColor: garminConnected ? "#009CDE" : C.border, backgroundColor: garminConnected ? "#009CDE22" : C.surface }]}
                  onPress={handleConnectGarmin}
                >
                  <Text style={[st.connectBtnTxt, { color: garminConnected ? "#009CDE" : C.textSecondary }]}>
                    {garminConnected ? "Connected" : "Connect"}
                  </Text>
                </Pressable>
              }
            />
            <Divider C={C} />

            {/* Instagram */}
            <SettingRow
              C={C}
              iconBg="#2A0A1A"
              icon={<FontAwesome5 name="instagram" size={18} color="#E1306C" />}
              label="Instagram"
              sublabel="Share activities to Stories"
              right={
                <Pressable style={[st.connectBtn, { borderColor: C.border, backgroundColor: C.surface }]} onPress={() => handleConnectSocial("Instagram")}>
                  <Text style={[st.connectBtnTxt, { color: C.textSecondary }]}>Connect</Text>
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
              sublabel="Share runs with your friends"
              right={
                <Pressable style={[st.connectBtn, { borderColor: C.border, backgroundColor: C.surface }]} onPress={() => handleConnectSocial("Facebook")}>
                  <Text style={[st.connectBtnTxt, { color: C.textSecondary }]}>Connect</Text>
                </Pressable>
              }
            />
            <Divider C={C} />

            {/* X / Twitter */}
            <SettingRow
              C={C}
              iconBg="#0A0A0A"
              icon={<FontAwesome5 name="twitter" size={17} color={C.text} />}
              label="X (Twitter)"
              sublabel="Post your achievements"
              right={
                <Pressable style={[st.connectBtn, { borderColor: C.border, backgroundColor: C.surface }]} onPress={() => handleConnectSocial("X (Twitter)")}>
                  <Text style={[st.connectBtnTxt, { color: C.textSecondary }]}>Connect</Text>
                </Pressable>
              }
            />
            <Divider C={C} />

            {/* TikTok */}
            <SettingRow
              C={C}
              iconBg="#0A0A0F"
              icon={<FontAwesome5 name="tiktok" size={17} color={C.text} />}
              label="TikTok"
              sublabel="Share run highlights"
              right={
                <Pressable style={[st.connectBtn, { borderColor: C.border, backgroundColor: C.surface }]} onPress={() => handleConnectSocial("TikTok")}>
                  <Text style={[st.connectBtnTxt, { color: C.textSecondary }]}>Connect</Text>
                </Pressable>
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
              sublabel="Share FARA with your running crew"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                const msg = "Join me on FARA — the social running app! Download it here: https://fara.run";
                if (Platform.OS === "web") {
                  navigator.clipboard?.writeText(msg);
                  Alert.alert("Copied!", "Invite link copied to clipboard.");
                } else {
                  import("react-native").then(({ Share }) => Share.share({ message: msg, title: "Join FARA" }));
                }
              }}
            />
            <Divider C={C} />
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
              sublabel="FARA v1.0.0"
              right={<View />}
            />
            <Divider C={C} />
            <SettingRow
              C={C}
              iconBg="#1A1A2E"
              icon={<Feather name="file-text" size={17} color="#9B7FFF" />}
              label="Terms of Service"
              onPress={() => Linking.openURL("https://fara.run/terms")}
            />
            <Divider C={C} />
            <SettingRow
              C={C}
              iconBg="#1A1A2E"
              icon={<Feather name="shield" size={17} color="#9B7FFF" />}
              label="Privacy Policy"
              onPress={() => Linking.openURL("https://fara.run/privacy")}
            />
            <Divider C={C} />
            <SettingRow
              C={C}
              iconBg="#1A2A2A"
              icon={<Feather name="mail" size={17} color="#4DA6FF" />}
              label="Contact Support"
              sublabel="support@fara.run"
              onPress={() => Linking.openURL("mailto:support@fara.run")}
            />
          </SectionCard>

          <View style={{ height: 20 }} />
        </ScrollView>
      </View>
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
