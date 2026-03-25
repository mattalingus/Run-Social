import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Linking,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";
import { usePurchases } from "@/contexts/PurchasesContext";
import { useQueryClient } from "@tanstack/react-query";
import PaywallSheet, { PaywallPlan } from "@/components/PaywallSheet";

const PLANS: PaywallPlan[] = [
  {
    productId: "crew_growth_monthly",
    entitlementId: "crew_growth",
    title: "Crew Growth",
    subtitle: "Unlimited members for your crew",
    emoji: "🚀",
    color: "#4CAF50",
    fallbackPrice: "$1.99",
    features: [
      "Remove the 100-member cap",
      "Priority support",
    ],
  },
  {
    productId: "crew_discovery_boost_monthly",
    entitlementId: "crew_discovery_boost",
    title: "Discovery Boost",
    subtitle: "More visibility on PaceUp",
    emoji: "⚡",
    color: "#FF9800",
    fallbackPrice: "$4.99",
    features: [
      "~30% boost in Suggested Crews",
      "Public events featured on discover",
      "Crew badge on discover page",
    ],
  },
];

const PLAN_LABELS: Record<string, string> = {
  crew_growth: "Crew Growth",
  crew_discovery_boost: "Discovery Boost",
};

const PLAN_COLORS: Record<string, string> = {
  crew_growth: "#4CAF50",
  crew_discovery_boost: "#FF9800",
};

export default function SubscriptionCenterScreen() {
  const insets = useSafeAreaInsets();
  const { C } = useTheme();
  const qc = useQueryClient();
  const { activeEntitlements, hasEntitlement, restorePurchases, refreshEntitlements } = usePurchases();
  const [restoring, setRestoring] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const st = makeStyles(C, insets);

  const activePlans = activeEntitlements.filter((e) => PLAN_LABELS[e]);

  async function handleRestore() {
    setRestoring(true);
    try {
      await restorePurchases();
      qc.invalidateQueries({ queryKey: ["/api/crews"] });
      Alert.alert("Purchases Restored", "Your active subscriptions have been restored.");
    } catch {
      Alert.alert("Error", "Could not restore purchases. If the issue persists, contact support.");
    } finally {
      setRestoring(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshEntitlements();
      qc.invalidateQueries({ queryKey: ["/api/crews"] });
    } finally {
      setRefreshing(false);
    }
  }

  function openManageSubscriptions() {
    if (Platform.OS === "ios") {
      Linking.openURL("https://apps.apple.com/account/subscriptions").catch(() => {});
    } else if (Platform.OS === "android") {
      Linking.openURL("https://play.google.com/store/account/subscriptions").catch(() => {});
    } else {
      Alert.alert(
        "Manage Subscriptions",
        "Open your App Store or Google Play to manage subscriptions."
      );
    }
  }

  function openSupport() {
    Linking.openURL("mailto:support@paceupapp.com?subject=Subscription%20Help").catch(() => {});
  }

  return (
    <View style={[st.container, { backgroundColor: C.bg }]}>
      <View style={[st.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 8) }]}>
        <Pressable onPress={() => router.back()} style={st.backBtn} hitSlop={12}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={[st.headerTitle, { color: C.text }]}>Subscription Center</Text>
        <Pressable onPress={handleRefresh} style={st.refreshBtn} hitSlop={12} disabled={refreshing}>
          {refreshing
            ? <ActivityIndicator size="small" color={C.primary} />
            : <Feather name="refresh-cw" size={18} color={C.textMuted} />
          }
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[st.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={st.section}>
          <Text style={[st.sectionLabel, { color: C.textMuted }]}>ACTIVE PLANS</Text>

          {activePlans.length === 0 ? (
            <View style={[st.emptyCard, { backgroundColor: C.card, borderColor: C.border }]}>
              <Ionicons name="diamond-outline" size={32} color={C.textMuted} />
              <Text style={[st.emptyTitle, { color: C.textSecondary }]}>No active subscriptions</Text>
              <Text style={[st.emptyBody, { color: C.textMuted }]}>
                Upgrade your crew to unlock more features and visibility.
              </Text>
              <Pressable
                style={[st.upgradeBtn, { backgroundColor: C.primary }]}
                onPress={() => setShowPaywall(true)}
              >
                <Text style={[st.upgradeBtnTxt, { color: C.bg }]}>View Plans</Text>
              </Pressable>
            </View>
          ) : (
            activePlans.map((ent) => (
              <View key={ent} style={[st.planCard, { backgroundColor: C.card, borderColor: PLAN_COLORS[ent] + "44" }]}>
                <View style={[st.planIconWrap, { backgroundColor: PLAN_COLORS[ent] + "20" }]}>
                  <Ionicons name="checkmark-circle" size={22} color={PLAN_COLORS[ent]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[st.planName, { color: C.text }]}>{PLAN_LABELS[ent]}</Text>
                  <Text style={[st.planStatus, { color: PLAN_COLORS[ent] }]}>Active · Renews monthly</Text>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={st.section}>
          <Text style={[st.sectionLabel, { color: C.textMuted }]}>MANAGE</Text>

          <View style={[st.menuCard, { backgroundColor: C.card, borderColor: C.border }]}>
            <MenuItem
              icon="credit-card"
              label="Manage Subscriptions"
              sub={Platform.OS === "android" ? "Open Google Play" : "Open App Store"}
              color={C.text}
              mutedColor={C.textMuted}
              borderColor={C.border}
              onPress={openManageSubscriptions}
              showChevron
            />
            <MenuItem
              icon="rotate-ccw"
              label="Restore Purchases"
              sub="Recover active subscriptions after reinstall"
              color={C.text}
              mutedColor={C.textMuted}
              borderColor={C.border}
              onPress={handleRestore}
              loading={restoring}
              isLast
            />
          </View>
        </View>

        <View style={st.section}>
          <Text style={[st.sectionLabel, { color: C.textMuted }]}>SUPPORT</Text>

          <View style={[st.menuCard, { backgroundColor: C.card, borderColor: C.border }]}>
            <MenuItem
              icon="mail"
              label="Contact Support"
              sub="support@paceupapp.com"
              color={C.text}
              mutedColor={C.textMuted}
              borderColor={C.border}
              onPress={openSupport}
              showChevron
            />
            <MenuItem
              icon="file-text"
              label="Terms of Service"
              color={C.text}
              mutedColor={C.textMuted}
              borderColor={C.border}
              onPress={() => Linking.openURL("https://paceupapp.com/terms").catch(() => {})}
              showChevron
            />
            <MenuItem
              icon="shield"
              label="Privacy Policy"
              color={C.text}
              mutedColor={C.textMuted}
              borderColor={C.border}
              onPress={() => Linking.openURL("https://paceupapp.com/privacy").catch(() => {})}
              showChevron
              isLast
            />
          </View>
        </View>

        <Text style={[st.footnote, { color: C.textMuted }]}>
          Subscriptions renew automatically unless cancelled at least 24 hours before the end of the current period.
          Manage or cancel anytime in your {Platform.OS === "android" ? "Google Play" : "App Store"} subscription settings.
        </Text>
      </ScrollView>

      <PaywallSheet
        visible={showPaywall}
        onClose={() => setShowPaywall(false)}
        plans={PLANS}
        onSuccess={() => setShowPaywall(false)}
      />
    </View>
  );
}

interface MenuItemProps {
  icon: string;
  label: string;
  sub?: string;
  color: string;
  mutedColor: string;
  borderColor: string;
  onPress: () => void;
  showChevron?: boolean;
  loading?: boolean;
  isLast?: boolean;
}

function MenuItem({ icon, label, sub, color, mutedColor, borderColor, onPress, showChevron, loading, isLast }: MenuItemProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        itemSt.row,
        !isLast && { borderBottomWidth: 1, borderBottomColor: borderColor },
        pressed && { opacity: 0.6 },
      ]}
    >
      <Feather name={icon as any} size={16} color={mutedColor} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={[itemSt.label, { color }]}>{label}</Text>
        {sub && <Text style={[itemSt.sub, { color: mutedColor }]}>{sub}</Text>}
      </View>
      {loading
        ? <ActivityIndicator size="small" color={mutedColor} />
        : showChevron && <Feather name="chevron-right" size={16} color={mutedColor} />
      }
    </Pressable>
  );
}

const itemSt = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  label: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 15,
  },
  sub: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    marginTop: 1,
  },
});

function makeStyles(C: any, insets: { top: number; bottom: number }) {
  return StyleSheet.create({
    container: { flex: 1 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    backBtn: { width: 40, height: 40, justifyContent: "center" },
    refreshBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "flex-end" },
    headerTitle: {
      fontFamily: "Outfit_700Bold",
      fontSize: 20,
    },
    content: {
      paddingHorizontal: 16,
      gap: 8,
    },
    section: { gap: 8, marginTop: 8 },
    sectionLabel: {
      fontFamily: "Outfit_600SemiBold",
      fontSize: 11,
      letterSpacing: 0.8,
      marginLeft: 4,
    },
    emptyCard: {
      borderRadius: 16,
      borderWidth: 1,
      padding: 24,
      alignItems: "center",
      gap: 8,
    },
    emptyTitle: {
      fontFamily: "Outfit_600SemiBold",
      fontSize: 16,
      marginTop: 4,
    },
    emptyBody: {
      fontFamily: "Outfit_400Regular",
      fontSize: 13,
      textAlign: "center",
      lineHeight: 19,
    },
    upgradeBtn: {
      marginTop: 8,
      paddingHorizontal: 24,
      paddingVertical: 10,
      borderRadius: 12,
    },
    upgradeBtnTxt: {
      fontFamily: "Outfit_700Bold",
      fontSize: 14,
    },
    planCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      borderRadius: 14,
      borderWidth: 1.5,
      padding: 14,
    },
    planIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    planName: {
      fontFamily: "Outfit_700Bold",
      fontSize: 16,
    },
    planStatus: {
      fontFamily: "Outfit_400Regular",
      fontSize: 12,
      marginTop: 2,
    },
    menuCard: {
      borderRadius: 16,
      borderWidth: 1,
      overflow: "hidden",
    },
    footnote: {
      fontFamily: "Outfit_400Regular",
      fontSize: 11,
      lineHeight: 16,
      textAlign: "center",
      marginTop: 8,
      paddingHorizontal: 8,
    },
  });
}
