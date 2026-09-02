// ---------------------------------------------------------------------------
//  مدیریتِ Docker
//
//  چهار زبانه روی یک صفحه، نه چهار صفحه: کانتینر و ایمیج و حجم و شبکه را
//  آدم پشتِ سرِ هم نگاه می‌کند — «چرا این کانتینر بالا نمی‌آید» معمولاً به
//  حجمی ختم می‌شود که نیست. جابه‌جایی بینشان نباید یک بارِ صفحه باشد.
//
//  آمارِ مصرف جدا از فهرست گرفته می‌شود چون `docker stats` کُند است (یک
//  نمونه‌برداریِ واقعی از دیمن). فهرست فوراً می‌آید و آمار وقتی رسید روی
//  همان ردیف‌ها می‌نشیند — به‌جای اینکه کلِ جدول منتظرِ کُندترین بخش بماند.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes, Container, HardDrive, Layers, Network as NetworkIcon,
  Pause, Play, RefreshCw, RotateCw, ScrollText, Square, Trash2,
} from 'lucide-react';

import { api } from '../api';
import { useApp } from '../app-context';
import { Badge, Card, ConfirmDialog, Empty, Loading, Modal, toast } from '../components/ui';
import { ActionButton, Cell, Notice, Row, Table, Tabs } from '../control/ui';

/* ------------------------------- انواع ---------------------------------- */

type DockerStatus = {
  ok: boolean;
  installed: boolean;
  running: boolean;
  reason?: string;
  detail?: string | null;
  client?: string | null;
  server?: string | null;
};

type ContainerRow = {
  id: string;
  shortId: string;
  name: string;
  image: string;
  status: string;
  state: string;
  ports: string[];
  project: string | null;
};

type ImageRow = { id: string; repository: string; tag: string; size: string; dangling: boolean };
type VolumeRow = { name: string; driver: string; mountpoint: string | null };
type NetworkRow = { id: string; name: string; driver: string; scope: string };
type StatRow = { id: string; name: string; cpuPercent: number; memPercent: number; memUsage: string };

type Tab = 'containers' | 'images' | 'volumes' | 'networks';

/* --------------------------- کمک‌کننده‌ها -------------------------------- */

/**
 * وضعیت به رنگ. running سبز است و بقیه خنثی — جز dead که واقعاً بد است.
 * paused عمدی است، پس هشدار نیست؛ زردِ بی‌دلیل، زردِ واقعی را بی‌اثر می‌کند.
 */
function stateTone(state: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (state === 'running') return 'good';
  if (state === 'dead') return 'bad';
  if (state === 'restarting') return 'warn';
  return 'neutral';
}

export default function DockerPage() {
  const { t, role } = useApp();
  const canAct = role === 'operator' || role === 'admin';
  const canDelete = role === 'admin';

  const [status, setStatus] = useState<DockerStatus | null>(null);
  const [tab, setTab] = useState<Tab>('containers');
  const [loading, setLoading] = useState(true);

  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [volumes, setVolumes] = useState<VolumeRow[]>([]);
  const [networks, setNetworks] = useState<NetworkRow[]>([]);
  const [stats, setStats] = useState<Record<string, StatRow>>({});

  const [logFor, setLogFor] = useState<ContainerRow | null>(null);
  const [logText, setLogText] = useState('');
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => Promise<void> } | null>(null);

  /* ----------------------------- بارگذاری ------------------------------ */

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api<DockerStatus>('/api/docker/status'));
    } catch {
      setStatus({ ok: false, installed: false, running: false, reason: 'error' });
    }
  }, []);

  const loadLists = useCallback(async () => {
    setLoading(true);
    try {
      const [c, i, v, n] = await Promise.all([
        api<{ items: ContainerRow[] }>('/api/docker/containers').catch(() => ({ items: [] })),
        api<{ items: ImageRow[] }>('/api/docker/images').catch(() => ({ items: [] })),
        api<{ items: VolumeRow[] }>('/api/docker/volumes').catch(() => ({ items: [] })),
        api<{ items: NetworkRow[] }>('/api/docker/networks').catch(() => ({ items: [] })),
      ]);
      setContainers(c.items ?? []);
      setImages(i.items ?? []);
      setVolumes(v.items ?? []);
      setNetworks(n.items ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  // آمار جداگانه و بی‌صدا: اگر نیامد، جدول باید همان‌طور کار کند
  const loadStats = useCallback(async () => {
    try {
      const res = await api<{ items: StatRow[] }>('/api/docker/stats');
      const byId: Record<string, StatRow> = {};
      for (const row of res.items ?? []) byId[row.name || row.id] = row;
      setStats(byId);
    } catch { /* آمار اختیاری است */ }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!status?.running) {
      setLoading(false);
      return;
    }
    void loadLists();
    void loadStats();
    const timer = setInterval(() => {
      void loadLists();
      void loadStats();
    }, 10000);
    return () => clearInterval(timer);
  }, [status?.running, loadLists, loadStats]);

  /* ------------------------------- کارها ------------------------------- */

  async function act(row: ContainerRow, action: string) {
    try {
      await api(`/api/docker/containers/${row.id}/${action}`, { method: 'POST' });
      toast(t('dkDone'));
      await loadLists();
    } catch (e) {
      toast((e as Error).message || t('dkFailed'), 'bad');
    }
  }

  function askRemove(kind: 'containers' | 'images' | 'volumes', id: string, label: string) {
    setConfirm({
      title: t('dkRemoveTitle'),
      message: `${label} — ${t('dkRemoveBody')}`,
      run: async () => {
        try {
          const force = kind === 'containers' || kind === 'images' ? '?force=1' : '';
          await api(`/api/docker/${kind}/${encodeURIComponent(id)}${force}`, { method: 'DELETE' });
          toast(t('dkRemoved'));
          await loadLists();
        } catch (e) {
          toast((e as Error).message || t('dkFailed'), 'bad');
        }
      },
    });
  }

  async function openLogs(row: ContainerRow) {
    setLogFor(row);
    setLogText('');
    try {
      const res = await api<{ text: string }>(`/api/docker/containers/${row.id}/logs?tail=300`);
      setLogText(res.text || t('dkNoLogs'));
    } catch (e) {
      setLogText((e as Error).message || t('dkFailed'));
    }
  }

  const runningCount = useMemo(() => containers.filter((c) => c.state === 'running').length, [containers]);

  /* ------------------------- داکر در دسترس نیست ------------------------ */

  if (status && !status.running) {
    return (
      <div className="space-y-4">
        <PageHead onRefresh={() => void loadStatus()} />
        <Card>
          <Empty
            icon={<Container className="h-8 w-8" />}
            title={status.installed ? t('dkDaemonDown') : t('dkNotInstalled')}
            hint={status.installed ? t('dkDaemonHint') : t('dkInstallHint')}
          />
          {status.detail && (
            <pre className="mt-2 overflow-x-auto rounded-xl bg-surface-raised p-3 text-left font-mono text-xs text-ink-soft" dir="ltr">
              {status.detail}
            </pre>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHead
        onRefresh={() => {
          void loadLists();
          void loadStats();
        }}
        version={status?.server}
      />

      <Tabs
        active={tab}
        onChange={(id) => setTab(id as Tab)}
        tabs={[
          { id: 'containers', label: t('dkContainers'), badge: containers.length },
          { id: 'images', label: t('dkImages'), badge: images.length },
          { id: 'volumes', label: t('dkVolumes'), badge: volumes.length },
          { id: 'networks', label: t('dkNetworks'), badge: networks.length },
        ]}
      />

      {loading && !containers.length ? (
        <Card><Loading /></Card>
      ) : tab === 'containers' ? (
        <Card
          title={t('dkContainers')}
          icon={<Container className="h-4 w-4" />}
          action={<span className="text-xs text-ink-muted">{t('dkRunningOf', { n: runningCount, total: containers.length })}</span>}
        >
          <Table
            empty={!containers.length}
            head={[t('dkName'), t('dkImage'), t('dkState'), 'CPU', t('dkMemory'), t('dkPorts'), '']}
          >
            {containers.map((row) => {
              const s = stats[row.name] ?? stats[row.shortId];
              return (
                <Row key={row.id}>
                  <Cell>
                    <div className="font-medium text-ink">{row.name}</div>
                    {row.project && <div className="text-[11px] text-ink-muted">{row.project}</div>}
                  </Cell>
                  <Cell mono className="text-ink-soft">{row.image}</Cell>
                  <Cell>
                    <Badge tone={stateTone(row.state)}>{row.status || row.state}</Badge>
                  </Cell>
                  <Cell mono className="tnum">{s ? `${s.cpuPercent.toFixed(1)}%` : '—'}</Cell>
                  <Cell mono className="tnum text-ink-soft">{s ? s.memUsage : '—'}</Cell>
                  <Cell mono className="text-[11px] text-ink-soft">
                    {row.ports.length ? row.ports.join(' · ') : '—'}
                  </Cell>
                  <Cell className="text-end">
                    <div className="flex justify-end gap-1">
                      <ActionButton className="btn btn-sm" onClick={() => openLogs(row)} title={t('dkLogs')}>
                        <ScrollText className="h-3.5 w-3.5" />
                      </ActionButton>
                      {canAct && row.state !== 'running' && (
                        <ActionButton className="btn btn-sm" onClick={() => act(row, 'start')} title={t('dkStart')}>
                          <Play className="h-3.5 w-3.5" />
                        </ActionButton>
                      )}
                      {canAct && row.state === 'running' && (
                        <>
                          <ActionButton className="btn btn-sm" onClick={() => act(row, 'restart')} title={t('dkRestart')}>
                            <RotateCw className="h-3.5 w-3.5" />
                          </ActionButton>
                          <ActionButton className="btn btn-sm" onClick={() => act(row, 'stop')} title={t('dkStop')}>
                            <Square className="h-3.5 w-3.5" />
                          </ActionButton>
                          <ActionButton className="btn btn-sm" onClick={() => act(row, 'pause')} title={t('dkPause')}>
                            <Pause className="h-3.5 w-3.5" />
                          </ActionButton>
                        </>
                      )}
                      {canAct && row.state === 'paused' && (
                        <ActionButton className="btn btn-sm" onClick={() => act(row, 'unpause')} title={t('dkUnpause')}>
                          <Play className="h-3.5 w-3.5" />
                        </ActionButton>
                      )}
                      {canDelete && (
                        <ActionButton
                          className="btn btn-sm btn-danger"
                          onClick={() => askRemove('containers', row.id, row.name)}
                          title={t('dkRemove')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </ActionButton>
                      )}
                    </div>
                  </Cell>
                </Row>
              );
            })}
          </Table>
        </Card>
      ) : tab === 'images' ? (
        <Card title={t('dkImages')} icon={<Layers className="h-4 w-4" />}>
          <Table empty={!images.length} head={[t('dkRepository'), t('dkTag'), t('dkSize'), '']}>
            {images.map((row) => (
              <Row key={row.id}>
                <Cell mono>{row.repository}</Cell>
                <Cell mono className="text-ink-soft">
                  {row.tag}
                  {row.dangling && <span className="ms-2 text-[11px] text-ink-muted">{t('dkDangling')}</span>}
                </Cell>
                <Cell mono className="tnum text-ink-soft">{row.size}</Cell>
                <Cell className="text-end">
                  {canDelete && (
                    <ActionButton
                      className="btn btn-sm btn-danger"
                      onClick={() => askRemove('images', row.id, `${row.repository}:${row.tag}`)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </ActionButton>
                  )}
                </Cell>
              </Row>
            ))}
          </Table>
        </Card>
      ) : tab === 'volumes' ? (
        <Card title={t('dkVolumes')} icon={<HardDrive className="h-4 w-4" />}>
          <Notice tone="warn">{t('dkVolumeWarn')}</Notice>
          <div className="mt-3">
            <Table empty={!volumes.length} head={[t('dkName'), t('dkDriver'), t('dkMountpoint'), '']}>
              {volumes.map((row) => (
                <Row key={row.name}>
                  <Cell mono>{row.name}</Cell>
                  <Cell className="text-ink-soft">{row.driver}</Cell>
                  <Cell mono className="text-[11px] text-ink-muted">{row.mountpoint ?? '—'}</Cell>
                  <Cell className="text-end">
                    {canDelete && (
                      <ActionButton
                        className="btn btn-sm btn-danger"
                        onClick={() => askRemove('volumes', row.name, row.name)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </ActionButton>
                    )}
                  </Cell>
                </Row>
              ))}
            </Table>
          </div>
        </Card>
      ) : (
        <Card title={t('dkNetworks')} icon={<NetworkIcon className="h-4 w-4" />}>
          <Table empty={!networks.length} head={[t('dkName'), t('dkDriver'), t('dkScope')]}>
            {networks.map((row) => (
              <Row key={row.id}>
                <Cell mono>{row.name}</Cell>
                <Cell className="text-ink-soft">{row.driver}</Cell>
                <Cell className="text-ink-soft">{row.scope}</Cell>
              </Row>
            ))}
          </Table>
        </Card>
      )}

      <Modal open={Boolean(logFor)} onClose={() => setLogFor(null)} title={logFor?.name ?? ''} wide>
        <pre
          className="max-h-[60vh] overflow-auto rounded-xl bg-surface-raised p-3 text-left font-mono text-xs leading-relaxed text-ink-soft"
          dir="ltr"
        >
          {logText || '…'}
        </pre>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        danger
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const run = confirm?.run;
          setConfirm(null);
          await run?.();
        }}
      />
    </div>
  );
}

function PageHead({ onRefresh, version }: { onRefresh: () => void; version?: string | null }) {
  const { t } = useApp();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <Boxes className="h-5 w-5" />
          {t('docker')}
        </h1>
        {version && <p className="text-xs text-ink-muted">Docker Engine {version}</p>}
      </div>
      <button className="btn btn-sm" onClick={onRefresh}>
        <RefreshCw className="h-3.5 w-3.5" />
        {t('refresh')}
      </button>
    </div>
  );
}
