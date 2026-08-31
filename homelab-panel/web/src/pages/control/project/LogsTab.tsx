// ---------------------------------------------------------------------------
//  زبانهٔ لاگِ یک پروژه — پوشهٔ logs/ همان پروژه، نه یک قدم آن‌طرف‌تر
//  رمز، توکن و کدِ یک‌بارمصرف پیش از نوشتن پوشانده می‌شوند.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ScrollText, Search } from 'lucide-react';
import { useApp } from '../../../app-context';
import { Card, Empty, Loading, toast } from '../../../components/ui';
import { bytes, dateTime } from '../../../format';
import { api } from '../../../api';
import type { ProjectBundle } from '../../../control/api';
import { ActionButton, Select } from '../../../control/ui';

type LogFile = { name: string; category: string; size: number; modified: number };
type LogRow = { at: string | null; level: string; category?: string; message: string; detail?: unknown };

const LEVEL_COLOR: Record<string, string> = {
  error: 'var(--status-critical)',
  warn: 'var(--status-warning)',
  info: 'var(--series-1)',
  debug: 'var(--text-muted)',
};

export default function LogsTab({ bundle }: { bundle: ProjectBundle }) {
  const { t, lang } = useApp();
  const id = bundle.project.project_id;
  const [files, setFiles] = useState<LogFile[]>([]);
  const [dir, setDir] = useState('');
  const [active, setActive] = useState('');
  const [rows, setRows] = useState<LogRow[]>([]);
  const [level, setLevel] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const loadFiles = useCallback(async () => {
    try {
      const res = await api<{ files: LogFile[]; dir: string }>(`/api/control/storage/projects/${id}/logs`);
      setFiles(res.files);
      setDir(res.dir);
      setActive((prev) => prev || res.files[0]?.name || '');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadRows = useCallback(async () => {
    if (!active) {
      setRows([]);
      return;
    }
    try {
      const params = new URLSearchParams({ lines: '400' });
      if (level) params.set('level', level);
      if (query) params.set('q', query);
      const res = await api<{ rows: LogRow[] }>(
        `/api/control/storage/projects/${id}/logs/${encodeURIComponent(active)}?${params}`
      );
      setRows(res.rows);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }, [id, active, level, query]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  if (loading) return <Loading />;

  return (
    <Card
      title={t('ccLogs')}
      icon={<ScrollText className="h-4 w-4" />}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={active}
            onChange={setActive}
            options={files.map((f) => ({ value: f.name, label: `${f.name} — ${bytes(f.size)}` }))}
            placeholder="—"
          />
          <Select
            value={level}
            onChange={setLevel}
            options={['error', 'warn', 'info', 'debug'].map((x) => ({ value: x, label: x }))}
            placeholder={t('all')}
          />
          <div className="relative">
            <Search className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-4 w-4 text-ink-muted" />
            <input className="input ps-9 py-1.5 text-xs" placeholder={t('ccSearch')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <ActionButton
            onClick={async () => {
              await loadFiles();
              await loadRows();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </ActionButton>
        </div>
      }
    >
      <p dir="ltr" className="mb-3 break-all font-mono text-[11px] text-ink-muted">{dir}</p>

      {files.length === 0 ? (
        <Empty icon={<ScrollText className="h-8 w-8" />} title={t('ccLogEmpty')} />
      ) : rows.length === 0 ? (
        <Empty title={t('ccNoItems')} />
      ) : (
        <ul className="space-y-1">
          {rows.map((row, i) => (
            <li key={i} className="rounded-lg border border-line px-2.5 py-1.5 text-xs">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="shrink-0 font-mono text-[10px] text-ink-muted">
                  {row.at ? dateTime(Date.parse(row.at), lang) : '—'}
                </span>
                <span className="chip shrink-0" style={{ background: `color-mix(in srgb, ${LEVEL_COLOR[row.level] || 'var(--text-muted)'} 15%, transparent)`, color: LEVEL_COLOR[row.level] || 'var(--text-muted)' }}>
                  {row.level}
                </span>
                <span className="min-w-0 flex-1 break-words">{row.message}</span>
              </div>
              {row.detail != null && (
                <pre dir="ltr" className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-surface-sunken p-1.5 font-mono text-[10px] text-ink-muted">
                  {JSON.stringify(row.detail)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
