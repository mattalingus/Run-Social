import React from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, ViewStyle, TextStyle } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface Props {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  testID?: string;
}

const HEIGHTS: Record<Size, number> = { sm: 36, md: 44, lg: 52 };
const PAD_H:   Record<Size, number> = { sm: 12, md: 16, lg: 20 };
const FONT_SZ: Record<Size, number> = { sm: 13, md: 15, lg: 16 };

export default function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  icon,
  iconRight,
  fullWidth = false,
  style,
  textStyle,
  testID,
}: Props) {
  const { C } = useTheme();

  const bg =
    variant === "primary" ? C.primary :
    variant === "secondary" ? C.surface :
    variant === "danger" ? C.danger :
    "transparent";

  const txt =
    variant === "primary" ? "#FFFFFF" :
    variant === "secondary" ? C.text :
    variant === "danger" ? "#FFFFFF" :
    C.primary;

  const border =
    variant === "secondary" ? C.border :
    variant === "ghost" ? C.primary :
    "transparent";

  const isDisabled = disabled || loading;

  return (
    <Pressable
      testID={testID}
      onPress={isDisabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        {
          height: HEIGHTS[size],
          paddingHorizontal: PAD_H[size],
          backgroundColor: bg,
          borderColor: border,
          borderWidth: variant === "secondary" || variant === "ghost" ? 1 : 0,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? "stretch" : "auto",
        },
        style,
      ]}
      android_ripple={variant !== "ghost" ? { color: "rgba(255,255,255,0.12)" } : undefined}
    >
      {loading ? (
        <ActivityIndicator size="small" color={txt} />
      ) : (
        <View style={styles.row}>
          {icon ? <View style={styles.iconL}>{icon}</View> : null}
          <Text
            style={[
              {
                color: txt,
                fontSize: FONT_SZ[size],
                fontWeight: "600",
                fontFamily: "Outfit_600SemiBold",
              },
              textStyle,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {iconRight ? <View style={styles.iconR}>{iconRight}</View> : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  row: { flexDirection: "row", alignItems: "center" },
  iconL: { marginRight: 8 },
  iconR: { marginLeft: 8 },
});
