import React, { useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library";
import * as Clipboard from "expo-clipboard";
import { captureRef } from "react-native-view-shot";

import ShareCard, { ShareCardProps } from "./ShareCard";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShareRunData {
  distanceMi: number;
  paceMinPerMile?: number | null;
  durationSeconds?: number | null;
  routePath?: { latitude: number; longitude: number }[];
  activityType?: "run" | "ride" | string;
  participantCount?: number;
  finishRank?: number;
  eventTitle?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  runData: ShareRunData;
}

type ActiveAction = "share" | "save" | "copy" | null;

// ─── Constants ────────────────────────────────────────────────────────────────

const PRIMARY = "#00D97E";
const BG = "#050C09";
const SURFACE = "#0D1510";
const CARD_BG = "#0A1410";
const TEXT = "#F0FFF4";
const TEXT_SEC = "#8FAF97";
const TEXT_MUTED = "#4A6957";
const BORDER = "#182B1F";
const GOLD = "#FFB800";

// ─── Component ────────────────────────────────────────────────────────────────

export default function ShareActivityModal({ visible, onClose, runData }: Props) {
  const insets = useSafeAreaInsets();
  const cardRef = useRef<View>(null);

  const [caption, setCaption] = useState("");
  const [backgroundPhoto, setBackgroundPhoto] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [captionFont, setCaptionFont] = useState<"Outfit_700Bold" | "PlayfairDisplay_700Bold" | "DancingScript_700Bold">("Outfit_700Bold");
  const [captionSize, setCaptionSize] = useState<20 | 32 | 46>(32);

  // ─── Capture card as image ─────────────────────────────────────────────────

  const captureCard = useCallback(async (): Promise<string | null> => {
    if (!cardRef.current) return null;
    try {
      const uri = await captureRef(cardRef, {
        format: "jpg",
        quality: 0.95,
        result: "tmpfile",
      });
      return uri;
    } catch (e: any) {
      Alert.alert("Capture failed", e.message || "Could not capture the card");
      return null;
    }
  }, []);

  // ─── Share to socials ──────────────────────────────────────────────────────

  const handleShare = useCallback(async () => {
    setActiveAction("share");
    try {
      const uri = await captureCard();
      if (!uri) return;
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert("Sharing not available", "Your device does not support sharing.");
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: "image/jpeg", dialogTitle: "Share your activity" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      if (!e.message?.includes("cancel")) {
        Alert.alert("Share failed", e.message || "Could not share the image");
      }
    } finally {
      setActiveAction(null);
    }
  }, [captureCard]);

  // ─── Save to camera roll ───────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setActiveAction("save");
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission required", "Please allow photo library access to save.");
        return;
      }
      const uri = await captureCard();
      if (!uri) return;
      await MediaLibrary.saveToLibraryAsync(uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Saved!", "Your activity card was saved to your camera roll.");
    } catch (e: any) {
      Alert.alert("Save failed", e.message || "Could not save the image");
    } finally {
      setActiveAction(null);
    }
  }, [captureCard]);

  // ─── Copy image ────────────────────────────────────────────────────────────

  const handleCopy = useCallback(async () => {
    setActiveAction("copy");
    try {
      const uri = await captureCard();
      if (!uri) return;
      // Expo Clipboard supports setImageAsync on native
      if (Platform.OS !== "web" && Clipboard.setImageAsync) {
        await Clipboard.setImageAsync(uri);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Copied!", "Activity card copied to clipboard.");
      } else {
        // Fallback: share with copy intent
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) await Sharing.shareAsync(uri, { mimeType: "image/jpeg" });
      }
    } catch (e: any) {
      Alert.alert("Copy failed", e.message || "Could not copy the image");
    } finally {
      setActiveAction(null);
    }
  }, [captureCard]);

  // ─── Pick background photo ─────────────────────────────────────────────────

  const handlePickPhoto = useCallback(async () => {
    if (Platform.OS !== "web") {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Allow photo library access to set a background photo.");
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [17, 10],
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]) {
      setBackgroundPhoto(result.assets[0].uri);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  const handleRemovePhoto = useCallback(() => {
    setBackgroundPhoto(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  // ─── Action button helper ──────────────────────────────────────────────────

  function ActionBtn({
    action,
    icon,
    label,
    color = TEXT,
    onPress,
  }: {
    action: ActiveAction;
    icon: string;
    label: string;
    color?: string;
    onPress: () => void;
  }) {
    const isLoading = activeAction === action;
    const isDisabled = activeAction !== null;
    return (
      <Pressable
        style={({ pressed }) => [
          st.actionBtn,
          { opacity: pressed || (isDisabled && !isLoading) ? 0.5 : 1 },
        ]}
        onPress={onPress}
        disabled={isDisabled}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={color} />
        ) : (
          <View style={[st.actionIconWrap, { borderColor: color + "44" }]}>
            <Feather name={icon as any} size={20} color={color} />
          </View>
        )}
        <Text style={[st.actionLabel, { color }]}>{label}</Text>
      </Pressable>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const cardProps: ShareCardProps = {
    ...runData,
    caption,
    backgroundPhoto,
    captionFont,
    captionSize,
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={st.container}>
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <View style={[st.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16) }]}>
          <View style={{ width: 40 }} />
          <Text style={st.headerTitle}>Share Activity</Text>
          <Pressable onPress={onClose} hitSlop={12} style={st.closeBtn}>
            <Feather name="x" size={20} color={TEXT_SEC} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={[st.content, { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 24) }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Card preview ─────────────────────────────────────────────── */}
          <View style={st.cardWrapper}>
            <View style={st.cardGlow} />
            <ShareCard ref={cardRef} {...cardProps} />
          </View>

          {/* ── Photo background control ──────────────────────────────────── */}
          <View style={st.photoRow}>
            <Pressable
              style={({ pressed }) => [st.photoBtn, { opacity: pressed ? 0.7 : 1 }]}
              onPress={backgroundPhoto ? handleRemovePhoto : handlePickPhoto}
            >
              <Ionicons
                name={backgroundPhoto ? "image" : "image-outline"}
                size={15}
                color={backgroundPhoto ? PRIMARY : TEXT_SEC}
                style={{ marginRight: 6 }}
              />
              <Text style={[st.photoBtnTxt, backgroundPhoto && { color: PRIMARY }]}>
                {backgroundPhoto ? "Remove Background Photo" : "Set Background Photo"}
              </Text>
            </Pressable>
          </View>

          {/* ── Caption input ─────────────────────────────────────────────── */}
          <View style={st.captionWrap}>
            <TextInput
              style={[st.captionInput, { fontFamily: captionFont, fontStyle: captionFont === "DancingScript_700Bold" ? "normal" : "italic" }]}
              placeholder="Add a caption…"
              placeholderTextColor={TEXT_MUTED}
              value={caption}
              onChangeText={setCaption}
              multiline
              maxLength={160}
              returnKeyType="done"
            />
            {caption.length > 0 && (
              <Text style={st.captionCount}>{160 - caption.length}</Text>
            )}
          </View>

          {/* ── Font + Size pickers ─────────────────────────────────────── */}
          {caption.length > 0 && (
            <>
              {/* Font style row */}
              <View style={st.fontPickerRow}>
                {(
                  [
                    { key: "Outfit_700Bold", label: "Aa" },
                    { key: "PlayfairDisplay_700Bold", label: "Aa" },
                    { key: "DancingScript_700Bold", label: "Aa" },
                  ] as const
                ).map(({ key, label }) => {
                  const active = captionFont === key;
                  return (
                    <Pressable
                      key={key}
                      style={[st.fontPill, active && st.fontPillActive]}
                      onPress={() => { setCaptionFont(key); Haptics.selectionAsync(); }}
                    >
                      <Text style={[st.fontPillTxt, { fontFamily: key }, active && st.fontPillTxtActive]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Size row */}
              <View style={st.fontPickerRow}>
                {(
                  [
                    { size: 20 as const, label: "S", display: 15 },
                    { size: 32 as const, label: "M", display: 20 },
                    { size: 46 as const, label: "L", display: 26 },
                  ]
                ).map(({ size, label, display }) => {
                  const active = captionSize === size;
                  return (
                    <Pressable
                      key={size}
                      style={[st.fontPill, active && st.fontPillActive]}
                      onPress={() => { setCaptionSize(size); Haptics.selectionAsync(); }}
                    >
                      <Text style={[st.fontPillTxt, { fontSize: display, fontFamily: captionFont }, active && st.fontPillTxtActive]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {/* ── Share action row ──────────────────────────────────────────── */}
          <View style={st.actionsRow}>
            <ActionBtn
              action="share"
              icon="share-2"
              label="Share"
              color={PRIMARY}
              onPress={handleShare}
            />
            <ActionBtn
              action="save"
              icon="download"
              label="Save"
              color={TEXT}
              onPress={handleSave}
            />
            <ActionBtn
              action="copy"
              icon="copy"
              label="Copy"
              color={TEXT}
              onPress={handleCopy}
            />
          </View>

          {/* ── Social hint ───────────────────────────────────────────────── */}
          <Text style={st.hint}>
            Tap Share to post to Instagram Stories, Snapchat, and more
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerTitle: {
    fontFamily: "Outfit_700Bold",
    fontSize: 17,
    color: TEXT,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },

  // Card
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    alignItems: "center",
    gap: 20,
  },
  cardWrapper: {
    position: "relative",
    borderRadius: 20,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
    elevation: 12,
  },
  cardGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    backgroundColor: PRIMARY + "18",
    transform: [{ scale: 1.02 }],
  },

  // Photo control
  photoRow: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "center",
  },
  photoBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  photoBtnTxt: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: TEXT_SEC,
  },

  // Caption
  captionWrap: {
    width: "100%",
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 56,
  },
  captionInput: {
    fontFamily: "Outfit_400Regular",
    fontSize: 14,
    color: TEXT,
    lineHeight: 20,
  },
  captionCount: {
    fontFamily: "Outfit_400Regular",
    fontSize: 11,
    color: TEXT_MUTED,
    textAlign: "right",
    marginTop: 4,
  },

  // Actions
  actionsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 24,
    width: "100%",
  },
  actionBtn: {
    alignItems: "center",
    gap: 8,
    minWidth: 72,
  },
  actionIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: SURFACE,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 12,
    color: TEXT_SEC,
  },

  // Font picker
  fontPickerRow: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
    justifyContent: "center",
  },
  fontPill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: SURFACE,
    borderWidth: 1.5,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  fontPillActive: {
    borderColor: PRIMARY,
    backgroundColor: PRIMARY + "18",
  },
  fontPillTxt: {
    fontSize: 18,
    color: TEXT_SEC,
  },
  fontPillTxtActive: {
    color: PRIMARY,
  },

  // Hint
  hint: {
    fontFamily: "Outfit_400Regular",
    fontSize: 12,
    color: TEXT_MUTED,
    textAlign: "center",
    lineHeight: 17,
    paddingHorizontal: 20,
  },
});
