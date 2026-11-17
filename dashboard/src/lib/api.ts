import type { Device } from "../../../shared/types";

const TOKEN_KEY = "hm_token";

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}
export function setToken(t: string) {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {}
}

export class AuthError extends Error {}

export async function api<T>(path: string, params?: Record<string, string | number | undefined>, init?: RequestInit): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== "") qs.set(k, String(v));
  const token = getToken();
  const res = await fetch(`${path}${qs.size ? `?${qs}` : ""}`, {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
  });
  if (res.status === 401) throw new AuthError("unauthorized");
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  return (res.status === 204 ? null : await res.json()) as T;
}

/** Screenshot URLs go through <img>, so the token rides in the query string. */
export function withToken(url: string): string {
  const t = getToken();
  return t ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(t)}` : url;
}

export type RangePreset = "today" | "7d" | "30d";

/** Day boundaries in the BROWSER's local time zone (server stores UTC). */
export function rangeFor(preset: RangePreset, now = new Date()): { from: number; to: number } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const days = preset === "today" ? 0 : preset === "7d" ? 6 : 29;
  start.setDate(start.getDate() - days);
  return { from: start.getTime(), to: now.getTime() + 60_000 };
}

export interface Filters {
  store: string;
  page: string;
  device: Device;
  preset: RangePreset;
  source: string;
}

export function filterParams(f: Filters) {
  const { from, to } = rangeFor(f.preset);
  return { store: f.store, page: f.page, device: f.device, from, to, source: f.source || undefined, tz: new Date().getTimezoneOffset() };
}
