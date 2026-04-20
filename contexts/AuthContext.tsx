import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from "react";
import { apiRequest, getApiUrl, setHandleSuspendedSession } from "@/lib/query-client";
import { fetch } from "expo/fetch";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const SUSPENDED_NOTICE_KEY = "paceup_suspended_notice";

const REMEMBER_TOKEN_KEY = "paceup_remember_token";
const CACHED_USER_KEY = "paceup_cached_user";

interface User {
  id: string;
  email: string;
  name: string;
  photo_url?: string;
  avg_pace: number;
  avg_distance: number;
  total_miles: number;
  miles_this_year: number;
  miles_this_month: number;
  monthly_goal: number;
  yearly_goal: number;
  completed_runs: number;
  hosted_runs: number;
  host_unlocked: boolean;
  role: "runner" | "host";
  avg_rating: number;
  rating_count: number;
  notifications_enabled: boolean;
  marker_icon?: string | null;
  pace_goal?: number | null;
  distance_goal?: number;
  goal_period?: string;
  gender?: string | null;
  onboarding_complete?: boolean;
  default_activity?: string;
  email_verified?: boolean;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  /** True whenever suspension is detected, regardless of whether a lift-date timestamp is available. */
  isSuspended: boolean;
  /** ISO timestamp of suspension lift, or null if not provided by the server. */
  suspendedUntil: string | null;
  login: (identifier: string, password: string) => Promise<void>;
  register: (email: string, password: string, firstName: string, lastName: string, username: string, gender: string | null) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateUser: (updates: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSuspended, setIsSuspended] = useState(false);
  const [suspendedUntil, setSuspendedUntil] = useState<string | null>(null);

  function markSuspended(until: string | null | undefined) {
    setIsSuspended(true);
    setSuspendedUntil(until ?? null);
  }

  function clearSuspendedState() {
    setIsSuspended(false);
    setSuspendedUntil(null);
    AsyncStorage.removeItem(SUSPENDED_NOTICE_KEY).catch(() => {});
  }

  useEffect(() => {
    fetchMe();
  }, []);

  useEffect(() => {
    setHandleSuspendedSession(async (suspendedUntilDate?: string) => {
      await clearToken();
      await clearCachedUser();
      const notice = suspendedUntilDate ?? "1";
      await AsyncStorage.setItem(SUSPENDED_NOTICE_KEY, notice).catch(() => {});
      markSuspended(suspendedUntilDate);
      setUser(null);
    });
    return () => setHandleSuspendedSession(null);
  }, []);

  async function storeToken(token: string) {
    try {
      await AsyncStorage.setItem(REMEMBER_TOKEN_KEY, token);
    } catch {}
  }

  async function clearToken() {
    try {
      await AsyncStorage.removeItem(REMEMBER_TOKEN_KEY);
    } catch {}
  }

  async function storeCachedUser(u: User) {
    try {
      await AsyncStorage.setItem(CACHED_USER_KEY, JSON.stringify(u));
    } catch {}
  }

  async function clearCachedUser() {
    try {
      await AsyncStorage.removeItem(CACHED_USER_KEY);
    } catch {}
  }

  async function readCachedUser(): Promise<User | null> {
    try {
      const raw = await AsyncStorage.getItem(CACHED_USER_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as User;
    } catch {
      return null;
    }
  }

  // Returns:
  //   User            — server accepted the token, session re-established
  //   "suspended"     — account is suspended (definitive, clears token + sets notice)
  //   null            — server EXPLICITLY rejected credentials (401 or 400 only) — safe to log out
  //   "network_error" — fetch threw / AbortError / timeout / 5xx — keep cached user, not definitive
  async function tryRestoreSession(): Promise<User | null | "network_error" | "suspended"> {
    let token: string | null = null;
    try {
      token = await AsyncStorage.getItem(REMEMBER_TOKEN_KEY);
    } catch {
      return "network_error";
    }
    if (!token) return null;

    const baseUrl = getApiUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(new URL("/api/auth/restore-session", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        credentials: "include",
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        if (data.error === "suspended") {
          const until = data.suspended_until ?? null;
          await clearToken();
          await AsyncStorage.setItem(SUSPENDED_NOTICE_KEY, until ?? "1").catch(() => {});
          markSuspended(until);
          return "suspended";
        }
        // 403 but not a suspension — treat as definitive auth failure
        await clearToken();
        return null;
      }
      if (res.status === 401 || res.status === 400) {
        // Server definitively rejected the token — credentials are invalid
        await clearToken();
        return null;
      }
      if (!res.ok) {
        // Non-auth failure (5xx, 503, etc.) — transient server error, not a definitive rejection
        return "network_error";
      }
      const data = await res.json();
      if (data.rememberToken) await storeToken(data.rememberToken);
      const { rememberToken: _t, ...userOnly } = data;
      return userOnly as User;
    } catch {
      // Fetch threw (timeout, network unreachable, AbortError) — not a definitive rejection
      clearTimeout(timer);
      return "network_error";
    }
  }

  async function fetchMe() {
    // Safety net: clear loading after 10s no matter what (last resort only)
    const emergencyTimer = setTimeout(() => setIsLoading(false), 10000);

    try {
      // Step 1: Read locally cached user — instant (~20ms), no network needed.
      // This clears the splash screen immediately on every reopen after first login.
      const cached = await readCachedUser();
      if (cached) {
        setUser(cached);
        setIsLoading(false);
      }

      // Step 2: Verify session with server in background.
      // If cached user was set above, the app is already visible — this just refreshes data.
      // When there is no cached user, use a bounded timeout so restore-session can still run.
      const baseUrl = getApiUrl();
      try {
        const meController = new AbortController();
        const meTimer = cached ? null : setTimeout(() => meController.abort(), 6000);
        const res = await fetch(new URL("/api/auth/me", baseUrl).toString(), {
          credentials: "include",
          signal: meController.signal,
        });
        if (meTimer) clearTimeout(meTimer);
        if (res.ok) {
          const fresh = await res.json();
          clearSuspendedState();
          setUser(fresh);
          await storeCachedUser(fresh);
          if (!cached) setIsLoading(false);
          return;
        }
        // Explicit suspension check from /api/auth/me — fail closed, clear everything
        if (res.status === 403) {
          const data = await res.json().catch(() => ({}));
          if (data.error === "suspended") {
            const until = data.suspended_until ?? null;
            await clearToken();
            await clearCachedUser();
            await AsyncStorage.setItem(SUSPENDED_NOTICE_KEY, until ?? "1").catch(() => {});
            markSuspended(until);
            setUser(null);
            return;
          }
        }
      } catch {}

      // Step 3: /api/auth/me failed — try remember-token to re-establish HTTP session.
      const restoreResult = await tryRestoreSession();

      if (restoreResult === "suspended") {
        // Definitive suspension — clear any cached user, keep suspendedUntil already set
        await clearCachedUser();
        setUser(null);
      } else if (restoreResult && restoreResult !== "network_error") {
        // Server accepted the token — session re-established, update user and cache
        const freshUser = restoreResult as User;
        clearSuspendedState();
        setUser(freshUser);
        await storeCachedUser(freshUser);
      } else if (!cached) {
        // No cached user AND restore did not return a fresh user → must go to login.
        // (covers: no token, network error, 5xx, definitive 401/400 rejection)
        setUser(null);
      }
      // else: we have a cached user — keep them logged in regardless of why restore failed.
      // POLICY: the only way to log a user out is explicit logout() — not background failures.
      // Rationale: the iOS session cookie persists in NSHTTPCookieStorage and the PostgreSQL
      // session is likely still valid. restore-session POST is known to silently fail on iOS
      // (confirmed: zero production server hits) so a network failure here is NOT a signal
      // that credentials are invalid. clearCachedUser() is ONLY ever called from logout().
    } finally {
      clearTimeout(emergencyTimer);
      setIsLoading(false);
    }
  }

  async function login(identifier: string, password: string) {
    const res = await apiRequest("POST", "/api/auth/login", { identifier, password });
    const data = await res.json();
    if (data.rememberToken) await storeToken(data.rememberToken);
    const { rememberToken: _t, ...userOnly } = data;
    clearSuspendedState();
    await storeCachedUser(userOnly);
    setUser(userOnly);
  }

  async function register(email: string, password: string, firstName: string, lastName: string, username: string, gender: string | null) {
    const res = await apiRequest("POST", "/api/auth/register", { email, password, firstName, lastName, username, gender });
    const data = await res.json();
    if (data.rememberToken) await storeToken(data.rememberToken);
    const { rememberToken: _t, ...userOnly } = data;
    clearSuspendedState();
    await storeCachedUser(userOnly);
    setUser(userOnly);
  }

  async function logout() {
    try {
      // Unregister push token first so the server stops sending notifications
      // to this device for this user. If this fails (offline), logout still proceeds.
      await apiRequest("POST", "/api/users/me/push-token", { token: null });
    } catch {}
    try {
      const token = await AsyncStorage.getItem(REMEMBER_TOKEN_KEY);
      await apiRequest("POST", "/api/auth/logout", { rememberToken: token ?? undefined });
    } catch {}
    await clearToken();
    await clearCachedUser();
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const paceupKeys = allKeys.filter((k) => k.startsWith("@paceup_") || k.startsWith("paceup_"));
      if (paceupKeys.length > 0) await AsyncStorage.multiRemove(paceupKeys);
    } catch {}
    setIsSuspended(false);
    setSuspendedUntil(null);
    setUser(null);
  }

  async function refreshUser() {
    await fetchMe();
  }

  function updateUser(updates: Partial<User>) {
    setUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      storeCachedUser(updated);
      return updated;
    });
  }

  const value = useMemo(() => ({ user, isLoading, isSuspended, suspendedUntil, login, register, logout, refreshUser, updateUser }), [user, isLoading, isSuspended, suspendedUntil]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
