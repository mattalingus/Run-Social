import { Tabs, usePathname } from "expo-router";
import { Platform, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getApiUrl, apiRequest, apiFetch } from "@/lib/query-client";
import AsyncStorage from "@react-native-async-storage/async-storage";

const CREW_SINCE_KEY = "@paceup_crew_last_visited";

const PILL_H      = 64;
const PILL_RADIUS = 30;
const PILL_MX     = 48;

function PillBackground({ bg, border }: { bg: string; border: string }) {
  return <View style={[styles.pill, { backgroundColor: bg, borderColor: border }]} />;
}

function GreenDot() {
  return (
    <View style={styles.dot} />
  );
}

export default function TabLayout() {
  const insets   = useSafeAreaInsets();
  const isWeb    = Platform.OS === "web";
  const { C }    = useTheme();
  const { user } = useAuth();
  const pathname = usePathname();
  const qc       = useQueryClient();

  const [hasCrewUnread, setHasCrewUnread] = useState(false);
  const [crewSince, setCrewSince] = useState<string | null>(null);
  const onCrewTab     = pathname === "/crew" || pathname.startsWith("/crew/");
  const onDiscoverTab = pathname === "/" || pathname === "/index";
  const onProfileTab  = pathname === "/profile" || pathname.startsWith("/profile");

  const markNotifsRead = useMutation({
    mutationFn: () => apiRequest("POST", "/api/notifications/mark-read", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/notifications"] }),
  });

  useEffect(() => {
    if (onProfileTab && user) {
      markNotifsRead.mutate();
    }
  }, [onProfileTab, user]);

  const { data: notifData } = useQuery<{ items: any[]; lastReadAt: string | null }>({
    queryKey: ["/api/notifications"],
    queryFn: async () => {
      const res = await apiFetch(new URL("/api/notifications", getApiUrl()).toString());
      return res.json();
    },
    enabled: !!user,
    refetchInterval: 30000,
    staleTime: 15000,
  });
  const lastReadAt = notifData?.lastReadAt ? new Date(notifData.lastReadAt).getTime() : 0;
  const unreadNotifCount = (notifData?.items ?? []).filter(
    (n: any) => new Date(n.created_at).getTime() > lastReadAt
  ).length;

  // Load persisted timestamp on mount — defaults to now if never visited (no false positives)
  useEffect(() => {
    AsyncStorage.getItem(CREW_SINCE_KEY).then((stored) => {
      setCrewSince(stored ?? new Date().toISOString());
    });
  }, []);

  useEffect(() => {
    if (onCrewTab) {
      const now = new Date().toISOString();
      setHasCrewUnread(false);
      setCrewSince(now);
      AsyncStorage.setItem(CREW_SINCE_KEY, now);
    }
  }, [onCrewTab]);

  const { data: crewNewData } = useQuery<{ hasNew: boolean }>({
    queryKey: ["/api/crew-chat/has-new", crewSince],
    queryFn: async () => {
      const url = new URL("/api/crew-chat/has-new", getApiUrl());
      url.searchParams.set("since", crewSince!);
      const res = await apiFetch(url.toString());
      return res.json();
    },
    enabled: !!user && !onCrewTab && crewSince !== null,
    refetchInterval: 10000,
    staleTime: 0,
  });

  useEffect(() => {
    if (crewNewData?.hasNew) setHasCrewUnread(true);
  }, [crewNewData]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor:   C.tint,
        tabBarInactiveTintColor: C.tabIconDefault,
        tabBarStyle: {
          position:        "absolute",
          height:          PILL_H,
          left:            0,
          right:           0,
          marginHorizontal: isWeb ? 140 : PILL_MX,
          bottom:          insets.bottom + (isWeb ? 34 : 8),
          borderRadius:    PILL_RADIUS,
          borderTopWidth:  0,
          backgroundColor: Platform.OS === "android" ? C.tabBar : "transparent",
          borderWidth:     Platform.OS === "android" ? 1 : 0,
          borderColor:     Platform.OS === "android" ? C.borderLight : "transparent",
          overflow:        Platform.OS === "android" ? "hidden" : "visible",
          elevation:       10,
          shadowColor:     "#000",
          shadowOpacity:   0.35,
          shadowRadius:    16,
          shadowOffset:    { width: 0, height: 6 },
        },
        tabBarBackground: () => Platform.OS === "android" ? <></> : <PillBackground bg={C.tabBar} border={C.borderLight} />,
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          ...(Platform.OS !== "android" && { fontFamily: "Outfit_600SemiBold" }),
          fontSize:     11,
          marginBottom: Platform.OS === "android" ? 2 : 4,
        },
        tabBarIconStyle: { marginTop: 4 },
        tabBarItemStyle: { paddingTop: 0, paddingBottom: 0 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Discover",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "search" : "search-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="solo"
        options={{
          title: "Solo",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "stopwatch" : "stopwatch-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="crew"
        options={{
          title: "Crew",
          tabBarIcon: ({ color, focused }) => (
            <View>
              <Ionicons name={focused ? "people" : "people-outline"} size={22} color={color} />
              {hasCrewUnread && <GreenDot />}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <View>
              <Ionicons name={focused ? "person" : "person-outline"} size={22} color={color} />
              {unreadNotifCount > 0 && <View style={styles.redDot} />}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  pill: {
    flex:         1,
    borderRadius: PILL_RADIUS,
    overflow:     "hidden",
    borderWidth:  1,
  },
  dot: {
    position:        "absolute",
    top:             -2,
    right:           -4,
    width:           8,
    height:          8,
    borderRadius:    4,
    backgroundColor: "#00A85E",
  },
  redDot: {
    position:        "absolute",
    top:             -2,
    right:           -4,
    width:           8,
    height:          8,
    borderRadius:    4,
    backgroundColor: "#FF3B30",
  },
});
