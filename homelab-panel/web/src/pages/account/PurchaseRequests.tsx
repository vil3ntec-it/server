// ---------------------------------------------------------------------------
//  🧾 درخواست‌های خرید — «مشتری گفت می‌خواهم بخرم»
//
//  ⛔ این هم در ۱.۴۱.۰ با دفترِ قدیمی رفت و در پل نوشته نشد. یعنی مشتری از
//     داخلِ برنامه درخواستِ خرید می‌زد، ردیفش روی سرورِ حساب می‌نشست، و
//     **هیچ‌کس در پنل نمی‌دیدش**. بدترین شکلِ خرابی: نه خطایی، نه پیامی.
//
//  ⚠️ «تایید» یک اشتراکِ واقعی می‌دهد — پس پنجرهٔ تایید پیامدش را می‌گوید،
//     نه «مطمئنید؟».
//  ⚠️ مدت از خودِ پلن می‌آید مگر عددی بنویسید؛ خالی گذاشتنش درست‌ترین کار
//     است، چون پلن خودش می‌داند چند روز است.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { ShoppingCart } from 'lucide-react';

import { api } from '../../api';
import { Badge, Card, Empty, Modal, Skeleton, toast } from '../../components/ui';
import { ActionButton, Cell, Notice, Row, Table } from '../../control/ui';
import { CloudProblem, PageHead, fa, moment, useLoad } from './shared';

type PurchaseRequest = {
  id: string;
  shop_id: string;
  user_id: string;
  plan_code: string;
  note: string;
  status: string;
  created_at: number | string;
  shop_name: string;
  user_name: string;
  phone: string;
};

const TABS: { id: string; label: string }[] = [
  { id: 'pending', label: 'در انتظار' },
  { id: 'approved', label: 'تاییدشده' },
  { id: 'rejected', label: 'ردشده' },
];

export default function PurchaseRequests() {
  const [status, setStatus] = useState('pending');
  const [approve, setApprove] = useState<PurchaseRequest | null>(null);

  const list = useLoad<{ requests: PurchaseRequest[] }>(
    `/api/account-admin/purchase-requests?status=${status}`, [status]);

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="درخواست‌های خرید"
        sub="درخواست‌هایی که مشتری از داخلِ برنامه فرستاده — تایید یعنی اشتراکِ واقعی"
        actions={
          <div className="flex gap-1">
            {TABS.map((tb) => (
              <button
                key={tb.id}
                className={`rounded-lg px-2.5 py-1.5 text-xs ${status === tb.id ? 'font-semibold' : 'text-ink-soft hover:bg-surface-raised'}`}
                style={status === tb.id ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : undefined}
                onClick={() => setStatus(tb.id)}
              >
                {tb.label}
              </button>
            ))}
          </div>
        }
      />

      {list.error && <CloudProblem code={list.code} message={list.error} />}

      <Card title="درخواست‌ها" icon={<ShoppingCart className="h-4 w-4" />}>
        {list.busy && !list.data ? (
          <Skeleton rows={4} />
        ) : (list.data?.requests.length || 0) === 0 ? (
          <Empty
            title={status === 'pending' ? 'درخواستی در انتظار نیست' : 'چیزی نیست'}
            hint={status === 'pending' ? 'هر درخواستی که مشتری بفرستد همین‌جا می‌آید.' : ''}
          />
        ) : (
          <Table head={['دکان', 'مشتری', 'پلن', 'یادداشت', 'کِی', 'حال', '']}>
            {(list.data?.requests || []).map((r) => (
              <Row key={r.id}>
                <Cell>{r.shop_name || '—'}</Cell>
                <Cell>{[r.user_name, r.phone].filter(Boolean).join(' · ') || '—'}</Cell>
                <Cell mono>{r.plan_code}</Cell>
                <Cell>{r.note || '—'}</Cell>
                <Cell>{moment(Number(r.created_at))}</Cell>
                <Cell>
                  <Badge tone={r.status === 'pending' ? 'warn' : r.status === 'approved' ? 'good' : 'neutral'}>
                    {TABS.find((t) => t.id === r.status)?.label || r.status}
                  </Badge>
                </Cell>
                <Cell>
                  {r.status === 'pending' && (
                    <div className="flex gap-1">
                      <button className="btn btn-sm btn-primary" onClick={() => setApprove(r)}>تایید</button>
                      <ActionButton
                        className="btn btn-sm btn-danger"
                        busyLabel="…"
                        onClick={async () => {
                          try {
                            await api(`/api/account-admin/purchase-requests/${r.id}/reject`, { body: {} });
                            toast('رد شد');
                            await list.reload();
                          } catch (e) {
                            toast(e instanceof Error ? e.message : 'نشد', 'bad');
                          }
                        }}
                      >
                        رد
                      </ActionButton>
                    </div>
                  )}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      {approve && (
        <Approve
          req={approve}
          onClose={() => setApprove(null)}
          onDone={async () => { setApprove(null); await list.reload(); }}
        />
      )}
    </div>
  );
}

function Approve({ req, onClose, onDone }: { req: PurchaseRequest; onClose: () => void; onDone: () => Promise<void> }) {
  const [days, setDays] = useState('');

  return (
    <Modal
      open
      onClose={onClose}
      title={`تاییدِ خریدِ «${req.shop_name}»`}
      footer={
        <>
          <button className="btn" onClick={onClose}>انصراف</button>
          <ActionButton
            className="btn btn-primary"
            busyLabel="…"
            onClick={async () => {
              try {
                await api(`/api/account-admin/purchase-requests/${req.id}/approve`, {
                  body: { days: days === '' ? null : Number(days) },
                });
                toast('اشتراک داده شد');
                await onDone();
              } catch (e) {
                toast(e instanceof Error ? e.message : 'نشد', 'bad');
              }
            }}
          >
            تایید و دادنِ اشتراک
          </ActionButton>
        </>
      }
    >
      <Notice tone="warn">
        با تایید، اشتراکِ پلنِ <b>{req.plan_code}</b> همین حالا روی دکانِ «{req.shop_name}» می‌نشیند و
        مشتری همان لحظه بازش می‌بیند. ⛔ این کار برگشت‌پذیر نیست — برای لغو باید از خودِ صفحهٔ مشتری
        اشتراک را معلق کنید.
      </Notice>
      <label className="label">مدت به روز (خالی = از خودِ پلن)</label>
      <input className="input w-full" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
      <p className="mt-2 text-xs text-ink-muted">
        خالی گذاشتنش درست‌ترین کار است: پلن خودش می‌داند چند روز است و «یک ماه یعنی یک ماه»،
        نه سی روز. {days !== '' && `الان ${fa(Number(days))} روز می‌شود.`}
      </p>
    </Modal>
  );
}
