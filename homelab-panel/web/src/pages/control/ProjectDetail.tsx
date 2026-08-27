// ---------------------------------------------------------------------------
//  صفحهٔ اختصاصیِ یک پروژه — همه‌چیزِ همان پروژه، و فقط همان پروژه
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight, Boxes, Database, Globe, HardDrive, Network, Play, Settings2, Trash2, Users,
} from 'lucide-react';
import { useApp } from '../../app-context';
import { Card, ConfirmDialog, Empty, Field, Loading, Modal, toast } from '../../components/ui';
import { bytes, dateTime, relative } from '../../format';
import { cc, type ProjectBundle } from '../../control/api';
import type { Server } from '../../control/types';
import { ActionButton, KV, Notice, Select, StatusPill, Tabs, Url, useLabels } from '../../control/ui';
import NetworkTab from './project/NetworkTab';
import AccountsTab from './project/AccountsTab';
import StorageTab from './project/StorageTab';
import ConfigTab from './project/ConfigTab';
import MigrateTab from './project/MigrateTab';

export default function ProjectDetail() {
  const { t, lang } = useApp();
  const labels = useLabels();
  const { projectId = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<ProjectBundle | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [testResults, setTestResults] = useState<{ kind: string; label: string; url: string; status: string; code: number | null; latencyMs: number | null }[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [bundle, s] = await Promise.all([cc.project(projectId), cc.servers()]);
      setData(bundle);
      setServers(s.servers);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  if (loading) return <Loading />;
  if (!data) return <Empty title={t('noData')} />;

  const p = data.project;

  const tabs = [
    { id: 'overview', label: t('ccOverview') },
    { id: 'network', label: t('ccNetworking'), badge: data.endpoints.length + data.ips.length + data.ports.length },
    { id: 'accounts', label: t('ccAccounts'), badge: data.counts.users + data.counts.shops },
    { id: 'storage', label: t('ccStorage'), badge: data.backups.length },
    { id: 'config', label: t('ccConfig'), badge: data.configs.length },
    { id: 'migrate', label: t('ccMigrate') },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/control/projects" className="mb-1 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink">
            <ArrowRight className="h-3.5 w-3.5 rtl:rotate-0 ltr:rotate-180" />
            {t('ccProjects')}
          </Link>
          <h1 className="truncate text-lg font-semibold">{p.name}</h1>
          <p dir="ltr" className="truncate font-mono text-[11px] text-ink-muted">
            {p.project_id} · {p.slug}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            className="btn btn-sm"
            busyLabel={t('ccTesting')}
            onClick={async () => {
              const res = await cc.testProject(projectId);
              setTestResults(res.results);
              load();
            }}
          >
            <Play className="h-4 w-4" />
            {t('ccTestAll')}
          </ActionButton>
          <button className="btn btn-sm" onClick={() => setEditing(true)}>
            <Settings2 className="h-4 w-4" />
            {t('ccEdit')}
          </button>
          <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4" />
            {t('ccDelete')}
          </button>
        </div>
      </header>

      {data.alerts.length > 0 && (
        <Notice tone="bad">
          {data.alerts.slice(0, 3).map((a) => (
            <p key={a.id}>{a.title}</p>
          ))}
        </Notice>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t('ccOverview')} icon={<Boxes className="h-4 w-4" />}>
            <KV label={t('ccProjectId')} mono>{p.project_id}</KV>
            <KV label={t('ccType')}>{labels.projectType(p.type)}</KV>
            <KV label={t('ccVersion')}>{p.version || '—'}</KV>
            <KV label={t('status')}>{p.status}</KV>
            <KV label={t('ccServer')}>{data.server ? `${data.server.name} — ${labels.serverKind(data.server.kind)}` : '—'}</KV>
            <KV label={t('ccRepoUrl')} mono>{p.repo_url || '—'}</KV>
            <KV label={t('ccCreatedAt')}>{dateTime(p.created_at, lang)}</KV>
            {p.description && <p className="mt-3 text-xs leading-relaxed text-ink-soft">{p.description}</p>}
          </Card>

          <Card title={t('ccEndpoints')} icon={<Network className="h-4 w-4" />}>
            {data.endpoints.length === 0 ? (
              <Empty title={t('ccNoItems')} />
            ) : (
              <ul className="space-y-2">
                {data.endpoints.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2">
                    <span className="chip" style={{ background: 'color-mix(in srgb, var(--series-1) 14%, transparent)', color: 'var(--series-1)' }}>
                      {e.environment}
                    </span>
                    <Url value={e.url} />
                    <span className="ms-auto">
                      <StatusPill status={e.status} code={e.status_code} latency={e.latency_ms} compact />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t('ccRouting')} icon={<Globe className="h-4 w-4" />}>
            {data.routes.length === 0 ? (
              <Empty title={t('ccNoItems')} hint={t('ccNewRoute')} />
            ) : (
              <ul className="space-y-2">
                {data.routes.map((r) => (
                  <li key={r.id} className="rounded-xl border border-line px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span dir="ltr" className="font-mono">{r.hostname}</span>
                      <span className="text-ink-muted">→</span>
                      {r.tunnel_name && <span className="text-ink-soft">{r.tunnel_name}</span>}
                      {r.tunnel_name && <span className="text-ink-muted">→</span>}
                      <span dir="ltr" className="font-mono text-ink-soft">{r.service || '—'}</span>
                    </div>
                    {r.label && <p className="mt-0.5 text-[11px] text-ink-muted">{r.label}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t('ccStorage')} icon={<HardDrive className="h-4 w-4" />}>
            <p dir="ltr" className="mb-2 break-all font-mono text-[11px] text-ink-muted">{data.storage.dir}</p>
            <div className="flex flex-wrap gap-1.5">
              {data.storage.folders.map((f) => (
                <span key={f} className="chip" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
                  {f}/
                </span>
              ))}
            </div>
            <div className="mt-3">
              <KV label={t('size')}>{bytes(data.storage.bytes)}</KV>
              <KV label={t('ccFiles')}>{data.storage.files}</KV>
              <KV label={t('ccBackups')}>
                {data.backups[0] ? relative(data.backups[0].created_at, lang) : t('ccNever')}
              </KV>
            </div>
          </Card>

          {(p.db_kind || data.counts.users > 0) && (
            <Card title={t('ccData')} icon={<Database className="h-4 w-4" />}>
              <KV label={t('ccDbKind')}>{p.db_kind || '—'}</KV>
              <KV label={t('ccDbHost')} mono>{p.db_host ? `${p.db_host}${p.db_port ? `:${p.db_port}` : ''}` : '—'}</KV>
              <KV label={t('ccDbName')} mono>{p.db_name || '—'}</KV>
              <KV label={t('ccUsers')}>{data.counts.users}</KV>
              <KV label={t('ccAccounts')}>{data.counts.shops}</KV>
            </Card>
          )}

          {data.secrets.length > 0 && (
            <Card title={t('ccVault')} icon={<Users className="h-4 w-4" />}>
              <ul className="space-y-1.5 text-xs">
                {data.secrets.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
                    <span className="truncate">{s.name}</span>
                    <span className="font-mono text-ink-muted">{s.hint}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {tab === 'network' && <NetworkTab bundle={data} servers={servers} reload={load} />}
      {tab === 'accounts' && <AccountsTab projectId={projectId} />}
      {tab === 'storage' && <StorageTab bundle={data} reload={load} />}
      {tab === 'config' && <ConfigTab bundle={data} reload={load} />}
      {tab === 'migrate' && <MigrateTab bundle={data} servers={servers} reload={load} />}

      {/* نتیجهٔ آزمایشِ همه‌چیز */}
      <Modal open={Boolean(testResults)} onClose={() => setTestResults(null)} title={t('ccTestAll')} wide>
        {testResults?.length ? (
          <ul className="space-y-2">
            {testResults.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2 text-xs">
                <span className="chip" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>{r.kind}</span>
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                <Url value={r.url} />
                <StatusPill status={r.status} code={r.code} latency={r.latencyMs} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty title={t('ccNoItems')} />
        )}
      </Modal>

      <EditProject
        open={editing}
        onClose={() => setEditing(false)}
        bundle={data}
        servers={servers}
        onSaved={() => {
          setEditing(false);
          load();
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        danger
        title={t('ccDelete')}
        message={t('ccConfirmDelete', { name: p.name })}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setConfirmDelete(false);
          try {
            const res = await cc.deleteProject(projectId);
            toast(res.backup?.filename || t('ccDelete'));
            navigate('/control/projects');
          } catch (e) {
            toast((e as Error).message, 'bad');
          }
        }}
      />
    </div>
  );
}

/* ----------------------------- ویرایش پروژه ---------------------------- */

function EditProject({
  open,
  onClose,
  bundle,
  servers,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  bundle: ProjectBundle;
  servers: Server[];
  onSaved: () => void;
}) {
  const { t } = useApp();
  const labels = useLabels();
  const p = bundle.project;
  const [form, setForm] = useState({
    name: p.name,
    version: p.version || '',
    status: p.status,
    server_id: p.server_id ? String(p.server_id) : '',
    description: p.description || '',
    repo_url: p.repo_url || '',
    db_kind: p.db_kind || '',
    db_host: p.db_host || '',
    db_port: p.db_port ? String(p.db_port) : '',
    db_name: p.db_name || '',
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      name: p.name,
      version: p.version || '',
      status: p.status,
      server_id: p.server_id ? String(p.server_id) : '',
      description: p.description || '',
      repo_url: p.repo_url || '',
      db_kind: p.db_kind || '',
      db_host: p.db_host || '',
      db_port: p.db_port ? String(p.db_port) : '',
      db_name: p.db_name || '',
    });
  }, [open, p]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ccEdit')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <ActionButton
            className="btn btn-primary"
            onClick={async () => {
              try {
                await cc.updateProject(p.project_id, {
                  name: form.name,
                  version: form.version || null,
                  status: form.status,
                  server_id: form.server_id ? Number(form.server_id) : null,
                  description: form.description || null,
                  repo_url: form.repo_url || null,
                  db_kind: form.db_kind || null,
                  db_host: form.db_host || null,
                  db_port: form.db_port ? Number(form.db_port) : null,
                  db_name: form.db_name || null,
                });
                toast(t('ccSave'));
                onSaved();
              } catch (e) {
                toast((e as Error).message, 'bad');
              }
            }}
          >
            {t('ccSave')}
          </ActionButton>
        </>
      }
    >
      <Field label={t('ccProjectName')}>
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label={t('ccVersion')}>
          <input dir="ltr" className="input" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
        </Field>
        <Field label={t('status')}>
          <Select
            value={form.status}
            onChange={(v) => setForm({ ...form, status: v })}
            options={[
              { value: 'active', label: t('stActive') },
              { value: 'paused', label: t('stPaused') },
              { value: 'archived', label: t('stArchived') },
            ]}
          />
        </Field>
      </div>
      <Field label={t('ccServer')}>
        <Select
          value={form.server_id}
          onChange={(v) => setForm({ ...form, server_id: v })}
          options={servers.map((s) => ({ value: s.id, label: `${s.name} — ${labels.serverKind(s.kind)}` }))}
          placeholder="—"
        />
      </Field>
      <Field label={t('ccRepoUrl')}>
        <input dir="ltr" className="input" value={form.repo_url} onChange={(e) => setForm({ ...form, repo_url: e.target.value })} />
      </Field>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label={t('ccDbKind')}>
          <Select
            value={form.db_kind}
            onChange={(v) => setForm({ ...form, db_kind: v })}
            options={['postgres', 'mysql', 'mariadb', 'sqlite', 'mongo', 'redis', 'none'].map((x) => ({ value: x, label: x }))}
            placeholder="—"
          />
        </Field>
        <Field label={t('ccDbName')}>
          <input dir="ltr" className="input" value={form.db_name} onChange={(e) => setForm({ ...form, db_name: e.target.value })} />
        </Field>
        <Field label={t('ccDbHost')}>
          <input dir="ltr" className="input" value={form.db_host} onChange={(e) => setForm({ ...form, db_host: e.target.value })} />
        </Field>
        <Field label={t('port')}>
          <input dir="ltr" className="input tnum" value={form.db_port} onChange={(e) => setForm({ ...form, db_port: e.target.value })} />
        </Field>
      </div>
      <Field label={t('ccDescription')}>
        <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
    </Modal>
  );
}
