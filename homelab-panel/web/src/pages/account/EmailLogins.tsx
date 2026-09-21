// ---------------------------------------------------------------------------
//  ✉️ ورود با کدِ ایمیلی — میزِ «کد نیامد»
//
//  وقتی مشتری زنگ می‌زند «کد نیامد»، جوابِ صاحبِ سامانه نباید حدس باشد.
//  این‌جا معلوم می‌شود درخواست رسیده بود یا نه، ایمیل رفت یا نرفت و چرا.
//
//  ⛔ **«نشان دادنِ کد» عمداً این‌جا نیست.** آن مسیر کدِ زندهٔ ورودِ یک
//     مشتری را برمی‌گرداند؛ در پشتیِ ورود است و سرورِ حساب هم فقط به
//     مدیرِ کلِ خودش و با ثبت در دفتر می‌دهدش. بردنش به مرورگرِ پنل یعنی
//     یک راز بیشتر که از دفترِ خودش بیرون آمده. «دوباره بفرست» کارِ همان
//     را می‌کند بی این‌که کد از دفتر بیرون بیاید.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { MailCheck } from 'lucide-react';

import { api } from '../../api';
import { Badge, Card, Empty, Skeleton, toast } from '../../components/ui';
import { ActionButton, Cell, KV, Notice, Row, Table } from '../../control/ui';
import { AppPicker, CloudProblem, fa, moment, useLoad, type AppId, type Scope } from './shared';
import type { LoginRequest } from './types';

type ListOut = { requests: LoginRequest[]; worker?: Record<string, unknown> };
type StatsOut = { sent?: number; failed?: number; queued?: number; p50?: number; p95?: number; [k: string]: unknown };

const STATE: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  sent: { label: 'ایمیل رفت', tone: 'good' },
  delivered: { label: 'رسید', tone: 'good' },
  queued: { label: 'در صف', tone: 'warn' },
  pending: { label: 'در صف', tone: 'warn' },
  used: { label: 'وارد شد', tone: 'good' },
  expired: { label: 'منقضی', tone: 'neutral' },
  failed: { label: 'نرفت', tone: 'bad' },
  error: { label: 'خطا', tone: 'bad' },
};

export default function EmailLogins() {
  const [app, setApp] = useState<Scope>('both');
  const [email, setEmail] = useState('');
  const [unlockApp, setUnlockApp] = useState<AppId>('shop');
  const [unlockEmail, setUnlockEmail] = useState('');

  const qs = new URLSearchParams();
  if (app !== 'both') qs.set('app', app);
  if (email.trim()) qs.set('email', email.trim());
  qs.set('limit', '100');
  const list = useLoad<ListOut>(`/api/account-admin/logins?${qs}`, [app, email], 'logins');
  const stats = useLoad<StatsOut>('/api/account-admin/logins/stats?hours=24', [], 'logins');

  return (
    <div className="flex flex-col gap-4">
      {list.error && <CloudProblem code={list.code} message={list.error} onRetry={list.reload} />}

      <Notice tone="info">
        این میز مالِ ورودِ مشتری‌ها به برنامه‌هاست (کدِ شش‌رقمیِ ایمیلی روی سرورِ حساب)، نه ورود به خودِ پنل.
        خودِ کد هیچ‌وقت این‌جا نشان داده نمی‌شود؛ «دوباره بفرست» همان کدِ قبلی را دوباره می‌فرستد.
      </Notice>

      <Card title="بیست‌وچهار ساعتِ گذشته" icon={<MailCheck className="h-4 w-4" />}>
        {stats.busy && !stats.data ? <Skeleton rows={1} /> : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {['sent', 'failed', 'queued', 'p95'].map((k) => (
              <KV key={k} label={k === 'p95' ? 'کندترین (p95، میلی‌ثانیه)' : STATE[k]?.label || k}>
                {stats.data?.[k] == null ? '—' : fa(Number(stats.data[k]))}
              </KV>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="درخواست‌های اخیر"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <AppPicker value={app} onChange={setApp} withBoth />
            <input className="input w-48" dir="ltr" placeholder="ایمیل" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        }
      >
        {list.busy && !list.data ? <Skeleton rows={5} /> : (
          (list.data?.requests.length || 0) === 0
            ? <Empty title="درخواستی ثبت نشده" />
            : (
              <Table head={['کِی', 'بخش', 'ایمیل', 'حال', 'تلاش', '']}>
                {(list.data?.requests || []).map((r) => {
                  const s = STATE[r.status] || { label: r.status, tone: 'neutral' as const };
                  return (
                    <Row key={r.request_id}>
                      <Cell>{moment(r.created_at)}</Cell>
                      <Cell mono>{r.app}</Cell>
                      <Cell mono>{r.masked_email || r.email || '—'}</Cell>
                      <Cell><Badge tone={s.tone}>{s.label}</Badge></Cell>
                      <Cell className="tnum">{r.tries == null ? '—' : fa(r.tries)}</Cell>
                      <Cell>
                        <ActionButton
                          busyLabel="…"
                          onClick={async () => {
                            try {
                              await api(`/api/account-admin/logins/${r.request_id}/resend`, { body: {} });
                              toast('دوباره فرستاده شد');
                              await list.reload();
                            } catch (e) {
                              toast(e instanceof Error ? e.message : 'نشد', 'bad');
                            }
                          }}
                        >
                          دوباره بفرست
                        </ActionButton>
                      </Cell>
                    </Row>
                  );
                })}
              </Table>
            )
        )}
      </Card>

      <Card title="برداشتنِ قفلِ «تلاشِ زیاد»">
        <p className="mb-3 text-xs text-ink-soft">
          کسی که چند بار کدِ غلط زده، پانزده دقیقه قفل می‌شود. اگر خودِ مشتری پشتِ خط است، همین‌جا بازش کنید.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <AppPicker value={unlockApp} onChange={(v) => setUnlockApp(v as AppId)} />
          <input className="input w-56" dir="ltr" placeholder="ایمیل" value={unlockEmail} onChange={(e) => setUnlockEmail(e.target.value)} />
          <ActionButton
            className="btn btn-sm btn-primary"
            busyLabel="…"
            disabled={!unlockEmail.trim()}
            onClick={async () => {
              try {
                await api('/api/account-admin/logins/unlock', { body: { app: unlockApp, email: unlockEmail.trim() } });
                toast('قفل برداشته شد');
                setUnlockEmail('');
              } catch (e) {
                toast(e instanceof Error ? e.message : 'نشد', 'bad');
              }
            }}
          >
            باز کن
          </ActionButton>
        </div>
      </Card>
    </div>
  );
}
