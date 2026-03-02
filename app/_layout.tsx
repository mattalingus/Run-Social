import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { StatusBar } from "expo-status-bar";
import {
  useFonts,
  Outfit_400Regular,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from "@expo-google-fonts/outfit";
import C from "@/constants/colors";

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const { user, isLoading } = useAuth();
  const [fontsLoaded] = useFonts({ Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold });
  const splashHidden = useRef(false);

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

  if (isLoading || !fontsLoaded) return null;

  return (
    <>
      <StatusBar style="light" />
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
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <GestureHandlerRootView style={{ flex: 1, backgroundColor: C.bg }}>
            <KeyboardProvider>
              <RootLayoutNav />
            </KeyboardProvider>
          </GestureHandlerRootView>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
