import { API_URL } from "./config";
import { useAppStore, type User } from "./store";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = useAppStore.getState().token;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) useAppStore.getState().logout();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export interface AuthResult {
  token: string;
  user: User;
}

export const api = {
  login: (email: string, password: string) =>
    request<AuthResult>("/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  signup: (email: string, password: string, displayName: string) =>
    request<AuthResult>("/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, displayName }),
    }),
  stats: () => request<Stats>("/v1/me/stats"),
  sessions: () => request<{ sessions: WatchSession[] }>("/v1/me/sessions"),
  progress: () => request<{ progress: ShowProgress[] }>("/v1/me/progress"),
};

export interface Stats {
  totalSeconds: number;
  sessionCount: number;
  distinctTitles: number;
  perPlatform: Record<string, number>;
  perWeek: { weekStart: string; seconds: number }[];
}

export interface WatchSession {
  sessionId: string;
  roomId: string;
  platform: string;
  contentId: string;
  title?: string;
  startedAt: string;
  endedAt: string;
  secondsWatched: number;
}

export interface ShowProgress {
  platform: string;
  contentId: string;
  title?: string;
  lastPosition: number;
  duration: number;
  percentComplete: number;
  updatedAt: string;
}
