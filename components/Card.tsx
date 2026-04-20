import React from "react";
import { Platform, Pressable, StyleSheet, View, ViewStyle } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";

type Variant = "surface" | "card" | "highlight" | "outline";

interface Props {
  children: React.ReactNode;
  variant?: Variant;
  padding?: number;
  radius?: number;
  onPress?: () => void;
  style?: ViewStyle;
  shadow?: boolean;
  testID?: string;
}

export default function Card({
  children,
  variant = "surface",
  padding = 16,
  radius = 20,
  onPress,
  style,
  shadow = false,
  testID,
}: Props) {
  const { C } = useTheme();

  const bg =
    variant === "surface" ? C.surface :
    variant === "card" ? C.card :
    variant === "highlight" ? C.cardHighlight :
    "transparent";

  const containerStyle: ViewStyle = {
    backgroundColor: bg,
    borderRadius: radius,
    padding,
    borderWidth: variant === "outline" ? 1 : 0,
    borderColor: C.border,
    ...(shadow && Platform.OS !== "web"
      ? {
          shadowColor: "#000",
          shadowOpacity: 0.12,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 3,
        }
      : {}),
  };

  if (onPress) {
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        style={({ pressed }) => [containerStyle, { opacity: pressed ? 0.9 : 1 }, style]}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View testID={testID} style={[containerStyle, style]}>
      {children}
    </View>
  );
}
