import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from "react";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { fetch } from "expo/fetch";

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
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
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

  async function fetchMe() {
    try {
      const baseUrl = getApiUrl();
      const res = await fetch(new URL("/api/auth/me", baseUrl).toString(), { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function login(email: string, password: string) {
    const res = await apiRequest("POST", "/api/auth/login", { email, password });
    const data = await res.json();
    setUser(data);
  }

  async function register(email: string, password: string, name: string) {
    const res = await apiRequest("POST", "/api/auth/register", { email, password, name });
    const data = await res.json();
    setUser(data);
  }

  async function logout() {
    await apiRequest("POST", "/api/auth/logout", {});
    setUser(null);
  }

  async function refreshUser() {
    await fetchMe();
  }

  function updateUser(updates: Partial<User>) {
    setUser((prev) => (prev ? { ...prev, ...updates } : prev));
  }

  const value = useMemo(() => ({ user, isLoading, login, register, logout, refreshUser, updateUser }), [user, isLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
