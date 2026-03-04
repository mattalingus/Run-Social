import React, { forwardRef } from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import Svg, { Polyline, Circle } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";

// ─── Constants ────────────────────────────────────────────────────────────────

const CARD_W = 360;
const CARD_H = 640;
const ROUTE_H = 210;
const PRIMARY = "#00D97E";
const GOLD = "#FFB800";
const BG = "#050C09";
const SURFACE = "#0D1510";
const CARD_BG = "#0A1410";
const TEXT = "#F0FFF4";
const TEXT_SEC = "#8FAF97";
const TEXT_MUTED = "#4A6957";
const BORDER = "#182B1F";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPace(pace: number | null | undefined): string {
  if (!pace || pace <= 0) return "--:--";
  const m = Math.floor(pace);
  const s = Math.round((pace - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDist(mi: number): string {
  if (mi <= 0) return "0.00";
  return mi.toFixed(2);
}

// Normalize GPS coords to SVG viewport
function normalizePath(
  coords: { latitude: number; longitude: number }[],
  width: number,
  height: number,
  padding = 16
): string {
  if (coords.length < 2) return "";
  const lats = coords.map((c) => c.latitude);
  const lngs = coords.map((c) => c.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latRange = maxLat - minLat || 0.001;
  const lngRange = maxLng - minLng || 0.001;
  const usableW = width - padding * 2;
  const usableH = height - padding * 2;
  const scale = Math.min(usableW / lngRange, usableH / latRange);
  const scaledW = lngRange * scale;
  const scaledH = latRange * scale;
  const offX = padding + (usableW - scaledW) / 2;
  const offY = padding + (usableH - scaledH) / 2;
  return coords
    .map((c) => {
      const x = offX + (c.longitude - minLng) * scale;
      const y = offY + (maxLat - c.latitude) * scale;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function getEndPoints(
  coords: { latitude: number; longitude: number }[],
  width: number,
  height: number,
  padding = 16
): { startX: number; startY: number; endX: number; endY: number } | null {
  if (coords.length < 2) return null;
  const lats = coords.map((c) => c.latitude);
  const lngs = coords.map((c) => c.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latRange = maxLat - minLat || 0.001;
  const lngRange = maxLng - minLng || 0.001;
  const usableW = width - padding * 2;
  const usableH = height - padding * 2;
  const scale = Math.min(usableW / lngRange, usableH / latRange);
  const scaledW = lngRange * scale;
  const scaledH = latRange * scale;
  const offX = padding + (usableW - scaledW) / 2;
  const offY = padding + (usableH - scaledH) / 2;
  const first = coords[0];
  const last = coords[coords.length - 1];
  return {
    startX: offX + (first.longitude - minLng) * scale,
    startY: offY + (maxLat - first.latitude) * scale,
    endX: offX + (last.longitude - minLng) * scale,
    endY: offY + (maxLat - last.latitude) * scale,
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ShareCardProps {
  distanceMi: number;
  paceMinPerMile?: number | null;
  durationSeconds?: number | null;
  routePath?: { latitude: number; longitude: number }[];
  activityType?: "run" | "ride" | string;
  participantCount?: number;
  finishRank?: number;
  eventTitle?: string;
  caption?: string;
  backgroundPhoto?: string | null;
  captionFont?: string;
  captionSize?: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

const ShareCard = forwardRef<View, ShareCardProps>(function ShareCard(
  {
    distanceMi,
    paceMinPerMile,
    durationSeconds,
    routePath = [],
    activityType = "run",
    participantCount,
    finishRank,
    eventTitle,
    caption,
    backgroundPhoto,
    captionFont = "Outfit_700Bold",
    captionSize = 32,
  },
  ref
) {
  const hasRoute = routePath.length >= 2;
  const isGroup = participantCount != null && participantCount > 1;
  const isRide = activityType === "ride";

  // ── Standard SVG (route panel height) ──────────────────────────────────────
  const svgPoints = hasRoute ? normalizePath(routePath, CARD_W, ROUTE_H) : "";
  const endPts = hasRoute ? getEndPoints(routePath, CARD_W, ROUTE_H) : null;

  // ── Photo-mode SVG (full card height, faint overlay) ───────────────────────
  const svgPointsFull = hasRoute ? normalizePath(routePath, CARD_W, CARD_H) : "";

  // ── Shared sub-components ──────────────────────────────────────────────────
  const HeaderRow = (
    <View style={s.headerRow}>
      <Text style={s.logo}>FARA</Text>
      <View style={s.actPill}>
        <Ionicons name={isRide ? "bicycle" : "walk"} size={11} color={PRIMARY} style={{ marginRight: 4 }} />
        <Text style={s.actPillTxt}>{isRide ? "Ride" : "Run"}</Text>
      </View>
    </View>
  );

  const FooterStrip = (
    <View style={s.footer}>
      <View style={s.footerLine} />
      <View style={s.footerRow}>
        <Text style={s.footerLogo}>FARA</Text>
        <Text style={s.footerSep}>·</Text>
        <Text style={s.footerTagline}>Run Together</Text>
      </View>
    </View>
  );

  // ── PHOTO MODE ─────────────────────────────────────────────────────────────
  if (backgroundPhoto) {
    return (
      <View ref={ref} style={s.card}>
        {/* Full-bleed photo */}
        <Image source={{ uri: backgroundPhoto }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />

        {/* Route SVG overlay — vibrant, spans full card */}
        {hasRoute && (
          <Svg width={CARD_W} height={CARD_H} style={StyleSheet.absoluteFillObject}>
            {/* Glow underlay */}
            <Polyline
              points={svgPointsFull}
              fill="none"
              stroke={PRIMARY + "50"}
              strokeWidth={10}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Main vibrant line */}
            <Polyline
              points={svgPointsFull}
              fill="none"
              stroke={PRIMARY}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        )}

        {/* Top gradient scrim — protects header readability */}
        <LinearGradient
          colors={["rgba(0,0,0,0.72)", "transparent"]}
          style={s.topScrim}
        />

        {/* Bottom gradient scrim — protects stats + caption */}
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.88)"]}
          style={s.bottomScrim}
        />

        {/* Header overlaid at top */}
        <View style={s.photoHeaderRow}>
          <Text style={s.logo}>FARA</Text>
          <View style={s.actPill}>
            <Ionicons name={isRide ? "bicycle" : "walk"} size={11} color={PRIMARY} style={{ marginRight: 4 }} />
            <Text style={s.actPillTxt}>{isRide ? "Ride" : "Run"}</Text>
          </View>
        </View>

        {/* Bottom content block */}
        <View style={s.photoBottomBlock}>
          {/* Group badges */}
          {isGroup && (
            <View style={[s.groupRow, { paddingHorizontal: 22, paddingBottom: 8 }]}>
              <View style={s.groupPill}>
                <Ionicons name="people" size={13} color={GOLD} style={{ marginRight: 5 }} />
                <Text style={s.groupPillTxt}>{participantCount} {isRide ? "Riders" : "Runners"}</Text>
              </View>
              {finishRank != null && (
                <View style={s.rankPill}>
                  <Ionicons name="trophy" size={11} color={PRIMARY} style={{ marginRight: 4 }} />
                  <Text style={s.rankPillTxt}>{ordinal(finishRank)}</Text>
                </View>
              )}
            </View>
          )}

          {/* Caption overlaid */}
          {!!caption && (
            <Text style={[s.photoCaption, { fontFamily: captionFont, fontSize: captionSize, lineHeight: captionSize * 1.2 }]} numberOfLines={3}>
              {caption}
            </Text>
          )}

          {/* Stats row — white text */}
          <View style={s.photoStatsRow}>
            <View style={[s.statBlock, { flex: 1.4 }]}>
              <Text style={s.photoStatBig}>{formatDist(distanceMi)}</Text>
              <Text style={s.photoStatUnit}>miles</Text>
            </View>
            <View style={s.photoStatDivider} />
            <View style={s.statBlock}>
              <Text style={s.photoStatMid}>{formatPace(paceMinPerMile)}</Text>
              <Text style={s.photoStatUnit}>min/mi</Text>
            </View>
            <View style={s.photoStatDivider} />
            <View style={s.statBlock}>
              <Text style={s.photoStatMid}>{formatDuration(durationSeconds)}</Text>
              <Text style={s.photoStatUnit}>time</Text>
            </View>
          </View>

          {FooterStrip}
        </View>
      </View>
    );
  }

  // ── STANDARD MODE (no photo) ───────────────────────────────────────────────
  return (
    <View ref={ref} style={s.card}>
      {HeaderRow}

      {/* ── Route panel ──────────────────────────────────────────────────── */}
      <View style={s.routePanel}>
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: CARD_BG }]} />

        {/* Grid lines */}
        <View style={[StyleSheet.absoluteFillObject, s.gridContainer]}>
          {[0.25, 0.5, 0.75].map((f) => (
            <View key={f} style={[s.gridLine, { top: `${f * 100}%` as any }]} />
          ))}
          {[0.25, 0.5, 0.75].map((f) => (
            <View key={f} style={[s.gridLineV, { left: `${f * 100}%` as any }]} />
          ))}
        </View>

        {/* SVG Route */}
        {hasRoute ? (
          <Svg width={CARD_W} height={ROUTE_H} style={s.svg}>
            <Polyline points={svgPoints} fill="none" stroke={PRIMARY + "40"} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
            <Polyline points={svgPoints} fill="none" stroke={PRIMARY} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            {endPts && <Circle cx={endPts.startX} cy={endPts.startY} r={5} fill="#FFFFFF" />}
            {endPts && (
              <>
                <Circle cx={endPts.endX} cy={endPts.endY} r={7} fill={PRIMARY + "55"} />
                <Circle cx={endPts.endX} cy={endPts.endY} r={4} fill={PRIMARY} />
              </>
            )}
          </Svg>
        ) : (
          <View style={s.noRoutePlaceholder}>
            <Feather name="map" size={28} color={TEXT_MUTED} />
            <Text style={s.noRouteTxt}>No GPS route</Text>
          </View>
        )}

        <View style={s.routeBadge}>
          <Feather name="map-pin" size={9} color={PRIMARY} style={{ marginRight: 3 }} />
          <Text style={s.routeBadgeTxt}>GPS Route</Text>
        </View>
      </View>

      {/* ── Stats row ────────────────────────────────────────────────────── */}
      <View style={s.statsRow}>
        <View style={[s.statBlock, { flex: 1.4 }]}>
          <Text style={s.statBig}>{formatDist(distanceMi)}</Text>
          <Text style={s.statUnit}>miles</Text>
        </View>
        <View style={s.statDivider} />
        <View style={s.statBlock}>
          <Text style={s.statMid}>{formatPace(paceMinPerMile)}</Text>
          <Text style={s.statUnit}>min/mi</Text>
        </View>
        <View style={s.statDivider} />
        <View style={s.statBlock}>
          <Text style={s.statMid}>{formatDuration(durationSeconds)}</Text>
          <Text style={s.statUnit}>time</Text>
        </View>
      </View>

      {/* ── Divider ──────────────────────────────────────────────────────── */}
      <View style={s.divider} />

      {/* ── Group badge + event title ─────────────────────────────────────── */}
      {isGroup && (
        <View style={s.groupRow}>
          <View style={s.groupPill}>
            <Ionicons name="people" size={13} color={GOLD} style={{ marginRight: 5 }} />
            <Text style={s.groupPillTxt}>{participantCount} {isRide ? "Riders" : "Runners"}</Text>
          </View>
          {finishRank != null && (
            <View style={s.rankPill}>
              <Ionicons name="trophy" size={11} color={PRIMARY} style={{ marginRight: 4 }} />
              <Text style={s.rankPillTxt}>{ordinal(finishRank)}</Text>
            </View>
          )}
          {eventTitle && <Text style={s.eventTitle} numberOfLines={1}>{eventTitle}</Text>}
        </View>
      )}

      {/* ── Caption ──────────────────────────────────────────────────────── */}
      {!!caption && (
        <View style={s.captionArea}>
          <Text style={[s.captionTxt, { fontFamily: captionFont }]}>{caption}</Text>
        </View>
      )}

      <View style={{ flex: 1 }} />
      {FooterStrip}
    </View>
  );
});

export default ShareCard;

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  card: {
    width: CARD_W,
    height: CARD_H,
    backgroundColor: BG,
    borderRadius: 20,
    overflow: "hidden",
    flexDirection: "column",
  },

  // Header
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 14,
  },
  logo: {
    fontFamily: "Outfit_700Bold",
    fontSize: 22,
    color: PRIMARY,
    letterSpacing: 4,
  },
  actPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: PRIMARY + "22",
    borderWidth: 1,
    borderColor: PRIMARY + "55",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  actPillTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 11,
    color: PRIMARY,
    letterSpacing: 0.5,
  },

  // Route panel
  routePanel: {
    width: CARD_W,
    height: ROUTE_H,
    overflow: "hidden",
    position: "relative",
  },
  photoOverlay: {
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  gridContainer: {
    position: "absolute",
  },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "#FFFFFF08",
  },
  gridLineV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: "#FFFFFF08",
  },
  svg: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  noRoutePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderStyle: "dashed",
    margin: 20,
    borderRadius: 12,
  },
  noRouteTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: TEXT_MUTED,
  },
  routeBadge: {
    position: "absolute",
    bottom: 10,
    left: 14,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: BG + "CC",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  routeBadgeTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 9,
    color: PRIMARY,
    letterSpacing: 0.3,
  },

  // Stats
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 22,
    paddingVertical: 20,
  },
  statBlock: {
    flex: 1,
    alignItems: "center",
    gap: 3,
  },
  statBig: {
    fontFamily: "Outfit_700Bold",
    fontSize: 38,
    color: PRIMARY,
    letterSpacing: -1,
    lineHeight: 42,
  },
  statMid: {
    fontFamily: "Outfit_700Bold",
    fontSize: 22,
    color: TEXT,
    letterSpacing: -0.5,
  },
  statUnit: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: TEXT_MUTED,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  statDivider: {
    width: 1,
    height: 44,
    backgroundColor: BORDER,
  },

  // Divider
  divider: {
    marginHorizontal: 22,
    height: 1,
    backgroundColor: BORDER,
  },

  // Group
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 22,
    paddingTop: 14,
    flexWrap: "wrap",
  },
  groupPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: GOLD + "22",
    borderWidth: 1,
    borderColor: GOLD + "55",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  groupPillTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 12,
    color: GOLD,
  },
  rankPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: PRIMARY + "22",
    borderWidth: 1,
    borderColor: PRIMARY + "55",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  rankPillTxt: {
    fontFamily: "Outfit_700Bold",
    fontSize: 12,
    color: PRIMARY,
  },
  eventTitle: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: TEXT_SEC,
    flex: 1,
  },

  // Caption
  captionArea: {
    paddingHorizontal: 22,
    paddingTop: 14,
  },
  captionTxt: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: TEXT_SEC,
    fontStyle: "italic",
    lineHeight: 20,
  },

  // Footer
  footer: {
    paddingHorizontal: 0,
    paddingBottom: 0,
  },
  footerLine: {
    height: 2,
    backgroundColor: PRIMARY,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
  },
  footerLogo: {
    fontFamily: "Outfit_700Bold",
    fontSize: 11,
    color: PRIMARY,
    letterSpacing: 2,
  },
  footerSep: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: TEXT_MUTED,
  },
  footerTagline: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: TEXT_MUTED,
    letterSpacing: 0.3,
  },

  // Photo-mode styles
  topScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 140,
  },
  bottomScrim: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 240,
  },
  photoHeaderRow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 14,
  },
  photoBottomBlock: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
  photoCaption: {
    fontSize: 17,
    fontStyle: "italic",
    color: "#FFFFFF",
    paddingHorizontal: 22,
    paddingBottom: 10,
    lineHeight: 24,
  },
  photoStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 22,
    paddingVertical: 16,
  },
  photoStatBig: {
    fontFamily: "Outfit_700Bold",
    fontSize: 34,
    color: "#FFFFFF",
    letterSpacing: -1,
    lineHeight: 38,
  },
  photoStatMid: {
    fontFamily: "Outfit_700Bold",
    fontSize: 20,
    color: "#FFFFFF",
    letterSpacing: -0.5,
  },
  photoStatUnit: {
    fontFamily: "Outfit_400Regular",
    fontSize: 10,
    color: "rgba(255,255,255,0.55)",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  photoStatDivider: {
    width: 1,
    height: 44,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
});
