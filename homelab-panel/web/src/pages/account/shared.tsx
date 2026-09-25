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
import { useLive, type LiveTopic } from '../../useLive';
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

/**
 * همان حسابِ سرور (`addPeriod` در `account-admin.js`): از پایانِ فعلی، یا از
 * امروز اگر تمام شده. ⛔ فقط برای **پیش‌نمایش** روی صفحه؛ عددِ واقعی را
 * سرورِ حساب می‌نشاند.
 */
export function periodEnd(fromMs: number, amount: number, unit: string): number {
  const d = new Date(Math.max(Number(fromMs) || 0, Date.now()));
  const n = Math.max(1, Math.floor(Number(amount) || 1));
  if (unit === 'day') d.setUTCDate(d.getUTCDate() + n);
  else if (unit === 'week') d.setUTCDate(d.getUTCDate() + n * 7);
  else if (unit === 'year') d.setUTCFullYear(d.getUTCFullYear() + n);
  else d.setUTCMonth(d.getUTCMonth() + n);
  return d.getTime();
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
export function daysTone(daysLeft: number | null | undefined, permanent?: boolean, status?: string): {
  tone: 'good' | 'warn' | 'bad' | 'neutral' | 'info';
  text: string;
} {
  /*
   *  ⛔ **حال جلوتر از عدد است.** تا ۱۴۰۵/۰۷/۱۳ اشتراکِ لغوشده «۳۶۵ روز
   *  مانده» نشان داده می‌شد (سنجیده شد، با پنلِ واقعی) و صاحبِ سامانه
   *  گمان می‌کرد لغو کار نکرده. دورهٔ آزمایشی هم «—» بود، یعنی هر حسابِ
   *  تازه‌ای روزِ مانده نداشت.
   */
  if (status === 'cancelled') return { tone: 'bad', text: 'لغو شد — روزی نمانده' };
  if (status === 'expired') return { tone: 'bad', text: 'تمام شد' };
  if (status === 'suspended') {
    return { tone: 'warn', text: daysLeft && daysLeft > 0 ? `تعلیق — ${fa(daysLeft)} روز نگه داشته شده` : 'تعلیق' };
  }
  if (status === 'trial' && daysLeft != null && daysLeft > 0) {
    return { tone: daysLeft <= 7 ? 'warn' : 'info', text: `آزمایشی — ${fa(daysLeft)} روز مانده` };
  }
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
/**
 * خواندن از سرورِ حساب — و از امروز، **زنده**.
 *
 * ⚠️ `live` یک موضوعِ گذرگاه است. تا پیش از این این صفحه‌ها فقط یک بار
 * سرِ باز شدن خوانده می‌شدند و **هیچ‌وقت** تازه نمی‌شدند: گزارشِ صاحب
 * سامانه دقیقاً همین بود — «توی همون بخش استم و هیچی نمیاد؛ باید بیرون
 * بشم و دوباره بیام». با یک واژه، هر صفحه‌ای که بخواهد زنده می‌شود.
 *
 * ⛔ و نبضِ کور نیست: تا سرورِ حساب نگوید چیزی عوض شده، هیچ درخواستی
 * زده نمی‌شود.
 */
/**
 * خطاهایی که با صبر کردن خودشان درست می‌شوند — و فقط همین‌ها دوباره
 * تلاش می‌شوند.
 *
 * ⛔ `not_linked` و `auto_login_rejected` عمداً این‌جا نیستند: آن دو کارِ
 *    آدم می‌خواهند (نام و رمزِ مدیر) و تکرارشان فقط سقفِ نرخ را پر می‌کند.
 */
const RETRY_CODES = new Set([
  'rate_limited',
  'account_server_down',
  'account_server_unreachable',
  'cloud_session_expired',
  'auto_login_failed',
]);

/** فاصلهٔ تلاش‌ها — فزاینده، با سقفِ یک دقیقه. */
const RETRY_WAITS = [5_000, 10_000, 20_000, 40_000, 60_000];

export function useLoad<T>(path: string | null, deps: unknown[] = [], live?: LiveTopic | LiveTopic[]): Load<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(Boolean(path));
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tries = useRef(0);

  const reload = useCallback(async () => {
    if (!path) { setBusy(false); return; }
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setBusy(true);
    try {
      const res = await api<T>(path);
      if (!alive.current) return;
      tries.current = 0;
      setData(res);
      setError(null);
      setCode('');
    } catch (e) {
      if (!alive.current) return;
      const c = e instanceof ApiError ? e.code : '';
      setError(e instanceof Error ? e.message : 'خواندن از سرورِ حساب نشد');
      setCode(c);
      /*
       *  ⛔ **خطای گذرا باید خودش برگردد** — وگرنه صفحه تا تازه کردنِ
       *  دستی روی همان نوار می‌ماند.
       *
       *  گزارشِ صاحب سامانه با عکس (۱۴۰۵/۰۷/۱۰): روی «کدهای زنده» و میزِ
       *  فروشگاه نوشته بود «سقفِ نرخِ سرورِ حساب پر شده؛ **خودش چند
       *  دقیقهٔ دیگر باز می‌شود**» — و هیچ‌وقت باز نمی‌شد. آن جمله یک
       *  قولِ نانوشته بود که کسی به آن عمل نمی‌کرد: گذرگاهِ زنده هم
       *  بیدارش نمی‌کند، چون روی سرورِ حساب هیچ چیزی عوض نشده که خبر
       *  بدهد.
       *
       *  ⛔ **و این نبضِ کور نیست**: فقط وقتی می‌دود که خواندن **شکست
       *  خورده** باشد، با فاصلهٔ فزاینده، و با نخستین موفقیت برای همیشه
       *  می‌ایستد. صفحهٔ سالم همچنان صفر درخواست می‌زند.
       *
       *  ⛔ و فقط خطاهای **گذرا**: «رمزِ مدیر غلط است» یا «هنوز وارد
       *  نشده‌اید» با تلاشِ دوباره درست نمی‌شوند و تکرارشان فقط سقفِ نرخ
       *  را پر می‌کند — همان زخمی که این اصلاح دارد می‌بندد.
       */
      if (RETRY_CODES.has(c)) {
        const wait = RETRY_WAITS[Math.min(tries.current, RETRY_WAITS.length - 1)];
        tries.current += 1;
        //  نبضِ آگاهانه: تلاشِ دوبارهٔ یک‌باره پس از خطای گذرا — نه دوره‌ای
        timer.current = setTimeout(() => { timer.current = null; void reload(); }, wait);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [path]);

  //  نوبتِ در صف با رفتنِ صفحه پاک می‌شود، وگرنه روی صفحهٔ بسته می‌دود
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [path, ...deps]);

  /*
   *  ⚠️ `useLive` بی‌قید صدا زده می‌شود و با موضوعِ خالی هیچ کاری نمی‌کند —
   *  چون هوکِ React را نمی‌شود شرطی صدا زد.
   */
  useLive(live ?? [], () => { void reload(); });

  return { data, error, code, busy, reload };
}

/**
 * چرا از سرورِ حساب چیزی نیامد — با راهِ درست کردنش، نه فقط یک کد.
 *
 * ⛔ «docker compose» در هیچ پیامی نمی‌آید؛ کامپیوترِ خانگی ویندوز است و
 *    سرورِ حساب را خودِ پنل بالا می‌آورد.
 */
export function CloudProblem({ code, message, onRetry }: { code: string; message: string; onRetry?: () => void }) {
  /*
   *  ⚠️ خطای گذرا خودش دوباره تلاش می‌شود (`useLoad`) — و صفحه باید
   *  **بگوید** که منتظر است، وگرنه کاربر روی یک نوارِ ثابت می‌ماند و
   *  گمان می‌کند همه‌چیز خوابیده. و یک راهِ «همین حالا» هم کنارش هست،
   *  چون منتظر ماندن وقتی خودت می‌دانی سرور برگشته آزاردهنده است.
   */
  const waiting = RETRY_CODES.has(code);
  const again = onRetry ? (
    <button type="button" onClick={onRetry} className="mr-2 underline underline-offset-2 hover:opacity-80">
      همین حالا دوباره
    </button>
  ) : null;

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
  if (code === 'cloud_session_expired') {
    return <Notice tone="warn">نشستِ مدیر روی سرورِ حساب تمام شده — خودمان دوباره وارد می‌شویم.{again}</Notice>;
  }
  return (
    <Notice tone="bad">
      {message}
      {waiting && <span className="text-ink-muted"> — خودمان دوباره تلاش می‌کنیم.</span>}
      {again}
    </Notice>
  );
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
