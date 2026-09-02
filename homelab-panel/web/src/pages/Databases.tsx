// ---------------------------------------------------------------------------
//  مدیریتِ دیتابیس
//
//  اگر کلاینتِ موتور روی ماشین نباشد، به‌جای یک جدولِ خالی، همان را می‌گوید و
//  دستورِ نصبش را می‌دهد. «فهرستِ خالی» و «ابزار نصب نیست» دو چیزِ کاملاً
//  متفاوت‌اند و اشتباه گرفتنشان نیم‌ساعت وقتِ آدم را می‌برد.
//
//  رمزِ ساخته‌شده یک بار و همان‌جا نشان داده می‌شود، چون سرور هم دیگر آن را
//  برنمی‌گرداند — نه از روی سخت‌گیری، بلکه چون واقعاً ذخیره‌اش نمی‌کند.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Database, KeyRound, Plus, RefreshCw, Save, Trash2, Users } from 'lucide-react';

import { api } from '../api';
import { useApp } from '../app-context';
import { Badge, Card, ConfirmDialog, Empty, Field, Loading, Modal, toast } from '../components/ui';
import { ActionButton, Cell, Notice, Row, Table, Tabs } from '../control/ui';

type Engine = 'mysql' | 'postgres';

type ClientInfo = { installed: boolean; version: string | null };
type EngineConfig = { host: string; port: number; user: string; enabled: boolean; passwordSet?: boolean };
type DbRow = { name: string; bytes: number; tables: number | null; system: boolean };
type UserRow = { name: string; host: string | null; superuser: boolean | null };

const ENGINE_LABEL: Record<Engine, string> = { mysql: 'MySQL / MariaDB', postgres: 'PostgreSQL' };
const INSTALL_HINT: Record<Engine, string> = {
  mysql: 'sudo apt install mariadb-server mariadb-client',
  postgres: 'sudo apt install postgresql postgresql-client',
};

function bytes(n: number) {
  if (!n) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function DatabasesPage() {
  const { t, role } = useApp();
  const canWrite = role === 'operator' || role === 'admin';
  const canDelete = role === 'admin';

  const [engine, setEngine] = useState<Engine>('mysql');
  const [clients, setClients] = useState<Record<Engine, ClientInfo> | null>(null);
  const [config, setConfig] = useState<Record<Engine, EngineConfig> | null>(null);
  const [databases, setDatabases] = useState<DbRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [connError, setConnError] = useState<string | null>(null);

  const [showConfig, setShowConfig] = useState(false);
  const [showNewDb, setShowNewDb] = useState(false);
  const [showNewUser, setShowNewUser] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => Promise<void> } | null>(null);

  const [form, setForm] = useState({ host: '', port: '', user: '', password: '' });
  const [newDb, setNewDb] = useState('');
  const [newUser, setNewUser] = useState({ name: '', password: '', database: '' });

  const loadMeta = useCallback(async () => {
    try {
      const [c, cfg] = await Promise.all([
        api<{ mysql: ClientInfo; postgres: ClientInfo }>('/api/databases/clients'),
        api<{ config: Record<Engine, EngineConfig> }>('/api/databases/config'),
      ]);
      setClients({ mysql: c.mysql, postgres: c.postgres });
      setConfig(cfg.config);
    } catch (e) {
      setConnError((e as Error).message);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setConnError(null);
    try {
      const [db, us] = await Promise.all([
        api<{ items: DbRow[] }>(`/api/databases/${engine}/databases`),
        api<{ items: UserRow[] }>(`/api/databases/${engine}/users`).catch(() => ({ items: [] })),
      ]);
      setDatabases(db.items ?? []);
      setUsers(us.items ?? []);
    } catch (e) {
      setDatabases([]);
      setUsers([]);
      setConnError((e as Error).message || t('dbConnectFailed'));
    } finally {
      setLoading(false);
    }
  }, [engine, t]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (clients?.[engine]?.installed) void loadData();
    else setLoading(false);
  }, [clients, engine, loadData]);

  useEffect(() => {
    if (!config) return;
    const c = config[engine];
    setForm({ host: c.host, port: String(c.port), user: c.user, password: '' });
  }, [config, engine]);

  /* ------------------------------ کارها ------------------------------- */

  async function saveConfig() {
    try {
      const res = await api<{ config: Record<Engine, EngineConfig> }>(`/api/databases/config/${engine}`, {
        method: 'PUT',
        body: {
          host: form.host,
          port: Number(form.port),
          user: form.user,
          // رشتهٔ خالی یعنی «دست نزن»، نه «پاک کن»
          ...(form.password ? { password: form.password } : {}),
          enabled: true,
        },
      });
      setConfig(res.config);
      setShowConfig(false);
      toast(t('saved'));
      await loadData();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  async function testConnection() {
    try {
      const res = await api<{ version: string }>(`/api/databases/${engine}/test`, { method: 'POST' });
      toast(res.version ? res.version.slice(0, 60) : t('dbConnected'));
    } catch (e) {
      toast((e as Error).message || t('dbConnectFailed'), 'bad');
    }
  }

  async function createDb() {
    try {
      await api(`/api/databases/${engine}/databases`, { method: 'POST', body: { name: newDb.trim() } });
      toast(t('dbCreated'));
      setShowNewDb(false);
      setNewDb('');
      await loadData();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  async function createUser() {
    try {
      await api(`/api/databases/${engine}/users`, {
        method: 'POST',
        body: {
          name: newUser.name.trim(),
          password: newUser.password,
          database: newUser.database || null,
        },
      });
      toast(t('dbUserCreated'));
      setShowNewUser(false);
      setNewUser({ name: '', password: '', database: '' });
      await loadData();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  async function dumpDb(name: string) {
    try {
      const res = await api<{ bytes: number }>(`/api/databases/${engine}/databases/${name}/dump`, { method: 'POST' });
      toast(t('dbDumped', { size: bytes(res.bytes) }));
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }

  /* ------------------------------ نمایش ------------------------------- */

  const client = clients?.[engine];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">
            <Database className="h-5 w-5" />
            {t('databases')}
          </h1>
          {client?.version && <p className="page-sub ltr">{client.version}</p>}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={() => void loadData()}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t('refresh')}
          </button>
          {canDelete && (
            <button className="btn btn-sm" onClick={() => setShowConfig(true)}>
              <KeyRound className="h-3.5 w-3.5" />
              {t('dbConnection')}
            </button>
          )}
        </div>
      </div>

      <Tabs
        active={engine}
        onChange={(id) => setEngine(id as Engine)}
        tabs={[
          { id: 'mysql', label: ENGINE_LABEL.mysql },
          { id: 'postgres', label: ENGINE_LABEL.postgres },
        ]}
      />

      {!client?.installed ? (
        <Card>
          <Empty
            icon={<Database className="h-8 w-8" />}
            title={t('dbNotInstalled', { engine: ENGINE_LABEL[engine] })}
            hint={t('dbNotInstalledHint')}
          />
          <pre className="ltr mt-2 overflow-x-auto rounded-lg bg-surface-raised p-3 font-mono text-xs text-ink-soft">
            {INSTALL_HINT[engine]}
          </pre>
        </Card>
      ) : connError ? (
        <Card>
          <Notice tone="bad">{connError}</Notice>
          <p className="mt-3 text-sm text-ink-soft">{t('dbCheckConnection')}</p>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-sm btn-primary" onClick={() => setShowConfig(true)}>
              {t('dbConnection')}
            </button>
            <button className="btn btn-sm" onClick={() => void testConnection()}>
              {t('dbTest')}
            </button>
          </div>
        </Card>
      ) : loading ? (
        <Card><Loading /></Card>
      ) : (
        <>
          <Card
            title={t('databases')}
            icon={<Database className="h-4 w-4" />}
            action={
              canWrite && (
                <button className="btn btn-sm btn-primary" onClick={() => setShowNewDb(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  {t('dbNew')}
                </button>
              )
            }
          >
            <Table empty={!databases.length} head={[t('dbName'), t('dbSize'), t('dbTables'), '']}>
              {databases.map((row) => (
                <Row key={row.name}>
                  <Cell>
                    <span className="ltr font-mono text-ink">{row.name}</span>
                    {row.system && <Badge tone="neutral">{t('dbSystem')}</Badge>}
                  </Cell>
                  <Cell mono className="tnum text-ink-soft">{bytes(row.bytes)}</Cell>
                  <Cell mono className="tnum text-ink-soft">{row.tables ?? '—'}</Cell>
                  <Cell className="text-end">
                    {!row.system && (
                      <div className="flex justify-end gap-1">
                        {canWrite && (
                          <ActionButton className="btn btn-sm" busyLabel="…" onClick={() => dumpDb(row.name)}>
                            <Save className="h-3.5 w-3.5" />
                            {t('dbBackup')}
                          </ActionButton>
                        )}
                        {canDelete && (
                          <ActionButton
                            className="btn btn-sm btn-danger"
                            onClick={() =>
                              setConfirm({
                                title: t('dbDropTitle'),
                                message: `${row.name} — ${t('dbDropBody')}`,
                                run: async () => {
                                  try {
                                    await api(`/api/databases/${engine}/databases/${row.name}`, { method: 'DELETE' });
                                    toast(t('dbDropped'));
                                    await loadData();
                                  } catch (e) {
                                    toast((e as Error).message, 'bad');
                                  }
                                },
                              })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </ActionButton>
                        )}
                      </div>
                    )}
                  </Cell>
                </Row>
              ))}
            </Table>
          </Card>

          <Card
            title={t('dbUsers')}
            icon={<Users className="h-4 w-4" />}
            action={
              canWrite && (
                <button className="btn btn-sm" onClick={() => setShowNewUser(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  {t('dbNewUser')}
                </button>
              )
            }
          >
            <Table empty={!users.length} head={[t('dbUser'), engine === 'mysql' ? t('dbHost') : t('dbSuperuser'), '']}>
              {users.map((row) => (
                <Row key={`${row.name}@${row.host ?? ''}`}>
                  <Cell><span className="ltr font-mono">{row.name}</span></Cell>
                  <Cell className="text-ink-soft">
                    {engine === 'mysql' ? row.host : row.superuser ? <Badge tone="warn">{t('dbSuperuser')}</Badge> : '—'}
                  </Cell>
                  <Cell className="text-end">
                    {canDelete && (
                      <ActionButton
                        className="btn btn-sm btn-danger"
                        onClick={() =>
                          setConfirm({
                            title: t('dbDropUserTitle'),
                            message: `${row.name} — ${t('dbDropBody')}`,
                            run: async () => {
                              try {
                                await api(`/api/databases/${engine}/users/${row.name}`, { method: 'DELETE' });
                                toast(t('dbDropped'));
                                await loadData();
                              } catch (e) {
                                toast((e as Error).message, 'bad');
                              }
                            },
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </ActionButton>
                    )}
                  </Cell>
                </Row>
              ))}
            </Table>
          </Card>
        </>
      )}

      {/* ---------------------------- پنجره‌ها ---------------------------- */}

      <Modal
        open={showConfig}
        onClose={() => setShowConfig(false)}
        title={`${t('dbConnection')} — ${ENGINE_LABEL[engine]}`}
        footer={
          <>
            <button className="btn" onClick={() => void testConnection()}>{t('dbTest')}</button>
            <button className="btn btn-primary" onClick={() => void saveConfig()}>{t('save')}</button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('dbHost')}>
            <input className="input ltr" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
          </Field>
          <Field label={t('dbPort')}>
            <input className="input ltr" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
          </Field>
          <Field label={t('dbUser')}>
            <input className="input ltr" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} />
          </Field>
          <Field label={t('dbPassword')} hint={config?.[engine]?.passwordSet ? t('dbPasswordSet') : undefined}>
            <input
              className="input ltr"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={config?.[engine]?.passwordSet ? '••••••••' : ''}
            />
          </Field>
        </div>
        <Notice tone="info">{t('dbPasswordVault')}</Notice>
      </Modal>

      <Modal
        open={showNewDb}
        onClose={() => setShowNewDb(false)}
        title={t('dbNew')}
        footer={<button className="btn btn-primary" onClick={() => void createDb()}>{t('add')}</button>}
      >
        <Field label={t('dbName')} hint={t('dbNameHint')}>
          <input className="input ltr" value={newDb} onChange={(e) => setNewDb(e.target.value)} autoFocus />
        </Field>
      </Modal>

      <Modal
        open={showNewUser}
        onClose={() => setShowNewUser(false)}
        title={t('dbNewUser')}
        footer={<button className="btn btn-primary" onClick={() => void createUser()}>{t('add')}</button>}
      >
        <div className="grid gap-3">
          <Field label={t('dbUser')} hint={t('dbNameHint')}>
            <input className="input ltr" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} autoFocus />
          </Field>
          <Field label={t('dbPassword')} hint={t('dbPasswordMin')}>
            <input className="input ltr" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
          </Field>
          <Field label={t('dbGrantOn')} hint={t('dbGrantHint')}>
            <select className="input" value={newUser.database} onChange={(e) => setNewUser({ ...newUser, database: e.target.value })}>
              <option value="">—</option>
              {databases.filter((d) => !d.system).map((d) => (
                <option key={d.name} value={d.name}>{d.name}</option>
              ))}
            </select>
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        danger
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          void c?.run();
        }}
      />
    </div>
  );
}
