import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "./AuthContext";
import { getApiUrl } from "@/lib/query-client";
import { fetch } from "expo/fetch";

type NotifEventListener = () => void;
const openNotifListeners = new Set<NotifEventListener>();
export function onOpenNotifications(listener: NotifEventListener) {
  openNotifListeners.add(listener);
  return () => { openNotifListeners.delete(listener); };
}
export function emitOpenNotifications() {
  openNotifListeners.forEach(l => l());
}

const SEEN_IDS_PREFIX = "@notification_banner_seen_ids:";
const MAX_SEEN_IDS = 500;

function getSeenIdsKey(userId: string) {
  return `${SEEN_IDS_PREFIX}${userId}`;
}

export interface BannerNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: any;
  from_name?: string;
  from_photo?: string;
  crew_id?: string;
  crew_name?: string;
  emoji?: string;
  invited_by_name?: string;
  created_at: string;
}

interface NotificationBannerContextType {
  bannerQueue: BannerNotification[];
  dismissBanner: () => void;
  dismissAll: () => void;
  respondToFriend: (id: string, action: "accept" | "decline") => Promise<void>;
  respondToCrew: (crewId: string, action: "accept" | "decline") => Promise<void>;
}

const NotificationBannerContext = createContext<NotificationBannerContextType>({
  bannerQueue: [],
  dismissBanner: () => {},
  dismissAll: () => {},
  respondToFriend: async () => {},
  respondToCrew: async () => {},
});

export function useNotificationBanner() {
  return useContext(NotificationBannerContext);
}

export function NotificationBannerProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [bannerQueue, setBannerQueue] = useState<BannerNotification[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);
  const firstPollRef = useRef(true);

  useEffect(() => {
    if (!user) {
      seenIdsRef.current = new Set();
      setHydrated(false);
      firstPollRef.current = true;
      setBannerQueue([]);
      return;
    }

    (async () => {
      try {
        const stored = await AsyncStorage.getItem(getSeenIdsKey(user.id));
        if (stored) {
          const parsed = JSON.parse(stored) as string[];
          seenIdsRef.current = new Set(parsed);
        } else {
          seenIdsRef.current = new Set();
        }
      } catch {}
      setHydrated(true);
    })();
  }, [user]);

  const persistSeenIds = useCallback(async (ids: Set<string>) => {
    if (!user) return;
    try {
      const arr = Array.from(ids);
      const trimmed = arr.length > MAX_SEEN_IDS ? arr.slice(arr.length - MAX_SEEN_IDS) : arr;
      await AsyncStorage.setItem(getSeenIdsKey(user.id), JSON.stringify(trimmed));
    } catch {}
  }, [user]);

  useEffect(() => {
    if (!user || !hydrated) return;

    const poll = async () => {
      try {
        const baseUrl = getApiUrl();
        const url = new URL("/api/notifications", baseUrl);
        const res = await fetch(url.toString(), { credentials: "include" });
        if (!res.ok) return;
        const notifications: BannerNotification[] = await res.json();

        if (firstPollRef.current) {
          firstPollRef.current = false;
          const allIds = notifications.map(n => n.id);
          allIds.forEach(id => seenIdsRef.current.add(id));
          persistSeenIds(seenIdsRef.current);
          return;
        }

        const newNotifs = notifications.filter(n => !seenIdsRef.current.has(n.id));
        if (newNotifs.length > 0) {
          newNotifs.forEach(n => seenIdsRef.current.add(n.id));
          persistSeenIds(seenIdsRef.current);
          setBannerQueue(prev => {
            const existingIds = new Set(prev.map(p => p.id));
            const fresh = newNotifs.filter(n => !existingIds.has(n.id));
            return [...prev, ...fresh];
          });
        }
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
  }, [user, hydrated, persistSeenIds]);

  const dismissBanner = useCallback(() => {
    setBannerQueue(prev => prev.slice(1));
  }, []);

  const dismissAll = useCallback(() => {
    setBannerQueue([]);
  }, []);

  const respondToFriend = useCallback(async (id: string, action: "accept" | "decline") => {
    try {
      const baseUrl = getApiUrl();
      const res = await fetch(new URL("/api/friends/respond", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ friendshipId: id, action }),
      });
      if (res.ok) {
        setBannerQueue(prev => prev.filter(n => n.id !== id));
      }
    } catch {}
  }, []);

  const respondToCrew = useCallback(async (crewId: string, action: "accept" | "decline") => {
    try {
      const baseUrl = getApiUrl();
      const res = await fetch(new URL("/api/crews/invites/respond", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ crewId, action }),
      });
      if (res.ok) {
        setBannerQueue(prev => prev.filter(n => n.crew_id !== crewId));
      }
    } catch {}
  }, []);

  return (
    <NotificationBannerContext.Provider value={{ bannerQueue, dismissBanner, dismissAll, respondToFriend, respondToCrew }}>
      {children}
    </NotificationBannerContext.Provider>
  );
}
