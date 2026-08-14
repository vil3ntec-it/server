import type { Lang } from './i18n';

const LOCALES: Record<Lang, string> = { fa: 'fa-IR', en: 'en-US', ar: 'ar', ps: 'ps-AF' };

/**
 * مقدارهای عددی/لاتین (مثل «8.7 KB/s») در متن راست‌به‌چپ وارونه دیده می‌شوند.
 * این تابع مقدار را داخل «جداکنندهٔ جهت» یونیکد می‌گذارد تا همیشه درست خوانده شود —
 * بدون هیچ تغییری در چیدمان یا ترازبندی.
 */
export function ltr(text: string): string {
  return `⁦${text}⁩`;
}

export function bytes(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return ltr(`${n} B`);
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return ltr(`${v.toFixed(v >= 100 ? 0 : digits)} ${units[i]}`);
}

export function bytesPerSec(n: number | null | undefined): string {
  if (n == null) return '—';
  return ltr(`${bytes(n)}/s`);
}

export function percent(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return ltr(`${n.toFixed(digits)}%`);
}

export function duration(seconds: number | null | undefined, t: (k: any, v?: any) => string): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d} ${t('days')}`);
  if (h) parts.push(`${h} ${t('hours')}`);
  if (!d && m) parts.push(`${m} ${t('minutes')}`);
  if (!parts.length) parts.push(`${Math.floor(seconds)} ${t('seconds')}`);
  return parts.join('، ');
}

export function dateTime(ts: number | null | undefined, lang: Lang): string {
  if (!ts) return '—';
  try {
    return new Intl.DateTimeFormat(LOCALES[lang], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

export function dateOnly(ts: number | null | undefined, lang: Lang): string {
  if (!ts) return '—';
  try {
    return new Intl.DateTimeFormat(LOCALES[lang], { year: 'numeric', month: 'short', day: 'numeric' }).format(
      new Date(ts)
    );
  } catch {
    return new Date(ts).toLocaleDateString();
  }
}

export function relative(ts: number | null | undefined, lang: Lang): string {
  if (!ts) return '—';
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const table: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 1000],
    ['minute', 60000],
    ['hour', 3600000],
    ['day', 86400000],
    ['month', 2592000000],
    ['year', 31536000000],
  ];
  let unit: Intl.RelativeTimeFormatUnit = 'second';
  let div = 1000;
  for (const [u, d] of table) {
    if (abs >= d) {
      unit = u;
      div = d;
    }
  }
  try {
    return new Intl.RelativeTimeFormat(LOCALES[lang], { numeric: 'auto' }).format(Math.round(diff / div), unit);
  } catch {
    return dateTime(ts, lang);
  }
}

export function clockTime(ts: number, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(LOCALES[lang], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleTimeString();
  }
}
