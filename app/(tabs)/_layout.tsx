import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";
import { Platform, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import C from "@/constants/colors";

const TAB_BG      = "#0B1A16";
const ACTIVE_TINT = "#4EB082";
const MUTED_TINT  = "#3A5847";

function SolidTabBarBackground() {
  return <View style={styles.tabBarBg} />;
}

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "magnifyingglass", selected: "magnifyingglass" }} />
        <Label>Discover</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="solo">
        <Icon sf={{ default: "stopwatch", selected: "stopwatch.fill" }} />
        <Label>Solo</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Icon sf={{ default: "person", selected: "person.fill" }} />
        <Label>Profile</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const insets  = useSafeAreaInsets();
  const isWeb   = Platform.OS === "web";
  const tabBarHeight = (isWeb ? 50 : 56) + insets.bottom;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor:   ACTIVE_TINT,
        tabBarInactiveTintColor: MUTED_TINT,
        tabBarStyle: {
          position:        "absolute",
          backgroundColor: TAB_BG,
          borderTopWidth:  0,
          height:          tabBarHeight,
          elevation:       0,
          shadowColor:     "transparent",
          shadowOpacity:   0,
          shadowRadius:    0,
          shadowOffset:    { width: 0, height: 0 },
        },
        tabBarBackground: () => <SolidTabBarBackground />,
        tabBarLabelStyle: {
          fontFamily: "Outfit_600SemiBold",
          fontSize:   11,
          marginBottom: 2,
        },
        tabBarIconStyle:  { marginTop: 4 },
        tabBarItemStyle:  { paddingTop: 0, paddingBottom: 0 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Discover",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "search" : "search-outline"} size={23} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="solo"
        options={{
          title: "Solo",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "stopwatch" : "stopwatch-outline"} size={23} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "person" : "person-outline"} size={23} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}

const styles = StyleSheet.create({
  tabBarBg: {
    flex:            1,
    backgroundColor: TAB_BG,
    borderTopWidth:  1,
    borderTopColor:  "#162820",
  },
});
