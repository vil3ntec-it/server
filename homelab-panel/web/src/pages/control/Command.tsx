// ---------------------------------------------------------------------------
//  مرکز فرمان — صفحهٔ اول: یک نگاه، همه‌چیز
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, Boxes, Cloud, Database, Download, Globe, HardDrive,
  KeyRound, RefreshCw, Server, ShieldCheck, Users, Waypoints,
} from 'lucide-react';
import { useApp } from '../../app-context';
import { Card, Empty, Loading, toast } from '../../components/ui';
import { bytes, dateOnly, relative } from '../../format';
import { cc } from '../../control/api';
import type { Overview } from '../../control/types';
import { ActionButton, Stat, StatusPill, useLabels } from '../../control/ui';

export default function Command() {
  const { t, lang, socket } = useApp();
  const labels = useLabels();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setData(await cc.overview());
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // هشدارهای تازه و نتیجهٔ بررسی‌ها زنده می‌رسند
  useEffect(() => {
    if (!socket) return;
    const refresh = () => load();
    socket.on('control:alert', refresh);
    socket.on('control:alert-cleared', refresh);
    return () => {
      socket.off('control:alert', refresh);
      socket.off('control:alert-cleared', refresh);
    };
  }, [socket, load]);

  if (loading) return <Loading />;
  if (!data) return <Empty title={t('noData')} />;

  const { counts, monitors } = data;
  const endpointsOnline = counts.endpoints.byStatus?.online ?? 0;
  const endpointsDown = counts.endpoints.total - endpointsOnline - (counts.endpoints.byStatus?.unknown ?? 0);
  const serversOnline = counts.servers.byStatus?.online ?? 0;
  const tunnelsOnline = counts.tunnels.byStatus?.online ?? 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{t('ccCommand')}</h1>
          <p className="text-xs text-ink-muted">
            {data.panel.hostname} · {t('ccCurrentVersion')} {data.panel.version}
          </p>
        </div>
        <div className="flex gap-2">
          <ActionButton onClick={() => cc.runChecks().then(load)} busyLabel={t('ccTesting')}>
            <Activity className="h-4 w-4" />
            {t('ccRunChecks')}
          </ActionButton>
          <ActionButton onClick={load}>
            <RefreshCw className="h-4 w-4" />
            {t('refresh')}
          </ActionButton>
        </div>
      </header>

      {data.update.pending && (
        <Link to="/control/updates" className="card flex items-center gap-3 p-3.5 text-sm hover:brightness-105">
          <Download className="h-4 w-4 shrink-0" style={{ color: 'var(--series-1)' }} />
          <span className="min-w-0 flex-1">
            {t('ccUpdateAvailable')} — <b className="tnum">{data.update.pending.latest}</b>
          </span>
          <span className="btn btn-sm btn-primary">{t('ccUpdates')}</span>
        </Link>
      )}

      {!data.storage.chosen && (
        <Link to="/control/storage" className="card flex items-center gap-3 p-3.5 text-sm hover:brightness-105">
          <HardDrive className="h-4 w-4 shrink-0" style={{ color: 'var(--status-warning)' }} />
          <span className="min-w-0 flex-1">{t('ccChooseStorage')}</span>
          <span className="btn btn-sm">{t('ccStorage')}</span>
        </Link>
      )}

      {/* ──────────────── شمارنده‌ها ──────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={t('ccProjects')} value={counts.projects.total} icon={<Boxes className="h-4 w-4" />} sub={`${endpointsOnline}/${counts.endpoints.total} ${t('stOnline')}`} tone={endpointsDown > 0 ? 'warn' : 'good'} />
        <Stat label={t('ccServers')} value={`${serversOnline}/${counts.servers.total}`} icon={<Server className="h-4 w-4" />} tone={serversOnline === counts.servers.total ? 'good' : 'warn'} />
        <Stat label={t('ccTunnels')} value={`${tunnelsOnline}/${counts.tunnels.total}`} icon={<Waypoints className="h-4 w-4" />} tone={counts.tunnels.total === 0 ? undefined : tunnelsOnline === counts.tunnels.total ? 'good' : 'bad'} />
        <Stat label={t('domains')} value={counts.domains} icon={<Globe className="h-4 w-4" />} sub={`${counts.routes} ${t('ccRouting')}`} />
        <Stat label={t('ccAlerts')} value={counts.alerts.open} icon={<AlertTriangle className="h-4 w-4" />} tone={counts.alerts.critical > 0 ? 'bad' : counts.alerts.open > 0 ? 'warn' : 'good'} sub={counts.alerts.critical > 0 ? `${counts.alerts.critical} ${t('ccSeverity')}` : undefined} />
        <Stat label={t('ccBackups')} value={counts.backups} icon={<Database className="h-4 w-4" />} sub={data.lastBackups[0] ? relative(data.lastBackups[0].created_at, lang) : t('ccNever')} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ──────────────── پروژه‌ها ──────────────── */}
        <Card className="lg:col-span-2" title={t('ccProjects')} icon={<Boxes className="h-4 w-4" />} action={<Link className="btn btn-sm" to="/control/projects">{t('ccDetails')}</Link>}>
          {data.projects.length === 0 ? (
            <Empty title={t('ccNoItems')} hint={t('ccNewProject')} />
          ) : (
            <ul className="space-y-1.5">
              {data.projects.map((p) => (
                <li key={p.project_id}>
                  <Link
                    to={`/control/projects/${p.project_id}`}
                    className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 transition hover:bg-surface-raised"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: p.down > 0 ? 'var(--status-critical)' : p.online > 0 ? 'var(--status-good)' : 'var(--text-muted)' }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      <span className="block truncate text-[11px] text-ink-muted">
                        {labels.projectType(p.type)}
                        {p.server_name ? ` · ${p.server_name}` : ''}
                      </span>
                    </span>
                    <span className="tnum shrink-0 text-[11px] text-ink-muted">
                      {p.online}/{p.endpoints}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ──────────────── هشدارها ──────────────── */}
        <Card title={t('ccOpenAlerts')} icon={<AlertTriangle className="h-4 w-4" />} action={<Link className="btn btn-sm" to="/control/monitoring">{t('ccMonitoring')}</Link>}>
          {data.alerts.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-muted">{t('ccNoAlerts')}</p>
          ) : (
            <ul className="space-y-2">
              {data.alerts.slice(0, 8).map((a) => (
                <li key={a.id} className="rounded-xl border border-line p-2.5">
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: a.severity === 'critical' ? 'var(--status-critical)' : a.severity === 'warn' ? 'var(--status-warning)' : 'var(--series-1)' }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{a.title}</p>
                      <p className="truncate text-[11px] text-ink-muted">{relative(a.last_at, lang)}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ──────────────── سرورها ──────────────── */}
        <Card title={t('ccServers')} icon={<Server className="h-4 w-4" />} action={<Link className="btn btn-sm" to="/control/servers">{t('ccDetails')}</Link>}>
          <ul className="space-y-1.5">
            {data.servers.map((s) => (
              <li key={s.server_id} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{s.name}</span>
                  <span className="block truncate text-[11px] text-ink-muted">
                    {labels.serverKind(s.kind)}
                    {s.ip ? ` · ${s.ip}` : ''}
                  </span>
                </span>
                <StatusPill status={s.status} compact />
              </li>
            ))}
          </ul>
        </Card>

        {/* ──────────────── سلامتِ پایش ──────────────── */}
        <Card title={t('ccMonitoring')} icon={<Activity className="h-4 w-4" />}>
          {Object.keys(monitors).length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-muted">{t('ccNoItems')}</p>
          ) : (
            <ul className="space-y-2">
              {Object.entries(monitors).map(([kind, m]) => (
                <li key={kind} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-xs text-ink-soft">{kind}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--surface-2)' }}>
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${m.total ? (m.online / m.total) * 100 : 0}%`, background: 'var(--status-good)' }}
                    />
                  </span>
                  <span className="tnum w-12 shrink-0 text-end text-[11px] text-ink-muted">
                    {m.online}/{m.total}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ──────────────── گواهی و انبار ──────────────── */}
        <Card title={t('ccStorage')} icon={<HardDrive className="h-4 w-4" />} action={<Link className="btn btn-sm" to="/control/storage">{t('ccDetails')}</Link>}>
          <p dir="ltr" className="mb-2 truncate font-mono text-[11px] text-ink-muted">{data.storage.root}</p>
          {data.storage.disk.total ? (
            <>
              <span className="block h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--surface-2)' }}>
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${data.storage.disk.usage ?? 0}%`,
                    background: (data.storage.disk.usage ?? 0) > 90 ? 'var(--status-critical)' : 'var(--series-3)',
                  }}
                />
              </span>
              <p className="mt-1.5 text-[11px] text-ink-muted">
                {t('ccDiskFree')}: <span className="tnum">{bytes(data.storage.disk.free)}</span> / {bytes(data.storage.disk.total)}
              </p>
            </>
          ) : (
            <p className="text-xs text-ink-muted">{t('notSupported')}</p>
          )}

          <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-xs">
            <ShieldCheck className="h-4 w-4" style={{ color: data.vault.ready ? 'var(--status-good)' : 'var(--status-warning)' }} />
            <span className="flex-1">{t('ccVault')}</span>
            <span className="tnum text-ink-muted">{counts.secrets}</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <Users className="h-4 w-4 text-ink-muted" />
            <span className="flex-1">{t('ccUsers')}</span>
            <span className="tnum text-ink-muted">{counts.users}</span>
          </div>
        </Card>
      </div>

      {data.ssl.length > 0 && (
        <Card title={t('ccSslExpires')} icon={<Cloud className="h-4 w-4" />}>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.ssl.map((s) => {
              const days = s.ssl_expires ? Math.floor((s.ssl_expires - Date.now()) / 86400000) : null;
              return (
                <li key={s.name} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-xs">
                  <KeyRound className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                  <span dir="ltr" className="min-w-0 flex-1 truncate font-mono">{s.name}</span>
                  <span
                    className="tnum shrink-0"
                    style={{ color: days == null ? 'var(--text-muted)' : days < 14 ? 'var(--status-critical)' : days < 30 ? 'var(--status-warning)' : 'var(--status-good)' }}
                  >
                    {s.ssl_expires ? dateOnly(s.ssl_expires, lang) : t('notConfigured')}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
