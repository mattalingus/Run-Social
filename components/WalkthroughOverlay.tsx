import React, { useEffect, useMemo } from "react";
import { View, Text, Pressable, StyleSheet, Dimensions, Platform } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useWalkthrough } from "@/contexts/WalkthroughContext";
import { useTheme } from "@/contexts/ThemeContext";

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get("window");
const TOOLTIP_EST_HEIGHT = 210;
const TOOLTIP_GAP = 14;
const SIDE_PAD = 16;

const TAB_ROUTES: Record<string, string> = {
  discover: "/(tabs)/",
  solo: "/(tabs)/solo",
  crew: "/(tabs)/crew",
  profile: "/(tabs)/profile",
};

export default function WalkthroughOverlay() {
  const {
    isActive, currentStep, totalSteps, currentStepConfig,
    nextStep, prevStep, skipWalkthrough, targetRect,
  } = useWalkthrough();
  const { C, theme } = useTheme();
  const insets = useSafeAreaInsets();

  // Auto-navigate to the step's home tab (or map for map-view).
  useEffect(() => {
    if (!isActive || !currentStepConfig) return;
    if (currentStepConfig.id === "map-view") {
      router.push("/map");
      return;
    }
    const route = TAB_ROUTES[currentStepConfig.tab];
    if (route) router.push(route as any);
  }, [isActive, currentStepConfig?.id, currentStepConfig?.tab]);

  const placement = useMemo(() => {
    if (!currentStepConfig) return null;
    if (currentStepConfig.isFullScreen) {
      return { kind: "center" as const };
    }

    const tabBarH = 90 + insets.bottom;
    const headerH = insets.top + 60;
    const visibleTop = headerH;
    const visibleBottom = SCREEN_H - tabBarH;

    if (!targetRect) {
      // No rect reported (yet). Fall back to configured position.
      const pos = currentStepConfig.tooltipPosition;
      if (pos === "top") return { kind: "top" as const, top: insets.top + 60 };
      if (pos === "bottom") return { kind: "bottom" as const, bottom: insets.bottom + 100 };
      return { kind: "bottom" as const, bottom: insets.bottom + 100 };
    }

    const tY = targetRect.y;
    const tBottom = targetRect.y + targetRect.height;
    const tCenter = targetRect.y + targetRect.height / 2;

    const offscreenAbove = tBottom < visibleTop + 10;
    const offscreenBelow = tY > visibleBottom - 10;

    if (offscreenAbove || offscreenBelow) {
      // Pin at bottom with a scroll hint.
      return {
        kind: "bottom" as const,
        bottom: insets.bottom + 100,
        hint: offscreenAbove ? "up" : ("down" as "up" | "down"),
      };
    }

    // Target on-screen. Place tooltip in whichever half is roomier.
    const spaceAbove = tY - visibleTop;
    const spaceBelow = visibleBottom - tBottom;

    if (spaceBelow >= TOOLTIP_EST_HEIGHT + TOOLTIP_GAP) {
      return {
        kind: "anchor-below" as const,
        top: tBottom + TOOLTIP_GAP,
        pointerX: Math.max(24, Math.min(SCREEN_W - 24, targetRect.x + targetRect.width / 2)),
      };
    }
    if (spaceAbove >= TOOLTIP_EST_HEIGHT + TOOLTIP_GAP) {
      return {
        kind: "anchor-above" as const,
        bottom: SCREEN_H - tY + TOOLTIP_GAP,
        pointerX: Math.max(24, Math.min(SCREEN_W - 24, targetRect.x + targetRect.width / 2)),
      };
    }

    // Not enough room either side — pick the bigger half and overlap slightly.
    if (spaceBelow >= spaceAbove) {
      return { kind: "bottom" as const, bottom: insets.bottom + 100 };
    }
    return { kind: "top" as const, top: insets.top + 60 };
  }, [currentStepConfig, targetRect, insets.top, insets.bottom]);

  if (!isActive || !currentStepConfig || !placement) return null;

  const isFirst = currentStep === 0;
  const isLast = currentStep >= totalSteps - 1;
  const isFullScreen = !!currentStepConfig.isFullScreen;

  const cardStyle: any = { backgroundColor: C.card, borderColor: C.border };
  const positionStyle: any = {};
  if (placement.kind === "center") {
    Object.assign(positionStyle, {
      top: SCREEN_H * 0.28, left: SIDE_PAD, right: SIDE_PAD,
    });
  } else if (placement.kind === "top") {
    Object.assign(positionStyle, { top: (placement as any).top, left: SIDE_PAD, right: SIDE_PAD });
  } else if (placement.kind === "bottom") {
    Object.assign(positionStyle, { bottom: (placement as any).bottom, left: SIDE_PAD, right: SIDE_PAD });
  } else if (placement.kind === "anchor-below") {
    Object.assign(positionStyle, { top: (placement as any).top, left: SIDE_PAD, right: SIDE_PAD });
  } else if (placement.kind === "anchor-above") {
    Object.assign(positionStyle, { bottom: (placement as any).bottom, left: SIDE_PAD, right: SIDE_PAD });
  }

  const hint = (placement as any).hint as "up" | "down" | undefined;
  const pointerX = (placement as any).pointerX as number | undefined;
  const pointerDir: "up" | "down" | null =
    placement.kind === "anchor-below" ? "up" : placement.kind === "anchor-above" ? "down" : null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 9999 }]} pointerEvents="box-none">
      {isFullScreen && (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: theme === "dark" ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.92)" },
          ]}
          pointerEvents="auto"
        />
      )}

      {pointerDir && pointerX !== undefined && (
        <View
          pointerEvents="none"
          style={[
            styles.pointer,
            pointerDir === "up"
              ? { top: (placement as any).top - 10, left: pointerX - 10, borderBottomColor: C.card }
              : { bottom: (placement as any).bottom - 10, left: pointerX - 10, borderTopColor: C.card },
            pointerDir === "up" ? styles.pointerUp : styles.pointerDown,
          ]}
        />
      )}

      <View
        style={[styles.card, positionStyle, cardStyle]}
        pointerEvents="auto"
      >
        <View style={styles.dotsRow}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                { backgroundColor: i === currentStep ? C.primary : C.border, width: i === currentStep ? 18 : 6 },
              ]}
            />
          ))}
        </View>

        <Pressable hitSlop={12} onPress={skipWalkthrough} style={styles.skipX}>
          <Feather name="x" size={20} color={C.textSecondary} />
        </Pressable>

        <Text style={[styles.title, { color: C.text }]}>{currentStepConfig.title}</Text>
        <Text style={[styles.desc, { color: C.textSecondary }]}>{currentStepConfig.description}</Text>

        {hint && (
          <View style={[styles.hintRow, { backgroundColor: C.primary + "15", borderColor: C.primary + "40" }]}>
            <Ionicons
              name={hint === "down" ? "chevron-down" : "chevron-up"}
              size={14}
              color={C.primary}
            />
            <Text style={[styles.hintTxt, { color: C.primary }]}>
              Scroll {hint === "down" ? "down" : "up"} to see it
            </Text>
          </View>
        )}

        <View style={styles.actions}>
          {!isFirst ? (
            <Pressable onPress={prevStep} style={styles.backBtn} hitSlop={8}>
              <Feather name="chevron-left" size={18} color={C.textSecondary} />
              <Text style={[styles.backTxt, { color: C.textSecondary }]}>Back</Text>
            </Pressable>
          ) : (
            <Pressable onPress={skipWalkthrough} style={styles.backBtn} hitSlop={8}>
              <Text style={[styles.backTxt, { color: C.textSecondary }]}>Skip tour</Text>
            </Pressable>
          )}

          <Pressable onPress={nextStep} style={[styles.nextBtn, { backgroundColor: C.primary }]}>
            <Text style={styles.nextTxt}>{isLast ? "Let's go" : "Next"}</Text>
            {!isLast && <Feather name="chevron-right" size={18} color="#fff" />}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 20,
      },
      android: { elevation: 12 },
    }),
  },
  dotsRow: { flexDirection: "row", gap: 5, marginBottom: 10, paddingRight: 24 },
  dot: { height: 6, borderRadius: 3 },
  skipX: { position: "absolute", top: 12, right: 12, padding: 4 },
  title: { fontSize: 18, fontFamily: "Outfit_700Bold", marginBottom: 4 },
  desc: { fontSize: 13.5, fontFamily: "Outfit_400Regular", lineHeight: 19, marginBottom: 12 },
  hintRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 8, borderWidth: 1, alignSelf: "flex-start", marginBottom: 12,
  },
  hintTxt: { fontSize: 12, fontFamily: "Outfit_600SemiBold" },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: 8, paddingHorizontal: 4 },
  backTxt: { fontSize: 14, fontFamily: "Outfit_600SemiBold" },
  nextBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingVertical: 10, paddingHorizontal: 20, borderRadius: 22,
  },
  nextTxt: { color: "#fff", fontSize: 14, fontFamily: "Outfit_700Bold" },
  pointer: {
    position: "absolute",
    width: 0, height: 0,
    borderLeftWidth: 10, borderRightWidth: 10,
    borderLeftColor: "transparent", borderRightColor: "transparent",
  },
  pointerUp: { borderBottomWidth: 10 },
  pointerDown: { borderTopWidth: 10 },
});
