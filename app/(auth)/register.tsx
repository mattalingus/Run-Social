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
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/contexts/AuthContext";
import C from "@/constants/colors";

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const { register } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [gender, setGender] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleRegister() {
    if (!firstName.trim() || !lastName.trim() || !username.trim() || !email.trim() || !password || !confirmPassword) {
      setError("Please fill in all fields");
      return;
    }
    const emailVal = email.trim();
    const atIdx = emailVal.indexOf("@");
    if (atIdx < 1 || emailVal.indexOf(".", atIdx) === -1) {
      setError("Please enter a valid email address");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (!/^[^\s@]{2,30}$/.test(username.trim())) {
      setError("Username cannot contain spaces or @ and must be 2–30 characters");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await register(email.trim(), password, firstName.trim(), lastName.trim(), username.trim(), gender);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/onboarding" as any);
    } catch (e: any) {
      setError(e.message || "Registration failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.title}>Join PaceUp</Text>
          <Text style={styles.subtitle}>Create your profile</Text>
        </View>

        <View style={styles.form}>
          {error ? (
            <View style={styles.errorBanner}>
              <Feather name="alert-circle" size={14} color={C.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.nameRow}>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.label}>First Name</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  style={styles.input}
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="Jane"
                  placeholderTextColor={C.textMuted}
                  autoCapitalize="words"
                  autoCorrect={false}
                />
              </View>
            </View>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.label}>Last Name</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  style={styles.input}
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Doe"
                  placeholderTextColor={C.textMuted}
                  autoCapitalize="words"
                  autoCorrect={false}
                />
              </View>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Username</Text>
            <View style={styles.inputWrap}>
              <Feather name="at-sign" size={16} color={C.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={(t) => setUsername(t.replace(/\s/g, ""))}
                placeholder="your_handle"
                placeholderTextColor={C.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <View style={styles.inputWrap}>
              <Feather name="mail" size={16} color={C.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={C.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputWrap}>
              <Feather name="lock" size={16} color={C.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={password}
                onChangeText={setPassword}
                placeholder="Min. 6 characters"
                placeholderTextColor={C.textMuted}
                secureTextEntry={!showPass}
              />
              <Pressable onPress={() => setShowPass((v) => !v)} style={styles.eyeBtn}>
                <Feather name={showPass ? "eye-off" : "eye"} size={16} color={C.textMuted} />
              </Pressable>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Confirm Password</Text>
            <View style={styles.inputWrap}>
              <Feather name="lock" size={16} color={C.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Re-enter password"
                placeholderTextColor={C.textMuted}
                secureTextEntry={!showConfirmPass}
              />
              <Pressable onPress={() => setShowConfirmPass((v) => !v)} style={styles.eyeBtn}>
                <Feather name={showConfirmPass ? "eye-off" : "eye"} size={16} color={C.textMuted} />
              </Pressable>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Gender (Optional)</Text>
            <View style={styles.genderRow}>
              {["Man", "Woman", "Prefer not to say"].map((g) => (
                <Pressable
                  key={g}
                  style={[styles.genderChip, gender === g && styles.genderChipActive]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setGender(gender === g ? null : g);
                  }}
                >
                  <Text style={[styles.genderChipTxt, gender === g && styles.genderChipTxtActive]}>{g}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [styles.primaryBtn, { opacity: pressed || loading ? 0.85 : 1 }]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={C.bg} />
            ) : (
              <Text style={styles.primaryBtnText}>Create Account</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Pressable onPress={() => router.replace("/(auth)/login")}>
            <Text style={styles.footerLink}>Sign in</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  container: { padding: 24, flexGrow: 1 },
  backBtn: { marginBottom: 24, width: 40, height: 40, justifyContent: "center" },
  header: { marginBottom: 32 },
  title: { fontFamily: "Outfit_700Bold", fontSize: 28, color: C.text },
  subtitle: { fontFamily: "Outfit_400Regular", fontSize: 15, color: C.textSecondary, marginTop: 6 },
  form: { gap: 16 },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.danger + "22",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.danger + "44",
  },
  errorText: { fontFamily: "Outfit_400Regular", fontSize: 13, color: C.danger, flex: 1 },
  nameRow: { flexDirection: "row", gap: 12 },
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
  genderRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  genderChip: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  genderChipActive: { borderColor: C.primary, backgroundColor: C.primaryMuted },
  genderChipTxt: { fontFamily: "Outfit_600SemiBold", fontSize: 13, color: C.textSecondary },
  genderChipTxtActive: { color: C.primary },
  eyeBtn: { padding: 4, marginLeft: 8 },
  infoBox: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: C.primaryMuted,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.primary + "33",
  },
  infoText: { fontFamily: "Outfit_400Regular", fontSize: 12, color: C.textSecondary, flex: 1, lineHeight: 18 },
  primaryBtn: {
    backgroundColor: C.primary,
    borderRadius: 14,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  primaryBtnText: { fontFamily: "Outfit_700Bold", fontSize: 16, color: C.bg },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 32 },
  footerText: { fontFamily: "Outfit_400Regular", fontSize: 14, color: C.textSecondary },
  footerLink: { fontFamily: "Outfit_600SemiBold", fontSize: 14, color: C.primary },
});
