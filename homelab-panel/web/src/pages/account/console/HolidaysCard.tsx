// ---------------------------------------------------------------------------
//  ۴.۱۲ — جدولِ تعطیلاتِ رسمی (LOC-04، ۱.۵۰.۷۸): روزِ کاریِ همهٔ دکان‌ها و برنامه‌ها از همین جدولِ سرورِ حساب است
//
//  ⛔ بی `holidays.v1` (سرورِ حسابِ کهنه) ⇒ «سرورِ حساب کهنه است» با نامِ درِ لازم — هیچ جدولِ ساختگی.
//  ⛔ عوض کردن فقط admin (مرز در سرور است — پل admin و سرورِ حساب ارشد می‌خواهد؛ دکمه فقط برای درخواستِ بی‌نتیجه نزدن پنهان
//     می‌شود): ویرایش ⇒ «ذخیره…» ⇒ `SensitiveDialog` (دلیل + تأیید + یک کلیدِ یکتایی برای همین پنجره) با نسخهٔ همان جدولی که دیده شد.
//  ⛔ سنجشِ تاریخ و نام **همان سرورِ حساب** (`routes/console-holidays.js` ⇐ `lib/holidays.js` ِ shop) — این‌جا فقط تا دکمه
//     پیش از فرستادن بسته بماند؛ پل همان را دوباره می‌سنجد.
//  ⛔ ‎409 holiday_version‎ ⇒ «کسِ دیگری در این میان عوضش کرد — دوباره بخوانید» (ویرایشِ شما نوشته نشد)، نه رونویسی و نه سرخِ گنگ.
//  ⛔ نام‌ها فقط متن‌اند (React خودش گریز می‌دهد؛ این‌جا هیچ HTML ِ خامی ساخته نمی‌شود).
// ---------------------------------------------------------------------------
import { useState, type ReactNode } from 'react';
import { CalendarDays } from 'lucide-react';

import { api } from '../../../api';
import { useApp } from '../../../app-context';
import { Card } from '../../../components/ui';
import { Cell, KV, Notice, Row, Table } from '../../../control/ui';
import { useLoad, type Load } from '../shared';
import { Problem, SourceLine } from '../ShopConsole';
import { isUnavailable, shown, type Unavailable } from '../consoleData';
import { NotSupported, SensitiveDialog, StateLoading, errCode, fmtTime, type SensitiveSubmit } from './parts';
import { useTx } from './text';

export const HOLIDAYS_API = '/api/account-admin/console/calendar/holidays';
const MAX = 500;
const NAME_MAX = 80;

type Name = { fa?: string; en?: string; ps?: string };
type Holiday = { date: string; name: Name };
type Doc = { available: true; version: number | null; updatedAt: number | null; holidays: Holiday[]; fetchedAt?: number; max?: number; nameMax?: number };
type Draft = { date: string; fa: string; en: string; ps: string };
type Saved = { version: number | null; holidays: Holiday[]; unchanged?: boolean; replayed?: boolean };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const monthDays = (y: number, m: number) => (m === 2 ? ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28) : (m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31));
/** همان `isDate` ِ سرورِ حساب: میلادیِ واقعیِ ‎YYYY-MM-DD‎، ۲۰۰۰-۰۱-۰۱ تا ۲۱۹۹-۱۲-۳۱ */
export function isHolidayDate(iso: string): boolean {
  const m = DATE_RE.exec(iso);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > monthDays(y, mo)) return false;
  return iso >= '2000-01-01' && iso <= '2199-12-31';
}
// eslint-disable-next-line no-control-regex
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, '').trim();

/** ردیفِ پیش‌نویس ⇒ ردیفِ فرستادنی، یا کدِ خطا (همان قاعده‌های سرورِ حساب) */
function check(rows: Draft[]) {
  const errs: Record<number, 'date' | 'dup' | 'fa' | 'long'> = {};
  const seen = new Set<string>();
  const out: Holiday[] = [];
  rows.forEach((r, i) => {
    const date = r.date.trim();
    const name: Name = {};
    for (const lang of ['fa', 'en', 'ps'] as const) { const s = clean(r[lang]); if (s) name[lang] = s; }
    if (!isHolidayDate(date)) errs[i] = 'date';
    else if (seen.has(date)) errs[i] = 'dup';
    else if (!name.fa) errs[i] = 'fa';
    else if (Object.values(name).some((s) => (s as string).length > NAME_MAX)) errs[i] = 'long';
    seen.add(date);
    out.push({ date, name });
  });
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { errs, out, ok: Object.keys(errs).length === 0 && rows.length <= MAX };
}

const toDraft = (h: Holiday): Draft => ({ date: h.date, fa: h.name.fa || '', en: h.name.en || '', ps: h.name.ps || '' });
const same = (a: Holiday[], b: Holiday[]) => JSON.stringify(a) === JSON.stringify(b);

export default function HolidaysCard() {
  const tx = useTx();
  const { can } = useApp();
  const admin = can('admin');
  const load = useLoad<Doc | Unavailable>(HOLIDAYS_API);
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [open, setOpen] = useState(false);
  const [stale, setStale] = useState(false);
  const [done, setDone] = useState('');
  const title = tx('تعطیلاتِ رسمی', 'Official holidays', 'رسمي رخصتۍ');
  const wrap = (body: ReactNode) => <div data-card="holidays"><Card title={title} icon={<CalendarDays size={15} />}>{body}</Card></div>;

  if (load.error) return wrap(<Problem load={load as Load<unknown>} />);
  if (!load.data) return wrap(<StateLoading />);
  if (isUnavailable(load.data)) {
    return wrap(
      <NotSupported needs={load.data.needs || 'GET|PUT /api/admin/calendar/holidays'}>
        <span data-holidays-old>
          {tx('سرورِ حساب کهنه است: جدولِ تعطیلاتِ رسمی (holidays.v1) را ندارد. سرورِ حساب را به‌روز کنید — تا آن روز این‌جا هیچ جدولی نشان داده یا ساخته نمی‌شود.',
            'The account server is too old: it has no official-holidays table (holidays.v1). Update the account server — until then no table is shown or made up here.',
            'د حساب سرور زوړ دی: د رسمي رخصتیو جدول (holidays.v1) نه لري. د حساب سرور تازه کړئ — تر هغه دلته هېڅ جدول نه ښودل کېږي.')}
        </span>
      </NotSupported>,
    );
  }
  const d = load.data;
  const rows = Array.isArray(d.holidays) ? d.holidays : [];
  const editing = draft !== null;
  const v = editing ? check(draft) : null;
  const changed = Boolean(v && !same(v.out, rows));
  const canSave = Boolean(v?.ok && changed && d.version !== null);
  const before = new Set(rows.map((h) => h.date));
  const after = new Set((v?.out || []).map((h) => h.date));
  const added = (v?.out || []).filter((h) => !before.has(h.date)).length;
  const removed = rows.filter((h) => !after.has(h.date)).length;
  const errText = (e: 'date' | 'dup' | 'fa' | 'long') => (e === 'date'
    ? tx('تاریخِ میلادیِ درست (YYYY-MM-DD، ۲۰۰۰ تا ۲۱۹۹)', 'A real Gregorian date (YYYY-MM-DD, 2000–2199)', 'سم میلادي نېټه (YYYY-MM-DD، ۲۰۰۰–۲۱۹۹)')
    : e === 'dup' ? tx('این تاریخ دو بار آمده', 'This date appears twice', 'دا نېټه دوه ځله راغلې')
      : e === 'fa' ? tx('نامِ دری لازم است', 'The Dari name is required', 'دري نوم اړین دی')
        : tx('نام بلندتر از ۸۰ نویسه', 'Name longer than 80 characters', 'نوم له ۸۰ تورو اوږد'));
  const set = (i: number, k: keyof Draft, val: string) => setDraft((x) => (x ? x.map((r, j) => (j === i ? { ...r, [k]: val } : r)) : x));

  const submit = async (x: SensitiveSubmit) => {
    if (!v || d.version === null) return;
    try {
      const out = await api<Saved>(HOLIDAYS_API, { method: 'PUT', body: { holidays: v.out, version: d.version, ...x, confirm: true } });
      setDone(out.unchanged
        ? tx('همین جدول از پیش روی سرورِ حساب بود — چیزی عوض نشد', 'The account server already had this table — nothing changed', 'دا جدول له مخکې پر سرور و — څه بدل نه شول')
        : tx('تأییدشده از سرورِ حساب: نسخهٔ {v} با {n} روز', 'Confirmed by the account server: version {v} with {n} days', 'د حساب سرور تایید: {v} نسخه له {n} ورځو سره',
          { v: shown(out.version), n: shown(Array.isArray(out.holidays) ? out.holidays.length : 0) }));
      setOpen(false);
      setDraft(null);
      await load.reload();
    } catch (e) {
      //  ⛔ نسخهٔ کهنه: کسِ دیگری نوشت ⇒ پنجره بسته، ویرایش نگه داشته (برای دیدن)، و «دوباره بخوانید» — هیچ چیزی نوشته نشد
      if (errCode(e) === 'holiday_version') { setOpen(false); setStale(true); return; }
      throw e;
    }
  };

  return wrap(
    <>
      <KV label={tx('نسخه', 'Version', 'نسخه')}>{d.version === null ? '—' : shown(d.version)}</KV>
      <KV label={tx('آخرین تغییر', 'Last change', 'وروستی بدلون')}>{fmtTime(d.updatedAt)}</KV>
      <KV label={tx('روزها', 'Days', 'ورځې')}>{shown(rows.length)}</KV>
      {done && <Notice tone="good">{done}</Notice>}
      {stale && (
        <div data-holidays-stale>
          <Notice tone="warn">
            {tx('کسِ دیگری در این میان جدول را عوض کرد — ویرایشِ شما نوشته نشد. دوباره بخوانید و دوباره ویرایش کنید.',
              'Someone else changed the table in the meantime — your edit was not saved. Reload and edit again.',
              'بل چا په دې منځ کې جدول بدل کړ — ستاسو بدلون ونه لیکل شو. بیا یې ولولئ او بیا یې سم کړئ.')}
            <button className="btn btn-sm mr-2 ml-2" data-holidays-reload onClick={() => { setStale(false); setDraft(null); setDone(''); void load.reload(); }}>
              {tx('دوباره بخوان', 'Reload', 'بیا ولولئ')}
            </button>
          </Notice>
        </div>
      )}
      {!admin && <Notice>{tx('فقط مدیرِ پنل جدول را عوض می‌کند (سرورِ حساب هم فقط مدیرِ ارشد را می‌پذیرد).', 'Only panel admins change this table (the account server accepts super admins only).', 'یوازې د پینل مدیر دا جدول بدلوي.')}</Notice>}
      {!editing ? (
        <>
          <Table head={[tx('تاریخ (میلادی)', 'Date (Gregorian)', 'نېټه (میلادي)'), tx('دری', 'Dari', 'دري'), 'English', tx('پښتو', 'Pashto', 'پښتو')]} empty={rows.length === 0}>
            {rows.map((h) => (
              <Row key={h.date}>
                <Cell mono><span dir="ltr">{h.date}</span></Cell>
                <Cell><span data-holiday-name>{h.name.fa || '—'}</span></Cell>
                <Cell><span dir="ltr">{h.name.en || '—'}</span></Cell>
                <Cell>{h.name.ps || '—'}</Cell>
              </Row>
            ))}
          </Table>
          {admin && (
            <button className="btn btn-sm mt-2" data-holidays-edit disabled={d.version === null}
                    onClick={() => { setDone(''); setStale(false); setDraft(rows.map(toDraft)); }}>
              {tx('ویرایشِ جدول', 'Edit table', 'جدول سمول')}
            </button>
          )}
        </>
      ) : (
        <div className="space-y-2" data-holidays-editor>
          {draft.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1" data-holiday-row={i}>
              <input className="input w-32 font-mono" dir="ltr" inputMode="numeric" placeholder="YYYY-MM-DD" maxLength={10} value={r.date}
                     aria-label={tx('تاریخ', 'Date', 'نېټه')} onChange={(e) => set(i, 'date', e.target.value)} />
              <input className="input w-40" maxLength={NAME_MAX} value={r.fa} placeholder={tx('نامِ دری', 'Dari name', 'دري نوم')}
                     aria-label={tx('نامِ دری', 'Dari name', 'دري نوم')} onChange={(e) => set(i, 'fa', e.target.value)} />
              <input className="input w-36" dir="ltr" maxLength={NAME_MAX} value={r.en} placeholder="English"
                     aria-label="English" onChange={(e) => set(i, 'en', e.target.value)} />
              <input className="input w-36" maxLength={NAME_MAX} value={r.ps} placeholder={tx('نامِ پښتو', 'Pashto name', 'پښتو نوم')}
                     aria-label={tx('نامِ پښتو', 'Pashto name', 'پښتو نوم')} onChange={(e) => set(i, 'ps', e.target.value)} />
              <button className="btn btn-sm" onClick={() => setDraft((x) => (x ? x.filter((_, j) => j !== i) : x))}>{tx('برداشتن', 'Remove', 'لرې کول')}</button>
              {v?.errs[i] && <span className="text-[11px]" data-holiday-error style={{ color: 'var(--status-warning)' }}>{errText(v.errs[i])}</span>}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-sm" data-holidays-add disabled={draft.length >= MAX}
                    onClick={() => setDraft((x) => [...(x || []), { date: '', fa: '', en: '', ps: '' }])}>{tx('افزودنِ روز', 'Add a day', 'ورځ زیاتول')}</button>
            <button className="btn btn-sm btn-primary" data-holidays-save disabled={!canSave} onClick={() => setOpen(true)}>{tx('ذخیره…', 'Save…', 'خوندي کول…')}</button>
            <button className="btn btn-sm" onClick={() => setDraft(null)}>{tx('انصراف', 'Cancel', 'لغوه')}</button>
            {draft.length >= MAX && <span className="text-[11px] text-ink-muted">{tx('سقف ۵۰۰ روز است', 'The limit is 500 days', 'حد ۵۰۰ ورځې دی')}</span>}
          </div>
        </div>
      )}
      <p className="mt-2 text-[11px] text-ink-muted">{tx('تعطیلاتِ قمری با رؤیتِ ماه اعلام می‌شوند؛ برنامه‌ها جدول را از سرورِ حساب می‌گیرند و روزِ کاری را با آن می‌شمارند.',
        'Lunar holidays are announced on moon sighting; the apps fetch this table from the account server and count working days with it.',
        'قمري رخصتۍ د سپوږمۍ په لیدو اعلانېږي؛ اپونه دا جدول له سرور څخه اخلي.')}</p>
      <SourceLine source="/api/admin/calendar/holidays" data={d} at={load.at} />
      {open && v && (
        <SensitiveDialog title={tx('جدولِ تعطیلاتِ رسمی', 'Official holidays table', 'د رسمي رخصتیو جدول')} onClose={() => setOpen(false)} onSubmit={submit}
                         onUnknown={() => { void load.reload(); }}
                         effect={tx('نسخهٔ {v} ⇒ {n} روز (افزوده {a}، برداشته {r}). روزِ کاریِ همهٔ دکان‌ها و برنامه‌ها با این جدول شمرده می‌شود.',
                           'Version {v} ⇒ {n} days ({a} added, {r} removed). Every shop and app counts working days with this table.',
                           '{v} نسخه ⇒ {n} ورځې ({a} زیاتې، {r} لرې). د ټولو هټیو او اپونو کاري ورځې په دې جدول شمېرل کېږي.',
                           { v: shown(d.version), n: shown(v.out.length), a: shown(added), r: shown(removed) })} />
      )}
    </>,
  );
}
