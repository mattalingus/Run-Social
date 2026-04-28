import { fetch } from "expo/fetch";
import { QueryClient, QueryFunction } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";

const REMEMBER_TOKEN_KEY = "paceup_remember_token";

// Silent re-auth on 401. Uses the locally-stored remember token to call
// /api/auth/restore-session which re-establishes the session cookie. Any
// concurrent 401s share one in-flight attempt so we don't stampede the server.
let _rehydrateInFlight: Promise<boolean> | null = null;
async function attemptSessionRestore(): Promise<boolean> {
  if (_rehydrateInFlight) return _rehydrateInFlight;
  _rehydrateInFlight = (async () => {
    try {
      const token = await AsyncStorage.getItem(REMEMBER_TOKEN_KEY);
      if (!token) return false;
      const baseUrl = getApiUrl();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(new URL("/api/auth/restore-session", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        credentials: "include",
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    } finally {
      // Clear the in-flight guard on the next tick so overlapping calls share
      // the same result but subsequent requests get a fresh attempt.
      setTimeout(() => { _rehydrateInFlight = null; }, 100);
    }
  })();
  return _rehydrateInFlight;
}

/**
 * Gets the base URL for the Express API server (e.g., "http://localhost:3000")
 * @returns {string} The API base URL
 */
export function getApiUrl(): string {
  const host = process.env.EXPO_PUBLIC_DOMAIN || "paceup-backend-production.up.railway.app";
  return new URL(`https://${host}`).href;
}

interface ApiErrorPayload {
  error?: string;
  message?: string;
  suspended_until?: string;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let text: string | undefined;
    let data: ApiErrorPayload | undefined;
    try {
      text = await res.text();
      data = JSON.parse(text!) as ApiErrorPayload;
    } catch {
      text = res.statusText;
    }
    if (res.status === 403 && data?.error === "suspended") {
      const suspUntil = data.suspended_until;
      _handleSuspendedSession?.(suspUntil);
      throw Object.assign(new Error("Account suspended"), {
        code: "SUSPENDED",
        suspendedUntil: suspUntil,
      });
    }
    throw new Error(data?.message || `${res.status}: ${text || res.statusText}`);
  }
}

let _handleSuspendedSession: ((suspendedUntil?: string) => void) | null = null;

export function setHandleSuspendedSession(handler: ((suspendedUntil?: string) => void) | null): void {
  _handleSuspendedSession = handler;
}

/**
 * Wraps a raw fetch call with suspension detection.
 * Use this for multipart/form-data requests that can't go through `apiRequest`.
 * Throws with { code: "SUSPENDED" } if a 403 suspended response is received,
 * and triggers the global suspended-session handler before throwing.
 * For all other cases, returns the Response (check res.ok yourself).
 */
export async function apiFetch(url: string, options?: RequestInit): Promise<Response> {
  let res = await fetch(url, { credentials: "include", ...options });
  // Same auto-recovery as apiRequest, but only for non-auth URLs.
  if (res.status === 401 && !url.includes("/api/auth/")) {
    const ok = await attemptSessionRestore();
    if (ok) res = await fetch(url, { credentials: "include", ...options });
  }
  if (res.status === 403) {
    let data: ApiErrorPayload | undefined;
    try { data = (await res.clone().json()) as ApiErrorPayload; } catch {}
    if (data?.error === "suspended") {
      _handleSuspendedSession?.(data.suspended_until);
      throw Object.assign(new Error("Account suspended"), { code: "SUSPENDED", suspendedUntil: data.suspended_until });
    }
  }
  return res;
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const send = () => fetch(url.toString(), {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  let res = await send();

  // Auto-recover on 401 (except for auth routes themselves — those 401s are
  // the user ACTUALLY being rejected and must propagate). Re-establishes the
  // session via restore-session + remember-token, then retries once.
  // This prevents silent session expiry from surfacing as user-visible errors
  // on writes like POST /api/solo-runs where a failure loses user work.
  if (res.status === 401 && !route.startsWith("/api/auth/")) {
    const ok = await attemptSessionRestore();
    if (ok) res = await send();
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = getApiUrl();
    const url = new URL(queryKey.join("/") as string, baseUrl);

    const res = await fetch(url.toString(), {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      // Retry transient network blips up to 2x so flaky networks don't surface
      // empty/broken screens. Don't retry auth or client errors.
      retry: (failureCount, error: any) => {
        const msg = error?.message ?? "";
        if (/\b(401|403|404|410)\b/.test(msg)) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    },
    mutations: {
      retry: false,
    },
  },
});
