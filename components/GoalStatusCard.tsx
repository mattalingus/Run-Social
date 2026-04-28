import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  PanResponder,
  AppState,
  Pressable,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { toDisplayDist, type DistanceUnit } from "@/lib/units";

const DISMISS_KEY = "@paceup_goal_card_last_shown";
const COOLDOWN_MS = 20 * 60 * 60 * 1000; // show at most once per ~day
const AUTO_DISMISS_MS = 6500;

interface SoloRunItem {
  id: string;
  date: string;
  distance_miles: number;
  is_completed?: boolean;
  is_deleted?: boolean;
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0 = Sun
  const diff = (day + 6) % 7; // Monday as start
  x.setDate(x.getDate() - diff);
  return x;
}

function startOfMonth(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  x.setHours(0, 0, 0, 0);
  return x;
}

export default function GoalStatusCard() {
  const { user } = useAuth();
  const { C } = useTheme();
  const insets = useSafeAreaInsets();
  const distUnit: DistanceUnit = (((user as any)?.distance_unit as DistanceUnit) ?? "miles");

  const { data: soloRuns = [] } = useQuery<SoloRunItem[]>({
    queryKey: ["/api/solo-runs"],
    enabled: !!user,
    staleTime: 60_000,
  });

  const [visible, setVisible] = useState(false);
  const translateY = useRef(new Animated.Value(-260)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownThisSession = useRef(false);

  const monthlyGoal = user?.monthly_goal ?? 50;
  const weeklyGoal = Math.max(1, monthlyGoal / 4.345);

  const { weekMiles, monthMiles } = React.useMemo(() => {
    const now = new Date();
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);
    let wm = 0, mm = 0;
    for (const r of soloRuns) {
      if (r.is_deleted || r.is_completed === false) continue;
      const dt = new Date(r.date);
      if (isNaN(dt.getTime())) continue;
      const mi = r.distance_miles ?? 0;
      if (dt >= monthStart) mm += mi;
      if (dt >= weekStart) wm += mi;
    }
    return { weekMiles: wm, monthMiles: mm };
  }, [soloRuns]);

  const dismiss = React.useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    Animated.timing(translateY, {
      toValue: -300,
      duration: 220,
      useNativeDriver: true,
    }).start(() => setVisible(false));
  }, [translateY]);

  const show = React.useCallback(() => {
    setVisible(true);
    translateY.setValue(-260);
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 6,
      speed: 12,
    }).start();
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => dismiss(), AUTO_DISMISS_MS);
  }, [translateY, dismiss]);

  // Show once on app open (gated by cooldown so we're not bombarding)
  useEffect(() => {
    if (!user || shownThisSession.current) return;
    shownThisSession.current = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DISMISS_KEY);
        const last = raw ? parseInt(raw, 10) : 0;
        if (Date.now() - last < COOLDOWN_MS) return;
        // Wait a beat for fonts / splash to settle
        setTimeout(() => {
          show();
          AsyncStorage.setItem(DISMISS_KEY, String(Date.now())).catch(() => {});
        }, 900);
      } catch {}
    })();
  }, [user, show]);

  // Re-show on foreground if cooldown passed
  useEffect(() => {
    if (!user) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      (async () => {
        try {
          const raw = await AsyncStorage.getItem(DISMISS_KEY);
          const last = raw ? parseInt(raw, 10) : 0;
          if (Date.now() - last < COOLDOWN_MS) return;
          show();
          AsyncStorage.setItem(DISMISS_KEY, String(Date.now())).catch(() => {});
        } catch {}
      })();
    });
    return () => sub.remove();
  }, [user, show]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
      onPanResponderMove: (_, g) => {
        if (g.dy < 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy < -40) dismiss();
        else
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
      },
    })
  ).current;

  if (!visible || !user) return null;

  const weekPct = Math.min(1, weekMiles / weeklyGoal);
  const monthPct = Math.min(1, monthMiles / monthlyGoal);
  const weekColor = weekPct >= 1 ? "#FFD700" : C.primary;
  const monthColor = monthPct >= 1 ? "#FFD700" : C.primary;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.container,
        {
          top: insets.top + 8,
          transform: [{ translateY }],
        },
      ]}
      {...panResponder.panHandlers}
    >
      <Pressable
        onPress={dismiss}
        style={[
          styles.card,
          {
            backgroundColor: C.card,
            borderColor: C.border,
            shadowColor: "#000",
          },
        ]}
      >
        <View style={styles.header}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Feather name="target" size={16} color={C.primary} />
            <Text style={[styles.title, { color: C.text }]}>GOAL STATUS</Text>
          </View>
          <Feather name="chevron-up" size={16} color={C.textMuted} />
        </View>

        <View style={styles.row}>
          <View style={styles.rowHead}>
            <Text style={[styles.label, { color: C.textMuted }]}>THIS WEEK</Text>
            <Text style={[styles.value, { color: C.text }]}>
              {toDisplayDist(weekMiles, distUnit)} / {toDisplayDist(weeklyGoal, distUnit)}
            </Text>
          </View>
          <View style={[styles.track, { backgroundColor: C.border }]}>
            <View
              style={[
                styles.fill,
                { backgroundColor: weekColor, width: `${weekPct * 100}%` },
              ]}
            />
          </View>
        </View>

        <View style={styles.row}>
          <View style={styles.rowHead}>
            <Text style={[styles.label, { color: C.textMuted }]}>THIS MONTH</Text>
            <Text style={[styles.value, { color: C.text }]}>
              {toDisplayDist(monthMiles, distUnit)} / {toDisplayDist(monthlyGoal, distUnit)}
            </Text>
          </View>
          <View style={[styles.track, { backgroundColor: C.border }]}>
            <View
              style={[
                styles.fill,
                { backgroundColor: monthColor, width: `${monthPct * 100}%` },
              ]}
            />
          </View>
        </View>

        <View style={styles.handleWrap}>
          <View style={[styles.handle, { backgroundColor: C.border }]} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 9999,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: {
    fontFamily: "Outfit_700Bold",
    fontSize: 12,
    letterSpacing: 0.8,
  },
  row: {
    marginBottom: 10,
  },
  rowHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 5,
  },
  label: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 10,
    letterSpacing: 0.8,
  },
  value: {
    fontFamily: "Outfit_700Bold",
    fontSize: 13,
  },
  track: {
    height: 8,
    borderRadius: 999,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 999,
  },
  handleWrap: {
    alignItems: "center",
    marginTop: 4,
  },
  handle: {
    width: 38,
    height: 3,
    borderRadius: 2,
  },
});
