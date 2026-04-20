import "@/lib/locationTasks";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "@/lib/safeNotifications";
import React, { useEffect, useRef } from "react";
import { Alert, AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient, getApiUrl, apiRequest, apiFetch } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ActivityProvider } from "@/contexts/ActivityContext";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { LiveTrackingProvider } from "@/contexts/LiveTrackingContext";
import { NotificationBannerProvider } from "@/contexts/NotificationBannerContext";
import { PurchasesProvider } from "@/contexts/PurchasesContext";
import { WalkthroughProvider } from "@/contexts/WalkthroughContext";
import NotificationBanner from "@/components/NotificationBanner";
import WalkthroughOverlay from "@/components/WalkthroughOverlay";
import { useWidgetSync } from "@/lib/useWidgetSync";
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

// Global error handler — catches errors not caught by ErrorBoundary (e.g. async errors in useEffect).
// In production: silently swallow non-fatal errors so users never see raw JS stack dialogs.
// Fatal errors fall through to the ErrorBoundary's "Something went wrong" screen.
// In dev: surface the error in an Alert so we can diagnose crashes during development.
if (Platform.OS !== "web") {
  try {
    const prevHandler = (ErrorUtils as any).getGlobalHandler?.();
    (ErrorUtils as any).setGlobalHandler?.((error: Error, isFatal: boolean) => {
      if (__DEV__) {
        const msg = error?.message || String(error);
        const stack = error?.stack?.split("\n").slice(0, 5).join("\n") || "";
        Alert.alert(
          isFatal ? "Fatal Error (dev only)" : "Error Caught (dev only)",
          `${msg}\n\n${stack}`,
          [{ text: "OK" }]
        );
      } else {
        console.warn("[global handler]", error?.message ?? error);
      }
      if (!isFatal && typeof prevHandler === "function") prevHandler(error, isFatal);
    });
  } catch (_) {}
}


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
    // If the user explicitly deferred during onboarding, the solo-tab banner will handle prompting
    const deferred = await AsyncStorage.getItem("@paceup_notif_deferred");
    if (deferred === "true") return;
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === "denied") return; // user already declined — don't re-prompt
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return;
    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;
    await apiRequest("POST", "/api/users/me/push-token", { token });
  } catch (_) {}
}

function RootLayoutNav() {
  const { user, isLoading, isSuspended } = useAuth();
  const { C, theme } = useTheme();
  useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold, PlayfairDisplay_700Bold, DancingScript_700Bold, Nunito_800ExtraBold });
  const splashHidden = useRef(false);
  const pushRegistered = useRef(false);

  // Keep home screen widget data current after every API fetch
  useWidgetSync();

  // Splash gates only on auth — fonts load in the background and don't block
  useEffect(() => {
    if (!isLoading) {
      if (!splashHidden.current) {
        splashHidden.current = true;
        SplashScreen.hideAsync();
      }
      if (!user) {
        // When suspended, include the query param so login.tsx can read it
        // and the notice survives link-sharing or manual refresh.
        // isSuspended is used (not suspendedUntil) so the param is always
        // set even when no lift-date timestamp is returned by the server.
        if (isSuspended) {
          router.replace({ pathname: "/(auth)/login", params: { suspended: "1" } } as Parameters<typeof router.replace>[0]);
        } else {
          router.replace("/(auth)/login");
        }
      } else if (user.email_verified === false) {
        router.replace("/verify-email" as any);
      } else if (user.onboarding_complete === false) {
        router.replace("/onboarding");
      }
    }
  }, [isLoading, user, isSuspended]);

  // Register push token once when user logs in — skip if onboarding not yet complete
  // (the onboarding notifications step handles the initial permission request)
  useEffect(() => {
    if (user && !pushRegistered.current && Platform.OS !== "web" && user.onboarding_complete !== false) {
      pushRegistered.current = true;
      registerPushToken(user.id);
    }
    if (!user) {
      pushRegistered.current = false;
    }
  }, [user]);

  // Re-register push token when app returns to foreground (replaces stale token)
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && user && user.onboarding_complete !== false) {
        registerPushToken(user.id);
      }
    });
    return () => sub.remove();
  }, [user]);

  // Retry pending photo uploads from previous sessions
  const pendingUploadsRetried = useRef(false);
  useEffect(() => {
    if (!user || pendingUploadsRetried.current) return;
    pendingUploadsRetried.current = true;
    (async () => {
      try {
        const PENDING_KEY = "@paceup_pending_uploads";
        const raw = await AsyncStorage.getItem(PENDING_KEY);
        if (!raw) return;
        const list: Array<{ uri: string; mimeType: string; runId: string }> = JSON.parse(raw);
        if (!list.length) return;
        const remaining: typeof list = [];
        for (const item of list) {
          try {
            const formData = new FormData();
            formData.append("photo", { uri: item.uri, type: item.mimeType, name: "photo.jpg" } as any);
            const url = new URL(`/api/solo-runs/${item.runId}/photos`, getApiUrl()).toString();
            const res = await apiFetch(url, { method: "POST", body: formData });
            if (!res.ok) remaining.push(item);
          } catch {
            remaining.push(item);
          }
        }
        if (remaining.length > 0) {
          await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(remaining));
        } else {
          await AsyncStorage.removeItem(PENDING_KEY);
        }
      } catch {}
    })();
  }, [user]);

  // Check for interrupted active run (crash recovery)
  const recoveryCheckedForUser = useRef<string | null>(null);
  useEffect(() => {
    if (!user || recoveryCheckedForUser.current === user.id) return;
    recoveryCheckedForUser.current = user.id;
    (async () => {
      try {
        // Solo run recovery
        const soloKey = `paceup_active_run_${user.id}`;
        const soloRaw = await AsyncStorage.getItem(soloKey);
        if (soloRaw) {
          const data = JSON.parse(soloRaw);
          const ts = new Date(data.timestamp).getTime();
          const age = Number.isFinite(ts) ? Date.now() - ts : Infinity;
          if (age > 24 * 60 * 60 * 1000) {
            await AsyncStorage.removeItem(soloKey);
          } else {
            const dist = (data.distanceMi ?? 0).toFixed(2);
            const mins = Math.floor((data.durationSeconds ?? 0) / 60);
            const type = data.activityType === "ride" ? "ride" : data.activityType === "walk" ? "walk" : "run";
            Alert.alert(
              `Recover your last ${type}?`,
              `It looks like PaceUp was closed while you were tracking a ${type} (${dist} mi, ${mins} min).`,
              [
                { text: "Discard", style: "destructive", onPress: () => AsyncStorage.removeItem(soloKey).catch(() => {}) },
                { text: "Recover", onPress: () => router.push("/run-tracking?recover=1") },
              ]
            );
            return;
          }
        }

        // Group run recovery
        const groupRaw = await AsyncStorage.getItem("paceup_group_active_run");
        if (groupRaw) {
          const data = JSON.parse(groupRaw);
          const ts = new Date(data.timestamp).getTime();
          const age = Number.isFinite(ts) ? Date.now() - ts : Infinity;
          if (age > 4 * 60 * 60 * 1000) {
            await AsyncStorage.removeItem("paceup_group_active_run");
          } else if (data.runId) {
            const dist = (data.distanceMi ?? 0).toFixed(2);
            const mins = Math.floor((data.durationSeconds ?? 0) / 60);
            const type = data.activityType === "ride" ? "ride" : data.activityType === "walk" ? "walk" : "run";
            Alert.alert(
              `Rejoin your group ${type}?`,
              `It looks like PaceUp was closed while you were tracking a group ${type} (${dist} mi, ${mins} min).`,
              [
                { text: "Dismiss", style: "destructive", onPress: () => AsyncStorage.removeItem("paceup_group_active_run").catch(() => {}) },
                { text: "Rejoin", onPress: () => router.push(`/run-live/${data.runId}`) },
              ]
            );
          }
        }
      } catch {}
    })();
  }, [user]);

  // Open run when notification is tapped
  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    try {
      sub = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data;
        // Android live tracking notification: tap opens the correct tracking screen.
        // For group runs (runId present) → navigate to run-live/[id]; for solo → run-tracking.
        if (data?.screen === "live-tracking") {
          const liveRunId = data?.runId as string | undefined;
          if (liveRunId) {
            router.push(`/run-live/${liveRunId}` as any);
          } else {
            router.push("/run-tracking" as any);
          }
          return;
        }
        if (data?.screen === "notifications") {
          setTimeout(() => {
            try {
              router.push("/notifications" as any);
            } catch (_) {}
          }, 100);
          return;
        }
        if (data?.screen === "dm" && data?.friendId) {
          setTimeout(() => {
            try {
              router.push(`/dm/${data.friendId}` as any);
            } catch (_) {}
          }, 100);
          return;
        }
        if (data?.screen === "crew-chat" && data?.crewId) {
          setTimeout(() => {
            try {
              router.push(`/crew-chat/${data.crewId}` as any);
            } catch (_) {}
          }, 100);
          return;
        }
        const runId = data?.runId;
        if (!runId) return;
        if (data?.type === "run_started_present") {
          router.push(`/run-live/${runId}?autostart=1`);
        } else if (data?.screen === "run-live") {
          router.push(`/run-live/${runId}`);
        } else {
          router.push(`/run/${runId}`);
        }
      });
    } catch (_) {}
    return () => { try { sub?.remove(); } catch (_) {} };
  }, []);

  if (isLoading) return null;

  return (
    <>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen
          name="(auth)"
          options={{ presentation: "modal", headerShown: false }}
        />
        <Stack.Screen name="verify-email" options={{ headerShown: false }} />
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
      {user && <WalkthroughOverlay />}
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
                    <WalkthroughProvider>
                      <GestureHandlerRootView style={{ flex: 1 }}>
                        <KeyboardProvider>
                          <RootLayoutNav />
                        </KeyboardProvider>
                      </GestureHandlerRootView>
                    </WalkthroughProvider>
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
