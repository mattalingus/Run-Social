import { Tabs, usePathname } from "expo-router";
import { Platform, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/query-client";

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

  const [hasCrewUnread, setHasCrewUnread] = useState(false);
  const [crewSince, setCrewSince] = useState(() => new Date().toISOString());
  const onCrewTab = pathname === "/crew" || pathname.startsWith("/crew/");

  useEffect(() => {
    if (onCrewTab) {
      setHasCrewUnread(false);
      setCrewSince(new Date().toISOString());
    }
  }, [onCrewTab]);

  const { data: crewNewData } = useQuery<{ hasNew: boolean }>({
    queryKey: ["/api/crew-chat/has-new", crewSince],
    queryFn: async () => {
      const url = new URL("/api/crew-chat/has-new", getApiUrl());
      url.searchParams.set("since", crewSince);
      const res = await fetch(url.toString(), { credentials: "include" });
      return res.json();
    },
    enabled: !!user && !onCrewTab,
    refetchInterval: 30000,
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
          backgroundColor: "transparent",
          elevation:       10,
          shadowColor:     "#000",
          shadowOpacity:   0.35,
          shadowRadius:    16,
          shadowOffset:    { width: 0, height: 6 },
        },
        tabBarBackground: () => <PillBackground bg={C.tabBar} border={C.borderLight} />,
        tabBarLabelStyle: {
          fontFamily:   "Outfit_600SemiBold",
          fontSize:     11,
          marginBottom: 4,
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
        name="messages"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "person" : "person-outline"} size={22} color={color} />
          ),
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
    backgroundColor: "#00D97E",
    borderWidth:     1.5,
    borderColor:     "#050C09",
  },
});
