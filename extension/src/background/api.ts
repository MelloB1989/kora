// REST API client (auth + room CRUD) used by the service worker.
import { API_URL } from "../shared/config";

export interface AuthUser {
  userId: string;
  email: string;
  displayName: string;
}

export interface AuthResult {
  token: string;
  user: AuthUser;
}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export function signup(email: string, password: string, displayName: string): Promise<AuthResult> {
  return post<AuthResult>("/v1/auth/signup", { email, password, displayName });
}

export function login(email: string, password: string): Promise<AuthResult> {
  return post<AuthResult>("/v1/auth/login", { email, password });
}

export interface CreateRoomResult {
  room: { roomId: string; contentId: string; title?: string };
  joinUrl: string;
}

export function createRoom(
  token: string,
  contentId: string,
  title: string,
): Promise<CreateRoomResult> {
  return post<CreateRoomResult>("/v1/rooms", { platform: "netflix", contentId, title }, token);
}
