// ---------------------------------------------------------------------------
//  کاربرانِ پنل و نقششان
//
//  مرکز فرمان به همهٔ زیرساخت دسترسی دارد، پس هر کسی نباید هر کاری بکند.
//  آخرین مدیر هرگز حذف یا از کار انداخته نمی‌شود.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Plus, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import { useApp } from '../../app-context';
import { Card, Empty, Field, Loading, Modal, toast } from '../../components/ui';
import { dateTime, relative } from '../../format';
import { api } from '../../api';
import { ActionButton, Cell, Notice, Row, Select, Table } from '../../control/ui';

type PanelUser = {
  id: number;
  username: string;
  role: 'viewer' | 'operator' | 'admin';
  disabled: boolean;
  created_at: number;
  last_login: number | null;
};

export default function PanelUsers() {
  const { t, lang, username: me, can } = useApp();
  const [users, setUsers] = useState<PanelUser[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [abilities, setAbilities] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const roleLabel = (r: string) =>
    r === 'admin' ? t('ccRoleAdmin') : r === 'operator' ? t('ccRoleOperator') : t('ccRoleViewer');

  const load = useCallback(async () => {
    try {
      const res = await api<{ users: PanelUser[]; roles: string[]; abilities: Record<string, string[]> }>('/api/auth/users');
      setUsers(res.users);
      setRoles(res.roles);
      setAbilities(res.abilities);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (can('admin')) load();
    else setLoading(false);
  }, [load, can]);

  if (!can('admin')) {
    return (
      <Card>
        <Empty icon={<ShieldCheck className="h-8 w-8" />} title={t('ccForbidden')} />
      </Card>
    );
  }
  if (loading) return <Loading />;

  async function patch(id: number, body: Record<string, unknown>) {
    try {
      await api(`/api/auth/users/${id}`, { method: 'PATCH', body });
      load();
    } catch (e) {
      const message = (e as Error).message;
      toast(message === 'last_admin' ? t('ccLastAdmin') : message, 'bad');
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t('ccPanelUsers')}</h1>
        <button className="btn btn-sm btn-primary" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          {t('ccNewPanelUser')}
        </button>
      </header>

      <Card title={t('ccPanelUsers')} icon={<UserCog className="h-4 w-4" />}>
        <Notice>{t('ccRoleHint')}</Notice>

        <Table head={[t('username'), t('ccRole'), t('status'), t('ccLastLogin'), t('ccCreatedAt'), '']} empty={users.length === 0}>
          {users.map((u) => (
            <Row key={u.id}>
              <Cell>
                {u.username}
                {u.username === me && <span className="ms-1.5 text-[10px] text-ink-muted">({t('ccRoleViewer') && 'شما'})</span>}
              </Cell>
              <Cell>
                <Select
                  value={u.role}
                  onChange={(v) => patch(u.id, { role: v })}
                  options={roles.map((r) => ({ value: r, label: roleLabel(r) }))}
                />
              </Cell>
              <Cell>
                {u.disabled ? (
                  <span className="chip" style={{ background: 'color-mix(in srgb, var(--status-critical) 15%, transparent)', color: 'var(--status-critical)' }}>
                    {t('ccDisabled')}
                  </span>
                ) : (
                  <span className="chip" style={{ background: 'color-mix(in srgb, var(--status-good) 15%, transparent)', color: 'var(--status-good)' }}>
                    {t('stActive')}
                  </span>
                )}
              </Cell>
              <Cell className="text-[11px] text-ink-muted">{u.last_login ? relative(u.last_login, lang) : t('ccNever')}</Cell>
              <Cell className="text-[11px] text-ink-muted">{dateTime(u.created_at, lang)}</Cell>
              <Cell>
                <div className="flex justify-end gap-1">
                  <ActionButton onClick={() => patch(u.id, { disabled: !u.disabled })}>
                    {u.disabled ? t('ccEnable') : t('ccDisable')}
                  </ActionButton>
                  {u.username !== me && (
                    <ActionButton
                      onClick={async () => {
                        try {
                          await api(`/api/auth/users/${u.id}`, { method: 'DELETE' });
                          load();
                        } catch (e) {
                          const message = (e as Error).message;
                          toast(message === 'last_admin' ? t('ccLastAdmin') : message, 'bad');
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </ActionButton>
                  )}
                </div>
              </Cell>
            </Row>
          ))}
        </Table>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {roles.map((r) => (
            <div key={r} className="rounded-xl border border-line p-3">
              <p className="mb-1.5 text-xs font-semibold">{roleLabel(r)}</p>
              <ul className="space-y-0.5 text-[11px] text-ink-muted">
                {(abilities[r] || []).map((a) => (
                  <li key={a}>• {a}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <NewUser open={open} onClose={() => setOpen(false)} roles={roles} roleLabel={roleLabel} onSaved={() => { setOpen(false); load(); }} />
    </div>
  );
}

function NewUser({
  open, onClose, roles, roleLabel, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  roles: string[];
  roleLabel: (r: string) => string;
  onSaved: () => void;
}) {
  const { t } = useApp();
  const [form, setForm] = useState({ username: '', password: '', role: 'operator' });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ccNewPanelUser')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <ActionButton
            className="btn btn-primary"
            onClick={async () => {
              if (form.username.trim().length < 3) return toast(t('usernameTooShort'), 'bad');
              if (form.password.length < 8) return toast(t('passwordTooShort'), 'bad');
              try {
                await api('/api/auth/users', { body: form });
                setForm({ username: '', password: '', role: 'operator' });
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
      <Field label={t('username')}>
        <input dir="ltr" className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoFocus />
      </Field>
      <Field label={t('password')}>
        <input dir="ltr" type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      </Field>
      <Field label={t('ccRole')} hint={t('ccRoleHint')}>
        <Select value={form.role} onChange={(v) => setForm({ ...form, role: v })} options={roles.map((r) => ({ value: r, label: roleLabel(r) }))} />
      </Field>
    </Modal>
  );
}
