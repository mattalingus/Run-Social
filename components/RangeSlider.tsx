import React, { useRef, useEffect, useState } from "react";
import { View, StyleSheet, PanResponder } from "react-native";

const THUMB = 26;

interface Props {
  min: number;
  max: number;
  step: number;
  low: number;
  high: number;
  onLowChange: (v: number) => void;
  onHighChange: (v: number) => void;
  color?: string;
  trackColor?: string;
}

export default function RangeSlider({
  min, max, step, low, high,
  onLowChange, onHighChange,
  color = "#00D97E",
  trackColor = "#1E3328",
}: Props) {
  const trackWidth = useRef(0);
  const lowRef = useRef(low);
  const highRef = useRef(high);
  const lowStartPx = useRef(0);
  const highStartPx = useRef(0);
  const [ready, setReady] = useState(false);

  useEffect(() => { lowRef.current = low; }, [low]);
  useEffect(() => { highRef.current = high; }, [high]);

  function toPixel(value: number): number {
    if (trackWidth.current === 0) return 0;
    return ((value - min) / (max - min)) * trackWidth.current;
  }

  function toValue(px: number): number {
    const clamped = Math.max(0, Math.min(trackWidth.current, px));
    const raw = (clamped / trackWidth.current) * (max - min) + min;
    const snapped = Math.round(raw / step) * step;
    return parseFloat(Math.max(min, Math.min(max, snapped)).toFixed(10));
  }

  const lowPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        lowStartPx.current = toPixel(lowRef.current);
      },
      onPanResponderMove: (_, gs) => {
        const maxPx = toPixel(highRef.current) - THUMB * 0.8;
        const px = Math.max(0, Math.min(maxPx, lowStartPx.current + gs.dx));
        const val = Math.max(min, Math.min(highRef.current - step, toValue(px)));
        onLowChange(val);
      },
    })
  ).current;

  const highPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        highStartPx.current = toPixel(highRef.current);
      },
      onPanResponderMove: (_, gs) => {
        const minPx = toPixel(lowRef.current) + THUMB * 0.8;
        const px = Math.max(minPx, Math.min(trackWidth.current, highStartPx.current + gs.dx));
        const val = Math.max(lowRef.current + step, Math.min(max, toValue(px)));
        onHighChange(val);
      },
    })
  ).current;

  const lowLeft = toPixel(low) - THUMB / 2;
  const highLeft = toPixel(high) - THUMB / 2;
  const selLeft = toPixel(low);
  const selWidth = Math.max(0, toPixel(high) - toPixel(low));

  return (
    <View
      style={rs.container}
      onLayout={(e) => {
        trackWidth.current = e.nativeEvent.layout.width;
        setReady(true);
      }}
    >
      <View style={[rs.track, { backgroundColor: trackColor }]} />
      {ready && (
        <>
          <View style={[rs.selected, { left: selLeft, width: selWidth, backgroundColor: color }]} />
          <View style={[rs.thumb, { left: lowLeft, borderColor: color }]} {...lowPan.panHandlers} />
          <View style={[rs.thumb, { left: highLeft, borderColor: color }]} {...highPan.panHandlers} />
        </>
      )}
    </View>
  );
}

const rs = StyleSheet.create({
  container: {
    height: THUMB,
    justifyContent: "center",
    marginHorizontal: THUMB / 2,
  },
  track: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
  },
  selected: {
    position: "absolute",
    height: 4,
    borderRadius: 2,
  },
  thumb: {
    position: "absolute",
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: "#F0FFF4",
    borderWidth: 3,
  },
});
