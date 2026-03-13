import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";

export type MileSplit = {
  label: string;
  paceMinPerMile: number;
  isPartial: boolean;
};

const BAR_AREA_HEIGHT = 110;
const PACE_LABEL_H = 18;
const MILE_LABEL_H = 18;

function fmtPace(pace: number): string {
  const m = Math.floor(pace);
  const s = Math.round((pace - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}


type Props = {
  splits: MileSplit[];
  activityType?: string;
};

export default function MileSplitsChart({ splits, activityType }: Props) {
  const { C } = useTheme();

  const valid = useMemo(
    () => splits.filter((s) => s.paceMinPerMile > 0 && s.paceMinPerMile < 60),
    [splits]
  );

  if (!valid || valid.length < 1) return null;

  const paces = valid.map((s) => s.paceMinPerMile);
  const minPace = Math.min(...paces);
  const maxPace = Math.max(...paces);
  const paceRange = maxPace - minPace;

  const MIN_BAR = 28;
  const MAX_BAR = BAR_AREA_HEIGHT;

  const getBarHeight = (pace: number) => {
    if (paceRange < 0.05) return MIN_BAR + (MAX_BAR - MIN_BAR) * 0.6;
    return MIN_BAR + ((pace - minPace) / paceRange) * (MAX_BAR - MIN_BAR);
  };

  const barWidth = valid.length <= 5 ? 28 : valid.length <= 8 ? 22 : valid.length <= 12 ? 16 : 12;

  const label = activityType === "ride" ? "INTERVAL SPLITS" : "MILE SPLITS";

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: C.textMuted }]}>{label}</Text>
      <View style={styles.chartRow}>
        {valid.map((split, i) => {
          const barHeight = getBarHeight(split.paceMinPerMile);
          return (
            <View key={i} style={styles.column}>
              <View style={[styles.paceLabelWrap, { height: PACE_LABEL_H }]}>
                <Text style={[styles.paceLabel, { color: C.textMuted }]} numberOfLines={1}>
                  {fmtPace(split.paceMinPerMile)}
                </Text>
              </View>
              <View style={[styles.barArea, { height: BAR_AREA_HEIGHT }]}>
                <View
                  style={{
                    width: barWidth,
                    height: barHeight,
                    borderRadius: 4,
                    backgroundColor: C.primary,
                    opacity: split.isPartial ? 0.55 : 1,
                  }}
                />
              </View>
              <View style={[styles.mileLabelWrap, { height: MILE_LABEL_H }]}>
                <Text style={[styles.mileLabel, { color: split.isPartial ? C.textMuted : C.text }]} numberOfLines={1}>
                  {split.label}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 20,
    width: "100%",
  },
  title: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  chartRow: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  column: {
    flex: 1,
    alignItems: "center",
  },
  paceLabelWrap: {
    justifyContent: "flex-end",
    alignItems: "center",
  },
  paceLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 8,
  },
  barArea: {
    justifyContent: "flex-end",
    alignItems: "center",
  },
  mileLabelWrap: {
    justifyContent: "flex-start",
    alignItems: "center",
    marginTop: 4,
  },
  mileLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 8,
  },
});
