import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import React, { useEffect, useRef } from "react";
import { Platform } from "react-native";
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
import C from "@/constants/colors";

SplashScreen.preventAutoHideAsync();

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch (_) {}

async function registerPushToken(userId: string) {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return;

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    await fetch(new URL("/api/users/me/push-token", getApiUrl()).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    });
  } catch (e) {
    // Non-critical — silently ignore
  }
}

function RootLayoutNav() {
  const { user, isLoading } = useAuth();
  const { C, theme } = useTheme();
  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });
  const splashHidden = useRef(false);
  const pushRegistered = useRef(false);

  useEffect(() => {
    if (!isLoading && fontsLoaded) {
      if (!splashHidden.current) {
        splashHidden.current = true;
        SplashScreen.hideAsync();
      }
      if (!user) {
        router.replace("/(auth)/login");
      }
    }
  }, [isLoading, fontsLoaded, user]);

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

  if (isLoading || !fontsLoaded) return null;

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
