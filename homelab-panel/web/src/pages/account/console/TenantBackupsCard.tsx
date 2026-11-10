// ---------------------------------------------------------------------------
//  🗄️ پشتیبان‌های **یک** حساب (دکان یا پمپ) — فقط فهرست و سهم (۱.۵۰.۸۰، S11 «هم‌ترازی با ‎/admin/‎»)
//
//  ⚠️ این با «پشتیبانِ سرورِ حساب» (`BackupsCard`، ‎pg_dump‎ ِ کلِ دیتابیس) یکی **نیست**: این پرونده‌هایی است که برنامهٔ خودِ همین
//     دکان روی سرورِ حساب گذاشته. ⛔ همه از `GET /console/accounts/:app/:tenantId/backups` ⇐ همان درِ سرورِ حساب؛ هیچ عددی این‌جا
//     ساخته نمی‌شود (نیامده ⇒ «—»). برچسب و نام متن‌اند (React گریز می‌دهد).
//  ⛔ دانلود (خروجیِ دادهٔ خصوصیِ مشتری) و حذف (دائمی) از پنل **نیستند** — تصمیمِ مالک؛ صادقانه گفته می‌شود، نه دکمهٔ بی‌عمل.
// ---------------------------------------------------------------------------
import { type ReactNode } from 'react';
import { Archive } from 'lucide-react';

import { Card } from '../../../components/ui';
import { Cell, KV, Row, Table } from '../../../control/ui';
import { useLoad, type Load } from '../shared';
import { Problem, SourceLine } from '../ShopConsole';
import { bytes, shown } from '../consoleData';
import { NotSupported, StateEmpty, StateLoading, fmtTime } from './parts';
import { useTx } from './text';

type Backup = { id: string; bytes: number | null; sha256: string; label: string; kind: string; appVersion: string; createdAt: number | null; name: string };
type Stats = { count: number | null; usedBytes: number | null; lastAt: number | null; keep: number | null; quotaBytes: number | null;
  maxBytes: number | null; freeBytes: number | null; paid: boolean | null; source: string };
type Doc = { app: string; backups: Backup[]; stats: Stats; fetchedAt?: number };

export const tenantBackupsApi = (app: string, tenantId: string, limit = 50) =>
  `/api/account-admin/console/accounts/${encodeURIComponent(app)}/${encodeURIComponent(tenantId)}/backups?limit=${limit}`;

export default function TenantBackupsCard({ app, tenantId }: { app: 'shop' | 'pump'; tenantId: string }) {
  const tx = useTx();
  const load = useLoad<Doc>(tenantBackupsApi(app, tenantId), [app, tenantId]);
  const title = tx('پشتیبان‌های همین حساب', 'This account’s backups', 'د دې حساب بیک‌اپونه');
  const wrap = (body: ReactNode) => <div data-card="tenant-backups"><Card title={title} icon={<Archive size={15} />}>{body}</Card></div>;
  if (load.error) return wrap(<Problem load={load as Load<unknown>} />);
  if (!load.data) return wrap(<StateLoading />);
  const d = load.data;
  const st = d.stats || ({} as Stats);
  const rows = Array.isArray(d.backups) ? d.backups : [];
  const kind = (k: string) => (k === 'auto' ? tx('خودکار', 'Automatic', 'اتومات') : k === 'manual' ? tx('دستی', 'Manual', 'لاسي') : k || '—');
  const tier = st.paid === null || st.paid === undefined ? '—'
    : st.paid ? tx('با اشتراک', 'Subscribed', 'له ګډون سره') : tx('رایگان', 'Free', 'وړیا');
  return wrap(
    <>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <KV label={tx('شمار', 'Count', 'شمېر')}>{shown(st.count)}</KV>
        <KV label={tx('آخرین پشتیبان', 'Last backup', 'وروستی بیک‌اپ')}>{fmtTime(st.lastAt)}</KV>
        <KV label={tx('فضای گرفته / سهم', 'Used / quota', 'کارول شوی / برخه')}><span dir="ltr">{bytes(st.usedBytes)} / {bytes(st.quotaBytes)}</span></KV>
        <KV label={tx('نگه‌داری', 'Kept', 'ساتل')}>{st.keep === null || st.keep === undefined ? '—' : tx('{n} تای آخر', 'last {n}', 'وروستي {n}', { n: shown(st.keep) })}</KV>
        <KV label={tx('پله', 'Tier', 'کچه')}>{tier}{st.source ? <span className="text-ink-muted" dir="ltr"> · {st.source}</span> : null}</KV>
        <KV label={tx('سقفِ هر پرونده', 'Max per file', 'د هرې دوسیې حد')}><span dir="ltr">{bytes(st.maxBytes)}</span></KV>
      </div>
      {rows.length === 0 ? <StateEmpty>{tx('این حساب هنوز پشتیبانی روی سرورِ حساب ندارد', 'This account has no backups on the account server yet', 'دا حساب لا بیک‌اپ نه لري')}</StateEmpty> : (
        <Table head={[tx('کی', 'When', 'کله'), tx('نام', 'Name', 'نوم'), tx('برچسب', 'Label', 'نښه'), tx('گونه', 'Kind', 'ډول'), tx('نسخهٔ برنامه', 'App version', 'د اپ نسخه'), tx('اندازه', 'Size', 'کچه'), 'SHA-256']}>
          {rows.map((b) => (
            <Row key={b.id}>
              <Cell>{fmtTime(b.createdAt)}</Cell>
              <Cell mono><span dir="ltr">{b.name || '—'}</span></Cell>
              <Cell><span data-backup-label>{b.label || '—'}</span></Cell>
              <Cell>{kind(b.kind)}</Cell>
              <Cell mono><span dir="ltr">{b.appVersion || '—'}</span></Cell>
              <Cell mono><span dir="ltr">{bytes(b.bytes)}</span></Cell>
              <Cell mono><span dir="ltr" title={b.sha256 || undefined}>{b.sha256 ? `${b.sha256.slice(0, 12)}…` : '—'}</span></Cell>
            </Row>
          ))}
        </Table>
      )}
      <div className="mt-2">
        <NotSupported needs="GET|DELETE /api/admin/accounts/:app/:tenantId/backups/:id">
          {tx('دانلودِ پشتیبانِ مشتری (خروجیِ همهٔ دادهٔ خصوصیِ او) و حذفِ دائمیِ آن از پنل نیست — تصمیمِ مالکِ سامانه است.',
            'Downloading a customer backup (an export of all their private data) and deleting it permanently are not in the panel — that is the system owner’s decision.',
            'د پېرودونکي بیک‌اپ ښکته کول او تل‌پاتې ړنګول په پینل کې نشته — د خاوند پرېکړه ده.')}
        </NotSupported>
      </div>
      <SourceLine source="/api/admin/accounts/:app/:tenantId/backups" data={d} at={load.at} />
    </>,
  );
}
