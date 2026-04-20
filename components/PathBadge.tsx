import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";

type ActivityType = "run" | "walk" | "ride";

interface Props {
  distanceMiles: number | null | undefined;
  types: ActivityType[];
  compact?: boolean;
  unit?: "mi" | "km";
  onPress?: () => void;
}

const ICON: Record<ActivityType, keyof typeof Ionicons.glyphMap> = {
  run: "walk",
  walk: "footsteps",
  ride: "bicycle",
};

const ORDER: ActivityType[] = ["run", "walk", "ride"];

export default function PathBadge({ distanceMiles, types, compact, unit = "mi", onPress }: Props) {
  const { C } = useTheme();
  if (!distanceMiles || distanceMiles <= 0) return null;

  const display = unit === "km" ? distanceMiles * 1.60934 : distanceMiles;
  const label = `${display < 10 ? display.toFixed(1) : Math.round(display)}${unit}`;

  const uniq = ORDER.filter((t) => types.includes(t));
  const iconSize = compact ? 9 : 11;

  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <View
        style={[
          s.badge,
          compact && s.badgeCompact,
          { backgroundColor: C.card ?? "#FFFFFF", borderColor: "#00D97E" },
        ]}
      >
        <Text
          style={[s.text, compact && s.textCompact, { color: C.text ?? "#0A0F0C" }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {uniq.length > 0 && (
          <View style={s.icons}>
            {uniq.map((t) => (
              <Ionicons key={t} name={ICON[t]} size={iconSize} color="#00D97E" style={s.icon} />
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1.5,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  badgeCompact: {
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  text: {
    fontSize: 11,
    fontWeight: "700",
    marginRight: 3,
  },
  textCompact: {
    fontSize: 9,
    marginRight: 2,
  },
  icons: {
    flexDirection: "row",
    alignItems: "center",
  },
  icon: {
    marginLeft: 1,
  },
});
