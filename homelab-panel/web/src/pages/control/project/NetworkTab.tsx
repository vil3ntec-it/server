// ---------------------------------------------------------------------------
//  زبانهٔ شبکهٔ یک پروژه — Endpointها، IPها و پورت‌ها
//  «هیچ پورتی بدون بررسی ثبت نشود» این‌جا واقعاً اجرا می‌شود.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { Network, Plus, Radio, Trash2 } from 'lucide-react';
import { useApp } from '../../../app-context';
import { Card, Field, Modal, toast } from '../../../components/ui';
import { relative } from '../../../format';
import { cc, type ProjectBundle } from '../../../control/api';
import type { Server } from '../../../control/types';
import { ActionButton, Cell, Notice, Row, Select, StatusPill, Table, Url } from '../../../control/ui';

export default function NetworkTab({
  bundle,
  servers,
  reload,
}: {
  bundle: ProjectBundle;
  servers: Server[];
  reload: () => void;
}) {
  const { t, lang } = useApp();
  const id = bundle.project.project_id;
  const [endpointOpen, setEndpointOpen] = useState(false);
  const [ipOpen, setIpOpen] = useState(false);
  const [portOpen, setPortOpen] = useState(false);

  const serverOptions = servers.map((s) => ({ value: s.id, label: s.name }));

  return (
    <div className="space-y-4">
      {/* ───────────────────── Endpointها ───────────────────── */}
      <Card
        title={t('ccEndpoints')}
        icon={<Network className="h-4 w-4" />}
        action={
          <button className="btn btn-sm btn-primary" onClick={() => setEndpointOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('ccNewEndpoint')}
          </button>
        }
      >
        <Table
          head={[t('ccEnvironment'), t('name'), 'URL', t('status'), t('ccLastCheck'), '']}
          empty={bundle.endpoints.length === 0}
        >
          {bundle.endpoints.map((e) => (
            <Row key={e.id}>
              <Cell>
                <span className="chip" style={{ background: 'color-mix(in srgb, var(--series-1) 14%, transparent)', color: 'var(--series-1)' }}>
                  {e.environment}
                </span>
              </Cell>
              <Cell>
                {e.name || '—'}
                {e.is_primary ? <span className="ms-1 text-[10px] text-ink-muted">({t('ccPrimary')})</span> : null}
              </Cell>
              <Cell><Url value={e.url} /></Cell>
              <Cell><StatusPill status={e.status} code={e.status_code} latency={e.latency_ms} /></Cell>
              <Cell className="text-[11px] text-ink-muted">{e.checked_at ? relative(e.checked_at, lang) : t('ccNever')}</Cell>
              <Cell>
                <div className="flex justify-end gap-1">
                  <ActionButton
                    busyLabel="…"
                    onClick={async () => {
                      const res = await cc.testEndpoint(id, e.id);
                      toast(`${res.result.status}${res.result.code ? ` · ${res.result.code}` : ''}`, res.result.status === 'online' ? 'good' : 'bad');
                      reload();
                    }}
                  >
                    <Radio className="h-3.5 w-3.5" />
                  </ActionButton>
                  <ActionButton
                    className="btn btn-sm"
                    onClick={async () => {
                      await cc.deleteEndpoint(id, e.id);
                      reload();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </ActionButton>
                </div>
              </Cell>
            </Row>
          ))}
        </Table>
      </Card>

      {/* ───────────────────── IPها ───────────────────── */}
      <Card
        title={t('ccIps')}
        action={
          <button className="btn btn-sm" onClick={() => setIpOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('ccNewIp')}
          </button>
        }
      >
        <Table head={[t('ccKind'), t('internalIp'), t('port'), t('ccEnvironment'), t('ccDescription'), '']} empty={bundle.ips.length === 0}>
          {bundle.ips.map((ip) => (
            <Row key={ip.id}>
              <Cell>
                <span className="chip" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>{ip.kind}</span>
              </Cell>
              <Cell mono><span dir="ltr">{ip.address}</span> <span className="text-[10px] text-ink-muted">{ip.family}</span></Cell>
              <Cell className="tnum">{ip.port || '—'}</Cell>
              <Cell>{ip.environment}</Cell>
              <Cell className="text-[11px] text-ink-muted">{ip.description || '—'}</Cell>
              <Cell>
                <div className="flex justify-end">
                  <ActionButton
                    onClick={async () => {
                      await cc.deleteIp(id, ip.id);
                      reload();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </ActionButton>
                </div>
              </Cell>
            </Row>
          ))}
        </Table>
      </Card>

      {/* ───────────────────── پورت‌ها ───────────────────── */}
      <Card
        title={t('ccPorts')}
        action={
          <button className="btn btn-sm" onClick={() => setPortOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('ccNewPort')}
          </button>
        }
      >
        <Table head={[t('port'), t('ccProtocol'), t('ccService'), t('ccServer'), t('status'), '']} empty={bundle.ports.length === 0}>
          {bundle.ports.map((port) => (
            <Row key={port.id}>
              <Cell className="tnum font-semibold">{port.port}</Cell>
              <Cell>{port.protocol}</Cell>
              <Cell>{port.service || '—'}</Cell>
              <Cell>{servers.find((s) => s.id === port.server_id)?.name || '—'}</Cell>
              <Cell><StatusPill status={port.status} compact /></Cell>
              <Cell>
                <div className="flex justify-end">
                  <ActionButton
                    onClick={async () => {
                      await cc.deletePort(id, port.id);
                      reload();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </ActionButton>
                </div>
              </Cell>
            </Row>
          ))}
        </Table>
      </Card>

      <EndpointModal
        open={endpointOpen}
        onClose={() => setEndpointOpen(false)}
        projectId={id}
        servers={serverOptions}
        defaultServer={bundle.project.server_id}
        onSaved={() => {
          setEndpointOpen(false);
          reload();
        }}
      />
      <IpModal
        open={ipOpen}
        onClose={() => setIpOpen(false)}
        projectId={id}
        servers={serverOptions}
        defaultServer={bundle.project.server_id}
        onSaved={() => {
          setIpOpen(false);
          reload();
        }}
      />
      <PortModal
        open={portOpen}
        onClose={() => setPortOpen(false)}
        projectId={id}
        servers={serverOptions}
        defaultServer={bundle.project.server_id}
        onSaved={() => {
          setPortOpen(false);
          reload();
        }}
      />
    </div>
  );
}

/* --------------------------- افزودن Endpoint --------------------------- */

function EndpointModal({
  open, onClose, projectId, servers, defaultServer, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  servers: { value: number; label: string }[];
  defaultServer: number | null;
  onSaved: () => void;
}) {
  const { t } = useApp();
  const [form, setForm] = useState({
    protocol: 'https',
    host: '',
    port: '',
    path: '/',
    environment: 'production',
    name: '',
    server_id: defaultServer ? String(defaultServer) : '',
    is_primary: false,
    monitored: true,
  });

  const preview = form.host
    ? `${form.protocol}://${form.host}${form.port ? `:${form.port}` : ''}${form.path && form.path !== '/' ? form.path : ''}`
    : '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ccNewEndpoint')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <ActionButton
            className="btn btn-primary"
            onClick={async () => {
              if (!form.host.trim()) return toast(t('ccRequired'), 'bad');
              try {
                await cc.addEndpoint(projectId, {
                  ...form,
                  port: form.port ? Number(form.port) : null,
                  server_id: form.server_id ? Number(form.server_id) : null,
                });
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
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label={t('ccProtocol')}>
          <Select
            value={form.protocol}
            onChange={(v) => setForm({ ...form, protocol: v })}
            options={[
              { value: 'https', label: 'https' },
              { value: 'http', label: 'http' },
              { value: 'wss', label: 'wss' },
              { value: 'ws', label: 'ws' },
            ]}
          />
        </Field>
        <Field label={t('ccEnvironment')}>
          <Select
            value={form.environment}
            onChange={(v) => setForm({ ...form, environment: v })}
            options={[
              { value: 'production', label: 'production' },
              { value: 'staging', label: 'staging' },
              { value: 'development', label: 'development' },
            ]}
          />
        </Field>
      </div>
      <Field label={t('ccHost')} hint="api.example.com یا 192.168.0.102">
        <input dir="ltr" className="input" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} autoFocus />
      </Field>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label={t('port')}>
          <input dir="ltr" className="input tnum" placeholder="443" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
        </Field>
        <Field label={t('ccPathLabel')}>
          <input dir="ltr" className="input" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} />
        </Field>
      </div>
      <Field label={t('name')}>
        <input className="input" placeholder="REST API" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      {servers.length > 0 && (
        <Field label={t('ccServer')}>
          <Select value={form.server_id} onChange={(v) => setForm({ ...form, server_id: v })} options={servers} placeholder="—" />
        </Field>
      )}
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.is_primary} onChange={(e) => setForm({ ...form, is_primary: e.target.checked })} />
        {t('ccPrimary')}
      </label>
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.monitored} onChange={(e) => setForm({ ...form, monitored: e.target.checked })} />
        {t('ccMonitored')}
      </label>
      {preview && <p dir="ltr" className="mt-2 break-all rounded-xl bg-surface-sunken p-2.5 font-mono text-xs">{preview}</p>}
    </Modal>
  );
}

/* ------------------------------ افزودن IP ------------------------------ */

function IpModal({
  open, onClose, projectId, servers, defaultServer, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  servers: { value: number; label: string }[];
  defaultServer: number | null;
  onSaved: () => void;
}) {
  const { t } = useApp();
  const [form, setForm] = useState({ address: '', kind: 'lan', port: '', environment: 'production', description: '', server_id: defaultServer ? String(defaultServer) : '' });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ccNewIp')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <ActionButton
            className="btn btn-primary"
            onClick={async () => {
              if (!form.address.trim()) return toast(t('ccRequired'), 'bad');
              try {
                await cc.addIp(projectId, {
                  ...form,
                  port: form.port ? Number(form.port) : null,
                  server_id: form.server_id ? Number(form.server_id) : null,
                });
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
      <Field label={t('internalIp')} hint="192.168.0.102 · 2001:db8::1">
        <input dir="ltr" className="input font-mono" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} autoFocus />
      </Field>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label={t('ccKind')}>
          <Select
            value={form.kind}
            onChange={(v) => setForm({ ...form, kind: v })}
            options={[
              { value: 'local', label: t('ccIpKindLocal') },
              { value: 'lan', label: t('ccIpKindLan') },
              { value: 'public', label: t('ccIpKindPublic') },
              { value: 'server', label: t('ccIpKindServer') },
              { value: 'vps', label: t('ccIpKindVps') },
            ]}
          />
        </Field>
        <Field label={t('port')}>
          <input dir="ltr" className="input tnum" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
        </Field>
      </div>
      {servers.length > 0 && (
        <Field label={t('ccServer')}>
          <Select value={form.server_id} onChange={(v) => setForm({ ...form, server_id: v })} options={servers} placeholder="—" />
        </Field>
      )}
      <Field label={t('ccDescription')}>
        <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
    </Modal>
  );
}

/* ----------------------------- افزودن پورت ----------------------------- */

function PortModal({
  open, onClose, projectId, servers, defaultServer, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  servers: { value: number; label: string }[];
  defaultServer: number | null;
  onSaved: () => void;
}) {
  const { t } = useApp();
  const [form, setForm] = useState({ port: '', protocol: 'tcp', service: '', host: '', server_id: defaultServer ? String(defaultServer) : '', note: '' });
  const [inspection, setInspection] = useState<Awaited<ReturnType<typeof cc.inspectPort>> | null>(null);

  async function inspect() {
    if (!form.port) return toast(t('ccRequired'), 'bad');
    try {
      setInspection(
        await cc.inspectPort(projectId, {
          port: Number(form.port),
          protocol: form.protocol,
          host: form.host || null,
          server_id: form.server_id ? Number(form.server_id) : null,
        })
      );
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  async function save(force = false) {
    try {
      await cc.addPort(projectId, {
        port: Number(form.port),
        protocol: form.protocol,
        service: form.service || null,
        host: form.host || null,
        server_id: form.server_id ? Number(form.server_id) : null,
        note: form.note || null,
        force,
      });
      setInspection(null);
      setForm({ ...form, port: '', service: '', note: '' });
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        setInspection(null);
        onClose();
      }}
      title={t('ccNewPort')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          {!inspection ? (
            <ActionButton className="btn" onClick={inspect} busyLabel={t('ccTesting')}>
              {t('ccCheckFirst')}
            </ActionButton>
          ) : inspection.inUseByOther ? (
            <ActionButton className="btn btn-danger" onClick={() => save(true)}>
              {t('ccForceRegister')}
            </ActionButton>
          ) : (
            <ActionButton className="btn btn-primary" onClick={() => save(false)}>
              {t('add')}
            </ActionButton>
          )}
        </>
      }
    >
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label={t('port')}>
          <input
            dir="ltr"
            className="input tnum"
            value={form.port}
            onChange={(e) => {
              setForm({ ...form, port: e.target.value });
              setInspection(null);
            }}
            autoFocus
          />
        </Field>
        <Field label={t('ccProtocol')}>
          <Select
            value={form.protocol}
            onChange={(v) => setForm({ ...form, protocol: v })}
            options={['tcp', 'udp', 'http', 'https', 'ws', 'wss'].map((x) => ({ value: x, label: x }))}
          />
        </Field>
      </div>
      <Field label={t('ccService')}>
        <input className="input" placeholder="REST API" value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} />
      </Field>
      {servers.length > 0 && (
        <Field label={t('ccServer')}>
          <Select value={form.server_id} onChange={(v) => setForm({ ...form, server_id: v })} options={servers} placeholder="—" />
        </Field>
      )}
      <Field label={t('ccHost')} hint="127.0.0.1">
        <input dir="ltr" className="input" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
      </Field>

      {inspection && (
        <div className="mt-3">
          {inspection.inUseByOther ? (
            <Notice tone="bad">
              {inspection.conflicts.map((c) => (
                <p key={c.id}>{t('ccPortInUse', { project: c.project_name || '?' })}</p>
              ))}
            </Notice>
          ) : inspection.listeningButUnregistered ? (
            <Notice tone="warn">{t('ccPortListening')}</Notice>
          ) : (
            <Notice tone="good">{t('ccPortFree')}</Notice>
          )}
          {inspection.probe && (
            <p className="text-xs text-ink-muted">
              {t('status')}: <StatusPill status={inspection.probe.status} latency={inspection.probe.latencyMs} />
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
