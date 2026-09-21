// ---------------------------------------------------------------------------
//  📣 مرکز اعلان — بندِ ۱۱.۳.۳
//
//  «یک بخش که از آن هر پیامی را به هر کسی بفرستم»: گیرنده (همه / یک بخش /
//  گروهِ فیلترشده / یک نفر)، کانال (داخلِ برنامه · پوش · ایمیل)، قالبِ فارسیِ
//  راست‌به‌چپ با متغیر، پیش‌نمایش، ارسالِ آزمایشی، زمان‌بندی، و گزارشِ
//  تحویل به تفکیکِ هر گیرنده.
//
//  ⛔ **پیش‌نمایش و ارسالِ آزمایشی هیچ ردیفی در گزارش نمی‌گذارند** — قاعدهٔ
//     خودِ سرورِ حساب. اگر می‌گذاشتند، آمارِ هر کمپین با آزمایش‌های خودِ
//     مدیر آلوده می‌شد.
//  ⛔ گزارش یک **عدد** نیست: یک ردیف برای هر گیرنده در هر کانال، با حالِ
//     واقعی (ایمیل رفت یا خطای خودِ سرورِ ایمیل؛ پوش فقط وقتی «فرستاده شد»
//     که دستگاهی گرفته باشد).
//  ⛔ خبر و اعلان هیچ‌وقت پشتِ اشتراک نمی‌رود.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { FileText, Send, Users } from 'lucide-react';

import { api } from '../../api';
import { Badge, Card, ConfirmDialog, Empty, Modal, Skeleton, toast } from '../../components/ui';
import { ActionButton, Cell, KV, Notice as InlineNotice, Row, Table, Tabs } from '../../control/ui';
import {
  APP_LABEL, AppPicker, CloudProblem, PageHead, fa, fromLocalInput, moment, toLocalInput, useLoad, type Scope,
} from './shared';
import type { Delivery, Notice, NoticeTemplate, Recipient } from './types';

const CHANNELS: { id: string; label: string }[] = [
  { id: 'inapp', label: 'داخلِ برنامه' },
  { id: 'push', label: 'پوش' },
  { id: 'email', label: 'ایمیل' },
];

const STATUS_LABEL: Record<string, string> = {
  draft: 'پیش‌نویس', scheduled: 'زمان‌بندی‌شده', sending: 'در حالِ ارسال', sent: 'فرستاده شد', failed: 'ناموفق',
};

const DELIVERY_LABEL: Record<string, string> = {
  queued: 'در صف', sent: 'فرستاده شد', delivered: 'رسید', read: 'خوانده شد', error: 'خطا',
};

type Draft = {
  id?: string;
  app: Scope;
  audienceKind: 'all' | 'filter' | 'user';
  city: string;
  plan: string;
  expiringDays: string;
  expired: boolean;
  permanent: boolean;
  userId: string;
  tenantId: string;
  channels: string[];
  title: string;
  body: string;
  templateKey: string;
  scheduleAt: string;
  repeat: 'none' | 'monthly';
};

const EMPTY: Draft = {
  app: 'shop', audienceKind: 'all', city: '', plan: '', expiringDays: '', expired: false, permanent: false,
  userId: '', tenantId: '', channels: ['inapp'], title: '', body: '', templateKey: '', scheduleAt: '', repeat: 'none',
};

function audienceOf(d: Draft): Record<string, unknown> {
  if (d.audienceKind === 'user') return { kind: 'user', user_id: d.userId, tenant_id: d.tenantId };
  if (d.audienceKind === 'filter') {
    const out: Record<string, unknown> = { kind: 'filter' };
    if (d.city.trim()) out.city = d.city.trim();
    if (d.plan.trim()) out.plan = d.plan.trim();
    if (d.expiringDays.trim()) out.expiring_days = Number(d.expiringDays);
    if (d.expired) out.expired = true;
    if (d.permanent) out.permanent = true;
    return out;
  }
  return { kind: 'all' };
}

function draftOf(n: Notice): Draft {
  const a = (n.audience || {}) as Record<string, unknown>;
  const kind = String(a.kind || 'all');
  return {
    id: n.id,
    app: (['shop', 'pump', 'both'].includes(n.app) ? n.app : 'shop') as Scope,
    audienceKind: kind === 'user' ? 'user' : kind === 'filter' ? 'filter' : 'all',
    city: String(a.city || ''),
    plan: String(a.plan || ''),
    expiringDays: a.expiring_days == null ? '' : String(a.expiring_days),
    expired: a.expired === true,
    permanent: a.permanent === true,
    userId: String(a.user_id || ''),
    tenantId: String(a.tenant_id || ''),
    channels: n.channels?.length ? n.channels : ['inapp'],
    title: n.title || '',
    body: n.body || '',
    templateKey: n.templateKey || '',
    scheduleAt: toLocalInput(n.scheduleAt),
    repeat: n.repeat === 'monthly' ? 'monthly' : 'none',
  };
}

export default function Notices() {
  const [tab, setTab] = useState('list');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [remove, setRemove] = useState<Notice | null>(null);

  const list = useLoad<{ notices: Notice[] }>('/api/account-admin/notices?limit=200', [], 'notices');
  const templates = useLoad<{ templates: NoticeTemplate[]; variables: string[] }>('/api/account-admin/notice-templates');

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-2">
      <PageHead
        title="مرکز اعلان"
        sub="پیام به همه، به یک بخش، به یک گروهِ فیلترشده یا به یک نفر — داخلِ برنامه، پوش و ایمیل"
        actions={<button className="btn btn-sm btn-primary" onClick={() => setDraft({ ...EMPTY })}>اعلانِ تازه</button>}
      />

      {list.error && <CloudProblem code={list.code} message={list.error} onRetry={list.reload} />}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'list', label: 'اعلان‌ها', badge: list.data?.notices.length },
          { id: 'templates', label: 'قالب‌های آماده' },
        ]}
      />

      {tab === 'list' && (
        <Card>
          {list.busy && !list.data ? (
            <Skeleton rows={5} />
          ) : (list.data?.notices.length || 0) === 0 ? (
            <Empty icon={<Send className="h-6 w-6" />} title="هنوز اعلانی نساخته‌اید" hint="«اعلانِ تازه» را بزنید." />
          ) : (
            <Table head={['عنوان', 'بخش', 'کانال', 'گیرنده', 'حال', 'فرستاده شد', '']}>
              {(list.data?.notices || []).map((n) => (
                <Row key={n.id}>
                  <Cell>
                    <p className="font-medium text-ink">{n.title || '—'}</p>
                    {n.system && <span className="text-[11px] text-ink-muted">اعلانِ خودکارِ سامانه</span>}
                  </Cell>
                  <Cell>{n.app === 'both' ? 'هر دو' : APP_LABEL[n.app as 'shop' | 'pump'] || n.app}</Cell>
                  <Cell>{(n.channels || []).map((c) => CHANNELS.find((x) => x.id === c)?.label || c).join(' · ')}</Cell>
                  <Cell>{String((n.audience as Record<string, unknown>)?.kind || 'all') === 'all' ? 'همه' : String((n.audience as Record<string, unknown>)?.kind) === 'user' ? 'یک نفر' : 'گروهِ فیلترشده'}</Cell>
                  <Cell><Badge tone={n.status === 'sent' ? 'good' : n.status === 'failed' ? 'bad' : n.status === 'scheduled' ? 'info' : 'neutral'}>{STATUS_LABEL[n.status] || n.status}</Badge></Cell>
                  <Cell>{n.sentAt ? moment(n.sentAt) : (n.scheduleAt ? `زمان‌بندی: ${moment(n.scheduleAt)}` : '—')}</Cell>
                  <Cell>
                    <div className="flex gap-1">
                      <button className="btn btn-sm" onClick={() => setDraft(draftOf(n))}>ویرایش</button>
                      <button className="btn btn-sm" onClick={() => setReport(n.id)}>گزارش</button>
                      {!n.system && <button className="btn btn-sm btn-danger" onClick={() => setRemove(n)}>حذف</button>}
                    </div>
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'templates' && (
        <Card title="قالب‌های آماده" icon={<FileText className="h-4 w-4" />}>
          <InlineNotice tone="info">
            متغیرهایی که در عنوان و متن کار می‌کنند: {(templates.data?.variables || []).join(' · ') || '—'}
          </InlineNotice>
          {templates.busy && !templates.data ? (
            <Skeleton rows={4} />
          ) : (
            <Table head={['کلید', 'بخش', 'عنوان', 'کانال', '']}>
              {(templates.data?.templates || []).map((tpl) => (
                <Row key={`${tpl.key}-${tpl.app}`}>
                  <Cell mono>{tpl.key}</Cell>
                  <Cell>{tpl.app === 'both' ? 'هر دو' : APP_LABEL[tpl.app as 'shop' | 'pump'] || tpl.app}</Cell>
                  <Cell>{tpl.title}</Cell>
                  <Cell>{(tpl.channels || []).map((c) => CHANNELS.find((x) => x.id === c)?.label || c).join(' · ')}</Cell>
                  <Cell>
                    <button
                      className="btn btn-sm"
                      onClick={() => setDraft({
                        ...EMPTY,
                        app: (['shop', 'pump', 'both'].includes(tpl.app) ? tpl.app : 'shop') as Scope,
                        title: tpl.title, body: tpl.body, channels: tpl.channels?.length ? tpl.channels : ['inapp'],
                        templateKey: tpl.key,
                      })}
                    >
                      اعلان از روی این قالب
                    </button>
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Card>
      )}

      {draft && <Composer draft={draft} onClose={() => setDraft(null)} onDone={list.reload} />}
      {report && <Report id={report} onClose={() => setReport(null)} />}

      <ConfirmDialog
        open={Boolean(remove)}
        danger
        title={remove ? `حذفِ «${remove.title}»` : ''}
        message="این اعلان و گزارشِ تحویلش پاک می‌شوند. پیام‌هایی که قبلاً به دستِ مشتری رسیده‌اند سرِ جایشان می‌مانند."
        onCancel={() => setRemove(null)}
        onConfirm={async () => {
          const n = remove;
          setRemove(null);
          if (!n) return;
          try {
            await api(`/api/account-admin/notices/${n.id}`, { method: 'DELETE' });
            toast('حذف شد');
            await list.reload();
          } catch (e) {
            toast(e instanceof Error ? e.message : 'نشد', 'bad');
          }
        }}
      />
    </div>
  );
}

/* ------------------------------ نوشتنِ اعلان ---------------------------- */

function Composer({ draft, onClose, onDone }: { draft: Draft; onClose: () => void; onDone: () => Promise<void> }) {
  const [d, setD] = useState<Draft>(draft);
  const [id, setId] = useState<string | undefined>(draft.id);
  const [audience, setAudience] = useState<{ count: number; recipients: Recipient[] } | null>(null);
  const [preview, setPreview] = useState<{ recipients: number; sample: { name: string; email: string; title: string; body: string }[]; emailHtml: string } | null>(null);
  const [testTo, setTestTo] = useState('');

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const bodyOf = () => ({
    app: d.app,
    audience: audienceOf(d),
    channels: d.channels.length ? d.channels : ['inapp'],
    title: d.title,
    body: d.body,
    templateKey: d.templateKey,
  });

  /** ذخیره — اگر تازه است می‌سازد، وگرنه همان را به‌روز می‌کند. */
  const save = async (): Promise<string> => {
    if (id) {
      await api(`/api/account-admin/notices/${id}`, { method: 'PUT', body: bodyOf() });
      return id;
    }
    const out = await api<{ notice: Notice }>('/api/account-admin/notices', { body: bodyOf() });
    setId(out.notice.id);
    return out.notice.id;
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={id ? 'ویرایشِ اعلان' : 'اعلانِ تازه'}
      footer={
        <>
          <button className="btn" onClick={onClose}>بستن</button>
          <ActionButton
            busyLabel="…"
            onClick={async () => {
              try {
                const nid = await save();
                setPreview(await api(`/api/account-admin/notices/${nid}/preview`, { body: { limit: 10 } }));
              } catch (e) {
                toast(e instanceof Error ? e.message : 'نشد', 'bad');
              }
            }}
          >
            پیش‌نمایش
          </ActionButton>
          <ActionButton
            busyLabel="…"
            onClick={async () => {
              try {
                const nid = await save();
                const out = await api<{ ok?: boolean; error?: string }>(`/api/account-admin/notices/${nid}/test`, { body: { to: testTo } });
                toast(out.error ? `سرورِ ایمیل: ${out.error}` : 'ارسالِ آزمایشی رفت', out.error ? 'bad' : 'good');
              } catch (e) {
                toast(e instanceof Error ? e.message : 'نشد', 'bad');
              }
            }}
          >
            ارسالِ آزمایشی
          </ActionButton>
          {d.scheduleAt ? (
            <ActionButton
              className="btn btn-primary"
              busyLabel="…"
              onClick={async () => {
                try {
                  const nid = await save();
                  await api(`/api/account-admin/notices/${nid}/schedule`, {
                    body: { scheduleAt: fromLocalInput(d.scheduleAt), repeat: d.repeat },
                  });
                  toast('زمان‌بندی شد');
                  onClose();
                  await onDone();
                } catch (e) {
                  toast(e instanceof Error ? e.message : 'نشد', 'bad');
                }
              }}
            >
              زمان‌بندی
            </ActionButton>
          ) : (
            <ActionButton
              className="btn btn-primary"
              busyLabel="…"
              onClick={async () => {
                try {
                  const nid = await save();
                  const out = await api<{ sent?: number; failed?: number }>(`/api/account-admin/notices/${nid}/send`, { body: {} });
                  toast(`فرستاده شد: ${fa(out.sent ?? 0)}${out.failed ? ` · ناموفق: ${fa(out.failed)}` : ''}`);
                  onClose();
                  await onDone();
                } catch (e) {
                  toast(e instanceof Error ? e.message : 'نشد', 'bad');
                }
              }}
            >
              فرستادن
            </ActionButton>
          )}
        </>
      }
    >
      <InlineNotice tone="info">
        پیش‌نمایش و ارسالِ آزمایشی هیچ ردیفی در گزارش نمی‌گذارند، پس آمارِ اعلان با آزمایش‌های خودتان آلوده نمی‌شود.
      </InlineNotice>

      <label className="label">بخش</label>
      <div className="mb-3"><AppPicker value={d.app} onChange={(v) => set('app', v)} withBoth /></div>

      <label className="label">گیرنده</label>
      <div className="mb-2 flex flex-wrap gap-1">
        {([['all', 'همه'], ['filter', 'گروهِ فیلترشده'], ['user', 'یک نفر']] as const).map(([k, label]) => (
          <button
            key={k}
            className={`rounded-lg px-2.5 py-1.5 text-xs ${d.audienceKind === k ? 'font-semibold' : 'text-ink-soft hover:bg-surface-raised'}`}
            style={d.audienceKind === k ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : undefined}
            onClick={() => set('audienceKind', k)}
          >
            {label}
          </button>
        ))}
      </div>

      {d.audienceKind === 'filter' && (
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">شهر</label>
            <input className="input w-full" value={d.city} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div>
            <label className="label">پلن</label>
            <input className="input w-full" dir="ltr" value={d.plan} onChange={(e) => set('plan', e.target.value)} />
          </div>
          <div>
            <label className="label">رو به پایان (تا این‌قدر روز)</label>
            <input className="input w-full" inputMode="numeric" value={d.expiringDays} onChange={(e) => set('expiringDays', e.target.value)} />
          </div>
          <div className="flex items-end gap-4 pb-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={d.expired} onChange={(e) => set('expired', e.target.checked)} /> منقضی
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={d.permanent} onChange={(e) => set('permanent', e.target.checked)} /> دائمی
            </label>
          </div>
        </div>
      )}

      {d.audienceKind === 'user' && (
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">شناسهٔ کاربر</label>
            <input className="input w-full" dir="ltr" value={d.userId} onChange={(e) => set('userId', e.target.value)} />
          </div>
          <div>
            <label className="label">شناسهٔ دکان/پمپ</label>
            <input className="input w-full" dir="ltr" value={d.tenantId} onChange={(e) => set('tenantId', e.target.value)} />
          </div>
        </div>
      )}

      <div className="mb-3">
        <ActionButton
          busyLabel="…"
          onClick={async () => {
            try {
              setAudience(await api('/api/account-admin/notices/audience', { body: { app: d.app, audience: audienceOf(d) } }));
            } catch (e) {
              toast(e instanceof Error ? e.message : 'نشد', 'bad');
            }
          }}
        >
          <Users className="h-3.5 w-3.5" /> چند نفر می‌شود؟
        </ActionButton>
        {audience && (
          <span className="ms-2 text-xs text-ink-soft">
            {fa(audience.count)} گیرنده{audience.recipients.length ? ` — مثلاً ${audience.recipients.slice(0, 3).map((r) => r.name || r.tenantName || r.email).join('، ')}` : ''}
          </span>
        )}
      </div>

      <label className="label">کانال</label>
      <div className="mb-3 flex flex-wrap gap-3">
        {CHANNELS.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={d.channels.includes(c.id)}
              onChange={(e) => set('channels', e.target.checked ? [...d.channels, c.id] : d.channels.filter((x) => x !== c.id))}
            />
            {c.label}
          </label>
        ))}
      </div>

      <label className="label">عنوان</label>
      <input className="input mb-3 w-full" dir="rtl" value={d.title} onChange={(e) => set('title', e.target.value)} />

      <label className="label">متن (فارسی، راست‌به‌چپ — متغیرها داخلِ آکولاد)</label>
      <textarea className="input mb-3 h-32 w-full" dir="rtl" value={d.body} onChange={(e) => set('body', e.target.value)} />

      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">زمان‌بندی (خالی = همین حالا)</label>
          <input className="input w-full" type="datetime-local" value={d.scheduleAt} onChange={(e) => set('scheduleAt', e.target.value)} />
        </div>
        <div>
          <label className="label">تکرار</label>
          <select className="input w-full" value={d.repeat} onChange={(e) => set('repeat', e.target.value === 'monthly' ? 'monthly' : 'none')}>
            <option value="none">بی تکرار</option>
            <option value="monthly">هر ماه</option>
          </select>
        </div>
      </div>

      <label className="label">نشانیِ ارسالِ آزمایشی (خالی = فرستندهٔ تنظیمِ ایمیل)</label>
      <input className="input w-full" dir="ltr" value={testTo} onChange={(e) => setTestTo(e.target.value)} />

      {preview && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-xs text-ink-soft">پیش‌نمایش برای {fa(preview.recipients)} گیرنده — متنِ پرشدهٔ چند نفرِ اول:</p>
          <ul className="flex flex-col gap-2">
            {preview.sample.map((s, i) => (
              <li key={i} className="rounded-xl border border-line p-3 text-sm" dir="rtl">
                <p className="font-semibold text-ink">{s.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-ink-soft">{s.body}</p>
                <p className="mt-1 text-[11px] text-ink-muted">{[s.name, s.email].filter(Boolean).join(' · ')}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------ گزارشِ تحویل ---------------------------- */

function Report({ id, onClose }: { id: string; onClose: () => void }) {
  const rep = useLoad<{ notice: Notice; summary: Record<string, number>; deliveries: Delivery[] }>(
    `/api/account-admin/notices/${id}/report?limit=1000`);

  return (
    <Modal open wide onClose={onClose} title={`گزارشِ ارسال — ${rep.data?.notice.title || ''}`}>
      {rep.busy && !rep.data ? <Skeleton rows={5} /> : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {['total', 'queued', 'sent', 'delivered', 'read', 'error'].filter((k) => rep.data?.summary?.[k] != null).map((k) => (
              <KV key={k} label={k === 'total' ? 'همه' : DELIVERY_LABEL[k] || k}>{fa(rep.data?.summary?.[k] ?? 0)}</KV>
            ))}
          </div>
          {(rep.data?.deliveries.length || 0) === 0 ? (
            <Empty title="هنوز ردیفی ثبت نشده" hint="پیش‌نمایش و ارسالِ آزمایشی عمداً ردیف نمی‌گذارند." />
          ) : (
            <Table head={['گیرنده', 'نشانی', 'کانال', 'حال', 'کِی', 'خطا']}>
              {(rep.data?.deliveries || []).map((x) => (
                <Row key={x.id}>
                  <Cell>{x.who || '—'}</Cell>
                  <Cell mono>{x.address || '—'}</Cell>
                  <Cell>{CHANNELS.find((c) => c.id === x.channel)?.label || x.channel}</Cell>
                  <Cell>
                    <Badge tone={x.status === 'error' ? 'bad' : x.status === 'read' || x.status === 'delivered' ? 'good' : x.status === 'sent' ? 'info' : 'neutral'}>
                      {DELIVERY_LABEL[x.status] || x.status}
                    </Badge>
                  </Cell>
                  <Cell>{moment(x.readAt || x.deliveredAt || x.sentAt || x.createdAt)}</Cell>
                  <Cell>{x.error || '—'}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </>
      )}
    </Modal>
  );
}
