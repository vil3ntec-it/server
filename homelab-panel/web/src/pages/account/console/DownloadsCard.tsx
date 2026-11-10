// ---------------------------------------------------------------------------
//  ⬇️ نشانیِ دانلود و نسخهٔ هر برنامه (پورتال و SDK همین را به مشتری می‌دهند) — خواندن و نوشتن (۱.۵۰.۸۰، S11)
//
//  ⛔ خواندن برای هر نقشِ ماژولِ «نسخه‌ها» (`GET /console/downloads` ⇐ ‎/api/downloads‎ ِ عمومی)؛ نوشتن فقط مالک/«فنی» (آن‌جا ارشد) با
//     `SensitiveDialog` (دلیل + تأیید + رمز + یک کلید برای همین پنجره). فقط فیلدِ عوض‌شده می‌رود؛ رشتهٔ خالی = پاک کردن.
//  ⛔ نشانی به دستِ **همهٔ** مشتری‌ها می‌رسد ⇒ فقط ‎http(s)‎ ِ کامل (همان سنجشِ پل)، و هرگز پیوندِ کلیک‌خور در خودِ پنل نیست —
//     متن است تا نشانیِ بدی که از جای دیگر نوشته شده در مرورگرِ مدیر باز نشود.
//  ⛔ ‎min_above_latest‎ / ‎bad_version‎ ِ سرورِ حساب در همان پنجره گفته می‌شود (نه «انجام شد»).
//  ⛔ (۱.۵۰.۸۱) نوشتن «انتشار» است ⇒ فقط مالکِ پنل (یا نقشِ «فنی»، `canChange` ِ سرور) و با **رمزِ خودش** — همان قاعدهٔ انتشارِ مرحله‌ای.
//     نشانی همان سنجشِ تازهٔ پل (یک‌معنا برای هر خواننده)، آخرین نسخه مثلِ حداقل، و حداقل ≤ آخرین پیش از «ذخیره».
// ---------------------------------------------------------------------------
import { useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';

import { api } from '../../../api';
import { Card } from '../../../components/ui';
import { KV, Notice } from '../../../control/ui';
import { useLoad, type Load } from '../shared';
import { Problem, SourceLine } from '../ShopConsole';
import { SensitiveDialog, StateLoading, type SensitiveSubmit } from './parts';
import { useTx } from './text';

export const DOWNLOADS_API = '/api/account-admin/console/downloads';
type App = 'shop' | 'pump';
type Dl = { app: App; title: string; url: string; version: string; notes: string; minVersion: string };
type Doc = { downloads: Dl[]; fetchedAt?: number; serverTime?: number | null; canChange?: boolean };
type Draft = { url: string; version: string; notes: string; minVersion: string };
const FIELDS = ['url', 'version', 'notes', 'minVersion'] as const;
const VERSION_RE = /^\d+(\.\d+){1,3}$/;

// eslint-disable-next-line no-control-regex
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
/** همان سنجشِ پل (‎routes/console-parity.js‎): نویسه‌های نشانیِ لاتین (بی ‎'‎)، و ‎http(s)://میزبان[:درگاه]‎ ِ صریح */
const URL_CHARS = /^[A-Za-z0-9\-._~:/?#[\]@!$&()*+,;=%]+$/;
const URL_HEAD = /^https?:\/\/([A-Za-z0-9.-]+)(?::\d{1,5})?(?=[/?#]|$)/i;
/** خالی، یا ‎http(s)‎ ِ کامل و یک‌معنا (همان رشته برای هر خواننده) بی نام/رمز، تا ۳۰۰ */
export function downloadUrlOk(s: string): boolean {
  if (s === '') return true;
  if (s.length > 300 || !URL_CHARS.test(s)) return false;
  const head = URL_HEAD.exec(s);
  if (!head || !/[A-Za-z0-9]/.test(head[1])) return false;
  try {
    const u = new URL(s);
    return (u.protocol === 'https:' || u.protocol === 'http:') && Boolean(u.hostname) && !u.username && !u.password;
  } catch { return false; }
}
/** ‎compare‎ ِ ‎lib/app-compat.js‎ ِ shop */
function cmpVersion(a: string, b: string): number {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export default function DownloadsCard() {
  const tx = useTx();
  const load = useLoad<Doc>(DOWNLOADS_API);
  const [app, setApp] = useState<App>('shop');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState('');
  const title = tx('نشانیِ دانلود و نسخه', 'Download link & version', 'د ښکته کولو پته او نسخه');
  const wrap = (body: ReactNode) => <div data-card="downloads"><Card title={title} icon={<Download size={15} />}>{body}</Card></div>;
  if (load.error) return wrap(<Problem load={load as Load<unknown>} />);
  if (!load.data) return wrap(<StateLoading />);
  const list = Array.isArray(load.data.downloads) ? load.data.downloads : [];
  const canChange = load.data.canChange === true;
  const cur = list.find((d) => d.app === app);
  const label: Record<(typeof FIELDS)[number], string> = {
    url: tx('نشانیِ دانلود', 'Download URL', 'د ښکته کولو پته'), version: tx('آخرین نسخه', 'Latest version', 'وروستۍ نسخه'),
    notes: tx('یادداشتِ انتشار', 'Release notes', 'د خپرونې یادښت'), minVersion: tx('حداقل نسخه', 'Minimum version', 'لږ تر لږه نسخه'),
  };
  const next = draft ? { url: clean(draft.url), version: clean(draft.version).replace(/^v/i, ''), notes: clean(draft.notes), minVersion: clean(draft.minVersion).replace(/^v/i, '') } : null;
  const errs: string[] = [];
  if (next) {
    if (!downloadUrlOk(next.url)) {
      errs.push(tx('نشانی باید کاملِ http یا https باشد (https://میزبان/…، تا ۳۰۰) و فقط با نویسه‌های لاتینِ نشانی — حرفِ فارسی، فاصله و \\ را از نوارِ نشانیِ مرورگر (به شکلِ %..) کپی کنید؛ یا خالی',
        'The URL must be a full http or https address (https://host/…, up to 300) using URL characters only — copy Persian letters, spaces and \\ from the browser address bar (as %..); or empty',
        'پته باید بشپړه http یا https وي، یوازې د پتې لاتیني توري'));
    }
    if (next.version.length > 32) errs.push(tx('نسخه بلندتر از ۳۲ نویسه', 'Version longer than 32 characters', 'نسخه له ۳۲ اوږده'));
    else if (next.version && !VERSION_RE.test(next.version)) errs.push(tx('آخرین نسخه مثلِ 2.14.6', 'Latest version like 2.14.6', 'وروستۍ نسخه لکه 2.14.6'));
    if (next.minVersion && !VERSION_RE.test(next.minVersion)) errs.push(tx('حداقل نسخه مثلِ 2.14.2', 'Minimum version like 2.14.2', 'لږ تر لږه نسخه لکه 2.14.2'));
    else if (next.minVersion && VERSION_RE.test(next.version) && cmpVersion(next.minVersion, next.version) > 0) {
      errs.push(tx('حداقل نسخه از آخرین نسخه بالاتر است — نسخه‌ای که منتشر نشده را نمی‌شود از کسی خواست', 'The minimum version is above the latest version — nobody can be asked for an unreleased version', 'لږ تر لږه نسخه له وروستۍ لوړه ده'));
    }
    if (next.notes.length > 1000) errs.push(tx('یادداشت بلندتر از ۱۰۰۰ نویسه', 'Notes longer than 1000 characters', 'یادښت له ۱۰۰۰ اوږد'));
  }
  const changed = next && cur ? FIELDS.filter((k) => next[k] !== (cur[k] || '')) : [];
  const canSave = Boolean(next && cur && !errs.length && changed.length);

  const submit = async (x: SensitiveSubmit) => {
    if (!next) return;
    const body: Record<string, unknown> = { app, ...x, confirm: true };
    for (const k of changed) body[k] = next[k];
    const out = await api<{ download: Dl | null; replayed?: boolean }>(DOWNLOADS_API, { method: 'PUT', body });
    setDone(tx('تأییدشده از سرورِ حساب: {app} ⇒ نسخهٔ {v}', 'Confirmed by the account server: {app} ⇒ version {v}', 'د حساب سرور تایید: {app} ⇒ {v} نسخه',
      { app: out.download?.title || app, v: out.download?.version || '—' }));
    setOpen(false);
    setDraft(null);
    await load.reload();
  };
  const input = (k: (typeof FIELDS)[number]) => (
    <label className="block text-xs" key={k}>
      {label[k]}
      {k === 'notes'
        ? <textarea className="input mt-1 w-full" rows={2} maxLength={1000} data-dl-input={k} value={draft?.[k] ?? ''} onChange={(e) => setDraft((d) => (d ? { ...d, [k]: e.target.value } : d))} />
        : <input className="input mt-1 w-full font-mono" dir="ltr" maxLength={k === 'url' ? 300 : 33} data-dl-input={k} value={draft?.[k] ?? ''}
                 placeholder={k === 'url' ? 'https://…' : '2.14.6'} onChange={(e) => setDraft((d) => (d ? { ...d, [k]: e.target.value } : d))} />}
    </label>
  );

  return wrap(
    <>
      <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label={tx('برنامه', 'App', 'اپ')}>
        {(['shop', 'pump'] as App[]).map((a) => (
          <button key={a} className={`btn btn-sm ${a === app ? 'btn-primary' : ''}`} data-dl-app={a} aria-pressed={a === app}
                  onClick={() => { setApp(a); setDraft(null); setDone(''); }}>
            {list.find((d) => d.app === a)?.title || (a === 'shop' ? tx('برنامهٔ دکان', 'Shop app', 'د هټۍ اپ') : tx('برنامهٔ پمپ', 'Pump app', 'د پمپ اپ'))}
          </button>
        ))}
      </div>
      {!cur ? <Notice tone="warn">{tx('سرورِ حساب برای این برنامه چیزی نگفت', 'The account server said nothing for this app', 'د حساب سرور د دې اپ لپاره څه ونه ویل')}</Notice> : (
        <>
          <KV label={label.url}><code dir="ltr" className="break-all text-[12px]" data-dl-url>{cur.url || '—'}</code></KV>
          <KV label={label.version}><span dir="ltr">{cur.version || '—'}</span></KV>
          <KV label={label.minVersion}><span dir="ltr">{cur.minVersion || '—'}</span></KV>
          <KV label={label.notes}><span data-dl-notes>{cur.notes || '—'}</span></KV>
        </>
      )}
      {done && <Notice tone="good">{done}</Notice>}
      {!canChange && (
        <Notice>
          <span data-dl-owner-only>{tx('فقط مالکِ پنل (یا نقشِ فنی) این‌ها را عوض می‌کند — همان قاعدهٔ انتشارِ مرحله‌ای، با رمزِ خودش (سرورِ حساب هم فقط مدیرِ ارشد را می‌پذیرد).',
            'Only the panel owner (or the technical role) changes these — the same rule as staged releases, with their own password (the account server accepts super admins only).',
            'یوازې د پینل خاوند (یا تخنیکي رول) دا بدلوي — له خپل پټنوم سره.')}</span>
        </Notice>
      )}
      {canChange && cur && !draft && (
        <button className="btn btn-sm mt-2" data-dl-edit onClick={() => { setDone(''); setDraft({ url: cur.url, version: cur.version, notes: cur.notes, minVersion: cur.minVersion }); }}>
          {tx('ویرایش', 'Edit', 'سمول')}
        </button>
      )}
      {draft && (
        <div className="mt-2 space-y-2" data-dl-editor>
          {FIELDS.map(input)}
          {errs.map((e) => <p key={e} className="text-[11px]" data-dl-error style={{ color: 'var(--status-warning)' }}>{e}</p>)}
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-sm btn-primary" data-dl-save disabled={!canSave} onClick={() => setOpen(true)}>{tx('ذخیره…', 'Save…', 'خوندي کول…')}</button>
            <button className="btn btn-sm" onClick={() => setDraft(null)}>{tx('انصراف', 'Cancel', 'لغوه')}</button>
          </div>
        </div>
      )}
      <SourceLine source="/api/downloads · /api/admin/downloads" data={load.data} at={load.at} />
      {open && next && cur && (
        <SensitiveDialog title={title} needPassword onClose={() => setOpen(false)} onSubmit={submit} onUnknown={() => { void load.reload(); }}
                         effect={<>
                           <span className="block">{tx('عوض می‌شود: {f}', 'Changing: {f}', 'بدلېږي: {f}', { f: changed.map((k) => label[k]).join('، ') })}</span>
                           {changed.includes('url') && <code dir="ltr" className="block break-all text-[11px]">{next.url || '—'}</code>}
                           <span className="block">{tx('پورتال و برنامه‌ها همین را به همهٔ مشتری‌ها می‌دهند — از همین لحظه.', 'The portal and the apps give this to every customer — from now on.', 'پورټال او اپونه دا ټولو پېرودونکو ته ورکوي.')}</span>
                         </>} />
      )}
    </>,
  );
}
