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

/*
 *  ⛔ احرازِ دوباره (۶-۵): سرور برای کارِ حساس (نمایشِ راز، کاربرانِ پنل،
 *  روشن کردنِ دوعاملی، حذفِ حساب) از نشستی که ده دقیقه رمز نزده ۴۰۳ ِ
 *  `reauth_required` می‌دهد. این‌جا یک بار پنجرهٔ رمز باز می‌شود
 *  (`components/ReauthHost.tsx`) و اگر رمز درست بود همان درخواست یک بار دیگر
 *  فرستاده می‌شود — هیچ صفحه‌ای لازم نیست خودش این را بداند.
 */
let onReauth: (() => Promise<boolean>) | null = null;
export function setReauthHandler(fn: (() => Promise<boolean>) | null) {
  onReauth = fn;
}

/* رمزِ یک‌بارمصرفِ بازیابی ⇒ سرور هر درِ دیگری را می‌بندد تا رمزِ تازه گذاشته شود */
let onMustChange: (() => void) | null = null;
export function setMustChangeHandler(fn: (() => void) | null) {
  onMustChange = fn;
}

export async function api<T = any>(url: string, options: Options = {}, retried = false): Promise<T> {
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

  if (res.status === 403 && json?.error === 'reauth_required' && !retried && onReauth && options.raw === undefined) {
    if (await onReauth()) return api<T>(url, options, true);
  }
  if (res.status === 403 && json?.error === 'password_change_required') onMustChange?.();

  if (!res.ok) {
    // detail توضیحِ خواندنیِ سرور است؛ بدون آن کاربر فقط یک کد می‌بیند
    throw new ApiError(res.status, json?.error || 'request_failed', json?.detail || json?.message);
  }
  return json as T;
}

/*
 *  ⛔ دانلود بی توکن در نشانی (۶-۶): تا ۱.۵۰.۶۱ توکنِ ۱۲ساعتهٔ نشست در
 *  `?token=` ِ پیوندها بود و در تاریخچهٔ مرورگر و لاگ می‌ماند. حالا با همان
 *  نشست یک بلیتِ ۶۰ثانیه‌ایِ یک‌بارمصرف گرفته می‌شود که فقط همین مسیر را باز
 *  می‌کند، و مرورگر همان لحظه می‌رود.
 */
export async function openWithTicket(path: string) {
  const r = await api<{ ticket: string }>('/api/auth/ticket', { body: { path } });
  const sep = path.includes('?') ? '&' : '?';
  window.location.assign(`${path}${sep}ticket=${encodeURIComponent(r.ticket)}`);
}

export function downloadPath(path: string) {
  return `/api/files/download?path=${encodeURIComponent(path)}`;
}

/** رسانه‌ای که سرآیندِ نشست می‌خواهد ⇒ blob ِ محلی؛ صدا زننده `URL.revokeObjectURL` می‌کند. */
export async function fetchBlobUrl(url: string, signal?: AbortSignal): Promise<string> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers, signal });
  if (res.status === 401) {
    setToken(null);
    onUnauthorized?.();
    throw new ApiError(401, 'unauthorized');
  }
  if (!res.ok) throw new ApiError(res.status, 'request_failed');
  return URL.createObjectURL(await res.blob());
}

export const logoUrl = () => `/api/settings/logo?v=${Date.now()}`;

/**
 * پاسخِ جریانی (SSE روی fetch) — چون EventSource هدرِ Authorization ندارد.
 * هر سطرِ `data: {json}` به onEvent می‌رسد. برمی‌گردد وقتی جریان تمام شد.
 */
export async function streamApi(
  url: string,
  body: unknown,
  onEvent: (ev: any) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (res.status === 401) {
    setToken(null);
    onUnauthorized?.();
    throw new ApiError(401, 'unauthorized');
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    throw new ApiError(res.status, json?.error || 'request_failed', json?.message || json?.detail);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try { onEvent(JSON.parse(line.slice(6))); } catch { /* سطرِ ناقص */ }
      }
    }
  }
}
