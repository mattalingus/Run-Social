import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";

export type MileSplit = {
  label: string;
  paceMinPerMile: number;
  isPartial: boolean;
};

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

  const MIN_PCT = 18;
  const MAX_PCT = 100;

  const getBarPct = (pace: number): number => {
    if (paceRange < 0.05) return 72;
    return MAX_PCT - ((pace - minPace) / paceRange) * (MAX_PCT - MIN_PCT);
  };

  const label = activityType === "ride" ? "INTERVAL SPLITS" : "MILE SPLITS";

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: C.textMuted }]}>{label}</Text>
      <View style={styles.headerRow}>
        <Text style={[styles.colMi, { color: C.textMuted }]}>Mi</Text>
        <View style={styles.colBar} />
        <Text style={[styles.colPace, { color: C.textMuted }]}>Pace</Text>
      </View>
      {valid.map((split, i) => {
        const pct = getBarPct(split.paceMinPerMile);
        return (
          <View key={i} style={styles.row}>
            <Text style={[styles.colMi, { color: split.isPartial ? C.textMuted : C.text }]}>
              {split.label}
            </Text>
            <View style={styles.colBar}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View
                  style={[
                    styles.bar,
                    { flex: pct, backgroundColor: C.primary, opacity: split.isPartial ? 0.5 : 1 },
                  ]}
                />
                <View style={{ flex: MAX_PCT - pct }} />
              </View>
            </View>
            <Text style={[styles.colPace, { color: split.isPartial ? C.textMuted : C.text }]}>
              {fmtPace(split.paceMinPerMile)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 16,
    width: "100%",
  },
  title: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 5,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 7,
  },
  colMi: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    width: 28,
  },
  colBar: {
    flex: 1,
    marginHorizontal: 8,
    justifyContent: "center",
  },
  bar: {
    height: 8,
    borderRadius: 4,
  },
  colPace: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    width: 44,
    textAlign: "right",
  },
});
