import React, { forwardRef } from "react";
import { View, Text, Image, StyleSheet, ViewStyle } from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import Svg, { Polyline, Circle } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";

const CARD_W = 360;
const CARD_H = 640;
const PRIMARY = "#00D97E";
const GOLD = "#FFB800";
const BG = "#050C09";
const CARD_BG = "#0A1410";
const TEXT_CLR = "#F0FFF4";
const TEXT_SEC = "#8FAF97";
const TEXT_MUTED = "#4A6957";
const BORDER = "#182B1F";

function formatPace(pace: number | null | undefined): string {
  if (!pace || pace <= 0) return "--:--";
  const m = Math.floor(pace);
  const sec = Math.round((pace - m) * 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatDist(mi: number): string {
  if (mi <= 0) return "0.00";
  return mi.toFixed(2);
}

function normalizePath(
  coords: { latitude: number; longitude: number }[],
  width: number,
  height: number,
  padding = 28
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
  padding = 28
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

export interface ShareCardProps {
  distanceMi: number;
  paceMinPerMile?: number | null;
  durationSeconds?: number | null;
  routePath?: { latitude: number; longitude: number }[];
  activityType?: "run" | "ride" | "walk" | string;
  participantCount?: number;
  finishRank?: number;
  eventTitle?: string;
  caption?: string;
  backgroundPhoto?: string | null;
  collagePhotos?: string[];
  captionFont?: string;
  captionSize?: number;
  transparentMode?: boolean;
  layoutIndex?: number;
  hideDots?: boolean;
}

function CollageBackground({ photos }: { photos: string[] }) {
  const count = Math.min(photos.length, 6);
  const shown = photos.slice(0, count);
  if (count === 1) return <Image source={{ uri: shown[0] }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />;
  if (count === 2) {
    return (
      <View style={[StyleSheet.absoluteFillObject, { flexDirection: "row" }]}>
        {shown.map((uri, i) => (
          <View key={i} style={{ flex: 1, overflow: "hidden" }}>
            <Image source={{ uri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          </View>
        ))}
      </View>
    );
  }
  if (count === 3) {
    return (
      <View style={[StyleSheet.absoluteFillObject, { flexDirection: "column" }]}>
        <View style={{ flex: 1, overflow: "hidden" }}>
          <Image source={{ uri: shown[0] }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        </View>
        <View style={{ flex: 1, flexDirection: "row" }}>
          {shown.slice(1).map((uri, i) => (
            <View key={i} style={{ flex: 1, overflow: "hidden" }}>
              <Image source={{ uri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
            </View>
          ))}
        </View>
      </View>
    );
  }
  if (count === 4) {
    return (
      <View style={[StyleSheet.absoluteFillObject, { flexDirection: "column" }]}>
        <View style={{ flex: 1, flexDirection: "row" }}>
          {shown.slice(0, 2).map((uri, i) => (
            <View key={i} style={{ flex: 1, overflow: "hidden" }}>
              <Image source={{ uri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
            </View>
          ))}
        </View>
        <View style={{ flex: 1, flexDirection: "row" }}>
          {shown.slice(2, 4).map((uri, i) => (
            <View key={i} style={{ flex: 1, overflow: "hidden" }}>
              <Image source={{ uri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
            </View>
          ))}
        </View>
      </View>
    );
  }
  if (count === 5) {
    return (
      <View style={[StyleSheet.absoluteFillObject, { flexDirection: "row" }]}>
        <View style={{ flex: 1, flexDirection: "column" }}>
          {shown.slice(0, 2).map((uri, i) => (
            <View key={i} style={{ flex: 1, overflow: "hidden" }}>
              <Image source={{ uri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
            </View>
          ))}
        </View>
        <View style={{ flex: 1, flexDirection: "column" }}>
          {shown.slice(2, 5).map((uri, i) => (
            <View key={i} style={{ flex: 1, overflow: "hidden" }}>
              <Image source={{ uri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
            </View>
          ))}
        </View>
      </View>
    );
  }
  return (
    <View style={[StyleSheet.absoluteFillObject, { flexDirection: "column" }]}>
      <View style={{ flex: 1, flexDirection: "row" }}>
        {shown.slice(0, 3).map((uri, i) => (
          <View key={i} style={{ flex: 1, overflow: "hidden" }}>
            <Image source={{ uri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          </View>
        ))}
      </View>
      <View style={{ flex: 1, flexDirection: "row" }}>
        {shown.slice(3, 6).map((uri, i) => (
          <View key={i} style={{ flex: 1, overflow: "hidden" }}>
            <Image source={{ uri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          </View>
        ))}
      </View>
    </View>
  );
}

function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

const RouteSvg = ({
  points,
  w,
  h,
  color = PRIMARY,
  strokeW = 2.5,
  showDots = true,
  coords,
  posStyle,
}: {
  points: string;
  w: number;
  h: number;
  color?: string;
  strokeW?: number;
  showDots?: boolean;
  coords?: { latitude: number; longitude: number }[];
  posStyle?: ViewStyle;
}) => {
  if (!points) return null;
  const ep = coords ? getEndPoints(coords, w, h) : null;
  const baseColor = color.length > 7 ? color.slice(0, 7) : color;
  return (
    <Svg width={w} height={h} style={posStyle || StyleSheet.absoluteFillObject}>
      <Polyline points={points} fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" />
      {showDots && ep && <Circle cx={ep.startX} cy={ep.startY} r={4} fill="#FFFFFF" />}
      {showDots && ep && (
        <>
          <Circle cx={ep.endX} cy={ep.endY} r={6} fill={baseColor + "55"} />
          <Circle cx={ep.endX} cy={ep.endY} r={3.5} fill={baseColor} />
        </>
      )}
    </Svg>
  );
};

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
    collagePhotos,
    captionFont = "Outfit_700Bold",
    captionSize = 32,
    transparentMode = false,
    layoutIndex = 0,
    hideDots = false,
  },
  ref
) {
  const hasRoute = routePath.length >= 2;
  const isGroup = participantCount != null && participantCount > 1;
  const isRide = activityType === "ride";
  const isWalk = activityType === "walk";
  const actIcon: any = isRide ? "bicycle" : isWalk ? "footsteps" : "walk";
  const actLabel = isRide ? "Ride" : isWalk ? "Walk" : "Run";
  const actParticipants = isRide ? "Riders" : isWalk ? "Walkers" : "Runners";

  const svgFull = hasRoute ? normalizePath(routePath, CARD_W, CARD_H) : "";
  const ROUTE_TOP_H = 380;
  const svgTop = hasRoute ? normalizePath(routePath, CARD_W, ROUTE_TOP_H, 24) : "";
  const ROUTE_SM = 180;
  const svgSmall = hasRoute ? normalizePath(routePath, ROUTE_SM, ROUTE_SM, 16) : "";
  const ROUTE_SM_LG = 216;
  const svgSmallLg = hasRoute ? normalizePath(routePath, ROUTE_SM_LG, ROUTE_SM_LG, 16) : "";
  const ROUTE_LEFT_W = 170;
  const svgLeft = hasRoute ? normalizePath(routePath, ROUTE_LEFT_W, CARD_H, 20) : "";

  const OverlayHeader = ({ white = false }: { white?: boolean }) => (
    <View style={st.overlayHeader}>
      <Text style={[st.logo, white && { color: "#FFFFFF" }]}>PaceUp</Text>
      <View style={[st.actPill, white && { backgroundColor: "rgba(255,255,255,0.15)", borderColor: "rgba(255,255,255,0.3)" }]}>
        <Ionicons name={actIcon} size={11} color={white ? "#FFFFFF" : PRIMARY} style={{ marginRight: 4 }} />
        <Text style={[st.actPillTxt, white && { color: "#FFFFFF" }]}>{actLabel}</Text>
      </View>
    </View>
  );

  const OverlayFooter = ({ white = false }: { white?: boolean }) => (
    <View style={st.overlayFooter}>
      <View style={[st.footerLine, white && { backgroundColor: "rgba(255,255,255,0.3)" }]} />
      <View style={st.footerRow}>
        <Text style={[st.footerLogo, white && { color: "rgba(255,255,255,0.6)" }]}>PaceUp</Text>
        <Text style={[st.footerSep, white && { color: "rgba(255,255,255,0.3)" }]}>·</Text>
        <Text style={[st.footerTagline, white && { color: "rgba(255,255,255,0.4)" }]}>Run Together</Text>
      </View>
    </View>
  );

  const OverlayGroupBadges = ({ white = false }: { white?: boolean }) => {
    if (!isGroup) return null;
    return (
      <View style={st.overlayGroupRow}>
        <View style={[st.groupPill, white && { backgroundColor: "rgba(255,255,255,0.12)", borderColor: "rgba(255,255,255,0.25)" }]}>
          <Ionicons name="people" size={13} color={white ? "#FFFFFF" : GOLD} style={{ marginRight: 5 }} />
          <Text style={[st.groupPillTxt, white && { color: "#FFFFFF" }]}>{participantCount} {actParticipants}</Text>
        </View>
        {finishRank != null && (
          <View style={[st.rankPill, white && { backgroundColor: "rgba(255,255,255,0.12)", borderColor: "rgba(255,255,255,0.25)" }]}>
            <Ionicons name="trophy" size={11} color={white ? "#FFFFFF" : PRIMARY} style={{ marginRight: 4 }} />
            <Text style={[st.rankPillTxt, white && { color: "#FFFFFF" }]}>{ordinal(finishRank)}</Text>
          </View>
        )}
        {eventTitle && <Text style={[st.eventTitle, white && { color: "rgba(255,255,255,0.7)" }]} numberOfLines={1}>{eventTitle}</Text>}
      </View>
    );
  };

  const OverlayCaption = ({ white = false }: { white?: boolean }) => {
    if (!caption) return null;
    return (
      <Text
        style={[st.overlayCaption, { fontFamily: captionFont, fontSize: captionSize, lineHeight: captionSize * 1.2 }, white && { color: "rgba(255,255,255,0.85)" }]}
        numberOfLines={3}
      >
        {caption}
      </Text>
    );
  };

  const LayoutDots = hideDots ? null : (
    <View style={st.layoutDots}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={[st.layoutDot, layoutIndex === i && st.layoutDotActive]} />
      ))}
    </View>
  );

  const NoRouteOverlay = ({ white = false }: { white?: boolean }) => (
    <View style={st.noRouteCenter}>
      <Feather name="map" size={32} color={white ? "rgba(255,255,255,0.25)" : TEXT_MUTED + "66"} />
    </View>
  );

  const renderPhotoOverlayLayout = (white: boolean) => {
    if (layoutIndex === 0) {
      return (
        <>
          <OverlayHeader white={white} />
          <View style={st.centerBlock}>
            <Text style={st.heroDistWhite}>{formatDist(distanceMi)}</Text>
            <View style={st.heroPaceTimeRow}>
              <Text style={st.heroSmallValWhite}>{formatPace(paceMinPerMile)}</Text>
              <Text style={st.heroSmallLabelWhite}>/mi</Text>
              <View style={st.heroSmallDivider} />
              <Text style={st.heroSmallValWhite}>{formatDuration(durationSeconds)}</Text>
            </View>
          </View>
          {OverlayGroupBadges({ white })}
          <OverlayCaption white={white} />
          <View style={st.bottomBlock}>
            <OverlayFooter white={white} />
          </View>
        </>
      );
    }

    if (layoutIndex === 1) {
      return (
        <>
          <OverlayHeader white={white} />
          <View style={st.bottomBlock}>
            {OverlayGroupBadges({ white })}
            <OverlayCaption white={white} />
            <View style={st.leftStatsCol}>
              <View style={st.leftStatRow}>
                <Text style={st.leftStatVal}>{formatDist(distanceMi)} <Text style={st.leftStatUnit}>mi</Text></Text>
              </View>
              <View style={st.leftStatRow}>
                <Text style={st.leftStatVal}>{formatPace(paceMinPerMile)} <Text style={st.leftStatUnit}>/mi</Text></Text>
              </View>
              <View style={st.leftStatRow}>
                <Text style={st.leftStatVal}>{formatDuration(durationSeconds)}</Text>
              </View>
            </View>
            <OverlayFooter white={white} />
          </View>
        </>
      );
    }

    if (layoutIndex === 2) {
      return (
        <>
          <OverlayHeader white={white} />
          <View style={st.bottomBlock}>
            {OverlayGroupBadges({ white })}
            <OverlayCaption white={white} />
            <View style={st.statsRowBottom}>
              <View style={[st.statBlock, { flex: 1.4 }]}>
                <Text style={st.statBigWhite}>{formatDist(distanceMi)}</Text>
                <Text style={st.statUnitWhite}>mi</Text>
              </View>
              <View style={st.statDividerWhite} />
              <View style={st.statBlock}>
                <Text style={st.statMidWhite}>{formatPace(paceMinPerMile)}</Text>
                <Text style={st.statUnitWhite}>/mi</Text>
              </View>
              <View style={st.statDividerWhite} />
              <View style={st.statBlock}>
                <Text style={st.statMidWhite}>{formatDuration(durationSeconds)}</Text>
              </View>
            </View>
            <OverlayFooter white={white} />
          </View>
        </>
      );
    }

    return (
      <>
        <OverlayHeader white={white} />
        <View style={st.bottomBlock}>
          {OverlayGroupBadges({ white })}
          <OverlayCaption white={white} />
          <View style={st.frostedPillWrap}>
            <View style={st.frostedPill}>
              <Text style={st.frostedPillTxt}>
                {formatDist(distanceMi)} mi  ·  {formatPace(paceMinPerMile)} /mi  ·  {formatDuration(durationSeconds)}
              </Text>
            </View>
          </View>
          <OverlayFooter white={white} />
        </View>
      </>
    );
  };

  const photoRouteOverlay = hasRoute && (() => {
    if (layoutIndex === 0) return <RouteSvg points={svgSmallLg} w={ROUTE_SM_LG} h={ROUTE_SM_LG} color="rgba(255,255,255,0.55)" strokeW={2} showDots={false} coords={routePath} posStyle={{ position: "absolute", bottom: 60, alignSelf: "center" }} />;
    if (layoutIndex === 1) return <RouteSvg points={svgLeft} w={ROUTE_LEFT_W} h={CARD_H} color="rgba(255,255,255,0.45)" strokeW={2} showDots={false} coords={routePath} posStyle={{ position: "absolute", top: 0, left: 0 }} />;
    if (layoutIndex === 2) return <RouteSvg points={svgTop} w={CARD_W} h={ROUTE_TOP_H} color="rgba(255,255,255,0.55)" strokeW={2.5} showDots={false} coords={routePath} posStyle={{ position: "absolute", top: 0, left: 0 }} />;
    return <RouteSvg points={svgFull} w={CARD_W} h={CARD_H} color="rgba(255,255,255,0.35)" strokeW={2} showDots={false} coords={routePath} />;
  })();

  if (backgroundPhoto) {
    return (
      <View ref={ref} style={st.card}>
        <Image source={{ uri: backgroundPhoto }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        {photoRouteOverlay}
        <LinearGradient colors={["rgba(0,0,0,0.65)", "transparent"]} style={st.topScrim} />
        <LinearGradient colors={["transparent", "rgba(0,0,0,0.85)"]} style={st.bottomScrim} />
        {renderPhotoOverlayLayout(true)}
        {LayoutDots}
      </View>
    );
  }

  if (collagePhotos && collagePhotos.length > 0) {
    return (
      <View ref={ref} style={st.card}>
        <CollageBackground photos={collagePhotos} />
        {photoRouteOverlay}
        <LinearGradient colors={["rgba(0,0,0,0.65)", "transparent"]} style={st.topScrim} />
        <LinearGradient colors={["transparent", "rgba(0,0,0,0.85)"]} style={st.bottomScrim} />
        {renderPhotoOverlayLayout(true)}
        {LayoutDots}
      </View>
    );
  }

  if (transparentMode) {
    if (layoutIndex === 0) {
      return (
        <View ref={ref} style={[st.card, { backgroundColor: "transparent" }]}>
          {hasRoute ? (
            <RouteSvg points={svgSmallLg} w={ROUTE_SM_LG} h={ROUTE_SM_LG} color="#FFFFFF" strokeW={2} showDots={true} coords={routePath}
              posStyle={{ position: "absolute", bottom: 60, alignSelf: "center" }} />
          ) : <NoRouteOverlay white />}
          <View style={st.centerBlock}>
            <Text style={st.watermarkAboveDist}>PACEUP</Text>
            <Text style={st.heroDistWhite}>{formatDist(distanceMi)}</Text>
            <View style={[st.heroPaceTimeRow, { marginTop: 8 }]}>
              <Text style={st.heroSmallValWhite}>{formatPace(paceMinPerMile)}</Text>
              <Text style={st.heroSmallLabelWhite}>/mi</Text>
              <View style={st.heroSmallDivider} />
              <Text style={st.heroSmallValWhite}>{formatDuration(durationSeconds)}</Text>
            </View>
          </View>
          {LayoutDots}
        </View>
      );
    }
    if (layoutIndex === 1) {
      return (
        <View ref={ref} style={[st.card, { backgroundColor: "transparent" }]}>
          {hasRoute ? (
            <RouteSvg points={svgLeft} w={ROUTE_LEFT_W} h={CARD_H} color="rgba(255,255,255,0.35)" strokeW={2} showDots={true} coords={routePath}
              posStyle={{ position: "absolute", top: 0, left: 0 }} />
          ) : <NoRouteOverlay white />}
          <View style={st.rightStatsBlock}>
            <View style={st.rightStatsCol}>
              <Text style={[st.watermarkRightSide, { color: "rgba(255,255,255,0.45)" }]}>PACEUP</Text>
              <View style={st.rightStatItem}>
                <Text style={[st.rightStatVal, { color: "#FFFFFF" }]}>{formatDist(distanceMi)}</Text>
                <Text style={[st.rightStatUnit, { color: "rgba(255,255,255,0.5)" }]}>mi</Text>
              </View>
              <View style={[st.rightStatDivider, { backgroundColor: "rgba(255,255,255,0.15)" }]} />
              <View style={st.rightStatItem}>
                <Text style={[st.rightStatVal, { color: "#FFFFFF" }]}>{formatPace(paceMinPerMile)}</Text>
                <Text style={[st.rightStatUnit, { color: "rgba(255,255,255,0.5)" }]}>/mi</Text>
              </View>
              <View style={[st.rightStatDivider, { backgroundColor: "rgba(255,255,255,0.15)" }]} />
              <View style={st.rightStatItem}>
                <Text style={[st.rightStatVal, { color: "#FFFFFF" }]}>{formatDuration(durationSeconds)}</Text>
              </View>
            </View>
          </View>
          {LayoutDots}
        </View>
      );
    }
    if (layoutIndex === 2) {
      return (
        <View ref={ref} style={[st.card, { backgroundColor: "transparent" }]}>
          {hasRoute ? (
            <RouteSvg points={svgTop} w={CARD_W} h={ROUTE_TOP_H} color="#FFFFFF" strokeW={2.5} showDots={true} coords={routePath}
              posStyle={{ position: "absolute", top: 0, left: 0 }} />
          ) : <NoRouteOverlay white />}
          <View style={st.bottomBlock}>
            <Text style={[st.watermarkCentered, { color: "rgba(255,255,255,0.5)" }]}>PACEUP</Text>
            <View style={st.statsRowBottom}>
              <View style={[st.statBlock, { flex: 1.4 }]}>
                <Text style={st.statBigWhite}>{formatDist(distanceMi)}</Text>
                <Text style={st.statUnitWhite}>mi</Text>
              </View>
              <View style={st.statDividerWhite} />
              <View style={st.statBlock}>
                <Text style={st.statMidWhite}>{formatPace(paceMinPerMile)}</Text>
                <Text style={st.statUnitWhite}>/mi</Text>
              </View>
              <View style={st.statDividerWhite} />
              <View style={st.statBlock}>
                <Text style={st.statMidWhite}>{formatDuration(durationSeconds)}</Text>
              </View>
            </View>
          </View>
          {LayoutDots}
        </View>
      );
    }
    return (
      <View ref={ref} style={[st.card, { backgroundColor: "transparent" }]}>
        {hasRoute ? (
          <RouteSvg points={svgFull} w={CARD_W} h={CARD_H} color="rgba(255,255,255,0.25)" strokeW={1.5} showDots={true} coords={routePath} />
        ) : <NoRouteOverlay white />}
        <View style={st.bottomBlock}>
          <View style={st.stackedStatsBlock}>
            <Text style={[st.watermarkAboveStack, { color: "rgba(255,255,255,0.45)" }]}>PACEUP</Text>
            <View style={st.stackedStatRow}>
              <Text style={[st.stackedStatVal, { color: "#FFFFFF" }]}>{formatDist(distanceMi)}</Text>
              <Text style={[st.stackedStatUnit, { color: "rgba(255,255,255,0.5)" }]}>mi</Text>
            </View>
            <View style={[st.stackedDivider, { backgroundColor: "rgba(255,255,255,0.15)" }]} />
            <View style={st.stackedStatRow}>
              <Text style={[st.stackedStatVal, { color: "#FFFFFF" }]}>{formatPace(paceMinPerMile)}</Text>
              <Text style={[st.stackedStatUnit, { color: "rgba(255,255,255,0.5)" }]}>/mi</Text>
            </View>
            <View style={[st.stackedDivider, { backgroundColor: "rgba(255,255,255,0.15)" }]} />
            <View style={st.stackedStatRow}>
              <Text style={[st.stackedStatVal, { color: "#FFFFFF" }]}>{formatDuration(durationSeconds)}</Text>
            </View>
          </View>
        </View>
        {LayoutDots}
      </View>
    );
  }

  {/* Layout 0 (1st): Hero distance centered, large route centered at bottom */}
  if (layoutIndex === 0) {
    return (
      <View ref={ref} style={st.card}>
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: CARD_BG }]} />
        {hasRoute ? (
          <RouteSvg
            points={svgSmallLg}
            w={ROUTE_SM_LG}
            h={ROUTE_SM_LG}
            color={PRIMARY + "40"}
            strokeW={2}
            showDots={true}
            coords={routePath}
            posStyle={{ position: "absolute", bottom: 60, alignSelf: "center" }}
          />
        ) : (
          <NoRouteOverlay />
        )}
        <OverlayHeader />
        <View style={st.centerBlock}>
          <Text style={st.watermarkAboveDist}>PACEUP</Text>
          <Text style={st.heroDist}>{formatDist(distanceMi)}</Text>
          <View style={[st.heroPaceTimeRow, { marginTop: 8 }]}>
            <Text style={st.heroSmallVal}>{formatPace(paceMinPerMile)}</Text>
            <Text style={st.heroSmallLabel}>/mi</Text>
            <View style={[st.heroSmallDivider, { backgroundColor: TEXT_MUTED }]} />
            <Text style={st.heroSmallVal}>{formatDuration(durationSeconds)}</Text>
          </View>
        </View>
        {OverlayGroupBadges({})}
        <OverlayCaption />
        {LayoutDots}
      </View>
    );
  }

  {/* Layout 1 (2nd): Route on left half, stats column on right half */}
  if (layoutIndex === 1) {
    return (
      <View ref={ref} style={st.card}>
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: CARD_BG }]} />
        {hasRoute ? (
          <RouteSvg
            points={svgLeft}
            w={ROUTE_LEFT_W}
            h={CARD_H}
            color={PRIMARY + "35"}
            strokeW={2}
            showDots={true}
            coords={routePath}
            posStyle={{ position: "absolute", top: 0, left: 0 }}
          />
        ) : (
          <NoRouteOverlay />
        )}
        <OverlayHeader />
        <View style={st.rightStatsBlock}>
          {OverlayGroupBadges({})}
          <OverlayCaption />
          <View style={st.rightStatsCol}>
            <Text style={st.watermarkRightSide}>PACEUP</Text>
            <View style={st.rightStatItem}>
              <Text style={st.rightStatVal}>{formatDist(distanceMi)}</Text>
              <Text style={st.rightStatUnit}>mi</Text>
            </View>
            <View style={st.rightStatDivider} />
            <View style={st.rightStatItem}>
              <Text style={st.rightStatVal}>{formatPace(paceMinPerMile)}</Text>
              <Text style={st.rightStatUnit}>/mi</Text>
            </View>
            <View style={st.rightStatDivider} />
            <View style={st.rightStatItem}>
              <Text style={st.rightStatVal}>{formatDuration(durationSeconds)}</Text>
            </View>
          </View>
        </View>
        {LayoutDots}
      </View>
    );
  }

  {/* Layout 2 (3rd): Route fills top ~60%, PaceUp centered above stats row */}
  if (layoutIndex === 2) {
    return (
      <View ref={ref} style={st.card}>
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: CARD_BG }]} />
        {hasRoute ? (
          <RouteSvg
            points={svgTop}
            w={CARD_W}
            h={ROUTE_TOP_H}
            color={PRIMARY + "30"}
            strokeW={2}
            showDots={true}
            coords={routePath}
            posStyle={{ position: "absolute", top: 0, left: 0 }}
          />
        ) : (
          <NoRouteOverlay />
        )}
        <OverlayHeader />
        <View style={st.bottomBlock}>
          {OverlayGroupBadges({})}
          <OverlayCaption />
          <Text style={st.watermarkCentered}>PACEUP</Text>
          <View style={st.statsRowBottom}>
            <View style={[st.statBlock, { flex: 1.4 }]}>
              <Text style={st.statBigGreen}>{formatDist(distanceMi)}</Text>
              <Text style={st.statUnitDark}>mi</Text>
            </View>
            <View style={st.statDividerDark} />
            <View style={st.statBlock}>
              <Text style={st.statMidLight}>{formatPace(paceMinPerMile)}</Text>
              <Text style={st.statUnitDark}>/mi</Text>
            </View>
            <View style={st.statDividerDark} />
            <View style={st.statBlock}>
              <Text style={st.statMidLight}>{formatDuration(durationSeconds)}</Text>
            </View>
          </View>
        </View>
        {LayoutDots}
      </View>
    );
  }

  {/* Layout 3 (4th, default): Full card route (lighter), stacked stats */}
  return (
    <View ref={ref} style={st.card}>
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: CARD_BG }]} />
      {hasRoute ? (
        <RouteSvg points={svgFull} w={CARD_W} h={CARD_H} color={PRIMARY + "18"} strokeW={1.5} showDots={true} coords={routePath} />
      ) : (
        <NoRouteOverlay />
      )}
      <OverlayHeader />
      <View style={st.bottomBlock}>
        {OverlayGroupBadges({})}
        <OverlayCaption />
        <View style={st.stackedStatsBlock}>
          <Text style={st.watermarkAboveStack}>PACEUP</Text>
          <View style={st.stackedStatRow}>
            <Text style={st.stackedStatVal}>{formatDist(distanceMi)}</Text>
            <Text style={st.stackedStatUnit}>mi</Text>
          </View>
          <View style={st.stackedDivider} />
          <View style={st.stackedStatRow}>
            <Text style={st.stackedStatVal}>{formatPace(paceMinPerMile)}</Text>
            <Text style={st.stackedStatUnit}>/mi</Text>
          </View>
          <View style={st.stackedDivider} />
          <View style={st.stackedStatRow}>
            <Text style={st.stackedStatVal}>{formatDuration(durationSeconds)}</Text>
          </View>
        </View>
      </View>
      {LayoutDots}
    </View>
  );
});

export default ShareCard;

const st = StyleSheet.create({
  card: {
    width: CARD_W,
    height: CARD_H,
    backgroundColor: BG,
    borderRadius: 20,
    overflow: "hidden",
  },

  overlayHeader: {
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
    zIndex: 10,
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

  overlayFooter: {
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

  topScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 140,
    zIndex: 5,
  },
  bottomScrim: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 280,
    zIndex: 5,
  },

  bottomBlock: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  centerBlock: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },

  noRouteCenter: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },

  statsRowBottom: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 22,
    paddingVertical: 16,
    paddingBottom: 22,
  },
  statBlock: {
    flex: 1,
    alignItems: "center",
    gap: 3,
  },
  statBigGreen: {
    fontFamily: "Outfit_700Bold",
    fontSize: 34,
    color: PRIMARY,
    letterSpacing: -1,
    lineHeight: 38,
  },
  statMidLight: {
    fontFamily: "Outfit_700Bold",
    fontSize: 20,
    color: TEXT_CLR,
    letterSpacing: -0.5,
  },
  statUnitDark: {
    fontFamily: "Outfit_400Regular",
    fontSize: 10,
    color: TEXT_MUTED,
    letterSpacing: 0.3,
    textTransform: "uppercase" as const,
  },
  statDividerDark: {
    width: 1,
    height: 40,
    backgroundColor: BORDER,
  },
  statBigWhite: {
    fontFamily: "Outfit_700Bold",
    fontSize: 34,
    color: "#FFFFFF",
    letterSpacing: -1,
    lineHeight: 38,
  },
  statMidWhite: {
    fontFamily: "Outfit_700Bold",
    fontSize: 20,
    color: "#FFFFFF",
    letterSpacing: -0.5,
  },
  statUnitWhite: {
    fontFamily: "Outfit_400Regular",
    fontSize: 10,
    color: "rgba(255,255,255,0.55)",
    letterSpacing: 0.3,
    textTransform: "uppercase" as const,
  },
  statDividerWhite: {
    width: 1,
    height: 40,
    backgroundColor: "rgba(255,255,255,0.2)",
  },

  heroDist: {
    fontFamily: "Outfit_700Bold",
    fontSize: 64,
    color: PRIMARY,
    letterSpacing: -2,
    lineHeight: 68,
  },
  heroDistWhite: {
    fontFamily: "Outfit_700Bold",
    fontSize: 64,
    color: "#FFFFFF",
    letterSpacing: -2,
    lineHeight: 68,
  },
  heroPaceTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
  },
  heroSmallVal: {
    fontFamily: "Outfit_700Bold",
    fontSize: 18,
    color: TEXT_CLR,
  },
  heroSmallLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: TEXT_MUTED,
  },
  heroSmallValWhite: {
    fontFamily: "Outfit_700Bold",
    fontSize: 18,
    color: "#FFFFFF",
  },
  heroSmallLabelWhite: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
  },
  heroSmallDivider: {
    width: 1,
    height: 16,
    backgroundColor: "rgba(255,255,255,0.25)",
    marginHorizontal: 4,
  },

  frostedPillWrap: {
    alignItems: "center",
    paddingVertical: 12,
  },
  frostedPill: {
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  frostedPillTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 14,
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },

  leftStatsCol: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    gap: 8,
  },
  leftStatRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "flex-start",
    gap: 4,
  },
  leftStatVal: {
    fontFamily: "Outfit_700Bold",
    fontSize: 22,
    color: "#FFFFFF",
    letterSpacing: -0.5,
  },
  leftStatUnit: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: "rgba(255,255,255,0.45)",
  },

  rightStatsBlock: {
    position: "absolute",
    right: 0,
    top: 80,
    bottom: 30,
    width: 185,
    justifyContent: "center",
    paddingRight: 22,
    zIndex: 10,
  },
  rightStatsCol: {
    gap: 14,
    paddingTop: 8,
  },
  rightStatItem: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  rightStatVal: {
    fontFamily: "Outfit_700Bold",
    fontSize: 26,
    color: TEXT_CLR,
    letterSpacing: -0.5,
  },
  rightStatUnit: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: TEXT_MUTED,
  },
  rightStatDivider: {
    width: 40,
    height: 1,
    backgroundColor: BORDER,
  },

  stackedStatsBlock: {
    paddingHorizontal: 22,
    paddingTop: 4,
    paddingBottom: 24,
    gap: 0,
  },
  stackedStatRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 5,
    paddingVertical: 6,
  },
  stackedStatVal: {
    fontFamily: "Outfit_700Bold",
    fontSize: 28,
    color: TEXT_CLR,
    letterSpacing: -0.5,
  },
  stackedStatUnit: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: TEXT_MUTED,
  },
  stackedDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginHorizontal: 0,
  },

  watermarkCentered: {
    fontFamily: "Outfit_700Bold",
    fontSize: 11,
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 5,
    textAlign: "center",
    paddingTop: 6,
    paddingBottom: 2,
  },
  watermarkAboveDist: {
    fontFamily: "Outfit_700Bold",
    fontSize: 10,
    color: "rgba(255,255,255,0.45)",
    letterSpacing: 4,
    textAlign: "center",
    marginBottom: 6,
  },
  watermarkAboveStack: {
    fontFamily: "Outfit_700Bold",
    fontSize: 10,
    color: "rgba(255,255,255,0.45)",
    letterSpacing: 4,
    marginBottom: 8,
  },
  watermarkRightSide: {
    fontFamily: "Outfit_700Bold",
    fontSize: 10,
    color: "rgba(255,255,255,0.45)",
    letterSpacing: 4,
    marginBottom: 10,
  },

  overlayGroupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 4,
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
  overlayCaption: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: TEXT_SEC,
    fontStyle: "italic",
    lineHeight: 20,
    paddingHorizontal: 22,
    paddingTop: 6,
    paddingBottom: 4,
  },

  layoutDots: {
    position: "absolute",
    right: 12,
    top: "50%" as any,
    transform: [{ translateY: -20 }],
    gap: 6,
    alignItems: "center",
    zIndex: 20,
  },
  layoutDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#FFFFFF33",
  },
  layoutDotActive: {
    backgroundColor: PRIMARY,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
