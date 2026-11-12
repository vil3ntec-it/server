// ---------------------------------------------------------------------------
//  🔁 تغییرهای دسته‌ایِ عکسِ یک دکان و برگرداندن — IMG-PRO-17 در پنلِ مرکزی (۱.۵۰.۹۶، ماژولِ «بانکِ عکس»)
//
//  ⛔ همه از ‎/console/shops/:id/images/changes*‎ ⇐ ‎/api/admin/shops/:id/images/changes*‎ ِ سرورِ حساب (‎image-changes.v1‎)؛
//     بی آن ⇒ «سرورِ حساب هنوز این را ندارد» — هیچ دستهٔ ساختگی. دسته را خودِ دکان در برنامه‌اش می‌سازد؛ این‌جا دیدن و برگرداندن.
//  ⛔ برگرداندن فقط admin (مرز در سرور: پل admin، سرورِ حساب ارشد) + `SensitiveDialog` (دلیل + تأیید + یک کلیدِ یکتایی برای همان
//     پنجره)؛ سرورِ حساب **اجازهٔ زندهٔ «بازگرداندن»** ِ همین آدم روی همین دکان را می‌خواهد (کارتِ «دسترسیِ پشتیبانی» در پروندهٔ دکان).
//  ⛔ ‎409 changed_since‎ ⇒ هیچ چیز برنگشت؛ پیام نامِ کالاهایی را که پس از دسته دوباره عوض شده‌اند می‌گوید (اول دستهٔ تازه‌تر).
//  ⛔ شناسهٔ کالا و یادداشت فقط متن‌اند (React خودش گریز می‌دهد؛ هیچ HTML ِ خامی ساخته نمی‌شود).
// ---------------------------------------------------------------------------
import { useState, type FormEvent, type ReactNode } from 'react';
import { History } from 'lucide-react';

import { api } from '../../../api';
import { Card, Loading } from '../../../components/ui';
import { useApp } from '../../../app-context';
import { Cell, Notice, Row, Table } from '../../../control/ui';
import { useLoad, type Load } from '../shared';
import { Problem, SourceLine } from '../ShopConsole';
import { isUnavailable, shown, type Unavailable } from '../consoleData';
import { NotSupported, SensitiveDialog, StateEmpty, fmtTime, type SensitiveSubmit } from './parts';
import { useTx, type Tx } from './text';

const BASE = '/api/account-admin/console/shops';
const SHOP_RE = /^[A-Za-z0-9_-]{1,80}$/;

type Sel = { source: string; imageId: string; version: number | null; matchStatus: string; centralImageId: string; centralVersion: number | null } | null;
type Change = {
  id: string; note: string; status: string; itemCount: number; createdBy: string; createdAt: number | null;
  rolledBackBy: string; rolledBackAt: number | null; rollbackReason: string; items?: { productId: string; before: Sel; after: Sel }[];
};
type ListDoc = { available: true; shopId: string; enabled: boolean; changes: Change[]; fetchedAt: number };
type DetailDoc = { available: true; shopId: string; change: Change; fetchedAt: number };
type Done = { ok: true; already: boolean; change: Change };

/** شناسهٔ دکانِ واردشده ⇒ همان، یا '' (فقط حرف/رقم/خطِ تیره، همان قاعدهٔ پل) */
export const shopIdOf = (s: string) => (SHOP_RE.test(s.trim()) ? s.trim() : '');

const statusLabel = (tx: Tx, s: string) => (s === 'rolled_back' ? tx('برگشته', 'Rolled back', 'بېرته شوی') : s === 'applied' ? tx('اعمال‌شده', 'Applied', 'پلی شوی') : s || '—');

/** وضعِ عکسِ یک کالا به زبانِ آدم: «بی ردیف» = عکسِ همگام‌شدهٔ خودِ کالا یا بی عکس */
function selText(tx: Tx, s: Sel): string {
  if (!s) return tx('عکسِ پیش‌فرضِ کالا (بی انتخاب)', 'Product default (no selection)', 'د توکي اصلي انځور');
  if (s.source === 'none') return tx('بی عکس', 'No image', 'بې انځوره');
  if (s.source === 'central') return `${tx('مرکزی', 'Central', 'مرکزي')} ${s.centralImageId || s.imageId}${s.centralVersion ? ` v${s.centralVersion}` : ''}`;
  return `${s.source === 'shop' ? tx('خودِ دکان', 'Shop', 'هټۍ') : s.source} ${s.imageId}${s.version ? ` v${s.version}` : ''}`;
}

function Detail({ shop, id, onClose, onChanged }: { shop: string; id: string; onClose: () => void; onChanged: () => void }) {
  const tx = useTx();
  const { can } = useApp();
  const load = useLoad<DetailDoc | Unavailable>(`${BASE}/${shop}/images/changes/${id}`, [shop, id]);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState('');
  const wrap = (body: ReactNode) => (
    <div className="mt-3 rounded border border-line p-3" data-change-detail={id}>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold">{tx('دسته', 'Batch', 'ډله')} <code dir="ltr">{id}</code></p>
        <button className="btn btn-sm" onClick={onClose}>{tx('بستن', 'Close', 'بندول')}</button>
      </div>
      {body}
    </div>
  );
  if (load.error) return wrap(<Problem load={load as Load<unknown>} />);
  if (!load.data) return wrap(<Loading />);
  if (isUnavailable(load.data)) return wrap(<NotSupported needs={load.data.needs}>{tx('سرورِ حساب هنوز این را ندارد.', 'The account server does not have this yet.', 'د حساب سرور دا لا نه لري.')}</NotSupported>);
  const c = load.data.change;
  const items = Array.isArray(c.items) ? c.items : [];
  const submit = async (x: SensitiveSubmit) => {
    const out = await api<Done>(`${BASE}/${shop}/images/changes/${id}/rollback`, { method: 'POST', body: { ...x, confirm: true } });
    setDone(out.already
      ? tx('این دسته از پیش برگشته بود — چیزی عوض نشد', 'This batch was already rolled back — nothing changed', 'دا ډله له مخکې بېرته شوې وه')
      : tx('تأییدشده از سرورِ حساب: {n} کالا به عکسِ پیش از دسته برگشت', 'Confirmed by the account server: {n} products back to their earlier image', 'د حساب سرور تایید: {n} توکي بېرته شول',
        { n: shown(Array.isArray(out.change?.items) ? out.change.items.length : 0) }));
    setOpen(false);
    await load.reload();
    onChanged();
  };
  return wrap(
    <>
      {done && <div data-change-done><Notice tone="good">{done}</Notice></div>}
      <p className="mb-2 text-xs">
        {statusLabel(tx, c.status)} · {fmtTime(c.createdAt)}{c.note ? ` · ${c.note}` : ''}
        {c.status === 'rolled_back' && <> · {tx('برگرداند', 'by', 'لخوا')} <span dir="ltr">{c.rolledBackBy || '—'}</span> {fmtTime(c.rolledBackAt)}{c.rollbackReason ? ` — ${c.rollbackReason}` : ''}</>}
      </p>
      <Table head={[tx('کالا', 'Product', 'توکی'), tx('پیش از دسته', 'Before', 'مخکې'), tx('پس از دسته', 'After', 'وروسته')]} empty={items.length === 0}>
        {items.map((it) => (
          <Row key={it.productId}>
            <Cell mono><span dir="ltr" data-change-product>{it.productId}</span></Cell>
            <Cell>{selText(tx, it.before)}</Cell>
            <Cell>{selText(tx, it.after)}</Cell>
          </Row>
        ))}
      </Table>
      {c.status === 'applied' && can('admin') && (
        <button className="btn btn-sm btn-danger mt-2" data-change-rollback onClick={() => { setDone(''); setOpen(true); }}>
          {tx('برگرداندنِ همهٔ این دسته…', 'Roll back this whole batch…', 'ټوله ډله بېرته کول…')}
        </button>
      )}
      {c.status === 'applied' && !can('admin') && (
        <Notice>{tx('فقط مدیرِ پنل دسته را برمی‌گرداند (سرورِ حساب هم فقط مدیرِ ارشد را می‌پذیرد).', 'Only panel admins roll back a batch (the account server accepts super admins only).', 'یوازې د پینل مدیر ډله بېرته کوي.')}</Notice>
      )}
      <SourceLine source="/api/admin/shops/:id/images/changes/:cid" data={load.data} at={load.at} />
      {open && (
        <SensitiveDialog title={tx('برگرداندنِ دستهٔ عکس', 'Roll back an image batch', 'د انځور ډله بېرته کول')} danger onClose={() => setOpen(false)} onSubmit={submit}
                         onUnknown={() => { void load.reload(); }}
                         effect={tx('هر {n} کالای این دسته دقیقاً به عکسِ پیش از همین دسته برمی‌گردد — یا هیچ‌کدام، اگر کالایی پس از آن دوباره عوض شده باشد. سرورِ حساب اجازهٔ زندهٔ «بازگرداندن» (کارتِ «دسترسیِ پشتیبانی» ِ همین دکان) را می‌خواهد و صاحبِ دکان در سابقه‌اش می‌بیند.',
                           'All {n} products of this batch go back to exactly the image they had before it — or none, if any was changed again since. The account server needs a live “Restore” support grant for this shop (the “Support access” card) and the shop owner sees it in their history.',
                           'د دې ډلې ټول {n} توکي بېرته مخکیني انځور ته ځي — یا هېڅ یو، که وروسته بدل شوي وي. د حساب سرور د «بېرته راوستل» ژوندۍ اجازه غواړي.',
                           { n: shown(items.length) })} />
      )}
    </>,
  );
}

export default function ImageChangesCard() {
  const tx = useTx();
  const [typed, setTyped] = useState('');
  const [shop, setShop] = useState('');
  const [open, setOpen] = useState('');
  const load = useLoad<ListDoc | Unavailable>(shop ? `${BASE}/${shop}/images/changes` : null, [shop]);
  const submit = (e: FormEvent) => { e.preventDefault(); setOpen(''); setShop(shopIdOf(typed)); };
  const bad = typed.trim() !== '' && !shopIdOf(typed);
  const d = load.data;
  let body: ReactNode = null;
  if (!shop) body = <StateEmpty>{tx('شناسهٔ دکان را بنویسید (از پروندهٔ دکان در «فروشگاه‌ها»).', 'Enter a shop ID (from the shop’s page under “Shops”).', 'د هټۍ پېژند ولیکئ.')}</StateEmpty>;
  else if (load.error) body = <Problem load={load as Load<unknown>} />;
  else if (!d) body = <Loading />;
  else if (isUnavailable(d)) {
    body = (
      <NotSupported needs={d.needs}>
        <span data-changes-old>{tx('سرورِ حساب کهنه است: «تغییرهای دسته‌ایِ عکس» (image-changes.v1) را ندارد — تا به‌روز شدنش این‌جا هیچ دسته‌ای نشان داده نمی‌شود.',
          'The account server is too old: it has no image batch changes (image-changes.v1) — no batch is shown until it is updated.',
          'د حساب سرور زوړ دی: (image-changes.v1) نه لري.')}</span>
      </NotSupported>
    );
  } else if (!d.enabled) {
    body = <div data-changes-off><Notice tone="warn">{tx('بانکِ عکس برای این دکان روشن نیست (پرچمِ shop.image_bank) — دسته‌ای نیست.', 'The image bank is off for this shop (shop.image_bank flag) — no batches.', 'د دې هټۍ لپاره انځور بانک بند دی.')}</Notice></div>;
  } else if (d.changes.length === 0) {
    body = <StateEmpty>{tx('این دکان هنوز تغییرِ دسته‌ای نکرده است', 'This shop has made no batch changes yet', 'دې هټۍ لا ډله‌ییز بدلون نه دی کړی')}</StateEmpty>;
  } else {
    body = (
      <Table head={[tx('کِی', 'When', 'کله'), tx('یادداشت', 'Note', 'یادښت'), tx('کالا', 'Products', 'توکي'), tx('وضع', 'Status', 'حالت'), '']}>
        {d.changes.map((c) => (
          <Row key={c.id}>
            <Cell>{fmtTime(c.createdAt)}</Cell>
            <Cell>{c.note || '—'}</Cell>
            <Cell>{shown(c.itemCount)}</Cell>
            <Cell><span data-change-status={c.status}>{statusLabel(tx, c.status)}</span></Cell>
            <Cell><button className="btn btn-sm" data-change-open={c.id} onClick={() => setOpen(c.id)}>{tx('جزئیات', 'Details', 'جزییات')}</button></Cell>
          </Row>
        ))}
      </Table>
    );
  }
  return (
    <div data-card="image-changes">
      <Card title={tx('تغییرهای دسته‌ایِ عکسِ یک دکان و برگرداندن', 'A shop’s image batch changes & rollback', 'د یوې هټۍ ډله‌ییز انځور بدلونونه')} icon={<History size={16} />}>
        <form className="mb-3 flex flex-wrap gap-2" onSubmit={submit}>
          <input className="input w-56 font-mono" dir="ltr" value={typed} maxLength={80} onChange={(e) => setTyped(e.target.value)}
                 placeholder="shp_…" aria-label={tx('شناسهٔ دکان', 'Shop ID', 'د هټۍ پېژند')} data-changes-shop />
          <button className="btn btn-sm" type="submit" disabled={!shopIdOf(typed)}>{tx('نشان بده', 'Show', 'ښکاره کړه')}</button>
          {bad && <span className="text-[11px]" style={{ color: 'var(--status-warning)' }}>{tx('فقط حرف، رقم، _ و -', 'Letters, digits, _ and - only', 'یوازې توري، شمېرې، _ او -')}</span>}
        </form>
        {body}
        {shop && open && <Detail key={`${shop}/${open}`} shop={shop} id={open} onClose={() => setOpen('')} onChanged={() => { void load.reload(); }} />}
        {shop && <SourceLine source="/api/admin/shops/:id/images/changes" data={d} at={load.at} />}
      </Card>
    </div>
  );
}
