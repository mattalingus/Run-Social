import { Stack } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";

export default function DmLayout() {
  const { C } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: C.surface },
        headerTintColor: C.text,
        headerTitleStyle: { fontFamily: "Outfit_600SemiBold", fontSize: 17 },
        headerShadowVisible: false,
      }}
    />
  );
}
