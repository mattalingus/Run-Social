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
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons, FontAwesome5 } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import { captureRef } from "react-native-view-shot";
import { LinearGradient } from "expo-linear-gradient";

let RNShare: any = null;
try {
  RNShare = require("react-native-share").default;
} catch {}

import ShareCard, { ShareCardProps } from "./ShareCard";
import { useTheme } from "@/contexts/ThemeContext";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShareRunData {
  distanceMi: number;
  paceMinPerMile?: number | null;
  durationSeconds?: number | null;
  routePath?: { latitude: number; longitude: number }[];
  activityType?: "run" | "ride" | "walk" | string;
  participantCount?: number;
  finishRank?: number;
  eventTitle?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  runData: ShareRunData;
  eventPhotos?: string[];
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

const CheckerboardBg = React.memo(function CheckerboardBg() {
  const TILE = 20;
  const cols = Math.ceil(360 / TILE);
  const rows = Math.ceil(640 / TILE);
  return (
    <View style={{ position: "absolute", width: 360, height: 640, borderRadius: 20, overflow: "hidden" }}>
      {Array.from({ length: rows }, (_, r) => (
        <View key={r} style={{ flexDirection: "row", height: TILE }}>
          {Array.from({ length: cols }, (_, c) => (
            <View key={c} style={{ width: TILE, height: TILE, backgroundColor: (r + c) % 2 === 0 ? "#1C1C1C" : "#2A2A2A" }} />
          ))}
        </View>
      ))}
    </View>
  );
});

// ─── Component ────────────────────────────────────────────────────────────────

export default function ShareActivityModal({ visible, onClose, runData, eventPhotos = [] }: Props) {
  const insets = useSafeAreaInsets();
  const { C } = useTheme();
  const cardRef = useRef<View>(null);

  const [caption, setCaption] = useState("");
  const [backgroundPhoto, setBackgroundPhoto] = useState<string | null>(null);
  const [collageMode, setCollageMode] = useState(false);
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [captionFont, setCaptionFont] = useState<"Outfit_700Bold" | "PlayfairDisplay_700Bold" | "DancingScript_700Bold">("Outfit_700Bold");
  const [captionSize, setCaptionSize] = useState<20 | 32 | 46>(32);
  const [transparentMode, setTransparentMode] = useState(true);
  const [layoutIndex, setLayoutIndex] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);

  const themeBg = C.bg;
  const themeSurface = C.surface;
  const themeText = C.text;
  const themeTextSec = C.textSecondary;
  const themeTextMuted = C.textMuted;
  const themeBorder = C.border;

  const isGroupRun = (runData.participantCount ?? 1) > 1;
  const hasGroupPhotos = isGroupRun && eventPhotos.length >= 2;

  // ─── Capture card as image ─────────────────────────────────────────────────

  const captureCard = useCallback(async (): Promise<string | null> => {
    if (!cardRef.current) return null;
    try {
      setIsCapturing(true);
      await new Promise((r) => setTimeout(r, 50));
      const uri = await captureRef(cardRef, {
        format: transparentMode ? "png" : "jpg",
        quality: 0.95,
        result: "tmpfile",
      });
      return uri;
    } catch (e: any) {
      Alert.alert("Capture failed", e.message || "Could not capture the card");
      return null;
    } finally {
      setIsCapturing(false);
    }
  }, [transparentMode]);

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
      const mime = transparentMode ? "image/png" : "image/jpeg";
      await Sharing.shareAsync(uri, { mimeType: mime, dialogTitle: "Share your activity" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      if (!e.message?.includes("cancel")) {
        Alert.alert("Share failed", e.message || "Could not share the image");
      }
    } finally {
      setActiveAction(null);
    }
  }, [captureCard, transparentMode]);

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
        const mime = transparentMode ? "image/png" : "image/jpeg";
        if (canShare) await Sharing.shareAsync(uri, { mimeType: mime });
      }
    } catch (e: any) {
      Alert.alert("Copy failed", e.message || "Could not copy the image");
    } finally {
      setActiveAction(null);
    }
  }, [captureCard]);

  // ─── Platform deep-link sharing ────────────────────────────────────────────

  const fallbackShare = useCallback(async (uri: string | null) => {
    if (!uri) return;
    const canShare = await Sharing.isAvailableAsync();
    const mime = transparentMode ? "image/png" : "image/jpeg";
    if (canShare) await Sharing.shareAsync(uri, { mimeType: mime, dialogTitle: "Share your activity" });
  }, [transparentMode]);

  const saveToLibraryQuietly = useCallback(async (uri: string): Promise<boolean> => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") return false;
      await MediaLibrary.saveToLibraryAsync(uri);
      return true;
    } catch {
      return false;
    }
  }, []);

  const shareToInstagram = useCallback(async () => {
    setActiveAction("share");
    try {
      const uri = await captureCard();
      if (!uri) return;
      if (Platform.OS === "web") {
        await fallbackShare(uri);
        return;
      }
      const canOpen = await Linking.canOpenURL("instagram-stories://share");
      if (!canOpen) {
        Alert.alert("Instagram Not Found", "Instagram is not installed on this device.", [
          { text: "Share Anyway", onPress: () => fallbackShare(uri) },
          { text: "Cancel", style: "cancel" },
        ]);
        return;
      }

      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });

      if (transparentMode && RNShare) {
        await saveToLibraryQuietly(uri);
        await RNShare.shareSingle({
          social: RNShare.Social?.INSTAGRAM_STORIES ?? "instagramstories",
          stickerImage: `data:image/png;base64,${base64}`,
          backgroundBottomColor: "#000000",
          backgroundTopColor: "#000000",
          appId: "com.paceup",
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        await Clipboard.setImageAsync(base64);
        await saveToLibraryQuietly(uri);
        try {
          await Linking.openURL("instagram-stories://share");
        } catch {
          await Linking.openURL("instagram://camera");
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Ready to Share", "Your activity card has been copied. Paste it into your Instagram Story.");
      }
    } catch (e: any) {
      if (!e.message?.includes("cancel")) {
        const uri = await captureCard();
        await fallbackShare(uri);
      }
    } finally {
      setActiveAction(null);
    }
  }, [captureCard, fallbackShare, saveToLibraryQuietly, transparentMode]);

  const shareToSnapchat = useCallback(async () => {
    setActiveAction("share");
    try {
      const uri = await captureCard();
      if (!uri) return;
      if (Platform.OS === "web") {
        await fallbackShare(uri);
        return;
      }
      const canOpen = await Linking.canOpenURL("snapchat://");
      if (canOpen) {
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        await Clipboard.setImageAsync(base64);
        await saveToLibraryQuietly(uri);
        await Linking.openURL("snapchat://");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Ready to Share", "Your activity card has been copied and saved. Paste it into your Snapchat Snap.");
      } else {
        Alert.alert("Snapchat Not Found", "Snapchat is not installed on this device.", [
          { text: "Share Anyway", onPress: () => fallbackShare(uri) },
          { text: "Cancel", style: "cancel" },
        ]);
      }
    } catch (e: any) {
      if (!e.message?.includes("cancel")) {
        const uri = await captureCard();
        await fallbackShare(uri);
      }
    } finally {
      setActiveAction(null);
    }
  }, [captureCard, fallbackShare, saveToLibraryQuietly]);

  const shareToFacebook = useCallback(async () => {
    setActiveAction("share");
    try {
      const uri = await captureCard();
      if (!uri) return;
      if (Platform.OS === "web") {
        await fallbackShare(uri);
        return;
      }
      const canOpen = await Linking.canOpenURL("fb://");
      if (canOpen) {
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        await Clipboard.setImageAsync(base64);
        await saveToLibraryQuietly(uri);
        try {
          await Linking.openURL("facebook-stories://share");
        } catch {
          await Linking.openURL("fb://");
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Ready to Share", "Your activity card has been copied and saved. Paste it into your Facebook Story.");
      } else {
        Alert.alert("Facebook Not Found", "Facebook is not installed on this device.", [
          { text: "Share Anyway", onPress: () => fallbackShare(uri) },
          { text: "Cancel", style: "cancel" },
        ]);
      }
    } catch (e: any) {
      if (!e.message?.includes("cancel")) {
        const uri = await captureCard();
        await fallbackShare(uri);
      }
    } finally {
      setActiveAction(null);
    }
  }, [captureCard, fallbackShare, saveToLibraryQuietly]);

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

  const handleCardTap = useCallback(() => {
    if (!collageMode) {
      setLayoutIndex((prev) => (prev + 1) % 4);
      Haptics.selectionAsync();
    }
  }, [collageMode]);

  function ActionBtn({
    action,
    icon,
    label,
    color = themeText,
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
          <View style={[st.actionIconWrap, { borderColor: color + "44", backgroundColor: themeSurface }]}>
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
    backgroundPhoto: transparentMode ? null : backgroundPhoto,
    collagePhotos: collageMode && !transparentMode ? eventPhotos : undefined,
    captionFont,
    captionSize,
    transparentMode,
    layoutIndex,
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[st.container, { backgroundColor: themeBg }]}>
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <View style={[st.header, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 16), borderBottomColor: themeBorder }]}>
          <View style={{ width: 40 }} />
          <Text style={[st.headerTitle, { color: themeText }]}>Share Activity</Text>
          <Pressable onPress={onClose} hitSlop={12} style={[st.closeBtn, { backgroundColor: themeSurface, borderColor: themeBorder }]}>
            <Feather name="x" size={20} color={themeTextSec} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={[st.content, { paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 24) }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Card preview ─────────────────────────────────────────────── */}
          <Pressable onPress={handleCardTap} style={st.cardWrapper}>
            {!transparentMode && <View style={st.cardGlow} />}
            {transparentMode && <CheckerboardBg />}
            <ShareCard ref={cardRef} {...cardProps} hideDots={isCapturing} />
          </Pressable>

          {/* ── Photo background controls ─────────────────────────────────── */}
          <View style={st.photoRow}>
            {/* Transparent — first / default option */}
            <Pressable
              style={({ pressed }) => [
                st.photoBtn,
                { backgroundColor: themeSurface, borderColor: themeBorder },
                transparentMode && st.photoBtnActive,
                { opacity: pressed ? 0.7 : (backgroundPhoto || collageMode ? 0.4 : 1) },
              ]}
              onPress={() => {
                if (backgroundPhoto || collageMode) return;
                setTransparentMode((prev) => !prev);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              disabled={!!backgroundPhoto || collageMode}
            >
              <Ionicons
                name={transparentMode ? "layers" : "layers-outline"}
                size={15}
                color={transparentMode ? PRIMARY : themeTextSec}
                style={{ marginRight: 6 }}
              />
              <Text style={[st.photoBtnTxt, { color: themeTextSec }, transparentMode && { color: PRIMARY }]}>
                Transparent
              </Text>
            </Pressable>

            {/* Background Photo — second option */}
            <Pressable
              style={({ pressed }) => [st.photoBtn, { backgroundColor: themeSurface, borderColor: themeBorder }, backgroundPhoto && st.photoBtnActive, { opacity: pressed ? 0.7 : (collageMode || transparentMode ? 0.4 : 1) }]}
              onPress={() => {
                if (collageMode || transparentMode) return;
                if (backgroundPhoto) {
                  handleRemovePhoto();
                } else {
                  handlePickPhoto();
                }
              }}
              disabled={collageMode || transparentMode}
            >
              <Ionicons
                name={backgroundPhoto ? "image" : "image-outline"}
                size={15}
                color={backgroundPhoto ? PRIMARY : themeTextSec}
                style={{ marginRight: 6 }}
              />
              <Text style={[st.photoBtnTxt, { color: themeTextSec }, backgroundPhoto && { color: PRIMARY }]}>
                {backgroundPhoto ? "Remove Photo" : "Add Photo"}
              </Text>
            </Pressable>

            {hasGroupPhotos && (
              <Pressable
                style={({ pressed }) => [
                  st.photoBtn,
                  { backgroundColor: themeSurface, borderColor: themeBorder },
                  collageMode && st.photoBtnActive,
                  { opacity: pressed ? 0.7 : (backgroundPhoto || transparentMode ? 0.4 : 1) },
                ]}
                onPress={() => {
                  if (backgroundPhoto || transparentMode) return;
                  setCollageMode((prev) => !prev);
                }}
                disabled={!!backgroundPhoto || transparentMode}
              >
                <Ionicons
                  name={collageMode ? "grid" : "grid-outline"}
                  size={15}
                  color={collageMode ? PRIMARY : themeTextSec}
                  style={{ marginRight: 6 }}
                />
                <Text style={[st.photoBtnTxt, { color: themeTextSec }, collageMode && { color: PRIMARY }]}>
                  Collage ({eventPhotos.length})
                </Text>
              </Pressable>
            )}
          </View>

          {/* ── Caption input ─────────────────────────────────────────────── */}
          <View style={[st.captionWrap, { backgroundColor: themeSurface, borderColor: themeBorder }]}>
            <TextInput
              style={[st.captionInput, { fontFamily: captionFont, fontStyle: captionFont === "DancingScript_700Bold" ? "normal" : "italic", color: themeText }]}
              placeholder="Add a caption…"
              placeholderTextColor={themeTextMuted}
              value={caption}
              onChangeText={setCaption}
              multiline
              maxLength={160}
              returnKeyType="done"
            />
            {caption.length > 0 && (
              <Text style={[st.captionCount, { color: themeTextMuted }]}>{160 - caption.length}</Text>
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
                      style={[st.fontPill, { backgroundColor: themeSurface, borderColor: themeBorder }, active && st.fontPillActive]}
                      onPress={() => { setCaptionFont(key); Haptics.selectionAsync(); }}
                    >
                      <Text style={[st.fontPillTxt, { fontFamily: key, color: themeTextSec }, active && st.fontPillTxtActive]}>
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
                      style={[st.fontPill, { backgroundColor: themeSurface, borderColor: themeBorder }, active && st.fontPillActive]}
                      onPress={() => { setCaptionSize(size); Haptics.selectionAsync(); }}
                    >
                      <Text style={[st.fontPillTxt, { fontSize: display, fontFamily: captionFont, color: themeTextSec }, active && st.fontPillTxtActive]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {/* ── Social platform buttons ──────────────────────────────────── */}
          <View style={st.socialRow}>
            <Text style={[st.socialLabel, { color: themeTextSec }]}>Share to</Text>
            <View style={st.socialIcons}>
              <Pressable
                style={({ pressed }) => [st.socialBtn, { opacity: pressed ? 0.7 : 1 }]}
                onPress={shareToInstagram}
                disabled={activeAction !== null}
              >
                <LinearGradient
                  colors={["#F58529", "#DD2A7B", "#8134AF", "#515BD4"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={st.socialIconCircle}
                >
                  <FontAwesome5 name="instagram" size={18} color="#fff" />
                </LinearGradient>
                <Text style={[st.socialBtnLabel, { color: themeTextSec }]}>Instagram</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [st.socialBtn, { opacity: pressed ? 0.7 : 1 }]}
                onPress={shareToSnapchat}
                disabled={activeAction !== null}
              >
                <View style={[st.socialIconCircle, { backgroundColor: "#FFFC00" }]}>
                  <FontAwesome5 name="snapchat-ghost" size={18} color="#000" />
                </View>
                <Text style={[st.socialBtnLabel, { color: themeTextSec }]}>Snapchat</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [st.socialBtn, { opacity: pressed ? 0.7 : 1 }]}
                onPress={shareToFacebook}
                disabled={activeAction !== null}
              >
                <View style={[st.socialIconCircle, { backgroundColor: "#1877F2" }]}>
                  <FontAwesome5 name="facebook-f" size={18} color="#fff" />
                </View>
                <Text style={[st.socialBtnLabel, { color: themeTextSec }]}>Facebook</Text>
              </Pressable>

            </View>
          </View>

          {/* ── Share action row ──────────────────────────────────────────── */}
          <View style={st.actionsRow}>
            <ActionBtn
              action="share"
              icon="share-2"
              label="More"
              color={PRIMARY}
              onPress={handleShare}
            />
            <ActionBtn
              action="save"
              icon="download"
              label="Save"
              color={themeText}
              onPress={handleSave}
            />
            <ActionBtn
              action="copy"
              icon="copy"
              label="Copy"
              color={themeText}
              onPress={handleCopy}
            />
          </View>
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
    shadowOpacity: 0.10,
    shadowRadius: 12,
    elevation: 6,
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
    gap: 10,
  },
  photoBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  photoBtnActive: {
    borderColor: PRIMARY,
    backgroundColor: PRIMARY + "18",
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

  // Social platform row
  socialRow: {
    width: "100%",
    alignItems: "center",
    gap: 12,
  },
  socialLabel: {
    fontFamily: "Outfit_600SemiBold",
    fontSize: 13,
    color: TEXT_SEC,
    letterSpacing: 0.5,
  },
  socialIcons: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
  },
  socialBtn: {
    alignItems: "center",
    gap: 6,
  },
  socialIconCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  socialBtnLabel: {
    fontFamily: "Outfit_400Regular",
    fontSize: 10,
    color: TEXT_SEC,
  },
});
