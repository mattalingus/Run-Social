import React from "react";
import { Platform, Pressable, StyleSheet, Text, View, ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/contexts/ThemeContext";

type BackVariant = "back" | "close" | "none";

interface Props {
  title?: string;
  variant?: BackVariant;
  onBack?: () => void;
  right?: React.ReactNode;
  transparent?: boolean;
  style?: ViewStyle;
  topPaddingExtra?: number;
}

export default function ScreenHeader({
  title,
  variant = "back",
  onBack,
  right,
  transparent = false,
  style,
  topPaddingExtra = Platform.OS === "web" ? 67 : 8,
}: Props) {
  const { C } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleBack = () => {
    if (onBack) onBack();
    else router.back();
  };

  const iconName: "arrow-left" | "x" | null =
    variant === "back" ? "arrow-left" : variant === "close" ? "x" : null;

  return (
    <View
      style={[
        styles.header,
        { paddingTop: insets.top + topPaddingExtra, backgroundColor: transparent ? "transparent" : C.bg },
        style,
      ]}
    >
      {iconName ? (
        <Pressable onPress={handleBack} style={styles.btn} hitSlop={8}>
          <Feather name={iconName} size={22} color={C.text} />
        </Pressable>
      ) : (
        <View style={styles.btn} />
      )}
      <Text
        style={[
          styles.title,
          {
            color: C.text,
            fontFamily: "Outfit_600SemiBold",
          },
        ]}
        numberOfLines={1}
      >
        {title ?? ""}
      </Text>
      <View style={styles.right}>{right ?? null}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  btn: {
    width: 40,
    height: 40,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
  },
  right: {
    minWidth: 40,
    alignItems: "flex-end",
    justifyContent: "center",
  },
});
