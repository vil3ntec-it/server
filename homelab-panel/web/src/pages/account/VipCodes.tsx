// ---------------------------------------------------------------------------
//  🎟️ کدهای اشتراک (VIP) — دکان و پمپ
//
//  ⛔ این صفحه در ۱.۴۱.۰ با دفترِ قدیمی رفت و جایش در پل نوشته نشد، پس
//     صاحبِ سامانه از پنل دیگر **کدِ اشتراک نمی‌توانست بسازد** — در حالی
//     که سرورِ حساب همان مسیر را داشت. گزارشِ خودش: «اون دسترسی‌های قدیم
//     رو ندارم روش». برگشت، ولی این بار بی دفترِ دوم: هر چه این‌جا دیده
//     می‌شود از `/api/account-admin/vip-codes` می‌آید.
//
//  ⚠️ **کدِ خام فقط یک بار دیده می‌شود.** سرور فقط نشانه‌اش را نگه می‌دارد
//     (`hint`)، پس بعد از بستنِ این پنجره حتی خودِ سرور هم نمی‌تواند
//     نشانش بدهد. برای همین بعد از ساختن، کد در یک کادرِ بزرگ با دکمهٔ
//     «کپی» می‌ماند تا مدیر عمداً ببنددش.
//  ⚠️ کدِ دکان و کدِ پمپ دو دفترِ جدا هستند؛ «هر دو» این‌جا معنی ندارد.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { Check, Copy, Ticket } from 'lucide-react';

import { api } from '../../api';
import { Badge, Card, ConfirmDialog, Empty, Modal, Skeleton, toast } from '../../components/ui';
import { ActionButton, Cell, Notice, Row, Table } from '../../control/ui';
import { APP_LABEL, AppPicker, CloudProblem, PageHead, day, fa, moment, useLoad, type AppId } from './shared';

type VipCode = {
  id: string;
  app: string;
  hint: string;
  plan: string;
  days: number | null;
  maxDevices: number;
  note: string;
  email: string;
  emailStatus: string;
  emailError: string;
  phone: string;
  smsStatus: string;
  status: string;
  createdAt: number;
  expiresAt: number | null;
  usedAt: number | null;
  shopId: string;
};

/** نتیجهٔ ساختن — کدِ خام فقط همین یک بار. */
type Made = {
  code: string;
  vipCode: VipCode;
  emailStatus?: string;
  emailError?: string;
  smsStatus?: string;
  smsError?: string;
};

const STATUS: Record<string, { tone: 'good' | 'warn' | 'bad' | 'neutral'; label: string }> = {
  active: { tone: 'good', label: 'فعال' },
  used: { tone: 'neutral', label: 'خرج شد' },
  revoked: { tone: 'bad', label: 'باطل' },
  expired: { tone: 'warn', label: 'منقضی' },
};

export default function VipCodes() {
  const [app, setApp] = useState<AppId>('shop');
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<Made | null>(null);
  const [revoke, setRevoke] = useState<VipCode | null>(null);

  const codes = useLoad<{ codes: VipCode[] }>(`/api/account-admin/vip-codes?app=${app}`, [app]);

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="کدهای اشتراک"
        sub="کدِ شش‌رقمی که مشتری در برنامه می‌زند و اشتراکش همان لحظه فعال می‌شود"
        actions={
          <>
            <AppPicker value={app} onChange={(v) => setApp(v as AppId)} />
            <button className="btn btn-sm btn-primary" onClick={() => setMaking(true)}>کدِ تازه</button>
          </>
        }
      />

      {codes.error && <CloudProblem code={codes.code} message={codes.error} onRetry={codes.reload} />}

      <Card title={`کدهای ${APP_LABEL[app]}`} icon={<Ticket className="h-4 w-4" />}>
        {codes.busy && !codes.data ? (
          <Skeleton rows={4} />
        ) : (codes.data?.codes.length || 0) === 0 ? (
          <Empty title="کدی ساخته نشده" hint="«کدِ تازه» را بزنید." />
        ) : (
          <Table head={['کد', 'پلن', 'مدت', 'گیرنده', 'ایمیل', 'حال', 'ساخته شد', 'مهلت', '']}>
            {(codes.data?.codes || []).map((c) => {
              const s = STATUS[c.status] || { tone: 'neutral' as const, label: c.status };
              return (
                <Row key={c.id}>
                  {/* فقط نشانه — خودِ کد روی سرور هم نیست */}
                  <Cell mono>{c.hint || '••••••'}</Cell>
                  <Cell>{c.plan}</Cell>
                  <Cell className="tnum">{c.days == null ? 'از خودِ پلن' : `${fa(c.days)} روز`}</Cell>
                  <Cell>{c.email || c.phone || '—'}</Cell>
                  <Cell>
                    {c.email
                      ? <Badge tone={c.emailStatus === 'sent' ? 'good' : c.emailStatus === 'failed' ? 'bad' : 'neutral'}>
                          {c.emailStatus === 'sent' ? 'رفت' : c.emailStatus === 'failed' ? (c.emailError || 'نرفت') : '—'}
                        </Badge>
                      : '—'}
                  </Cell>
                  <Cell><Badge tone={s.tone}>{s.label}</Badge></Cell>
                  <Cell>{moment(c.createdAt)}</Cell>
                  <Cell>{c.expiresAt ? day(c.expiresAt) : '—'}</Cell>
                  <Cell>
                    {c.status === 'active' && (
                      <button className="btn btn-sm btn-danger" onClick={() => setRevoke(c)}>باطل کن</button>
                    )}
                  </Cell>
                </Row>
              );
            })}
          </Table>
        )}
      </Card>

      {making && (
        <NewVipCode
          app={app}
          onClose={() => setMaking(false)}
          onMade={async (out) => { setMade(out); await codes.reload(); }}
        />
      )}

      {made && <MadeCode made={made} onClose={() => setMade(null)} />}

      <ConfirmDialog
        open={Boolean(revoke)}
        danger
        title={revoke ? `باطل کردنِ کدِ ${revoke.hint}` : ''}
        message="این کد از همان لحظه خرج نمی‌شود. ⛔ اشتراک‌هایی که پیش از این با آن فعال شده‌اند دست نمی‌خورند."
        onCancel={() => setRevoke(null)}
        onConfirm={async () => {
          const c = revoke;
          setRevoke(null);
          if (!c) return;
          try {
            await api(`/api/account-admin/vip-codes/${c.id}/revoke`, { body: { app } });
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

/* ----------------------------- ساختنِ کد ----------------------------- */

function NewVipCode({ app, onClose, onMade }: { app: AppId; onClose: () => void; onMade: (out: Made) => Promise<void> }) {
  const [plan, setPlan] = useState('');
  const [days, setDays] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [maxDevices, setMaxDevices] = useState('10');
  const [expiresInDays, setExpiresInDays] = useState('30');
  const [note, setNote] = useState('');

  const plans = useLoad<{ plans: { code: string; title?: string }[] }>(`/api/account-admin/plans?app=${app}`, [app]);

  return (
    <Modal
      open
      onClose={onClose}
      title={`کدِ اشتراکِ تازه — ${APP_LABEL[app]}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>انصراف</button>
          <ActionButton
            className="btn btn-primary"
            busyLabel="…"
            onClick={async () => {
              try {
                const out = await api<Made>('/api/account-admin/vip-codes', {
                  body: {
                    app,
                    plan,
                    days: days === '' ? null : Number(days),
                    email: email.trim(),
                    phone: phone.trim(),
                    maxDevices: Number(maxDevices) || 10,
                    expiresInDays: Number(expiresInDays) || 30,
                    note,
                  },
                });
                onClose();
                await onMade(out);
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
      <Notice tone="warn">
        کدِ خام <b>فقط یک بار</b> دیده می‌شود — بعدش حتی خودِ سرور هم نمی‌تواند نشانش بدهد.
        اگر ایمیل یا شماره بدهید، همان لحظه برای مشتری فرستاده می‌شود.
      </Notice>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label">پلن</label>
          <select className="input w-full" value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="">— انتخاب کنید —</option>
            {(plans.data?.plans || []).map((p) => (
              <option key={p.code} value={p.code}>{p.title ? `${p.title} (${p.code})` : p.code}</option>
            ))}
          </select>
        </div>
        <div>
          {/* ⛔ خالی یعنی «مدت از خودِ پلن» — عددِ دستی پلن را دور می‌زند */}
          <label className="label">مدت به روز (خالی = از خودِ پلن)</label>
          <input className="input w-full" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label">ایمیلِ گیرنده (اختیاری)</label>
          <input className="input w-full" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">شمارهٔ موبایل (اختیاری)</label>
          <input className="input w-full" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label">سقفِ دستگاه</label>
          <input className="input w-full" inputMode="numeric" value={maxDevices} onChange={(e) => setMaxDevices(e.target.value)} />
        </div>
        <div>
          <label className="label">مهلتِ خرج کردن (روز)</label>
          <input className="input w-full" inputMode="numeric" value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} />
        </div>
      </div>

      <label className="label">یادداشت</label>
      <input className="input w-full" value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}

/* ------------------- کدِ ساخته‌شده — یک بار، با کپی ------------------- */

function MadeCode({ made, onClose }: { made: Made; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const mailFailed = made.emailStatus === 'failed';
  const smsFailed = made.smsStatus === 'failed';

  return (
    <Modal
      open
      onClose={onClose}
      title="کد ساخته شد"
      footer={<button className="btn btn-primary" onClick={onClose}>برداشتم، ببند</button>}
    >
      <Notice tone="warn">
        این کد را همین حالا بردارید — با بستنِ این پنجره دیگر دیده نمی‌شود.
      </Notice>

      <div className="my-4 flex items-center justify-center gap-3">
        <code className="tnum rounded-xl px-5 py-3 text-2xl font-bold tracking-[0.3em]" dir="ltr"
              style={{ background: 'var(--surface-raised)' }}>
          {made.code}
        </code>
        <button
          className="btn btn-sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(made.code);
              setCopied(true);
              toast('کپی شد');
            } catch {
              //  حالتِ خصوصی یا بی‌اجازه — کد روی صفحه هست و دستی برداشته می‌شود
              toast('کپی نشد — دستی برش دارید', 'bad');
            }
          }}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          کپی
        </button>
      </div>

      {made.vipCode.email && (
        <Notice tone={mailFailed ? 'bad' : made.emailStatus === 'sent' ? 'good' : 'info'}>
          {mailFailed
            ? `ایمیل نرفت: ${made.emailError || 'خطای سرورِ ایمیل'} — کد را دستی بدهید.`
            : made.emailStatus === 'sent'
              ? `ایمیل به ${made.vipCode.email} رفت.`
              : 'ایمیل در صف است.'}
        </Notice>
      )}
      {made.vipCode.phone && (
        <Notice tone={smsFailed ? 'bad' : 'info'}>
          {smsFailed ? `پیامک نرفت: ${made.smsError || 'خطای سرویسِ پیامک'}` : 'پیامک فرستاده شد.'}
        </Notice>
      )}
    </Modal>
  );
}
