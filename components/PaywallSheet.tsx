import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
  Platform,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/contexts/ThemeContext";
import { usePurchases } from "@/contexts/PurchasesContext";
import { useQueryClient } from "@tanstack/react-query";

export interface PaywallPlan {
  productId: string;
  entitlementId: string;
  title: string;
  subtitle: string;
  emoji: string;
  color: string;
  fallbackPrice: string;
  features: string[];
}

interface Props {
  visible: boolean;
  onClose: () => void;
  plans: PaywallPlan[];
  crewId?: string;
  onSuccess?: (productId: string) => void;
}

export default function PaywallSheet({ visible, onClose, plans, crewId, onSuccess }: Props) {
  const insets = useSafeAreaInsets();
  const { C } = useTheme();
  const qc = useQueryClient();
  const { purchasePackage, restorePurchases, getPriceString, hasEntitlement } = usePurchases();
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  function getLivePrice(productId: string, fallback: string): string {
    return getPriceString(productId) ?? fallback;
  }

  async function handlePurchase(plan: PaywallPlan) {
    if (hasEntitlement(plan.entitlementId)) return;
    setPurchasing(plan.productId);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const success = await purchasePackage(plan.productId, crewId);
      if (success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (crewId) {
          setTimeout(() => {
            qc.invalidateQueries({ queryKey: ["/api/crews", crewId, "subscription"] });
            qc.invalidateQueries({ queryKey: ["/api/crews"] });
          }, 1500);
        }
        onSuccess?.(plan.productId);
        onClose();
        Alert.alert("Subscribed! 🎉", `${plan.title} is now active.`);
      } else {
        Alert.alert("Purchase Not Completed", "The purchase was cancelled or not completed.");
      }
    } catch {
      Alert.alert("Error", "Something went wrong. Please try again.");
    } finally {
      setPurchasing(null);
    }
  }

  async function handleRestore() {
    setRestoring(true);
    try {
      await restorePurchases();
      if (crewId) {
        qc.invalidateQueries({ queryKey: ["/api/crews", crewId, "subscription"] });
      }
      Alert.alert("Restored", "Your purchases have been restored.");
    } catch {
      Alert.alert("Error", "Could not restore purchases. Please try again.");
    } finally {
      setRestoring(false);
    }
  }

  function openManageSubscriptions() {
    if (Platform.OS === "ios") {
      Linking.openURL("https://apps.apple.com/account/subscriptions");
    } else if (Platform.OS === "android") {
      Linking.openURL("https://play.google.com/store/account/subscriptions");
    }
  }

  const st = makeStyles(C, insets);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={st.container}>
        <View style={st.handle} />

        <View style={st.header}>
          <View style={{ flex: 1 }}>
            <Text style={st.headerPre}>PACEUP</Text>
            <Text style={st.headerTitle}>Crew Plans</Text>
            <Text style={st.headerSub}>Unlock more for your crew</Text>
          </View>
          <Pressable style={st.closeBtn} onPress={onClose} hitSlop={16}>
            <Feather name="x" size={20} color={C.textMuted} />
          </Pressable>
        </View>

        <ScrollView
          style={st.scroll}
          contentContainerStyle={st.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {plans.map((plan) => {
            const active = hasEntitlement(plan.entitlementId);
            const livePrice = getLivePrice(plan.productId, plan.fallbackPrice);
            const isLoading = purchasing === plan.productId;

            return (
              <View key={plan.productId} style={[st.planCard, active && { borderColor: plan.color, borderWidth: 1.5 }]}>
                <View style={st.planCardTop}>
                  <View style={[st.planIconWrap, { backgroundColor: plan.color + "20" }]}>
                    <Text style={st.planEmoji}>{plan.emoji}</Text>
                  </View>
                  <View style={st.planNameWrap}>
                    <View style={st.planTitleRow}>
                      <Text style={st.planTitle}>{plan.title}</Text>
                      {active && (
                        <View style={[st.activePill, { backgroundColor: plan.color + "22" }]}>
                          <Ionicons name="checkmark-circle" size={12} color={plan.color} />
                          <Text style={[st.activePillTxt, { color: plan.color }]}>Active</Text>
                        </View>
                      )}
                    </View>
                    <Text style={st.planPrice}>{livePrice}<Text style={st.planPeriod}>/month</Text></Text>
                  </View>
                </View>

                <View style={st.divider} />

                <View style={st.featuresWrap}>
                  {plan.features.map((f, i) => (
                    <View key={i} style={st.featureRow}>
                      <Ionicons
                        name={active ? "checkmark-circle" : "checkmark-circle-outline"}
                        size={16}
                        color={active ? plan.color : C.textMuted}
                      />
                      <Text style={[st.featureTxt, active && { color: C.text }]}>{f}</Text>
                    </View>
                  ))}
                </View>

                {active ? (
                  <Pressable style={[st.manageBtn, { borderColor: plan.color }]} onPress={openManageSubscriptions}>
                    <Text style={[st.manageBtnTxt, { color: plan.color }]}>Manage Subscription</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={[st.subscribeBtn, { backgroundColor: plan.color }, isLoading && st.subscribeBtnDisabled]}
                    onPress={() => handlePurchase(plan)}
                    disabled={!!purchasing}
                  >
                    {isLoading ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <>
                        <Text style={st.subscribeBtnTxt}>Subscribe — {livePrice}/mo</Text>
                      </>
                    )}
                  </Pressable>
                )}
              </View>
            );
          })}

          <View style={st.footer}>
            <Pressable onPress={handleRestore} disabled={restoring} style={st.restoreBtn}>
              {restoring ? (
                <ActivityIndicator color={C.textMuted} size="small" />
              ) : (
                <Text style={st.restoreTxt}>Restore Purchases</Text>
              )}
            </Pressable>

            <View style={st.legalRow}>
              <Pressable onPress={() => Linking.openURL("https://paceupapp.com/terms")}>
                <Text style={st.legalTxt}>Terms</Text>
              </Pressable>
              <Text style={st.legalDot}>·</Text>
              <Pressable onPress={() => Linking.openURL("https://paceupapp.com/privacy")}>
                <Text style={st.legalTxt}>Privacy</Text>
              </Pressable>
            </View>

            <Text style={st.renewTxt}>
              Subscriptions auto-renew monthly. Cancel anytime in your{" "}
              {Platform.OS === "android" ? "Google Play" : "App Store"} settings.
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function makeStyles(C: any, insets: { top: number; bottom: number }) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: C.bg,
      paddingTop: 12,
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: C.border,
      alignSelf: "center",
      marginBottom: 12,
    },
    header: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingHorizontal: 20,
      paddingBottom: 16,
    },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: C.surface,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 4,
    },
    headerPre: {
      fontFamily: "Outfit_600SemiBold",
      fontSize: 11,
      letterSpacing: 2,
      color: C.primary,
      marginBottom: 4,
    },
    headerTitle: {
      fontFamily: "Outfit_700Bold",
      fontSize: 26,
      color: C.text,
      marginBottom: 2,
    },
    headerSub: {
      fontFamily: "Outfit_400Regular",
      fontSize: 14,
      color: C.textSecondary,
    },
    scroll: { flex: 1 },
    scrollContent: {
      paddingHorizontal: 16,
      paddingBottom: insets.bottom + 24,
      gap: 14,
    },
    planCard: {
      backgroundColor: C.card,
      borderRadius: 18,
      padding: 18,
      borderWidth: 1,
      borderColor: C.border,
      gap: 14,
    },
    planCardTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
    },
    planIconWrap: {
      width: 52,
      height: 52,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    planEmoji: { fontSize: 24 },
    planNameWrap: { flex: 1 },
    planTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 2,
    },
    planTitle: {
      fontFamily: "Outfit_700Bold",
      fontSize: 17,
      color: C.text,
    },
    activePill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 8,
    },
    activePillTxt: {
      fontFamily: "Outfit_600SemiBold",
      fontSize: 11,
    },
    planPrice: {
      fontFamily: "Outfit_700Bold",
      fontSize: 22,
      color: C.text,
    },
    planPeriod: {
      fontFamily: "Outfit_400Regular",
      fontSize: 14,
      color: C.textMuted,
    },
    divider: {
      height: 1,
      backgroundColor: C.border,
    },
    featuresWrap: { gap: 8 },
    featureRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    featureTxt: {
      fontFamily: "Outfit_400Regular",
      fontSize: 14,
      color: C.textSecondary,
      flex: 1,
    },
    subscribeBtn: {
      height: 50,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    subscribeBtnDisabled: { opacity: 0.6 },
    subscribeBtnTxt: {
      fontFamily: "Outfit_700Bold",
      fontSize: 16,
      color: "#fff",
    },
    manageBtn: {
      height: 46,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1.5,
    },
    manageBtnTxt: {
      fontFamily: "Outfit_600SemiBold",
      fontSize: 15,
    },
    footer: {
      alignItems: "center",
      gap: 12,
      paddingTop: 4,
      paddingBottom: 8,
    },
    restoreBtn: {
      paddingVertical: 8,
      paddingHorizontal: 20,
    },
    restoreTxt: {
      fontFamily: "Outfit_600SemiBold",
      fontSize: 14,
      color: C.textMuted,
    },
    legalRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    legalTxt: {
      fontFamily: "Outfit_400Regular",
      fontSize: 12,
      color: C.textMuted,
      textDecorationLine: "underline",
    },
    legalDot: {
      color: C.textMuted,
      fontSize: 12,
    },
    renewTxt: {
      fontFamily: "Outfit_400Regular",
      fontSize: 11,
      color: C.textMuted,
      textAlign: "center",
      paddingHorizontal: 20,
      lineHeight: 16,
    },
  });
}
