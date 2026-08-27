// ---------------------------------------------------------------------------
//  زبانهٔ جابه‌جایی — بردنِ پروژه از سرور خانگی به VPS و برعکس
//  بکاپ ← انتقال ← تنظیم آدرس‌ها ← پیکربندی تازه ← Health Check واقعی
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, ShieldCheck } from 'lucide-react';
import { useApp } from '../../../app-context';
import { Card, Field, Modal, toast } from '../../../components/ui';
import { dateTime } from '../../../format';
import { cc, type Migration, type MigrationPlan, type ProjectBundle } from '../../../control/api';
import type { Server } from '../../../control/types';
import { ActionButton, Cell, KV, Notice, Row, Select, Table } from '../../../control/ui';

export default function MigrateTab({ bundle, servers, reload }: { bundle: ProjectBundle; servers: Server[]; reload: () => void }) {
  const { t, lang } = useApp();
  const id = bundle.project.project_id;
  const [target, setTarget] = useState('');
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [history, setHistory] = useState<Migration[]>([]);
  const [ssh, setSsh] = useState({ host: '', user: 'root', port: '22', targetDir: '' });
  const [useSsh, setUseSsh] = useState(false);

  const load = useCallback(async () => {
    try {
      setHistory((await cc.migrations(id)).migrations);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const options = servers.filter((s) => s.id !== bundle.project.server_id).map((s) => ({ value: s.id, label: `${s.name} — ${s.kind}` }));

  return (
    <div className="space-y-4">
      <Card title={t('ccMigrate')} icon={<ArrowLeftRight className="h-4 w-4" />}>
        <Notice tone="warn">{t('ccMigrateWarn')}</Notice>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <Field label={t('ccServer')}>
              <Select value={target} onChange={setTarget} options={options} placeholder="—" />
            </Field>
          </div>
          <ActionButton
            className="btn btn-sm"
            disabled={!target}
            busyLabel="…"
            onClick={async () => {
              try {
                setPlan(await cc.migrationPlan(id, Number(target)));
              } catch (e) {
                toast((e as Error).message, 'bad');
              }
            }}
          >
            {t('ccMigrationPlan')}
          </ActionButton>
        </div>
      </Card>

      {history.length > 0 && (
        <Card title={t('ccMigrations')}>
          <Table head={[t('lastUpdate'), t('ccServer'), t('status'), t('ccDetails')]} empty={false}>
            {history.map((m) => (
              <Row key={m.id}>
                <Cell className="text-xs">{dateTime(m.started_at, lang)}</Cell>
                <Cell className="text-xs">
                  {m.from_name || '—'} → {m.to_name || '—'}
                </Cell>
                <Cell>
                  <span className="chip" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>{m.status}</span>
                </Cell>
                <Cell>
                  <div className="flex flex-wrap gap-1">
                    {m.steps.map((s, i) => (
                      <span
                        key={i}
                        className="chip"
                        title={typeof s.detail === 'string' ? s.detail : JSON.stringify(s.detail)}
                        style={{
                          background: `color-mix(in srgb, ${s.status === 'ok' ? 'var(--status-good)' : s.status === 'error' ? 'var(--status-critical)' : 'var(--status-warning)'} 15%, transparent)`,
                          color: s.status === 'ok' ? 'var(--status-good)' : s.status === 'error' ? 'var(--status-critical)' : 'var(--status-warning)',
                        }}
                      >
                        {s.name}
                      </span>
                    ))}
                  </div>
                </Cell>
              </Row>
            ))}
          </Table>
        </Card>
      )}

      <Modal
        open={Boolean(plan)}
        onClose={() => setPlan(null)}
        title={t('ccMigrationPlan')}
        wide
        footer={
          <>
            <button className="btn" onClick={() => setPlan(null)}>{t('cancel')}</button>
            <ActionButton
              className="btn btn-danger"
              busyLabel="…"
              onClick={async () => {
                try {
                  const res = await cc.migrate(id, Number(target), useSsh ? { ...ssh, port: Number(ssh.port) } : null);
                  toast(`${res.status} · ${res.backup.filename}`);
                  setPlan(null);
                  load();
                  reload();
                } catch (e) {
                  toast((e as Error).message, 'bad');
                }
              }}
            >
              {t('ccMigrate')}
            </ActionButton>
          </>
        }
      >
        {plan && (
          <>
            <div className="mb-3 rounded-xl border border-line p-3">
              <KV label={t('ccServer')}>
                {plan.from?.name || '—'} → <b>{plan.to.name}</b>
              </KV>
              <KV label={t('ccBackups')}>
                <ShieldCheck className="inline h-3.5 w-3.5" style={{ color: 'var(--status-good)' }} />
              </KV>
            </div>

            <p className="mb-1.5 text-xs font-medium text-ink-soft">{t('ccEndpoints')}</p>
            <ul className="mb-3 space-y-1">
              {plan.endpoints.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[11px]">
                  <span className="chip" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>{e.environment}</span>
                  <span dir="ltr" className="font-mono">{e.current}</span>
                  {e.willChange ? (
                    <span dir="ltr" className="font-mono" style={{ color: 'var(--status-warning)' }}>→ {e.next}</span>
                  ) : (
                    <span className="text-ink-muted">({t('ccNever')})</span>
                  )}
                </li>
              ))}
            </ul>

            {plan.stableUrls.length > 0 && (
              <>
                <p className="mb-1.5 text-xs font-medium text-ink-soft">{t('ccRouting')}</p>
                <ul className="mb-3 space-y-1">
                  {plan.stableUrls.map((u) => (
                    <li key={u} dir="ltr" className="rounded-lg border border-line px-2.5 py-1.5 font-mono text-[11px]">{u}</li>
                  ))}
                </ul>
              </>
            )}

            <label className="mb-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={useSsh} onChange={(e) => setUseSsh(e.target.checked)} />
              SSH / scp
            </label>
            {useSsh && (
              <div className="grid gap-x-3 sm:grid-cols-2">
                <Field label={t('ccHost')}>
                  <input dir="ltr" className="input" value={ssh.host} onChange={(e) => setSsh({ ...ssh, host: e.target.value })} placeholder={plan.to.ip || plan.to.hostname || ''} />
                </Field>
                <Field label={t('username')}>
                  <input dir="ltr" className="input" value={ssh.user} onChange={(e) => setSsh({ ...ssh, user: e.target.value })} />
                </Field>
                <Field label={t('ccSshPort')}>
                  <input dir="ltr" className="input tnum" value={ssh.port} onChange={(e) => setSsh({ ...ssh, port: e.target.value })} />
                </Field>
                <Field label={t('path')}>
                  <input dir="ltr" className="input font-mono text-xs" value={ssh.targetDir} onChange={(e) => setSsh({ ...ssh, targetDir: e.target.value })} placeholder="/opt/control-center/incoming" />
                </Field>
              </div>
            )}
            {!useSsh && <Notice>{plan.transfer.note}</Notice>}
          </>
        )}
      </Modal>
    </div>
  );
}
