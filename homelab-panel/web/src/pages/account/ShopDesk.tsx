// ---------------------------------------------------------------------------
//  🏪 میزِ فروشگاه — تمام‌صفحه، سه تب
//
//  خواستهٔ صریحِ صاحب سامانه: «بخشِ فروشگاه را تمام‌صفحه کن. اول داشبورد…
//  تعدادِ مشتری‌ها، اشتراک‌دارها، آنلاین‌ها، کسانی که اشتراکشان رو به پایان
//  است با ایمیل و وقتِ مانده، و پیام‌های پشتیبانی. دوم اشتراک‌ها با سه
//  گروه… سوم بخشِ کد که همهٔ حساب‌ها را نشان بدهد و روی هر کدام زدم کدِ
//  شاگردش را ببینم و چند تا شاگرد به آن وصل است.»
//
//  ⚠️ **و قاعدهٔ «یک موضوع، یک صفحه» نشکست.** تا دیروز «فروشگاه‌ها»ی منو
//  همان `/customers?app=shop` بود و یادداشتِ همان‌جا می‌گفت صفحهٔ تازه‌ای
//  ساخته نشود. آن یادداشت وقتی نوشته شد که محتوای تازه‌ای در کار نبود؛
//  حالا هست (داشبورد، سه گروه، کدِ شاگرد) و خودِ صاحب سامانه صریح
//  خواسته. پس **درِ قدیمی به همین‌جا `Navigate` می‌شود** — باز هم یک در
//  برای یک موضوع، فقط درش عوض شد.
//
//  ⛔ **هیچ عددی این‌جا حساب نمی‌شود.** جمع و گروه‌بندی روی سرورِ حساب
//  است (`routes/admin-shop-desk.js`)، با همان `subs.stateOf` که خودِ
//  برنامه با آن قفل باز می‌کند. دو جای تصمیم یعنی روزی پنل «دارد»
//  می‌گوید و برنامه «تمام شده».
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Clock, KeyRound, MessagesSquare, Store, Users, Wifi } from 'lucide-react';

import { api } from '../../api';
import { Card, CopyButton, Loading, toast } from '../../components/ui';
import { useApp } from '../../app-context';
import { ActionButton, Cell, Notice, Row, Stat, Table, Tabs } from '../../control/ui';
import { CloudProblem, fa, useLoad } from './shared';

type Overview = {
  serverTime: number;
  onlineWithinMs: number;
  counts: { shops: number; customers: number; subscribed: number; online: number;
            expiring: number; supportOpen: number; supportUnread: number };
  expiring: { subscriptionId: string; tenantId: string; tenantName: string;
              ownerName: string; ownerEmail: string; plan: string; endsAt: number; daysLeft: number }[];
  support: { id: string; subject?: string; who?: string; status: string; unread_admin?: number; updated_at?: number }[];
  days: number;
};

type GroupRow = {
  tenantId: string; tenantName: string; ownerName: string; ownerEmail: string; ownerPhone: string;
  subscriptionId: string; plan: string; status: string; endsAt: number; daysLeft: number; createdAt: number;
};
type Groups = { groups: { has: GroupRow[]; none: GroupRow[]; expired: GroupRow[] };
                counts: { has: number; none: number; expired: number } };

type StaffCodes = {
  shop: { id: string; name: string };
  students: { total: number; active: number; members: number };
  standing: { id: string; role: string; generation: number; usedCount: number } | null;
  codes: { id: string; hint: string; role: string; status: string; usedCount: number; maxUses: number }[];
};

const when = (ms?: number | null) => (ms ? new Date(Number(ms)).toLocaleDateString('fa-IR') : '—');

/* ───────────────────────────── تبِ ۱: داشبورد ───────────────────────────── */

function Dash() {
  const { t } = useApp();
  const load = useLoad<Overview>('/api/account-admin/shop-desk/overview?days=7', [], ['customers', 'sales', 'support']);
  if (load.error) return <CloudProblem code={load.code} message={load.error} onRetry={load.reload} />;
  if (!load.data) return <Loading label={t('navShops')} />;
  const d = load.data;
  const mins = Math.round(d.onlineWithinMs / 60000);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label={t('shopDeskShops')} value={fa(d.counts.shops)} icon={<Store size={16} />} />
        <Stat label={t('shopDeskCustomers')} value={fa(d.counts.customers)} icon={<Users size={16} />} />
        <Stat label={t('shopDeskSubscribed')} value={fa(d.counts.subscribed)} tone="good" />
        {/* ⚠️ تعریفِ «آنلاین» از خودِ سرور می‌آید، نه از یک عددِ نوشته‌شده این‌جا */}
        <Stat label={t('shopDeskOnline')} value={fa(d.counts.online)} tone="info" icon={<Wifi size={16} />}
              sub={t('shopDeskOnlineHint').replace('{n}', fa(mins))} />
        <Stat label={t('shopDeskSupport')} value={fa(d.counts.supportUnread)}
              tone={d.counts.supportUnread > 0 ? 'warn' : undefined}
              icon={<MessagesSquare size={16} />}
              sub={t('shopDeskSupportOpen').replace('{n}', fa(d.counts.supportOpen))} />
      </div>

      <Card title={t('shopDeskExpiring').replace('{n}', fa(d.days))} icon={<Clock size={16} />}>
        {d.expiring.length === 0 ? <Notice tone="good">{t('shopDeskExpiringNone')}</Notice> : (
          <Table head={[t('shopDeskName'), t('shopDeskEmail'), t('shopDeskPlan'), t('shopDeskLeft'), t('shopDeskEnds')]}>
            {d.expiring.map((r) => (
              <Row key={r.subscriptionId}>
                <Cell>{r.tenantName || r.tenantId}</Cell>
                {/* ⚠️ ایمیل همان چیزی است که صاحبِ سامانه صریح خواست */}
                <Cell mono>{r.ownerEmail || '—'}</Cell>
                <Cell>{r.plan || '—'}</Cell>
                <Cell style={{ color: r.daysLeft <= 3 ? 'var(--status-critical)' : 'var(--status-warning)' }}>
                  {t('shopDeskDays').replace('{n}', fa(r.daysLeft))}
                </Cell>
                <Cell>{when(r.endsAt)}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      <Card title={t('shopDeskThreads')} icon={<MessagesSquare size={16} />}>
        {(d.support || []).length === 0 ? <Notice>{t('shopDeskThreadsNone')}</Notice> : (
          <Table head={[t('shopDeskWho'), t('shopDeskSubject'), t('shopDeskUnread')]}>
            {(d.support || []).map((s) => (
              <Row key={s.id}>
                <Cell>{s.who || '—'}</Cell>
                <Cell>{s.subject || '—'}</Cell>
                <Cell style={Number(s.unread_admin) > 0 ? { color: 'var(--status-warning)' } : undefined}>
                  {fa(Number(s.unread_admin) || 0)}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

/* ──────────────────────── تبِ ۲: اشتراک‌ها، سه گروه ─────────────────────── */

function GroupTable({ rows, empty }: { rows: GroupRow[]; empty: string }) {
  const { t } = useApp();
  if (rows.length === 0) return <Notice>{empty}</Notice>;
  return (
    <Table head={[t('shopDeskName'), t('shopDeskEmail'), t('shopDeskPlan'), t('shopDeskLeft')]}>
      {rows.map((r) => (
        <Row key={r.tenantId}>
          <Cell>{r.tenantName || r.tenantId}</Cell>
          <Cell mono>{r.ownerEmail || '—'}</Cell>
          <Cell>{r.plan || '—'}</Cell>
          <Cell style={r.daysLeft > 0 && r.daysLeft <= 7 ? { color: 'var(--status-warning)' } : undefined}>
            {r.subscriptionId ? t('shopDeskDays').replace('{n}', fa(r.daysLeft)) : '—'}
          </Cell>
        </Row>
      ))}
    </Table>
  );
}

function SubGroups() {
  const { t } = useApp();
  const [q, setQ] = useState('');
  const load = useLoad<Groups>(`/api/account-admin/shop-desk/groups?q=${encodeURIComponent(q)}`, [q], 'customers');
  if (load.error) return <CloudProblem code={load.code} message={load.error} onRetry={load.reload} />;
  if (!load.data) return <Loading label={t('shopDeskGroups')} />;
  const g = load.data.groups;

  return (
    <div className="space-y-4">
      <input className="input w-full sm:w-80" placeholder={t('shopDeskSearch')} value={q}
             onChange={(e) => setQ(e.target.value)} />
      {/*
        ⛔ سه گروه، چون «هیچ‌وقت نداشت» با «داشت و تمام شد» یکی نیست و
        صاحبِ سامانه صریح سه‌تا خواست. گروه‌بندی سمتِ سرور انجام شده.
      */}
      <Card title={`${t('shopDeskHas')} — ${fa(load.data.counts.has)}`}>
        <GroupTable rows={g.has} empty={t('shopDeskHasNone')} />
      </Card>
      <Card title={`${t('shopDeskNone')} — ${fa(load.data.counts.none)}`}>
        <GroupTable rows={g.none} empty={t('shopDeskNoneNone')} />
      </Card>
      <Card title={`${t('shopDeskExpired')} — ${fa(load.data.counts.expired)}`}>
        <GroupTable rows={g.expired} empty={t('shopDeskExpiredNone')} />
      </Card>
      <Notice>{t('shopDeskGrantHint')}</Notice>
    </div>
  );
}

/* ────────────────────────── تبِ ۳: کدِ شاگرد ───────────────────────────── */

function StaffCodeCard({ shopId, onClose }: { shopId: string; onClose: () => void }) {
  const { t } = useApp();
  const load = useLoad<StaffCodes>(`/api/account-admin/shop-accounts/${encodeURIComponent(shopId)}/staff-codes`, [shopId]);
  const [shown, setShown] = useState('');
  const [busy, setBusy] = useState(false);

  /*
   *  ⛔ کد با یک کلیکِ **جدا** می‌آید و همان یک کلیک ثبت می‌شود — همان
   *  قاعدهٔ «نمایشِ کد» در میزِ کدها. بی آن، هر باز شدنِ صفحه یک ردیفِ
   *  «کد دیده شد» برای هر دکان می‌ساخت و آن دفتر بی‌معنا می‌شد.
   */
  const reveal = async () => {
    setBusy(true);
    try {
      const out = await api<{ code: string }>(
        `/api/account-admin/shop-accounts/${encodeURIComponent(shopId)}/staff-codes/reveal`, { method: 'POST' });
      setShown(out.code || '');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally { setBusy(false); }
  };

  if (load.error) return <CloudProblem code={load.code} message={load.error} onRetry={load.reload} />;
  if (!load.data) return <Loading label={t('shopDeskCodes')} />;
  const d = load.data;

  return (
    <Card title={d.shop.name || d.shop.id} icon={<KeyRound size={16} />}
          action={<ActionButton onClick={onClose}>{t('close')}</ActionButton>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t('shopDeskStudents')} value={fa(d.students.total)} icon={<Users size={16} />}
              sub={t('shopDeskStudentsActive').replace('{n}', fa(d.students.active))} />
        <Stat label={t('shopDeskCodesMade')} value={fa(d.codes.length)} />
        <Stat label={t('shopDeskStanding')} value={d.standing ? fa(d.standing.usedCount) : '—'}
              sub={d.standing ? t('shopDeskStandingUsed') : t('shopDeskStandingNone')} />
      </div>

      <div className="mt-4">
        {!d.standing ? (
          <Notice tone="warn">{t('shopDeskStandingNoneHint')}</Notice>
        ) : shown ? (
          <div className="flex items-center gap-2">
            <code className="font-mono text-2xl tracking-[0.15em]" dir="ltr">{shown}</code>
            <CopyButton value={shown} />
          </div>
        ) : (
          <ActionButton onClick={reveal} disabled={busy}>{t('shopDeskReveal')}</ActionButton>
        )}
      </div>

      {/*
        ⛔ کدهای یک‌بارمصرف فقط چهار رقمِ آخرشان دیده می‌شود، برای همیشه:
        از آن‌ها فقط HMAC روی سرور هست و هیچ‌کس — مدیرِ سامانه هم —
        نمی‌تواند ببیندشان.
      */}
      <div className="mt-4">
        <Table head={[t('shopDeskHint'), t('shopDeskRole'), t('shopDeskUses'), t('shopDeskStatus')]}
               empty={d.codes.length === 0}>
          {d.codes.map((c) => (
            <Row key={c.id}>
              <Cell mono>…{c.hint}</Cell>
              <Cell>{c.role}</Cell>
              <Cell>{fa(c.usedCount)}{c.maxUses ? ` / ${fa(c.maxUses)}` : ''}</Cell>
              <Cell style={c.status === 'active' ? { color: 'var(--status-good)' } : undefined}>{c.status}</Cell>
            </Row>
          ))}
        </Table>
        <p className="mt-2 text-[11px] text-ink-muted">{t('shopDeskHintWhy')}</p>
      </div>
    </Card>
  );
}

function Codes() {
  const { t } = useApp();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState('');
  const load = useLoad<Groups>(`/api/account-admin/shop-desk/groups?q=${encodeURIComponent(q)}`, [q], 'customers');
  if (load.error) return <CloudProblem code={load.code} message={load.error} onRetry={load.reload} />;
  if (!load.data) return <Loading label={t('shopDeskCodes')} />;
  const g = load.data.groups;
  //  همهٔ حساب‌ها، نه فقط اشتراک‌دارها — خواستهٔ صریح بود
  const all = [...g.has, ...g.none, ...g.expired];

  return (
    <div className="space-y-4">
      <input className="input w-full sm:w-80" placeholder={t('shopDeskSearch')} value={q}
             onChange={(e) => setQ(e.target.value)} />
      {open && <StaffCodeCard shopId={open} onClose={() => setOpen('')} />}
      <Card title={t('shopDeskAllShops')} icon={<Store size={16} />}>
        <Table head={[t('shopDeskName'), t('shopDeskEmail'), t('shopDeskPlan'), '']} empty={all.length === 0}>
          {all.map((r) => (
            <Row key={r.tenantId} onClick={() => setOpen(r.tenantId)}>
              <Cell>{r.tenantName || r.tenantId}</Cell>
              <Cell mono>{r.ownerEmail || '—'}</Cell>
              <Cell>{r.plan || '—'}</Cell>
              <Cell>{t('shopDeskOpenCodes')}</Cell>
            </Row>
          ))}
        </Table>
      </Card>
    </div>
  );
}

/* ─────────────────────────────── خودِ صفحه ─────────────────────────────── */

export default function ShopDesk() {
  const { t } = useApp();
  const [params, setParams] = useSearchParams();
  const tabs = [
    { id: 'dash', label: t('shopDeskDash') },
    { id: 'subs', label: t('shopDeskGroups') },
    { id: 'codes', label: t('shopDeskCodes') },
  ];
  const wanted = params.get('tab') || 'dash';
  const active = tabs.some((x) => x.id === wanted) ? wanted : 'dash';

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3">
      <h1 className="text-lg font-semibold">{t('navShops')}</h1>
      <Tabs tabs={tabs} active={active} onChange={(id) => setParams(id === 'dash' ? {} : { tab: id })} />
      {active === 'dash' && <Dash />}
      {active === 'subs' && <SubGroups />}
      {active === 'codes' && <Codes />}
    </div>
  );
}
