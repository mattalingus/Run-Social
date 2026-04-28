import React from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/contexts/ThemeContext";

interface ActiveRun {
  kind: "group";
  run_id: string;
  title: string;
  activity_type: "run" | "ride" | "walk";
  started_at: string;
  crew_id?: string | null;
  crew_name?: string | null;
  is_host: boolean;
}

/**
 * T1.8: a persistent green pill that appears at the top of the screen whenever
 * the signed-in user has an unfinished group event in progress. Tap to resume.
 *
 * Hidden on the live tracking screens themselves (no point showing the resume
 * button when you're already there).
 */
export default function ActiveRunBanner() {
  const { C } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  // Polled — server is the source of truth. 30s cadence keeps it fresh
  // without burning battery; the user can pull-to-refresh anywhere too.
  const { data } = useQuery<ActiveRun | null>({
    queryKey: ["/api/users/me/active-run"],
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    staleTime: 10_000,
  });

  if (!data || !data.run_id) return null;

  // Don't show on the tracking screens themselves — redundant.
  const onLive = pathname?.includes("/run-live") || pathname?.includes("/run-tracking");
  if (onLive) return null;

  const elapsedMs = Math.max(0, Date.now() - new Date(data.started_at).getTime());
  const elapsedMin = Math.floor(elapsedMs / 60_000);
  const elapsedSec = Math.floor((elapsedMs % 60_000) / 1000);
  const elapsed = `${elapsedMin}:${elapsedSec.toString().padStart(2, "0")}`;
  const actLabel = data.activity_type === "ride" ? "Ride" : data.activity_type === "walk" ? "Walk" : "Run";

  const handleResume = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/run-live/${data.run_id}` as any);
  };

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          // Sit just under the status bar; absolute so it floats over the Stack.
          top: (Platform.OS === "ios" ? insets.top : 0) + 4,
        },
      ]}
    >
      <Pressable
        onPress={handleResume}
        style={({ pressed }) => [
          styles.pill,
          { backgroundColor: C.primary, opacity: pressed ? 0.92 : 1 },
        ]}
      >
        <View style={styles.pulseDot} />
        <MaterialCommunityIcons
          name={data.activity_type === "ride" ? "bike-fast" : data.activity_type === "walk" ? "walk" : "run-fast"}
          size={16}
          color={C.bg}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: C.bg }]} numberOfLines={1}>
            {data.is_host ? `Hosting · ${data.title}` : data.title}
          </Text>
          <Text style={[styles.sub, { color: C.bg }]} numberOfLines={1}>
            {actLabel} live · {elapsed}{data.crew_name ? ` · ${data.crew_name}` : ""}
          </Text>
        </View>
        <Text style={[styles.cta, { color: C.bg }]}>Resume</Text>
        <Ionicons name="chevron-forward" size={16} color={C.bg} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 9999,
    elevation: 9999,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FFFFFF",
  },
  title: {
    fontFamily: "Outfit_700Bold",
    fontSize: 13,
    letterSpacing: 0.2,
  },
  sub: {
    fontFamily: "Outfit_500Medium",
    fontSize: 11,
    opacity: 0.92,
    marginTop: 1,
  },
  cta: {
    fontFamily: "Outfit_700Bold",
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
});
