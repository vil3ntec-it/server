// ---------------------------------------------------------------------------
//  گاوصندوق — توکن‌ها و اعتبارنامه‌ها، رمزنگاری‌شده روی دیسک.
//  هیچ مقداری در این صفحه نشان داده نمی‌شود؛ فقط ماسک و چهار نویسهٔ آخر.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useApp } from '../../app-context';
import { Card, Field, Loading, Modal, toast } from '../../components/ui';
import { relative } from '../../format';
import { cc } from '../../control/api';
import type { Project, Secret, Server } from '../../control/types';
import { ActionButton, Cell, Notice, Row, Select, Table } from '../../control/ui';

export default function Vault() {
  const { t, lang } = useApp();
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [health, setHealth] = useState<{ ready: boolean; total: number; readable: number; broken: { id: number; name: string }[] } | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [v, p, s] = await Promise.all([cc.vault(), cc.projects(), cc.servers()]);
      setSecrets(v.secrets);
      setKinds(v.kinds);
      setHealth(v.health);
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

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t('ccVault')}</h1>
        <button className="btn btn-sm btn-primary" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          {t('ccNewSecret')}
        </button>
      </header>

      {health && health.broken.length > 0 && (
        <Notice tone="bad">
          {health.broken.map((b) => (
            <p key={b.id}>{b.name}</p>
          ))}
        </Notice>
      )}

      <Card
        title={t('ccVault')}
        icon={<KeyRound className="h-4 w-4" />}
        action={
          health && (
            <span className="chip" style={{ background: `color-mix(in srgb, ${health.readable === health.total ? 'var(--status-good)' : 'var(--status-critical)'} 15%, transparent)`, color: health.readable === health.total ? 'var(--status-good)' : 'var(--status-critical)' }}>
              <ShieldCheck className="h-3.5 w-3.5" />
              {health.readable}/{health.total}
            </span>
          )
        }
      >
        <Notice>{t('ccSecretHint')}</Notice>
        <Table head={[t('name'), t('ccKind'), t('ccScope'), t('ccSecretValue'), t('ccLastCheck'), '']} empty={secrets.length === 0}>
          {secrets.map((s) => (
            <Row key={s.id}>
              <Cell>{s.name}</Cell>
              <Cell><span className="chip" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>{s.kind}</span></Cell>
              <Cell className="text-xs">
                {s.scope === 'project'
                  ? projects.find((p) => p.id === s.project_id)?.name || t('ccScopeProject')
                  : s.scope === 'server'
                    ? servers.find((x) => x.id === s.server_id)?.name || t('ccScopeServer')
                    : t('ccScopeGlobal')}
              </Cell>
              <Cell mono>{s.hint || s.masked}</Cell>
              <Cell className="text-[11px] text-ink-muted">{s.last_used ? relative(s.last_used, lang) : t('ccNever')}</Cell>
              <Cell>
                <div className="flex justify-end">
                  <ActionButton onClick={async () => { await cc.deleteSecret(s.id); load(); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </ActionButton>
                </div>
              </Cell>
            </Row>
          ))}
        </Table>
      </Card>

      <SecretModal
        open={open}
        onClose={() => setOpen(false)}
        kinds={kinds}
        projects={projects}
        servers={servers}
        onSaved={() => {
          setOpen(false);
          load();
        }}
      />
    </div>
  );
}

function SecretModal({
  open, onClose, kinds, projects, servers, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  kinds: string[];
  projects: Project[];
  servers: Server[];
  onSaved: () => void;
}) {
  const { t } = useApp();
  const [form, setForm] = useState({ name: '', kind: 'api_key', scope: 'global', project_id: '', server_id: '', value: '', note: '' });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ccNewSecret')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <ActionButton
            className="btn btn-primary"
            onClick={async () => {
              if (!form.name.trim() || !form.value) return toast(t('ccRequired'), 'bad');
              try {
                await cc.addSecret({
                  ...form,
                  project_id: form.scope === 'project' && form.project_id ? Number(form.project_id) : null,
                  server_id: form.scope === 'server' && form.server_id ? Number(form.server_id) : null,
                });
                setForm({ ...form, name: '', value: '', note: '' });
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
      <Notice>{t('ccSecretHint')}</Notice>
      <Field label={t('name')}><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label={t('ccKind')}>
          <Select value={form.kind} onChange={(v) => setForm({ ...form, kind: v })} options={kinds.map((k) => ({ value: k, label: k }))} />
        </Field>
        <Field label={t('ccScope')}>
          <Select
            value={form.scope}
            onChange={(v) => setForm({ ...form, scope: v })}
            options={[
              { value: 'global', label: t('ccScopeGlobal') },
              { value: 'project', label: t('ccScopeProject') },
              { value: 'server', label: t('ccScopeServer') },
            ]}
          />
        </Field>
      </div>
      {form.scope === 'project' && (
        <Field label={t('ccProject')}>
          <Select value={form.project_id} onChange={(v) => setForm({ ...form, project_id: v })} options={projects.map((p) => ({ value: p.id, label: p.name }))} placeholder="—" />
        </Field>
      )}
      {form.scope === 'server' && (
        <Field label={t('ccServer')}>
          <Select value={form.server_id} onChange={(v) => setForm({ ...form, server_id: v })} options={servers.map((s) => ({ value: s.id, label: s.name }))} placeholder="—" />
        </Field>
      )}
      <Field label={t('ccSecretValue')}>
        <input dir="ltr" type="password" className="input font-mono text-xs" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
      </Field>
      <Field label={t('ccNote')}><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
    </Modal>
  );
}
