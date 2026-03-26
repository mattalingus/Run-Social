import { Platform } from "react-native";
import * as Contacts from "expo-contacts";
import { apiRequest } from "@/lib/query-client";

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  return digits;
}

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPhone(phone: string): Promise<string> {
  const normalized = normalizePhone(phone);
  return sha256("paceup:" + normalized);
}

export interface ContactMatch {
  id: string;
  name: string;
  username: string | null;
  photo_url: string | null;
  total_miles: number;
  phone_hash: string;
  contactName?: string;
}

export interface NonMemberContact {
  name: string;
  phone: string;
}

export async function requestContactsPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const { status } = await Contacts.requestPermissionsAsync();
  return status === "granted";
}

export interface ContactScanResult {
  matches: ContactMatch[];
  nonMembers: NonMemberContact[];
}

export async function scanContacts(): Promise<ContactScanResult> {
  if (Platform.OS === "web") return { matches: [], nonMembers: [] };

  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
  });

  const hashToName = new Map<string, string>();
  const hashToPhone = new Map<string, string>();
  const hashes: string[] = [];

  for (const contact of data) {
    if (!contact.phoneNumbers) continue;
    for (const pn of contact.phoneNumbers) {
      if (!pn.number) continue;
      const normalized = normalizePhone(pn.number);
      if (normalized.length < 7) continue;
      const h = await hashPhone(pn.number);
      hashes.push(h);
      const cName = contact.name || contact.firstName || "Contact";
      hashToName.set(h, cName);
      hashToPhone.set(h, pn.number);
    }
  }

  if (hashes.length === 0) return { matches: [], nonMembers: [] };

  const res = await apiRequest("POST", "/api/users/find-by-contacts", { phoneHashes: hashes });
  const rawMatches: ContactMatch[] = await res.json();

  const matchedHashes = new Set(rawMatches.map((m) => m.phone_hash));

  const matches = rawMatches.map((m) => ({
    ...m,
    contactName: hashToName.get(m.phone_hash),
  }));

  const nonMembers: NonMemberContact[] = [];
  const seenPhones = new Set<string>();
  for (const h of hashes) {
    if (matchedHashes.has(h)) continue;
    const phone = hashToPhone.get(h);
    const name = hashToName.get(h);
    if (phone && name && !seenPhones.has(phone)) {
      seenPhones.add(phone);
      nonMembers.push({ name, phone });
    }
  }

  return { matches, nonMembers: nonMembers.slice(0, 50) };
}

export async function registerMyPhone(phone: string): Promise<void> {
  const h = await hashPhone(phone);
  await apiRequest("POST", "/api/users/update-phone", { phoneHash: h });
}
