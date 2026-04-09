import { Platform } from "react-native";

export const STORE_URL_IOS =
  "https://apps.apple.com/us/app/paceup-move-together/id6760092871";
export const STORE_URL_ANDROID = "https://play.google.com/store/apps/details?id=com.paceup";
export const WEBSITE_URL = "https://paceupapp.com";

export function getAppStoreUrl(): string {
  return Platform.OS === "ios" ? STORE_URL_IOS : STORE_URL_ANDROID;
}

export function getAppShareUrl(): string {
  return Platform.OS === "ios" ? STORE_URL_IOS : WEBSITE_URL;
}

export function buildSmsUrl(body: string, phone?: string): string {
  const encodedBody = encodeURIComponent(body);
  if (phone) {
    const cleanPhone = phone.replace(/\D/g, "");
    return Platform.OS === "ios"
      ? `sms:${cleanPhone}&body=${encodedBody}`
      : `sms:${cleanPhone}?body=${encodedBody}`;
  }
  return Platform.OS === "ios"
    ? `sms:?&body=${encodedBody}`
    : `sms:?body=${encodedBody}`;
}

export function buildAppInviteSmsUrl(phone?: string): string {
  const appUrl = getAppShareUrl();
  const body = `Hey! Join me on PaceUp for group runs & rides: ${appUrl}`;
  return buildSmsUrl(body, phone);
}

export function buildOnboardingInviteSmsUrl(): string {
  const appUrl = getAppShareUrl();
  const body = `Hey! Join me on PaceUp — the app for group runs, rides & walks. Download it here: ${appUrl} 🏃`;
  return buildSmsUrl(body);
}

export function buildAppInviteMessage(): string {
  const appUrl = getAppShareUrl();
  return `Join me on PaceUp — discover group runs & rides! Download it here: ${appUrl}`;
}

export function getInstagramStoriesScheme(): string {
  return "instagram-stories://share";
}

export function getInstagramScheme(): string {
  return "instagram://camera";
}

export function getSnapchatScheme(): string {
  return "snapchat://";
}

export function getFacebookStoriesScheme(): string {
  return "facebook-stories://share";
}

export function getFacebookScheme(): string {
  return "fb://";
}
