import { ACCESS_TOKEN_KEY, storage } from './storage';

const DEFAULT_API_URL = 'http://localhost:8000';
export const API_URL =
  (process.env.EXPO_PUBLIC_API_URL as string | undefined)?.replace(/\/$/, '') ?? DEFAULT_API_URL;

export class ApiError extends Error {
  constructor(public status: number, public detail: unknown) {
    super(typeof detail === 'string' ? detail : `HTTP ${status}`);
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
};

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, signal } = opts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (auth) {
    const token = await storage.get(ACCESS_TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const url = `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const payload = text ? safeParseJson(text) : undefined;

  if (!res.ok) {
    const detail = (payload as { detail?: unknown } | undefined)?.detail ?? text;
    throw new ApiError(res.status, detail);
  }
  return payload as T;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiUpload<T = unknown>(path: string, formData: FormData): Promise<T> {
  const token = await storage.get(ACCESS_TOKEN_KEY);
  const url = `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { method: 'POST', headers, body: formData });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const payload = text ? safeParseJson(text) : undefined;
  if (!res.ok) {
    const detail = (payload as { detail?: unknown } | undefined)?.detail ?? text;
    throw new ApiError(res.status, detail);
  }
  return payload as T;
}

export async function apiDownloadBlob(path: string): Promise<Blob> {
  const token = await storage.get(ACCESS_TOKEN_KEY);
  const url = `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res.blob();
}
