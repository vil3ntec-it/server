// ---------------------------------------------------------------------------
//  🏷️ تخفیف‌ها و کمپین — بندِ ۱۱.۳.۲ و سناریوهای ۱۰ و ۱۱
//
//  ⛔ کلیدِ یکتای کدِ تخفیف `(app, code)` است: همان رشته در دکان و پمپ دو
//     کدِ جدا با دو ارزِ جداست. پس بخش همیشه همراهِ کد می‌رود و «هر دو»
//     این‌جا معنی ندارد — مگر در کمپین، که خودِ سرور دو کد می‌سازد.
//  ⛔ هیچ عددِ قیمتی این‌جا نیست؛ مقدارِ تخفیف را مدیر می‌نویسد و سنجشش
//     («این کد روی این پلن چقدر می‌شود؟») کارِ خودِ سرورِ حساب است.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { Megaphone, Ticket } from 'lucide-react';

import { api } from '../../api';
import { Badge, Card, ConfirmDialog, Empty, Modal, Skeleton, toast } from '../../components/ui';
import { ActionButton, Cell, KV, Notice, Row, Table } from '../../control/ui';
import { APP_LABEL, AppPicker, CloudProblem, PageHead, day, fa, fromLocalInput, moment, useLoad, type AppId, type Scope } from './shared';
import type { Campaign, CampaignStats, DiscountCode } from './types';

export default function Discounts() {
  const [app, setApp] = useState<Scope>('both');
  const [newCode, setNewCode] = useState(false);
  const [newCampaign, setNewCampaign] = useState(false);
  const [revoke, setRevoke] = useState<DiscountCode | null>(null);
  const [stats, setStats] = useState<CampaignStats | null>(null);

  const codes = useLoad<{ codes: DiscountCode[] }>(
    `/api/account-admin/discount-codes${app === 'both' ? '' : `?app=${app}`}`, [app]);
  const campaigns = useLoad<{ campaigns: Campaign[] }>('/api/account-admin/campaigns');

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="تخفیف‌ها و کمپین"
        sub="کدِ تخفیف برای یک برنامه، یک پلن یا یک مشتری — و کمپین که فیلتر، کد و اعلان را یک‌جا انجام می‌دهد"
        actions={
          <>
            <AppPicker value={app} onChange={setApp} withBoth />
            <button className="btn btn-sm btn-primary" onClick={() => setNewCode(true)}>کدِ تازه</button>
            <button className="btn btn-sm" onClick={() => setNewCampaign(true)}>کمپینِ تازه</button>
          </>
        }
      />

      {codes.error && <CloudProblem code={codes.code} message={codes.error} onRetry={codes.reload} />}

      <Card title="کدهای تخفیف" icon={<Ticket className="h-4 w-4" />}>
        {codes.busy && !codes.data ? (
          <Skeleton rows={4} />
        ) : (codes.data?.codes.length || 0) === 0 ? (
          <Empty title="کدی ساخته نشده" hint="«کدِ تازه» را بزنید." />
        ) : (
          <Table head={['کد', 'بخش', 'اندازه', 'محدود به', 'استفاده', 'انقضا', 'حال', '']}>
            {(codes.data?.codes || []).map((c) => (
              <Row key={c.id}>
                <Cell mono>{c.code}</Cell>
                <Cell><Badge tone={c.app === 'pump' ? 'info' : 'neutral'}>{APP_LABEL[c.app]}</Badge></Cell>
                <Cell className="tnum">{c.kind === 'percent' ? `٪${fa(c.value)}` : `${fa(c.value)} ${c.currency}`}</Cell>
                <Cell>{[c.plan ? `پلنِ ${c.plan}` : '', c.userId ? 'یک مشتری' : '', c.oncePerCustomer ? 'یک‌بار برای هر نفر' : ''].filter(Boolean).join(' · ') || 'همه'}</Cell>
                <Cell className="tnum">{fa(c.uses)}{c.maxUses == null ? '' : ` / ${fa(c.maxUses)}`}</Cell>
                <Cell>{c.expiresAt ? day(c.expiresAt) : '—'}</Cell>
                <Cell><Badge tone={c.status === 'active' ? 'good' : 'bad'}>{c.status === 'active' ? 'فعال' : 'باطل'}</Badge></Cell>
                <Cell>
                  {c.status === 'active' && (
                    <button className="btn btn-sm btn-danger" onClick={() => setRevoke(c)}>باطل کن</button>
                  )}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      <Card title="کمپین‌ها" icon={<Megaphone className="h-4 w-4" />}>
        {campaigns.busy && !campaigns.data ? (
          <Skeleton rows={3} />
        ) : (campaigns.data?.campaigns.length || 0) === 0 ? (
          <Empty title="کمپینی ساخته نشده" hint="کمپین یعنی: فیلترِ گیرنده‌ها ⇒ کدِ تخفیف ⇒ اعلان، با یک کلیک." />
        ) : (
          <Table head={['نام', 'بخش', 'حال', 'ساخته شد', '']}>
            {(campaigns.data?.campaigns || []).map((c) => (
              <Row key={c.id}>
                <Cell>{c.name}</Cell>
                <Cell>{c.app === 'both' ? 'هر دو' : APP_LABEL[c.app as AppId] || c.app}</Cell>
                <Cell><Badge tone={c.status === 'active' ? 'good' : 'neutral'}>{c.status}</Badge></Cell>
                <Cell>{moment(c.createdAt)}</Cell>
                <Cell>
                  <ActionButton
                    busyLabel="…"
                    onClick={async () => {
                      try {
                        setStats(await api<CampaignStats>(`/api/account-admin/campaigns/${c.id}/stats`));
                      } catch (e) {
                        toast(e instanceof Error ? e.message : 'نشد', 'bad');
                      }
                    }}
                  >
                    گزارش
                  </ActionButton>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      {newCode && <NewCode onClose={() => setNewCode(false)} onDone={codes.reload} />}
      {newCampaign && <NewCampaign onClose={() => setNewCampaign(false)} onDone={async () => { await campaigns.reload(); await codes.reload(); }} />}

      {stats && (
        <Modal open onClose={() => setStats(null)} title={`گزارشِ کمپینِ «${stats.campaign.name}»`}>
          <div className="grid gap-2 sm:grid-cols-2">
            <KV label="گیرنده">{fa(stats.recipients)}</KV>
            <KV label="فرستاده شد">{fa(stats.sent)}</KV>
            <KV label="دیده شد">{fa(stats.seen)}</KV>
            <KV label="کد خرج شد">{fa(stats.codeUses)}</KV>
            <KV label="تمدید کردند">{fa(stats.renewed)}</KV>
          </div>
          <p className="mt-3 text-xs text-ink-muted">
            کدها: {stats.codes.map((c) => c.code).join(' · ') || '—'}
          </p>
        </Modal>
      )}

      <ConfirmDialog
        open={Boolean(revoke)}
        danger
        title={revoke ? `باطل کردنِ کدِ ${revoke.code}` : ''}
        message="این کد از همان لحظه در هیچ برنامه‌ای پذیرفته نمی‌شود. اشتراک‌هایی که قبلاً با آن خریده شده‌اند دست نمی‌خورند."
        onCancel={() => setRevoke(null)}
        onConfirm={async () => {
          const c = revoke;
          setRevoke(null);
          if (!c) return;
          try {
            await api(`/api/account-admin/discount-codes/${c.id}/revoke`, { body: {} });
            toast('کد باطل شد');
            await codes.reload();
          } catch (e) {
            toast(e instanceof Error ? e.message : 'نشد', 'bad');
          }
        }}
      />
    </div>
  );
}

function NewCode({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [app, setApp] = useState<AppId>('shop');
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('');
  const [plan, setPlan] = useState('');
  const [userId, setUserId] = useState('');
  const [expires, setExpires] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [once, setOnce] = useState(true);
  const [note, setNote] = useState('');

  return (
    <Modal
      open
      onClose={onClose}
      title="کدِ تخفیفِ تازه"
      footer={
        <>
          <button className="btn" onClick={onClose}>انصراف</button>
          <ActionButton
            className="btn btn-primary"
            busyLabel="…"
            onClick={async () => {
              try {
                const out = await api<{ code: DiscountCode }>('/api/account-admin/discount-codes', {
                  body: {
                    app, code, kind, value: Number(value) || 0, plan, userId,
                    expiresAt: fromLocalInput(expires), maxUses: maxUses === '' ? null : Number(maxUses),
                    oncePerCustomer: once, note,
                  },
                });
                toast(`کدِ ${out.code.code} ساخته شد`);
                onClose();
                await onDone();
              } catch (e) {
                toast(e instanceof Error ? e.message : 'نشد', 'bad');
              }
            }}
          >
            ساختن
          </ActionButton>
        </>
      }
    >
      <Notice tone="info">
        همان رشته در دکان و پمپ دو کدِ جداست؛ بخش را درست انتخاب کنید. کدِ خالی را خودِ سرور می‌سازد.
      </Notice>
      <label className="label">بخش</label>
      <div className="mb-3"><AppPicker value={app} onChange={(v) => setApp(v as AppId)} /></div>
      <label className="label">کد (خالی = خودکار)</label>
      <input className="input mb-3 w-full" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} />
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label">نوع</label>
          <select className="input w-full" value={kind} onChange={(e) => setKind(e.target.value === 'amount' ? 'amount' : 'percent')}>
            <option value="percent">درصدی</option>
            <option value="amount">مبلغی</option>
          </select>
        </div>
        <div>
          <label className="label">{kind === 'percent' ? 'درصد' : 'مبلغ'}</label>
          <input className="input w-full" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label">فقط این پلن (اختیاری)</label>
          <input className="input w-full" dir="ltr" value={plan} onChange={(e) => setPlan(e.target.value)} />
        </div>
        <div>
          <label className="label">فقط این مشتری (شناسهٔ کاربر)</label>
          <input className="input w-full" dir="ltr" value={userId} onChange={(e) => setUserId(e.target.value)} />
        </div>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label">انقضا</label>
          <input className="input w-full" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </div>
        <div>
          <label className="label">سقفِ تعداد (خالی = بی‌سقف)</label>
          <input className="input w-full" inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
        </div>
      </div>
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={once} onChange={(e) => setOnce(e.target.checked)} />
        فقط یک‌بار برای هر مشتری
      </label>
      <label className="label">یادداشت</label>
      <input className="input w-full" value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}

/** کمپین: فیلتر ⇒ کد ⇒ اعلان، در یک تماس. */
function NewCampaign({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [app, setApp] = useState<Scope>('shop');
  const [percent, setPercent] = useState('');
  const [expiringDays, setExpiringDays] = useState('30');
  const [city, setCity] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [send, setSend] = useState(true);

  return (
    <Modal
      open
      onClose={onClose}
      title="کمپینِ تازه"
      footer={
        <>
          <button className="btn" onClick={onClose}>انصراف</button>
          <ActionButton
            className="btn btn-primary"
            busyLabel="…"
            onClick={async () => {
              try {
                const filter: Record<string, unknown> = { kind: 'filter' };
                if (expiringDays.trim()) filter.expiring_days = Number(expiringDays);
                if (city.trim()) filter.city = city.trim();
                await api('/api/account-admin/campaigns', {
                  body: {
                    name, app, filter,
                    discount: { kind: 'percent', value: Number(percent) || 0 },
                    notice: { title, body, channels: ['inapp', 'email'] },
                    send,
                  },
                });
                toast('کمپین ساخته شد');
                onClose();
                await onDone();
              } catch (e) {
                toast(e instanceof Error ? e.message : 'نشد', 'bad');
              }
            }}
          >
            ساختن{send ? ' و فرستادن' : ''}
          </ActionButton>
        </>
      }
    >
      <Notice tone="info">
        کمپینِ «هر دو» دو کد می‌سازد (یکی برای هر بخش)، چون قیمت و ارزِ دو بخش یکی نیست. اعلان یکی است و
        متغیرِ «کد-تخفیف» برای هر گیرنده کدِ بخشِ خودش می‌شود.
      </Notice>
      <label className="label">نام</label>
      <input className="input mb-3 w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: تخفیفِ عید" />
      <label className="label">بخش</label>
      <div className="mb-3"><AppPicker value={app} onChange={setApp} withBoth /></div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label">درصدِ تخفیف</label>
          <input className="input w-full" inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value)} />
        </div>
        <div>
          <label className="label">کسانی که تا این‌قدر روز دیگر منقضی می‌شوند</label>
          <input className="input w-full" inputMode="numeric" value={expiringDays} onChange={(e) => setExpiringDays(e.target.value)} />
        </div>
      </div>
      <label className="label">فقط این شهر (اختیاری)</label>
      <input className="input mb-3 w-full" value={city} onChange={(e) => setCity(e.target.value)} />
      <label className="label">عنوانِ اعلان (خالی = قالبِ آماده)</label>
      <input className="input mb-3 w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="label">متنِ اعلان</label>
      <textarea className="input mb-3 h-24 w-full" value={body} onChange={(e) => setBody(e.target.value)} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} />
        همین حالا فرستاده شود
      </label>
    </Modal>
  );
}
