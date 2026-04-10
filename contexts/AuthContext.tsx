import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from "react";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { fetch } from "expo/fetch";
import AsyncStorage from "@react-native-async-storage/async-storage";

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
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
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

  useEffect(() => {
    fetchMe();
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

  async function tryRestoreSession(): Promise<User | null> {
    try {
      const token = await AsyncStorage.getItem(REMEMBER_TOKEN_KEY);
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
        if (!res.ok) {
          await clearToken();
          return null;
        }
        const data = await res.json();
        if (data.rememberToken) await storeToken(data.rememberToken);
        const { rememberToken: _t, ...userOnly } = data;
        return userOnly as User;
      } catch {
        clearTimeout(timer);
        return null;
      }
    } catch {
      return null;
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
      const baseUrl = getApiUrl();
      try {
        const res = await fetch(new URL("/api/auth/me", baseUrl).toString(), {
          credentials: "include",
        });
        if (res.ok) {
          const fresh = await res.json();
          setUser(fresh);
          await storeCachedUser(fresh);
          clearTimeout(emergencyTimer);
          if (!cached) setIsLoading(false);
          return;
        }
      } catch {}

      // Step 3: Session expired — try remember-token to re-establish HTTP session.
      const restored = await tryRestoreSession();
      if (restored) {
        setUser(restored);
        await storeCachedUser(restored);
      } else {
        // Both failed — clear cache and send to login
        await clearCachedUser();
        setUser(null);
      }
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
    await storeCachedUser(userOnly);
    setUser(userOnly);
  }

  async function register(email: string, password: string, firstName: string, lastName: string, username: string, gender: string | null) {
    const res = await apiRequest("POST", "/api/auth/register", { email, password, firstName, lastName, username, gender });
    const data = await res.json();
    if (data.rememberToken) await storeToken(data.rememberToken);
    const { rememberToken: _t, ...userOnly } = data;
    await storeCachedUser(userOnly);
    setUser(userOnly);
  }

  async function logout() {
    try {
      const token = await AsyncStorage.getItem(REMEMBER_TOKEN_KEY);
      await apiRequest("POST", "/api/auth/logout", { rememberToken: token ?? undefined });
    } catch {}
    await clearToken();
    await clearCachedUser();
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

  const value = useMemo(() => ({ user, isLoading, login, register, logout, refreshUser, updateUser }), [user, isLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
