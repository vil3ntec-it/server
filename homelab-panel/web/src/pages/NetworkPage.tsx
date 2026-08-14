import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Globe, Network as NetworkIcon, RefreshCw, Router, Wifi } from 'lucide-react';
import { useApp } from '../app-context';
import { api } from '../api';
import type { NetworkInfo } from '../types';
import { Card, Loading, toast } from '../components/ui';
import { LiveChart } from '../components/charts';
import { bytes, bytesPerSec, ltr } from '../format';

export default function NetworkPage() {
  const { t, metrics, history } = useApp();
  const [info, setInfo] = useState<NetworkInfo | null>(null);
  const [pingResult, setPingResult] = useState<{ avg: number | null; min: number | null; max: number | null; lossPercent: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<NetworkInfo>('/api/network').then(setInfo).catch(() => setInfo(null));

  useEffect(() => {
    load();
    const timer = setInterval(load, 20000);
    return () => clearInterval(timer);
  }, []);

  if (!info) return <Loading />;

  const net = metrics?.network ?? info.throughput;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-base font-semibold">{t('network')}</h1>
        <button className="btn btn-sm" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t('refresh')}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile icon={<ArrowDownToLine className="h-4 w-4" />} label={t('download')} value={bytesPerSec(net.rxBytesPerSec)} color="var(--series-1)" />
        <Tile icon={<ArrowUpFromLine className="h-4 w-4" />} label={t('upload')} value={bytesPerSec(net.txBytesPerSec)} color="var(--series-2)" />
        <Tile icon={<Wifi className="h-4 w-4" />} label={t('ping')} value={info.ping?.ms != null ? ltr(`${info.ping.ms} ms`) : '—'} />
        <Tile icon={<Router className="h-4 w-4" />} label={t('gateway')} value={info.gateway || '—'} mono />
      </div>

      <Card title={t('network')} icon={<NetworkIcon className="h-4 w-4" />}>
        <LiveChart
          points={history}
          x={(p) => p.at}
          height={180}
          format={(v) => bytesPerSec(v)}
          series={[
            { key: 'rx', label: t('download'), color: 'var(--series-1)', value: (p) => p.rx },
            { key: 'tx', label: t('upload'), color: 'var(--series-2)', value: (p) => p.tx },
          ]}
        />
        {net.totalRx != null && (
          <p className="mt-2 text-[11px] text-ink-muted">
            {t('total')}: {ltr(`↓ ${bytes(net.totalRx)} · ↑ ${bytes(net.totalTx)}`)}
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t('interfaces')} icon={<NetworkIcon className="h-4 w-4" />}>
          <ul className="space-y-3">
            {info.interfaces.map((i) => (
              <li key={i.name + i.address} className="rounded-xl border border-line p-3" style={{ background: 'var(--surface-0)' }}>
                <p className="text-sm font-medium">{i.name}</p>
                <dl className="mt-1.5 grid grid-cols-2 gap-2 text-xs">
                  <Row label={t('internalIp')} value={i.address} />
                  <Row label={t('macAddress')} value={i.mac || '—'} />
                </dl>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={t('ping')} icon={<Globe className="h-4 w-4" />}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Row label={t('publicIp')} value={info.publicIp || '—'} />
            <Row label={t('target')} value={info.ping?.target || '—'} />
          </dl>
          <button
            className="btn btn-primary btn-sm mt-4"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await api<any>('/api/network/ping', { body: { target: info.ping?.target || '1.1.1.1:443' } });
                setPingResult(res);
              } catch {
                toast(t('error'), 'bad');
              } finally {
                setBusy(false);
              }
            }}
          >
            <Wifi className="h-3.5 w-3.5" />
            {t('runPing')}
          </button>
          {pingResult && (
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Row label={t('average')} value={pingResult.avg != null ? ltr(`${pingResult.avg} ms`) : '—'} />
              <Row label="min" value={pingResult.min != null ? ltr(`${pingResult.min} ms`) : '—'} />
              <Row label="max" value={pingResult.max != null ? ltr(`${pingResult.max} ms`) : '—'} />
              <Row label={t('packetLoss')} value={ltr(`${pingResult.lossPercent}%`)} />
            </dl>
          )}
        </Card>
      </div>
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  color,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color?: string;
  mono?: boolean;
}) {
  return (
    <Card>
      <p className="flex items-center gap-1.5 text-[11px] text-ink-muted" style={color ? { color } : undefined}>
        {icon}
        {label}
      </p>
      <p className={`mt-1 truncate text-lg font-semibold ${mono ? 'font-mono tnum' : 'tnum'}`}>{value}</p>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd className="tnum truncate font-mono text-xs">{value}</dd>
    </div>
  );
}
