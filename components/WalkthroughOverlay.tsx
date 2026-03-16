import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Dimensions,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useWalkthrough } from "@/contexts/WalkthroughContext";
import { useTheme } from "@/contexts/ThemeContext";
import { WALKTHROUGH_STEPS } from "@/lib/walkthroughConfig";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

const TAB_ROUTES: Record<string, Href> = {
  discover: "/(tabs)" as Href,
  solo: "/(tabs)/solo" as Href,
  crew: "/(tabs)/crew" as Href,
  profile: "/(tabs)/profile" as Href,
};

export default function WalkthroughOverlay() {
  const { isActive, currentStep, totalSteps, nextStep, skipWalkthrough, currentStepConfig } = useWalkthrough();
  const { C } = useTheme();
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const prevTabRef = useRef<string | null>(null);

  useEffect(() => {
    if (isActive && currentStepConfig) {
      const targetTab = currentStepConfig.tab;
      const route = TAB_ROUTES[targetTab];
      if (route && prevTabRef.current !== targetTab) {
        prevTabRef.current = targetTab;
        router.replace(route);
      }

      fadeAnim.setValue(0);
      slideAnim.setValue(30);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }
  }, [isActive, currentStep, currentStepConfig]);

  useEffect(() => {
    if (!isActive) {
      prevTabRef.current = null;
    }
  }, [isActive]);

  if (!isActive || !currentStepConfig) return null;

  const isFirst = currentStep === 0;
  const isLast = currentStep === totalSteps - 1;
  const isFullScreen = currentStepConfig.isFullScreen;

  if (isFullScreen) {
    return (
      <View style={[styles.fullOverlay, { backgroundColor: "rgba(0,0,0,0.92)" }]}>
        <Animated.View style={[styles.welcomeCard, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.welcomeIconWrap}>
            <Ionicons name="fitness" size={48} color="#00D97E" />
          </View>
          <Text style={styles.welcomeLogo}>Pace Up</Text>
          <Text style={styles.welcomeTagline}>Move Together</Text>
          <Text style={styles.welcomeDesc}>{currentStepConfig.description}</Text>
          <Pressable style={styles.welcomeBtn} onPress={nextStep} testID="walkthrough-start">
            <Text style={styles.welcomeBtnTxt}>Let's take a tour</Text>
            <Ionicons name="arrow-forward" size={18} color="#050C09" />
          </Pressable>
          <Pressable onPress={skipWalkthrough} style={styles.skipLink} testID="walkthrough-skip">
            <Text style={styles.skipLinkTxt}>Skip tour</Text>
          </Pressable>
        </Animated.View>
      </View>
    );
  }

  const positionStyle = getTooltipPosition(currentStepConfig.tooltipPosition, insets);

  return (
    <View style={styles.fullOverlay} pointerEvents="box-none">
      <Pressable style={styles.dimBg} onPress={nextStep} />
      <Animated.View
        style={[
          styles.tooltipCard,
          positionStyle,
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
        ]}
      >
        <View style={styles.tooltipHeader}>
          <Text style={styles.tooltipTitle}>{currentStepConfig.title}</Text>
          <Text style={styles.stepIndicator}>{currentStep + 1} of {totalSteps}</Text>
        </View>
        <Text style={styles.tooltipDesc}>{currentStepConfig.description}</Text>

        <View style={styles.dotRow}>
          {WALKTHROUGH_STEPS.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i === currentStep && styles.dotActive,
                i < currentStep && styles.dotDone,
              ]}
            />
          ))}
        </View>

        <View style={styles.btnRow}>
          <Pressable onPress={skipWalkthrough} style={styles.skipBtn} testID="walkthrough-skip">
            <Text style={styles.skipBtnTxt}>Skip</Text>
          </Pressable>
          <Pressable onPress={nextStep} style={styles.nextBtn} testID="walkthrough-next">
            <Text style={styles.nextBtnTxt}>{isLast ? "Done" : "Next"}</Text>
            <Ionicons name={isLast ? "checkmark" : "arrow-forward"} size={16} color="#050C09" />
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

function getTooltipPosition(position: string, insets: { top: number; bottom: number }) {
  const webTop = Platform.OS === "web" ? 67 : 0;
  switch (position) {
    case "top":
      return { top: insets.top + webTop + 80 };
    case "bottom":
      return { bottom: insets.bottom + 120 };
    case "center":
    default:
      return { top: SCREEN_H * 0.3 };
  }
}

const styles = StyleSheet.create({
  fullOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
  },
  dimBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  welcomeCard: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  welcomeIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#00D97E18",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
    borderWidth: 2,
    borderColor: "#00D97E44",
  },
  welcomeLogo: {
    fontFamily: "Outfit_700Bold",
    fontSize: 36,
    color: "#F0FFF4",
    marginBottom: 4,
  },
  welcomeTagline: {
    fontFamily: "Outfit_400Regular",
    fontSize: 16,
    color: "#00D97E",
    marginBottom: 24,
    letterSpacing: 1,
  },
  welcomeDesc: {
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: "#8FAF97",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 40,
  },
  welcomeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#00D97E",
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 16,
  },
  welcomeBtnTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: "#050C09",
  },
  skipLink: {
    padding: 8,
  },
  skipLinkTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: "#4A6957",
  },
  tooltipCard: {
    position: "absolute",
    left: 20,
    right: 20,
    backgroundColor: "#132019",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "#00D97E33",
    shadowColor: "#00D97E",
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 4 },
    elevation: 20,
  },
  tooltipHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  tooltipTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 18,
    color: "#F0FFF4",
    flex: 1,
  },
  stepIndicator: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: "#4A6957",
    marginLeft: 8,
  },
  tooltipDesc: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: "#8FAF97",
    lineHeight: 20,
    marginBottom: 16,
  },
  dotRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 4,
    marginBottom: 16,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#182B1F",
  },
  dotActive: {
    width: 18,
    backgroundColor: "#00D97E",
    borderRadius: 3,
  },
  dotDone: {
    backgroundColor: "#00D97E55",
  },
  btnRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  skipBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  skipBtnTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: "#4A6957",
  },
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#00D97E",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  nextBtnTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 14,
    color: "#050C09",
  },
});
