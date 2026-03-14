import "@/lib/locationTasks";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "@/lib/safeNotifications";
import React, { useEffect, useRef } from "react";
import { Alert, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient, getApiUrl } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ActivityProvider } from "@/contexts/ActivityContext";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { LiveTrackingProvider } from "@/contexts/LiveTrackingContext";
import { NotificationBannerProvider } from "@/contexts/NotificationBannerContext";
import { PurchasesProvider } from "@/contexts/PurchasesContext";
import NotificationBanner from "@/components/NotificationBanner";
import { StatusBar } from "expo-status-bar";
import {
  useFonts,
  Outfit_400Regular,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from "@expo-google-fonts/outfit";
import { PlayfairDisplay_700Bold } from "@expo-google-fonts/playfair-display";
import { DancingScript_700Bold } from "@expo-google-fonts/dancing-script";
import { Nunito_800ExtraBold } from "@expo-google-fonts/nunito";
import C from "@/constants/colors";

SplashScreen.preventAutoHideAsync();

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    } as any),
  });
} catch (_) {}

async function registerPushToken(userId: string) {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === "denied") return; // user already declined — don't re-prompt
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return;
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;
    await fetch(new URL("/api/users/me/push-token", getApiUrl()).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    });
  } catch (_) {}
}

function RootLayoutNav() {
  const { user, isLoading } = useAuth();
  const { C, theme } = useTheme();
  const [fontsLoaded, fontError] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold, PlayfairDisplay_700Bold, DancingScript_700Bold, Nunito_800ExtraBold });
  const splashHidden = useRef(false);
  const pushRegistered = useRef(false);

  useEffect(() => {
    if (!isLoading && (fontsLoaded || fontError)) {
      if (!splashHidden.current) {
        splashHidden.current = true;
        SplashScreen.hideAsync();
      }
      if (!user) {
        router.replace("/(auth)/login");
      }
    }
  }, [isLoading, fontsLoaded, fontError, user]);

  // Register push token once when user logs in
  useEffect(() => {
    if (user && !pushRegistered.current && Platform.OS !== "web") {
      pushRegistered.current = true;
      registerPushToken(user.id);
    }
    if (!user) {
      pushRegistered.current = false;
    }
  }, [user]);

  // Check for interrupted active run (crash recovery)
  const recoveryCheckedForUser = useRef<string | null>(null);
  useEffect(() => {
    if (!user || recoveryCheckedForUser.current === user.id) return;
    recoveryCheckedForUser.current = user.id;
    (async () => {
      try {
        const key = `paceup_active_run_${user.id}`;
        const raw = await AsyncStorage.getItem(key);
        if (!raw) return;
        const data = JSON.parse(raw);
        const ts = new Date(data.timestamp).getTime();
        const age = Number.isFinite(ts) ? Date.now() - ts : Infinity;
        if (age > 24 * 60 * 60 * 1000) {
          await AsyncStorage.removeItem(key);
          return;
        }
        const dist = (data.distanceMi ?? 0).toFixed(2);
        const mins = Math.floor((data.durationSeconds ?? 0) / 60);
        const type = data.activityType === "ride" ? "ride" : data.activityType === "walk" ? "walk" : "run";
        Alert.alert(
          "Recover your last run?",
          `It looks like PaceUp was closed while you were tracking a ${type} (${dist} mi, ${mins} min).`,
          [
            { text: "Discard", style: "destructive", onPress: () => AsyncStorage.removeItem(key).catch(() => {}) },
            { text: "Recover", onPress: () => router.push("/run-tracking?recover=1") },
          ]
        );
      } catch {}
    })();
  }, [user]);

  // Open run when notification is tapped
  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    try {
      sub = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data;
        const runId = data?.runId;
        if (!runId) return;
        if (data?.screen === "run-live") {
          router.push(`/run-live/${runId}`);
        } else {
          router.push(`/run/${runId}`);
        }
      });
    } catch (_) {}
    return () => { try { sub?.remove(); } catch (_) {} };
  }, []);

  if (isLoading || (!fontsLoaded && !fontError)) return null;

  return (
    <>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="(auth)"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="run/[id]"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="create-run/index"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="rate/[runId]"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="map"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="run-tracking"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="run-live/[id]"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="run-results/[id]"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen
          name="crew-chat/[id]"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="user-profile/[id]"
          options={{ presentation: "modal", headerShown: false }}
        />
      </Stack>
      {user && <NotificationBanner />}
    </>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <PurchasesProvider>
              <NotificationBannerProvider>
                <ActivityProvider>
                  <LiveTrackingProvider>
                    <GestureHandlerRootView style={{ flex: 1 }}>
                      <KeyboardProvider>
                        <RootLayoutNav />
                      </KeyboardProvider>
                    </GestureHandlerRootView>
                  </LiveTrackingProvider>
                </ActivityProvider>
              </NotificationBannerProvider>
            </PurchasesProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
