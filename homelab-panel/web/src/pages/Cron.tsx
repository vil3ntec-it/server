// ---------------------------------------------------------------------------
//  کارهای زمان‌بندی‌شده
//
//  پیش‌نمایشِ «پنج اجرای بعدی» مهم‌ترین بخشِ این صفحه است. الگوی cron را کسی
//  با نگاه کردن نمی‌فهمد؛ «0 3 * * 1» یعنی چه، فقط وقتی معلوم می‌شود که
//  تاریخ‌های واقعی را ببینی. پس پیش‌نمایش همان‌جا و زنده است، نه پشتِ یک دکمه.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Play, Plus, RefreshCw, ScrollText, Trash2 } from 'lucide-react';

import { api } from '../api';
import { useApp } from '../app-context';
import { Badge, Card, ConfirmDialog, Field, Loading, Modal, toast } from '../components/ui';
import { ActionButton, Cell, Notice, Row, Table } from '../control/ui';

type Job = {
  id: number;
  name: string;
  schedule: string;
  command: string;
  cwd: string | null;
  enabled: boolean;
  last_run_at: number | null;
  last_ok: boolean | null;
  lastOk: boolean | null;
  last_ms: number | null;
  next_run_at: number | null;
};

type RunRow = { id: number; started_at: number; ms: number; exit_code: number | null; ok: boolean; output: string };

/** الگوهای رایج — تا کاربر مجبور نباشد نحوِ cron را یاد بگیرد */
const PRESETS: { label: string; value: string }[] = [
  { label: 'هر ساعت', value: '0 * * * *' },
  { label: 'هر شب ۳ بامداد', value: '0 3 * * *' },
  { label: 'هر ۱۵ دقیقه', value: '*/15 * * * *' },
  { label: 'هر دوشنبه ۲ بامداد', value: '0 2 * * 1' },
  { label: 'اولِ هر ماه', value: '0 0 1 * *' },
];

const fmt = (ms: number | null) => (ms ? new Date(ms).toLocaleString('fa-IR') : '—');

export default function CronPage() {
  const { t, role } = useApp();
  const canManage = role === 'admin';

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [systemLines, setSystemLines] = useState<string[]>([]);

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', schedule: '0 3 * * *', command: '', cwd: '' });
  const [preview, setPreview] = useState<{ next: number[]; error: string | null }>({ next: [], error: null });

  const [runsFor, setRunsFor] = useState<Job | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [confirm, setConfirm] = useState<Job | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ items: Job[] }>('/api/cron');
      setJobs(res.items ?? []);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    if (canManage) {
      api<{ supported: boolean; lines: string[] }>('/api/cron/system/crontab')
        .then((r) => setSystemLines(r.lines ?? []))
        .catch(() => setSystemLines([]));
    }
  }, [load, canManage]);

  // پیش‌نمایش با هر تغییرِ الگو، با کمی مکث تا هر حرف یک درخواست نزند
  useEffect(() => {
    if (!showNew) return;
    const timer = setTimeout(() => {
      api<{ next: number[] }>('/api/cron/preview', { method: 'POST', body: { schedule: form.schedule } })
        .then((r) => setPreview({ next: r.next ?? [], error: null }))
        .catch(() => setPreview({ next: [], error: t('cronBadSchedule') }));
    }, 300);
    return () => clearTimeout(timer);
  }, [form.schedule, showNew, t]);

  async function create() {
    try {
      await api('/api/cron', {
        method: 'POST',
        body: { name: form.name.trim(), schedule: form.schedule, command: form.command, cwd: form.cwd || null },
      });
      toast(t('cronCreated'));
      setShowNew(false);
      setForm({ name: '', schedule: '0 3 * * *', command: '', cwd: '' });
      await load();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  async function toggle(job: Job) {
    try {
      await api(`/api/cron/${job.id}`, { method: 'PATCH', body: { enabled: !job.enabled } });
      await load();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  async function runNow(job: Job) {
    try {
      const res = await api<{ exitCode: number }>(`/api/cron/${job.id}/run`, { method: 'POST' });
      toast(res.exitCode === 0 ? t('cronRanOk') : t('cronRanFailed', { code: res.exitCode }), res.exitCode === 0 ? 'good' : 'bad');
      await load();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  async function openRuns(job: Job) {
    setRunsFor(job);
    setRuns([]);
    try {
      const res = await api<{ items: RunRow[] }>(`/api/cron/${job.id}/runs?limit=20`);
      setRuns(res.items ?? []);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">
            <CalendarClock className="h-5 w-5" />
            {t('cron')}
          </h1>
          <p className="page-sub">{t('cronSub')}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t('refresh')}
          </button>
          {canManage && (
            <button className="btn btn-sm btn-primary" onClick={() => setShowNew(true)}>
              <Plus className="h-3.5 w-3.5" />
              {t('cronNew')}
            </button>
          )}
        </div>
      </div>

      <Notice tone="info">{t('cronPanelScheduler')}</Notice>

      {loading ? (
        <Card><Loading /></Card>
      ) : (
        <Card>
          <Table
            empty={!jobs.length}
            head={[t('cronName'), t('cronSchedule'), t('cronNext'), t('cronLast'), '']}
          >
            {jobs.map((job) => (
              <Row key={job.id}>
                <Cell>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-ink">{job.name}</span>
                    {!job.enabled && <Badge tone="neutral">{t('cronPaused')}</Badge>}
                  </div>
                  <div className="ltr max-w-[24rem] truncate font-mono text-[11px] text-ink-muted" title={job.command}>
                    {job.command}
                  </div>
                </Cell>
                <Cell mono className="ltr text-ink-soft">{job.schedule}</Cell>
                <Cell className="tnum text-ink-soft">{job.enabled ? fmt(job.next_run_at) : '—'}</Cell>
                <Cell>
                  {job.last_run_at ? (
                    <div className="flex items-center gap-1.5">
                      <Badge tone={job.lastOk ? 'good' : 'bad'}>{job.lastOk ? t('cronOk') : t('cronFailed')}</Badge>
                      <span className="tnum text-[11px] text-ink-muted">{fmt(job.last_run_at)}</span>
                    </div>
                  ) : (
                    <span className="text-ink-muted">{t('cronNeverRan')}</span>
                  )}
                </Cell>
                <Cell className="text-end">
                  <div className="flex justify-end gap-1">
                    <ActionButton className="btn btn-sm btn-ghost" onClick={() => openRuns(job)} title={t('cronHistory')}>
                      <ScrollText className="h-3.5 w-3.5" />
                    </ActionButton>
                    {canManage && (
                      <>
                        <ActionButton className="btn btn-sm" busyLabel="…" onClick={() => runNow(job)} title={t('cronRunNow')}>
                          <Play className="h-3.5 w-3.5" />
                        </ActionButton>
                        <ActionButton className="btn btn-sm" onClick={() => toggle(job)}>
                          {job.enabled ? t('cronPause') : t('cronResume')}
                        </ActionButton>
                        <ActionButton className="btn btn-sm btn-danger" onClick={() => setConfirm(job)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </ActionButton>
                      </>
                    )}
                  </div>
                </Cell>
              </Row>
            ))}
          </Table>
        </Card>
      )}

      {canManage && systemLines.length > 0 && (
        <Card title={t('cronSystem')} icon={<CalendarClock className="h-4 w-4" />}>
          <Notice tone="warn">{t('cronSystemHint')}</Notice>
          <pre className="ltr mt-2 overflow-x-auto rounded-lg bg-surface-raised p-3 font-mono text-xs text-ink-soft">
            {systemLines.join('\n')}
          </pre>
        </Card>
      )}

      {/* ---------------------------- کارِ تازه ---------------------------- */}

      <Modal
        open={showNew}
        onClose={() => setShowNew(false)}
        title={t('cronNew')}
        wide
        footer={
          <button className="btn btn-primary" disabled={!form.name.trim() || !form.command.trim()} onClick={() => void create()}>
            {t('add')}
          </button>
        }
      >
        <Field label={t('cronName')}>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>

        <Field label={t('cronCommand')} hint={t('cronCommandHint')}>
          <input className="input ltr" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} />
        </Field>

        <Field label={t('cronWorkdir')} hint={t('cronWorkdirHint')}>
          <input className="input ltr" value={form.cwd} onChange={(e) => setForm({ ...form, cwd: e.target.value })} />
        </Field>

        <Field label={t('cronSchedule')} hint="دقیقه ساعت روزِ‌ماه ماه روزِ‌هفته">
          <input className="input ltr" value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} />
        </Field>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.value} className="btn btn-sm" onClick={() => setForm({ ...form, schedule: p.value })}>
              {p.label}
            </button>
          ))}
        </div>

        {preview.error ? (
          <Notice tone="bad">{preview.error}</Notice>
        ) : preview.next.length > 0 ? (
          <div className="rounded-lg border border-line bg-surface-raised p-3">
            <p className="mb-1 text-[11px] font-semibold text-ink-muted">{t('cronNextRuns')}</p>
            <ul className="space-y-0.5 text-[12.5px] text-ink-soft">
              {preview.next.map((at) => (
                <li key={at} className="tnum">{new Date(at).toLocaleString('fa-IR')}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Modal>

      {/* ---------------------------- تاریخچه ---------------------------- */}

      <Modal open={Boolean(runsFor)} onClose={() => setRunsFor(null)} title={runsFor?.name ?? ''} wide>
        {runs.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">{t('cronNeverRan')}</p>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <details key={run.id} className="rounded-lg border border-line bg-surface-raised p-2">
                <summary className="flex cursor-pointer items-center gap-2 text-[12.5px]">
                  <Badge tone={run.ok ? 'good' : 'bad'}>{run.ok ? t('cronOk') : `${run.exit_code}`}</Badge>
                  <span className="tnum text-ink-soft">{fmt(run.started_at)}</span>
                  <span className="tnum text-ink-muted">{run.ms}ms</span>
                </summary>
                <pre className="ltr mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 font-mono text-[11px] text-ink-soft">
                  {run.output || '—'}
                </pre>
              </details>
            ))}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        danger
        title={t('cronDeleteTitle')}
        message={`${confirm?.name ?? ''} — ${t('cronDeleteBody')}`}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const job = confirm;
          setConfirm(null);
          if (!job) return;
          try {
            await api(`/api/cron/${job.id}`, { method: 'DELETE' });
            toast(t('cronDeleted'));
            await load();
          } catch (e) {
            toast((e as Error).message, 'bad');
          }
        }}
      />
    </div>
  );
}
