// ---------------------------------------------------------------------------
//  ۴.۱۲ — تنظیماتِ مرکزی و پرچم‌ها، در یک جا
//
//   • پرچم‌های شناخته (کاتالوگِ سرورِ حساب): مقدارِ **نوع‌دار** (روشن/خاموش)، scope (همهٔ دکان‌ها یا یک دکان؛ امنیت در
//     scope ِ خودش)، فقط admin، دلیل + تأیید؛ پرخطر (همه/امنیت/پول/سفارش) ⇒ نوشتنِ نامِ کلید + رمزِ پنل.
//     «بازگشت به پیش‌فرض» = پاک کردنِ مقدارِ نوشته‌شده (با دلیل). تاریخچه: چه کسی، کی، پیشین ⇒ تازه، چرا.
//   • روزهای آزمایشیِ دکان: عددِ ۰ تا ۳۶۵۰، دلیل و تأیید؛ تاریخچه از دفترِ پنل (پیشین ⇒ تازه).
//   • انتشار (کانالِ آزمایشی): خواندن؛ عوض کردنش جای «نسخه‌ها و انتشار» است.
//   • حدها: سرورِ حساب امروز هیچ حدِ مرکزیِ تنظیم‌پذیری ندارد ⇒ صادقانه «پشتیبانی نمی‌شود».
//  ⛔ مقدار همیشه از سرور؛ «نوشته نشده» با پیش‌فرضش کنارش، نه مقدارِ ساختگی. نتیجه «تأییدشده از سرورِ حساب».
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Flag, Gauge, Rocket } from 'lucide-react';

import { api } from '../../../api';
import { useApp } from '../../../app-context';
import { Card } from '../../../components/ui';
import { Cell, KV, Notice, Row, Table } from '../../../control/ui';
import { useLoad, type Load } from '../shared';
import { FlagHistoryCard, LiveConfigCard, NotAvailable, Problem, SourceLine } from '../ShopConsole';
import { CONSOLE, isUnavailable, shown, type FlagItem, type Flags, type KnownFlag, type ReleaseBeta, type Unavailable } from '../consoleData';
import { SHELL_API, type ModuleProps } from './contract';
import { NotSupported, SensitiveDialog, StateEmpty, StateLoading, fmtTime, type SensitiveSubmit } from './parts';
import { useTx, type Tx } from './text';

/** همان قاعدهٔ سرور (`routes/console-shell.js` ⇒ `isRiskyFlag`) — فقط برای این‌که پنجره از پیش رمز و نام را بخواهد. */
const RISKY_KEYS = new Set(['shop.orders', 'shop.orders.refunds', 'shop.delivery', 'shop.storefront', 'hashchain.audit', 'market.directory']);
const risky = (key: string, scope: string) => scope === 'all' || scope === 'security' || RISKY_KEYS.has(key);
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

const onOff = (tx: Tx, v: unknown) => (v === true ? tx('روشن', 'On', 'روښانه') : v === false ? tx('خاموش', 'Off', 'بند') : '—');

type Edit = { mode: 'set' | 'reset'; k: KnownFlag; scope: string; from: unknown; to?: boolean };

function FlagsEditor() {
  const tx = useTx();
  const { can } = useApp();
  const admin = can('admin');
  const [scopeInput, setScopeInput] = useState('');
  const [scope, setScope] = useState('all');
  const [edit, setEdit] = useState<Edit | null>(null);
  const [done, setDone] = useState('');
  const all = useLoad<Flags | Unavailable>(CONSOLE.flags('all'));
  const shop = useLoad<Flags | Unavailable>(scope !== 'all' ? CONSOLE.flags(scope) : null, [scope]);
  const sec = useLoad<Flags | Unavailable>(CONSOLE.flags('security'));

  if (all.error) return <Card title={tx('پرچم‌ها', 'Flags', 'بیرغونه')} icon={<Flag size={15} />}><Problem load={all as Load<unknown>} /></Card>;
  if (!all.data) return <Card title={tx('پرچم‌ها', 'Flags', 'بیرغونه')} icon={<Flag size={15} />}><StateLoading /></Card>;
  if (isUnavailable(all.data)) return <Card title={tx('پرچم‌ها', 'Flags', 'بیرغونه')} icon={<Flag size={15} />}><NotAvailable data={all.data} /></Card>;

  const known = (Array.isArray(all.data.known) ? all.data.known : []).filter((k) => typeof k.default === 'boolean');
  const itemsOf = (d: Flags | Unavailable | null) => (d && !isUnavailable(d) && Array.isArray(d.items) ? d.items : []);
  const allItems = itemsOf(all.data);
  const shopItems = itemsOf(shop.data);
  const secItems = itemsOf(sec.data);
  //  کدام پرچم در این نما و scope ِ نوشتنش
  type FlagRow = { k: KnownFlag; scope: string; it?: FlagItem; base?: FlagItem };
  const rows = known.flatMap((k): FlagRow[] => {
    if (scope === 'all') {
      if (k.scope === 'shop' || k.scope === 'all') return [{ k, scope: 'all', it: allItems.find((x) => x.key === k.key) }];
      if (k.scope === 'security') return [{ k, scope: 'security', it: secItems.find((x) => x.key === k.key) }];
      return [];
    }
    return k.scope === 'shop' ? [{ k, scope, it: shopItems.find((x) => x.key === k.key), base: allItems.find((x) => x.key === k.key) }] : [];
  });

  const submit = async (x: SensitiveSubmit) => {
    if (!edit) return;
    if (edit.mode === 'set') {
      await api(SHELL_API.flags, { method: 'PUT', body: { scope: edit.scope, key: edit.k.key, value: edit.to, ...x, confirm: true } });
      setDone(tx('{k} در «{s}» ⇒ {v} — تأییدشده از سرورِ حساب', '{k} in “{s}” ⇒ {v} — confirmed by the account server', '{k} په «{s}» کې ⇒ {v} — تایید شوی', { k: edit.k.key, s: edit.scope, v: onOff(tx, edit.to) }));
    } else {
      await api(SHELL_API.flagsReset, { method: 'POST', body: { scope: edit.scope, key: edit.k.key, ...x, confirm: true } });
      setDone(tx('{k} در «{s}» به پیش‌فرض برگشت — تأییدشده از سرورِ حساب', '{k} in “{s}” reset to default — confirmed by the account server', '{k} بېرته پیشفرض ته — تایید شوی', { k: edit.k.key, s: edit.scope }));
    }
    setEdit(null);
    await Promise.all([all.reload(), sec.reload(), scope !== 'all' ? shop.reload() : Promise.resolve()]);
  };

  return (
    <Card title={tx('پرچم‌ها', 'Flags', 'بیرغونه')} icon={<Flag size={15} />}>
      <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); const v = scopeInput.trim(); setScope(v && ID_RE.test(v) ? v : 'all'); }}>
        <span className="text-xs text-ink-muted">{tx('دامنه', 'Scope', 'ساحه')}:</span>
        <input className="input w-full sm:w-64" dir="ltr" placeholder={tx('خالی = همهٔ دکان‌ها؛ یا شناسهٔ یک دکان', 'Empty = all shops; or a shop id', 'تش = ټولې هټۍ؛ یا د یوې هټۍ پېژند')}
               value={scopeInput} onChange={(e) => setScopeInput(e.target.value)} />
        <button className="btn btn-sm" type="submit">{tx('نشان بده', 'Show', 'وښایه')}</button>
        <code dir="ltr" className="text-xs">{scope}</code>
      </form>
      {!admin && <Notice>{tx('عوض کردنِ پرچم فقط برای مدیرِ پنل است (سرور هم همین را می‌سنجد).', 'Changing flags is for panel admins only (enforced by the server).', 'د بیرغ بدلول یوازې د پینل مدیر لپاره.')}</Notice>}
      {done && <Notice tone="good">{done}</Notice>}
      {scope !== 'all' && shop.error ? <Problem load={shop as Load<unknown>} /> : scope !== 'all' && !shop.data ? <StateLoading /> : (
        <Table head={[tx('کلید', 'Key', 'کلي'), tx('چیست', 'What', 'څه'), tx('مقدار', 'Value', 'ارزښت'), tx('پیش‌فرض', 'Default', 'پیشفرض'), tx('آخرین تغییر', 'Last change', 'وروستی بدلون'), '']}
               empty={rows.length === 0}>
          {rows.map(({ k, scope: sc, it, base }) => {
            const effective = it ? it.value : undefined;
            return (
              <Row key={`${sc}:${k.key}`}>
                <Cell mono>{k.key}{risky(k.key, sc) && <span className="chip mr-1 ml-1" style={{ color: 'var(--status-warning)' }}>{tx('پرخطر', 'risky', 'خطرناک')}</span>}</Cell>
                <Cell>{k.what || '—'}</Cell>
                <Cell>{it ? onOff(tx, effective) : <span className="text-ink-muted">{tx('نوشته نشده', 'not set', 'نه دی لیکل شوی')}{base ? ` (${tx('همه', 'all', 'ټول')}: ${onOff(tx, base.value)})` : ''}</span>}</Cell>
                <Cell>{onOff(tx, k.default)}</Cell>
                <Cell>{it ? `${it.updatedBy || '—'} · ${fmtTime(it.updatedAt)}` : '—'}</Cell>
                <Cell>
                  {admin && (
                    <div className="flex flex-wrap gap-1">
                      <button className="btn btn-sm" onClick={() => { setDone(''); setEdit({ mode: 'set', k, scope: sc, from: effective, to: !(it ? effective === true : k.default === true) }); }}>
                        {(it ? effective === true : k.default === true) ? tx('خاموش کن', 'Turn off', 'بند یې کړئ') : tx('روشن کن', 'Turn on', 'روښانه یې کړئ')}
                      </button>
                      {it && <button className="btn btn-sm" onClick={() => { setDone(''); setEdit({ mode: 'reset', k, scope: sc, from: effective }); }}>{tx('پیش‌فرض', 'Default', 'پیشفرض')}</button>}
                    </div>
                  )}
                </Cell>
              </Row>
            );
          })}
        </Table>
      )}
      <p className="mt-2 text-[11px] text-ink-muted">{tx('فقط پرچم‌های شناختهٔ روشن/خاموش این‌جا عوض می‌شوند؛ فهرستِ کانالِ آزمایشی از «نسخه‌ها و انتشار». نوعِ مقدار و scope را سرورِ حساب هم می‌سنجد.', 'Only known on/off flags change here; the beta-channel lists change from “Versions & releases”. The account server validates type and scope too.', 'دلته یوازې پېژندل شوي روښانه/بند بیرغونه بدلېږي.')}</p>
      <SourceLine source={`/api/admin/flags?scope=${scope}`} data={scope === 'all' ? all.data : shop.data} at={scope === 'all' ? all.at : shop.at} />

      {edit && (
        <SensitiveDialog
          title={edit.mode === 'set' ? tx('پرچمِ {k}', 'Flag {k}', 'بیرغ {k}', { k: edit.k.key }) : tx('بازگشتِ {k} به پیش‌فرض', 'Reset {k} to default', '{k} پیشفرض ته', { k: edit.k.key })}
          danger={risky(edit.k.key, edit.scope)} needPassword={risky(edit.k.key, edit.scope)} confirmKey={risky(edit.k.key, edit.scope) ? edit.k.key : undefined}
          onClose={() => setEdit(null)} onSubmit={submit}
          effect={<>
            <code dir="ltr">{edit.scope}</code>: {edit.from === undefined ? tx('نوشته نشده', 'not set', 'نه دی لیکل شوی') : onOff(tx, edit.from)} ⇒{' '}
            {edit.mode === 'set' ? onOff(tx, edit.to) : `${tx('پیش‌فرض', 'default', 'پیشفرض')} (${onOff(tx, edit.k.default)})`}
            <span className="block">{edit.scope === 'all' ? tx('روی همهٔ دکان‌هایی اثر دارد که مقدارِ جدا ندارند.', 'Affects every shop without its own value.', 'په ټولو هټیو اغېز کوي.')
              : edit.scope === 'security' ? tx('تنظیمِ امنیتیِ کلِ سرورِ حساب.', 'Security setting for the whole account server.', 'د ټول سرور امنیتي تنظیم.')
                : tx('فقط همین یک دکان.', 'This one shop only.', 'یوازې همدا هټۍ.')}</span>
          </>} />
      )}
    </Card>
  );
}

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

export default function SettingsModule(_props: ModuleProps) {
  return (
    <div className="space-y-4">
      <FlagsEditor />
      <FlagHistoryCard />
      <div className="grid gap-4 lg:grid-cols-2">
        <TrialCard />
        <ReleaseCard />
      </div>
      <LiveConfigCard />
      <LimitsCard />
    </div>
  );
}
