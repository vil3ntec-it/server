// ---------------------------------------------------------------------------
//  زبانهٔ پیکربندیِ مرکزی — چیزی که خودِ برنامه‌ها می‌خوانند
//  نسخه‌دار، با ردِ پا و قابلِ بازگشت.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, RotateCcw, Settings2, Trash2 } from 'lucide-react';
import { useApp } from '../../../app-context';
import { Card, Field, Loading, Modal, toast } from '../../../components/ui';
import { dateTime } from '../../../format';
import { cc, type ConfigResponse, type ProjectBundle } from '../../../control/api';
import { ActionButton, Cell, KV, Notice, Row, Select, Table } from '../../../control/ui';

export default function ConfigTab({ bundle, reload }: { bundle: ProjectBundle; reload: () => void }) {
  const { t, lang } = useApp();
  const id = bundle.project.project_id;
  const [environment, setEnvironment] = useState('production');
  const [data, setData] = useState<ConfigResponse | null>(null);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<{ key: string; value: string }[]>([]);
  const [tokenInfo, setTokenInfo] = useState<{ token: string; example: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await cc.config(id, environment));
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }, [id, environment]);

  useEffect(() => {
    load();
  }, [load]);

  function startEdit() {
    const current = data?.active?.data || {};
    const list = Object.entries(current).map(([key, value]) => ({ key, value: String(value ?? '') }));
    setRows(list.length ? list : [{ key: 'API_BASE_URL', value: '' }]);
    setEditing(true);
  }

  if (!data) return <Loading />;

  return (
    <div className="space-y-4">
      <Card
        title={t('ccConfig')}
        icon={<Settings2 className="h-4 w-4" />}
        action={
          <div className="flex gap-2">
            <Select value={environment} onChange={setEnvironment} options={data.environments.map((e) => ({ value: e, label: e }))} />
            <button className="btn btn-sm btn-primary shrink-0" onClick={startEdit}>
              <Plus className="h-4 w-4" />
              {t('ccNewConfig')}
            </button>
          </div>
        }
      >
        <Notice>{t('ccConfigNoSecrets')}</Notice>

        <p className="mb-2 text-xs font-medium text-ink-soft">{t('ccResolved')}</p>
        <div className="mb-4 rounded-xl border border-line p-3">
          {Object.entries(data.resolved.config).map(([key, value]) => (
            <KV key={key} label={key} mono>
              <span dir="ltr">{String(value)}</span>
            </KV>
          ))}
        </div>

        <p className="mb-2 text-xs font-medium text-ink-soft">{t('ccActiveVersion')}</p>
        <Table head={[t('ccVersion'), t('ccEnvironment'), t('ccCreatedAt'), t('ccNote'), '']} empty={data.versions.length === 0}>
          {data.versions.map((v) => (
            <Row key={v.id}>
              <Cell className="tnum font-semibold">
                v{v.version}
                {v.active ? (
                  <span className="ms-1.5 chip" style={{ background: 'color-mix(in srgb, var(--status-good) 15%, transparent)', color: 'var(--status-good)' }}>
                    {t('stActive')}
                  </span>
                ) : null}
              </Cell>
              <Cell>{v.environment}</Cell>
              <Cell className="text-xs">{dateTime(v.created_at, lang)}</Cell>
              <Cell className="text-[11px] text-ink-muted">{v.note || v.created_by || '—'}</Cell>
              <Cell>
                <div className="flex justify-end">
                  {!v.active && (
                    <ActionButton
                      title={t('ccRollback')}
                      onClick={async () => {
                        await cc.activateConfig(id, v.id);
                        toast(t('ccActivate'));
                        load();
                        reload();
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </ActionButton>
                  )}
                </div>
              </Cell>
            </Row>
          ))}
        </Table>
      </Card>

      <Card title={t('ccAppToken')} icon={<KeyRound className="h-4 w-4" />}>
        <p className="mb-3 text-xs leading-relaxed text-ink-soft">
          {data.hasToken ? t('ccTokenHidden') : t('ccIssueAppToken')}
        </p>
        <ActionButton
          className="btn btn-sm"
          onClick={async () => {
            try {
              setTokenInfo(await cc.issueConfigToken(id));
              load();
            } catch (e) {
              toast((e as Error).message, 'bad');
            }
          }}
        >
          {t('ccIssueAppToken')}
        </ActionButton>
      </Card>

      {/* ویرایشگرِ نسخهٔ تازه */}
      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title={`${t('ccNewConfig')} — ${environment}`}
        wide
        footer={
          <>
            <button className="btn" onClick={() => setEditing(false)}>{t('cancel')}</button>
            <ActionButton
              className="btn btn-primary"
              onClick={async () => {
                const payload: Record<string, string> = {};
                for (const row of rows) {
                  if (!row.key.trim()) continue;
                  payload[row.key.trim()] = row.value;
                }
                try {
                  const res = await cc.saveConfig(id, { environment, data: payload, activate: true });
                  if (res.rejected.length) {
                    toast(res.rejected.map((r) => `${r.key}: ${r.reason}`).join(' · '), 'bad');
                  } else {
                    toast(`v${res.version}`);
                  }
                  setEditing(false);
                  load();
                  reload();
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
        <ul className="space-y-2">
          {rows.map((row, i) => (
            <li key={i} className="flex gap-2">
              <input
                dir="ltr"
                className="input font-mono text-xs"
                placeholder="API_BASE_URL"
                value={row.key}
                onChange={(e) => setRows(rows.map((r, j) => (i === j ? { ...r, key: e.target.value } : r)))}
              />
              <input
                dir="ltr"
                className="input font-mono text-xs"
                placeholder="https://api.example.com/api"
                value={row.value}
                onChange={(e) => setRows(rows.map((r, j) => (i === j ? { ...r, value: e.target.value } : r)))}
              />
              <button className="btn btn-sm shrink-0" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <button className="btn btn-sm mt-3" onClick={() => setRows([...rows, { key: '', value: '' }])}>
          <Plus className="h-4 w-4" />
          {t('add')}
        </button>
      </Modal>

      {/* توکن — فقط همین یک‌بار */}
      <Modal open={Boolean(tokenInfo)} onClose={() => setTokenInfo(null)} title={t('ccAppToken')} wide>
        <Notice tone="warn">{t('ccKeyOnce')}</Notice>
        <Field label={t('ccAppToken')}>
          <input dir="ltr" readOnly className="input font-mono text-xs" value={tokenInfo?.token || ''} onFocus={(e) => e.currentTarget.select()} />
        </Field>
        <Field label={t('ccAgentHowTo')}>
          <textarea dir="ltr" readOnly rows={3} className="input font-mono text-[11px]" value={tokenInfo?.example || ''} />
        </Field>
      </Modal>
    </div>
  );
}
