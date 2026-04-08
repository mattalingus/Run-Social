import { getApiUrl } from "@/lib/query-client";

export function resolvePhotoUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/")) {
    const base = getApiUrl().replace(/\/$/, "");
    return `${base}${url}`;
  }
  return url;
}
