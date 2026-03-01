import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import { getApiUrl } from "@/lib/query-client";

export type UploadPurpose = "profile" | "pin";

export async function pickAndUploadImage(purpose: UploadPurpose): Promise<string | null> {
  if (Platform.OS !== "web") {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      return null;
    }
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.82,
  });

  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  const uri = asset.uri;
  const ext = (uri.split(".").pop() || "jpg").toLowerCase().replace("jpeg", "jpg");
  const mimeType = ext === "png" ? "image/png" : "image/jpeg";
  const filename = `${purpose}-${Date.now()}.${ext}`;

  const formData = new FormData();
  formData.append("photo", {
    uri,
    type: mimeType,
    name: filename,
  } as any);

  const baseUrl = getApiUrl();
  const uploadUrl = new URL("/api/upload/photo", baseUrl).toString();

  const response = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Upload failed: ${err}`);
  }

  const { url } = await response.json();

  if (url.startsWith("/")) {
    return new URL(url, baseUrl).toString();
  }
  return url as string;
}
