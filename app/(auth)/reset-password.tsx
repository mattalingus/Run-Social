import React, { useState } from "react";
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
import { apiRequest } from "@/lib/query-client";
import C from "@/constants/colors";

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const { token } = useLocalSearchParams<{ token: string }>();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function handleReset() {
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/reset-password", { token, password });
      setDone(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setError(e.message || "Reset failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          {
            paddingTop: insets.top + (Platform.OS === "web" ? 67 : 20),
            paddingBottom: insets.bottom + 20,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>New Password</Text>
          <Text style={styles.subtitle}>
            {done
              ? "Your password has been reset successfully."
              : "Choose a new password for your PaceUp account."}
          </Text>
        </View>

        {done ? (
          <View style={styles.doneWrap}>
            <View style={styles.checkCircle}>
              <Feather name="check" size={32} color={C.primary} />
            </View>
            <Text style={styles.doneTitle}>All Set!</Text>
            <Pressable
              style={styles.primaryBtn}
              onPress={() => router.replace("/(auth)/login")}
            >
              <Text style={styles.primaryBtnText}>Go to Login</Text>
            </Pressable>
          </View>
        ) : !token ? (
          <View style={styles.doneWrap}>
            <Text style={styles.errorLarge}>Invalid reset link</Text>
            <Pressable
              style={[styles.primaryBtn, { marginTop: 24 }]}
              onPress={() => router.replace("/(auth)/login")}
            >
              <Text style={styles.primaryBtnText}>Back to Login</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.inputWrap}>
              <Feather name="lock" size={18} color="#5a6b5e" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="New password"
                placeholderTextColor="#5a6b5e"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoFocus
                testID="reset-pw-input"
              />
            </View>

            <View style={styles.inputWrap}>
              <Feather name="lock" size={18} color="#5a6b5e" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Confirm password"
                placeholderTextColor="#5a6b5e"
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                testID="reset-pw-confirm"
              />
            </View>

            <Pressable
              style={[styles.primaryBtn, loading && { opacity: 0.6 }]}
              onPress={handleReset}
              disabled={loading}
              testID="reset-submit-btn"
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Reset Password</Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  header: {
    marginBottom: 28,
  },
  title: {
    fontFamily: "Outfit_700Bold",
    fontSize: 28,
    color: C.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: C.textSecondary,
    lineHeight: 22,
  },
  error: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: "#ff6b6b",
    marginBottom: 12,
  },
  errorLarge: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 16,
    color: "#ff6b6b",
    textAlign: "center",
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 16,
    paddingHorizontal: 14,
  },
  inputIcon: { marginRight: 10 },
  input: {
    flex: 1,
    fontFamily: "Outfit_400Regular",
    fontSize: 16,
    color: C.textPrimary,
    paddingVertical: 16,
  },
  primaryBtn: {
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  primaryBtnText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 16,
    color: "#fff",
  },
  doneWrap: {
    alignItems: "center",
    marginTop: 20,
  },
  checkCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.primary + "1a",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  doneTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 22,
    color: C.textPrimary,
    marginBottom: 24,
  },
});
