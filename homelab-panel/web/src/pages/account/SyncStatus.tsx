// ---------------------------------------------------------------------------
//  🔄 وضعیت Sync — بندهای ۱۱.۳ و ۱۳.۲
//
//  ⛔ **فقط حال، نه محتوا.** این‌جا آخرین همگام‌سازی، حجمِ صف، تعارض‌ها و
//     خطاهای گزارش‌شدهٔ برنامه دیده می‌شود — نه حتی یک ردیف از دادهٔ خودِ
//     مشتری. قاعدهٔ پرامپت: «مدیر در پنل فقط وضعیتِ Sync را می‌بیند، نه
//     محتوای دادهٔ مشتری را.» هیچ ستونی که مقدارِ واقعیِ یک خانه را نشان
//     بدهد این‌جا اضافه نشود.
//  ⚠️ «بازگرداندنِ تعارض» هم چیزی را نشان نمی‌دهد: یک opِ تازه از طرفِ
//     سرور می‌سازد و نسخهٔ بازنده در دستگاه‌ها می‌نشیند. هیچ داده‌ای پاک
//     نمی‌شود و نمی‌شده.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { GitMerge, RefreshCw, TriangleAlert } from 'lucide-react';

import { api } from '../../api';
import { Badge, Card, ConfirmDialog, Empty, Skeleton, toast } from '../../components/ui';
import { Cell, Notice, Row, Table, Tabs } from '../../control/ui';
import { AppPicker, CloudProblem, PageHead, fa, moment, useLoad, type AppId, type Scope } from './shared';
import type { ClientError, SyncConflict, SyncDevice } from './types';

export default function SyncStatus() {
  const [tab, setTab] = useState('devices');
  const [app, setApp] = useState<AppId>('shop');
  const [account, setAccount] = useState('');
  const [restore, setRestore] = useState<SyncConflict | null>(null);
  const [errApp, setErrApp] = useState<Scope>('both');

  const devices = useLoad<{ app: string; devices: SyncDevice[] }>(
    `/api/account-admin/sync/status?app=${app}${account.trim() ? `&account=${encodeURIComponent(account.trim())}` : ''}`,
    [app, account], 'sync');
  const conflicts = useLoad<{ conflicts: SyncConflict[] }>(
    account.trim() ? `/api/account-admin/sync/conflicts?app=${app}&account=${encodeURIComponent(account.trim())}` : null,
    [app, account]);
  const errors = useLoad<{ errors: ClientError[] }>(
    `/api/account-admin/sync/errors?limit=200${errApp === 'both' ? '' : `&app=${errApp}`}`, [errApp], 'sync');

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-2">
      <PageHead
        title="وضعیت Sync"
        sub="آخرین همگام‌سازی، صف، تعارض‌ها و خطاهای برنامه‌ها — بی هیچ نگاهی به دادهٔ مشتری"
      />

      {devices.error && <CloudProblem code={devices.code} message={devices.error} onRetry={devices.reload} />}

      <Notice tone="info">
        این صفحه فقط <b>وضعیت</b> را نشان می‌دهد. محتوای دادهٔ مشتری هیچ‌جا در پنل باز نمی‌شود.
      </Notice>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'devices', label: 'دستگاه‌ها و صف', badge: devices.data?.devices.length },
          { id: 'conflicts', label: 'تعارض‌ها', badge: conflicts.data?.conflicts.length },
          { id: 'errors', label: 'خطاهای برنامه', badge: errors.data?.errors.length },
        ]}
      />

      {tab !== 'errors' && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <AppPicker value={app} onChange={(v) => setApp(v as AppId)} />
          <input
            className="input w-56"
            dir="ltr"
            placeholder="شناسهٔ حساب (برای تعارض‌ها لازم است)"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </div>
      )}

      {tab === 'devices' && (
        <Card title="دستگاه‌ها" icon={<RefreshCw className="h-4 w-4" />}>
          {devices.busy && !devices.data ? <Skeleton rows={4} /> : (
            (devices.data?.devices.length || 0) === 0
              ? <Empty title="هیچ دستگاهی هنوز همگام نشده" hint="تا برنامه‌ها Sync v1 را نزنند، این فهرست خالی می‌ماند." />
              : (
                <Table head={['حساب', 'دستگاه', 'آخرین ارسال', 'آخرین دریافت', 'عقب‌ماندگی', 'در صف', 'تعارض', 'حذف‌شده', 'نسخه']}>
                  {(devices.data?.devices || []).map((d) => (
                    <Row key={`${d.account.id}-${d.device_id}`}>
                      <Cell mono>{d.account.id}</Cell>
                      <Cell mono>{d.device_id}</Cell>
                      <Cell>{moment(d.last_push_at)}</Cell>
                      <Cell>{moment(d.last_pull_at)}</Cell>
                      <Cell className="tnum">
                        {d.behind > 0 ? <Badge tone="warn">{fa(d.behind)}</Badge> : <Badge tone="good">به‌روز</Badge>}
                      </Cell>
                      <Cell className="tnum">{fa(d.queued_count)}</Cell>
                      <Cell className="tnum">{d.conflicts ? <Badge tone="bad">{fa(d.conflicts)}</Badge> : '—'}</Cell>
                      <Cell className="tnum">{fa(d.deleted)}</Cell>
                      <Cell mono>{d.app_version || '—'}</Cell>
                    </Row>
                  ))}
                </Table>
              )
          )}
        </Card>
      )}

      {tab === 'conflicts' && (
        <Card title="تعارض‌ها" icon={<GitMerge className="h-4 w-4" />}>
          {!account.trim() ? (
            <Empty title="شناسهٔ حساب را بنویسید" hint="تعارض‌ها همیشه مالِ یک حسابِ مشخص‌اند؛ سرورِ حساب بی شناسه فهرست نمی‌دهد." />
          ) : conflicts.busy && !conflicts.data ? <Skeleton rows={4} /> : (
            (conflicts.data?.conflicts.length || 0) === 0
              ? <Empty title="تعارضی نیست" />
              : (
                <Table head={['جدول', 'ردیف', 'خانه', 'دستگاهِ برنده', 'دستگاهِ بازنده', 'کِی', '']}>
                  {(conflicts.data?.conflicts || []).map((c) => (
                    <Row key={c.id}>
                      <Cell mono>{c.table}</Cell>
                      <Cell mono>{c.row_id}</Cell>
                      <Cell mono>{c.field}</Cell>
                      <Cell mono>{c.winner_device || '—'}</Cell>
                      <Cell mono>{c.loser_device || '—'}</Cell>
                      <Cell>{moment(c.at)}</Cell>
                      <Cell>
                        {c.restored_at
                          ? <Badge tone="good">برگردانده شد</Badge>
                          : <button className="btn btn-sm" onClick={() => setRestore(c)}>بازگرداندن</button>}
                      </Cell>
                    </Row>
                  ))}
                </Table>
              )
          )}
        </Card>
      )}

      {tab === 'errors' && (
        <Card
          title="خطاهایی که برنامه‌ها گزارش کرده‌اند"
          icon={<TriangleAlert className="h-4 w-4" />}
          action={<AppPicker value={errApp} onChange={setErrApp} withBoth />}
        >
          {errors.busy && !errors.data ? <Skeleton rows={4} /> : (
            (errors.data?.errors.length || 0) === 0
              ? <Empty title="خطایی گزارش نشده" />
              : (
                <Table head={['کِی', 'بخش', 'نسخه', 'سکو', 'حساب', 'پیام']}>
                  {(errors.data?.errors || []).map((e) => (
                    <Row key={e.id}>
                      <Cell>{moment(e.at)}</Cell>
                      <Cell mono>{e.app}</Cell>
                      <Cell mono>{e.app_version || e.version || '—'}</Cell>
                      <Cell mono>{e.platform || '—'}</Cell>
                      <Cell mono>{e.account_id || e.tenant_id || '—'}</Cell>
                      <Cell className="max-w-[22rem] truncate"><span title={e.message}>{e.message || '—'}</span></Cell>
                    </Row>
                  ))}
                </Table>
              )
          )}
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(restore)}
        title="بازگرداندنِ نسخهٔ بازنده"
        message="مقدارِ بازنده به‌شکلِ یک تغییرِ تازه از طرفِ سرور ثبت می‌شود و در دریافتِ بعدیِ همهٔ دستگاه‌ها می‌نشیند. چیزی پاک نمی‌شود و تاریخچه دست نمی‌خورد."
        onCancel={() => setRestore(null)}
        onConfirm={async () => {
          const c = restore;
          setRestore(null);
          if (!c) return;
          try {
            await api(`/api/account-admin/sync/conflicts/${c.id}/restore`, { body: {} });
            toast('برگردانده شد');
            await conflicts.reload();
            await devices.reload();
          } catch (e) {
            toast(e instanceof Error ? e.message : 'نشد', 'bad');
          }
        }}
      />
    </div>
  );
}
