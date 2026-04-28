import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { getApiUrl } from "@/lib/query-client";

export type UploadPurpose = "profile" | "pin" | "crew" | "run-photo";

/**
 * Upload a local file URI to /api/upload/photo and return the absolute URL of
 * the uploaded image.
 *
 * On native, this uses `FileSystem.uploadAsync` (multipart) instead of a JS
 * `FormData` with `{ uri, name, type }`. The latter throws
 * "unsupported FormDataPart implementation" on newer React Native runtimes;
 * uploadAsync hits the native networking layer directly and shares cookies
 * with the rest of the app's fetch calls.
 *
 * On web, we fall back to fetch + Blob + FormData (the standard browser path).
 */
export async function uploadImageUri(uri: string, purpose: UploadPurpose, mimeType?: string): Promise<string> {
  const baseUrl = getApiUrl();
  const uploadUrl = new URL("/api/upload/photo", baseUrl).toString();

  if (Platform.OS === "web") {
    const fetchRes = await fetch(uri);
    const blob = await fetchRes.blob();
    const finalType = mimeType || blob.type || "image/jpeg";
    const ext = finalType === "image/png" ? "png" : "jpg";
    const filename = `${purpose}-${Date.now()}.${ext}`;
    const fd = new FormData();
    fd.append("photo", blob, filename);
    const r = await fetch(uploadUrl, { method: "POST", body: fd, credentials: "include" });
    if (!r.ok) throw new Error(`Upload failed: ${await r.text()}`);
    const { url } = await r.json();
    return typeof url === "string" && url.startsWith("/") ? new URL(url, baseUrl).toString() : (url as string);
  }

  // Native — multipart upload via expo-file-system. Avoids the
  // "unsupported FormDataPart implementation" crash on the new architecture.
  const mt = mimeType || (uri.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
  const ext = mt === "image/png" ? "png" : "jpg";
  const filename = `${purpose}-${Date.now()}.${ext}`;
  const result = await FileSystem.uploadAsync(uploadUrl, uri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "photo",
    mimeType: mt,
    parameters: { filename },
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Upload failed (${result.status}): ${result.body || "no body"}`);
  }
  let parsed: any;
  try { parsed = JSON.parse(result.body || "{}"); }
  catch { throw new Error("Upload returned non-JSON response"); }
  const url = parsed?.url;
  if (!url || typeof url !== "string") throw new Error("Upload response missing url");
  return url.startsWith("/") ? new URL(url, baseUrl).toString() : url;
}

export async function pickAndUploadImage(purpose: UploadPurpose): Promise<string | null> {
  if (Platform.OS !== "web") {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.82,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  return uploadImageUri(asset.uri, purpose, asset.mimeType ?? undefined);
}
