// ---------------------------------------------------------------------------
//  ۴.۹ — پشتیبانِ خودِ سرورِ حساب (۱.۵۰.۷۴، ممیزی §۳-۴): تا امروز فقط در کنسولِ وبِ سرورِ حساب (`/admin/`).
//
//  ⛔ فهرست، رمزنگاری و آخرین تمرینِ بازیابی از `GET /console/backups` (پل نامِ پرونده می‌دهد، نه پوشهٔ میزبان).
//     نیامده ⇒ «—»، نه صفر؛ خطای بالادست با کدِ خودش؛ بی رمزنگاری ⇒ هشدارِ سرخِ خودِ سرورِ حساب، نه سبزِ ساختگی.
//  ⛔ «پشتیبانِ دستی»: فقط admin (مرز در سرور است؛ دکمه فقط برای درخواستِ بی‌نتیجه نزدن پنهان می‌شود) + دلیل + تأیید +
//     **یک** کلیدِ یکتایی برای همین پنجره (`SensitiveDialog`) — پل دوبار زدن و هم‌زمانی را یک pg_dump می‌کند.
//  ⛔ (۱.۵۰.۷۵) pg_dump ِ کُندتر از مهلتِ بلندِ پل ⇒ «نتیجه معلوم نیست» (زرد) و فهرست دوباره خوانده می‌شود — نه «شکست».
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { HardDrive } from 'lucide-react';

import { api } from '../../../api';
import { Card, Loading } from '../../../components/ui';
import { useApp } from '../../../app-context';
import { Cell, Notice, Row, Table } from '../../../control/ui';
import { useLoad, type Load } from '../shared';
import { Problem, SourceLine } from '../ShopConsole';
import { bytes, shown } from '../consoleData';
import { SensitiveDialog } from './parts';
import { useTx } from './text';

type Backup = { kind: string; file: string; bytes: number | null; createdAt: number | null; encrypted: boolean; sha256: string };
type Drill = { at: number | null; ok: boolean; restoredMs: number | null; backupAgeMs: number | null; withinTargets: boolean | null; error: string | null };
type Backups = {
  available: boolean; fetchedAt: number; enabled: boolean | null; backups: Backup[];
  encryption: { configured: boolean; required: boolean; warning: string };
  drill: { last: Drill | null; lastOkAt: number | null; count: number | null } | null;
};

const when = (ms: unknown) => {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0
    ? new Date(n).toLocaleString('fa-AF', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';
};
const secs = (ms: unknown) => (Number.isFinite(Number(ms)) && ms !== null ? `${shown(Math.round(Number(ms) / 1000))}s` : '—');

export default function BackupsCard() {
  const tx = useTx();
  const { can } = useApp();
  const load = useLoad<Backups>('/api/account-admin/console/backups');
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Backup | null>(null);
  const d = load.data;
  const rows = Array.isArray(d?.backups) ? d!.backups : [];
  const last = d?.drill?.last || null;

  return (
    <Card title={tx('پشتیبانِ سرورِ حساب', 'Account-server backups', 'د حساب سرور بیک‌اپ')} icon={<HardDrive size={16} />}>
      {load.error ? <Problem load={load as Load<unknown>} /> : !d ? <Loading /> : (
        <div className="space-y-3" data-card="account-backups">
          {!d.encryption.configured && (
            <Notice tone="bad">
              {tx('پشتیبان‌های سرورِ حساب رمز ندارند', 'Account-server backups are not encrypted', 'د حساب سرور بیک‌اپونه رمز نه لري')}
              {d.encryption.warning ? ` — ${d.encryption.warning}` : ''}
            </Notice>
          )}
          {d.enabled === false && (
            <Notice tone="warn">{tx('پشتیبانِ خودکار خاموش است', 'Automatic backups are off', 'اتومات بیک‌اپ بند دی')}</Notice>
          )}
          <p className="text-xs text-ink-muted">
            {tx('آخرین تمرینِ بازیابی', 'Last restore drill', 'وروستۍ د بیا راګرځولو تمرین')}: {when(last?.at)}
            {last ? ` · ${last.ok ? tx('موفق', 'passed', 'بریالی') : `${tx('ناموفق', 'failed', 'ناکام')}${last.error ? ` (${last.error})` : ''}`}` : ''}
            {last ? ` · RTO ${secs(last.restoredMs)} · RPO ${secs(last.backupAgeMs)}` : ''}
            {' · '}{tx('آخرین موفق', 'last passed', 'وروستی بریالی')}: {when(d.drill?.lastOkAt)}
          </p>
          <Table
            head={[tx('کِی', 'When', 'کله'), tx('نوع', 'Kind', 'ډول'), tx('پرونده', 'File', 'دوتنه'), tx('اندازه', 'Size', 'کچه'), tx('رمز', 'Encrypted', 'رمز')]}
            empty={rows.length === 0}
          >
            {rows.slice(0, 20).map((b) => (
              <Row key={`${b.kind}/${b.file}`}>
                <Cell>{when(b.createdAt)}</Cell>
                <Cell mono>{b.kind || '—'}</Cell>
                <Cell mono>{b.file || '—'}</Cell>
                <Cell>{b.bytes === null ? '—' : bytes(b.bytes)}</Cell>
                <Cell>{b.encrypted ? tx('دارد', 'yes', 'هو') : tx('ندارد', 'no', 'نه')}</Cell>
              </Row>
            ))}
          </Table>
          {rows.length > 20 && <p className="text-[11px] text-ink-muted">{tx('۲۰ تای آخر از {n}', 'Last 20 of {n}', 'وروستي ۲۰ له {n}', { n: shown(rows.length) })}</p>}
          {done && (
            <Notice tone="good">
              {tx('تأییدشده از سرورِ حساب: پشتیبانِ تازه ساخته شد', 'Confirmed by the account server: a new backup was made', 'د حساب سرور تایید: نوی بیک‌اپ جوړ شو')}
              {' — '}<code dir="ltr">{done.file}</code> · {done.bytes === null ? '—' : bytes(done.bytes)}
            </Notice>
          )}
          {can('admin') && (
            <button className="btn btn-sm" onClick={() => { setDone(null); setOpen(true); }}>
              {tx('پشتیبانِ دستی', 'Manual backup', 'لاسي بیک‌اپ')}
            </button>
          )}
          <SourceLine source="/api/admin/backups" data={d} at={load.at} />
        </div>
      )}
      {open && (
        <SensitiveDialog
          title={tx('پشتیبانِ دستیِ سرورِ حساب', 'Manual account-server backup', 'د حساب سرور لاسي بیک‌اپ')}
          effect={tx(
            'سرورِ حساب همین حالا از پایگاهش یک پشتیبانِ «دستی» می‌سازد (چند ثانیه تا چند دقیقه). چیزی پاک یا عوض نمی‌شود؛ پشتیبان‌های دستیِ کهنه‌تر از ۵۰ تای آخر خودِ سرورِ حساب هرس می‌کند.',
            'The account server makes a “manual” backup of its database now (seconds to minutes). Nothing is deleted or changed; the account server itself prunes manual backups beyond the last 50.',
            'د حساب سرور همدا اوس د خپل ډیټابېس «لاسي» بیک‌اپ جوړوي (له ثانیو تر دقیقو). هېڅ نه ړنګېږي او نه بدلېږي؛ له وروستیو ۵۰ ها خوا لاسي بیک‌اپونه پخپله د حساب سرور پاکوي.',
          )}
          onClose={() => setOpen(false)}
          //  ⛔ مهلتِ بلندِ پل گذشت ⇒ «نامعلوم» (نه «شکست»): فهرست همان دم از سرورِ حساب دوباره خوانده می‌شود تا آدم ببیند ساخته شد یا نه
          onUnknown={() => { void load.reload(); }}
          onSubmit={async ({ reason, idempotencyKey }) => {
            const out = await api<{ backup: Backup }>('/api/account-admin/console/backups', { body: { reason, confirm: true, idempotencyKey } });
            setOpen(false);
            setDone(out.backup);
            await load.reload();
          }}
        />
      )}
    </Card>
  );
}
