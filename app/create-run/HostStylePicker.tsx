import React from "react";
import { View, Text, Pressable } from "react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/contexts/ThemeContext";

const RUN_CATEGORIES = [
  { label: "Effort",      styles: ["Easy Pace", "Beginner Friendly", "No-Drop", "Recovery", "Long Run", "PR Chaser", "Tempo", "Intervals"] },
  { label: "Social",      styles: ["General", "Talkative", "Headphones OK", "Motivational", "Social After"] },
  { label: "Community",   styles: ["Women", "Men", "Co-Ed", "Young Adult", "College", "Seniors", "All Ages", "Middle Aged"] },
  { label: "Lifestyle",   styles: ["Dog Friendly", "Stroller Friendly", "Walk-Run", "Run & Coffee"] },
  { label: "Time of Day", styles: ["Morning Run", "Sunrise Run", "Sunset Run", "Lunch Run", "Night Run"] },
  { label: "Terrain",     styles: ["Trail", "Road", "Park Loop"] },
];

const RIDE_CATEGORIES = [
  { label: "Effort",      styles: ["Easy Pace", "Beginner Friendly", "No-Drop", "Recovery", "Long Ride", "PR Chaser", "Tempo", "Intervals"] },
  { label: "Social",      styles: ["General", "Talkative", "Headphones OK", "Motivational", "Social After"] },
  { label: "Community",   styles: ["Women", "Men", "Co-Ed", "Young Adult", "College", "Seniors", "All Ages", "Middle Aged"] },
  { label: "Lifestyle",   styles: ["Dog Friendly", "Stroller Friendly", "Walk-Ride", "Ride & Coffee"] },
  { label: "Time of Day", styles: ["Morning Ride", "Sunrise Ride", "Sunset Ride", "Lunch Ride", "Night Ride"] },
  { label: "Terrain",     styles: ["Trail", "Road", "Park Loop"] },
];

interface Props {
  activityType: "run" | "ride";
  selected: string[];
  onChange: (tags: string[]) => void;
}

export function HostStylePicker({ activityType, selected, onChange }: Props) {
  const { C, theme } = useTheme();
  const categories = activityType === "ride" ? RIDE_CATEGORIES : RUN_CATEGORIES;
  const isDark = theme === "dark";

  return (
    <View style={{ gap: 20 }}>
      {categories.map((cat, idx) => (
        <View key={cat.label}>
          {idx > 0 && (
            <View style={{ height: 1, backgroundColor: isDark ? "#1e2d24" : "#d0e8da", marginBottom: 20 }} />
          )}
          <View style={{ marginBottom: 10, alignSelf: "flex-start", backgroundColor: isDark ? "#00D97E" : "#00A85E", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 }}>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 11, color: "#ffffff", textTransform: "uppercase", letterSpacing: 1.2 }}>
              {cat.label}
            </Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {cat.styles.map((s) => {
              const active = selected.includes(s);
              return (
                <Pressable
                  key={s}
                  style={{
                    borderRadius: 20,
                    borderWidth: 1.5,
                    borderColor: active ? (isDark ? "#00D97E" : "#00A85E") : (isDark ? "#1e3828" : "#c0d8ca"),
                    backgroundColor: active ? (isDark ? "#00D97E" : "#00A85E") : "transparent",
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                  }}
                  onPress={() => {
                    if (active) {
                      onChange(selected.filter((t) => t !== s));
                    } else if (selected.length < 8) {
                      onChange([...selected, s]);
                    }
                    Haptics.selectionAsync();
                  }}
                >
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: active ? "#ffffff" : (isDark ? "#b0c8b8" : "#3a5a45") }}>
                    {s}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}
