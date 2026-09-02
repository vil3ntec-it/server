// ---------------------------------------------------------------------------
//  فهرستِ پروسه‌ها
//
//  به‌طورِ پیش‌فرض بر اساسِ CPU مرتب است، چون کسی این صفحه را باز نمی‌کند مگر
//  اینکه چیزی سرور را کند کرده باشد. جست‌وجو هم روی نام و هم روی فرمان کار
//  می‌کند: آدم «node» را می‌داند، PID را نه.
//
//  ردیفِ محافظت‌شده دکمهٔ کشتن ندارد — به‌جای اینکه دکمه باشد و بعد سرور
//  ۴۰۹ بدهد. مرزی که در رابط کاربری دیده نشود، دو بار توضیح می‌خواهد.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Cpu, RefreshCw, Search, ShieldCheck, Skull } from 'lucide-react';

import { api } from '../api';
import { useApp } from '../app-context';
import { Badge, Card, ConfirmDialog, Loading, toast } from '../components/ui';
import { ActionButton, Cell, Row, Table } from '../control/ui';
import type { Dict } from '../i18n';

type ProcRow = {
  pid: number;
  ppid: number;
  user: string;
  cpuPercent: number | null;
  cpuSeconds?: number;
  memPercent: number;
  rssBytes: number;
  state: string;
  uptimeSeconds: number;
  name: string;
  command: string;
  protectedPid: boolean;
};

type Sort = 'cpu' | 'memory' | 'pid' | 'name';

function bytes(n: number) {
  if (!n) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function uptime(seconds: number) {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

const STATE_KEY: Record<string, keyof Dict> = {
  running: 'prcRunning',
  sleeping: 'prcSleeping',
  waiting: 'prcWaiting',
  stopped: 'prcStopped',
  zombie: 'prcZombie',
  idle: 'prcIdle',
  unknown: 'prcUnknown',
};

/** zombie واقعاً بد است؛ خوابیده حالتِ عادیِ اکثرِ پروسه‌هاست، پس خنثی */
function stateTone(state: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (state === 'running') return 'good';
  if (state === 'zombie') return 'bad';
  if (state === 'stopped' || state === 'waiting') return 'warn';
  return 'neutral';
}

export default function ProcessesPage() {
  const { t, role } = useApp();
  const canKill = role === 'admin';

  const [rows, setRows] = useState<ProcRow[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('cpu');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ row: ProcRow; signal: 'TERM' | 'KILL' } | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ sort, limit: '300' });
      if (query.trim()) params.set('q', query.trim());
      const res = await api<{ items: ProcRow[]; total: number }>(`/api/processes?${params}`);
      setRows(res.items ?? []);
      setTotal(res.total ?? 0);
      setError(null);
    } catch (e) {
      setError((e as Error).message || t('prcFailed'));
    } finally {
      setLoading(false);
    }
  }, [query, sort, t]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);

  async function doKill(row: ProcRow, signal: 'TERM' | 'KILL') {
    try {
      await api(`/api/processes/${row.pid}/kill`, { method: 'POST', body: { signal } });
      toast(t('prcSignalSent'));
      // یک لحظه فرصت تا پروسه واقعاً برود، بعد فهرستِ تازه
      setTimeout(() => void load(), 600);
    } catch (e) {
      toast((e as Error).message || t('prcFailed'), 'bad');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">
            <Cpu className="h-5 w-5" />
            {t('processes')}
          </h1>
          <p className="page-sub">{t('prcShowing', { shown: rows.length, total })}</p>
        </div>
        <button className="btn btn-sm" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t('refresh')}
        </button>
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-4 w-4 text-ink-muted" />
            <input
              className="input ps-8"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('prcSearch')}
            />
          </div>
          <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="cpu">{t('prcSortCpu')}</option>
            <option value="memory">{t('prcSortMemory')}</option>
            <option value="pid">PID</option>
            <option value="name">{t('prcSortName')}</option>
          </select>
        </div>

        {loading && !rows.length ? (
          <Loading />
        ) : error ? (
          <p className="py-10 text-center text-sm" style={{ color: 'var(--status-critical)' }}>{error}</p>
        ) : (
          <Table
            empty={!rows.length}
            head={['PID', t('prcName'), t('prcUser'), 'CPU', t('prcMemory'), t('prcState'), t('prcUptime'), '']}
          >
            {rows.map((row) => (
              <Row key={row.pid}>
                <Cell mono className="tnum text-ink-soft">{row.pid}</Cell>
                <Cell>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-ink">{row.name}</span>
                    {row.protectedPid && (
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                    )}
                  </div>
                  <div className="ltr max-w-[26rem] truncate font-mono text-[11px] text-ink-muted" title={row.command}>
                    {row.command}
                  </div>
                </Cell>
                <Cell className="text-ink-soft">{row.user || '—'}</Cell>
                <Cell mono className="tnum">
                  {row.cpuPercent != null ? `${row.cpuPercent.toFixed(1)}%` : row.cpuSeconds != null ? `${row.cpuSeconds.toFixed(0)}s` : '—'}
                </Cell>
                <Cell mono className="tnum text-ink-soft">{bytes(row.rssBytes)}</Cell>
                <Cell><Badge tone={stateTone(row.state)}>{STATE_KEY[row.state] ? t(STATE_KEY[row.state]) : row.state}</Badge></Cell>
                <Cell mono className="tnum text-ink-soft">{uptime(row.uptimeSeconds)}</Cell>
                <Cell className="text-end">
                  {canKill && !row.protectedPid && (
                    <div className="flex justify-end gap-1">
                      <ActionButton
                        className="btn btn-sm btn-ghost"
                        onClick={() => setConfirm({ row, signal: 'TERM' })}
                        title={t('prcTerm')}
                      >
                        {t('prcTerm')}
                      </ActionButton>
                      <ActionButton
                        className="btn btn-sm btn-danger"
                        onClick={() => setConfirm({ row, signal: 'KILL' })}
                        title={t('prcKill')}
                      >
                        <Skull className="h-3.5 w-3.5" />
                      </ActionButton>
                    </div>
                  )}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(confirm)}
        danger
        title={confirm?.signal === 'KILL' ? t('prcKillTitle') : t('prcTermTitle')}
        message={
          confirm
            ? `${confirm.row.name} (PID ${confirm.row.pid}) — ${
                confirm.signal === 'KILL' ? t('prcKillBody') : t('prcTermBody')
              }`
            : ''
        }
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c) void doKill(c.row, c.signal);
        }}
      />
    </div>
  );
}
