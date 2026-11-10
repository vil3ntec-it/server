// ---------------------------------------------------------------------------
//  🚩 کانالِ آزمایشیِ برنامهٔ دکان (F0-27) — خواندن و **نوشتن** (۱.۵۰.۸۰، S11 «هم‌ترازی با ‎/admin/‎»)
//
//  ⛔ فقط admin (سرورِ حساب حتی خواندنش را فقط به ارشد می‌دهد؛ مرز در سرور است — پل admin می‌خواهد).
//  ⛔ نوشتن: «ویرایش» ⇒ دو فهرست (هر خط یک شناسه، همان قاعدهٔ ‎[A-Za-z0-9_-]{1,80}‎ و حدِ ۲۰۰ ِ سرورِ حساب) ⇒ «ذخیره…» ⇒
//     `SensitiveDialog` (دلیل + تأیید + یک کلیدِ یکتایی برای همین پنجره) با **نسخهٔ** همان فهرستی که دیده شد. فقط فهرستِ عوض‌شده می‌رود.
//  ⛔ ‎409 beta_version‎ ⇒ «کسِ دیگری در این میان عوضش کرد — دوباره بخوانید» (ویرایشِ شما نوشته نشد)، نه رونویسی.
//  ⛔ هر عضوِ این فهرست هر مرجِ main را از به‌روزرسانیِ درون‌برنامه می‌گیرد ⇒ اثر پیش از تأیید گفته می‌شود.
// ---------------------------------------------------------------------------
import { useState, type ReactNode } from 'react';
import { Flag } from 'lucide-react';

import { api } from '../../../api';
import { useApp } from '../../../app-context';
import { Card } from '../../../components/ui';
import { KV, Notice } from '../../../control/ui';
import type { Load } from '../shared';
import { Problem, SourceLine } from '../ShopConsole';
import { shown, type ReleaseBeta } from '../consoleData';
import { SensitiveDialog, StateLoading, errCode, fmtTime, type SensitiveSubmit } from './parts';
import { useTx } from './text';

export const BETA_API = '/api/account-admin/console/release/beta';
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX = 200;

/** همان ‎parse‎ ِ سرورِ حساب: فاصله، خط، ویرگول یا ویرگولِ فارسی؛ بی‌تکرار */
export const idList = (text: string) => [...new Set(text.split(/[\s,،]+/).map((s) => s.trim()).filter(Boolean))];
const diff = (prev: string[], next: string[]) => ({ added: next.filter((x) => !prev.includes(x)), removed: prev.filter((x) => !next.includes(x)) });
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

type Saved = ReleaseBeta & { changed?: string[]; replayed?: boolean };

export default function BetaCard({ load }: { load: Load<ReleaseBeta> }) {
  const tx = useTx();
  const { can } = useApp();
  const admin = can('admin');
  const [draft, setDraft] = useState<{ shops: string; devices: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [stale, setStale] = useState(false);
  const [done, setDone] = useState('');
  const title = tx('کانالِ آزمایشی', 'Beta channel', 'ازمایښتي چینل');
  const wrap = (body: ReactNode) => <div data-card="beta"><Card title={title} icon={<Flag size={16} />}>{body}</Card></div>;

  if (!admin) {
    return wrap(<Notice>{tx('کانالِ آزمایشی را فقط مدیرِ پنل می‌بیند (سرورِ حساب هم آن را فقط به ارشد می‌دهد).',
      'Only panel admins can see the beta channel (the account server gives it to super admins only).', 'یوازې د پینل مدیر ازمایښتي چینل ویني.')}</Notice>);
  }
  if (load.error) return wrap(<Problem load={load as Load<unknown>} />);
  if (!load.data) return wrap(<StateLoading />);
  const d = load.data;
  const shops = Array.isArray(d.shops?.ids) ? d.shops!.ids! : [];
  const devices = Array.isArray(d.devices?.ids) ? d.devices!.ids! : [];
  const version = typeof d.version === 'number' ? d.version : null;
  const truncated = Boolean(d.shops?.truncated || d.devices?.truncated);
  const next = draft ? { shops: idList(draft.shops), devices: idList(draft.devices) } : null;
  const bad = next ? [...next.shops, ...next.devices].filter((x) => !ID_RE.test(x)) : [];
  const tooMany = next ? next.shops.length > MAX || next.devices.length > MAX : false;
  const dShops = next ? diff(shops, next.shops) : null;
  const dDevices = next ? diff(devices, next.devices) : null;
  const changedShops = Boolean(next && !same(next.shops, shops));
  const changedDevices = Boolean(next && !same(next.devices, devices));
  const canSave = Boolean(next && !bad.length && !tooMany && (changedShops || changedDevices) && version !== null);

  const submit = async (x: SensitiveSubmit) => {
    if (!next || version === null) return;
    try {
      const out = await api<Saved>(BETA_API, { method: 'PUT', body: {
        ...(changedShops ? { shops: next.shops } : {}), ...(changedDevices ? { devices: next.devices } : {}), version, ...x, confirm: true,
      } });
      setDone(out.changed?.length
        ? tx('تأییدشده از سرورِ حساب: نسخهٔ {v} — از همین حالا اثر دارد', 'Confirmed by the account server: version {v} — in effect now', 'د حساب سرور تایید: {v} نسخه — همدا اوس اغېزمن', { v: shown(out.version) })
        : tx('همین فهرست از پیش روی سرورِ حساب بود — چیزی عوض نشد', 'The account server already had this list — nothing changed', 'دا لړ له مخکې پر سرور و — څه بدل نه شول'));
      setOpen(false);
      setDraft(null);
      await load.reload();
    } catch (e) {
      //  ⛔ نسخهٔ کهنه: کسِ دیگری نوشت ⇒ پنجره بسته، ویرایش نگه داشته (برای دیدن)، و «دوباره بخوانید» — هیچ چیزی نوشته نشد
      if (errCode(e) === 'beta_version') { setOpen(false); setStale(true); return; }
      throw e;
    }
  };
  const ids = (list: string[]) => (list.length ? <span dir="ltr" className="font-mono text-[12px]" data-beta-ids>{list.join('، ')}</span> : '—');
  const area = (k: 'shops' | 'devices', label: string) => (
    <label className="block text-xs">
      {label}
      <textarea className="input mt-1 w-full font-mono" dir="ltr" rows={4} data-beta-input={k} value={draft?.[k] ?? ''}
                onChange={(e) => setDraft((x) => (x ? { ...x, [k]: e.target.value } : x))} />
    </label>
  );

  return wrap(
    <>
      <KV label={tx('دکان‌ها', 'Shops', 'هټۍ')}>{ids(shops)}</KV>
      <KV label={tx('دستگاه‌ها', 'Devices', 'وسیلې')}>{ids(devices)}</KV>
      <KV label={tx('آخرین تغییر', 'Last change', 'وروستی بدلون')}>{d.shops?.updatedBy || '—'} · {fmtTime(d.shops?.updatedAt)}</KV>
      <KV label={tx('نسخه', 'Version', 'نسخه')}>{version === null ? '—' : shown(version)}</KV>
      {done && <Notice tone="good">{done}</Notice>}
      {truncated && <Notice tone="warn">{tx('فهرست بیش از ۱۰۰۰ شناسه دارد و همه نشان داده نشد — ویرایش از این‌جا بسته است.', 'The list has over 1000 ids and was not shown in full — editing is closed here.', 'لړ له ۱۰۰۰ زیات لري — سمول بند دی.')}</Notice>}
      {stale && (
        <div data-beta-stale>
          <Notice tone="warn">
            {tx('کسِ دیگری در این میان فهرست را عوض کرد — ویرایشِ شما نوشته نشد. دوباره بخوانید و دوباره ویرایش کنید.',
              'Someone else changed the list in the meantime — your edit was not saved. Reload and edit again.',
              'بل چا په دې منځ کې لړ بدل کړ — ستاسو بدلون ونه لیکل شو. بیا یې ولولئ.')}
            <button className="btn btn-sm mr-2 ml-2" data-beta-reload onClick={() => { setStale(false); setDraft(null); setDone(''); void load.reload(); }}>
              {tx('دوباره بخوان', 'Reload', 'بیا ولولئ')}
            </button>
          </Notice>
        </div>
      )}
      {!draft ? (
        <button className="btn btn-sm mt-2" data-beta-edit disabled={version === null || truncated}
                onClick={() => { setDone(''); setStale(false); setDraft({ shops: shops.join('\n'), devices: devices.join('\n') }); }}>
          {tx('ویرایشِ فهرست‌ها', 'Edit lists', 'لړونه سمول')}
        </button>
      ) : (
        <div className="mt-2 space-y-2" data-beta-editor>
          {area('shops', tx('شناسهٔ دکان‌ها (هر خط یکی)', 'Shop ids (one per line)', 'د هټیو پېژند (هره کرښه یو)'))}
          {area('devices', tx('شناسهٔ دستگاه‌ها (هر خط یکی)', 'Device ids (one per line)', 'د وسیلو پېژند (هره کرښه یو)'))}
          {bad.length > 0 && (
            <p className="text-[11px]" data-beta-error style={{ color: 'var(--status-warning)' }}>
              {tx('شناسهٔ نامعتبر: {ids} — فقط حروفِ انگلیسی، رقم، - و _ (تا ۸۰)', 'Invalid id: {ids} — only Latin letters, digits, - and _ (up to 80)', 'ناسم پېژند: {ids}', { ids: bad.slice(0, 3).join('، ') })}
            </p>
          )}
          {tooMany && <p className="text-[11px]" data-beta-error style={{ color: 'var(--status-warning)' }}>{tx('حداکثر ۲۰۰ شناسه در هر فهرست', 'At most 200 ids per list', 'په هر لړ کې تر ۲۰۰ پېژندونو')}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-sm btn-primary" data-beta-save disabled={!canSave} onClick={() => setOpen(true)}>{tx('ذخیره…', 'Save…', 'خوندي کول…')}</button>
            <button className="btn btn-sm" onClick={() => setDraft(null)}>{tx('انصراف', 'Cancel', 'لغوه')}</button>
          </div>
        </div>
      )}
      <SourceLine source="/api/admin/release/beta" data={d} at={load.at} />
      {open && next && dShops && dDevices && (
        <SensitiveDialog title={title} onClose={() => setOpen(false)} onSubmit={submit} onUnknown={() => { void load.reload(); }}
                         effect={tx('دکان‌ها: {sa} افزوده، {sr} برداشته · دستگاه‌ها: {da} افزوده، {dr} برداشته (نسخهٔ {v}). عضوِ این فهرست هر نسخهٔ تازهٔ main را از به‌روزرسانیِ درون‌برنامه می‌گیرد — از همین لحظه.',
                           'Shops: {sa} added, {sr} removed · Devices: {da} added, {dr} removed (version {v}). Members get every new main build through in-app update — from now on.',
                           'هټۍ: {sa} زیاتې، {sr} لرې · وسیلې: {da} زیاتې، {dr} لرې ({v} نسخه). غړي هر نوی main له اپ دننه تازه کولو اخلي.',
                           { sa: shown(dShops.added.length), sr: shown(dShops.removed.length), da: shown(dDevices.added.length), dr: shown(dDevices.removed.length), v: shown(version) })} />
      )}
    </>,
  );
}
