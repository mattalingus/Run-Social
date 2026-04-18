import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/query-client";

export default function VerifyEmailScreen() {
  const insets = useSafeAreaInsets();
  const { user, refreshUser, logout } = useAuth();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendDone, setResendDone] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailInput, setEmailInput] = useState(user?.email ?? "");
  const codeRef = useRef<TextInput>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  async function handleVerify() {
    const trimmed = code.trim();
    if (trimmed.length < 6) {
      setError("Please enter your 6-digit verification code.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(new URL("/api/auth/verify-email", getApiUrl()).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Verification failed. Please try again.");
        setLoading(false);
        return;
      }
      setSuccess(true);
      await refreshUser();
      setTimeout(() => {
        router.replace("/onboarding");
      }, 800);
    } catch {
      setError("Network error. Please check your connection.");
    }
    setLoading(false);
  }

  async function handleResend() {
    setResendLoading(true);
    setResendDone(false);
    setError(null);
    try {
      const body: Record<string, string> = {};
      if (editingEmail && emailInput.trim() && emailInput.trim() !== user?.email) {
        body.email = emailInput.trim().toLowerCase();
      }
      const res = await fetch(new URL("/api/auth/resend-verification", getApiUrl()).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Could not resend code. Please try again.");
      } else {
        setResendDone(true);
        setEditingEmail(false);
        setCode("");
        if (data.email) await refreshUser();
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setResendLoading(false);
  }

  async function handleLogout() {
    await logout();
    router.replace("/(auth)/login");
  }

  const displayEmail = user?.email ?? emailInput;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.root}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 20, paddingBottom: bottomPad + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoRow}>
          <Text style={styles.logoText}>PACE</Text>
          <Text style={[styles.logoText, styles.logoGreen]}>UP</Text>
        </View>

        <View style={styles.iconWrap}>
          <Ionicons name="mail-outline" size={48} color="#00D97E" />
        </View>

        <Text style={styles.title}>Verify your email</Text>
        <Text style={styles.subtitle}>
          We sent a 6-digit code to{"\n"}
          <Text style={styles.emailHighlight}>{displayEmail}</Text>
        </Text>

        {!editingEmail ? (
          <TouchableOpacity onPress={() => setEditingEmail(true)} style={styles.changeEmailBtn}>
            <Text style={styles.changeEmailText}>Wrong address? Tap to change it</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.emailEditRow}>
            <TextInput
              style={styles.emailInput}
              value={emailInput}
              onChangeText={setEmailInput}
              placeholder="Enter correct email"
              placeholderTextColor="#3D6B52"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        )}

        <Text style={styles.label}>Verification Code</Text>
        <TextInput
          ref={codeRef}
          style={styles.codeInput}
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
          keyboardType="number-pad"
          placeholder="______"
          placeholderTextColor="#3D6B52"
          maxLength={6}
          textAlign="center"
          testID="verify-code-input"
        />

        {error ? (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={14} color="#FF6B35" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {success ? (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle-outline" size={14} color="#00D97E" />
            <Text style={styles.successText}>Email verified! Taking you in…</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.verifyBtn, (loading || success) && styles.verifyBtnDisabled]}
          onPress={handleVerify}
          activeOpacity={0.85}
          disabled={loading || success}
          testID="verify-btn"
        >
          {loading ? (
            <ActivityIndicator color="#050C09" />
          ) : (
            <Text style={styles.verifyBtnLabel}>Verify Email →</Text>
          )}
        </TouchableOpacity>

        <View style={styles.resendRow}>
          {resendDone ? (
            <Text style={styles.resendDoneText}>New code sent!</Text>
          ) : (
            <TouchableOpacity
              onPress={handleResend}
              disabled={resendLoading}
              style={styles.resendBtn}
            >
              {resendLoading ? (
                <ActivityIndicator size="small" color="#00D97E" />
              ) : (
                <Text style={styles.resendText}>
                  {editingEmail ? "Send code to new address" : "Resend code"}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <Text style={styles.logoutText}>Use a different account</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#050C09",
  },
  scroll: {
    paddingHorizontal: 28,
    alignItems: "center",
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 32,
  },
  logoText: {
    fontFamily: "Outfit_700Bold",
    fontSize: 22,
    letterSpacing: 3,
    color: "#FFFFFF",
  },
  logoGreen: {
    color: "#00D97E",
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#0D1510",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
    borderWidth: 1.5,
    borderColor: "#1A2E20",
  },
  title: {
    fontFamily: "Outfit_700Bold",
    fontSize: 28,
    color: "#FFFFFF",
    marginBottom: 10,
    textAlign: "center",
  },
  subtitle: {
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    color: "#6FAB84",
    textAlign: "center",
    marginBottom: 4,
    lineHeight: 22,
  },
  emailHighlight: {
    fontFamily: "Outfit_600SemiBold",
    color: "#FFFFFF",
  },
  changeEmailBtn: {
    paddingVertical: 8,
    marginBottom: 20,
  },
  changeEmailText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: "#00D97E",
    textDecorationLine: "underline",
  },
  emailEditRow: {
    width: "100%",
    marginBottom: 20,
  },
  emailInput: {
    backgroundColor: "#0D1510",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#00D97E",
    color: "#FFFFFF",
    fontFamily: "Outfit_400Regular",
    fontSize: 15,
    paddingVertical: 14,
    paddingHorizontal: 16,
    textAlign: "center",
  },
  label: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: "#6FAB84",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 10,
    alignSelf: "flex-start",
  },
  codeInput: {
    width: "100%",
    backgroundColor: "#0D1510",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#1A2E20",
    color: "#FFFFFF",
    fontFamily: "Outfit_700Bold",
    fontSize: 32,
    letterSpacing: 12,
    paddingVertical: 18,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
    backgroundColor: "#1A0E0A",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#3D1A0F",
    alignSelf: "stretch",
  },
  errorText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: "#FF6B35",
    flex: 1,
  },
  successBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
    backgroundColor: "#0A1F14",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#1A3D22",
    alignSelf: "stretch",
  },
  successText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: "#00D97E",
    flex: 1,
  },
  verifyBtn: {
    backgroundColor: "#00D97E",
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: "center",
    width: "100%",
    marginBottom: 20,
  },
  verifyBtnDisabled: {
    opacity: 0.7,
  },
  verifyBtnLabel: {
    fontFamily: "Outfit_700Bold",
    fontSize: 17,
    color: "#050C09",
    letterSpacing: 0.3,
  },
  resendRow: {
    alignItems: "center",
    marginBottom: 16,
  },
  resendBtn: {
    paddingVertical: 8,
  },
  resendText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: "#00D97E",
    textDecorationLine: "underline",
  },
  resendDoneText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: "#6FAB84",
  },
  logoutBtn: {
    paddingVertical: 8,
  },
  logoutText: {
    fontFamily: "Outfit_400Regular",
    fontSize: 13,
    color: "#3D6B52",
    textDecorationLine: "underline",
  },
});
