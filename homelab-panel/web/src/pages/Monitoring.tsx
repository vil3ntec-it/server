import { Activity, Cpu, HardDrive, MemoryStick, Network as NetworkIcon, Thermometer } from 'lucide-react';
import { useApp } from '../app-context';
import { Card, Empty } from '../components/ui';
import { Bar, LiveChart } from '../components/charts';
import { bytes, bytesPerSec, ltr, percent } from '../format';

// نمودارهای زنده — بدون نیاز به Refresh؛ داده از Socket.IO می‌آید
export default function Monitoring() {
  const { t, metrics, history } = useApp();

  if (!history.length) {
    return (
      <Card>
        <Empty icon={<Activity className="h-8 w-8" />} title={t('loading')} />
      </Card>
    );
  }

  const pct = (v: number | null) => (v == null ? '—' : ltr(`${v.toFixed(0)}%`));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div>
        <h1 className="text-base font-semibold">{t('monitoring')}</h1>
        <p className="text-xs text-ink-muted">{t('liveEvery', { n: 2 })}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title={`${t('cpu')} — ${percent(metrics?.cpu.usage ?? null)}`}
          icon={<Cpu className="h-4 w-4" />}
        >
          <LiveChart
            points={history}
            x={(p) => p.at}
            yMax={100}
            height={190}
            format={pct}
            series={[{ key: 'cpu', label: t('cpu'), color: 'var(--series-1)', value: (p) => p.cpu }]}
          />
          {metrics && (
            <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-8">
              {metrics.cpu.cores.map((c, i) => (
                <div key={i}>
                  <p className="tnum mb-1 text-[10px] text-ink-muted">
                    {ltr(`#${i + 1} ${c.toFixed(0)}%`)}
                  </p>
                  <Bar value={c} color="var(--series-1)" />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title={`${t('ram')} — ${percent(metrics?.memory.usage ?? null)}`}
          icon={<MemoryStick className="h-4 w-4" />}
        >
          <LiveChart
            points={history}
            x={(p) => p.at}
            yMax={100}
            height={190}
            format={pct}
            series={[{ key: 'mem', label: t('ram'), color: 'var(--series-2)', value: (p) => p.memory }]}
          />
          {metrics && (
            <dl className="mt-3 grid grid-cols-3 gap-3 text-xs">
              <Stat label={t('used')} value={bytes(metrics.memory.used)} />
              <Stat label={t('free')} value={bytes(metrics.memory.available)} />
              <Stat label={t('total')} value={bytes(metrics.memory.total)} />
              {metrics.memory.swapTotal ? (
                <Stat
                  label={t('swap')}
                  value={ltr(`${bytes(metrics.memory.swapUsed)} / ${bytes(metrics.memory.swapTotal)}`)}
                />
              ) : null}
            </dl>
          )}
        </Card>

        <Card
          title={`${t('disk')} — ${percent(metrics?.disk.usage ?? null)}`}
          icon={<HardDrive className="h-4 w-4" />}
        >
          <LiveChart
            points={history}
            x={(p) => p.at}
            yMax={100}
            height={190}
            format={pct}
            series={[{ key: 'disk', label: t('disk'), color: 'var(--series-3)', value: (p) => p.disk }]}
          />
          {metrics && (
            <ul className="mt-3 space-y-2.5">
              {metrics.disk.disks.map((d) => (
                <li key={d.mount}>
                  <div className="mb-1 flex justify-between gap-2 text-[11px]">
                    <span className="truncate font-mono" dir="ltr">{d.mount}</span>
                    <span className="tnum text-ink-soft">
                      {ltr(`${bytes(d.used)} / ${bytes(d.total)}`)}
                    </span>
                  </div>
                  <Bar
                    value={d.usage}
                    color={d.usage > 90 ? 'var(--status-critical)' : d.usage > 75 ? 'var(--status-warning)' : 'var(--series-3)'}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t('network')} icon={<NetworkIcon className="h-4 w-4" />}>
          {metrics?.network.supported === false ? (
            <Empty title={t('notSupported')} />
          ) : (
            <LiveChart
              points={history}
              x={(p) => p.at}
              height={190}
              format={(v) => bytesPerSec(v)}
              series={[
                { key: 'rx', label: t('download'), color: 'var(--series-1)', value: (p) => p.rx },
                { key: 'tx', label: t('upload'), color: 'var(--series-2)', value: (p) => p.tx },
              ]}
            />
          )}
        </Card>

        {metrics?.temperature.supported && (
          <Card
            title={`${t('temperature')} — ${ltr(`${metrics.temperature.max?.toFixed(1)}°C`)}`}
            icon={<Thermometer className="h-4 w-4" />}
            className="lg:col-span-2"
          >
            <LiveChart
              points={history}
              x={(p) => p.at}
              height={160}
              format={(v) => (v == null ? '—' : ltr(`${v.toFixed(0)}°`))}
              series={[{ key: 'temp', label: t('temperature'), color: 'var(--series-2)', value: (p) => p.temp }]}
            />
          </Card>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd className="tnum font-medium">{value}</dd>
    </div>
  );
}
