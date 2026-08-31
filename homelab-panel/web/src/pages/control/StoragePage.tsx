// ---------------------------------------------------------------------------
//  انبار — محلِ نگهداری، مصرفِ هر پروژه و بکاپ‌های همه
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, FolderTree, HardDrive } from 'lucide-react';
import { useApp } from '../../app-context';
import { Card, Field, Loading, toast } from '../../components/ui';
import { bytes, dateTime } from '../../format';
import { cc, type StorageOverview } from '../../control/api';
import type { Backup } from '../../control/types';
import { ActionButton, Cell, Notice, Row, Table, Tabs } from '../../control/ui';

export default function StoragePage() {
  const { t, lang } = useApp();
  const [tab, setTab] = useState('projects');
  const [data, setData] = useState<StorageOverview | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [root, setRoot] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [o, b] = await Promise.all([cc.storageOverview(), cc.backups()]);
      setData(o);
      setBackups(b.backups);
      setRoot(o.root);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !data) return <Loading />;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{t('ccStorage')}</h1>

      <Card title={t('ccStorageRoot')} icon={<HardDrive className="h-4 w-4" />}>
        {!data.chosen && <Notice tone="warn">{t('ccChooseStorage')}</Notice>}
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1">
            <Field label={t('path')} hint="D:\\Projects · /srv/ServerData">
              <input dir="ltr" className="input font-mono text-xs" value={root} onChange={(e) => setRoot(e.target.value)} />
            </Field>
          </div>
          <ActionButton
            className="btn btn-sm btn-primary"
            busyLabel="…"
            onClick={async () => {
              try {
                const res = await cc.setStorageRoot(root);
                toast(res.warning || res.root, res.warning ? 'bad' : 'good');
                load();
              } catch (e) {
                toast((e as Error).message, 'bad');
              }
            }}
          >
            {t('ccSave')}
          </ActionButton>
        </div>

        {data.disk.total ? (
          <div className="mt-3">
            <span className="block h-2 overflow-hidden rounded-full" style={{ background: 'var(--surface-2)' }}>
              <span
                className="block h-full rounded-full"
                style={{ width: `${data.disk.usage ?? 0}%`, background: (data.disk.usage ?? 0) > 90 ? 'var(--status-critical)' : 'var(--series-3)' }}
              />
            </span>
            <p className="mt-1.5 text-[11px] text-ink-muted">
              {t('used')}: <span className="tnum">{bytes(data.disk.used)}</span> · {t('ccDiskFree')}: <span className="tnum">{bytes(data.disk.free)}</span> / {bytes(data.disk.total)}
            </p>
          </div>
        ) : null}
      </Card>

      <Tabs
        tabs={[
          { id: 'projects', label: t('ccProjects'), badge: data.items.length },
          { id: 'backups', label: t('ccBackups'), badge: backups.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'projects' && (
        <Card title={t('ccProjects')} icon={<FolderTree className="h-4 w-4" />}>
          <Table head={[t('ccProject'), t('path'), t('size'), t('ccFiles'), t('ccBackups'), t('logs')]} empty={data.items.length === 0}>
            {data.items.map((item) => (
              <Row key={item.project_id}>
                <Cell>
                  <Link className="hover:underline" to={`/control/projects/${item.project_id}`}>{item.name}</Link>
                </Cell>
                <Cell mono>
                  <span dir="ltr" className="block max-w-64 truncate" title={item.dir}>{item.dir}</span>
                  {!item.exists && <span className="text-[10px]" style={{ color: 'var(--status-warning)' }}>{t('notConfigured')}</span>}
                </Cell>
                <Cell className="tnum">{bytes(item.bytes)}</Cell>
                <Cell className="tnum">{item.files}</Cell>
                <Cell className="tnum">{bytes(item.backupsBytes)}</Cell>
                <Cell className="tnum">{bytes(item.logsBytes)}</Cell>
              </Row>
            ))}
          </Table>
          <p className="mt-3 text-xs text-ink-muted">
            {t('total')}: <span className="tnum">{bytes(data.total)}</span>
          </p>
        </Card>
      )}

      {tab === 'backups' && (
        <Card title={t('ccBackups')} icon={<Archive className="h-4 w-4" />}>
          <Table head={[t('lastUpdate'), t('ccProject'), t('ccKind'), t('size'), t('status')]} empty={backups.length === 0}>
            {backups.map((b) => (
              <Row key={b.id}>
                <Cell className="text-xs">{dateTime(b.created_at, lang)}</Cell>
                <Cell>
                  <Link className="hover:underline" to={`/control/projects/${b.project_public_id}`}>{b.project_name}</Link>
                </Cell>
                <Cell><span className="chip" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>{b.kind}</span></Cell>
                <Cell className="tnum">{bytes(b.size)}</Cell>
                <Cell style={{ color: b.status === 'ok' ? 'var(--status-good)' : 'var(--status-critical)' }}>{b.status}</Cell>
              </Row>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
