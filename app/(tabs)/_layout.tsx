import { Tabs } from "expo-router";
import { Platform, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const TAB_BG      = "#0B1A16";
const ACTIVE_TINT = "#4EB082";
const MUTED_TINT  = "#3A5847";
const PILL_H      = 60;
const PILL_RADIUS = 30;
const PILL_MX     = 40;

function PillBackground() {
  return <View style={styles.pill} />;
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const isWeb  = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor:   ACTIVE_TINT,
        tabBarInactiveTintColor: MUTED_TINT,
        tabBarStyle: {
          position:     "absolute",
          height:       PILL_H,
          left:         isWeb ? 140 : PILL_MX,
          right:        isWeb ? 140 : PILL_MX,
          bottom:       insets.bottom + (isWeb ? 34 : 8),
          borderRadius: PILL_RADIUS,
          borderTopWidth: 0,
          backgroundColor: "transparent",
          elevation:    10,
          shadowColor:  "#000",
          shadowOpacity: 0.35,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
        },
        tabBarBackground: () => <PillBackground />,
        tabBarLabelStyle: {
          fontFamily:   "Outfit_600SemiBold",
          fontSize:     13,
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
    flex:            1,
    backgroundColor: TAB_BG,
    borderRadius:    PILL_RADIUS,
    overflow:        "hidden",
    borderWidth:     1,
    borderColor:     "#1E3528",
  },
});
