// ---------------------------------------------------------------------------
//  🖼 بانکِ عکس — بارگذاری، کالای بانک و ورودِ گروهی (۳-۹ «الف»، ۱.۵۰.۸۸)
//
//  ⛔ همه از ‎/console/image-bank/*‎ ⇐ همان درهای ‎/api/admin/image-bank/*‎ ِ سرورِ حساب؛ پنل عکس نگه نمی‌دارد.
//  ⛔ فقط برای admin نشان داده می‌شود (مرز در سرور است: viewer و operator ۴۰۳).
//  ⛔ تک‌عکس و ساختِ کالا یک کلیدِ یکتایی برای همان فرم دارند (کلیکِ دوم کارِ دوم نمی‌سازد)؛ پس از «انجام شد» کلید نو می‌شود.
//  ⛔ ورودِ گروهی: فایل‌ها یکی‌یکی (هر کدام sha256 ِ خودش، نامِ فارسی هم)؛ فایلی که با همان نام و همان sha256 از پیش در دسته
//     هست دوباره فرستاده نمی‌شود (ادامه پس از قطع). CSV اول «آزمایشی» (‎dry_run‎)، بعد «اعمال». لغو دلیل می‌خواهد.
//  ⛔ متن‌ها فقط متن‌اند؛ هیچ HTML ِ خامی ساخته نمی‌شود.
// ---------------------------------------------------------------------------
import { useState, type ReactNode } from 'react';
import { Upload } from 'lucide-react';

import { api, getToken } from '../../../api';
import { Card, Loading } from '../../../components/ui';
import { Cell, Notice, Row, Table } from '../../../control/ui';
import { useLoad, type Load } from '../shared';
import { Problem } from '../ShopConsole';
import { newIdemKey, shown } from '../consoleData';
import { StateEmpty, errText, fmtTime, outcomeUnknown } from './parts';
import { useTx } from './text';

const IB = '/api/account-admin/console/image-bank';
const MAX_BYTES = 2 * 1024 * 1024;
const ROLES = ['main', 'back', 'label', 'variant', 'promo', 'detail'];
const LICENSES = ['unknown', 'licensed', 'restricted', 'denied'];

type Batch = { id: string; status: string; note: string; licenseSource: string; licenseStatus: string; files: number | null; filesFailed: number | null; rows: number | null; rowsFailed: number | null; rowsAmbiguous: number | null; createdAt: number | null };
type RowRes = { rowNo: number | null; status: string; error: string; imageId: string; productId: string; candidates: string[] };
type RowsOut = { dryRun: boolean; counts: Record<string, number>; rows: RowRes[] };

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="space-y-2 rounded border border-border p-3"><p className="text-xs font-semibold">{title}</p>{children}</div>;
}

/* ───────────── تک‌عکس ───────────── */
function UploadOne({ onOpen }: { onOpen: (id: string) => void }) {
  const tx = useTx();
  const [file, setFile] = useState<File | null>(null);
  const [role, setRole] = useState('main');
  const [product, setProduct] = useState('');
  const [lic, setLic] = useState('unknown');
  const [source, setSource] = useState('');
  const [commercial, setCommercial] = useState(false);
  const [key, setKey] = useState(newIdemKey);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'warn' | 'bad'; text: string; id?: string } | null>(null);
  const tooBig = Boolean(file && file.size > MAX_BYTES);
  const send = async () => {
    if (!file || tooBig || busy) return;
    setBusy(true); setMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const qs = new URLSearchParams({ idempotencyKey: key, role, licenseStatus: lic, commercialUse: String(commercial), ...(product.trim() ? { bankProductId: product.trim() } : {}), ...(source.trim() ? { licenseSource: source.trim() } : {}) });
      const out = await api<{ id: string; status: string; qualityFlags: string[]; duplicateOf: string[] }>(`${IB}/images?${qs}`, { method: 'POST', raw: buf, contentType: file.type || 'application/octet-stream' });
      setMsg({ tone: 'good', id: out.id, text: tx('تأییدشده از سرورِ حساب: {id} — منتظرِ بازبینی{f}', 'Confirmed by the account server: {id} — awaiting review{f}', 'د حساب سرور تایید: {id} — کتنې ته منتظر{f}',
        { id: out.id, f: [...(out.qualityFlags || []), ...((out.duplicateOf || []).length ? ['duplicate'] : [])].length ? ` (${[...out.qualityFlags, ...(out.duplicateOf.length ? ['duplicate'] : [])].join(', ')})` : '' }) });
      setKey(newIdemKey()); setFile(null);
    } catch (e) {
      setMsg({ tone: outcomeUnknown(e) ? 'warn' : 'bad', text: outcomeUnknown(e) ? tx('معلوم نیست بارگذاری انجام شد — پیش از تکرار، صفِ بازبینی را ببینید', 'Unknown whether the upload went through — check the review queue before retrying', 'معلومه نه ده چې پورته شو') : errText(e) });
    } finally { setBusy(false); }
  };
  return (
    <Section title={tx('بارگذاریِ یک عکس (به صفِ بازبینی)', 'Upload one image (to the review queue)', 'یو انځور پورته کول')}>
      <div className="flex flex-wrap items-center gap-2 text-xs" data-bank-upload>
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" aria-label={tx('فایلِ عکس', 'Image file', 'د انځور فایل')}
               onChange={(e) => { setFile(e.target.files?.[0] || null); setMsg(null); }} />
        <label>{tx('نقش', 'Role', 'رول')} <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>
        <input className="input w-36 font-mono" dir="ltr" maxLength={40} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="bp_…" aria-label={tx('شناسهٔ کالای بانک (اختیاری)', 'Bank product id (optional)', 'د بانک توکي پېژند')} />
        <label>{tx('مجوز', 'Licence', 'جواز')} <select className="input" value={lic} onChange={(e) => setLic(e.target.value)}>{LICENSES.map((l) => <option key={l}>{l}</option>)}</select></label>
        <input className="input w-40" maxLength={120} value={source} onChange={(e) => setSource(e.target.value)} placeholder={tx('منبعِ مجوز', 'Licence source', 'د جواز سرچینه')} aria-label={tx('منبعِ مجوز', 'Licence source', 'د جواز سرچینه')} />
        <label className="flex items-center gap-1"><input type="checkbox" checked={commercial} onChange={(e) => setCommercial(e.target.checked)} />{tx('استفادهٔ تجاری', 'Commercial use', 'سوداګریزه کارونه')}</label>
        <button className="btn btn-sm btn-primary" disabled={!file || tooBig || busy} onClick={send}>{busy ? tx('در حالِ فرستادن…', 'Sending…', 'لېږل کېږي…') : tx('بارگذاری', 'Upload', 'پورته کول')}</button>
      </div>
      {tooBig && <Notice tone="warn">{tx('عکس بزرگ‌تر از ۲ مگابایت است', 'The image is larger than 2 MB', 'انځور له ۲ MB لوی دی')}</Notice>}
      {msg && <Notice tone={msg.tone}>{msg.text}{msg.id && <button className="btn btn-sm mr-2 ml-2" onClick={() => onOpen(msg.id!)}>{tx('باز کن', 'Open', 'پرانیزه')}</button>}</Notice>}
    </Section>
  );
}

/* ───────────── کالای بانک ───────────── */
const EMPTY = { id: '', name: '', gtin: '', sku: '', brand: '', category: '', variant: '', sizeValue: '', sizeUnit: '', packCount: '', packaging: '', altNames: '' };
function ProductForm() {
  const tx = useTx();
  const [f, setF] = useState(EMPTY);
  const [key, setKey] = useState(newIdemKey);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad' | 'warn'; text: string } | null>(null);
  const set = (k: keyof typeof EMPTY, v: string) => setF((x) => ({ ...x, [k]: v }));
  const editing = f.id.trim() !== '';
  const send = async () => {
    if (!f.name.trim() || busy) return;
    setBusy(true); setMsg(null);
    const body = {
      name: f.name, gtin: f.gtin, sku: f.sku, brand: f.brand, category: f.category, variant: f.variant, sizeValue: f.sizeValue, sizeUnit: f.sizeUnit, packaging: f.packaging,
      altNames: f.altNames.split(/[،,|]/).map((s) => s.trim()).filter(Boolean), ...(f.packCount.trim() ? { packCount: Number(f.packCount) } : {}),
    };
    try {
      if (editing) {
        await api(`${IB}/products/${encodeURIComponent(f.id.trim())}`, { method: 'PATCH', body });
        setMsg({ tone: 'good', text: tx('کالای {id} ویرایش شد', 'Product {id} updated', 'توکی {id} سم شو', { id: f.id.trim() }) });
      } else {
        const out = await api<{ id: string }>(`${IB}/products`, { method: 'POST', body: { ...body, idempotencyKey: key } });
        setMsg({ tone: 'good', text: tx('کالای بانک ساخته شد: {id}', 'Bank product created: {id}', 'د بانک توکی جوړ شو: {id}', { id: out.id }) });
        setKey(newIdemKey()); setF(EMPTY);
      }
    } catch (e) {
      setMsg({ tone: outcomeUnknown(e) ? 'warn' : 'bad', text: errText(e) });
    } finally { setBusy(false); }
  };
  const input = (k: keyof typeof EMPTY, label: string, opts: { ltr?: boolean; w?: string; max?: number } = {}) => (
    <input className={`input ${opts.w || 'w-32'}${opts.ltr ? ' font-mono' : ''}`} dir={opts.ltr ? 'ltr' : undefined} maxLength={opts.max || 100}
           value={f[k]} onChange={(e) => set(k, e.target.value)} placeholder={label} aria-label={label} />
  );
  return (
    <Section title={tx('کالای بانک — ساخت یا ویرایش', 'Bank product — create or edit', 'د بانک توکی — جوړول یا سمول')}>
      <div className="flex flex-wrap gap-1 text-xs" data-bank-product>
        {input('id', tx('شناسه (برای ویرایش)', 'Id (to edit)', 'پېژند (د سمولو لپاره)'), { ltr: true, max: 40 })}
        {input('name', tx('نامِ کالا *', 'Product name *', 'د توکي نوم *'), { w: 'w-48', max: 200 })}
        {input('gtin', tx('بارکد', 'Barcode', 'بارکوډ'), { ltr: true, max: 32 })}
        {input('sku', 'SKU', { ltr: true, max: 64 })}
        {input('brand', tx('برند', 'Brand', 'برانډ'))}
        {input('category', tx('دسته', 'Category', 'کټګوري'))}
        {input('variant', tx('نوع', 'Variant', 'ډول'))}
        {input('sizeValue', tx('اندازه', 'Size', 'اندازه'), { w: 'w-20', max: 20 })}
        {input('sizeUnit', tx('واحد', 'Unit', 'واحد'), { w: 'w-20', max: 20 })}
        {input('packCount', tx('شمارِ بسته', 'Pack count', 'د بستې شمېر'), { w: 'w-24', ltr: true, max: 6 })}
        {input('packaging', tx('بسته‌بندی', 'Packaging', 'بسته‌بندي'))}
        {input('altNames', tx('نام‌های دیگر (با ، جدا)', 'Other names (comma-separated)', 'نور نومونه'), { w: 'w-64', max: 2000 })}
        <button className="btn btn-sm btn-primary" disabled={!f.name.trim() || busy} onClick={send}>{editing ? tx('ذخیرهٔ ویرایش', 'Save edit', 'سمون خوندي کول') : tx('ساختن', 'Create', 'جوړول')}</button>
      </div>
      {editing && <p className="text-[11px] text-ink-muted">{tx('ویرایش همهٔ فیلدهای کالا را با همین فرم جایگزین می‌کند.', 'Editing replaces every product field with this form.', 'سمون ټول ساحې بدلوي.')}</p>}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </Section>
  );
}

/* ───────────── ورودِ گروهی ───────────── */
function BatchPanel({ batch, onChanged }: { batch: Batch; onChanged: () => void }) {
  const tx = useTx();
  const [progress, setProgress] = useState('');
  const [csv, setCsv] = useState('');
  const [rows, setRows] = useState<RowsOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad' | 'warn'; text: string } | null>(null);
  const [cancelWhy, setCancelWhy] = useState('');
  const open = batch.status === 'open';
  const base = `${IB}/batches/${encodeURIComponent(batch.id)}`;

  const uploadFiles = async (list: FileList | null) => {
    if (!list || !list.length || busy) return;
    setBusy(true); setMsg(null);
    try {
      //  فایل‌های رسیده با همان نام و sha256 دوباره نمی‌روند (ادامه پس از قطع)
      const have = new Map<string, string>();
      let after = '';
      for (let page = 0; page < 50; page++) {
        const r = await api<{ items: { name: string; sha256: string; status: string }[]; nextAfter: string | null }>(`${base}/files${after ? `?after=${encodeURIComponent(after)}` : ''}`);
        for (const it of r.items) if (it.status === 'ok') have.set(it.name, it.sha256);
        if (!r.nextAfter) break;
        after = r.nextAfter;
      }
      let ok = 0, skipped = 0, failed = 0;
      const files = [...list];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress(tx('{i} از {n}: {name}', '{i} of {n}: {name}', '{i} له {n}: {name}', { i: shown(i + 1), n: shown(files.length), name: file.name }));
        if (file.size > MAX_BYTES) { failed++; continue; }
        const buf = await file.arrayBuffer();
        const sum = await sha256Hex(buf);
        if (have.get(file.name) === sum) { skipped++; continue; }
        try {
          const out = await api<{ status: string }>(`${base}/files/${encodeURIComponent(file.name)}`, { method: 'PUT', raw: buf, contentType: file.type || 'application/octet-stream' });
          if (out.status === 'ok') ok++; else failed++;
        } catch { failed++; }
      }
      setMsg({ tone: failed ? 'warn' : 'good', text: tx('رسید: {ok} · از پیش بود: {s} · ناموفق: {f}', 'Received: {ok} · already there: {s} · failed: {f}', 'ورسېدل: {ok} · مخکې وو: {s} · ناکام: {f}', { ok: shown(ok), s: shown(skipped), f: shown(failed) }) });
      onChanged();
    } catch (e) {
      setMsg({ tone: 'bad', text: errText(e) });
    } finally { setBusy(false); setProgress(''); }
  };

  const sendRows = async (dryRun: boolean) => {
    if (!csv.trim() || busy) return;
    setBusy(true); setMsg(null);
    try {
      const out = await api<RowsOut>(`${base}/rows`, { method: 'POST', body: { csv, dryRun } });
      setRows(out);
      if (!dryRun) onChanged();
    } catch (e) {
      setMsg({ tone: outcomeUnknown(e) ? 'warn' : 'bad', text: errText(e) });
    } finally { setBusy(false); }
  };

  const setStatus = async (status: 'open' | 'paused' | 'done' | 'cancelled') => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const out = await api<{ status: string; rejected: number }>(`${base}/status`, { method: 'POST', body: { status, confirm: true, ...(status === 'cancelled' ? { reason: cancelWhy.trim() } : {}) } });
      setMsg({ tone: 'good', text: tx('وضعیتِ دسته: {s}{r}', 'Batch status: {s}{r}', 'د دستې حالت: {s}{r}', { s: out.status, r: out.rejected ? ` — ${shown(out.rejected)} ✕` : '' }) });
      onChanged();
    } catch (e) {
      setMsg({ tone: 'bad', text: errText(e) });
    } finally { setBusy(false); }
  };

  const downloadCsv = async () => {
    const res = await fetch(`${base}/report?format=csv`, { headers: { Authorization: `Bearer ${getToken() || ''}` } });
    if (!res.ok) { setMsg({ tone: 'bad', text: tx('گزارش گرفته نشد', 'Could not fetch the report', 'راپور رانغی') }); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = `batch-${batch.id}-errors.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-2 text-xs" data-bank-batch={batch.id}>
      <p><code dir="ltr">{batch.id}</code> · {batch.status} · {tx('فایل', 'files', 'فایلونه')} {shown(batch.files)} · {tx('ردیف', 'rows', 'کرښې')} {shown(batch.rows)}
        {batch.rowsFailed ? ` · ${tx('ناموفق', 'failed', 'ناکام')} ${shown(batch.rowsFailed)}` : ''}</p>
      {open && (
        <label className="block">{tx('۱) فایل‌های عکس (چندتایی؛ تا ۲ مگابایت هر کدام)', '1) Image files (multiple; up to 2 MB each)', '۱) د انځور فایلونه')}
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,image/avif" className="mt-1 block" disabled={busy} onChange={(e) => void uploadFiles(e.target.files)} />
        </label>
      )}
      {progress && <p className="text-ink-muted" aria-live="polite">{progress}</p>}
      {open && (
        <label className="block">{tx('۲) فهرستِ CSV (سرستون: name, barcode, sku, brand, category, image_path, image_role, license_status, …)', '2) CSV list (header: name, barcode, sku, brand, category, image_path, image_role, license_status, …)', '۲) CSV لېست')}
          <textarea className="input mt-1 h-28 w-full font-mono" dir="ltr" value={csv} onChange={(e) => { setCsv(e.target.value); setRows(null); }} />
          <input type="file" accept=".csv,text/csv" className="mt-1 block" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setCsv(await f.text()); setRows(null); } }} />
        </label>
      )}
      {open && (
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-sm" disabled={!csv.trim() || busy} onClick={() => void sendRows(true)}>{tx('آزمایشی (بی ثبت)', 'Dry run (no write)', 'ازمایښت')}</button>
          <button className="btn btn-sm btn-primary" disabled={!csv.trim() || busy || !rows?.dryRun} onClick={() => void sendRows(false)}>{tx('اعمال', 'Apply', 'پلي کول')}</button>
        </div>
      )}
      {rows && (
        <Notice tone={rows.counts.failed || rows.counts.ambiguous ? 'warn' : 'good'}>
          {rows.dryRun ? tx('آزمایشی: ', 'Dry run: ', 'ازمایښت: ') : tx('ثبت شد: ', 'Applied: ', 'ثبت شو: ')}
          {Object.entries(rows.counts).map(([k, v]) => `${k} ${shown(v)}`).join(' · ') || '—'}
        </Notice>
      )}
      {rows && rows.rows.some((r) => r.status !== 'ok') && (
        <Table head={[tx('ردیف', 'Row', 'کرښه'), tx('وضعیت', 'Status', 'حالت'), tx('خطا', 'Error', 'تېروتنه'), tx('گزینه‌ها', 'Candidates', 'انتخابونه')]}>
          {rows.rows.filter((r) => r.status !== 'ok').slice(0, 50).map((r, i) => (
            <Row key={i}><Cell mono>{shown(r.rowNo)}</Cell><Cell mono>{r.status}</Cell><Cell mono>{r.error || '—'}</Cell><Cell mono>{r.candidates.join(', ') || '—'}</Cell></Row>
          ))}
        </Table>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {batch.status === 'open' && <button className="btn btn-sm" disabled={busy} onClick={() => void setStatus('paused')}>{tx('توقف', 'Pause', 'درول')}</button>}
        {batch.status === 'paused' && <button className="btn btn-sm" disabled={busy} onClick={() => void setStatus('open')}>{tx('ادامه', 'Resume', 'دوام')}</button>}
        {(batch.status === 'open' || batch.status === 'paused') && <>
          <button className="btn btn-sm" disabled={busy} onClick={() => void setStatus('done')}>{tx('پایانِ دسته', 'Finish batch', 'دسته پای ته')}</button>
          <input className="input w-48" maxLength={200} value={cancelWhy} onChange={(e) => setCancelWhy(e.target.value)} placeholder={tx('دلیلِ لغو', 'Reason to cancel', 'د لغوې دلیل')} aria-label={tx('دلیلِ لغو', 'Reason to cancel', 'د لغوې دلیل')} />
          <button className="btn btn-sm btn-danger" disabled={busy || cancelWhy.trim().length < 3} onClick={() => void setStatus('cancelled')}>{tx('لغو (عکس‌های بررسی‌نشده رد می‌شوند)', 'Cancel (unreviewed images are rejected)', 'لغوه')}</button>
        </>}
        <button className="btn btn-sm" onClick={() => void downloadCsv()}>{tx('گزارشِ خطاها (CSV)', 'Error report (CSV)', 'د تېروتنو راپور')}</button>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}

function Batches() {
  const tx = useTx();
  const load = useLoad<{ items: Batch[] }>(`${IB}/batches`);
  const [sel, setSel] = useState('');
  const [note, setNote] = useState('');
  const [src, setSrc] = useState('');
  const [lic, setLic] = useState('unknown');
  const [commercial, setCommercial] = useState(false);
  const [key, setKey] = useState(newIdemKey);
  const [err, setErr] = useState('');
  const items = Array.isArray(load.data?.items) ? load.data!.items : [];
  const create = async () => {
    setErr('');
    try {
      const out = await api<{ id: string }>(`${IB}/batches`, { method: 'POST', body: { note, licenseSource: src, licenseStatus: lic, commercialUse: commercial, idempotencyKey: key } });
      setKey(newIdemKey()); setNote(''); setSel(out.id);
      await load.reload();
    } catch (e) { setErr(errText(e)); }
  };
  const current = items.find((b) => b.id === sel);
  return (
    <Section title={tx('ورودِ گروهی (دسته + فایل‌ها + CSV)', 'Bulk import (batch + files + CSV)', 'ډله‌ییز ننوتل')}>
      <div className="flex flex-wrap items-center gap-2 text-xs" data-bank-batch-new>
        <input className="input w-48" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tx('یادداشتِ دسته', 'Batch note', 'د دستې یادښت')} aria-label={tx('یادداشتِ دسته', 'Batch note', 'د دستې یادښت')} />
        <input className="input w-40" maxLength={120} value={src} onChange={(e) => setSrc(e.target.value)} placeholder={tx('منبعِ مجوز', 'Licence source', 'د جواز سرچینه')} aria-label={tx('منبعِ مجوز', 'Licence source', 'د جواز سرچینه')} />
        <label>{tx('مجوز', 'Licence', 'جواز')} <select className="input" value={lic} onChange={(e) => setLic(e.target.value)}>{LICENSES.map((l) => <option key={l}>{l}</option>)}</select></label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={commercial} onChange={(e) => setCommercial(e.target.checked)} />{tx('استفادهٔ تجاری', 'Commercial use', 'سوداګریزه کارونه')}</label>
        <button className="btn btn-sm btn-primary" onClick={() => void create()}>{tx('دستهٔ تازه', 'New batch', 'نوې دسته')}</button>
      </div>
      {err && <Notice tone="bad">{err}</Notice>}
      {load.error ? <Problem load={load as Load<unknown>} /> : !load.data ? <Loading /> : items.length === 0
        ? <StateEmpty>{tx('دسته‌ای نیست', 'No batches', 'دسته نشته')}</StateEmpty> : (
          <Table head={[tx('دسته', 'Batch', 'دسته'), tx('وضعیت', 'Status', 'حالت'), tx('فایل/ناموفق', 'Files/failed', 'فایل/ناکام'), tx('ردیف/ناموفق/مبهم', 'Rows/failed/ambiguous', 'کرښې'), tx('کِی', 'When', 'کله')]}>
            {items.map((b) => (
              <Row key={b.id}>
                <Cell><button className="underline" onClick={() => setSel(b.id === sel ? '' : b.id)}><code dir="ltr">{b.id}</code></button>{b.note ? ` · ${b.note}` : ''}</Cell>
                <Cell mono>{b.status}</Cell>
                <Cell mono>{`${shown(b.files)}/${shown(b.filesFailed)}`}</Cell>
                <Cell mono>{`${shown(b.rows)}/${shown(b.rowsFailed)}/${shown(b.rowsAmbiguous)}`}</Cell>
                <Cell>{fmtTime(b.createdAt)}</Cell>
              </Row>
            ))}
          </Table>
        )}
      {current && <BatchPanel key={current.id} batch={current} onChanged={() => { void load.reload(); }} />}
    </Section>
  );
}

export default function ImageBankTools({ onOpen }: { onOpen: (id: string) => void }) {
  const tx = useTx();
  return (
    <Card title={tx('بارگذاری و ورودِ گروهی', 'Upload & bulk import', 'پورته کول او ډله‌ییز ننوتل')} icon={<Upload size={16} />}>
      <div className="space-y-3" data-card="bank-tools">
        <UploadOne onOpen={onOpen} />
        <ProductForm />
        <Batches />
      </div>
    </Card>
  );
}
