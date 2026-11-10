// ---------------------------------------------------------------------------
//  🖼 بانکِ عکسِ مرکزی — صفِ بازبینی، جست‌وجو، گزارش‌ها و بازبینی (۱.۵۰.۷۵، ممیزی §۳-۴)
//
//  ⛔ همه از ‎/console/image-bank/*‎ ⇐ ‎/api/admin/image-bank/*‎ ِ سرورِ حساب؛ پنل عکس نگه نمی‌دارد. پرچمِ خاموش ⇒
//     «بانک روشن نیست»، نه فهرستِ خالی. عکس با سرآیندِ نشست (`fetchBlobUrl`)، نه توکن در نشانی.
//  ⛔ بازبینی (تأیید/رد/بایگانی/جست‌وجو): فقط admin (مرز در سرور) + دلیل + تأیید + یک کلیدِ یکتایی برای همان پنجره؛
//     قاعده‌های انتشار (مجوزِ تجاری، کالای وصل، تطبیقِ قطعی) را **سرورِ حساب** می‌سنجد و خطایش با کدِ خودش دیده می‌شود.
// ---------------------------------------------------------------------------
import { useEffect, useState, type FormEvent } from 'react';
import { Images } from 'lucide-react';

import { api, fetchBlobUrl } from '../../../api';
import { Card, Loading } from '../../../components/ui';
import { useApp } from '../../../app-context';
import { Cell, Notice, Row, Table } from '../../../control/ui';
import { useLoad, type Load } from '../shared';
import { Problem, SourceLine } from '../ShopConsole';
import { shown } from '../consoleData';
import { SensitiveDialog, StateEmpty, fmtTime } from './parts';
import { useTx, type Tx } from './text';

const IB = '/api/account-admin/console/image-bank';
type Product = { id: string; gtin: string; sku: string; name: string; brand: string; status: string; missing?: boolean } | null;
type License = { status: string; source: string; commercialUse: boolean | null } | null;
type ReviewItem = {
  id: string; status: string; space: string; role: string; fromShop: boolean; createdAt: number | null; matchStatus: string;
  qualityFlags: string[]; duplicateOf: string[]; license: License; product: Product; candidates: Product[]; version: number | null;
  versionsPending: number; file: { url: string | null; width: number | null; height: number | null } | null;
};
type Detail = {
  id: string; space: string; status: string; role: string; currentVersion: number | null; searchEnabled: boolean; matchStatus: string;
  license: License; qualityFlags: string[]; origin: { shopId: string; consentAt: number | null } | null; product: Product; reviewNote: string;
  versions: { version: number | null; review: string; mime: string; width: number | null; height: number | null; urls: Record<string, string | null> }[];
};
type SearchItem = { product: Product; match: { kind: string; certain: boolean } | null; ambiguous: boolean; images: { id: string; status: string; space: string; urls: Record<string, string | null> }[] };
type Act = 'approve' | 'reject' | 'archive' | 'search-on' | 'search-off';

function Thumb({ url, alt }: { url: string | null | undefined; alt: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (!url) return undefined;
    const ctrl = new AbortController();
    let made = '';
    fetchBlobUrl(url, ctrl.signal).then((u) => { made = u; setSrc(u); }).catch(() => setSrc(''));
    return () => { ctrl.abort(); if (made) URL.revokeObjectURL(made); };
  }, [url]);
  if (!url) return <span className="text-ink-muted">—</span>;
  return src ? <img src={src} alt={alt} className="h-12 w-12 rounded object-cover" /> : <span className="inline-block h-12 w-12 rounded bg-surface-sunken" />;
}

const statusLabel = (tx: Tx, s: string) => ({
  NEEDS_REVIEW: tx('منتظرِ بازبینی', 'Needs review', 'کتنې ته منتظر'), APPROVED: tx('تأییدشده', 'Approved', 'تایید شوی'),
  REJECTED: tx('ردشده', 'Rejected', 'رد شوی'), ARCHIVED: tx('بایگانی', 'Archived', 'آرشیف'), DRAFT: tx('پیش‌نویس', 'Draft', 'مسوده'),
  PROCESSING: tx('در حالِ پردازش', 'Processing', 'پروسس کېږي'),
} as Record<string, string>)[s] || s || '—';

function ImageDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const tx = useTx();
  const { can } = useApp();
  const load = useLoad<{ image: Detail }>(`${IB}/images/${encodeURIComponent(id)}`, [id]);
  const [act, setAct] = useState<Act | null>(null);
  const [done, setDone] = useState('');
  const d = load.data?.image;
  const pending = d && ['NEEDS_REVIEW', 'DRAFT'].includes(d.status);
  const central = d && d.space === 'central' && d.status === 'APPROVED';
  const effect: Record<Act, string> = {
    approve: tx('این عکس (نسخهٔ جاری) در بانکِ مرکزی منتشر می‌شود و دکان‌ها در جست‌وجو می‌بینندش. سرورِ حساب پیش از آن مجوزِ تجاری، کالای وصل و تطبیقِ قطعی را می‌سنجد.',
      'This image (current version) is published to the central bank and shops will see it in search. The account server first checks the commercial licence, linked product and confirmed match.',
      'دا انځور (اوسنۍ نسخه) په مرکزي بانک کې خپرېږي او هټۍ یې په لټون کې ویني. د حساب سرور مخکې سوداګریز جواز، تړلی توکی او قطعي سمون ګوري.'),
    reject: tx('این عکس رد می‌شود و منتشر نمی‌شود؛ پاک نمی‌شود.', 'This image is rejected and not published; it is not deleted.', 'دا انځور ردېږي او نه خپرېږي؛ نه ړنګېږي.'),
    archive: tx('عکسِ مرکزی بایگانی می‌شود و از جست‌وجوی دکان‌ها بیرون می‌رود؛ پاک نمی‌شود.', 'The central image is archived and leaves shop search; it is not deleted.', 'مرکزي انځور آرشیف کېږي او د هټیو له لټون وځي؛ نه ړنګېږي.'),
    'search-on': tx('این عکس در جست‌وجوی دکان‌ها دیده می‌شود.', 'This image becomes visible in shop search.', 'دا انځور د هټیو په لټون کې ښکاري.'),
    'search-off': tx('این عکس از جست‌وجوی دکان‌ها پنهان می‌شود (دکانی که برداشته‌اش نگه می‌دارد).', 'This image is hidden from shop search (shops that already use it keep it).', 'دا انځور د هټیو له لټون پټېږي (کومې هټۍ چې کاروي یې ساتي).'),
  };
  return (
    <Card title={`${tx('عکس', 'Image', 'انځور')} ${id}`} icon={<Images size={16} />} action={<button className="btn btn-sm" onClick={onClose}>{tx('بستن', 'Close', 'بندول')}</button>}>
      {load.error ? <Problem load={load as Load<unknown>} /> : !d ? <Loading /> : (
        <div className="space-y-2 text-xs" data-card="bank-image">
          <p>{statusLabel(tx, d.status)} · {d.space} · {d.role || '—'} · {tx('نسخهٔ جاری', 'current version', 'اوسنۍ نسخه')} {shown(d.currentVersion)}
            {' · '}{tx('جست‌وجو', 'search', 'لټون')}: {d.searchEnabled ? tx('روشن', 'on', 'روښانه') : tx('خاموش', 'off', 'بند')}</p>
          <p>{tx('کالا', 'Product', 'توکی')}: {d.product ? `${d.product.name} · ${d.product.brand || '—'}` : '—'} {d.product?.gtin && <code dir="ltr">{d.product.gtin}</code>}
            {' · '}{tx('تطبیق', 'match', 'سمون')}: {d.matchStatus || '—'}</p>
          <p>{tx('مجوز', 'Licence', 'جواز')}: {d.license?.status || '—'} · {d.license?.source || '—'}
            {d.license?.commercialUse === null || !d.license ? '' : ` · ${d.license.commercialUse ? tx('تجاری مجاز', 'commercial OK', 'سوداګریز سم') : tx('تجاری نه', 'not commercial', 'سوداګریز نه')}`}</p>
          {d.origin && <p>{tx('از دکان', 'From shop', 'له هټۍ')} <code dir="ltr">{d.origin.shopId}</code> · {tx('اجازه', 'consent', 'اجازه')} {fmtTime(d.origin.consentAt)}</p>}
          {d.qualityFlags.length > 0 && <Notice tone="warn">{tx('نشانِ کیفیت', 'Quality flags', 'د کیفیت نښې')}: <code dir="ltr">{d.qualityFlags.join(', ')}</code></Notice>}
          <div className="flex flex-wrap gap-2">
            {d.versions.map((v) => (
              <figure key={String(v.version)} className="text-center text-[10px]">
                <Thumb url={v.urls.thumb || v.urls.original} alt={`v${v.version}`} />
                <figcaption>v{shown(v.version)} · {v.review || '—'}</figcaption>
              </figure>
            ))}
          </div>
          {done && <Notice tone="good">{done}</Notice>}
          {can('admin') && (
            <div className="flex flex-wrap gap-2">
              {pending && <button className="btn btn-sm btn-primary" onClick={() => { setDone(''); setAct('approve'); }}>{tx('تأیید و انتشار', 'Approve & publish', 'تایید او خپرول')}</button>}
              {pending && <button className="btn btn-sm btn-danger" onClick={() => { setDone(''); setAct('reject'); }}>{tx('رد', 'Reject', 'رد')}</button>}
              {central && <button className="btn btn-sm" onClick={() => { setDone(''); setAct(d.searchEnabled ? 'search-off' : 'search-on'); }}>
                {d.searchEnabled ? tx('خاموش در جست‌وجو', 'Hide from search', 'له لټون پټول') : tx('روشن در جست‌وجو', 'Show in search', 'په لټون کې ښودل')}</button>}
              {central && <button className="btn btn-sm btn-danger" onClick={() => { setDone(''); setAct('archive'); }}>{tx('بایگانی', 'Archive', 'آرشیف')}</button>}
            </div>
          )}
          <SourceLine source="/api/admin/image-bank/images/:id" data={load.data} at={load.at} />
        </div>
      )}
      {act && d && (
        <SensitiveDialog
          danger={act === 'reject' || act === 'archive'}
          title={tx('بازبینیِ بانکِ عکس', 'Image-bank moderation', 'د انځور بانک کتنه')}
          effect={effect[act]}
          onClose={() => setAct(null)}
          onUnknown={() => { void load.reload(); }}
          onSubmit={async ({ reason, idempotencyKey }) => {
            const path = act.startsWith('search') ? 'search' : act;
            const body: Record<string, unknown> = { reason, confirm: true, idempotencyKey };
            if (act === 'search-on' || act === 'search-off') body.enabled = act === 'search-on';
            if ((act === 'approve') && d.currentVersion) body.version = d.currentVersion;
            await api(`${IB}/images/${encodeURIComponent(d.id)}/${path}`, { body });
            setAct(null);
            setDone(tx('تأییدشده از سرورِ حساب', 'Confirmed by the account server', 'د حساب سرور تایید'));
            await load.reload();
          }}
        />
      )}
    </Card>
  );
}

function ReviewList({ onOpen }: { onOpen: (id: string) => void }) {
  const tx = useTx();
  const [status, setStatus] = useState('NEEDS_REVIEW');
  const [space, setSpace] = useState('pending');
  const [cursor, setCursor] = useState('');
  const load = useLoad<{ items: ReviewItem[]; nextCursor: string | null }>(
    `${IB}/review?status=${status}&space=${space}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, [status, space, cursor]);
  const items = Array.isArray(load.data?.items) ? load.data!.items : [];
  return (
    <div className="space-y-2" data-card="bank-review">
      <div className="flex flex-wrap gap-2 text-xs">
        <select className="input" aria-label={tx('وضعیت', 'Status', 'حالت')} value={status} onChange={(e) => { setCursor(''); setStatus(e.target.value); }}>
          {['NEEDS_REVIEW', 'DRAFT', 'APPROVED', 'REJECTED', 'ARCHIVED'].map((s) => <option key={s} value={s}>{statusLabel(tx, s)}</option>)}
        </select>
        <select className="input" aria-label={tx('فضا', 'Space', 'ځای')} value={space} onChange={(e) => { setCursor(''); setSpace(e.target.value); }}>
          <option value="pending">{tx('در انتظار (pending)', 'Pending', 'په تمه')}</option>
          <option value="central">{tx('مرکزی (central)', 'Central', 'مرکزي')}</option>
        </select>
      </div>
      {load.error ? <Problem load={load as Load<unknown>} /> : !load.data ? <Loading /> : items.length === 0
        ? <StateEmpty>{tx('در این صف عکسی نیست', 'No images in this queue', 'په دې کتار کې انځور نشته')}</StateEmpty> : (
          <Table head={['', tx('عکس', 'Image', 'انځور'), tx('کالا', 'Product', 'توکی'), tx('تطبیق', 'Match', 'سمون'), tx('مجوز', 'Licence', 'جواز'),
            tx('نشان', 'Flags', 'نښې'), tx('کِی', 'When', 'کله')]}>
            {items.map((i) => (
              <Row key={i.id}>
                <Cell><Thumb url={i.file?.url} alt={i.id} /></Cell>
                <Cell><button className="underline" data-image={i.id} onClick={() => onOpen(i.id)}><code dir="ltr">{i.id}</code></button>
                  {i.fromShop ? ` · ${tx('از دکان', 'from a shop', 'له هټۍ')}` : ''}{i.versionsPending ? ` · ${tx('{n} نسخهٔ تازه', '{n} new versions', '{n} نوې نسخې', { n: shown(i.versionsPending) })}` : ''}</Cell>
                <Cell>{i.product ? i.product.name : (i.candidates.length ? tx('{n} گزینهٔ مبهم', '{n} ambiguous candidates', '{n} مبهم انتخابونه', { n: shown(i.candidates.length) }) : '—')}</Cell>
                <Cell mono>{i.matchStatus || '—'}</Cell>
                <Cell mono>{i.license?.status || '—'}</Cell>
                <Cell mono>{[...i.qualityFlags, ...(i.duplicateOf.length ? ['duplicate'] : [])].join(', ') || '—'}</Cell>
                <Cell>{fmtTime(i.createdAt)}</Cell>
              </Row>
            ))}
          </Table>
        )}
      {load.data?.nextCursor && <button className="btn btn-sm" onClick={() => setCursor(load.data!.nextCursor || '')}>{tx('صفحهٔ بعد', 'Next page', 'بل مخ')}</button>}
      <SourceLine source="/api/admin/image-bank/review" data={load.data} at={load.at} />
    </div>
  );
}

function SearchBox({ onOpen }: { onOpen: (id: string) => void }) {
  const tx = useTx();
  const [q, setQ] = useState('');
  const [sent, setSent] = useState('');
  const load = useLoad<{ items: SearchItem[] }>(sent ? `${IB}/search?q=${encodeURIComponent(sent)}` : null, [sent]);
  const items = Array.isArray(load.data?.items) ? load.data!.items : [];
  const submit = (e: FormEvent) => { e.preventDefault(); setSent(q.trim().slice(0, 100)); };
  return (
    <div className="space-y-2" data-card="bank-search">
      <form className="flex gap-2" onSubmit={submit}>
        <input className="input flex-1" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)}
               placeholder={tx('نام، بارکد یا SKU', 'Name, barcode or SKU', 'نوم، بارکوډ یا SKU')} aria-label={tx('جست‌وجو در بانک', 'Search the bank', 'په بانک کې لټون')} />
        <button className="btn btn-sm" type="submit">{tx('جست‌وجو', 'Search', 'لټون')}</button>
      </form>
      {!sent ? null : load.error ? <Problem load={load as Load<unknown>} /> : !load.data ? <Loading /> : items.length === 0
        ? <StateEmpty>{tx('چیزی پیدا نشد', 'Nothing found', 'هېڅ ونه موندل شو')}</StateEmpty> : (
          <Table head={[tx('کالا', 'Product', 'توکی'), tx('تطبیق', 'Match', 'سمون'), tx('عکس‌ها', 'Images', 'انځورونه')]}>
            {items.map((it, k) => (
              <Row key={it.product?.id || k}>
                <Cell>{it.product?.name || '—'} {it.product?.gtin && <code dir="ltr" className="text-[10px]">{it.product.gtin}</code>}
                  {it.ambiguous ? ` · ${tx('مبهم', 'ambiguous', 'مبهم')}` : ''}</Cell>
                <Cell mono>{it.match?.kind || '—'}{it.match?.certain ? ' ✓' : ''}</Cell>
                <Cell><div className="flex gap-1">{it.images.map((im) => (
                  <button key={im.id} onClick={() => onOpen(im.id)} title={`${im.id} · ${im.status}`}><Thumb url={im.urls.thumb || im.urls.original} alt={im.id} /></button>
                ))}</div></Cell>
              </Row>
            ))}
          </Table>
        )}
    </div>
  );
}

function Reports() {
  const tx = useTx();
  const load = useLoad<{ items: { id: string; imageId: string; kind: string; note: string; createdAt: number | null }[] }>(`${IB}/reports?status=open`);
  const items = Array.isArray(load.data?.items) ? load.data!.items : [];
  return load.error ? <Problem load={load as Load<unknown>} /> : !load.data ? <Loading /> : items.length === 0
    ? <StateEmpty>{tx('گزارشِ بازی نیست', 'No open reports', 'پرانیستي راپورونه نشته')}</StateEmpty> : (
      <Table head={[tx('عکس', 'Image', 'انځور'), tx('نوع', 'Kind', 'ډول'), tx('یادداشت', 'Note', 'یادښت'), tx('کِی', 'When', 'کله')]}>
        {items.map((r) => (
          <Row key={r.id}><Cell mono>{r.imageId}</Cell><Cell mono>{r.kind}</Cell><Cell>{r.note || '—'}</Cell><Cell>{fmtTime(r.createdAt)}</Cell></Row>
        ))}
      </Table>
    );
}

export default function ImageBankModule() {
  const tx = useTx();
  const status = useLoad<{ enabled: boolean }>(`${IB}/status`);
  const [open, setOpen] = useState('');
  return (
    <div className="space-y-4" data-module="imagebank">
      <Card title={tx('بانکِ عکسِ مرکزی', 'Central image bank', 'مرکزي انځور بانک')} icon={<Images size={16} />}>
        {status.error ? <Problem load={status as Load<unknown>} /> : !status.data ? <Loading /> : !status.data.enabled ? (
          <Notice tone="warn">
            {tx('بانکِ مرکزیِ عکس روشن نیست — پرچمِ «image_bank.central» در سرورِ حساب خاموش است (از «تنظیماتِ مرکزی و پرچم‌ها»).',
              'The central image bank is off — the “image_bank.central” flag is off on the account server (see “Central settings & flags”).',
              'مرکزي انځور بانک بند دی — د حساب په سرور کې «image_bank.central» بیرغ بند دی («مرکزي تنظیمات او بیرغونه» وګورئ).')}
          </Notice>
        ) : (
          <div className="space-y-4">
            <ReviewList onOpen={setOpen} />
            <div><p className="mb-1 text-xs font-semibold">{tx('جست‌وجو در بانک', 'Search the bank', 'په بانک کې لټون')}</p><SearchBox onOpen={setOpen} /></div>
            <div><p className="mb-1 text-xs font-semibold">{tx('گزارش‌های باز', 'Open reports', 'پرانیستي راپورونه')}</p><Reports /></div>
          </div>
        )}
        <SourceLine source="/api/admin/image-bank/status" data={status.data} at={status.at} />
      </Card>
      {open && <ImageDetail key={open} id={open} onClose={() => setOpen('')} />}
    </div>
  );
}
