import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, ViewStyle, Platform, View } from "react-native";
import { useWalkthrough } from "@/contexts/WalkthroughContext";

interface WalkthroughPulseProps {
  stepId: string;
  style?: ViewStyle;
  children: React.ReactNode;
}

export default function WalkthroughPulse({ stepId, style, children }: WalkthroughPulseProps) {
  const { currentStepConfig, isActive, registerTarget } = useWalkthrough();
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);
  const viewRef = useRef<View>(null);
  const isHighlighted = !!stepId && isActive && currentStepConfig?.id === stepId;

  const reportRect = () => {
    if (!isHighlighted) return;
    const node = viewRef.current as any;
    if (!node || typeof node.measureInWindow !== "function") return;
    node.measureInWindow((x: number, y: number, width: number, height: number) => {
      if (width > 0 && height > 0) registerTarget(stepId, { x, y, width, height });
    });
  };

  useEffect(() => {
    if (isHighlighted) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: false }),
          Animated.timing(pulseAnim, { toValue: 0, duration: 900, useNativeDriver: false }),
        ])
      );
      loopRef.current = loop;
      loop.start();
      // Delay so layout is settled, then re-measure periodically (scrolls, tab changes).
      const t = setTimeout(reportRect, 120);
      const iv = setInterval(reportRect, 500);
      return () => {
        clearTimeout(t);
        clearInterval(iv);
        loopRef.current?.stop();
        loopRef.current = null;
      };
    } else {
      loopRef.current?.stop();
      loopRef.current = null;
      pulseAnim.setValue(0);
    }
  }, [isHighlighted]);

  if (!isHighlighted) {
    return <>{children}</>;
  }

  const borderColor = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["rgba(0,168,94,0.5)", "rgba(0,168,94,1)"],
  });
  const shadowOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.9],
  });
  const shadowRadius = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 22],
  });

  return (
    <Animated.View
      ref={viewRef as any}
      onLayout={reportRect}
      style={[
        styles.highlight,
        style,
        Platform.select({
          ios: { borderColor, shadowOpacity, shadowRadius },
          android: { borderColor, elevation: 16 },
          default: { borderColor },
        }) as any,
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  highlight: {
    borderWidth: 3,
    borderRadius: 14,
    shadowColor: "#00A85E",
    shadowOffset: { width: 0, height: 0 },
  },
});
