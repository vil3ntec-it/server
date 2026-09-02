import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock,
  Cpu,
  Globe,
  HardDrive,
  MemoryStick,
  Network as NetworkIcon,
  Server,
  Thermometer,
  Wifi,
} from 'lucide-react';
import { useApp } from '../app-context';
import { api } from '../api';
import type { DashboardData } from '../types';
import { Card, Loading, StatusDot, Badge, Empty } from '../components/ui';
import { Bar, LiveChart, Ring } from '../components/charts';
import { bytes, bytesPerSec, dateTime, duration, ltr, percent } from '../format';

export default function Dashboard() {
  const { t, lang, metrics, history } = useApp();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      // وقتی تب پنهان است بی‌جهت به سرور فشار نمی‌آوریم
      if (document.visibilityState !== 'visible') return;
      try {
        const d = await api<DashboardData>('/api/dashboard');
        if (alive) {
          setData(d);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
    };
    load();
    // اطلاعات غیرلحظه‌ای (سایت‌ها، خطاها) — معیارها خودشان از سوکت می‌آیند
    const timer = setInterval(load, 60000);
    document.addEventListener('visibilitychange', load);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, []);

  if (!data) return error ? <Empty title={t('connectionLost')} /> : <Loading />;

  // معیارها از سوکت می‌آیند (هر ۲ ثانیه) و در نبود سوکت از پاسخ REST
  const cpu = metrics?.cpu ?? data.cpu;
  const memory = metrics?.memory ?? data.memory;
  const disk = metrics?.disk ?? data.disk;
  const temp = metrics?.temperature ?? data.temperature;
  const net = metrics?.network ?? data.network;
  const uptime = metrics?.host.uptimeSeconds ?? data.server.uptimeSeconds;
  const points = history.length ? history : data.history;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      {/* هویت سرور */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className="flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
            >
              <Server className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-base font-semibold">{data.server.name}</h1>
              <p className="text-xs text-ink-muted">
                {data.server.platform} · {data.server.release} · {data.server.arch}
              </p>
            </div>
          </div>
          <StatusDot online={data.server.online} label={data.server.online ? t('online') : t('offline')} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
          <Info label={t('internalIp')} value={data.server.internalIp ?? '—'} mono />
          <Info label={t('publicIp')} value={data.server.publicIp ?? '—'} mono />
          <Info label={t('uptime')} value={duration(uptime, t)} icon={<Clock className="h-3.5 w-3.5" />} />
          <Info
            label={t('ping')}
            value={data.network.ping?.ms != null ? ltr(`${data.network.ping.ms} ms`) : '—'}
            icon={<Wifi className="h-3.5 w-3.5" />}
          />
        </dl>
      </Card>

      {/* چهار معیار اصلی */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          title={t('cpu')}
          icon={<Cpu className="h-4 w-4" />}
          value={cpu.usage}
          color="var(--series-1)"
          detail={`${cpu.count} ${t('cores')}${cpu.model ? ` · ${ltr(cpu.model.slice(0, 26))}` : ''}`}
          points={points}
          accessor={(p) => p.cpu}
        />
        <MetricTile
          title={t('ram')}
          icon={<MemoryStick className="h-4 w-4" />}
          value={memory.usage}
          color="var(--series-2)"
          detail={ltr(`${bytes(memory.used)} / ${bytes(memory.total)}`)}
          points={points}
          accessor={(p) => p.memory}
        />
        <MetricTile
          title={t('disk')}
          icon={<HardDrive className="h-4 w-4" />}
          value={disk.usage}
          color="var(--series-3)"
          detail={ltr(`${bytes(disk.used)} / ${bytes(disk.total)}`)}
          points={points}
          accessor={(p) => p.disk}
        />

        <Card className="flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <NetworkIcon className="h-4 w-4" />
              {t('network')}
            </h2>
          </div>
          {net.supported ? (
            <>
              <div className="mt-3 space-y-1.5">
                <p className="flex items-center gap-1.5 text-sm">
                  <ArrowDownToLine className="h-3.5 w-3.5" style={{ color: 'var(--series-1)' }} />
                  <span className="text-ink-soft">{t('download')}</span>
                  <span className="tnum ms-auto font-semibold">{bytesPerSec(net.rxBytesPerSec)}</span>
                </p>
                <p className="flex items-center gap-1.5 text-sm">
                  <ArrowUpFromLine className="h-3.5 w-3.5" style={{ color: 'var(--series-2)' }} />
                  <span className="text-ink-soft">{t('upload')}</span>
                  <span className="tnum ms-auto font-semibold">{bytesPerSec(net.txBytesPerSec)}</span>
                </p>
              </div>
              <div className="mt-2">
                <LiveChart
                  points={points}
                  x={(p) => p.at}
                  height={54}
                  compact
                  format={(v) => bytesPerSec(v)}
                  series={[
                    { key: 'rx', label: t('download'), color: 'var(--series-1)', value: (p) => p.rx },
                    { key: 'tx', label: t('upload'), color: 'var(--series-2)', value: (p) => p.tx },
                  ]}
                />
              </div>
            </>
          ) : (
            <p className="py-6 text-center text-xs text-ink-muted">{t('notSupported')}</p>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* شمارنده‌ها + دما */}
        <div className="flex flex-col gap-4">
          <Card title={t('temperature')} icon={<Thermometer className="h-4 w-4" />}>
            {temp.supported && temp.max != null ? (
              <>
                <p className="tnum text-3xl font-semibold">{ltr(`${temp.max.toFixed(1)}°C`)}</p>
                <ul className="mt-3 space-y-1 text-xs text-ink-soft">
                  {temp.sensors.slice(0, 5).map((s) => (
                    <li key={s.label} className="flex items-center justify-between gap-2">
                      <span className="truncate">{s.label}</span>
                      <span className="tnum">{ltr(`${s.celsius.toFixed(1)}°C`)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="py-4 text-center text-xs text-ink-muted">{t('notSupported')}</p>
            )}
          </Card>

          <Card>
            <div className="grid grid-cols-2 gap-3">
              <CountTile
                to="/sites"
                label={t('sitesCount')}
                value={data.counts.sites}
                sub={`${data.counts.sitesOnline} ${t('online')}`}
                icon={<Server className="h-4 w-4" />}
              />
              <CountTile
                to="/domains"
                label={t('domainsCount')}
                value={data.counts.domains}
                icon={<Globe className="h-4 w-4" />}
              />
            </div>
          </Card>
        </div>

        {/* دیسک‌ها */}
        <Card title={t('disk')} icon={<HardDrive className="h-4 w-4" />}>
          <ul className="space-y-3">
            {disk.disks.map((d) => (
              <li key={d.mount}>
                <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium" dir="ltr">{d.label || d.mount}</span>
                  <span className="tnum text-ink-soft">
                    {ltr(`${bytes(d.used)} / ${bytes(d.total)} · ${percent(d.usage, 0)}`)}
                  </span>
                </div>
                <Bar
                  value={d.usage}
                  color={d.usage > 90 ? 'var(--status-critical)' : d.usage > 75 ? 'var(--status-warning)' : 'var(--series-3)'}
                />
              </li>
            ))}
          </ul>
        </Card>

        {/* آخرین خطاها */}
        <Card
          title={t('lastErrors')}
          icon={<AlertTriangle className="h-4 w-4" />}
          action={
            <Link to="/logs" className="text-xs text-ink-soft hover:text-ink">
              {t('logs')}
            </Link>
          }
        >
          {data.errors.length ? (
            <ul className="space-y-2.5">
              {data.errors.slice(0, 7).map((e) => (
                <li key={e.id} className="flex items-start gap-2">
                  <Badge tone={e.level === 'error' ? 'bad' : 'warn'}>{e.level === 'error' ? t('errors') : t('warnings')}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-ink">{e.message}</p>
                    <p className="text-[11px] text-ink-muted">{dateTime(e.created_at, lang)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-xs text-ink-muted">{t('noData')}</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function Info({
  label,
  value,
  mono,
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-[11px] text-ink-muted">
        {icon}
        {label}
      </dt>
      <dd className={`truncate text-sm font-medium ${mono ? 'font-mono tnum' : ''}`}>{value}</dd>
    </div>
  );
}

function MetricTile({
  title,
  icon,
  value,
  color,
  detail,
  points,
  accessor,
}: {
  title: string;
  icon: React.ReactNode;
  value: number;
  color: string;
  detail: string;
  points: import('../types').HistoryPoint[];
  accessor: (p: import('../types').HistoryPoint) => number | null;
}) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {icon}
            {title}
          </h2>
          <p className="mt-1 truncate text-[11px] text-ink-muted">{detail}</p>
        </div>
        <Ring value={value} color={color} label={title} />
      </div>
      <div className="mt-2">
        <LiveChart
          points={points}
          x={(p) => p.at}
          height={48}
          compact
          yMax={100}
          format={(v) => (v == null ? '—' : `${v.toFixed(0)}%`)}
          series={[{ key: title, label: title, color, value: accessor }]}
        />
      </div>
    </Card>
  );
}

function CountTile({
  to,
  label,
  value,
  sub,
  icon,
}: {
  to: string;
  label: string;
  value: number;
  sub?: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="rounded-xl border border-line p-3 transition-colors hover:bg-surface-raised"
      style={{ background: 'var(--surface-0)' }}
    >
      <p className="flex items-center gap-1.5 text-[11px] text-ink-muted">
        {icon}
        {label}
      </p>
      <p className="tnum mt-1 text-2xl font-semibold">{value}</p>
      {sub && <p className="text-[11px] text-ink-muted">{sub}</p>}
    </Link>
  );
}
