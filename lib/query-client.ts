import { fetch } from "expo/fetch";
import { QueryClient, QueryFunction } from "@tanstack/react-query";

/**
 * Gets the base URL for the Express API server (e.g., "http://localhost:3000")
 * @returns {string} The API base URL
 */
export function getApiUrl(): string {
  const host = process.env.EXPO_PUBLIC_DOMAIN || "paceupapp.com";
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
  const res = await fetch(url, { credentials: "include", ...options });
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

  const res = await fetch(url.toString(), {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

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
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
