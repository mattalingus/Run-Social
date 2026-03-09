import "@/lib/locationTasks";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "@/lib/safeNotifications";
import React, { useEffect, useRef } from "react";
import { Platform, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient, getApiUrl } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ActivityProvider } from "@/contexts/ActivityContext";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { LiveTrackingProvider } from "@/contexts/LiveTrackingContext";
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

const NOTIF_PROMPT_KEY = "@paceup_notif_prompt_shown";

async function requestAndRegisterPush(userId: string) {
  try {
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

async function registerPushToken(userId: string) {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === "granted") {
      // Already granted — register silently
      await requestAndRegisterPush(userId);
      return;
    }
    if (existing !== "undetermined") return; // denied — don't pester

    // T008: show branded in-app prompt before iOS system dialog
    const alreadyShown = await AsyncStorage.getItem(NOTIF_PROMPT_KEY);
    if (alreadyShown) return;
    await AsyncStorage.setItem(NOTIF_PROMPT_KEY, "1");

    Alert.alert(
      "Stay in the loop",
      "Know the moment your run starts, when friends message you, and when your crew is active.\n\nEnable notifications to get the most out of PaceUp.",
      [
        { text: "Maybe Later", style: "cancel" },
        { text: "Enable", onPress: () => requestAndRegisterPush(userId) },
      ]
    );
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
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <ActivityProvider>
              <LiveTrackingProvider>
                <GestureHandlerRootView style={{ flex: 1 }}>
                  <KeyboardProvider>
                    <RootLayoutNav />
                  </KeyboardProvider>
                </GestureHandlerRootView>
              </LiveTrackingProvider>
            </ActivityProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
