// ---------------------------------------------------------------------------
//  فهرست پروژه‌ها — گروه‌بندی‌شده بر اساس نوع، دقیقاً مثل ساختار خواسته‌شده
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Boxes, Plus, Search } from 'lucide-react';
import { useApp } from '../../app-context';
import { Card, Empty, Field, Loading, Modal, toast } from '../../components/ui';
import { relative } from '../../format';
import { cc } from '../../control/api';
import type { Project, Server } from '../../control/types';
import { ActionButton, Select, StatusPill, useLabels } from '../../control/ui';

const GROUPS: { key: string; types: string[] }[] = [
  { key: 'android', types: ['android'] },
  { key: 'desktop', types: ['desktop'] },
  { key: 'website', types: ['website'] },
  { key: 'webapp', types: ['webapp'] },
  { key: 'api', types: ['api', 'websocket'] },
  { key: 'backend', types: ['backend', 'service', 'database'] },
];

export default function Projects() {
  const { t, lang } = useApp();
  const labels = useLabels();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'api', version: '', server_id: '', description: '', repo_url: '' });

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([cc.projects(), cc.servers()]);
      setProjects(p.projects);
      setTypes(p.types);
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.project_id.includes(q) || p.slug.includes(q)
    );
  }, [projects, query]);

  const grouped = useMemo(() => {
    const seen = new Set<string>();
    const out = GROUPS.map((g) => {
      const items = filtered.filter((p) => g.types.includes(p.type));
      items.forEach((p) => seen.add(p.project_id));
      return { ...g, items };
    }).filter((g) => g.items.length > 0);
    const rest = filtered.filter((p) => !seen.has(p.project_id));
    if (rest.length) out.push({ key: 'service', types: [], items: rest });
    return out;
  }, [filtered]);

  async function create() {
    if (!form.name.trim()) return toast(t('ccRequired'), 'bad');
    try {
      const res = await cc.createProject({
        name: form.name.trim(),
        type: form.type,
        version: form.version || null,
        server_id: form.server_id ? Number(form.server_id) : null,
        description: form.description || null,
        repo_url: form.repo_url || null,
      });
      toast(res.storage.dir);
      setOpen(false);
      setForm({ name: '', type: 'api', version: '', server_id: '', description: '', repo_url: '' });
      navigate(`/control/projects/${res.project.project_id}`);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t('ccProjects')}</h1>
        <div className="flex flex-1 items-center justify-end gap-2">
          <div className="relative max-w-xs flex-1">
            <Search className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-4 w-4 text-ink-muted" />
            <input
              className="input ps-9"
              placeholder={t('ccSearch')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button className="btn btn-primary btn-sm shrink-0" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('ccNewProject')}
          </button>
        </div>
      </header>

      {filtered.length === 0 ? (
        <Card>
          <Empty icon={<Boxes className="h-8 w-8" />} title={t('ccNoItems')} hint={t('ccNewProject')} />
        </Card>
      ) : (
        grouped.map((group) => (
          <section key={group.key}>
            <h2 className="mb-2 text-xs font-medium text-ink-muted">{labels.projectType(group.key)}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.items.map((p) => (
                <Link
                  key={p.project_id}
                  to={`/control/projects/${p.project_id}`}
                  className="card rise p-4 transition hover:brightness-105"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{p.name}</p>
                      <p dir="ltr" className="truncate font-mono text-[11px] text-ink-muted">{p.project_id}</p>
                    </div>
                    <StatusPill status={(p.down ?? 0) > 0 ? 'offline' : (p.online ?? 0) > 0 ? 'online' : 'unknown'} compact />
                  </div>
                  <dl className="space-y-1 text-[11px] text-ink-muted">
                    <div className="flex justify-between gap-2">
                      <dt>{t('ccType')}</dt>
                      <dd className="text-ink-soft">{labels.projectType(p.type)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>{t('ccServer')}</dt>
                      <dd className="truncate text-ink-soft">{p.server_name || '—'}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>{t('ccEndpoints')}</dt>
                      <dd className="tnum text-ink-soft">{p.online}/{p.endpoints}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>{t('ccBackups')}</dt>
                      <dd className="text-ink-soft">{p.lastBackup ? relative(p.lastBackup, lang) : t('ccNever')}</dd>
                    </div>
                  </dl>
                  {(p.openAlerts ?? 0) > 0 && (
                    <p className="mt-2 text-[11px]" style={{ color: 'var(--status-critical)' }}>
                      {p.openAlerts} {t('ccAlerts')}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          </section>
        ))
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('ccNewProject')}
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>{t('cancel')}</button>
            <ActionButton className="btn btn-primary" onClick={create}>{t('ccCreate')}</ActionButton>
          </>
        }
      >
        <Field label={t('ccProjectName')}>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>
        <Field label={t('ccType')}>
          <Select
            value={form.type}
            onChange={(v) => setForm({ ...form, type: v })}
            options={types.map((x) => ({ value: x, label: labels.projectType(x) }))}
          />
        </Field>
        <Field label={t('ccServer')}>
          <Select
            value={form.server_id}
            onChange={(v) => setForm({ ...form, server_id: v })}
            options={servers.map((s) => ({ value: s.id, label: `${s.name} — ${labels.serverKind(s.kind)}` }))}
            placeholder="—"
          />
        </Field>
        <Field label={t('ccVersion')}>
          <input dir="ltr" className="input" placeholder="1.0.0" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
        </Field>
        <Field label={t('ccRepoUrl')}>
          <input dir="ltr" className="input" placeholder="https://github.com/…" value={form.repo_url} onChange={(e) => setForm({ ...form, repo_url: e.target.value })} />
        </Field>
        <Field label={t('ccDescription')}>
          <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
      </Modal>
    </div>
  );
}
