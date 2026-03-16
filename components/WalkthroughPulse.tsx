import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, ViewStyle } from "react-native";
import { useWalkthrough } from "@/contexts/WalkthroughContext";

interface WalkthroughPulseProps {
  stepId: string;
  style?: ViewStyle;
  children: React.ReactNode;
}

export default function WalkthroughPulse({ stepId, style, children }: WalkthroughPulseProps) {
  const { currentStepConfig, isActive } = useWalkthrough();
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);
  const isHighlighted = isActive && currentStepConfig?.id === stepId;

  useEffect(() => {
    if (isHighlighted) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: false }),
          Animated.timing(pulseAnim, { toValue: 0, duration: 800, useNativeDriver: false }),
        ])
      );
      loopRef.current = loop;
      loop.start();
    } else {
      loopRef.current?.stop();
      loopRef.current = null;
      pulseAnim.setValue(0);
    }
    return () => {
      loopRef.current?.stop();
      loopRef.current = null;
    };
  }, [isHighlighted]);

  if (!isHighlighted) {
    return <>{children}</>;
  }

  const borderColor = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["rgba(0,217,126,0.2)", "rgba(0,217,126,0.8)"],
  });

  const shadowOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.1, 0.5],
  });

  return (
    <Animated.View
      style={[
        styles.highlight,
        style,
        {
          borderColor,
          shadowOpacity,
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  highlight: {
    borderWidth: 2,
    borderRadius: 14,
    shadowColor: "#00D97E",
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
});
