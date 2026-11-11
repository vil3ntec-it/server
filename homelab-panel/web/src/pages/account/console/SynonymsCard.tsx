// ---------------------------------------------------------------------------
//  ۴.۱۲ — فهرستِ مرکزیِ مترادف برای جست‌وجو (۴-۱ «ب»، ۱.۵۰.۸۹): یک فهرست برای همهٔ دکان‌ها، نگه‌داشتهٔ صاحبِ پلتفرم
//
//  ⛔ بی `synonyms.v1` (سرورِ حسابِ امروز) ⇒ «سرورِ حساب هنوز این را ندارد» با نامِ درِ لازم — هیچ فهرستِ ساختگی.
//  ⛔ ویرایش یک کادرِ متن است، هر خط یک گروه: «واژه = هم‌معنا، هم‌معنا» (همان شکلی که صاحب‌کار فهرستِ نخست را می‌دهد).
//     سنجشِ همین‌جا فقط برای بستنِ دکمه پیش از فرستادن است؛ پل (`routes/console-synonyms.js`) و سرورِ حساب دوباره می‌سنجند.
//  ⛔ عوض کردن فقط admin ⇒ «ذخیره…» ⇒ `SensitiveDialog` (دلیل + تأیید + کلیدِ یکتایی) با نسخهٔ همان فهرستی که دیده شد.
//  ⛔ ‎409 synonyms_version‎ ⇒ «کسِ دیگری در این میان عوضش کرد — دوباره بخوانید»، نه رونویسی.
//  ⛔ واژه‌ها فقط متن‌اند (React خودش گریز می‌دهد؛ این‌جا هیچ HTML ِ خامی ساخته نمی‌شود).
// ---------------------------------------------------------------------------
import { useState, type ReactNode } from 'react';
import { BookA } from 'lucide-react';

import { api } from '../../../api';
import { useApp } from '../../../app-context';
import { Card } from '../../../components/ui';
import { KV, Notice } from '../../../control/ui';
import { useLoad, type Load } from '../shared';
import { Problem, SourceLine } from '../ShopConsole';
import { isUnavailable, shown, type Unavailable } from '../consoleData';
import { NotSupported, SensitiveDialog, StateLoading, errCode, fmtTime, type SensitiveSubmit } from './parts';
import { useTx } from './text';

export const SYNONYMS_API = '/api/account-admin/console/search/synonyms';
const GROUPS_MAX = 500;
const TERMS_MAX = 20;
const TERM_MAX = 60;

type Doc = { available: true; version: number | null; updatedAt: number | null; groups: string[][]; fetchedAt?: number };
type Saved = { version: number | null; groups: string[][]; unchanged?: boolean };
type LineErr = 'pair' | 'long' | 'many' | 'dup';

// eslint-disable-next-line no-control-regex
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
/** همان کلیدِ پل (`synonymKey`): ی/ک، نیم‌فاصله، اعراب، رقم، بزرگ/کوچک */
export function synonymKey(s: string): string {
  return s.normalize('NFKC')
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[ة]/g, 'ه')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[‌‍‎‏]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/** گروه‌ها ⇒ متنِ کادر: «نخستین = بقیه، …» */
export const toText = (groups: string[][]) => groups.map((g) => `${g[0]} = ${g.slice(1).join('، ')}`).join('\n');

/** متنِ کادر ⇒ گروه‌ها و خطای هر خط (همان قاعده‌های پل) */
export function parseSynonyms(text: string) {
  const errs: Record<number, LineErr> = {};
  const groups: string[][] = [];
  const owner = new Map<string, number>();
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const at = line.indexOf('=');
    const parts = (at < 0 ? [line] : [line.slice(0, at), ...line.slice(at + 1).split(/[،,؛;]/)]).map(clean).filter(Boolean);
    const terms: string[] = [];
    const local = new Set<string>();
    for (const t of parts) {
      const k = synonymKey(t);
      if (!k || local.has(k)) continue;
      local.add(k);
      terms.push(t);
    }
    if (terms.length < 2) { errs[i] = 'pair'; return; }
    if (terms.length > TERMS_MAX) { errs[i] = 'many'; return; }
    if (terms.some((t) => t.length > TERM_MAX)) { errs[i] = 'long'; return; }
    if ([...local].some((k) => owner.has(k))) { errs[i] = 'dup'; return; }
    for (const k of local) owner.set(k, i);
    groups.push(terms);
  });
  return { errs, groups, ok: Object.keys(errs).length === 0 && groups.length <= GROUPS_MAX };
}

export default function SynonymsCard() {
  const tx = useTx();
  const { can } = useApp();
  const admin = can('admin');
  const load = useLoad<Doc | Unavailable>(SYNONYMS_API);
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [stale, setStale] = useState(false);
  const [done, setDone] = useState('');
  const title = tx('مترادف‌های جست‌وجو', 'Search synonyms', 'د لټون مترادفونه');
  const wrap = (body: ReactNode) => <div data-card="synonyms"><Card title={title} icon={<BookA size={15} />}>{body}</Card></div>;

  if (load.error) return wrap(<Problem load={load as Load<unknown>} />);
  if (!load.data) return wrap(<StateLoading />);
  if (isUnavailable(load.data)) {
    return wrap(
      <NotSupported needs={load.data.needs || 'GET|PUT /api/admin/search/synonyms'}>
        <span data-synonyms-old>
          {tx('سرورِ حساب هنوز فهرستِ مرکزیِ مترادف (synonyms.v1) را ندارد. با به‌روز شدنِ سرورِ حساب همین‌جا ویرایش می‌شود — تا آن روز هیچ فهرستی نشان داده یا ساخته نمی‌شود.',
            'The account server has no central synonym list yet (synonyms.v1). Once it is updated the list is edited right here — until then nothing is shown or made up.',
            'د حساب سرور لا د مترادفونو مرکزي لېست (synonyms.v1) نه لري. تر هغه دلته هېڅ لېست نه ښودل کېږي.')}
        </span>
      </NotSupported>,
    );
  }
  const d = load.data;
  const groups = Array.isArray(d.groups) ? d.groups : [];
  const editing = draft !== null;
  const v = editing ? parseSynonyms(draft) : null;
  const changed = Boolean(v && JSON.stringify(v.groups) !== JSON.stringify(groups));
  const canSave = Boolean(v?.ok && changed && d.version !== null);
  const terms = groups.reduce((n, g) => n + g.length, 0);
  const errText = (e: LineErr) => (e === 'pair'
    ? tx('دست‌کم دو واژه: «واژه = هم‌معنا»', 'At least two words: “word = synonym”', 'لږ تر لږه دوه کلمې')
    : e === 'many' ? tx(`بیش از ${TERMS_MAX} واژه در یک خط`, `More than ${TERMS_MAX} words on one line`, `په یوه کرښه کې له ${TERMS_MAX} ډېرې`)
      : e === 'long' ? tx(`واژهٔ بلندتر از ${TERM_MAX} نویسه`, `A word longer than ${TERM_MAX} characters`, `له ${TERM_MAX} تورو اوږده کلمه`)
        : tx('یکی از این واژه‌ها در خطِ دیگری هم هست — هر واژه فقط در یک گروه', 'One of these words is on another line too — each word in one group only', 'دا کلمه په بله کرښه کې هم شته'));
  const lineErrs = v ? Object.entries(v.errs) : [];

  const submit = async (x: SensitiveSubmit) => {
    if (!v || d.version === null) return;
    try {
      const out = await api<Saved>(SYNONYMS_API, { method: 'PUT', body: { groups: v.groups, version: d.version, ...x, confirm: true } });
      setDone(out.unchanged
        ? tx('همین فهرست از پیش روی سرورِ حساب بود — چیزی عوض نشد', 'The account server already had this list — nothing changed', 'دا لېست له مخکې پر سرور و')
        : tx('تأییدشده از سرورِ حساب: نسخهٔ {v} با {n} گروه', 'Confirmed by the account server: version {v} with {n} groups', 'د حساب سرور تایید: {v} نسخه له {n} ډلو سره',
          { v: shown(out.version), n: shown(Array.isArray(out.groups) ? out.groups.length : 0) }));
      setOpen(false);
      setDraft(null);
      await load.reload();
    } catch (e) {
      if (errCode(e) === 'synonyms_version') { setOpen(false); setStale(true); return; }
      throw e;
    }
  };

  return wrap(
    <>
      <KV label={tx('نسخه', 'Version', 'نسخه')}>{d.version === null ? '—' : shown(d.version)}</KV>
      <KV label={tx('آخرین تغییر', 'Last change', 'وروستی بدلون')}>{fmtTime(d.updatedAt)}</KV>
      <KV label={tx('گروه‌ها / واژه‌ها', 'Groups / words', 'ډلې / کلمې')}>{`${shown(groups.length)} / ${shown(terms)}`}</KV>
      {done && <Notice tone="good">{done}</Notice>}
      {stale && (
        <div data-synonyms-stale>
          <Notice tone="warn">
            {tx('کسِ دیگری در این میان فهرست را عوض کرد — ویرایشِ شما نوشته نشد. دوباره بخوانید و دوباره ویرایش کنید.',
              'Someone else changed the list in the meantime — your edit was not saved. Reload and edit again.',
              'بل چا په دې منځ کې لېست بدل کړ — ستاسو بدلون ونه لیکل شو.')}
            <button className="btn btn-sm mr-2 ml-2" data-synonyms-reload onClick={() => { setStale(false); setDraft(null); setDone(''); void load.reload(); }}>
              {tx('دوباره بخوان', 'Reload', 'بیا ولولئ')}
            </button>
          </Notice>
        </div>
      )}
      {!admin && <Notice>{tx('فقط مدیرِ پنل فهرست را عوض می‌کند (سرورِ حساب هم فقط مدیرِ ارشد را می‌پذیرد).', 'Only panel admins change this list (the account server accepts super admins only).', 'یوازې د پینل مدیر دا لېست بدلوي.')}</Notice>}
      {!editing ? (
        <>
          {groups.length === 0
            ? <p className="text-xs text-ink-muted" data-synonyms-empty>{tx('هنوز هیچ مترادفی نیست.', 'No synonyms yet.', 'لا هېڅ مترادف نشته.')}</p>
            : (
              <ul className="space-y-1 text-sm" data-synonyms-list>
                {groups.map((g, i) => (
                  <li key={i} data-synonym-group={i}>
                    <span className="font-semibold">{g[0]}</span>
                    <span className="text-ink-muted"> = </span>
                    <span>{g.slice(1).join('، ')}</span>
                  </li>
                ))}
              </ul>
            )}
          {admin && (
            <button className="btn btn-sm mt-2" data-synonyms-edit disabled={d.version === null}
                    onClick={() => { setDone(''); setStale(false); setDraft(toText(groups)); }}>
              {tx('ویرایشِ فهرست', 'Edit list', 'لېست سمول')}
            </button>
          )}
        </>
      ) : (
        <div className="space-y-2" data-synonyms-editor>
          <label className="block text-xs">
            {tx('هر خط یک گروه: «واژه = هم‌معنا، هم‌معنا» — مثلاً «بوره = شکر»', 'One group per line: “word = synonym, synonym” — e.g. “بوره = شکر”', 'هره کرښه یوه ډله: «کلمه = مترادف، مترادف»')}
            <textarea className="input mt-1 h-48 w-full text-sm" value={draft} data-synonyms-text
                      onChange={(e) => setDraft(e.target.value)} aria-describedby="synonyms-errs" />
          </label>
          <div id="synonyms-errs" aria-live="polite">
            {lineErrs.slice(0, 8).map(([i, e]) => (
              <p key={i} className="text-[11px]" data-synonym-error style={{ color: 'var(--status-warning)' }}>
                {tx('خطِ {n}: ', 'Line {n}: ', 'کرښه {n}: ', { n: shown(Number(i) + 1) })}{errText(e)}
              </p>
            ))}
            {v && v.groups.length > GROUPS_MAX && <p className="text-[11px]" style={{ color: 'var(--status-warning)' }}>{tx('سقف ۵۰۰ گروه است', 'The limit is 500 groups', 'حد ۵۰۰ ډلې دی')}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-sm btn-primary" data-synonyms-save disabled={!canSave} onClick={() => setOpen(true)}>{tx('ذخیره…', 'Save…', 'خوندي کول…')}</button>
            <button className="btn btn-sm" onClick={() => setDraft(null)}>{tx('انصراف', 'Cancel', 'لغوه')}</button>
            {v && <span className="text-[11px] text-ink-muted">{tx('{n} گروه', '{n} groups', '{n} ډلې', { n: shown(v.groups.length) })}</span>}
          </div>
        </div>
      )}
      <p className="mt-2 text-[11px] text-ink-muted">{tx('برنامه‌ها فهرست را از سرورِ حساب می‌گیرند؛ جست‌وجوی «بوره» کالای «شکر» را هم پیدا می‌کند. فهرستِ هر دکان بعداً.',
        'The apps fetch this list from the account server; searching “بوره” also finds “شکر”. Per-shop lists come later.',
        'اپونه دا لېست له سرور څخه اخلي.')}</p>
      <SourceLine source="/api/admin/search/synonyms" data={d} at={load.at} />
      {open && v && (
        <SensitiveDialog title={tx('فهرستِ مرکزیِ مترادف', 'Central synonym list', 'د مترادفونو مرکزي لېست')} onClose={() => setOpen(false)} onSubmit={submit}
                         onUnknown={() => { void load.reload(); }}
                         effect={tx('نسخهٔ {v} ⇒ {n} گروه. جست‌وجوی همهٔ دکان‌ها و برنامه‌ها با این فهرست مترادف را هم می‌گیرد.',
                           'Version {v} ⇒ {n} groups. Search in every shop and app will match these synonyms.',
                           '{v} نسخه ⇒ {n} ډلې. د ټولو هټیو لټون به دا مترادفونه هم ومومي.',
                           { v: shown(d.version), n: shown(v.groups.length) })} />
      )}
    </>,
  );
}
