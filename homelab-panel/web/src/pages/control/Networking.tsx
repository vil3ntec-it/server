// ---------------------------------------------------------------------------
//  شبکه — نمای سراسریِ IPها، پورت‌ها و Endpointهای همهٔ پروژه‌ها
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Network, Radio, Search } from 'lucide-react';
import { useApp } from '../../app-context';
import { Card, Loading, toast } from '../../components/ui';
import { relative } from '../../format';
import { cc } from '../../control/api';
import type { Endpoint, Ip, Port } from '../../control/types';
import { Cell, Notice, Row, StatusPill, Table, Tabs, Url } from '../../control/ui';

export default function Networking() {
  const { t, lang } = useApp();
  const [tab, setTab] = useState('endpoints');
  const [ips, setIps] = useState<Ip[]>([]);
  const [ports, setPorts] = useState<Port[]>([]);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [duplicates, setDuplicates] = useState<{ port: number; server_id: number; n: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await cc.networkOverview();
      setIps(res.ips);
      setPorts(res.ports);
      setEndpoints(res.endpoints);
      setDuplicates(res.duplicates);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const q = query.trim().toLowerCase();
  const filter = <T extends Record<string, unknown>>(rows: T[]) =>
    !q ? rows : rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));

  const shownEndpoints = useMemo(() => filter(endpoints), [endpoints, q]);
  const shownIps = useMemo(() => filter(ips), [ips, q]);
  const shownPorts = useMemo(() => filter(ports), [ports, q]);

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t('ccNetworking')}</h1>
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-4 w-4 text-ink-muted" />
          <input className="input ps-9" placeholder={t('ccSearch')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </header>

      {duplicates.length > 0 && (
        <Notice tone="warn">
          {duplicates.map((d) => (
            <p key={`${d.port}-${d.server_id}`}>
              {t('port')} <b className="tnum">{d.port}</b> — {d.n}×
            </p>
          ))}
        </Notice>
      )}

      <Tabs
        tabs={[
          { id: 'endpoints', label: t('ccEndpoints'), badge: endpoints.length },
          { id: 'ips', label: t('ccIps'), badge: ips.length },
          { id: 'ports', label: t('ccPorts'), badge: ports.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'endpoints' && (
        <Card icon={<Network className="h-4 w-4" />} title={t('ccEndpoints')}>
          <Table head={[t('ccProject'), t('ccEnvironment'), 'URL', t('ccServer'), t('status'), t('ccLastCheck')]} empty={shownEndpoints.length === 0}>
            {shownEndpoints.map((e) => (
              <Row key={e.id}>
                <Cell>
                  <Link className="hover:underline" to={`/control/projects/${e.project_public_id}`}>{e.project_name}</Link>
                </Cell>
                <Cell>
                  <span className="chip" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>{e.environment}</span>
                </Cell>
                <Cell><Url value={e.url} /></Cell>
                <Cell className="text-xs">{e.server_name || '—'}</Cell>
                <Cell><StatusPill status={e.status} code={e.status_code} latency={e.latency_ms} /></Cell>
                <Cell className="text-[11px] text-ink-muted">{e.checked_at ? relative(e.checked_at, lang) : t('ccNever')}</Cell>
              </Row>
            ))}
          </Table>
        </Card>
      )}

      {tab === 'ips' && (
        <Card title={t('ccIps')}>
          <Table head={[t('ccKind'), t('internalIp'), t('port'), t('ccProject'), t('ccServer'), t('ccDescription')]} empty={shownIps.length === 0}>
            {shownIps.map((ip) => (
              <Row key={ip.id}>
                <Cell><span className="chip" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>{ip.kind}</span></Cell>
                <Cell mono><span dir="ltr">{ip.address}</span></Cell>
                <Cell className="tnum">{ip.port || '—'}</Cell>
                <Cell className="text-xs">{ip.project_name || '—'}</Cell>
                <Cell className="text-xs">{ip.server_name || '—'}</Cell>
                <Cell className="text-[11px] text-ink-muted">{ip.description || '—'}</Cell>
              </Row>
            ))}
          </Table>
        </Card>
      )}

      {tab === 'ports' && (
        <Card title={t('ccPorts')} icon={<Radio className="h-4 w-4" />}>
          <Table head={[t('port'), t('ccProtocol'), t('ccService'), t('ccProject'), t('ccServer'), t('status')]} empty={shownPorts.length === 0}>
            {shownPorts.map((p) => (
              <Row key={p.id}>
                <Cell className="tnum font-semibold">{p.port}</Cell>
                <Cell>{p.protocol}</Cell>
                <Cell>{p.service || '—'}</Cell>
                <Cell className="text-xs">{p.project_name || '—'}</Cell>
                <Cell className="text-xs">{p.server_name || '—'}</Cell>
                <Cell><StatusPill status={p.status} compact /></Cell>
              </Row>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
