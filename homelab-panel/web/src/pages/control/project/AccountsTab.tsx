// ---------------------------------------------------------------------------
//  زبانهٔ حساب‌های یک پروژه — کاربران، فروشگاه‌ها و اشتراک‌ها
//  همه‌چیز فقط داخلِ همین پروژه؛ پرس‌وجوها هرگز از مرزِ project_id بیرون نمی‌روند.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Store, Trash2, Users } from 'lucide-react';
import { useApp } from '../../../app-context';
import { Card, Field, Loading, Modal, toast } from '../../../components/ui';
import { dateOnly } from '../../../format';
import { cc, type AppUser, type Shop, type Subscription } from '../../../control/api';
import { ActionButton, Cell, Row, Select, Table, Tabs } from '../../../control/ui';

export default function AccountsTab({ projectId }: { projectId: string }) {
  const { t } = useApp();
  const [tab, setTab] = useState('users');
  const [shops, setShops] = useState<Shop[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<'shop' | 'user' | 'sub' | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, u, sub] = await Promise.all([
        cc.shops(projectId),
        cc.users(projectId, { q: query || undefined }),
        cc.subscriptions(projectId),
      ]);
      setShops(s.shops);
      setUsers(u.users);
      setTotal(u.total);
      setSubs(sub.subscriptions);
      setSummary(sub.summary);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoading(false);
    }
  }, [projectId, query]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <Tabs
        tabs={[
          { id: 'users', label: t('ccUsers'), badge: total },
          { id: 'shops', label: t('ccAccounts'), badge: shops.length },
          { id: 'subs', label: t('ccPlan'), badge: summary.active || 0 },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'users' && (
        <Card
          title={t('ccUsers')}
          icon={<Users className="h-4 w-4" />}
          action={
            <div className="flex gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-4 w-4 text-ink-muted" />
                <input className="input ps-9 py-1.5 text-xs" placeholder={t('ccSearch')} value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <button className="btn btn-sm btn-primary" onClick={() => setModal('user')}>
                <Plus className="h-4 w-4" />
              </button>
            </div>
          }
        >
          <Table head={[t('name'), t('ccPhone'), t('ccRole'), t('ccAccounts'), t('ccPlan'), t('status'), '']} empty={users.length === 0}>
            {users.map((u) => (
              <Row key={u.id}>
                <Cell>
                  {u.name || '—'}
                  <span dir="ltr" className="block font-mono text-[10px] text-ink-muted">{u.user_uid}</span>
                </Cell>
                <Cell mono>{u.phone || '—'}</Cell>
                <Cell>{u.role}</Cell>
                <Cell>{u.shop_name || '—'}</Cell>
                <Cell>{u.active_plan || '—'}</Cell>
                <Cell>{u.status}</Cell>
                <Cell>
                  <div className="flex justify-end">
                    <ActionButton onClick={async () => { await cc.deleteUser(projectId, u.id); load(); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </ActionButton>
                  </div>
                </Cell>
              </Row>
            ))}
          </Table>
        </Card>
      )}

      {tab === 'shops' && (
        <Card
          title={t('ccAccounts')}
          icon={<Store className="h-4 w-4" />}
          action={
            <button className="btn btn-sm btn-primary" onClick={() => setModal('shop')}>
              <Plus className="h-4 w-4" />
            </button>
          }
        >
          <Table head={[t('name'), t('ccOwner'), t('ccPhone'), t('ccUsers'), t('status'), '']} empty={shops.length === 0}>
            {shops.map((s) => (
              <Row key={s.id}>
                <Cell>
                  {s.name}
                  <span dir="ltr" className="block font-mono text-[10px] text-ink-muted">{s.shop_id}</span>
                </Cell>
                <Cell>{s.owner_name || '—'}</Cell>
                <Cell mono>{s.owner_phone || '—'}</Cell>
                <Cell className="tnum">{s.user_count ?? 0}</Cell>
                <Cell>{s.status}</Cell>
                <Cell>
                  <div className="flex justify-end">
                    <ActionButton onClick={async () => { await cc.deleteShop(projectId, s.id); load(); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </ActionButton>
                  </div>
                </Cell>
              </Row>
            ))}
          </Table>
        </Card>
      )}

      {tab === 'subs' && (
        <Card
          title={t('ccPlan')}
          action={
            <button className="btn btn-sm btn-primary" onClick={() => setModal('sub')}>
              <Plus className="h-4 w-4" />
            </button>
          }
        >
          <div className="mb-3 flex flex-wrap gap-2">
            {Object.entries(summary).map(([k, v]) => (
              <span key={k} className="chip" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
                {k}: <span className="tnum">{v}</span>
              </span>
            ))}
          </div>
          <Table head={[t('ccPlan'), t('ccAccounts'), t('ccUsers'), t('ccDomainExpires'), t('status'), '']} empty={subs.length === 0}>
            {subs.map((s) => (
              <Row key={s.id}>
                <Cell>{s.plan}</Cell>
                <Cell>{s.shop_name || '—'}</Cell>
                <Cell>{s.user_name || '—'}</Cell>
                <Cell>{dateOnly(s.end_at, 'fa')}</Cell>
                <Cell>{s.status}</Cell>
                <Cell>
                  <div className="flex flex-wrap justify-end gap-1">
                    <ActionButton onClick={async () => { await cc.subscriptionAction(projectId, s.id, 'extend', { days: 30 }); load(); }}>+30</ActionButton>
                    {s.status === 'active' ? (
                      <ActionButton onClick={async () => { await cc.subscriptionAction(projectId, s.id, 'suspend'); load(); }}>{t('stSuspended')}</ActionButton>
                    ) : (
                      <ActionButton onClick={async () => { await cc.subscriptionAction(projectId, s.id, 'activate').catch((e) => toast((e as Error).message, 'bad')); load(); }}>{t('ccActivate')}</ActionButton>
                    )}
                    <ActionButton onClick={async () => { await cc.deleteSubscription(projectId, s.id); load(); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </ActionButton>
                  </div>
                </Cell>
              </Row>
            ))}
          </Table>
        </Card>
      )}

      <ShopModal open={modal === 'shop'} onClose={() => setModal(null)} projectId={projectId} onSaved={() => { setModal(null); load(); }} />
      <UserModal open={modal === 'user'} onClose={() => setModal(null)} projectId={projectId} shops={shops} onSaved={() => { setModal(null); load(); }} />
      <SubModal open={modal === 'sub'} onClose={() => setModal(null)} projectId={projectId} shops={shops} users={users} onSaved={() => { setModal(null); load(); }} />
    </div>
  );
}

function ShopModal({ open, onClose, projectId, onSaved }: { open: boolean; onClose: () => void; projectId: string; onSaved: () => void }) {
  const { t } = useApp();
  const [form, setForm] = useState({ name: '', owner_name: '', owner_phone: '', manager: '', address: '' });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ccAccounts')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <ActionButton
            className="btn btn-primary"
            onClick={async () => {
              if (!form.name.trim()) return toast(t('ccRequired'), 'bad');
              try {
                await cc.addShop(projectId, form);
                setForm({ name: '', owner_name: '', owner_phone: '', manager: '', address: '' });
                onSaved();
              } catch (e) {
                toast((e as Error).message, 'bad');
              }
            }}
          >
            {t('add')}
          </ActionButton>
        </>
      }
    >
      <Field label={t('name')}><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
      <Field label={t('ccOwner')}><input className="input" value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} /></Field>
      <Field label={t('ccPhone')}><input dir="ltr" className="input" value={form.owner_phone} onChange={(e) => setForm({ ...form, owner_phone: e.target.value })} /></Field>
      <Field label={t('ccAddress')}><textarea className="input" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
    </Modal>
  );
}

function UserModal({ open, onClose, projectId, shops, onSaved }: { open: boolean; onClose: () => void; projectId: string; shops: Shop[]; onSaved: () => void }) {
  const { t } = useApp();
  const [form, setForm] = useState({ name: '', phone: '', email: '', role: 'user', shop_id: '', user_uid: '' });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ccUsers')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <ActionButton
            className="btn btn-primary"
            onClick={async () => {
              try {
                await cc.addUser(projectId, { ...form, shop_id: form.shop_id ? Number(form.shop_id) : null, user_uid: form.user_uid || undefined });
                setForm({ name: '', phone: '', email: '', role: 'user', shop_id: '', user_uid: '' });
                onSaved();
              } catch (e) {
                toast((e as Error).message, 'bad');
              }
            }}
          >
            {t('add')}
          </ActionButton>
        </>
      }
    >
      <Field label={t('name')}><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label={t('ccPhone')}><input dir="ltr" className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label={t('ccEmail')}><input dir="ltr" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
      </div>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label={t('ccRole')}>
          <Select value={form.role} onChange={(v) => setForm({ ...form, role: v })} options={['owner', 'manager', 'staff', 'user'].map((x) => ({ value: x, label: x }))} />
        </Field>
        <Field label={t('ccAccounts')}>
          <Select value={form.shop_id} onChange={(v) => setForm({ ...form, shop_id: v })} options={shops.map((s) => ({ value: s.id, label: s.name }))} placeholder="—" />
        </Field>
      </div>
      <Field label="User ID" hint="اگر خالی بماند خودش ساخته می‌شود">
        <input dir="ltr" className="input font-mono" value={form.user_uid} onChange={(e) => setForm({ ...form, user_uid: e.target.value })} />
      </Field>
    </Modal>
  );
}

function SubModal({ open, onClose, projectId, shops, users, onSaved }: { open: boolean; onClose: () => void; projectId: string; shops: Shop[]; users: AppUser[]; onSaved: () => void }) {
  const { t } = useApp();
  const [form, setForm] = useState({ plan: '', shop_id: '', user_id: '', days: '365', price: '' });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ccPlan')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <ActionButton
            className="btn btn-primary"
            onClick={async () => {
              if (!form.plan.trim()) return toast(t('ccRequired'), 'bad');
              try {
                await cc.addSubscription(projectId, {
                  plan: form.plan,
                  shop_id: form.shop_id ? Number(form.shop_id) : null,
                  user_id: form.user_id ? Number(form.user_id) : null,
                  start_at: Date.now(),
                  end_at: Date.now() + Number(form.days || 365) * 86400000,
                  price: form.price || null,
                });
                setForm({ plan: '', shop_id: '', user_id: '', days: '365', price: '' });
                onSaved();
              } catch (e) {
                toast((e as Error).message, 'bad');
              }
            }}
          >
            {t('add')}
          </ActionButton>
        </>
      }
    >
      <Field label={t('ccPlan')}><input className="input" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} autoFocus /></Field>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label={t('ccAccounts')}>
          <Select value={form.shop_id} onChange={(v) => setForm({ ...form, shop_id: v })} options={shops.map((s) => ({ value: s.id, label: s.name }))} placeholder="—" />
        </Field>
        <Field label={t('ccUsers')}>
          <Select value={form.user_id} onChange={(v) => setForm({ ...form, user_id: v })} options={users.map((u) => ({ value: u.id, label: u.name || u.user_uid }))} placeholder="—" />
        </Field>
      </div>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label={t('days')}><input dir="ltr" className="input tnum" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} /></Field>
        <Field label={t('ccNote')}><input className="input" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
