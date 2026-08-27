// ---------------------------------------------------------------------------
//  پایش و هشدارها — همه‌چیز از بررسی‌های واقعی می‌آید
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, Check, Radio, RefreshCw } from 'lucide-react';
import { useApp } from '../../app-context';
import { Card, Loading, Modal, toast } from '../../components/ui';
import { dateTime, relative } from '../../format';
import { cc } from '../../control/api';
import type { Alert, Monitor } from '../../control/types';
import { ActionButton, Cell, Row, Stat, StatusPill, Table, Tabs, Url } from '../../control/ui';

export default function MonitoringPage() {
  const { t, lang, socket } = useApp();
  const [tab, setTab] = useState('monitors');
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [byKind, setByKind] = useState<Record<string, { total: number; online: number; offline: number; unknown: number }>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertStatus, setAlertStatus] = useState('open');
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<{ monitor: Monitor; rows: { status: string; code: number | null; latency_ms: number | null; at: number }[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, a] = await Promise.all([cc.monitoring(), cc.alerts(alertStatus)]);
      setMonitors(m.monitors);
      setByKind(m.byKind);
      setAlerts(a.alerts);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoading(false);
    }
  }, [alertStatus]);

  useEffect(() => {
    load();
  }, [load]);

  // نتیجهٔ بررسی‌ها زنده می‌رسد
  useEffect(() => {
    if (!socket) return;
    const onResult = (payload: { id: number; status: string; code: number | null; latencyMs: number | null; at: number }) => {
      setMonitors((prev) =>
        prev.map((m) => (m.id === payload.id ? { ...m, status: payload.status as Monitor['status'], status_code: payload.code, latency_ms: payload.latencyMs, checked_at: payload.at } : m))
      );
    };
    socket.on('control:monitor', onResult);
    socket.on('control:alert', load);
    return () => {
      socket.off('control:monitor', onResult);
      socket.off('control:alert', load);
    };
  }, [socket, load]);

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t('ccMonitoring')}</h1>
        <div className="flex gap-2">
          <ActionButton onClick={() => cc.syncMonitors().then(load)}>
            <RefreshCw className="h-4 w-4" />
            {t('ccSyncTargets')}
          </ActionButton>
          <ActionButton className="btn btn-sm btn-primary" busyLabel={t('ccTesting')} onClick={() => cc.runChecks().then(load)}>
            <Activity className="h-4 w-4" />
            {t('ccRunChecks')}
          </ActionButton>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Object.entries(byKind).map(([kind, m]) => (
          <Stat
            key={kind}
            label={kind}
            value={`${m.online}/${m.total}`}
            tone={m.online === m.total ? 'good' : m.offline > 0 ? 'bad' : 'warn'}
            sub={m.unknown ? `${m.unknown} ${t('stUnknown')}` : undefined}
          />
        ))}
      </div>

      <Tabs
        tabs={[
          { id: 'monitors', label: t('ccMonitoring'), badge: monitors.length },
          { id: 'alerts', label: t('ccAlerts'), badge: alerts.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'monitors' && (
        <Card title={t('ccMonitoring')} icon={<Activity className="h-4 w-4" />}>
          <Table head={[t('ccKind'), t('ccLabel'), t('ccTarget'), t('status'), t('ccLastCheck'), '']} empty={monitors.length === 0}>
            {monitors.map((m) => (
              <Row key={m.id}>
                <Cell><span className="chip" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>{m.kind}</span></Cell>
                <Cell>
                  {m.project_name ? (
                    <span className="block truncate text-xs text-ink-muted">{m.project_name}</span>
                  ) : null}
                  {m.label}
                </Cell>
                <Cell><Url value={m.target} /></Cell>
                <Cell><StatusPill status={m.status} code={m.status_code} latency={m.latency_ms} /></Cell>
                <Cell className="text-[11px] text-ink-muted">{m.checked_at ? relative(m.checked_at, lang) : t('ccNever')}</Cell>
                <Cell>
                  <div className="flex justify-end gap-1">
                    <ActionButton
                      busyLabel="…"
                      onClick={async () => {
                        const res = await cc.checkMonitor(m.id);
                        toast(res.result.status, res.result.status === 'online' ? 'good' : 'bad');
                        load();
                      }}
                    >
                      <Radio className="h-3.5 w-3.5" />
                    </ActionButton>
                    <ActionButton
                      onClick={async () => {
                        const res = await cc.monitorHistory(m.id);
                        setHistory({ monitor: m, rows: res.history });
                      }}
                    >
                      {t('ccHistory')}
                    </ActionButton>
                  </div>
                </Cell>
              </Row>
            ))}
          </Table>
        </Card>
      )}

      {tab === 'alerts' && (
        <Card
          title={t('ccAlerts')}
          icon={<AlertTriangle className="h-4 w-4" />}
          action={
            <select className="input py-1.5 text-xs" value={alertStatus} onChange={(e) => setAlertStatus(e.target.value)}>
              <option value="open">{t('ccOpenAlerts')}</option>
              <option value="ack">ack</option>
              <option value="resolved">{t('ccResolve')}</option>
              <option value="all">{t('all')}</option>
            </select>
          }
        >
          {alerts.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-muted">{t('ccNoAlerts')}</p>
          ) : (
            <ul className="space-y-2">
              {alerts.map((a) => {
                const color = a.severity === 'critical' ? 'var(--status-critical)' : a.severity === 'warn' ? 'var(--status-warning)' : 'var(--series-1)';
                return (
                  <li key={a.id} className="rounded-xl border p-3" style={{ borderColor: `color-mix(in srgb, ${color} 30%, transparent)` }}>
                    <div className="flex flex-wrap items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{a.title}</p>
                        {a.detail && <p className="mt-0.5 break-all text-[11px] text-ink-muted">{a.detail}</p>}
                        <p className="mt-1 text-[11px] text-ink-muted">
                          {relative(a.last_at, lang)}
                          {a.count > 1 ? ` · ${a.count}×` : ''}
                          {a.project_name ? ` · ${a.project_name}` : ''}
                          {a.server_name ? ` · ${a.server_name}` : ''}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        {a.status === 'open' && (
                          <ActionButton onClick={async () => { await cc.ackAlert(a.id); load(); }}>{t('ccAcknowledge')}</ActionButton>
                        )}
                        {a.status !== 'resolved' && (
                          <ActionButton onClick={async () => { await cc.resolveAlert(a.id); load(); }}>
                            <Check className="h-3.5 w-3.5" />
                          </ActionButton>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      <Modal open={Boolean(history)} onClose={() => setHistory(null)} title={history?.monitor.label || ''} wide>
        {history && (
          <Table head={[t('lastUpdate'), t('status'), t('ccStatusCode'), t('ccResponseTime')]} empty={history.rows.length === 0}>
            {[...history.rows].reverse().map((r, i) => (
              <Row key={i}>
                <Cell className="text-xs">{dateTime(r.at, lang)}</Cell>
                <Cell><StatusPill status={r.status} compact /></Cell>
                <Cell className="tnum">{r.code ?? '—'}</Cell>
                <Cell className="tnum">{r.latency_ms != null ? `${r.latency_ms}ms` : '—'}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Modal>
    </div>
  );
}
