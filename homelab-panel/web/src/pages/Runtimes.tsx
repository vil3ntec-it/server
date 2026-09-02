// ---------------------------------------------------------------------------
//  نسخه‌های Node.js و Python
//
//  «نسخهٔ در حالِ اجرا» همیشه اول است و دکمهٔ حذف ندارد — همان نسخه‌ای که
//  خودِ پنل با آن می‌چرخد. اگر حذف‌شدنی بود، یک کلیک پنل را از بین می‌برد.
//
//  نصب چند ده مگابایت دانلود دارد و چند دقیقه طول می‌کشد؛ دکمه در همان مدت
//  «در حالِ نصب» می‌ماند تا کسی دو بار نزند.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Boxes, Download, Play, RefreshCw, Trash2 } from 'lucide-react';

import { api } from '../api';
import { useApp } from '../app-context';
import { Badge, Card, ConfirmDialog, Field, Loading, Modal, toast } from '../components/ui';
import { ActionButton, Cell, Notice, Row, Table } from '../control/ui';

type NodeRow = {
  version: string;
  binary: string;
  source: 'system' | 'path' | 'panel' | 'nvm' | 'fnm' | 'volta';
  removable: boolean;
  current: boolean;
};
type PyRow = { version: string; binary: string; command: string };

/**
 * از کجا آمده. «سیستم» یعنی همانی که پنل با آن اجرا می‌شود؛ بقیه ابزارهای
 * مدیریتِ نسخه‌اند که کاربر خودش نصب کرده و ما فقط پیدایشان کرده‌ایم.
 */
const SOURCE_LABEL: Record<string, string> = {
  system: 'سیستم',
  path: 'PATH',
  panel: 'پنل',
  nvm: 'nvm',
  fnm: 'fnm',
  volta: 'volta',
};

/** نسخه‌های پرکاربردِ LTS — تا کاربر مجبور نباشد شمارهٔ دقیق را حفظ باشد */
const SUGGESTED = ['v22.13.0', 'v20.18.1', 'v18.20.5'];

export default function RuntimesPage() {
  const { t, role } = useApp();
  const canManage = role === 'admin';

  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [pythons, setPythons] = useState<PyRow[]>([]);
  const [npm, setNpm] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [loading, setLoading] = useState(true);

  const [showInstall, setShowInstall] = useState(false);
  const [version, setVersion] = useState(SUGGESTED[0]);
  const [installing, setInstalling] = useState(false);
  const [confirm, setConfirm] = useState<NodeRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [n, p] = await Promise.all([
        api<{ items: NodeRow[]; npm: string | null; platformSupported: boolean }>('/api/runtimes/node'),
        api<{ items: PyRow[] }>('/api/runtimes/python').catch(() => ({ items: [] })),
      ]);
      setNodes(n.items ?? []);
      setNpm(n.npm);
      setSupported(n.platformSupported !== false);
      setPythons(p.items ?? []);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function install() {
    setInstalling(true);
    try {
      await api('/api/runtimes/node/install', { method: 'POST', body: { version } });
      toast(t('rtInstalled', { version }));
      setShowInstall(false);
      await load();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">
            <Boxes className="h-5 w-5" />
            {t('runtimes')}
          </h1>
          {npm && <p className="page-sub ltr">npm {npm}</p>}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t('refresh')}
          </button>
          {canManage && supported && (
            <button className="btn btn-sm btn-primary" onClick={() => setShowInstall(true)}>
              <Download className="h-3.5 w-3.5" />
              {t('rtInstall')}
            </button>
          )}
        </div>
      </div>

      {!supported && <Notice tone="warn">{t('rtUnsupported')}</Notice>}

      {loading ? (
        <Card><Loading /></Card>
      ) : (
        <>
          <Card title="Node.js" icon={<Play className="h-4 w-4" />}>
            <Table empty={!nodes.length} head={[t('rtVersion'), t('rtSource'), t('rtPath'), '']}>
              {nodes.map((row) => (
                <Row key={`${row.version}-${row.binary}`}>
                  <Cell>
                    <span className="ltr font-mono font-medium text-ink">{row.version}</span>
                    {row.current && <Badge tone="good">{t('rtCurrent')}</Badge>}
                  </Cell>
                  <Cell className="text-ink-soft">{SOURCE_LABEL[row.source] ?? row.source}</Cell>
                  <Cell className="ltr max-w-[22rem] font-mono text-[11px] text-ink-muted">
                    <span className="block truncate" title={row.binary}>{row.binary}</span>
                  </Cell>
                  <Cell className="text-end">
                    {canManage && row.removable && (
                      <ActionButton className="btn btn-sm btn-danger" onClick={() => setConfirm(row)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </ActionButton>
                    )}
                  </Cell>
                </Row>
              ))}
            </Table>
            <Notice tone="info">{t('rtNodeHint')}</Notice>
          </Card>

          <Card title="Python" icon={<Play className="h-4 w-4" />}>
            <Table empty={!pythons.length} head={[t('rtVersion'), t('rtPath')]}>
              {pythons.map((row) => (
                <Row key={row.binary}>
                  <Cell><span className="ltr font-mono">{row.version}</span></Cell>
                  <Cell className="ltr font-mono text-[11px] text-ink-muted">{row.binary}</Cell>
                </Row>
              ))}
            </Table>
            <Notice tone="info">{t('rtPythonHint')}</Notice>
          </Card>
        </>
      )}

      <Modal
        open={showInstall}
        onClose={() => !installing && setShowInstall(false)}
        title={t('rtInstall')}
        footer={
          <button className="btn btn-primary" disabled={installing} onClick={() => void install()}>
            {installing ? t('rtInstalling') : t('rtInstall')}
          </button>
        }
      >
        <Field label={t('rtVersion')} hint={t('rtVersionHint')}>
          <input className="input ltr" value={version} onChange={(e) => setVersion(e.target.value)} disabled={installing} />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED.map((v) => (
            <button key={v} className="btn btn-sm" disabled={installing} onClick={() => setVersion(v)}>
              {v}
            </button>
          ))}
        </div>
        {installing && <Notice tone="info">{t('rtInstallingHint')}</Notice>}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        danger
        title={t('rtRemoveTitle')}
        message={`${confirm?.version ?? ''} — ${t('rtRemoveBody')}`}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const row = confirm;
          setConfirm(null);
          if (!row) return;
          try {
            await api(`/api/runtimes/node/${row.version}`, { method: 'DELETE' });
            toast(t('rtRemoved'));
            await load();
          } catch (e) {
            toast((e as Error).message, 'bad');
          }
        }}
      />
    </div>
  );
}
