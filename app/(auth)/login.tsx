import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/contexts/AuthContext";
import { SUSPENDED_NOTICE_KEY } from "@/contexts/AuthContext";
import C from "@/constants/colors";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { resetSuccess, suspended } = useLocalSearchParams<{ resetSuccess?: string; suspended?: string }>();
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suspendedUntil, setSuspendedUntil] = useState<string | null>(null);
  const [isSuspended, setIsSuspended] = useState(false);

  useEffect(() => {
    // Read the suspended notice from AsyncStorage (set by AuthContext on suspension).
    // The ?suspended=1 URL param signals that this notice should be present.
    AsyncStorage.getItem(SUSPENDED_NOTICE_KEY).then((val) => {
      if (val) {
        setIsSuspended(true);
        setSuspendedUntil(val !== "1" ? val : null);
        AsyncStorage.removeItem(SUSPENDED_NOTICE_KEY).catch(() => {});
      } else if (suspended === "1") {
        // Param present but AsyncStorage already cleared — show generic notice
        setIsSuspended(true);
        setSuspendedUntil(null);
      }
    }).catch(() => {
      if (suspended === "1") {
        setIsSuspended(true);
        setSuspendedUntil(null);
      }
    });
  }, [suspended]);

  function formatSuspendedDate(isoStr: string | null): string {
    if (!isoStr) return "soon";
    try {
      return new Date(isoStr).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return "soon";
    }
  }

  async function handleLogin() {
    if (!identifier.trim() || !password) {
      setError("Please fill in all fields");
      return;
    }
    setError("");
    setSuspendedUntil(null);
    setIsSuspended(false);
    setLoading(true);
    try {
      await login(identifier.trim(), password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)");
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (e.code === "SUSPENDED") {
        setIsSuspended(true);
        setSuspendedUntil(e.suspendedUntil ?? null);
      } else {
        setError(e.message || "Login failed");
      }
    } finally {
      setLoading(false);
    }
  }

  const showSuspendedBanner = isSuspended;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.logoWrap}>
            <Feather name="activity" size={32} color={C.primary} />
          </View>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to find your next run</Text>
        </View>

        <View style={styles.form}>
          {resetSuccess === "1" ? (
            <View style={[styles.banner, styles.successBanner]}>
              <Feather name="check-circle" size={14} color={C.primary} />
              <Text style={[styles.bannerText, { color: C.primary }]}>Password reset successfully. Sign in with your new password.</Text>
            </View>
          ) : null}

          {showSuspendedBanner ? (
            <View style={[styles.banner, styles.suspendedBanner]}>
              <Feather name="slash" size={14} color="#F59E0B" />
              <Text style={[styles.bannerText, { color: "#F59E0B" }]}>
                {"Your account is temporarily suspended due to community reports. "}
                {suspendedUntil
                  ? `Try again after ${formatSuspendedDate(suspendedUntil)}.`
                  : "Please try again later."}
              </Text>
            </View>
          ) : null}

          {error ? (
            <View style={[styles.banner, styles.errorBanner]}>
              <Feather name="alert-circle" size={14} color={C.danger} />
              <Text style={[styles.bannerText, { color: C.danger }]}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Username or Email</Text>
            <View style={styles.inputWrap}>
              <Feather name="user" size={16} color={C.textMuted} style={styles.inputIcon} />
              <TextInput
                testID="identifier-input"
                style={styles.input}
                value={identifier}
                onChangeText={setIdentifier}
                placeholder="username or you@example.com"
                placeholderTextColor={C.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputWrap}>
              <Feather name="lock" size={16} color={C.textMuted} style={styles.inputIcon} />
              <TextInput
                testID="password-input"
                style={[styles.input, { flex: 1 }]}
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={C.textMuted}
                secureTextEntry={!showPass}
              />
              <Pressable onPress={() => setShowPass((v) => !v)} style={styles.eyeBtn}>
                <Feather name={showPass ? "eye-off" : "eye"} size={16} color={C.textMuted} />
              </Pressable>
            </View>
          </View>

          <Pressable
            testID="login-submit"
            style={({ pressed }) => [styles.primaryBtn, { opacity: pressed || loading ? 0.85 : 1 }]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={C.bg} />
            ) : (
              <Text style={styles.primaryBtnText}>Sign In</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => router.push("/(auth)/forgot-password")}
            style={styles.forgotBtn}
          >
            <Text style={styles.forgotText}>Forgot password?</Text>
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>New to PaceUp? </Text>
          <Pressable onPress={() => router.push("/(auth)/register")}>
            <Text style={styles.footerLink}>Create account</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  container: { padding: 24, flexGrow: 1 },
  header: { alignItems: "center", marginBottom: 40 },
  logoWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: C.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: C.primary + "33",
  },
  title: { fontFamily: "Outfit_700Bold", fontSize: 28, color: C.text, textAlign: "center" },
  subtitle: { fontFamily: "Outfit_400Regular", fontSize: 15, color: C.textSecondary, marginTop: 6, textAlign: "center" },
  form: { gap: 16 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  bannerText: { fontFamily: "Outfit_400Regular", fontSize: 13, flex: 1 },
  successBanner: {
    backgroundColor: C.primary + "18",
    borderColor: C.primary + "30",
  },
  suspendedBanner: {
    backgroundColor: "#F59E0B18",
    borderColor: "#F59E0B30",
  },
  errorBanner: {
    backgroundColor: C.danger + "22",
    borderColor: C.danger + "44",
  },
  inputGroup: { gap: 6 },
  label: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary, marginLeft: 2 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    height: 52,
  },
  inputIcon: { marginRight: 10 },
  input: {
    flex: 1,
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: C.text,
  },
  eyeBtn: { padding: 4, marginLeft: 8 },
  primaryBtn: {
    backgroundColor: C.primary,
    borderRadius: 14,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  primaryBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.bg },
  forgotBtn: { alignSelf: "center", paddingVertical: 8 },
  forgotText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.primary },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 32 },
  footerText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary },
  footerLink: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.primary },
});
