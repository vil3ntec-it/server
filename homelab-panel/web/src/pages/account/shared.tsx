// ---------------------------------------------------------------------------
//  ابزارهای مشترکِ صفحه‌های «مشتری، پول و پیام»
//
//  ⛔ هیچ عددِ قیمتی، هیچ نامِ پلنی و هیچ قاعدهٔ رنگ/روزِ مانده‌ای این‌جا
//     ساخته نمی‌شود. قیمت از سرورِ حساب می‌آید و مرزِ رنگ همان مرزی است که
//     `routes/portal.js:subscriptionView` روی سرور دارد: سبز > ۳۰ روز،
//     زرد ≤ ۳۰، سرخ منقضی، «دائمی ✓» بی شمارش. اگر این‌جا قاعدهٔ دومی
//     نوشته شود، روزی مشتری در برنامه سبز می‌بیند و در پنل سرخ.
//  ⛔ و هیچ دفترِ دومی: هر چه این‌جا دیده می‌شود از `/api/account-admin/*`
//     می‌آید، که خودش پلِ فهرست‌سفید به سرورِ حساب است.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, api } from '../../api';
import { Notice } from '../../control/ui';

/** بخش‌هایی که سرورِ حساب می‌شناسد — و فقط همین دو تا. */
export type AppId = 'shop' | 'pump';
export type Scope = AppId | 'both';

export const APP_LABEL: Record<AppId, string> = { shop: 'دکان', pump: 'پمپ‌بنزین' };
export const CURRENCY_LABEL: Record<string, string> = { AFN: 'افغانی', USD: 'دالر' };
export const METHOD_LABEL: Record<string, string> = { cash: 'نقد', hawala: 'حواله', exchange: 'صرافی' };
export const STATUS_LABEL: Record<string, string> = {
  active: 'فعال',
  trial: 'آزمایشی',
  expired: 'منقضی',
  suspended: 'تعلیق',
  cancelled: 'لغو',
  pending: 'در انتظار',
  none: 'بی اشتراک',
};

/** ارقامِ فارسی در نمایش — بندِ ۱۶ پرامپت. */
export function fa(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('fa-AF');
}

export function money(amount: number | null | undefined, currency?: string | null): string {
  if (amount == null) return '—';
  return `${fa(amount)} ${CURRENCY_LABEL[String(currency || '')] || currency || ''}`.trim();
}

export function day(ms: number | null | undefined): string {
  if (!ms) return '—';
  return new Date(Number(ms)).toLocaleDateString('fa-AF', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function moment(ms: number | null | undefined): string {
  if (!ms) return '—';
  return new Date(Number(ms)).toLocaleString('fa-AF', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** ورودیِ «تاریخ و ساعت» مرورگر ⇄ میلی‌ثانیه. */
export function toLocalInput(ms: number | null | undefined): string {
  if (!ms) return '';
  const d = new Date(Number(ms));
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * رنگ و متنِ «چند روز مانده» — یک جا، همان مرزِ سرور.
 * `permanent` یعنی «دائمی ✓» و اصلاً شمرده نمی‌شود.
 */
export function daysTone(daysLeft: number | null | undefined, permanent?: boolean): {
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  text: string;
} {
  if (permanent) return { tone: 'good', text: 'دائمی ✓' };
  if (daysLeft == null) return { tone: 'neutral', text: '—' };
  if (daysLeft < 0) return { tone: 'bad', text: `${fa(-daysLeft)} روز از انقضا گذشته` };
  if (daysLeft <= 30) return { tone: 'warn', text: `${fa(daysLeft)} روز مانده` };
  return { tone: 'good', text: `${fa(daysLeft)} روز مانده` };
}

/* ------------------------- خواندن از سرورِ حساب ------------------------- */

export type Load<T> = { data: T | null; error: string | null; code: string; busy: boolean; reload: () => Promise<void> };

/**
 * یک خواندنِ ساده با حالِ خودش.
 *
 * ⚠️ پیامِ خطا همانی است که پل داده (`account_server_down` و مانندش) —
 * این‌جا بازنویسی نمی‌شود، وگرنه کاربر می‌بیند «نشد» و نمی‌داند چه کند.
 */
export function useLoad<T>(path: string | null, deps: unknown[] = []): Load<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(Boolean(path));
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const reload = useCallback(async () => {
    if (!path) { setBusy(false); return; }
    setBusy(true);
    try {
      const res = await api<T>(path);
      if (!alive.current) return;
      setData(res);
      setError(null);
      setCode('');
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : 'خواندن از سرورِ حساب نشد');
      setCode(e instanceof ApiError ? e.code : '');
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [path]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [path, ...deps]);

  return { data, error, code, busy, reload };
}

/**
 * چرا از سرورِ حساب چیزی نیامد — با راهِ درست کردنش، نه فقط یک کد.
 *
 * ⛔ «docker compose» در هیچ پیامی نمی‌آید؛ کامپیوترِ خانگی ویندوز است و
 *    سرورِ حساب را خودِ پنل بالا می‌آورد.
 */
export function CloudProblem({ code, message }: { code: string; message: string }) {
  if (code === 'not_linked') {
    return (
      <Notice tone="warn">
        هنوز با حسابِ مدیر به سرورِ حساب وارد نشده‌ایم. از «پمپ‌بنزین‌ها ← تنظیمات و داده‌ها» وارد شوید،
        یا نام و رمزِ مدیر را در تنظیماتِ سرور بگذارید تا پل خودش وارد شود.
      </Notice>
    );
  }
  if (code === 'auto_login_rejected') {
    return <Notice tone="bad">ورودِ خودکار به سرورِ حساب رد شد — نام و رمزِ مدیرِ سرورِ حساب درست نیست.</Notice>;
  }
  if (code === 'account_server_down' || code === 'account_server_unreachable') {
    return <Notice tone="bad">{message}</Notice>;
  }
  if (code === 'cloud_session_expired') {
    return <Notice tone="warn">نشستِ مدیر روی سرورِ حساب تمام شده — دوباره وارد شوید.</Notice>;
  }
  return <Notice tone="bad">{message}</Notice>;
}

/** قابِ استانداردِ هر صفحه: عنوان، توضیح، و نوارِ ابزار. */
export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** انتخابگرِ بخش — «هر دو» فقط جایی که سرورِ حساب واقعاً می‌پذیرد. */
export function AppPicker({
  value,
  onChange,
  withBoth,
}: {
  value: Scope;
  onChange: (v: Scope) => void;
  withBoth?: boolean;
}) {
  const items: Scope[] = withBoth ? ['both', 'shop', 'pump'] : ['shop', 'pump'];
  return (
    <div className="flex gap-1">
      {items.map((id) => (
        <button
          key={id}
          className={`rounded-lg px-2.5 py-1.5 text-xs ${value === id ? 'font-semibold' : 'text-ink-soft hover:bg-surface-raised'}`}
          style={value === id ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : undefined}
          onClick={() => onChange(id)}
        >
          {id === 'both' ? 'هر دو' : APP_LABEL[id]}
        </button>
      ))}
    </div>
  );
}
