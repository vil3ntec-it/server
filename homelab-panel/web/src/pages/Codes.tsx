// ---------------------------------------------------------------------------
//  کدهای شش‌رقمی — یک بخش برای همهٔ کدها، از هر برنامه جدا
//
//  خواستهٔ صاحب سامانه (۱۴۰۵/۰۷/۱۳): «کدهای شش‌رقمی همه توی یک بخش باشن اما
//  از هر برنامه جدا؛ کدِ همه یک جا ساخته بشه؛ کدی که ساخته می‌شه همون‌جا
//  دیده بشه که رفت یا نرفت، زنده؛ و صفحه‌اش خیلی داغون است، بهترش کن.»
//
//  پس: تبِ هر برنامه (پمپ · دکان · برنامه‌های خودِ پنل) بالای فهرست، در
//  نشانی (`?app=`) تا «پمپ‌بنزین‌ها ← کد و ربات» مستقیم همین‌جا برسد؛ ساختنِ
//  کد و کدِ بازیابیِ رمز پشتِ دو دکمه (پنجره)، نه دو کارتِ همیشه‌باز؛ و
//  شمارنده‌های صفِ رباتِ پنل فقط در تبِ «ربات و تنظیمات»، چون مالِ همان‌جایند.
//  ⛔ هیچ دفترِ تازه‌ای ساخته نشد: همان `/api/codes-admin/live` (هر دو دفتر)
//  و همان `/send`ِ موتورِ خودِ پنل که «پمپ‌بنزین‌ها ← کد و ربات» می‌زد.
//
//  سه تب، و هر کدام یک سؤالِ مشخص را جواب می‌دهد:
//
//    کدهای زنده   «الان چه کسی منتظرِ کد است و کدش چند است؟»
//    برنامه‌ها     «این برنامه را چطور به سرور وصل کنم؟»
//    ربات         «ایمیل از کجا می‌رود و صف در چه حالی است؟»
//
//  فهرستِ زنده خودش هر دو ثانیه تازه می‌شود، چون کد دو دقیقه بیشتر عمر
//  نمی‌کند و صفحه‌ای که باید دستی نو شود، همیشه کدِ مرده نشان می‌دهد.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLive } from '../useLive';
import {
  Bot,
  KeyRound,
  Mail,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Timer,
  Trash2,
} from 'lucide-react';
import { api } from '../api';
import { useApp } from '../app-context';
import { Card, CopyButton, Empty, Field, Loading, Modal, toast } from '../components/ui';
import { ActionButton, Cell, Notice, Row, Select, Stat, Table, Tabs } from '../control/ui';

/* ------------------------------- انواع ---------------------------------- */

type LiveItem = {
  id: number | string;
  /**
   *  کدام دفتر: `panel` مالِ موتورِ کدِ خودِ این پنل است و `account` مالِ
   *  سرورِ حساب (ورودِ برنامه‌های دکان و پمپ).
   *
   *  ⚠️ یک بار همین تفاوت کاربر را کاملاً گیج کرد: کدی که روی گوشی «فرستاده
   *  شد» می‌گفت در دفترِ سرورِ حساب نشسته بود و این صفحه — که فقط دفترِ خودش
   *  را می‌خواند — می‌گفت «هنوز کسی کد نخواسته».
   */
  /*
   *  ⚠️ و سرورِ حساب خودش **دو** دفتر دارد: `account` مالِ «ورود با کدِ
   *  ایمیلی» است و `account-otp` مالِ کدِ **ثبت‌نام** و **رمزِ
   *  فراموش‌شده**. تا ۱.۴۷.۵ فقط اولی خوانده می‌شد، پس کدِ کاربرِ تازه
   *  هیچ‌جا دیده نمی‌شد — و هر دو مسیرِ «نمایشِ کد» جدا هستند.
   */
  source?: 'panel' | 'account' | 'account-otp';
  /** ردیفِ سرورِ حساب کدش در فهرست نمی‌آید؛ با دکمه و با ثبت نشان داده می‌شود */
  canReveal?: boolean;
  /** ⛔ «رفت» نیست: فقط در لاگِ سرور چاپ شده و هیچ ایمیلی بیرون نرفته */
  logOnly?: boolean;
  locked?: boolean;
  app: string;
  appName: string;
  email: string;
  subjectId: string | null;
  purpose: string;
  code: string | null;
  createdAt: number;
  expiresAt: number;
  expiresIn: number;
  tries: number;
  status: 'live' | 'used' | 'replaced' | 'expired';
  sendState: 'queued' | 'sending' | 'sent' | 'failed';
  sendError: string | null;
  /** رسیدِ خودِ سرورِ ایمیل — «فرستادم» را از ادعا به سند تبدیل می‌کند */
  sendResponse?: string | null;
  autoResend: boolean;
};

type QueueState = {
  running: boolean;
  workers: number;
  busyWorkers: number;
  mailReady: boolean;
  waiting: number;
  sending: number;
  failed: number;
  sentLastHour: number;
};

type CodeApp = {
  slug: string;
  name: string;
  kind: 'app' | 'site';
  kindLabel: string;
  apiKey: string;
  requireKey: boolean;
  enabled: boolean;
  codeTtl: number | null;
  subject: string | null;
  note: string | null;
  lastSeenAt: number | null;
};

type Settings = {
  email: {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    password: string;
    from: string;
    fromName: string;
  };
  codeLength: number;
  ttlSeconds: number;
  resendSeconds: number;
  autoResendSeconds: number;
  autoResendMax: number;
  maxTries: number;
  workers: number;
  sendRetries: number;
  keepMinutes: number;
  subject: string;
  mailReady: boolean;
};

/* ------------------------------ صفحه ------------------------------------ */

export default function Codes() {
  const { t } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'live';
  //  ⚠️ تبِ برنامه در نشانی می‌ماند: `/codes?app=pump` همان چیزی است که
  //  «پمپ‌بنزین‌ها ← کد و ربات» باز می‌کند، و برگشتِ مرورگر هم درست می‌شود.
  const app = params.get('app') || '';
  const set = (next: { tab?: string; app?: string }) => {
    const p = new URLSearchParams();
    const t2 = next.tab ?? tab;
    const a2 = next.app ?? app;
    if (t2 !== 'live') p.set('tab', t2);
    if (a2) p.set('app', a2);
    setParams(p);
  };
  const [queue, setQueue] = useState<QueueState | null>(null);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-4">
        <h1 className="text-lg font-semibold">{t('codesTitle')}</h1>
        <p className="mt-1 text-xs text-ink-muted">{t('codesSubtitle')}</p>
      </header>

      <Tabs
        active={tab}
        onChange={(id) => set({ tab: id })}
        tabs={[
          { id: 'live', label: t('codesLive'), badge: queue?.waiting },
          { id: 'apps', label: t('codesApps') },
          { id: 'bot', label: t('codesBot') },
        ]}
      />

      {tab === 'live' && <LiveTab onQueue={setQueue} app={app} onApp={(a) => set({ app: a })} />}
      {tab === 'apps' && <AppsTab />}
      {tab === 'bot' && <BotTab onQueue={setQueue} />}
    </div>
  );
}

/* --------------------------- تبِ کدهای زنده ------------------------------ */

/**
 *  کدام کدها مالِ کدام تب‌اند.
 *
 *  ⚠️ دو دفتر، دو نام: کدِ ورودِ برنامهٔ پمپ در دفترِ سرورِ حساب `pump` است و
 *  کدی که مدیر از همین صفحه برای کارمندِ پمپ می‌سازد در موتورِ خودِ پنل
 *  `pump-station`. برای صاحبِ سامانه هر دو «کدِ پمپ»اند، پس یک تب.
 */
const TAB_APPS: Record<string, string[]> = {
  pump: ['pump', 'pump-station'],
  shop: ['shop', 'shop-desk'],
};
/** برنامهٔ خودِ پنل که «ساختِ کد» برای این تب می‌زند. */
const MAKE_FOR: Record<string, { slug: string; name: string }> = {
  pump: { slug: 'pump-station', name: 'پمپ بنزین' },
  shop: { slug: 'shop-desk', name: 'دکان' },
};

function LiveTab({ onQueue, app, onApp }: { onQueue: (q: QueueState) => void; app: string; onApp: (a: string) => void }) {
  const { t } = useApp();
  const [items, setItems] = useState<LiveItem[] | null>(null);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [accountError, setAccountError] = useState('');
  /**
   *  راهِ ارسالِ **سرورِ حساب**، که با رباتِ ایمیلِ خودِ پنل یکی نیست.
   *
   *  ⛔ با `log`، کدِ ورودِ برنامه‌ها فقط در لاگ چاپ می‌شود و هیچ ایمیلی
   *  نمی‌رود — ولی چون `request-code` عمداً همیشه ۲۰۰ است، برنامه می‌گوید
   *  «کد فرستاده شد». این صفحه باید همین را بلند بگوید، وگرنه کاربر ساعت‌ها
   *  دنبالِ ایمیلی می‌گردد که هیچ‌وقت فرستاده نشده.
   */
  const [mailProvider, setMailProvider] = useState('');
  const [onlyLive, setOnlyLive] = useState(true);
  const [apps, setApps] = useState<CodeApp[]>([]);
  const [making, setMaking] = useState(false);
  const [resetting, setResetting] = useState(false);
  // ساعتِ صفحه، تا شمارشِ معکوس بینِ دو بار گرفتنِ داده هم جلو برود
  const [tick, setTick] = useState(Date.now());
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      //  ⚠️ همه را می‌گیرد و خودِ صفحه به تب‌ها پخش می‌کند: تبِ «پمپ» هم کدِ
      //  دفترِ سرورِ حساب را می‌خواهد هم کدِ دستیِ موتورِ پنل، و سرور یک
      //  فیلترِ یک‌نامی دارد.
      const res = await api<{ items: LiveItem[]; queue: QueueState; accountError?: string }>('/api/codes-admin/live');
      if (!alive.current) return;
      setItems(res.items);
      setQueue(res.queue);
      setAccountError(res.accountError || '');
      onQueue(res.queue);
    } catch {
      if (alive.current) setItems([]);
    }
  }, [onQueue]);

  useEffect(() => {
    alive.current = true;
    load();
    //  نبضِ آگاهانه: ساعتِ شمارشِ معکوسِ روی صفحه است، نه خواندنِ داده
    //  ⚠️ این یکی نبضِ داده نیست، ساعتِ شمارشِ معکوسِ روی صفحه است و می‌ماند
    const clock = setInterval(() => setTick(Date.now()), 1000);
    return () => {
      alive.current = false;
      clearInterval(clock);
    };
  }, [load]);

  /*
   *  زنده — نبضِ دو‌ونیم‌ثانیه‌ایِ قدیمی برداشته شد.
   *
   *  دو سرچشمه، یک موضوع: کدهای خودِ پنل (`codes/store.js`) و کدهای
   *  ورودِ سرورِ حساب که خودش همان لحظه خبر می‌دهد
   *  (`POST /api/live/bump`). پس کدی که همین حالا ساخته شده روی صفحه
   *  می‌نشیند، بی این‌که کسی جایی برود و برگردد.
   */
  useLive('codes', load);

  useEffect(() => {
    api<{ apps: CodeApp[] }>('/api/codes-admin/apps')
      .then((r) => setApps(r.apps))
      .catch(() => {});
    api<{ email?: { provider?: string } }>('/api/account-admin/mail')
      .then((r) => setMailProvider(String(r.email?.provider || '')))
      .catch(() => setMailProvider(''));
  }, []);

  const inTab = useCallback((i: LiveItem) => {
    if (!app) return true;
    const names = TAB_APPS[app] || [app];
    return names.includes(i.app);
  }, [app]);

  const shown = useMemo(
    () => (items || []).filter((i) => inTab(i) && (!onlyLive || i.status === 'live')),
    [items, onlyLive, inTab]
  );

  //  تب‌های برنامه: پمپ و دکان همیشه؛ برنامه‌های خودِ پنل که زیرِ آن دو
  //  نمی‌روند، هر کدام تبِ خودشان — با شمارِ کدهای زندهٔ همان برنامه.
  const liveOf = (names: string[]) => (items || []).filter((i) => i.status === 'live' && names.includes(i.app)).length;
  const appTabs = useMemo(() => {
    const extra = apps.filter((a) => !Object.values(TAB_APPS).some((names) => names.includes(a.slug)));
    return [
      { id: '', label: t('codesTabAll'), badge: liveOf(['pump', 'pump-station', 'shop', 'shop-desk', ...extra.map((a) => a.slug)]) },
      { id: 'pump', label: t('codesAppPump'), badge: liveOf(TAB_APPS.pump) },
      { id: 'shop', label: t('codesAppShop'), badge: liveOf(TAB_APPS.shop) },
      ...extra.map((a) => ({ id: a.slug, label: a.name, badge: liveOf([a.slug]) })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps, items, t]);

  //  ⚠️ از خودِ فهرست شمرده می‌شوند، نه از یک مسیرِ دوم: یک حقیقت، یک منبع
  const liveCount = useMemo(() => (items || []).filter((i) => inTab(i) && i.status === 'live').length, [items, inTab]);
  const dayCount = useMemo(() => {
    const since = Date.now() - 24 * 3600 * 1000;
    return (items || []).filter((i) => inTab(i) && Number(i.createdAt || 0) >= since).length;
  }, [items, inTab]);

  /*
   *  ⛔ **بندِ ۲.۷ سند — «نرفته‌ها، و دلیلِ نرفتن».**
   *
   *  یک عددِ خالیِ «۳ تا نرفت» همان بن‌بستی است که یک بار ساعت‌ها وقت برد:
   *  کاربر می‌دید نرفته و نمی‌دانست چرا. پس کنارِ عدد، **دلیل‌ها** هم
   *  گروه می‌شوند و پرتکرارترین‌ها نوشته می‌شوند.
   *
   *  ⛔ و «فقط در لاگ» در این شمار **حساب می‌شود**: ردیفی که مهرِ «رفت»
   *  دارد ولی رباتش `log` بوده، هیچ ایمیلی نفرستاده. همان «کلکِ دروغ»ی
   *  که این صفحه برای گرفتنش ساخته شد.
   *
   *  ⚠️ فقط ۲۴ ساعتِ گذشته: دلیلِ ماهِ پیش دیگر کارِ امروز نیست و عددِ
   *  همیشه‌سرخ کسی را به کار نمی‌اندازد.
   */
  const failed = useMemo(() => {
    const since = Date.now() - 24 * 3600 * 1000;
    const rows = (items || []).filter(
      (i) => inTab(i) && Number(i.createdAt || 0) >= since && (i.sendState === 'failed' || i.logOnly)
    );
    const why = new Map<string, number>();
    for (const r of rows) {
      const key = r.logOnly ? t('codesWhyLogOnly') : (r.sendError || t('codesWhyUnknown'));
      why.set(key, (why.get(key) || 0) + 1);
    }
    return {
      count: rows.length,
      //  پرتکرارترین دلیل‌ها اول — دو تا بس است؛ فهرستِ بلند کسی را نمی‌خواند
      reasons: [...why.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2),
    };
  }, [items, t, inTab]);

  if (!items) return <Loading />;

  const make = MAKE_FOR[app] || (app ? { slug: app, name: apps.find((a) => a.slug === app)?.name || app } : MAKE_FOR.pump);

  return (
    <div className="space-y-4">
      {/* ── تبِ هر برنامه — «از هر برنامه جدا» ─────────────────────────── */}
      <Tabs active={app} onChange={onApp} tabs={appTabs} />

      {queue && !queue.mailReady && (
        <Notice tone="warn">
          {t('codesNoMail')}
        </Notice>
      )}

      {/*
        ⛔ بلندترین حرفِ این صفحه: سرورِ حساب هیچ ایمیلی نمی‌فرستد.
        «کد نیامد» با این یک خط از یک معما به یک کارِ پنج‌دقیقه‌ای تبدیل می‌شود.
      */}
      {mailProvider === 'log' && (
        <Notice tone="bad">{t('codesAccountLogOnly')}</Notice>
      )}

      {accountError && <Notice tone="warn">{t('codesAccountDown')} — {accountError}</Notice>}

      {/* ── دو کار، دو دکمه — پنجره، نه دو کارتِ همیشه‌باز ─────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary btn-sm" onClick={() => setMaking(true)}>
          <Send className="h-4 w-4" /> {t('codesMakeOpen')}
        </button>
        <button className="btn btn-sm" onClick={() => setResetting(true)}>
          <KeyRound className="h-4 w-4" /> {t('codesResetOpen')}
        </button>
        <p className="text-[11px] text-ink-muted">{t('codesMakeNote')}</p>
      </div>
      {making && <MakeCodeModal target={make} onClose={() => setMaking(false)} onDone={load} />}
      {resetting && <ResetModal startApp={app === 'shop' ? 'shop' : 'pump'} onClose={() => setResetting(false)} />}

      {/*
        ⛔ **دو شمارندهٔ خودِ فهرست، پیش از شمارنده‌های صف.**

        گزارشِ صاحب سامانه با عکس: کد به ایمیلش رسیده بود و این صفحه هر
        چهار شمارنده‌اش صفر بود. آن چهارتا **درست** می‌گفتند — مالِ رباتِ
        ایمیلِ خودِ پنل‌اند و کدِ برنامه‌ها را سرورِ حساب خودش می‌فرستد،
        پس هیچ‌وقت از صفر بالا نمی‌روند. ولی کنارِ هم خوانده می‌شدند و
        یعنی «هیچ کدی در کار نیست».
      */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label={t('codesListLive')} value={liveCount} />
        <Stat label={t('codesListDay')} value={dayCount} />
        <Stat
          label={t('codesListFailed')}
          value={failed.count}
          tone={failed.count > 0 ? 'bad' : undefined}
        />
      </div>

      {/*
        ⛔ عدد بی دلیل کسی را به کار نمی‌اندازد. این خط می‌گوید **چرا** نرفت،
        و پرتکرارترین دلیل اول می‌آید.
      */}
      {failed.count > 0 && (
        <p className="text-[11px] leading-snug" style={{ color: 'var(--status-critical)' }} dir="auto">
          {t('codesWhyLabel')}{' '}
          {failed.reasons.map(([why, n]) => `${why}${n > 1 ? ` (${n})` : ''}`).join(' · ')}
        </p>
      )}

      {/*
        ⚠️ چهار شمارندهٔ صفِ رباتِ خودِ پنل از این تب رفتند (۱.۵۰.۱۶): یک بار
        صاحبِ سامانه آن‌ها را «همهٔ کدها» خواند و صفر دید. جایشان تبِ «ربات و
        تنظیمات» است، که مالِ همان ربات است. `queue` هنوز خوانده می‌شود، چون
        نشانِ روی تبِ «کدهای زنده» از آن است.
      */}
      {queue && queue.failed > 0 && (
        <Notice tone="warn">{t('codesQFailed')}: {queue.failed} — {t('codesQueueNote')}</Notice>
      )}

      <Card
        title={app ? `${t('codesLive')} — ${appTabs.find((x) => x.id === app)?.label || app}` : t('codesLive')}
        icon={<Timer className="h-4 w-4" />}
        action={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
              <input
                type="checkbox"
                checked={onlyLive}
                onChange={(e) => setOnlyLive(e.target.checked)}
              />
              {t('codesOnlyLive')}
            </label>
            <ActionButton onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" />
            </ActionButton>
          </div>
        }
      >
        {shown.length === 0 ? (
          <Empty
            icon={<Mail className="h-6 w-6" />}
            title={t('codesEmpty')}
            hint={t('codesEmptyHint')}
          />
        ) : (
          <Table
            head={[t('codesEmail'), t('codesFrom'), t('codesCode'), t('codesLeft'), t('codesState'), '']}
          >
            {shown.map((item) => (
              <CodeRow key={item.id} item={item} now={tick} />
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

/* ------------------- کدِ بازیابیِ رمز — بندِ ۶.۱ سند --------------------- */

/**
 *  خواستهٔ صاحب سامانه: «تغییرِ رمز برای کاربرهای برنامه راحت و آسان شود:
 *  کدِ شش‌رقمی به طرف داده شود، بعد از زدنش در برنامه رمزِ تازه بگذارد.»
 *
 *  ⛔ **رمزِ تازه از این‌جا گذاشته نمی‌شود و هیچ‌وقت نباید بشود.** کاربر
 *  خودش در برنامه کد را می‌زند. مدیری که بتواند رمزِ کسی را عوض کند،
 *  می‌تواند جای او وارد شود — آن یک درِ پشتی است، نه یک قابلیت.
 *
 *  ⚠️ و جایش عمداً **همین صفحه** است، نه صفحه‌ای تازه: کدی که این دکمه
 *  می‌سازد همان لحظه در فهرستِ پایینِ همین صفحه می‌نشیند و با همان
 *  «نمایشِ کد» و «دوباره بفرست» اداره می‌شود. دو صفحه برای یک موضوع همان
 *  سردرگمی است که گامِ ۴ی ریمیک برداشت.
 */
function ResetModal({ startApp, onClose }: { startApp: string; onClose: () => void }) {
  const { t } = useApp();
  const [email, setEmail] = useState('');
  const [app, setApp] = useState(startApp);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (busy || !email.trim()) return;
    setBusy(true);
    try {
      await api('/api/account-admin/otp/password-reset', { body: { email: email.trim(), app } });
      //  ⚠️ کد این‌جا نشان داده نمی‌شود — همان لحظه در فهرستِ زنده می‌آید
      toast(t('codesResetSent'), 'good');
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : t('codesResetFailed'), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('codesResetTitle')}
      footer={(
        <>
          <button className="btn" onClick={onClose}>{t('close')}</button>
          <ActionButton className="btn btn-primary" onClick={send} disabled={busy || !email.trim()}>
            {busy ? '…' : t('codesResetSend')}
          </ActionButton>
        </>
      )}
    >
      <p className="mb-3 text-xs text-ink-muted" dir="auto">{t('codesResetHint')}</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
        <Field label={t('codesEmail')}>
          <input
            className="input w-full"
            dir="ltr"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
            placeholder="name@example.com"
          />
        </Field>
        <Field label={t('codesFrom')}>
          <Select
            value={app}
            onChange={setApp}
            options={[{ value: 'pump', label: t('codesAppPump') }, { value: 'shop', label: t('codesAppShop') }]}
          />
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------- ساختِ کد از خودِ پنل و فرستادنش ---------------------- */

/**
 *  «کدِ همه یک جا ساخته بشه» — همان کاری که تا ۱.۵۰.۱۵ فقط در «پمپ‌بنزین‌ها ←
 *  کد و ربات» بود (`PumpCodes.tsx`)، حالا برای هر تب. همان موتور، همان صف،
 *  همان قالبِ ایمیلِ خودِ پنل (`/api/codes-admin/send`).
 *
 *  ⚠️ این درخواست عمداً کُند است و باید باشد: سرور تا خودِ سرورِ ایمیل نگوید
 *  «گرفتم» جواب نمی‌دهد. تا دیروز همان لحظه «فرستاده شد» می‌گفت و اگر ایمیل
 *  نمی‌رفت، هیچ‌جا معلوم نمی‌شد. و کدِ ساخته‌شده همان لحظه در فهرستِ زنده
 *  با «رفت / نرفت» می‌نشیند.
 */
function MakeCodeModal({ target, onClose, onDone }: { target: { slug: string; name: string }; onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async () => {
    if (!email.trim() || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await api<{ ok: boolean; message?: string; delivery?: { state: string; error?: string | null } }>(
        '/api/codes-admin/send',
        { method: 'POST', body: { app: target.slug, appName: target.name, kind: 'app', email: email.trim(), name: name.trim() || undefined } }
      );
      const failed = res.delivery?.state === 'failed' || res.ok === false;
      setNote({ ok: !failed, text: res.message || (failed ? t('codesFailed') : t('codesSent')) });
      if (!failed) { setEmail(''); setName(''); }
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : t('codesFailed') });
    } finally {
      setBusy(false);
      onDone();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('codesMakeTitle')} — ${target.name}`}
      footer={(
        <>
          <button className="btn" onClick={onClose}>{t('close')}</button>
          <ActionButton className="btn btn-primary" onClick={send} disabled={busy || !email.trim()}>
            {busy ? t('codesSending') : t('codesMakeSend')}
          </ActionButton>
        </>
      )}
    >
      <p className="mb-3 text-xs text-ink-muted" dir="auto">{t('codesMakeHint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('codesEmail')}>
          <input
            className="input w-full"
            dir="ltr"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
            placeholder="name@example.com"
          />
        </Field>
        <Field label={t('codesMakeName')}>
          <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      {note && (
        <p className="mt-3 text-xs" style={{ color: note.ok ? 'var(--status-good)' : 'var(--status-critical)' }} dir="auto">
          {note.text}
        </p>
      )}
    </Modal>
  );
}

function CodeRow({ item, now }: { item: LiveItem; now: number }) {
  const { t } = useApp();
  const left = Math.max(0, Math.round((item.expiresAt - now) / 1000));
  const live = item.status === 'live' && left > 0;

  /*
   *  ⚠️ **کدِ ردیفِ سرورِ حساب از ۱.۵۰.۳ خودش در فهرست می‌آید** — خواستهٔ
   *  صریحِ صاحب سامانه: «کدهایی که ساخته می‌شه اول همین‌جا بیان و بعد بره
   *  به ایمیل». سرور آن را یک بار می‌پرسد و نگه می‌دارد
   *  (`server/src/codes/mirror.js`)، پس دفترِ ممیزی برای هر کد **یک**
   *  ردیف دارد و تازه شدنِ دو‌ونیم‌ثانیه‌ایِ صفحه هیچ ردیفِ تازه‌ای
   *  نمی‌سازد — همان نگرانیِ واقعیِ قاعدهٔ ۱۴۰۵/۰۷/۰۴.
   *
   *  ⛔ و این دکمه برداشته **نشد**: سرورِ حسابِ کهنه، سقفِ هر دور، یا یک
   *  خطای گذرا یعنی ردیفی که کدش نیامده — و آن ردیف نباید بن‌بست باشد.
   */
  /*
   *  ⛔ **سه دفترِ کد، سه در.** یکی کردنشان یعنی ۴۰۴ برای نیمی از ردیف‌ها:
   *  کدِ ورود در `logins` است و کدِ ثبت‌نام در `otp`.
   */
  const door = `/api/account-admin/${item.source === 'account-otp' ? 'otp' : 'logins'}/${encodeURIComponent(String(item.id))}`;

  const [shown, setShown] = useState('');
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState('');
  const code = item.code || shown;

  const reveal = async () => {
    if (revealing) return;
    setRevealing(true);
    setRevealError('');
    try {
      //  ⛔ هر دفتر درِ خودش را دارد؛ یکی کردنشان یعنی ۴۰۴ برای نیمی از ردیف‌ها
      const r = await api<{ code?: string }>(`${door}/reveal`, { body: {} });
      setShown(String(r.code || ''));
    } catch (e) {
      setRevealError(e instanceof Error ? e.message : t('codesRevealFailed'));
    } finally {
      setRevealing(false);
    }
  };

  /*
   *  ⛔ **«ارسالِ خودکار نشد، خودم می‌فرستم» — بندِ ۲.۶ سند.**
   *
   *  خواستهٔ صاحب سامانه: «اگر در مرورِ زمان مشکل در ارسالِ خودکار پیش
   *  آمد، خودم درجا و سریع بفرستم به طرف.»
   *
   *  ⛔ همان کد فرستاده می‌شود، نه کدِ تازه: کدی که همین حالا دستِ مشتری
   *  است باید تا آخرِ اعتبارش کار کند.
   *
   *  ⚠️ و «نرفت» سبز نمی‌شود — سرورِ حساب برای رباتِ تنظیم‌نشده ۴۰۹ می‌دهد
   *  و همان پیام این‌جا سرخ نشان داده می‌شود. وگرنه دکمه‌ای می‌ماند که
   *  می‌گوید «فرستادم» و هیچ ایمیلی نمی‌رود.
   */
  const [sending, setSending] = useState(false);
  const [sendNote, setSendNote] = useState<{ ok: boolean; text: string } | null>(null);

  const resend = async () => {
    if (sending) return;
    setSending(true);
    setSendNote(null);
    try {
      await api(`${door}/resend`, { body: {} });
      setSendNote({ ok: true, text: t('codesSentAgain') });
    } catch (e) {
      setSendNote({ ok: false, text: e instanceof Error ? e.message : t('codesSendAgainFailed') });
    } finally {
      setSending(false);
    }
  };

  /*
   *  ⛔ **یک کلیک ⇒ نامهٔ آماده — بندِ ۲.۵ سند.**
   *
   *  خواستهٔ صاحب سامانه: «با یک کلیک هم من بتوانم درجا بروم ایمیلِ همان
   *  طرف با کدِ آماده.»
   *
   *  ⚠️ `mailto:` برنامهٔ ایمیلِ خودِ کامپیوتر را با گیرنده و موضوع و متنِ
   *  آماده باز می‌کند. هیچ کتابخانه‌ای اضافه نشد و هیچ نامه‌ای از این
   *  کامپیوتر بیرون نمی‌رود تا خودِ صاحبِ سامانه «بفرست» را نزند.
   *
   *  ⛔ **و فقط وقتی کد روی صفحه است.** نامهٔ آماده بی کد یعنی یک نامهٔ
   *  خالی — پس دکمه تا «نمایشِ کد» زده نشود نیست.
   */
  const mailHref = code
    ? `mailto:${encodeURIComponent(item.email)}`
      + `?subject=${encodeURIComponent(t('codesMailSubject'))}`
      + `&body=${encodeURIComponent(t('codesMailBody').replace('{code}', code))}`
    : null;

  const stateColor =
    item.logOnly ? 'var(--status-warning)'
    : item.sendState === 'sent' ? 'var(--status-good)'
    : item.sendState === 'failed' ? 'var(--status-critical)'
    : 'var(--status-warning)';

  const stateLabel =
    item.logOnly ? t('codesLogOnly')
    : item.sendState === 'sent' ? t('codesSent')
    : item.sendState === 'failed' ? t('codesFailed')
    : item.sendState === 'sending' ? t('codesSending')
    : t('codesQueued');

  return (
    <Row>
      <Cell>
        <div className="min-w-0">
          <p className="truncate text-sm" dir="ltr">{item.email}</p>
          {item.subjectId && (
            <p className="truncate font-mono text-[10px] text-ink-muted" dir="ltr">{item.subjectId}</p>
          )}
        </div>
      </Cell>

      <Cell>
        <div className="min-w-0">
          <p className="truncate text-sm">{item.appName}</p>
          <p className="truncate text-[10px] text-ink-muted">
            {item.source === 'account' ? t('codesFromAccount')
              : item.source === 'account-otp' ? `${t('codesFromAccountOtp')} · ${item.purpose}`
              : item.purpose}
            {item.autoResend ? ` · ${t('codesAuto')}` : ''}
            {item.locked ? ` · ${t('codesLocked')}` : ''}
          </p>
        </div>
      </Cell>

      {/* خودِ کد — بزرگ و خوانا، چون ممکن است تلفنی بخوانیدش */}
      <Cell>
        {code ? (
          <span className="tnum font-mono text-base font-semibold tracking-[0.2em]" dir="ltr">
            {code}
          </span>
        ) : live && item.canReveal ? (
          <>
            <ActionButton onClick={reveal} disabled={revealing}>
              {revealing ? '…' : t('codesReveal')}
            </ActionButton>
            {revealError && (
              <p className="mt-1 text-[10px] leading-snug" style={{ color: 'var(--status-critical)' }} dir="auto">
                {revealError}
              </p>
            )}
          </>
        ) : (
          <span className="text-xs text-ink-muted">
            {item.status === 'used' ? t('codesUsed')
              : item.status === 'replaced' ? t('codesReplaced')
              : t('codesExpired')}
          </span>
        )}
      </Cell>

      <Cell>
        {live ? (
          <span
            className="tnum text-xs"
            style={{ color: left <= 15 ? 'var(--status-warning)' : 'var(--text-secondary)' }}
          >
            {left}s
          </span>
        ) : (
          <span className="text-xs text-ink-muted">—</span>
        )}
      </Cell>

      <Cell>
        <span
          className="chip whitespace-nowrap"
          style={{ background: `color-mix(in srgb, ${stateColor} 15%, transparent)`, color: stateColor }}
          title={item.sendError || item.sendResponse || undefined}
        >
          {stateLabel}
        </span>
        {item.tries > 0 && (
          <span className="ms-1 text-[10px] text-ink-muted">{t('codesTries')}: {item.tries}</span>
        )}
        {/*
          ⚠️ دلیلِ نرفتن باید دیده شود، نه اینکه پشتِ نگه‌داشتنِ موس قایم بماند.
          گزارشِ واقعی: «۵ تا تست زدم، ۲ تا رفت و سه تا نیامد و هیچ‌جا نگفت چرا.»
        */}
        {item.sendState === 'failed' && item.sendError && (
          <p className="mt-1 text-[10px] leading-snug" style={{ color: 'var(--status-critical)' }} dir="auto">
            {item.sendError}
          </p>
        )}
      </Cell>

      <Cell className="text-end">
        <div className="flex items-center justify-end gap-1">
          {code && <CopyButton value={code} />}

          {/*
            ⛔ بندِ ۲.۵ — یک کلیک و نامه آماده است.
            فقط وقتی کد روی صفحه است؛ نامهٔ آمادهٔ بی کد یک نامهٔ خالی است.
          */}
          {mailHref && (
            <a
              className="chip whitespace-nowrap"
              href={mailHref}
              title={t('codesMailHint')}
            >
              <Send className="h-3 w-3" />
            </a>
          )}

          {/*
            ⛔ بندِ ۲.۶ — فرستادنِ دوبارهٔ همان کد.
            فقط برای کدِ زندهٔ سرورِ حساب: کدِ مرده دوباره فرستادنی نیست و
            کدِ خودِ پنل صفِ خودش را دارد.
          */}
          {live && item.source !== 'panel' && (
            <ActionButton onClick={resend} disabled={sending}>
              {sending ? '…' : t('codesSendAgain')}
            </ActionButton>
          )}
        </div>

        {sendNote && (
          <p
            className="mt-1 text-[10px] leading-snug"
            style={{ color: sendNote.ok ? 'var(--status-good)' : 'var(--status-critical)' }}
            dir="auto"
          >
            {sendNote.text}
          </p>
        )}
      </Cell>
    </Row>
  );
}

/* ---------------------------- تبِ برنامه‌ها ------------------------------ */

function AppsTab() {
  const { t } = useApp();
  const [apps, setApps] = useState<CodeApp[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [guide, setGuide] = useState<CodeApp | null>(null);

  const load = useCallback(() => {
    api<{ apps: CodeApp[] }>('/api/codes-admin/apps')
      .then((r) => setApps(r.apps))
      .catch(() => setApps([]));
  }, []);

  useEffect(load, [load]);

  if (!apps) return <Loading />;

  return (
    <div className="space-y-4">
      <Notice tone="info">{t('codesAppsHint')}</Notice>

      <Card
        title={t('codesApps')}
        icon={<KeyRound className="h-4 w-4" />}
        action={
          <button className="btn btn-sm" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t('codesAddApp')}
          </button>
        }
      >
        {apps.length === 0 ? (
          <Empty icon={<KeyRound className="h-6 w-6" />} title={t('codesNoApps')} hint={t('codesNoAppsHint')} />
        ) : (
          <Table head={[t('codesAppName'), t('codesAppId'), t('codesKey'), t('codesOn'), '']}>
            {apps.map((row) => (
              <Row key={row.slug}>
                <Cell>
                  <p className="truncate text-sm">{row.name}</p>
                  <p className="text-[10px] text-ink-muted">{row.kindLabel}</p>
                </Cell>
                <Cell mono>{row.slug}</Cell>
                <Cell>
                  <span className="font-mono text-[10px] text-ink-muted" dir="ltr">
                    {row.apiKey.slice(0, 12)}…
                  </span>
                </Cell>
                <Cell>
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={async (e) => {
                      await api(`/api/codes-admin/apps/${row.slug}`, {
                        method: 'PUT',
                        body: { enabled: e.target.checked },
                      });
                      load();
                    }}
                  />
                </Cell>
                <Cell className="text-end">
                  <div className="flex justify-end gap-1.5">
                    <button className="btn btn-sm" onClick={() => setGuide(row)}>
                      {t('codesConnect')}
                    </button>
                    <ActionButton
                      onClick={async () => {
                        await api(`/api/codes-admin/apps/${row.slug}/key`, { method: 'POST' });
                        toast(t('codesKeyRotated'));
                        load();
                      }}
                      title={t('codesRotateHint')}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </ActionButton>
                    <ActionButton
                      onClick={async () => {
                        if (!confirm(t('codesDeleteAsk'))) return;
                        await api(`/api/codes-admin/apps/${row.slug}`, { method: 'DELETE' });
                        load();
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </ActionButton>
                  </div>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      {adding && (
        <AddApp
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            load();
          }}
        />
      )}
      {guide && <ConnectGuide app={guide} onClose={() => setGuide(null)} />}
    </div>
  );
}

function AddApp({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useApp();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [kind, setKind] = useState<'app' | 'site'>('app');

  return (
    <Modal open title={t('codesAddApp')} onClose={onClose}>
      <Field label={t('codesAppName')}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('codesAppId')} hint={t('codesAppIdHint')}>
        <input className="input" dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value)} />
      </Field>
      <Field label={t('codesKind')}>
        <Select
          value={kind}
          onChange={(v) => setKind(v as 'app' | 'site')}
          options={[
            { value: 'app', label: t('codesKindApp') },
            { value: 'site', label: t('codesKindSite') },
          ]}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <button className="btn btn-sm" onClick={onClose}>{t('cancel')}</button>
        <ActionButton
          className="btn btn-sm btn-primary"
          onClick={async () => {
            if (!name.trim() && !slug.trim()) return;
            await api('/api/codes-admin/apps', {
              method: 'POST',
              body: { name: name.trim() || slug.trim(), slug: slug.trim() || name.trim(), kind },
            });
            onDone();
          }}
        >
          {t('ccSave')}
        </ActionButton>
      </div>
    </Modal>
  );
}

/**
 * «این برنامه را چطور وصل کنم؟»
 *
 * دو درخواست، با همان کلیدی که همین‌جا جلوی چشم است. عمداً curl نوشته شده
 * نه کدِ یک زبانِ خاص — هر زبانی همین دو درخواست را می‌فرستد.
 */
function ConnectGuide({ app, onClose }: { app: CodeApp; onClose: () => void }) {
  const { t } = useApp();
  const base = `${location.origin}/api/codes`;

  const request = `curl -X POST ${base}/request \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: ${app.apiKey}" \\
  -d '{"app":"${app.slug}","email":"user@example.com","userId":"USER-1"}'`;

  const verify = `curl -X POST ${base}/verify \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: ${app.apiKey}" \\
  -d '{"app":"${app.slug}","email":"user@example.com","code":"123456"}'`;

  return (
    <Modal open title={`${t('codesConnect')} — ${app.name}`} onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <div>
          <p className="label">{t('codesKey')}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-raised px-2 py-1.5 font-mono text-xs" dir="ltr">
              {app.apiKey}
            </code>
            <CopyButton value={app.apiKey} />
          </div>
          <p className="mt-1 text-[11px] text-ink-muted">{t('codesKeySecret')}</p>
        </div>

        <div>
          <p className="label">{t('codesStep1')}</p>
          <pre className="overflow-x-auto rounded-lg bg-surface-raised p-3 text-[11px] leading-relaxed" dir="ltr">
            {request}
          </pre>
          <div className="mt-1 flex justify-end"><CopyButton value={request} /></div>
        </div>

        <div>
          <p className="label">{t('codesStep2')}</p>
          <pre className="overflow-x-auto rounded-lg bg-surface-raised p-3 text-[11px] leading-relaxed" dir="ltr">
            {verify}
          </pre>
          <div className="mt-1 flex justify-end"><CopyButton value={verify} /></div>
        </div>

        <Notice tone="info">{t('codesConnectHint')}</Notice>
      </div>
    </Modal>
  );
}

/* ------------------------------ تبِ ربات -------------------------------- */

function BotTab({ onQueue }: { onQueue: (q: QueueState) => void }) {
  const { t } = useApp();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [testTo, setTestTo] = useState('');

  const load = useCallback(() => {
    api<{ settings: Settings; queue: QueueState }>('/api/codes-admin/settings')
      .then((r) => {
        setSettings(r.settings);
        setQueue(r.queue);
        onQueue(r.queue);
      })
      .catch(() => {});
  }, [onQueue]);

  useEffect(load, [load]);

  if (!settings) return <Loading />;

  const patch = (change: Partial<Settings>) => setSettings({ ...settings, ...change });
  const patchMail = (change: Partial<Settings['email']>) =>
    setSettings({ ...settings, email: { ...settings.email, ...change } });

  const save = async () => {
    await api('/api/codes-admin/settings', { method: 'PUT', body: settings });
    toast(t('saved'));
    load();
  };

  return (
    <div className="space-y-4">
      {!settings.mailReady && <Notice tone="warn">{t('codesNoMail')}</Notice>}

      <Card title={t('codesMailServer')} icon={<Mail className="h-4 w-4" />}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('codesHost')} hint="smtp.gmail.com">
            <input className="input" dir="ltr" value={settings.email.host}
              onChange={(e) => patchMail({ host: e.target.value })} />
          </Field>
          <Field label={t('codesPort')} hint="465 / 587">
            <input className="input" dir="ltr" type="number" value={settings.email.port}
              onChange={(e) => patchMail({ port: Number(e.target.value) })} />
          </Field>
          <Field label={t('codesUser')}>
            <input className="input" dir="ltr" value={settings.email.username}
              onChange={(e) => patchMail({ username: e.target.value })} />
          </Field>
          <Field label={t('codesPass')}>
            <input className="input" dir="ltr" type="password" value={settings.email.password}
              onChange={(e) => patchMail({ password: e.target.value })} />
          </Field>
          <Field label={t('codesFrom')}>
            <input className="input" dir="ltr" value={settings.email.from}
              onChange={(e) => patchMail({ from: e.target.value })} />
          </Field>
          <Field label={t('codesFromName')}>
            <input className="input" value={settings.email.fromName}
              onChange={(e) => patchMail({ fromName: e.target.value })} />
          </Field>
        </div>

        <Notice tone="warn">{t('codesDeliverability')}</Notice>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label={t('codesTestTo')}>
              <input className="input" dir="ltr" value={testTo}
                onChange={(e) => setTestTo(e.target.value)} placeholder={settings.email.from} />
            </Field>
          </div>
          <ActionButton
            className="btn btn-sm mb-3"
            onClick={async () => {
              try {
                await api('/api/codes-admin/test-email', { method: 'POST', body: { to: testTo } });
                toast(t('codesTestSent'));
              } catch (e: any) {
                toast(e?.message || t('codesTestFailed'), 'bad');
              }
            }}
          >
            <Send className="h-3.5 w-3.5" />
            {t('codesTest')}
          </ActionButton>
        </div>
      </Card>

      <Card title={t('codesRules')} icon={<ShieldCheck className="h-4 w-4" />}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('codesTtl')} hint={t('codesTtlHint')}>
            <input className="input" dir="ltr" type="number" value={settings.ttlSeconds}
              onChange={(e) => patch({ ttlSeconds: Number(e.target.value) })} />
          </Field>
          <Field label={t('codesResend')} hint={t('codesResendHint')}>
            <input className="input" dir="ltr" type="number" value={settings.resendSeconds}
              onChange={(e) => patch({ resendSeconds: Number(e.target.value) })} />
          </Field>
          <Field label={t('codesAutoAfter')} hint={t('codesAutoAfterHint')}>
            <input className="input" dir="ltr" type="number" value={settings.autoResendSeconds}
              onChange={(e) => patch({ autoResendSeconds: Number(e.target.value) })} />
          </Field>
          <Field label={t('codesAutoMax')}>
            <input className="input" dir="ltr" type="number" value={settings.autoResendMax}
              onChange={(e) => patch({ autoResendMax: Number(e.target.value) })} />
          </Field>
          <Field label={t('codesMaxTries')}>
            <input className="input" dir="ltr" type="number" value={settings.maxTries}
              onChange={(e) => patch({ maxTries: Number(e.target.value) })} />
          </Field>
          <Field label={t('codesWorkers')} hint={t('codesWorkersHint')}>
            <input className="input" dir="ltr" type="number" value={settings.workers}
              onChange={(e) => patch({ workers: Number(e.target.value) })} />
          </Field>
        </div>
      </Card>

      <Card title={t('codesQueue')} icon={<Bot className="h-4 w-4" />}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t('codesQWaiting')} value={queue?.waiting ?? 0} />
          <Stat label={t('codesQSending')} value={queue?.sending ?? 0} />
          <Stat label={t('codesQWorkers')} value={`${queue?.busyWorkers ?? 0}/${queue?.workers ?? 0}`} />
          <Stat label={t('codesQSentHour')} value={queue?.sentLastHour ?? 0} />
        </div>
      </Card>

      <div className="flex justify-end">
        <ActionButton className="btn btn-primary" onClick={save}>{t('ccSave')}</ActionButton>
      </div>
    </div>
  );
}
