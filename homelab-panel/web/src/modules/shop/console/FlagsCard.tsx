// ---------------------------------------------------------------------------
//  ۴.۱۲ — کارتِ «پرچم‌ها»، ۱.۵۱.۱: «حالتِ تغییر» و ویرایشِ دسته‌ای
//
//  دستورِ صاحب سامانه: «این صد تا دوصد تا رو دونه‌به‌دونه بزنم؟ یک بار رمز رو می‌زنم و هر کدوم رو خواستم روشن یا
//  خاموش کنم.» مثلِ کنسولِ حرفه‌ای (sudo mode ِ GitHub، داشبوردِ Stripe):
//    • دامنه پیش‌فرض **یک دکان** است (تازه‌ترینِ به‌کاررفته یا تنها دکان)، نه «همه»؛ هشدارِ «همهٔ دکان‌ها» سرِ جایش.
//    • «ویرایش» ⇒ هر چند پرچم را روشن/خاموش کنید؛ شمارندهٔ «در انتظار»؛ «ذخیرهٔ n تغییر» = یک درخواست، یک دلیل.
//    • رمز فقط اگر پرچمِ پرخطری در دسته است **و** «حالتِ تغییر» بسته است؛ پس از آن ۱۵ دقیقه (لغزان، سقفِ ۶۰) بی رمز.
//    • نوشتنِ تأیید فقط برای «همهٔ دکان‌ها» یا پرچمِ پرخطر (یک پرچم ⇒ نامش، چند ⇒ scope)؛ یک دکان ⇒ فقط خلاصه.
//    • شرحِ فارسی درشت، کلید کوچک و فرعی؛ جست‌وجو در هر دو.
//  ⛔ مرز همان سرور است (‎server/src/modules/shop/routes/console-shell.js‎): نقش، احراز، پنجره، همه یا هیچ و دفتر. این‌جا
//     فقط از پیش می‌داند چه بخواهد (‎flagRisky‎ / ‎flagConfirmPhrase‎ ِ ‎consoleData.ts‎ — همان قاعدهٔ سرور، سنجیده).
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Flag, LockOpen, Pencil, RotateCcw, Search, ShieldAlert, X } from 'lucide-react';

import {
  api, Card, errCode, errText, fa, fmtTime, type Load, Modal, Notice, outcomeUnknown, StateEmpty, StateLoading, toast, type Tx,
  useApp, useLoad, useTx,
} from '../host';
import { NotAvailable, Problem, SourceLine } from '../ShopConsole';
import {
  CONSOLE, defaultFlagScope, FLAG_DANGER_KEYS, flagConfirmPhrase, flagMatches, flagRisky, type FlagBatchResult, type FlagChange, type FlagItem,
  type Flags, type FlagSudo, isUnavailable, type KnownFlag, newIdemKey, pushRecentShop, reasonOk, sudoMinutesLeft, type Unavailable,
} from '../consoleData';

const API = {
  sudo: '/api/account-admin/console/flags/sudo',
  batch: '/api/account-admin/console/flags/batch',
};
const RECENT_KEY = 'hlp.flags.recentShops';
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && ID_RE.test(x)).slice(0, 5) : [];
  } catch { return []; }
}
function saveRecent(list: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* حالتِ خصوصیِ مرورگر */ }
}

const onOff = (tx: Tx, v: unknown) => (v === true ? tx('روشن', 'On', 'روښانه') : v === false ? tx('خاموش', 'Off', 'بند') : '—');
const whatOf = (k: KnownFlag) => (typeof k.what === 'string' && k.what.trim() ? k.what : k.key);

type ShopLite = { id: string; name?: string };
type Row = { k: KnownFlag; it?: FlagItem; base?: FlagItem; effective: boolean; inherited: 'set' | 'all' | 'default' };
type Pending = Map<string, FlagChange>;

/* ───────────────────────── «حالتِ تغییر» ───────────────────────── */

function useSudo(enabled: boolean) {
  const [state, setState] = useState<{ s: FlagSudo; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const reload = useCallback(async () => {
    if (!enabled) return;
    try { setState({ s: await api<FlagSudo>(API.sudo), at: Date.now() }); } catch { setState(null); }
  }, [enabled]);
  useEffect(() => { void reload(); }, [reload]);
  const set = useCallback((s: FlagSudo | undefined | null) => { if (s) setState({ s, at: Date.now() }); }, []);
  const left = state ? sudoMinutesLeft(state.s, now, state.at) : null;
  //  شمارش هر ۱۵ ثانیه؛ رسید به صفر ⇒ یک بار از سرور (شاید کارِ تازه‌ای لغزانده باشدش)
  useEffect(() => {
    if (!state?.s.open) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [state]);
  useEffect(() => { if (left === 0) void reload(); }, [left, reload]);
  return { open: Boolean(state?.s.open) && left !== 0, left, reload, set };
}

function SudoBanner({ left, onClose }: { left: number | null; onClose: () => void }) {
  const tx = useTx();
  return (
    <div role="status" data-testid="flags-sudo" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm"
         style={{ borderColor: 'color-mix(in srgb, var(--status-good) 40%, transparent)', background: 'color-mix(in srgb, var(--status-good) 9%, transparent)' }}>
      <LockOpen size={16} style={{ color: 'var(--status-good)' }} />
      <span className="min-w-0 flex-1 font-medium">
        {tx('حالتِ تغییر باز است — {n} دقیقه مانده', 'Edit mode is unlocked — {n} min left', 'د بدلون حالت خلاص دی — {n} دقیقې پاتې', { n: fa(left ?? 0) })}
      </span>
      <button type="button" className="btn btn-sm" onClick={onClose}>{tx('بستن', 'Lock now', 'بندول')}</button>
    </div>
  );
}

/* ───────────────────────── کلیدِ روشن/خاموش ───────────────────────── */

function Switch({ on, label, onToggle, disabled }: { on: boolean; label: string; onToggle: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onToggle}
            className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
            style={{ background: on ? 'var(--accent)' : 'color-mix(in srgb, var(--text-muted) 35%, transparent)', outlineColor: 'var(--accent)' }}>
      <span className="absolute h-5 w-5 rounded-full bg-white shadow transition-[inset-inline-start] duration-150"
            style={{ insetInlineStart: on ? 'calc(100% - 1.375rem)' : '0.125rem' }} />
    </button>
  );
}

/* ───────────────────────── کارت ───────────────────────── */

export default function FlagsCard() {
  const tx = useTx();
  const { can } = useApp();
  const admin = can('admin');
  const title = tx('پرچم‌ها', 'Flags', 'بیرغونه');
  const icon = <Flag size={15} />;

  const [recent, setRecent] = useState<string[]>(readRecent);
  const [scope, setScope] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [other, setOther] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<Pending>(() => new Map());
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState('');

  const all = useLoad<Flags | Unavailable>(CONSOLE.flags('all'));
  const shopsLoad = useLoad<{ shops?: ShopLite[]; total?: number }>(CONSOLE.shops('', 50, 0));
  const shops = useMemo(() => (Array.isArray(shopsLoad.data?.shops) ? shopsLoad.data!.shops!.filter((s) => s && ID_RE.test(String(s.id))) : []), [shopsLoad.data]);
  const scoped = useLoad<Flags | Unavailable>(scope && scope !== 'all' ? CONSOLE.flags(scope) : null, [scope]);
  const sudo = useSudo(admin);
  const totp = useLoad<{ enabled?: boolean }>(admin ? '/api/auth/totp' : null);

  //  دامنهٔ پیش‌فرض: یک دکان (تازه‌ترین یا تنها) — یک بار، وقتی فهرستِ دکان‌ها رسید
  useEffect(() => {
    if (touched || scope) return;
    if (!shopsLoad.data && !shopsLoad.error) return;
    const d = defaultFlagScope(recent, shops);
    if (d) setScope(d);
  }, [touched, scope, shopsLoad.data, shopsLoad.error, recent, shops]);

  const known = useMemo(() => (all.data && !isUnavailable(all.data) && Array.isArray(all.data.known) ? all.data.known : [])
    .filter((k) => k && typeof k.key === 'string' && typeof k.default === 'boolean'), [all.data]);
  const hasScope = (s: string) => known.some((k) => k.scope === s);

  const rows: Row[] = useMemo(() => {
    if (!scope) return [];
    const itemsOf = (d: Flags | Unavailable | null) => (d && !isUnavailable(d) && Array.isArray(d.items) ? d.items : []);
    const allItems = itemsOf(all.data);
    const own = scope === 'all' ? allItems : itemsOf(scoped.data);
    return known.filter((k) => (scope === 'all' ? k.scope === 'shop' || k.scope === 'all' : ID_RE.test(scope) && !['security', 'ops'].includes(scope) ? k.scope === 'shop' : k.scope === scope))
      .map((k) => {
        const it = own.find((x) => x.key === k.key);
        const base = scope !== 'all' && k.scope === 'shop' ? allItems.find((x) => x.key === k.key) : undefined;
        const effective = it ? it.value === true : base ? base.value === true : k.default === true;
        return { k, it, base, effective, inherited: it ? 'set' : base ? 'all' : 'default' } as Row;
      });
  }, [scope, known, all.data, scoped.data]);
  const visible = rows.filter((r) => flagMatches(r.k, q));

  const changeScope = (s: string) => {
    if (pending.size) return;
    setTouched(true);
    setDone('');
    setScope(s);
  };
  const toggle = (r: Row) => {
    setPending((prev) => {
      const next = new Map(prev);
      const cur = next.get(r.k.key);
      const shown = cur ? (cur.reset ? (r.base ? r.base.value === true : r.k.default === true) : cur.value === true) : r.effective;
      const want = !shown;
      //  برگشت به همان حالِ امروز ⇒ دیگر «در انتظار» نیست
      if (r.it ? want === (r.it.value === true) : want === r.effective) next.delete(r.k.key);
      else next.set(r.k.key, { key: r.k.key, value: want });
      return next;
    });
  };
  const resetRow = (r: Row) => setPending((prev) => {
    const next = new Map(prev);
    if (next.get(r.k.key)?.reset) next.delete(r.k.key); else next.set(r.k.key, { key: r.k.key, reset: true });
    return next;
  });
  const cancelEdit = () => { setPending(new Map()); setEditing(false); };

  const changes = [...pending.values()];
  const riskyKeys = scope ? changes.filter((c) => flagRisky(c.key, scope)).map((c) => c.key) : [];

  const afterSave = async (r: FlagBatchResult) => {
    sudo.set(r.sudo);
    if (scope && scope !== 'all') { const next = pushRecentShop(recent, scope); setRecent(next); saveRecent(next); }
    setDone(tx('{n} تغییر در «{s}» ذخیره شد — تأییدشده از سرورِ حساب', '{n} changes in “{s}” saved — confirmed by the account server', '{n} بدلونونه خوندي شول — تایید شوی',
      { n: fa(r.count), s: scope || '' }));
    toast(tx('{n} تغییر ذخیره شد', '{n} changes saved', '{n} بدلونونه خوندي شول', { n: fa(r.count) }));
    setPending(new Map());
    setEditing(false);
    setSaving(false);
    await Promise.all([all.reload(), scope && scope !== 'all' ? scoped.reload() : Promise.resolve(), sudo.reload()]);
  };

  if (all.error) return <Card title={title} icon={icon}><Problem load={all as Load<unknown>} /></Card>;
  if (!all.data) return <Card title={title} icon={icon}><StateLoading /></Card>;
  if (isUnavailable(all.data)) return <Card title={title} icon={icon}><NotAvailable data={all.data} /></Card>;

  const shopName = (id: string) => shops.find((s) => s.id === id)?.name;
  const scopeLabel = (s: string) => (s === 'all' ? tx('همهٔ دکان‌ها', 'All shops', 'ټولې هټۍ') : s === 'security' ? tx('امنیتِ سرور', 'Server security', 'د سرور امنیت')
    : s === 'ops' ? tx('عملیات', 'Operations', 'عملیات') : shopName(s) || s);
  const options = Array.from(new Set([...recent, ...shops.map((s) => s.id), ...(scope && !['all', 'security', 'ops'].includes(scope) ? [scope] : [])]));
  const selectValue = scope || '';

  return (
    <Card title={title} icon={icon}
          action={admin && scope && !editing ? (
            <button type="button" className="btn btn-sm" onClick={() => { setDone(''); setEditing(true); }}>
              <Pencil size={14} />{tx('ویرایش', 'Edit', 'سمول')}
            </button>
          ) : undefined}>
      {admin && sudo.open && <SudoBanner left={sudo.left} onClose={async () => { try { sudo.set(await api<FlagSudo>(API.sudo, { method: 'DELETE' })); } catch (e) { toast(errText(e), 'bad'); } }} />}

      {/* دامنه و جست‌وجو */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="flex items-center gap-2 text-sm">
          <span className="shrink-0 text-ink-muted">{tx('برای', 'For', 'لپاره')}</span>
          <select className="input w-full sm:w-64" value={selectValue} disabled={pending.size > 0} data-testid="flags-scope"
                  aria-label={tx('دامنهٔ پرچم‌ها', 'Flag scope', 'د بیرغونو ساحه')}
                  onChange={(e) => { if (e.target.value === '__other') setTouched(true); else changeScope(e.target.value); setOther(''); }}>
            {!scope && <option value="">{tx('— یک دکان را برگزینید —', '— Choose a shop —', '— یوه هټۍ وټاکئ —')}</option>}
            {options.length > 0 && (
              <optgroup label={tx('یک دکان', 'One shop', 'یوه هټۍ')}>
                {options.map((id) => <option key={id} value={id}>{shopName(id) ? `${shopName(id)} · ${id}` : id}</option>)}
              </optgroup>
            )}
            <optgroup label={tx('همه', 'Everyone', 'ټول')}>
              <option value="all">{tx('همهٔ دکان‌ها (all) — پرخطر', 'All shops (all) — high impact', 'ټولې هټۍ (all)')}</option>
              {hasScope('security') && <option value="security">{tx('امنیتِ کلِ سرور (security)', 'Whole-server security', 'د ټول سرور امنیت')}</option>}
              {hasScope('ops') && <option value="ops">{tx('عملیات (ops)', 'Operations (ops)', 'عملیات (ops)')}</option>}
            </optgroup>
            <option value="__other">{tx('شناسهٔ دکانِ دیگر…', 'Another shop id…', 'د بلې هټۍ پېژند…')}</option>
          </select>
        </label>
        {touched && !pending.size && (selectValue === '' || other !== '') && (
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); const v = other.trim(); if (ID_RE.test(v)) { changeScope(v); setOther(''); } }}>
            <input className="input w-44" dir="ltr" placeholder="shop-id" value={other} onChange={(e) => setOther(e.target.value)} aria-label={tx('شناسهٔ دکان', 'Shop id', 'د هټۍ پېژند')} />
            <button className="btn btn-sm" type="submit" disabled={!ID_RE.test(other.trim())}>{tx('نشان بده', 'Show', 'وښایه')}</button>
          </form>
        )}
        <label className="relative flex-1 sm:min-w-[14rem]">
          <Search size={15} className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-muted" style={{ insetInlineStart: '0.65rem' }} />
          <input className="input w-full" style={{ paddingInlineStart: '2.1rem' }} type="search" value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder={tx('جست‌وجوی پرچم (شرح یا کلید)…', 'Search flags (description or key)…', 'بیرغ لټول…')} aria-label={tx('جست‌وجوی پرچم', 'Search flags', 'بیرغ لټول')} />
        </label>
      </div>
      {pending.size > 0 && <p className="-mt-1 mb-2 text-xs text-ink-muted">{tx('برای عوض کردنِ دامنه، اول تغییرها را ذخیره یا لغو کنید.', 'Save or discard the pending changes to switch scope.', 'لومړی بدلونونه خوندي یا لغوه کړئ.')}</p>}

      {scope === 'all' && <Notice tone="warn">{tx('«همهٔ دکان‌ها»: هر تغییر روی همهٔ دکان‌هایی اثر دارد که مقدارِ جدا ندارند — و نوشتنِ تأیید می‌خواهد.', '“All shops”: each change affects every shop without its own value — and needs a typed confirmation.', 'په ټولو هټیو اغېز کوي.')}</Notice>}
      {scope === 'security' && <Notice tone="warn">{tx('تنظیمِ امنیتیِ کلِ سرورِ حساب — نوشتنِ تأیید می‌خواهد.', 'Security setting for the whole account server — needs a typed confirmation.', 'د ټول سرور امنیتي تنظیم.')}</Notice>}
      {!admin && <Notice>{tx('عوض کردنِ پرچم فقط برای مدیرِ پنل است (سرور هم همین را می‌سنجد).', 'Changing flags is for panel admins only (enforced by the server).', 'د بیرغ بدلول یوازې د پینل مدیر لپاره.')}</Notice>}
      {done && <Notice tone="good">{done}</Notice>}

      {!scope ? (
        <StateEmpty>{tx('یک دکان را برگزینید (یا «همهٔ دکان‌ها») تا پرچم‌هایش را ببینید و عوض کنید.', 'Choose a shop (or “All shops”) to see and change its flags.', 'یوه هټۍ وټاکئ.')}</StateEmpty>
      ) : scope !== 'all' && scoped.error ? <Problem load={scoped as Load<unknown>} /> : scope !== 'all' && !scoped.data ? <StateLoading /> : (
        <ul className="divide-y divide-line/70 overflow-hidden rounded-xl border border-line" data-testid="flags-list">
          {visible.length === 0 && <li className="p-4 text-sm text-ink-muted">{q ? tx('پرچمی با این جست‌وجو نیست.', 'No flag matches.', 'هیڅ بیرغ ونه موندل شو.') : tx('در این دامنه پرچمِ روشن/خاموشی نیست.', 'No on/off flags in this scope.', 'په دې ساحه کې بیرغ نشته.')}</li>}
          {visible.map((r) => {
            const p = pending.get(r.k.key);
            const shown = p ? (p.reset ? (r.base ? r.base.value === true : r.k.default === true) : p.value === true) : r.effective;
            return (
              <li key={r.k.key} className="flex items-center gap-3 px-3 py-2.5" data-pending={p ? '1' : undefined}
                  style={p ? { background: 'var(--accent-soft)' } : undefined}>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium leading-6 text-ink" dir="auto">
                    {whatOf(r.k)}
                    {(FLAG_DANGER_KEYS.includes(r.k.key) || r.k.scope === 'security') && (
                      <span className="chip ms-2 align-middle text-[11px]" style={{ color: 'var(--status-warning)' }}>
                        <ShieldAlert size={11} />{tx('پرخطر', 'high impact', 'خطرناک')}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-muted">
                    <code dir="ltr" className="font-mono">{r.k.key}</code>
                    <span>·</span>
                    <span>{r.inherited === 'set' ? tx('نوشته‌شده', 'set', 'لیکل شوی') : r.inherited === 'all' ? tx('از «همهٔ دکان‌ها»', 'from “all shops”', 'له ټولو') : tx('پیش‌فرض', 'default', 'پیشفرض')}</span>
                    {r.it?.updatedAt ? <><span>·</span><span>{r.it.updatedBy || '—'} · {fmtTime(r.it.updatedAt)}</span></> : null}
                    {p && <span className="font-semibold" style={{ color: 'var(--accent)' }}>
                      {p.reset ? tx('⇐ بازگشت به پیش‌فرض', '⇒ reset to default', '⇐ پیشفرض') : `⇐ ${onOff(tx, p.value)}`}
                    </span>}
                  </p>
                </div>
                {editing && admin ? (
                  <div className="flex shrink-0 items-center gap-2">
                    {(r.it || p?.reset) && (
                      <button type="button" className="btn btn-sm !px-2" title={tx('بازگشت به پیش‌فرض', 'Reset to default', 'پیشفرض')}
                              aria-label={tx('بازگشتِ {k} به پیش‌فرض', 'Reset {k} to default', '{k} پیشفرض', { k: r.k.key })} aria-pressed={Boolean(p?.reset)} onClick={() => resetRow(r)}>
                        <RotateCcw size={14} />
                      </button>
                    )}
                    <Switch on={shown} label={whatOf(r.k)} onToggle={() => toggle(r)} />
                  </div>
                ) : (
                  <span className="chip shrink-0" style={shown ? { color: 'var(--status-good)' } : undefined}>{onOff(tx, shown)}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* نوارِ «در انتظار» — فقط در ویرایش */}
      {editing && admin && (
        <div className="sticky bottom-0 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2.5 shadow-sm" data-testid="flags-pending">
          <span className="flex-1 text-sm">
            {pending.size
              ? tx('{n} تغییر در انتظار', '{n} pending changes', '{n} بدلونونه په تمه', { n: fa(pending.size) })
              : tx('کلیدها را روشن یا خاموش کنید؛ با هم ذخیره می‌شوند.', 'Toggle the switches; they are saved together.', 'سویچونه بدل کړئ.')}
          </span>
          <button type="button" className="btn btn-sm" onClick={cancelEdit}><X size={14} />{tx('لغو', 'Discard', 'لغوه')}</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={!pending.size} onClick={() => { setSaving(true); void sudo.reload(); }}>
            {tx('ذخیرهٔ {n} تغییر', 'Save {n} changes', '{n} بدلونونه خوندي کړئ', { n: fa(pending.size) })}
          </button>
        </div>
      )}

      <p className="mt-2 text-[11px] text-ink-muted">{tx('فقط پرچم‌های شناختهٔ روشن/خاموش این‌جا عوض می‌شوند؛ فهرستِ کانالِ آزمایشی از «نسخه‌ها و انتشار». نوعِ مقدار و scope را سرورِ حساب هم می‌سنجد.', 'Only known on/off flags change here; the beta-channel lists change from “Versions & releases”. The account server validates type and scope too.', 'دلته یوازې پېژندل شوي روښانه/بند بیرغونه بدلېږي.')}</p>
      {scope && <SourceLine source={`/api/admin/flags?scope=${scope}`} data={scope === 'all' ? all.data : scoped.data} at={scope === 'all' ? all.at : scoped.at} />}

      {saving && scope && (
        <BatchDialog scope={scope} scopeLabel={scopeLabel(scope)} rows={rows} changes={changes} riskyKeys={riskyKeys}
                     sudoOpen={sudo.open} totpOn={totp.data?.enabled === true}
                     onClose={() => setSaving(false)} onDone={afterSave}
                     onUnknown={() => { void all.reload(); if (scope !== 'all') void scoped.reload(); }} />
      )}
    </Card>
  );
}

/* ───────────────────────── پنجرهٔ «ذخیرهٔ n تغییر» ───────────────────────── */

function BatchDialog({ scope, scopeLabel, rows, changes, riskyKeys, sudoOpen, totpOn, onClose, onDone, onUnknown }: {
  scope: string; scopeLabel: string; rows: Row[]; changes: FlagChange[]; riskyKeys: string[]; sudoOpen: boolean; totpOn: boolean;
  onClose: () => void; onDone: (r: FlagBatchResult) => Promise<void>; onUnknown: () => void;
}) {
  const tx = useTx();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [partial, setPartial] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [idem] = useState(newIdemKey);
  const phrase = flagConfirmPhrase(scope, riskyKeys);
  const needPassword = riskyKeys.length > 0 && !sudoOpen;
  const wide = scope === 'all' || scope === 'security';
  const ready = reasonOk(reason) && (!phrase || typed.trim() === phrase) && (!needPassword || (password.length > 0 && (!totpOn || /^\s*[0-9۰-۹٠-٩]{6}\s*$/.test(code))));
  const rowOf = (key: string) => rows.find((r) => r.k.key === key);

  const send = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setErr('');
    setPartial(false);
    setUnknown(false);
    try {
      const r = await api<FlagBatchResult>(API.batch, {
        method: 'POST',
        body: {
          scope, changes, reason: reason.trim(), confirm: true, idempotencyKey: idem,
          ...(phrase ? { confirmText: typed.trim() } : {}),
          ...(needPassword ? { password, ...(totpOn ? { code: code.trim() } : {}) } : {}),
        },
      });
      await onDone(r);
    } catch (e) {
      if (outcomeUnknown(e)) { setUnknown(true); onUnknown(); }
      else {
        //  ‎batch_rolled_back‎ ⇒ هیچ تغییری نماند (پیامِ سرور می‌گوید کدام پرچم و چرا)؛ ‎batch_partial‎ ⇒ بخشی ماند — فهرست را تازه کن
        setErr(errText(e));
        if (errCode(e) === 'batch_partial') { setPartial(true); onUnknown(); }
      }
    } finally { setBusy(false); }
  };

  return createPortal(
    <Modal open onClose={onClose} title={tx('ذخیرهٔ {n} تغییر', 'Save {n} changes', '{n} بدلونونه خوندي کړئ', { n: fa(changes.length) })}
           footer={<>
             <button className="btn" onClick={onClose}>{tx('انصراف', 'Cancel', 'لغوه')}</button>
             <button className={wide || riskyKeys.length ? 'btn btn-danger' : 'btn btn-primary'} disabled={!ready || busy} onClick={send} data-testid="flags-save">
               {busy ? tx('در حالِ فرستادن…', 'Sending…', 'لېږل کېږي…') : tx('ذخیرهٔ {n} تغییر', 'Save {n} changes', '{n} بدلونونه خوندي کړئ', { n: fa(changes.length) })}
             </button>
           </>}>
      <div className="space-y-3 text-sm">
        <Notice tone={wide ? 'bad' : 'warn'}>
          {wide
            ? tx('روی «{s}» — همهٔ دکان‌هایی که مقدارِ جدا ندارند.', 'On “{s}” — every shop without its own value.', 'په «{s}» — ټولې هټۍ.', { s: scopeLabel })
            : tx('فقط دکانِ «{s}».', 'Only shop “{s}”.', 'یوازې «{s}» هټۍ.', { s: scopeLabel })}
          {' '}{tx('همه با هم یا هیچ: اگر یکی ننشیند، بقیه هم برمی‌گردند.', 'All or nothing: if one fails, the rest are rolled back.', 'ټول یا هیڅ.')}
        </Notice>
        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line p-2" aria-label={tx('خلاصهٔ تغییرها', 'Summary of changes', 'د بدلونونو لنډیز')}>
          {changes.map((c) => {
            const r = rowOf(c.key);
            const from = r ? r.effective : undefined;
            return (
              <li key={c.key} className="flex items-start gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block" dir="auto">{r ? whatOf(r.k) : c.key}</span>
                  <code dir="ltr" className="font-mono text-[11px] text-ink-muted">{c.key}</code>
                </span>
                <span className="shrink-0 text-xs">
                  {onOff(tx, from)} ⇐ <b>{c.reset ? tx('پیش‌فرض', 'default', 'پیشفرض') : onOff(tx, c.value)}</b>
                </span>
              </li>
            );
          })}
        </ul>
        <label className="block text-xs">
          {tx('دلیل (یک دلیل برای همه؛ در دفترِ رخداد کنارِ هر پرچم می‌ماند، ۳ تا ۲۰۰ نویسه)', 'Reason (one for all; kept beside every flag in the audit log, 3–200 chars)', 'لامل (۳–۲۰۰)')}
          <textarea className="input mt-1 w-full" rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {phrase && (
          <label className="block text-xs">
            {tx('برای تأیید، «{k}» را بنویسید', 'To confirm, type “{k}”', 'د تایید لپاره «{k}» ولیکئ', { k: phrase })}
            <input className="input mt-1 w-full font-mono" dir="ltr" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
        )}
        {needPassword ? (
          <div className="space-y-2 rounded-xl border border-line p-3">
            <p className="text-xs text-ink-muted">{tx('یک بار رمز بزنید؛ پس از آن تا ۱۵ دقیقه (و تا ۶۰ دقیقه با کارِ پیوسته) پرچم‌ها رمز نمی‌خواهند.', 'Enter your password once; flags then need no password for 15 minutes (up to 60 with activity).', 'یو ځل پټنوم ولیکئ؛ بیا تر ۱۵ دقیقو پټنوم نه غواړي.')}</p>
            <label className="block text-xs">
              {tx('رمزِ پنلِ خودتان', 'Your panel password', 'ستاسو د پینل پټنوم')}
              <input className="input mt-1 w-full" type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {totpOn && (
              <label className="block text-xs">
                {tx('کدِ شش‌رقمیِ دوعاملی', '6-digit two-factor code', 'د دوه فکتوري شپږ عددي کوډ')}
                <input className="input mt-1 w-full font-mono" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} />
              </label>
            )}
          </div>
        ) : riskyKeys.length > 0 ? (
          <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--status-good)' }}><LockOpen size={13} />{tx('حالتِ تغییر باز است — رمز لازم نیست.', 'Edit mode is unlocked — no password needed.', 'رمز ته اړتیا نشته.')}</p>
        ) : null}
        {err && <Notice tone="bad">{err}{partial ? <span className="mt-1 block">{tx('پیش از تکرار، پرچم‌ها را در همین کارت ببینید.', 'Check the flags in this card before retrying.', 'له بیا هڅې مخکې بیرغونه وګورئ.')}</span> : null}</Notice>}
        {unknown && (
          <div data-outcome="unknown">
            <Notice tone="warn">
              <span className="block font-semibold">{tx('نتیجه معلوم نیست', 'Outcome unknown', 'پایله معلومه نه ده')}</span>
              {tx('سرورِ حساب به‌موقع جواب نداد؛ شاید انجام شده باشد. پیش از تکرار، پرچم‌ها را ببینید.', 'The account server did not answer in time; this may have been done. Check the flags before retrying.', 'کېدای شي شوی وي.')}
            </Notice>
          </div>
        )}
      </div>
    </Modal>,
    document.body,
  );
}
