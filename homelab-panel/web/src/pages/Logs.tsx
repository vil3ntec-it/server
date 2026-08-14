import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ScrollText, Trash2 } from 'lucide-react';
import { useApp } from '../app-context';
import { api } from '../api';
import type { EventRow } from '../types';
import { Badge, Card, ConfirmDialog, Empty, Loading } from '../components/ui';
import { dateTime } from '../format';

export default function Logs() {
  const { t, lang } = useApp();
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [level, setLevel] = useState<'all' | 'error' | 'warn' | 'info'>('all');
  const [clearOpen, setClearOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await api<{ events: EventRow[]; counts: Record<string, number> }>(
      `/api/logs?limit=400${level === 'all' ? '' : `&level=${level}`}`
    );
    setEvents(res.events);
    setCounts(res.counts);
  }, [level]);

  useEffect(() => {
    load().catch(() => setEvents([]));
    const timer = setInterval(() => load().catch(() => {}), 10000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-base font-semibold">{t('logs')}</h1>
        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={() => load()}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t('refresh')}
          </button>
          <button className="btn btn-danger btn-sm" onClick={() => setClearOpen(true)}>
            <Trash2 className="h-3.5 w-3.5" />
            {t('clearLogs')}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(['all', 'error', 'warn', 'info'] as const).map((l) => (
          <button key={l} className={`btn btn-sm ${level === l ? 'btn-primary' : ''}`} onClick={() => setLevel(l)}>
            {l === 'all' ? t('all') : l === 'error' ? t('errors') : l === 'warn' ? t('warnings') : t('requests')}
            {l !== 'all' && counts[l] != null && <span className="tnum opacity-70">({counts[l]})</span>}
          </button>
        ))}
      </div>

      <Card className="!p-0">
        {!events ? (
          <Loading />
        ) : !events.length ? (
          <Empty icon={<ScrollText className="h-8 w-8" />} title={t('noLogs')} />
        ) : (
          <ul className="divide-y divide-line">
            {events.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-3 py-2.5">
                <Badge tone={e.level === 'error' ? 'bad' : e.level === 'warn' ? 'warn' : 'neutral'}>
                  {e.level === 'error' ? t('errors') : e.level === 'warn' ? t('warnings') : e.source}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm">{e.message}</p>
                  <p className="text-[11px] text-ink-muted">
                    {dateTime(e.created_at, lang)}
                    {e.site_name ? ` · ${e.site_name}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={clearOpen}
        danger
        title={t('clearLogs')}
        message={t('clearLogs')}
        onCancel={() => setClearOpen(false)}
        onConfirm={async () => {
          await api('/api/logs', { method: 'DELETE' });
          setClearOpen(false);
          load();
        }}
      />
    </div>
  );
}
