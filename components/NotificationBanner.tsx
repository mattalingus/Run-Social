import React, { useEffect, useRef, useCallback, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  PanResponder,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useNotificationBanner, BannerNotification, emitOpenNotifications } from "@/contexts/NotificationBannerContext";
import { useTheme } from "@/contexts/ThemeContext";
import { queryClient } from "@/lib/query-client";

function getNotificationIcon(type: string): { name: keyof typeof Feather.glyphMap; color: string; bg: string } {
  switch (type) {
    case "friend_request":
      return { name: "user-plus", color: "#4DA6FF", bg: "#4DA6FF22" };
    case "friend_accepted":
      return { name: "user-check", color: "#4DA6FF", bg: "#4DA6FF22" };
    case "crew_invite":
      return { name: "users", color: "#FF6B35", bg: "#FF6B3522" };
    case "join_request":
      return { name: "user-check", color: "#00A85E", bg: "#00A85E22" };
    case "host_arrived":
      return { name: "map-pin", color: "#00A85E", bg: "#00A85E22" };
    case "event_reminder":
      return { name: "clock", color: "#FFB800", bg: "#FFB80022" };
    case "friend_run_posted":
      return { name: "activity", color: "#00A85E", bg: "#00A85E22" };
    case "pr_notification":
      return { name: "award", color: "#FFB800", bg: "#FFB80022" };
    default:
      return { name: "bell", color: "#00A85E", bg: "#00A85E22" };
  }
}

function navigateToNotification(n: BannerNotification) {
  switch (n.type) {
    case "friend_request": {
      const fromId = n.data?.from_id;
      if (fromId) {
        router.push({ pathname: "/user-profile/[id]", params: { id: fromId } });
      }
      break;
    }
    case "friend_accepted": {
      const friendId = n.data?.friend_id;
      if (friendId) {
        router.push({ pathname: "/user-profile/[id]", params: { id: friendId } });
      }
      break;
    }
    case "crew_invite":
      router.push("/(tabs)/crew");
      break;
    case "join_request":
    case "host_arrived":
    case "event_reminder":
    case "friend_run_posted":
      if (n.data?.run_id) {
        router.push({ pathname: "/run/[id]", params: { id: n.data.run_id } });
      }
      break;
    case "pr_notification":
      if (n.data?.run_id) {
        router.push({ pathname: "/run/[id]", params: { id: n.data.run_id } });
      }
      break;
    case "dm":
    case "direct_message":
      if (n.data?.sender_id) {
        router.push({
          pathname: "/dm/[friendId]",
          params: {
            friendId: n.data.sender_id,
            friendName: n.data.sender_name || "",
            friendUsername: n.data.sender_username || "",
            friendPhoto: n.data.sender_photo || "",
          },
        });
      }
      break;
    default:
      break;
  }
}

function hasActionButtons(type: string): boolean {
  return type === "friend_request" || type === "crew_invite";
}

export default function NotificationBanner() {
  const { bannerQueue, dismissBanner, dismissAll, respondToFriend, respondToCrew } = useNotificationBanner();
  const { C } = useTheme();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-200)).current;
  const isVisible = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    Animated.spring(translateY, {
      toValue: -200,
      useNativeDriver: true,
      tension: 50,
      friction: 10,
    }).start(() => {
      isVisible.current = false;
    });
  }, [translateY, clearTimer]);

  const show = useCallback(() => {
    isVisible.current = true;
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      tension: 60,
      friction: 8,
    }).start();

    clearTimer();
    timerRef.current = setTimeout(() => {
      if (bannerQueue.length > 1) {
        dismissAll();
      } else {
        dismissBanner();
      }
      hide();
    }, 5000);
  }, [translateY, clearTimer, hide, dismissBanner, dismissAll, bannerQueue.length]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => gs.dy < -5,
      onPanResponderMove: (_, gs) => {
        if (gs.dy < 0) {
          translateY.setValue(gs.dy);
        }
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy < -40) {
          clearTimer();
          if (bannerQueue.length > 1) {
            dismissAll();
          } else {
            dismissBanner();
          }
          Animated.spring(translateY, {
            toValue: -200,
            useNativeDriver: true,
            tension: 50,
            friction: 10,
          }).start(() => {
            isVisible.current = false;
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    if (bannerQueue.length > 0) {
      show();
    } else if (isVisible.current) {
      hide();
    }
  }, [bannerQueue.length, show, hide]);

  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

  if (bannerQueue.length === 0) return null;

  const isStacked = bannerQueue.length >= 2;
  const firstNotif = bannerQueue[0];
  const icon = getNotificationIcon(firstNotif.type);

  const handlePress = () => {
    clearTimer();
    if (isStacked) {
      dismissAll();
      hide();
      router.push("/(tabs)");
      setTimeout(() => emitOpenNotifications(), 300);
    } else {
      navigateToNotification(firstNotif);
      dismissBanner();
      hide();
    }
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
  };

  const [actionPending, setActionPending] = useState(false);

  const handleAccept = async () => {
    clearTimer();
    setActionPending(true);
    try {
      if (firstNotif.type === "friend_request") {
        await respondToFriend(firstNotif.id, "accept");
      } else if (firstNotif.type === "crew_invite" && firstNotif.crew_id) {
        await respondToCrew(firstNotif.crew_id, "accept");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/friends"] });
    } finally {
      setActionPending(false);
    }
  };

  const handleDecline = async () => {
    clearTimer();
    setActionPending(true);
    try {
      if (firstNotif.type === "friend_request") {
        await respondToFriend(firstNotif.id, "decline");
      } else if (firstNotif.type === "crew_invite" && firstNotif.crew_id) {
        await respondToCrew(firstNotif.crew_id, "decline");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/friends"] });
    } finally {
      setActionPending(false);
    }
  };

  return (
    <View style={[styles.container, { top: topInset + 4 }]} pointerEvents="box-none">
      {isStacked && bannerQueue.length >= 3 && (
        <View style={[styles.stackedCard, styles.stackedCard3, { backgroundColor: C.card, borderColor: C.border }]} />
      )}
      {isStacked && bannerQueue.length >= 2 && (
        <View style={[styles.stackedCard, styles.stackedCard2, { backgroundColor: C.card, borderColor: C.border }]} />
      )}
      <Animated.View
        style={[{ transform: [{ translateY }] }]}
        {...panResponder.panHandlers}
      >
        <Pressable
          onPress={handlePress}
          style={[styles.card, { backgroundColor: C.surface, borderColor: C.border }]}
        >
          <View style={styles.cardContent}>
            <View style={[styles.iconWrap, { backgroundColor: icon.bg }]}>
              <Feather name={icon.name} size={18} color={icon.color} />
            </View>
            <View style={styles.textWrap}>
              <View style={styles.titleRow}>
                <Text style={[styles.title, { color: C.text, fontFamily: "Outfit_600SemiBold" }]} numberOfLines={1}>
                  {firstNotif.title}
                </Text>
                {isStacked && (
                  <View style={styles.countBadge}>
                    <Text style={styles.countText}>{bannerQueue.length}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.body, { color: C.textSecondary, fontFamily: "Outfit_400Regular" }]} numberOfLines={2}>
                {firstNotif.body}
              </Text>
            </View>
            {!hasActionButtons(firstNotif.type) && !isStacked && (
              <Feather name="chevron-right" size={14} color={C.textMuted} />
            )}
          </View>

          {hasActionButtons(firstNotif.type) && !isStacked && (
            <View style={[styles.actionRow, { borderTopColor: C.border }]}>
              <Pressable
                style={[styles.actionBtn, styles.acceptBtn, actionPending && { opacity: 0.6 }]}
                onPress={(e) => { e.stopPropagation?.(); handleAccept(); }}
                disabled={actionPending}
              >
                <Feather name="check" size={14} color="#FFF" />
                <Text style={styles.acceptText}>
                  {firstNotif.type === "crew_invite" ? "Join" : "Accept"}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, styles.declineBtn, { borderColor: C.border }, actionPending && { opacity: 0.6 }]}
                onPress={(e) => { e.stopPropagation?.(); handleDecline(); }}
                disabled={actionPending}
              >
                <Feather name="x" size={14} color={C.textSecondary} />
                <Text style={[styles.declineText, { color: C.textSecondary }]}>Decline</Text>
              </Pressable>
            </View>
          )}

          {isStacked && (
            <Text style={[styles.stackedHint, { color: C.textMuted, fontFamily: "Outfit_400Regular" }]}>
              Tap to view all notifications
            </Text>
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 9999,
    elevation: 9999,
  },
  stackedCard: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 70,
    borderRadius: 14,
    borderWidth: 1,
  },
  stackedCard2: {
    top: -4,
    marginHorizontal: 6,
  },
  stackedCard3: {
    top: -8,
    marginHorizontal: 12,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  cardContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 10,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  textWrap: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 14,
    flex: 1,
  },
  countBadge: {
    backgroundColor: "#FF3B30",
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: "center",
  },
  countText: {
    color: "#FFF",
    fontSize: 11,
    fontFamily: "Outfit_600SemiBold",
  },
  body: {
    fontSize: 13,
    marginTop: 2,
    lineHeight: 17,
  },
  actionRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  acceptBtn: {
    backgroundColor: "#00A85E",
  },
  acceptText: {
    color: "#FFF",
    fontSize: 13,
    fontFamily: "Outfit_600SemiBold",
  },
  declineBtn: {
    borderWidth: 1,
  },
  declineText: {
    fontSize: 13,
    fontFamily: "Outfit_400Regular",
  },
  stackedHint: {
    fontSize: 12,
    textAlign: "center",
    paddingBottom: 8,
  },
});
