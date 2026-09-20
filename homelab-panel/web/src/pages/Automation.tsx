// ---------------------------------------------------------------------------
//  موتورِ اتوماسیون — کارهای داخلیِ پنل (پشتیبان، پایش، نگهداری، دستیار)
//
//  فرقش با «زمان‌بندی» (Cron.tsx): آن‌جا فرمان‌های دلخواهِ خودِ کاربر است؛
//  این‌جا کارهایی که در کد تعریف شده‌اند و کاربر فقط روشن/خاموششان می‌کند،
//  دستی می‌دواند و تاریخچه‌شان را می‌بیند. هر ۱۵ ثانیه تازه می‌شود و هر
//  اجرای تمام‌شده هم از راه سوکت خبر می‌دهد.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Play, RefreshCw, Workflow } from 'lucide-react';

import { api } from '../api';
import { useApp } from '../app-context';
import { Badge, Card, Loading, toast } from '../components/ui';
import { ActionButton, Cell, Notice, Row, Table, Tabs } from '../control/ui';

type Job = {
  name: string;
  title: string;
  description: string;
  schedule: string | null;
  every: number | null;
  event: string | null;
  trigger: 'schedule' | 'interval' | 'event' | 'manual';
  timeout: number;
  attempts: number;
  quiet: boolean;
  enabled: boolean;
  running: boolean;
  runningSince: number | null;
  last_run_at: number | null;
  last_status: string | null;
  last_duration_ms: number | null;
  next_run_at: number | null;
};

type RunRow = {
  id: number;
  job: string;
  trigger: string;
  started_at: number;
  finished_at: number | null;
  duration_ms: number | null;
  status: string;
  attempts: number;
  error: string | null;
  output: string | null;
  payload: unknown;
};

type EventRow = { id: number; name: string; source: string; payload: Record<string, unknown>; at: number };

const REFRESH_MS = 15_000;
const fmt = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString('fa-IR') : '—');
const dur = (ms: number | null | undefined) => (ms == null ? '—' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);

function statusTone(s: string | null | undefined): 'neutral' | 'good' | 'warn' | 'bad' | 'info' {
  if (s === 'ok') return 'good';
  if (s === 'failed' || s === 'timeout') return 'bad';
  if (s === 'skipped') return 'warn';
  if (s === 'running') return 'info';
  return 'neutral';
}

export default function AutomationPage() {
  const { t, role, socket } = useApp();
  const canManage = role === 'admin';

  const [tab, setTab] = useState<'jobs' | 'runs' | 'events'>('jobs');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, RunRow[]>>({});
  const [recent, setRecent] = useState<RunRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);

  const statusLabel = useCallback((s: string | null | undefined) => {
    if (s === 'ok') return t('autoStatusOk');
    if (s === 'failed') return t('autoStatusFailed');
    if (s === 'timeout') return t('autoStatusTimeout');
    if (s === 'skipped') return t('autoStatusSkipped');
    if (s === 'running') return t('autoStatusRunning');
    return t('autoNeverRan');
  }, [t]);

  const triggerLabel = useCallback((r: string) => {
    if (r === 'scheduled') return t('autoTriggerScheduled');
    if (r === 'event') return t('autoTriggerEvent');
    return t('autoTriggerManual');
  }, [t]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await api<{ items: Job[]; enabled: boolean }>('/api/automation/jobs');
      setJobs(res.items ?? []);
      setEnabled(res.enabled !== false);
      if (tab === 'runs') setRecent((await api<{ items: RunRow[] }>('/api/automation/runs?limit=60')).items ?? []);
      if (tab === 'events') setEvents((await api<{ items: EventRow[] }>('/api/automation/events?limit=60')).items ?? []);
    } catch (e) {
      if (!quiet) toast((e as Error).message, 'bad');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  const loadRuns = useCallback(async (name: string) => {
    try {
      const res = await api<{ items: RunRow[] }>(`/api/automation/jobs/${name}/runs?limit=20`);
      setRuns((prev) => ({ ...prev, [name]: res.items ?? [] }));
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!socket) return;
    const onRun = (r: { job: string }) => {
      void load(true);
      if (open === r.job) void loadRuns(r.job);
    };
    socket.on('automation:run', onRun);
    return () => { socket.off('automation:run', onRun); };
  }, [socket, load, loadRuns, open]);

  async function toggle(job: Job) {
    try {
      await api(`/api/automation/jobs/${job.name}`, { method: 'PATCH', body: { enabled: !job.enabled } });
      toast(job.enabled ? t('autoTurnedOff') : t('autoTurnedOn'));
      await load(true);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  async function runNow(job: Job) {
    try {
      const res = await api<{ status: string; error?: string; durationMs?: number }>(`/api/automation/jobs/${job.name}/run`, { method: 'POST' });
      toast(res.status === 'ok' ? t('autoRan', { d: dur(res.durationMs ?? null) }) : `${statusLabel(res.status)}${res.error ? ` — ${res.error}` : ''}`, res.status === 'ok' ? 'good' : 'bad');
    } catch (e) {
      const msg = (e as Error).message;
      toast(/already_running|409/.test(msg) ? t('autoBusy') : msg, 'bad');
    }
    await load(true);
    if (open === job.name) await loadRuns(job.name);
  }

  async function expand(job: Job) {
    if (open === job.name) { setOpen(null); return; }
    setOpen(job.name);
    await loadRuns(job.name);
  }

  const when = (job: Job) => {
    if (job.trigger === 'schedule') return <span className="ltr font-mono text-xs">{job.schedule}</span>;
    if (job.trigger === 'interval') return t('autoEvery', { s: Math.round((job.every ?? 0) / 1000) });
    if (job.trigger === 'event') return <span>{t('autoOnEvent')} <span className="ltr font-mono text-xs">{job.event}</span></span>;
    return t('autoManualOnly');
  };

  const runList = (list: RunRow[], withJob = false) => (
    <div className="space-y-2">
      {list.map((run) => (
        <details key={run.id} className="rounded-lg border border-line bg-surface-raised p-2">
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-[12.5px]">
            <Badge tone={statusTone(run.status)}>{statusLabel(run.status)}</Badge>
            {withJob && <span className="font-medium text-ink">{jobs.find((j) => j.name === run.job)?.title ?? run.job}</span>}
            <span className="tnum text-ink-soft">{fmt(run.started_at)}</span>
            <span className="tnum text-ink-muted">{dur(run.duration_ms)}</span>
            <Badge tone="neutral">{triggerLabel(run.trigger)}</Badge>
            {run.attempts > 1 && <span className="text-[11px] text-ink-muted">{t('autoAttempts', { n: run.attempts })}</span>}
            {run.error && <span className="truncate text-[11px] text-ink-muted" title={run.error}>{run.error}</span>}
          </summary>
          <pre className="ltr mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 font-mono text-[11px] text-ink-soft">
            {run.output || run.error || '—'}
          </pre>
        </details>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">
            <Workflow className="h-5 w-5" />
            {t('automation')}
          </h1>
          <p className="page-sub">{t('autoSub')}</p>
        </div>
        <button className="btn btn-sm" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t('refresh')}
        </button>
      </div>

      {!enabled ? <Notice tone="warn">{t('autoOff')}</Notice> : <Notice tone="info">{t('autoIntro')}</Notice>}

      <Tabs
        active={tab}
        onChange={(id) => setTab(id as typeof tab)}
        tabs={[
          { id: 'jobs', label: t('autoTabJobs'), badge: jobs.filter((j) => j.running).length },
          { id: 'runs', label: t('autoTabRuns') },
          { id: 'events', label: t('autoTabEvents') },
        ]}
      />

      {loading ? (
        <Card><Loading /></Card>
      ) : tab === 'jobs' ? (
        <Card>
          <Table empty={!jobs.length} head={[t('autoJob'), t('autoTrigger'), t('autoLast'), t('autoNext'), '']}>
            {jobs.map((job) => (
              <RowGroup key={job.name}>
                <Row>
                  <Cell>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-ink">{job.title}</span>
                      {!job.enabled && <Badge tone="neutral">{t('autoDisabled')}</Badge>}
                      {job.running && <Badge tone="info">{t('autoStatusRunning')}</Badge>}
                    </div>
                    <div className="max-w-[28rem] text-[11px] text-ink-muted">{job.description}</div>
                  </Cell>
                  <Cell className="text-ink-soft">{when(job)}</Cell>
                  <Cell>
                    {job.last_run_at ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={statusTone(job.last_status)}>{statusLabel(job.last_status)}</Badge>
                        <span className="tnum text-[11px] text-ink-muted">{fmt(job.last_run_at)}</span>
                        <span className="tnum text-[11px] text-ink-muted">{dur(job.last_duration_ms)}</span>
                      </div>
                    ) : (
                      <span className="text-ink-muted">{t('autoNeverRan')}</span>
                    )}
                  </Cell>
                  <Cell className="tnum text-ink-soft">{job.enabled && job.next_run_at ? fmt(job.next_run_at) : '—'}</Cell>
                  <Cell className="text-end">
                    <div className="flex justify-end gap-1">
                      <ActionButton className="btn btn-sm btn-ghost" onClick={() => expand(job)} title={t('autoHistory')}>
                        {open === job.name ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </ActionButton>
                      {canManage && (
                        <>
                          <ActionButton className="btn btn-sm" busyLabel="…" onClick={() => runNow(job)} title={t('autoRun')}>
                            <Play className="h-3.5 w-3.5" />
                            {t('autoRun')}
                          </ActionButton>
                          <ActionButton className="btn btn-sm" onClick={() => toggle(job)}>
                            {job.enabled ? t('autoTurnOff') : t('autoTurnOn')}
                          </ActionButton>
                        </>
                      )}
                    </div>
                  </Cell>
                </Row>
                {open === job.name && (
                  <tr className="border-b border-line/60">
                    <td colSpan={5} className="bg-surface px-3 py-3">
                      {runs[job.name]?.length ? runList(runs[job.name]) : <p className="text-center text-sm text-ink-muted">{t('autoNoRuns')}</p>}
                    </td>
                  </tr>
                )}
              </RowGroup>
            ))}
          </Table>
        </Card>
      ) : tab === 'runs' ? (
        <Card title={t('autoTabRuns')}>
          {recent.length ? runList(recent, true) : <p className="py-6 text-center text-sm text-ink-muted">{t('autoNoRuns')}</p>}
        </Card>
      ) : (
        <Card title={t('autoTabEvents')}>
          <Table empty={!events.length} head={[t('autoEvent'), t('autoSource'), t('autoPayload'), t('autoAt')]}>
            {events.map((ev) => (
              <Row key={ev.id}>
                <Cell mono className="ltr">{ev.name}</Cell>
                <Cell mono className="ltr text-ink-soft">{ev.source}</Cell>
                <Cell mono className="ltr max-w-[24rem] truncate text-ink-muted" style={{ maxWidth: '24rem' }}>{JSON.stringify(ev.payload)}</Cell>
                <Cell className="tnum text-ink-soft">{fmt(ev.at)}</Cell>
              </Row>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

/** دو ردیفِ جدول (کار + تاریخچهٔ بازشده) زیرِ یک کلید */
function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
