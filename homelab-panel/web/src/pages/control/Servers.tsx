// ---------------------------------------------------------------------------
//  سرورها — خانگی، VPS، اختصاصی، ابری. با Agent، گزارشِ واقعی هم می‌آید.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Cpu, HardDrive, MemoryStick, Plus, Radio, Server as ServerIcon, Trash2 } from 'lucide-react';
import { useApp } from '../../app-context';
import { Card, Empty, Field, Loading, Modal, toast } from '../../components/ui';
import { bytes, duration, relative } from '../../format';
import { cc, type AgentInfo, type AgentKeyResponse } from '../../control/api';
import type { Server } from '../../control/types';
import { ActionButton, KV, Notice, Select, StatusPill, useLabels } from '../../control/ui';

export default function Servers() {
  const { t, lang } = useApp();
  const labels = useLabels();
  const [servers, setServers] = useState<Server[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState<{ server: Server; info: AgentInfo } | null>(null);
  const [issued, setIssued] = useState<AgentKeyResponse | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await cc.servers();
      setServers(res.servers);
      setKinds(res.kinds);
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
        <h1 className="text-lg font-semibold">{t('ccServers')}</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          {t('ccNewServer')}
        </button>
      </header>

      {servers.length === 0 ? (
        <Card><Empty icon={<ServerIcon className="h-8 w-8" />} title={t('ccNoItems')} /></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {servers.map((s) => {
            const report = s.agent_report;
            return (
              <Card
                key={s.server_id}
                title={
                  <span className="flex items-center gap-2">
                    {s.name}
                    {s.is_local ? <span className="chip" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>{t('kindHome')}</span> : null}
                  </span>
                }
                icon={<ServerIcon className="h-4 w-4" />}
                action={<StatusPill status={s.status} />}
              >
                <KV label={t('ccKind')}>{labels.serverKind(s.kind)}</KV>
                <KV label={t('internalIp')} mono>{s.ip || '—'}</KV>
                <KV label={t('ccHost')} mono>{s.hostname || '—'}</KV>
                <KV label="OS">{s.os || '—'}</KV>
                {s.provider && <KV label={t('ccProvider')}>{s.provider}</KV>}
                <KV label={t('ccProjects')}>{s.projects ?? 0}</KV>
                <KV label={t('ccLastReport')}>{s.agent_seen ? relative(s.agent_seen, lang) : t('ccNoAgent')}</KV>

                {report && (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Metric icon={<Cpu className="h-3.5 w-3.5" />} label={t('cpu')} value={report.cpu?.usage != null ? `${report.cpu.usage}%` : '—'} danger={(report.cpu?.usage ?? 0) > 90} />
                    <Metric icon={<MemoryStick className="h-3.5 w-3.5" />} label={t('ram')} value={report.memory?.usage != null ? `${report.memory.usage}%` : '—'} danger={(report.memory?.usage ?? 0) > 90} />
                    <Metric
                      icon={<HardDrive className="h-3.5 w-3.5" />}
                      label={t('disk')}
                      value={report.storage?.[0] ? `${report.storage[0].usage}%` : '—'}
                      danger={(report.storage?.[0]?.usage ?? 0) > 90}
                    />
                  </div>
                )}
                {report?.uptime != null && (
                  <p className="mt-2 text-[11px] text-ink-muted">
                    {t('uptime')}: {duration(report.uptime, t)}
                  </p>
                )}
                {report?.services?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {report.services.map((svc) => (
                      <span key={`${svc.name}:${svc.port}`} className="chip" style={{ background: `color-mix(in srgb, ${svc.status === 'online' ? 'var(--status-good)' : 'var(--status-critical)'} 14%, transparent)`, color: svc.status === 'online' ? 'var(--status-good)' : 'var(--status-critical)' }}>
                        {svc.name}:{svc.port}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                  <ActionButton
                    busyLabel={t('ccTesting')}
                    onClick={async () => {
                      const res = await cc.testServer(s.server_id);
                      toast(`${res.host}:${res.port} · ${res.result.status}`, res.result.status === 'online' ? 'good' : 'bad');
                      load();
                    }}
                  >
                    <Radio className="h-3.5 w-3.5" />
                    {t('ccTest')}
                  </ActionButton>
                  <ActionButton
                    onClick={async () => {
                      const info = await cc.agentInfo(s.server_id);
                      setAgent({ server: s, info });
                    }}
                  >
                    {t('ccAgent')}
                  </ActionButton>
                  {!s.is_local && (
                    <ActionButton
                      className="btn btn-sm btn-danger"
                      onClick={async () => {
                        try {
                          await cc.deleteServer(s.server_id);
                          load();
                        } catch (e) {
                          toast((e as Error).message, 'bad');
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </ActionButton>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <NewServer open={open} onClose={() => setOpen(false)} kinds={kinds} onSaved={() => { setOpen(false); load(); }} />

      {/* Agent */}
      <Modal open={Boolean(agent)} onClose={() => setAgent(null)} title={`${t('ccAgent')} — ${agent?.server.name || ''}`} wide>
        {agent && (
          <>
            <KV label={t('ccAgentKey')}>{agent.info.hasKey ? '••••••••' : t('notConfigured')}</KV>
            <KV label={t('ccLastReport')}>{agent.info.lastSeen ? relative(agent.info.lastSeen, lang) : t('ccNever')}</KV>

            <div className="my-3 flex gap-2">
              <ActionButton
                className="btn btn-sm btn-primary"
                onClick={async () => {
                  const res = await cc.issueAgentKey(agent.server.server_id, window.location.origin);
                  setIssued(res);
                  setAgent({ ...agent, info: { ...agent.info, hasKey: true, instructions: res.instructions } });
                  load();
                }}
              >
                {t('ccIssueKey')}
              </ActionButton>
              {agent.info.hasKey && (
                <ActionButton
                  className="btn btn-sm"
                  onClick={async () => {
                    await cc.revokeAgentKey(agent.server.server_id);
                    setAgent({ ...agent, info: { ...agent.info, hasKey: false } });
                    load();
                  }}
                >
                  {t('ccDelete')}
                </ActionButton>
              )}
            </div>

            <p className="mb-1.5 text-xs font-medium text-ink-soft">{t('ccAgentHowTo')} — Linux</p>
            <textarea dir="ltr" readOnly rows={4} className="input mb-3 font-mono text-[11px]" value={agent.info.instructions.linux} />
            <p className="mb-1.5 text-xs font-medium text-ink-soft">{t('ccAgentHowTo')} — Windows</p>
            <textarea dir="ltr" readOnly rows={4} className="input font-mono text-[11px]" value={agent.info.instructions.windows} />

            {agent.info.report && (
              <>
                <p className="mb-1.5 mt-4 text-xs font-medium text-ink-soft">{t('ccLastReport')}</p>
                <div className="rounded-xl border border-line p-3">
                  <KV label="OS">{agent.info.report.os?.hostname} — {agent.info.report.os?.type} {agent.info.report.os?.release}</KV>
                  <KV label={t('cpu')}>{agent.info.report.cpu?.usage != null ? `${agent.info.report.cpu.usage}%` : '—'} · {agent.info.report.cpu?.cores} {t('cores')}</KV>
                  <KV label={t('ram')}>{bytes(agent.info.report.memory?.used)} / {bytes(agent.info.report.memory?.total)}</KV>
                  {agent.info.report.runtimes?.node && <KV label="Node.js">{agent.info.report.runtimes.node}</KV>}
                  {agent.info.report.runtimes?.postgres && <KV label="PostgreSQL">{agent.info.report.runtimes.postgres}</KV>}
                </div>
              </>
            )}
          </>
        )}
      </Modal>

      {/* کلید — فقط همین یک‌بار */}
      <Modal open={Boolean(issued)} onClose={() => setIssued(null)} title={t('ccAgentKey')} wide>
        <Notice tone="warn">{t('ccKeyOnce')}</Notice>
        <input dir="ltr" readOnly className="input mb-3 font-mono text-xs" value={issued?.key || ''} onFocus={(e) => e.currentTarget.select()} />
        <textarea dir="ltr" readOnly rows={5} className="input font-mono text-[11px]" value={issued?.instructions.linux || ''} />
      </Modal>
    </div>
  );
}

function Metric({ icon, label, value, danger }: { icon: React.ReactNode; label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-line p-2 text-center">
      <span className="flex items-center justify-center gap-1 text-[10px] text-ink-muted">
        {icon}
        {label}
      </span>
      <p className="tnum text-sm font-semibold" style={danger ? { color: 'var(--status-critical)' } : undefined}>{value}</p>
    </div>
  );
}

function NewServer({ open, onClose, kinds, onSaved }: { open: boolean; onClose: () => void; kinds: string[]; onSaved: () => void }) {
  const { t } = useApp();
  const labels = useLabels();
  const [form, setForm] = useState({ name: '', kind: 'vps', ip: '', hostname: '', ssh_port: '22', os: '', provider: '', location: '', note: '' });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ccNewServer')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <ActionButton
            className="btn btn-primary"
            onClick={async () => {
              if (!form.name.trim()) return toast(t('ccRequired'), 'bad');
              try {
                await cc.createServer({ ...form, ssh_port: form.ssh_port ? Number(form.ssh_port) : null });
                setForm({ name: '', kind: 'vps', ip: '', hostname: '', ssh_port: '22', os: '', provider: '', location: '', note: '' });
                onSaved();
              } catch (e) {
                toast((e as Error).message, 'bad');
              }
            }}
          >
            {t('ccCreate')}
          </ActionButton>
        </>
      }
    >
      <Field label={t('name')}><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
      <Field label={t('ccKind')}>
        <Select value={form.kind} onChange={(v) => setForm({ ...form, kind: v })} options={kinds.map((k) => ({ value: k, label: labels.serverKind(k) }))} />
      </Field>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label={t('internalIp')}><input dir="ltr" className="input font-mono" value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} /></Field>
        <Field label={t('ccHost')}><input dir="ltr" className="input" value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} /></Field>
        <Field label={t('ccSshPort')}><input dir="ltr" className="input tnum" value={form.ssh_port} onChange={(e) => setForm({ ...form, ssh_port: e.target.value })} /></Field>
        <Field label="OS"><input className="input" value={form.os} onChange={(e) => setForm({ ...form, os: e.target.value })} /></Field>
        <Field label={t('ccProvider')}><input className="input" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} /></Field>
        <Field label={t('ccLocation')}><input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
      </div>
      <Field label={t('ccNote')}><textarea className="input" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
    </Modal>
  );
}
