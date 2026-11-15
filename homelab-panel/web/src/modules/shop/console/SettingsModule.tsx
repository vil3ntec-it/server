// ---------------------------------------------------------------------------
//  ۴.۱۲ — تنظیماتِ مرکزی و پرچم‌ها، در یک جا
//
//   • پرچم‌های شناخته (کاتالوگِ سرورِ حساب): `FlagsCard.tsx` (۱.۵۱.۱) — دامنهٔ پیش‌فرض یک دکان، ویرایشِ دسته‌ای با یک دلیل
//     و یک درخواست (همه یا هیچ)، «حالتِ تغییر» (یک بار رمز، ۱۵ دقیقهٔ لغزان، سقفِ ۶۰)؛ نوشتنِ تأیید فقط برای «همه» یا پرخطر.
//     «بازگشت به پیش‌فرض» = پاک کردنِ مقدارِ نوشته‌شده (با دلیل). تاریخچه: چه کسی، کی، پیشین ⇒ تازه، چرا.
//   • روزهای آزمایشیِ دکان: عددِ ۰ تا ۳۶۵۰، دلیل و تأیید؛ تاریخچه از دفترِ پنل (پیشین ⇒ تازه).
//   • انتشار (کانالِ آزمایشی): خواندن؛ عوض کردنش جای «نسخه‌ها و انتشار» است.
//   • حدها: سرورِ حساب امروز هیچ حدِ مرکزیِ تنظیم‌پذیری ندارد ⇒ صادقانه «پشتیبانی نمی‌شود».
//   • تعطیلاتِ رسمی (۱.۵۰.۷۸، LOC-04، `holidays.v1`): `HolidaysCard.tsx`.
//   • مترادف‌های جست‌وجو (۱.۵۰.۸۹، ۴-۱ «ب»، `synonyms.v1`): `SynonymsCard.tsx`.
//   • «اعلانِ گوشی (Firebase)» (۱.۵۱.۲): `PushCard.tsx` — کلیدِ حسابِ سرویس و «روشن»، پشتِ «حالتِ تغییر»؛ زیرش همان `FlagsCard`
//     فقط برای ‎shop.device_push‎ و ‎shop.order_notify‎؛ و `AdminWebCard.tsx` («پنلِ مدیرِ سرور»: دکمه، نام/رمز، «باز می‌شود؟»).
//     لینکِ مستقیم: ‎?tab=settings&card=push‎ و ‎&card=admin‎ (منوی کناری و جست‌وجوی بخش).
//  ⛔ مقدار همیشه از سرور؛ «نوشته نشده» با پیش‌فرضش کنارش، نه مقدارِ ساختگی. نتیجه «تأییدشده از سرورِ حساب».
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Gauge, Rocket } from 'lucide-react';

import {
  api,
  Card,
  Cell,
  fmtTime,
  KV,
  type Load,
  Notice,
  NotSupported,
  Row,
  SensitiveDialog,
  type SensitiveSubmit,
  StateEmpty,
  StateLoading,
  Table,
  useApp,
  useLoad,
  useTx,
} from '../host';
import { FlagHistoryCard, LiveConfigCard, Problem, SourceLine } from '../ShopConsole';
import { CONSOLE, PUSH_FLAG_KEYS, shown, type ReleaseBeta } from '../consoleData';
import type { ModuleProps } from './contract';
import AdminWebCard from './AdminWebCard';
import FlagsCard from './FlagsCard';
import PushCard from './PushCard';
import HolidaysCard from './HolidaysCard';
import SynonymsCard from './SynonymsCard';

type AuditRow = { id: number; actor?: string; action?: string; detail?: string; at?: number };
const parse = (s?: string) => { try { return s ? JSON.parse(s) as Record<string, unknown> : {}; } catch { return {}; } };

function TrialCard() {
  const tx = useTx();
  const { can } = useApp();
  const cfg = useLoad<{ config?: Record<string, string> }>('/api/account-admin/account-config');
  const hist = useLoad<{ rows?: AuditRow[] }>('/api/control/audit?action=account.trial.update&limit=10');
  const [val, setVal] = useState('');
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState('');
  const cur = cfg.data?.config?.trial_days;
  const n = Number(val);
  const valid = val.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 3650 && String(n) !== String(cur ?? '');
  const rows = Array.isArray(hist.data?.rows) ? hist.data!.rows! : [];
  const submit = async (x: SensitiveSubmit) => {
    const out = await api<{ config?: Record<string, string> }>('/api/account-admin/account-config', { method: 'PATCH', body: { trial_days: n, reason: x.reason } });
    setDone(tx('روزهای آزمایشیِ دکان: {v} — تأییدشده از سرورِ حساب', 'Shop trial days: {v} — confirmed by the account server', 'د هټۍ ازمایښتي ورځې: {v} — تایید شوی', { v: shown(out.config?.trial_days) }));
    setOpen(false);
    setVal('');
    await Promise.all([cfg.reload(), hist.reload()]);
  };
  return (
    <Card title={tx('دورهٔ آزمایشیِ دکانِ تازه', 'Trial period for new shops', 'د نوې هټۍ ازمایښتي موده')} icon={<CalendarClock size={15} />}>
      {cfg.error ? <Problem load={cfg as Load<unknown>} /> : !cfg.data ? <StateLoading /> : (
        <>
          <KV label={tx('روز', 'Days', 'ورځې')}>{shown(cur)}</KV>
          {done && <Notice tone="good">{done}</Notice>}
          {can('admin') && (
            <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) setOpen(true); }}>
              <input className="input w-28" type="number" min={0} max={3650} step={1} dir="ltr" value={val} onChange={(e) => setVal(e.target.value)}
                     aria-label={tx('روزِ تازه', 'New days', 'نوې ورځې')} />
              <button className="btn btn-sm" type="submit" disabled={!valid}>{tx('عوض کن…', 'Change…', 'بدل یې کړئ…')}</button>
              {val && !valid && <span className="text-[11px]" style={{ color: 'var(--status-warning)' }}>{tx('عددِ درست بین ۰ تا ۳۶۵۰، و جز مقدارِ فعلی', 'A whole number 0–3650, different from the current value', 'له ۰ تر ۳۶۵۰ پورې')}</span>}
            </form>
          )}
          <SourceLine source="/api/admin/plans (config)" at={cfg.at} />
          <p className="mt-3 text-xs font-semibold">{tx('تاریخچه (از این پنل)', 'History (from this panel)', 'تاریخچه (له دې پینل)')}</p>
          {hist.error ? <Problem load={hist as Load<unknown>} /> : !hist.data ? <StateLoading /> : rows.length === 0 ? <StateEmpty>{tx('هنوز تغییری ثبت نشده', 'No change recorded yet', 'تر اوسه بدلون نشته')}</StateEmpty> : (
            <Table head={[tx('کی', 'When', 'کله'), tx('چه کسی', 'Who', 'څوک'), tx('پیشین ⇒ تازه', 'From ⇒ to', 'مخکې ⇒ نوی'), tx('دلیل', 'Reason', 'لامل')]}>
              {rows.map((r) => {
                const d = parse(r.detail);
                const from = (d.from as Record<string, unknown> | undefined)?.trial_days;
                return (
                  <Row key={r.id}>
                    <Cell>{fmtTime(r.at)}</Cell><Cell>{r.actor || '—'}</Cell>
                    <Cell mono>{d.trial_days !== undefined ? `${from ?? '—'} ⇒ ${String(d.trial_days)}` : d.pump_trial_days !== undefined ? `pump: ${String(d.pump_trial_days)}` : '—'}</Cell>
                    <Cell>{typeof d.reason === 'string' ? d.reason : '—'}</Cell>
                  </Row>
                );
              })}
            </Table>
          )}
          <p className="mt-2 text-[11px] text-ink-muted">{tx('دورهٔ آزمایشیِ پمپ در بخشِ «پمپ‌بنزین‌ها ← اشتراک‌ها ← پلن» است.', 'The pump trial period is under “Fuel stations ← Subscriptions ← Plans”.', 'د پمپ ازمایښتي موده په «پمپونه» برخه کې ده.')}</p>
        </>
      )}
      {open && (
        <SensitiveDialog title={tx('دورهٔ آزمایشیِ دکان', 'Shop trial period', 'د هټۍ ازمایښتي موده')} onClose={() => setOpen(false)} onSubmit={submit}
                         effect={<>{shown(cur)} ⇒ {shown(n)} {tx('روز — فقط برای دکان‌هایی که از این پس ساخته می‌شوند.', 'days — only for shops created from now on.', 'ورځې — یوازې د نویو هټیو لپاره.')}</>} />
      )}
    </Card>
  );
}

function ReleaseCard() {
  const tx = useTx();
  const { can } = useApp();
  const load = useLoad<ReleaseBeta>(can('admin') ? CONSOLE.releaseBeta : null);
  return (
    <Card title={tx('تنظیماتِ انتشار', 'Release settings', 'د خپرونې تنظیمات')} icon={<Rocket size={15} />}
          action={<Link className="text-xs underline" to="/shop?tab=versions">{tx('نسخه‌ها و انتشار', 'Versions & releases', 'نسخې او خپرونه')}</Link>}>
      {!can('admin') ? <Notice>{tx('کانالِ آزمایشی را فقط مدیرِ پنل می‌بیند (سرورِ حساب هم آن را فقط به ارشد می‌دهد).', 'Only panel admins can see the beta channel (the account server gives it to super admins only).', 'یوازې مدیر یې ویني.')}</Notice>
        : load.error ? <Problem load={load as Load<unknown>} /> : !load.data ? <StateLoading /> : (
          <>
            <KV label={tx('دکان‌های کانالِ آزمایشی', 'Beta-channel shops', 'ازمایښتي هټۍ')}>{Array.isArray(load.data.shops?.ids) ? shown(load.data.shops!.ids!.length) : '—'}</KV>
            <KV label={tx('دستگاه‌های کانالِ آزمایشی', 'Beta-channel devices', 'ازمایښتي وسیلې')}>{Array.isArray(load.data.devices?.ids) ? shown(load.data.devices!.ids!.length) : '—'}</KV>
            <KV label={tx('آخرین تغییر', 'Last change', 'وروستی بدلون')}>{load.data.shops?.updatedBy || '—'} · {fmtTime(load.data.shops?.updatedAt)}</KV>
            <SourceLine source="/api/admin/release/beta" data={load.data} at={load.at} />
          </>
        )}
    </Card>
  );
}

function LimitsCard() {
  const tx = useTx();
  return (
    <Card title={tx('حدها', 'Limits', 'حدونه')} icon={<Gauge size={15} />}>
      <NotSupported>
        {tx('سرورِ حساب امروز هیچ حدِ مرکزیِ تنظیم‌پذیری (سقفِ دستگاه، کاربر یا درخواست) از راهِ API ندارد — حدها در کدِ خودش ثابت‌اند. عددی ساخته نمی‌شود.',
          'The account server has no centrally configurable limits (device, user or request caps) via its API today — limits are fixed in its code. No number is invented.',
          'د حساب سرور نن ورځ د API له لارې د تنظیم وړ مرکزي حدونه نه لري.')}
      </NotSupported>
    </Card>
  );
}

/** ‎?card=‎ ⇒ شناسهٔ همان کارت در صفحه */
const CARD_IDS: Record<string, string> = { push: 'shop-push', admin: 'shop-admin-web' };

export default function SettingsModule({ params, owner }: ModuleProps) {
  const tx = useTx();
  const card = params.get('card') || '';
  //  لینکِ مستقیم از منو یا جست‌وجو ⇒ همان کارت جلوی چشم (پس از رسیدنِ داده، یک بار دیگر)
  useEffect(() => {
    const id = CARD_IDS[card];
    if (!id) return undefined;
    const go = () => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    go();
    const t = setTimeout(go, 600);
    return () => clearTimeout(t);
  }, [card]);
  return (
    <div className="space-y-4">
      <div id="shop-push" className="scroll-mt-4 space-y-4">
        <PushCard />
        <FlagsCard only={PUSH_FLAG_KEYS} testid="pushflags"
                   title={tx('کلیدهای اعلان در دکان‌ها', 'Notification switches for shops', 'په هټیو کې د خبرتیا کیلي')}
                   intro={<p className="mb-3 text-xs leading-6 text-ink-muted">{tx('بی این دو، کلیدِ بالا تنهایی کافی نیست: «ثبتِ دستگاه» می‌گذارد گوشی‌های دکان نشانی‌شان را بدهند و «اعلانِ سفارش» خبرِ سفارشِ تازه را می‌فرستد. برای یک دکان یا «همهٔ دکان‌ها».', 'The key above is not enough alone: “device registration” lets the shop’s phones register, and “order alerts” sends new-order news. For one shop or “All shops”.', 'پورته کیلي یوازې بس نه ده؛ دا دوه هم روښانه کړئ.')}</p>} />
      </div>
      <div id="shop-admin-web" className="scroll-mt-4">
        <AdminWebCard owner={owner} />
      </div>
      <FlagsCard />
      <FlagHistoryCard />
      <HolidaysCard />
      <SynonymsCard />
      <div className="grid gap-4 lg:grid-cols-2">
        <TrialCard />
        <ReleaseCard />
      </div>
      <LiveConfigCard />
      <LimitsCard />
    </div>
  );
}
