// ---------------------------------------------------------------------------
//  ✉️ مصرف و هزینهٔ پیامِ مشتری برای هر دکان و هر کانال (OPS-09) — فقط خواندن (۱.۵۰.۸۰، S11 «هم‌ترازی با ‎/admin/‎»)
//
//  ⛔ همه از `GET /console/system/notify-usage?days=` ⇐ همان گزارشِ سرورِ حساب (‎lib/notify-usage.js‎)؛ هیچ جمعی این‌جا زده نمی‌شود،
//     نیامده ⇒ «—». هزینهٔ کانال‌ها میکرودلار است و فقط برای نمایش به دلار برگردانده می‌شود؛ پیامکِ کدها واحدِ خُردِ خودش را دارد.
//  ⛔ هیچ شماره و متنی نیست (پل هم بسته است). نامِ دکان متن است.
// ---------------------------------------------------------------------------
import { useState, type ReactNode } from 'react';
import { MessageSquareWarning } from 'lucide-react';

import { Card } from '../../../components/ui';
import { Cell, KV, Notice, Row, Table } from '../../../control/ui';
import { useLoad, type Load } from '../shared';
import { Problem, SourceLine } from '../ShopConsole';
import { num, shown } from '../consoleData';
import { StateEmpty, StateLoading } from './parts';
import { useTx, type Tx } from './text';

type Ch = { sent: number | null; costMicros: number | null; last24hMicros: number | null };
type Shop = { shopId: string; name: string; sent: number | null; costMicros: number | null; byChannel: Record<string, Ch>;
  costCap: number | null; rateLimited: number | null; nearCap: string[] };
type Counts = { attempts: number | null; sent: number | null; failed: number | null; mock: number | null; other: number | null; parts: number | null; costMinor: number | null };
type Doc = {
  days: number | null; since: number | null; checkedAt: number | null; fetchedAt?: number;
  channels: { channel: string; unitMicros: number | null; capMicros: number | null }[];
  totals: { sent: number | null; costMicros: number | null; costCap: number | null; rateLimited: number | null; shops: number | null };
  shops: Shop[]; shopsTruncated: boolean; truncated: boolean;
  codes: { currency: string; unitCostMinor: number | null; total: Counts; byPurpose: (Counts & { purpose: string; shop: boolean })[] };
};

export const notifyUsageApi = (days: number) => `/api/account-admin/console/system/notify-usage?days=${days}`;
const DAYS = [1, 7, 31];

/** میکرودلار ⇒ «۰٫۸۹ $»؛ نیامده ⇒ «—» (فقط نمایش) */
const usd = (micros: unknown) => { const n = num(micros); return n === null ? '—' : `${(n / 1e6).toLocaleString('fa-AF', { maximumFractionDigits: 2 })} $`; };
function chName(tx: Tx, c: string) {
  switch (c) {
    case 'sms': return tx('پیامک', 'SMS', 'پیغام');
    case 'whatsapp': return tx('واتس‌اپ', 'WhatsApp', 'واټس‌اپ');
    case 'telegram': return tx('تلگرام', 'Telegram', 'ټلګرام');
    case 'push': return tx('اعلانِ برنامه', 'Push', 'پوش');
    default: return c;
  }
}

export default function NotifyUsageCard() {
  const tx = useTx();
  const [days, setDays] = useState(7);
  const load = useLoad<Doc>(notifyUsageApi(days), [days]);
  const title = tx('مصرف و هزینهٔ پیامِ مشتری', 'Customer message usage & cost', 'د پېرودونکي پیغامونو لګښت');
  const wrap = (body: ReactNode) => (
    <div data-card="notify-usage">
      <Card title={title} icon={<MessageSquareWarning size={15} />}
            action={(
              <select className="input input-sm" aria-label={tx('بازه', 'Range', 'موده')} value={days} data-usage-days onChange={(e) => setDays(Number(e.target.value))}>
                {DAYS.map((d) => <option key={d} value={d}>{d === 1 ? tx('۲۴ ساعتِ گذشته', 'Last 24 hours', 'تېر ۲۴ ساعته') : tx('{n} روزِ گذشته', 'Last {n} days', 'تېرې {n} ورځې', { n: shown(d) })}</option>)}
              </select>
            )}>
        {body}
      </Card>
    </div>
  );
  if (load.error) return wrap(<Problem load={load as Load<unknown>} />);
  if (!load.data) return wrap(<StateLoading />);
  const d = load.data;
  const t = d.totals || ({} as Doc['totals']);
  const paid = (d.channels || []).filter((c) => (num(c.unitMicros) ?? 0) > 0);
  const shops = Array.isArray(d.shops) ? d.shops : [];
  const codes = d.codes;
  return wrap(
    <>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <KV label={tx('پیامِ رفته', 'Messages sent', 'لېږل شوي')}>{shown(t.sent)}</KV>
        <KV label={tx('هزینه', 'Cost', 'لګښت')}><span dir="ltr">{usd(t.costMicros)}</span></KV>
        <KV label={tx('ردشده با سقفِ هزینهٔ دکان', 'Blocked by shop cost cap', 'د لګښت حد')}>{shown(t.costCap)}</KV>
        <KV label={tx('نگه‌داشته با سقفِ هر مشتری', 'Held by per-customer limit', 'د پېرودونکي حد')}>{shown(t.rateLimited)}</KV>
      </div>
      {paid.length > 0 && (
        <p className="mt-1 text-[11px] text-ink-muted">
          {paid.map((c) => tx('{ch}: {u} هر پیام، سقفِ روزانهٔ هر دکان {cap}', '{ch}: {u} per message, daily cap per shop {cap}', '{ch}: {u} هر پیغام، ورځنی حد {cap}',
            { ch: chName(tx, c.channel), u: usd(c.unitMicros), cap: usd(c.capMicros) })).join(' · ')}
        </p>
      )}
      {((num(t.costCap) ?? 0) > 0 || (num(t.rateLimited) ?? 0) > 0) && (
        <Notice tone="warn">{tx('پیامِ ردشده با سقف نشانهٔ احتمالیِ سوءاستفاده است — دکانِ پرشمار را ببینید.', 'Messages blocked by a cap are a possible sign of abuse — check the busiest shop.', 'د حد له امله رد شوي پیغامونه د ناوړه ګټې نښه کېدای شي.')}</Notice>
      )}
      {d.shopsTruncated && <p className="text-[11px] text-ink-muted">{tx('فقط پرهزینه‌ترین دکان‌ها ({n} از {all})', 'Only the costliest shops ({n} of {all})', 'یوازې ګرانې هټۍ ({n} له {all})', { n: shown(shops.length), all: shown(t.shops) })}</p>}
      {d.truncated && <p className="text-[11px] text-ink-muted" data-usage-truncated>{tx('شمارش در سرورِ حساب بریده شد (تازه‌ترین ردیف‌ها شمرده شدند)', 'The count was cut on the account server (newest rows counted)', 'شمېرنه پرې شوه')}</p>}
      {shops.length === 0 ? <StateEmpty>{tx('در این بازه پیامی به مشتری نرفته و هیچ پیامی با سقف رد نشده است', 'No customer message was sent or blocked in this range', 'په دې موده کې هېڅ پیغام نه دی تللی')}</StateEmpty> : (
        <Table head={[tx('دکان', 'Shop', 'هټۍ'), tx('پیام', 'Sent', 'پیغام'), tx('هزینه', 'Cost', 'لګښت'), tx('هر کانال', 'Per channel', 'هر چینل'),
          tx('سقفِ هزینه', 'Cost cap', 'د لګښت حد'), tx('سقفِ مشتری', 'Customer limit', 'د پېرودونکي حد'), tx('هشدار', 'Warning', 'خبرتیا')]}>
          {shops.map((s) => {
            const parts = Object.entries(s.byChannel || {}).filter(([, c]) => (num(c.sent) ?? 0) > 0)
              .map(([ch, c]) => `${chName(tx, ch)} ${shown(c.sent)}${(num(c.costMicros) ?? 0) > 0 ? ` (${usd(c.costMicros)})` : ''}`);
            return (
              <Row key={s.shopId}>
                <Cell><span data-usage-shop>{s.name || s.shopId}</span></Cell>
                <Cell>{shown(s.sent)}</Cell>
                <Cell mono><span dir="ltr">{usd(s.costMicros)}</span></Cell>
                <Cell>{parts.join(' · ') || '—'}</Cell>
                <Cell>{shown(s.costCap)}</Cell>
                <Cell>{shown(s.rateLimited)}</Cell>
                <Cell>
                  {s.nearCap?.length ? <span style={{ color: 'var(--status-warning)' }}>{tx('نزدیکِ سقفِ {c}', 'Near the {c} cap', 'حد ته نږدې: {c}', { c: s.nearCap.map((c) => chName(tx, c)).join('، ') })}</span>
                    : (num(s.costCap) ?? 0) > 0 || (num(s.rateLimited) ?? 0) > 0 ? tx('پیامِ ردشده دارد', 'Has blocked messages', 'رد شوي پیغامونه لري') : tx('عادی', 'Normal', 'عادي')}
                </Cell>
              </Row>
            );
          })}
        </Table>
      )}
      {codes && (
        <div className="mt-3" data-usage-codes>
          <h3 className="mb-1 text-xs font-semibold">{tx('پیامکِ کدها (ورود، ثبت‌نام، ویترین)', 'Code SMS (login, sign-up, storefront)', 'د کوډونو پیغام')}</h3>
          <KV label={tx('رفته / ناموفق / آزمایشی', 'Sent / failed / mock', 'لېږل / ناکام / ازمایښتي')}>{shown(codes.total?.sent)} / {shown(codes.total?.failed)} / {shown(codes.total?.mock)}</KV>
          <KV label={tx('هزینه (واحدِ خُرد)', 'Cost (minor units)', 'لګښت (کوچنی واحد)')}><span dir="ltr">{shown(codes.total?.costMinor)} {codes.currency || ''}</span></KV>
        </div>
      )}
      <SourceLine source="/api/admin/system/notify-usage" data={d} at={load.at} />
    </>,
  );
}
