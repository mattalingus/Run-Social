import React, { useState, useEffect, useRef } from "react";
import { View, Text, Animated } from "react-native";
import { useTheme } from "@/contexts/ThemeContext";
import { apiRequest } from "@/lib/query-client";

function ShimmerLines({ color }: { color: string }) {
  const opacity = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <Animated.View style={{ opacity, gap: 7 }}>
      <View style={{ height: 11, backgroundColor: color, borderRadius: 4, width: "92%" }} />
      <View style={{ height: 11, backgroundColor: color, borderRadius: 4, width: "75%" }} />
    </Animated.View>
  );
}

interface Props {
  runId: string;
  style?: object;
  compact?: boolean;
}

export default function AICoachCard({ runId, style, compact = false }: Props) {
  const { C } = useTheme();
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSummary(null);
    apiRequest("POST", `/api/solo-runs/${runId}/ai-summary`)
      .then(res => res.json())
      .then(data => {
        if (!cancelled) {
          const s = data?.summary;
          setSummary(typeof s === "string" && s.length > 0 ? s : null);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [runId]);

  if (!loading && !summary) return null;

  const shimmerColor = C.primary + "33";

  return (
    <View style={[{
      backgroundColor: C.primary + "12",
      borderWidth: 1,
      borderColor: C.primary + "44",
      borderRadius: compact ? 12 : 14,
      paddingHorizontal: compact ? 12 : 14,
      paddingVertical: compact ? 10 : 12,
    }, style]}>
      {loading ? (
        <ShimmerLines color={shimmerColor} />
      ) : summary ? (
        <Text style={{
          fontFamily: "Outfit_400Regular",
          fontSize: compact ? 13 : 14,
          color: C.text,
          lineHeight: compact ? 19 : 21,
        }}>
          {summary}
        </Text>
      ) : null}
    </View>
  );
}
