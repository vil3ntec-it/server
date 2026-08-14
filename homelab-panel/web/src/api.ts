// لایهٔ ارتباط با API — توکن ورود در همین‌جا مدیریت می‌شود
const TOKEN_KEY = 'hlp.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

type Options = {
  method?: string;
  body?: unknown;
  raw?: BodyInit;
  contentType?: string;
  signal?: AbortSignal;
};

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T = any>(url: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (options.raw !== undefined) {
    body = options.raw;
    if (options.contentType) headers['Content-Type'] = options.contentType;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const res = await fetch(url, {
    method: options.method || (body ? 'POST' : 'GET'),
    headers,
    body,
    signal: options.signal,
  });

  if (res.status === 401) {
    setToken(null);
    onUnauthorized?.();
    throw new ApiError(401, 'unauthorized');
  }

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    // detail توضیحِ خواندنیِ سرور است؛ بدون آن کاربر فقط یک کد می‌بیند
    throw new ApiError(res.status, json?.error || 'request_failed', json?.detail || json?.message);
  }
  return json as T;
}

export function downloadUrl(path: string) {
  return `/api/files/download?path=${encodeURIComponent(path)}&token=${encodeURIComponent(getToken() || '')}`;
}

export const logoUrl = () => `/api/settings/logo?v=${Date.now()}`;
