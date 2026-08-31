// ---------------------------------------------------------------------------
//  مسیر دامنه‌ها — نقشهٔ کاملِ «کدام آدرس به کدام سرویس می‌رسد»
//
//      api.example.com → تونل ۱ → سرور خانگی → localhost:3000
//
//  دامنه‌ها، ساب‌دامین‌ها و تونل‌ها همه در همین صفحه به هم گره می‌خورند.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Globe, Plus, Radio, Trash2, Waypoints } from 'lucide-react';
import { useApp } from '../../app-context';
import { Card, Empty, Field, Loading, Modal, toast } from '../../components/ui';
import { dateOnly, relative } from '../../format';
import { cc } from '../../control/api';
import type { CcDomain, Project, Route, Server, Tunnel } from '../../control/types';
import { ActionButton, Cell, Notice, Row, Select, StatusPill, Table, Tabs } from '../../control/ui';

export default function Routing() {
  const { t, lang } = useApp();
  const [tab, setTab] = useState('map');
  const [domains, setDomains] = useState<CcDomain[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<'domain' | 'route' | 'tunnel' | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, r, tu, p, s] = await Promise.all([cc.domains(), cc.routes(), cc.tunnels(), cc.projects(), cc.servers()]);
      setDomains(d.domains);
      setRoutes(r.routes);
      setTunnels(tu.tunnels);
      setProjects(p.projects);
      setServers(s.servers);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading />;

  // نقشه: هر دامنه با ساب‌دامین‌هایش
  const grouped = domains.map((d) => ({ domain: d, routes: routes.filter((r) => r.domain_id === d.id) }));
  const orphanRoutes = routes.filter((r) => !r.domain_id);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t('ccRouting')}</h1>
        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={() => setModal('domain')}>
            <Plus className="h-4 w-4" />
            {t('ccNewDomain')}
          </button>
          <button className="btn btn-sm" onClick={() => setModal('tunnel')}>
            <Plus className="h-4 w-4" />
            {t('ccNewTunnel')}
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => setModal('route')}>
            <Plus className="h-4 w-4" />
            {t('ccNewRoute')}
          </button>
        </div>
      </header>

      <Tabs
        tabs={[
          { id: 'map', label: t('ccRouting'), badge: routes.length },
          { id: 'domains', label: t('domains'), badge: domains.length },
          { id: 'tunnels', label: t('ccTunnels'), badge: tunnels.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'map' && (
        <div className="space-y-3">
          {grouped.length === 0 && orphanRoutes.length === 0 && (
            <Card><Empty icon={<Globe className="h-8 w-8" />} title={t('ccNoItems')} hint={t('ccNewDomain')} /></Card>
          )}
          {grouped.map(({ domain, routes: subs }) => (
            <Card
              key={domain.id}
              title={<span dir="ltr" className="font-mono">{domain.name}</span>}
              icon={<Globe className="h-4 w-4" />}
              action={
                <div className="flex items-center gap-2">
                  {domain.ssl_status && <StatusPill status={domain.ssl_status === 'valid' ? 'online' : 'ssl_error'} compact />}
                  <ActionButton
                    busyLabel="…"
                    onClick={async () => {
                      await cc.checkDomain(domain.id);
                      load();
                    }}
                  >
                    <Radio className="h-3.5 w-3.5" />
                  </ActionButton>
                </div>
              }
            >
              {subs.length === 0 ? (
                <p className="text-xs text-ink-muted">{t('ccNoItems')}</p>
              ) : (
                <ul className="space-y-2">
                  {subs.map((r) => (
                    <li key={r.id} className="rounded-xl border border-line p-2.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span dir="ltr" className="font-mono font-medium">{r.hostname}</span>
                        <span className="text-ink-muted">→</span>
                        {r.tunnel_name ? (
                          <>
                            <span className="chip" style={{ background: 'color-mix(in srgb, var(--series-2) 14%, transparent)', color: 'var(--series-2)' }}>
                              <Waypoints className="h-3 w-3" />
                              {r.tunnel_name}
                            </span>
                            <span className="text-ink-muted">→</span>
                          </>
                        ) : null}
                        {r.server_name && (
                          <>
                            <span className="text-ink-soft">{r.server_name}</span>
                            <span className="text-ink-muted">→</span>
                          </>
                        )}
                        <span dir="ltr" className="font-mono text-ink-soft">{r.service || '—'}</span>
                        <span className="ms-auto flex items-center gap-1.5">
                          <StatusPill status={r.status} compact />
                          <ActionButton
                            busyLabel="…"
                            onClick={async () => {
                              const res = await cc.testRoute(r.id);
                              toast(`${res.hostname} · ${res.status}`, res.status === 'online' ? 'good' : 'bad');
                              load();
                            }}
                          >
                            <Radio className="h-3 w-3" />
                          </ActionButton>
                          <ActionButton onClick={async () => { await cc.deleteRoute(r.id); load(); }}>
                            <Trash2 className="h-3 w-3" />
                          </ActionButton>
                        </span>
                      </div>
                      {(r.label || r.project_name) && (
                        <p className="mt-1 text-[11px] text-ink-muted">
                          {[r.label, r.project_name].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
          {orphanRoutes.length > 0 && (
            <Card title={t('ccRouting')}>
              <Notice tone="warn">{t('ccNewDomain')}</Notice>
              <ul className="space-y-1.5 text-xs">
                {orphanRoutes.map((r) => (
                  <li key={r.id} dir="ltr" className="rounded-lg border border-line px-2.5 py-1.5 font-mono">
                    {r.hostname} → {r.service}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {tab === 'domains' && (
        <Card title={t('domains')}>
          <Table head={[t('ccDomain'), t('ccProject'), 'DNS', 'SSL', t('ccSslExpires'), t('ccDomainExpires'), '']} empty={domains.length === 0}>
            {domains.map((d) => (
              <Row key={d.id}>
                <Cell mono><span dir="ltr">{d.name}</span></Cell>
                <Cell className="text-xs">{d.project_name || '—'}</Cell>
                <Cell className="text-xs">{d.dns_status || t('stUnknown')}</Cell>
                <Cell className="text-xs">{d.ssl_status || t('notConfigured')}</Cell>
                <Cell className="text-xs">{d.ssl_expires ? dateOnly(d.ssl_expires, lang) : '—'}</Cell>
                <Cell className="text-xs">{d.reg_expires ? dateOnly(d.reg_expires, lang) : '—'}</Cell>
                <Cell>
                  <div className="flex justify-end gap-1">
                    <ActionButton busyLabel="…" onClick={async () => { await cc.checkDomain(d.id); load(); }}>
                      <Radio className="h-3.5 w-3.5" />
                    </ActionButton>
                    <ActionButton onClick={async () => { try { await cc.deleteDomain(d.id); load(); } catch (e) { toast((e as Error).message, 'bad'); } }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </ActionButton>
                  </div>
                </Cell>
              </Row>
            ))}
          </Table>
        </Card>
      )}

      {tab === 'tunnels' && (
        <div className="grid gap-3 lg:grid-cols-2">
          {tunnels.length === 0 && <Card><Empty icon={<Waypoints className="h-8 w-8" />} title={t('ccNoItems')} /></Card>}
          {tunnels.map((tn) => (
            <Card
              key={tn.id}
              title={tn.name}
              icon={<Waypoints className="h-4 w-4" />}
              action={
                <div className="flex items-center gap-1.5">
                  <StatusPill status={tn.status} compact />
                  <ActionButton
                    busyLabel="…"
                    onClick={async () => {
                      const res = await cc.testTunnel(tn.id);
                      toast(res.tunnel.status, res.tunnel.status === 'online' ? 'good' : 'bad');
                      load();
                    }}
                  >
                    <Radio className="h-3.5 w-3.5" />
                  </ActionButton>
                  <ActionButton onClick={async () => { await cc.deleteTunnel(tn.id); load(); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </ActionButton>
                </div>
              }
            >
              <p className="mb-2 text-[11px] text-ink-muted">
                {[tn.server_name, tn.project_name, tn.account_name].filter(Boolean).join(' · ') || '—'}
                {tn.last_check ? ` · ${relative(tn.last_check, lang)}` : ''}
              </p>
              {tn.tunnel_uuid && <p dir="ltr" className="mb-2 truncate font-mono text-[10px] text-ink-muted">{tn.tunnel_uuid}</p>}
              <ul className="space-y-1.5">
                {(tn.routes || []).map((r) => (
                  <li key={r.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-xs">
                    <span dir="ltr" className="min-w-0 flex-1 truncate font-mono">{r.hostname}</span>
                    <span className="text-ink-muted">→</span>
                    <span dir="ltr" className="min-w-0 flex-1 truncate font-mono text-ink-soft">{r.service}</span>
                    <ActionButton onClick={async () => { await cc.deleteTunnelRoute(tn.id, r.id); load(); }}>
                      <Trash2 className="h-3 w-3" />
                    </ActionButton>
                  </li>
                ))}
              </ul>
              <AddTunnelRoute tunnelId={tn.id} onSaved={load} />
              {tn.last_error && <p className="mt-2 text-[11px]" style={{ color: 'var(--status-critical)' }}>{tn.last_error}</p>}
            </Card>
          ))}
        </div>
      )}

      <DomainModal open={modal === 'domain'} onClose={() => setModal(null)} projects={projects} servers={servers} onSaved={() => { setModal(null); load(); }} />
      <RouteModal open={modal === 'route'} onClose={() => setModal(null)} domains={domains} projects={projects} servers={servers} tunnels={tunnels} onSaved={() => { setModal(null); load(); }} />
      <TunnelModal open={modal === 'tunnel'} onClose={() => setModal(null)} projects={projects} servers={servers} onSaved={() => { setModal(null); load(); }} />
    </div>
  );
}

function AddTunnelRoute({ tunnelId, onSaved }: { tunnelId: number; onSaved: () => void }) {
  const { t } = useApp();
  const [hostname, setHostname] = useState('');
  const [service, setService] = useState('');
  return (
    <div className="mt-2 flex gap-1.5">
      <input dir="ltr" className="input py-1.5 font-mono text-xs" placeholder="api.example.com" value={hostname} onChange={(e) => setHostname(e.target.value)} />
      <input dir="ltr" className="input py-1.5 font-mono text-xs" placeholder="http://localhost:3000" value={service} onChange={(e) => setService(e.target.value)} />
      <ActionButton
        className="btn btn-sm shrink-0"
        onClick={async () => {
          if (!hostname || !service) return;
          try {
            await cc.addTunnelRoute(tunnelId, { hostname, service });
            setHostname('');
            setService('');
            onSaved();
          } catch (e) {
            toast((e as Error).message, 'bad');
          }
        }}
      >
        <Plus className="h-3.5 w-3.5" />
        <span className="sr-only">{t('add')}</span>
      </ActionButton>
    </div>
  );
}

function DomainModal({ open, onClose, projects, servers, onSaved }: { open: boolean; onClose: () => void; projects: Project[]; servers: Server[]; onSaved: () => void }) {
  const { t } = useApp();
  const [form, setForm] = useState({ name: '', project_id: '', server_id: '', registrar: '', note: '' });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ccNewDomain')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <ActionButton
            className="btn btn-primary"
            onClick={async () => {
              try {
                await cc.addDomain({ ...form, project_id: form.project_id ? Number(form.project_id) : null, server_id: form.server_id ? Number(form.server_id) : null });
                setForm({ name: '', project_id: '', server_id: '', registrar: '', note: '' });
                onSaved();
              } catch (e) {
                toast((e as Error).message, 'bad');
              }
            }}
          >
            {t('add')}
          </ActionButton>
        </>
      }
    >
      <Field label={t('ccDomain')} hint="example.com">
        <input dir="ltr" className="input font-mono" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
      </Field>
      <Field label={t('ccProject')}>
        <Select value={form.project_id} onChange={(v) => setForm({ ...form, project_id: v })} options={projects.map((p) => ({ value: p.id, label: p.name }))} placeholder="—" />
      </Field>
      <Field label={t('ccServer')}>
        <Select value={form.server_id} onChange={(v) => setForm({ ...form, server_id: v })} options={servers.map((s) => ({ value: s.id, label: s.name }))} placeholder="—" />
      </Field>
      <Field label={t('ccRegistrar')}>
        <input className="input" value={form.registrar} onChange={(e) => setForm({ ...form, registrar: e.target.value })} />
      </Field>
    </Modal>
  );
}

function RouteModal({
  open, onClose, domains, projects, servers, tunnels, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  domains: CcDomain[];
  projects: Project[];
  servers: Server[];
  tunnels: Tunnel[];
  onSaved: () => void;
}) {
  const { t } = useApp();
  const [form, setForm] = useState({ hostname: '', domain_id: '', project_id: '', server_id: '', tunnel_id: '', kind: 'tunnel', service: '', label: '' });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ccNewRoute')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <ActionButton
            className="btn btn-primary"
            onClick={async () => {
              try {
                await cc.addRoute({
                  ...form,
                  domain_id: form.domain_id ? Number(form.domain_id) : null,
                  project_id: form.project_id ? Number(form.project_id) : null,
                  server_id: form.server_id ? Number(form.server_id) : null,
                  tunnel_id: form.tunnel_id ? Number(form.tunnel_id) : null,
                });
                setForm({ ...form, hostname: '', service: '', label: '' });
                onSaved();
              } catch (e) {
                toast((e as Error).message, 'bad');
              }
            }}
          >
            {t('add')}
          </ActionButton>
        </>
      }
    >
      <Field label={t('ccHostname')} hint="api.example.com">
        <input dir="ltr" className="input font-mono" value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} autoFocus />
      </Field>
      <Field label={t('ccTarget')} hint="http://localhost:3000">
        <input dir="ltr" className="input font-mono" value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} />
      </Field>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label={t('ccDomain')}>
          <Select value={form.domain_id} onChange={(v) => setForm({ ...form, domain_id: v })} options={domains.map((d) => ({ value: d.id, label: d.name }))} placeholder="خودکار" />
        </Field>
        <Field label={t('ccKind')}>
          <Select value={form.kind} onChange={(v) => setForm({ ...form, kind: v })} options={['tunnel', 'dns', 'proxy', 'manual'].map((x) => ({ value: x, label: x }))} />
        </Field>
        <Field label={t('ccTunnels')}>
          <Select value={form.tunnel_id} onChange={(v) => setForm({ ...form, tunnel_id: v })} options={tunnels.map((x) => ({ value: x.id, label: x.name }))} placeholder="—" />
        </Field>
        <Field label={t('ccProject')}>
          <Select value={form.project_id} onChange={(v) => setForm({ ...form, project_id: v })} options={projects.map((p) => ({ value: p.id, label: p.name }))} placeholder="—" />
        </Field>
        <Field label={t('ccServer')}>
          <Select value={form.server_id} onChange={(v) => setForm({ ...form, server_id: v })} options={servers.map((s) => ({ value: s.id, label: s.name }))} placeholder="—" />
        </Field>
        <Field label={t('ccLabel')}>
          <input className="input" placeholder="REST API" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function TunnelModal({ open, onClose, projects, servers, onSaved }: { open: boolean; onClose: () => void; projects: Project[]; servers: Server[]; onSaved: () => void }) {
  const { t } = useApp();
  const [form, setForm] = useState({ name: '', tunnel_uuid: '', project_id: '', server_id: '', note: '' });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ccNewTunnel')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <ActionButton
            className="btn btn-primary"
            onClick={async () => {
              if (!form.name.trim()) return toast(t('ccRequired'), 'bad');
              try {
                await cc.addTunnel({ ...form, project_id: form.project_id ? Number(form.project_id) : null, server_id: form.server_id ? Number(form.server_id) : null });
                setForm({ name: '', tunnel_uuid: '', project_id: '', server_id: '', note: '' });
                onSaved();
              } catch (e) {
                toast((e as Error).message, 'bad');
              }
            }}
          >
            {t('add')}
          </ActionButton>
        </>
      }
    >
      <Field label={t('name')}><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
      <Field label="Tunnel ID" hint="از پنل Cloudflare"><input dir="ltr" className="input font-mono text-xs" value={form.tunnel_uuid} onChange={(e) => setForm({ ...form, tunnel_uuid: e.target.value })} /></Field>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label={t('ccServer')}>
          <Select value={form.server_id} onChange={(v) => setForm({ ...form, server_id: v })} options={servers.map((s) => ({ value: s.id, label: s.name }))} placeholder="—" />
        </Field>
        <Field label={t('ccProject')}>
          <Select value={form.project_id} onChange={(v) => setForm({ ...form, project_id: v })} options={projects.map((p) => ({ value: p.id, label: p.name }))} placeholder="—" />
        </Field>
      </div>
    </Modal>
  );
}
