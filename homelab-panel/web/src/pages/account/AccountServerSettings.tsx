// ---------------------------------------------------------------------------
//  🛠️ تنظیماتِ سرورِ حساب — برنامه‌ها، ایمیل، پیامک، پوش
//
//  ⛔ این‌ها در ۱.۴۱.۰ با دفترِ قدیمی از پنل رفتند و جایشان در پل نوشته
//     نشد. تنها راهِ رسیدن به آن‌ها `api.<دامنه>/admin/` بود — یعنی یک پنلِ
//     دوم با یک ورودِ دوم، دقیقاً همان سردرگمی‌ای که قرار بود برداشته شود.
//
//  ⚠️ **ایمیلِ این‌جا با رباتِ ایمیلِ خودِ پنل یکی نیست** و نباید بشود:
//     آن یکی در «کدهای شش‌رقمی» است و کدهای خودِ پنل را می‌فرستد؛ این یکی
//     کدِ ورودِ مشتری‌های دکان و پمپ را. پنل SMTPش را به سرورِ حساب پاس
//     می‌دهد، ولی مقدارِ نوشته‌شده در همین صفحه از آن جلوتر است.
//  ⛔ هیچ رمزی این‌جا خوانده نمی‌شود — سرورِ حساب فقط نشانه می‌دهد
//     (`passSet` / `keyHint`)، و خالی فرستادنِ رمز یعنی «دست نزن».
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { AppWindow, KeyRound, Mail, MessageSquare, ScrollText, Smartphone } from 'lucide-react';

import { api } from '../../api';
import { Badge, Card, Empty, Skeleton, toast } from '../../components/ui';
import { ActionButton, Cell, KV, Notice, Row, Table } from '../../control/ui';
import { CloudProblem, PageHead, fa, moment, useLoad } from './shared';

/* ============================== برنامه‌ها ============================== */

type ManagedApp = {
  id: string;
  slug: string;
  title: string;
  kind: string;
  url: string;
  healthUrl: string;
  status: string;
  keySet: boolean;
  keyHint: string;
  lastCheckAt: number | null;
  lastOk: boolean | null;
  lastStatus: number | null;
  lastMs: number | null;
  lastError: string;
};

export function ManagedApps() {
  const apps = useLoad<{ apps: ManagedApp[] }>('/api/account-admin/apps');
  const [freshKey, setFreshKey] = useState<{ id: string; key: string } | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="برنامه‌های زیرِ مدیریت"
        sub="برنامه‌هایی که از این سرورِ حساب احراز هویت می‌گیرند — با کلید و سنجشِ سلامت"
        actions={
          <ActionButton
            className="btn btn-sm"
            busyLabel="…"
            onClick={async () => {
              try {
                await api('/api/account-admin/apps/health', { body: {} });
                toast('سلامت سنجیده شد');
                await apps.reload();
              } catch (e) {
                toast(e instanceof Error ? e.message : 'نشد', 'bad');
              }
            }}
          >
            سنجشِ سلامت
          </ActionButton>
        }
      />

      {apps.error && <CloudProblem code={apps.code} message={apps.error} onRetry={apps.reload} />}

      {freshKey && (
        <Notice tone="warn">
          کلیدِ تازه — فقط همین یک بار دیده می‌شود:{' '}
          <code dir="ltr" className="select-all font-bold">{freshKey.key}</code>
        </Notice>
      )}

      <Card title="برنامه‌ها" icon={<AppWindow className="h-4 w-4" />}>
        {apps.busy && !apps.data ? (
          <Skeleton rows={3} />
        ) : (apps.data?.apps.length || 0) === 0 ? (
          <Empty title="برنامه‌ای ثبت نشده" hint="برنامه‌های دکان و پمپ خودشان شناسهٔ ثابت دارند و این‌جا لازم نیستند." />
        ) : (
          <Table head={['نام', 'شناسه', 'نشانی', 'کلید', 'آخرین سنجش', 'حال', '']}>
            {(apps.data?.apps || []).map((a) => (
              <Row key={a.id}>
                <Cell>{a.title || a.slug}</Cell>
                <Cell mono>{a.slug}</Cell>
                <Cell><span dir="ltr" className="text-xs">{a.url || '—'}</span></Cell>
                <Cell mono>{a.keySet ? a.keyHint || '••••' : '—'}</Cell>
                <Cell>
                  {a.lastCheckAt
                    ? `${moment(a.lastCheckAt)}${a.lastMs == null ? '' : ` · ${fa(a.lastMs)}ms`}`
                    : '—'}
                </Cell>
                <Cell>
                  <Badge tone={a.lastOk === true ? 'good' : a.lastOk === false ? 'bad' : 'neutral'}>
                    {a.lastOk === true ? 'سالم' : a.lastOk === false ? (a.lastError || `خطا ${a.lastStatus ?? ''}`) : '—'}
                  </Badge>
                </Cell>
                <Cell>
                  <ActionButton
                    className="btn btn-sm"
                    busyLabel="…"
                    onClick={async () => {
                      try {
                        const out = await api<{ key?: string; apiKey?: string }>(`/api/account-admin/apps/${a.id}/key`, { body: {} });
                        setFreshKey({ id: a.id, key: out.key || out.apiKey || '' });
                        toast('کلیدِ تازه ساخته شد');
                        await apps.reload();
                      } catch (e) {
                        toast(e instanceof Error ? e.message : 'نشد', 'bad');
                      }
                    }}
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    کلیدِ تازه
                  </ActionButton>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

/* =============================== ایمیل =============================== */

type EmailSettings = {
  provider: string;
  from: string;
  fromName: string;
  host: string;
  port: number | string;
  user: string;
  secure: string;
  passSet: boolean;
  ready: boolean;
  missing: string[];
};

export function AccountEmail() {
  const load = useLoad<{ email: EmailSettings }>('/api/account-admin/email');
  const [form, setForm] = useState<Partial<EmailSettings> & { pass?: string }>({});
  const [testTo, setTestTo] = useState('');

  //  فرم از پاسخِ سرور پر می‌شود، نه از پیش‌فرضِ ساختگی
  useEffect(() => { if (load.data?.email) setForm({ ...load.data.email, pass: '' }); }, [load.data]);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="flex flex-col gap-4">
      <PageHead title="ایمیلِ سرورِ حساب" sub="کدِ ورود و اعلان‌های مشتری‌های دکان و پمپ از این‌جا می‌رود" />

      {load.error && <CloudProblem code={load.code} message={load.error} onRetry={load.reload} />}

      {load.data?.email && !load.data.email.ready && (
        <Notice tone="bad">
          ⛔ ایمیل راه نیفتاده، پس کدِ ورود <b>فقط در لاگ چاپ می‌شود</b> و هیچ مشتری‌ای نمی‌تواند
          وارد شود — و چون پاسخِ «کد فرستاده شد» همیشه موفق است، هیچ خطایی هیچ‌جا دیده نمی‌شود.
          {load.data.email.missing?.length ? ` کم است: ${load.data.email.missing.join('، ')}` : ''}
        </Notice>
      )}

      <Card title="تنظیمات" icon={<Mail className="h-4 w-4" />}>
        {load.busy && !load.data ? <Skeleton rows={5} /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">راهِ ارسال</label>
              <select className="input w-full" value={form.provider || 'log'} onChange={(e) => set('provider', e.target.value)}>
                <option value="log">فقط در لاگ (هیچ ایمیلی نمی‌رود)</option>
                <option value="smtp">SMTP</option>
                <option value="api">سرویسِ API</option>
              </select>
            </div>
            <div>
              <label className="label">رمزنگاری</label>
              <select className="input w-full" value={form.secure || 'starttls'} onChange={(e) => set('secure', e.target.value)}>
                <option value="ssl">SSL</option>
                <option value="starttls">STARTTLS</option>
                <option value="none">بدون</option>
              </select>
            </div>
            <div>
              <label className="label">میزبان</label>
              <input className="input w-full" dir="ltr" value={form.host || ''} onChange={(e) => set('host', e.target.value)} />
            </div>
            <div>
              <label className="label">پورت</label>
              <input className="input w-full" dir="ltr" inputMode="numeric" value={String(form.port ?? '')} onChange={(e) => set('port', e.target.value)} />
            </div>
            <div>
              <label className="label">نامِ کاربری</label>
              <input className="input w-full" dir="ltr" value={form.user || ''} onChange={(e) => set('user', e.target.value)} />
            </div>
            <div>
              <label className="label">رمز {load.data?.email.passSet && <span className="text-ink-muted">(ذخیره شده — خالی یعنی دست نزن)</span>}</label>
              <input className="input w-full" dir="ltr" type="password" value={form.pass || ''} onChange={(e) => set('pass', e.target.value)} />
            </div>
            <div>
              <label className="label">فرستنده</label>
              <input className="input w-full" dir="ltr" value={form.from || ''} onChange={(e) => set('from', e.target.value)} />
            </div>
            <div>
              <label className="label">نامِ فرستنده</label>
              <input className="input w-full" value={form.fromName || ''} onChange={(e) => set('fromName', e.target.value)} />
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <ActionButton
            className="btn btn-primary"
            busyLabel="…"
            onClick={async () => {
              try {
                //  ⛔ رمزِ خالی اصلاً فرستاده نمی‌شود تا رمزِ ذخیره‌شده پاک نشود
                const body: Record<string, unknown> = { ...form };
                if (!form.pass) delete body.pass;
                await api('/api/account-admin/email', { method: 'PUT', body });
                toast('ذخیره شد');
                await load.reload();
              } catch (e) {
                toast(e instanceof Error ? e.message : 'نشد', 'bad');
              }
            }}
          >
            ذخیره
          </ActionButton>
          <div>
            <label className="label">ارسالِ آزمایشی به</label>
            <input className="input w-56" dir="ltr" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          </div>
          <ActionButton
            className="btn"
            busyLabel="…"
            onClick={async () => {
              try {
                await api('/api/account-admin/email/test', { body: { to: testTo } });
                toast('فرستاده شد — صندوق را ببینید');
              } catch (e) {
                toast(e instanceof Error ? e.message : 'نشد', 'bad');
              }
            }}
          >
            تست
          </ActionButton>
        </div>
      </Card>
    </div>
  );
}

/* ========================== پیامک و پوش ========================== */

export function AccountSmsPush() {
  const sms = useLoad<{ sms: Record<string, unknown> }>('/api/account-admin/sms');
  const push = useLoad<{ push: Record<string, unknown> }>('/api/account-admin/push');

  return (
    <div className="flex flex-col gap-4">
      <PageHead title="پیامک و پوش" sub="راه‌های دیگرِ رساندنِ کد و خبر به مشتری" />

      {sms.error && <CloudProblem code={sms.code} message={sms.error} onRetry={sms.reload} />}

      <Card title="پیامک" icon={<MessageSquare className="h-4 w-4" />}>
        {sms.busy && !sms.data ? <Skeleton rows={2} /> : (
          <div className="grid gap-2 sm:grid-cols-2">
            <KV label="راهِ ارسال">{String(sms.data?.sms?.provider ?? '—')}</KV>
            <KV label="فرستنده">{String(sms.data?.sms?.from ?? '—')}</KV>
            <KV label="کلید">{sms.data?.sms?.keySet ? String(sms.data.sms.keyHint || '••••') : 'گذاشته نشده'}</KV>
            <KV label="آماده؟">{sms.data?.sms?.ready ? 'بله' : 'نه'}</KV>
          </div>
        )}
        <Notice tone="info">
          پیامک اختیاری است — ورودِ همهٔ برنامه‌ها با کدِ <b>ایمیلی</b> کار می‌کند.
          تنظیمِ کلیدش از پنلِ خودِ سرورِ حساب انجام می‌شود.
        </Notice>
      </Card>

      <Card title="پوش" icon={<Smartphone className="h-4 w-4" />}>
        {push.busy && !push.data ? <Skeleton rows={2} /> : (
          <div className="grid gap-2 sm:grid-cols-2">
            <KV label="روشن؟">{push.data?.push?.enabled ? 'بله' : 'نه'}</KV>
            <KV label="پروژه">{String(push.data?.push?.project ?? '—')}</KV>
            <KV label="دستگاه‌های ثبت‌شده">{fa(Number(push.data?.push?.tokens ?? 0))}</KV>
          </div>
        )}
        <Notice tone="warn">
          ⚠️ سرور آمادهٔ فرستادنِ پوش است، ولی <b>هنوز هیچ برنامه‌ای توکنِ پوشش را ثبت نمی‌کند</b> —
          پس «برنامه بسته باشد و پیام برسد» تا آن روز روی گوشی دیده نمی‌شود. خبر روی سرور می‌نشیند و
          با باز شدنِ برنامه دیده می‌شود.
        </Notice>
      </Card>
    </div>
  );
}

/* ========================= دفترِ ممیزیِ سرورِ حساب ========================= */

export function AccountAudit() {
  const log = useLoad<{ entries?: Record<string, unknown>[]; audit?: Record<string, unknown>[] }>(
    '/api/account-admin/account-audit');
  const rows = log.data?.entries || log.data?.audit || [];

  return (
    <div className="flex flex-col gap-4">
      <PageHead
        title="دفترِ ممیزیِ سرورِ حساب"
        sub="کارهایی که روی سرورِ حساب انجام شده — از جمله آن‌ها که از پنلِ خودش انجام شده‌اند"
      />

      {log.error && <CloudProblem code={log.code} message={log.error} onRetry={log.reload} />}

      <Notice tone="info">
        این با «لاگ‌ها ← دفتر رخدادها» یکی نیست: آن یکی کارهای <b>خودِ این پنل</b> را می‌گوید.
      </Notice>

      <Card title="آخرین کارها" icon={<ScrollText className="h-4 w-4" />}>
        {log.busy && !log.data ? <Skeleton rows={5} /> : rows.length === 0 ? (
          <Empty title="چیزی ثبت نشده" hint="" />
        ) : (
          <Table head={['کِی', 'کار', 'هدف', 'جزئیات']}>
            {rows.map((r, i) => (
              <Row key={String(r.id ?? i)}>
                <Cell>{moment(Number(r.created_at ?? r.createdAt ?? 0))}</Cell>
                <Cell mono>{String(r.action ?? '—')}</Cell>
                <Cell mono>{String(r.target_id ?? r.targetId ?? '—')}</Cell>
                <Cell>
                  <span className="text-xs text-ink-muted">
                    {typeof r.detail === 'string' ? r.detail : r.detail ? JSON.stringify(r.detail) : '—'}
                  </span>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
