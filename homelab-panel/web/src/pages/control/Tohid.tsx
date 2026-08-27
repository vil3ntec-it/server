// ---------------------------------------------------------------------------
//  برنامهٔ توحید — حساب‌ها، اشتراک VIP، دستگاه‌ها و اتصال‌ها
//
//  هر عددی که اینجا دیده می‌شود از ردیف‌های واقعی می‌آید. «وصل است» یعنی در
//  چند دقیقهٔ گذشته واقعاً با سرور حرف زده، نه حدس.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import {
  Store, Users, Crown, Wifi, Settings2, Mail, Tag, RefreshCw, Ban, CheckCircle2, Plus,
} from 'lucide-react';
import { useApp } from '../../app-context';
import { Badge, Card, Field, Loading, Modal, toast } from '../../components/ui';
import { dateTime, relative } from '../../format';
import { ActionButton, Cell, KV, Notice, Row, Select, Stat, Table, Tabs } from '../../control/ui';
import { th } from '../../control/tohid-api';
import type { ThAccount, ThOverview, ThPlan, ThOnline, ThRequest, ThSettings } from '../../control/tohid-api';

const UNITS = [
  { value: 'day', key: 'thDay' },
  { value: 'week', key: 'thWeek' },
  { value: 'month', key: 'thMonth' },
  { value: 'year', key: 'thYear' },
] as const;

function duration(ms: number) {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} دقیقه`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ساعت ${m % 60} دقیقه`;
  return `${Math.floor(h / 24)} روز ${h % 24} ساعت`;
}

export default function Tohid() {
  const { t, lang } = useApp();
  const [tab, setTab] = useState('accounts');
  const [overview, setOverview] = useState<ThOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setOverview(await th.overview());
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat icon={<Users className="h-4 w-4" />} label={t('thAccounts')} value={overview?.accounts ?? 0} />
        <Stat icon={<Crown className="h-4 w-4" />} label={t('thVipCount')} value={overview?.withVip ?? 0} tone="good" />
        <Stat icon={<Wifi className="h-4 w-4" />} label={t('thOnline')} value={overview?.online ?? 0} tone="good" />
        <Stat icon={<Store className="h-4 w-4" />} label={t('thDevices')} value={overview?.devices ?? 0} />
        <Stat icon={<Tag className="h-4 w-4" />} label={t('thExpiring')} value={overview?.expiring ?? 0} tone={overview?.expiring ? 'warn' : undefined} />
        <Stat icon={<Mail className="h-4 w-4" />} label={t('thRequests')} value={overview?.newRequests ?? 0} tone={overview?.newRequests ? 'warn' : undefined} />
      </div>

      {!overview?.settings.enabled && (
        <Notice tone="warn">{t('thDisabledHint')}</Notice>
      )}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'accounts', label: t('thAccounts') },
          { id: 'online', label: t('thOnline') },
          { id: 'plans', label: t('thPlans') },
          { id: 'requests', label: t('thRequests') },
          { id: 'settings', label: t('thSettings') },
        ]}
      />

      {tab === 'accounts' && <Accounts onChanged={load} paid={overview?.features.paid ?? []} />}
      {tab === 'online' && <Online />}
      {tab === 'plans' && <Plans paid={overview?.features.paid ?? []} />}
      {tab === 'requests' && <Requests onChanged={load} />}
      {tab === 'settings' && <SettingsTab settings={overview?.settings} keyId={overview?.keyId} onSaved={load} />}
    </div>
  );

  function Accounts({ onChanged, paid }: { onChanged: () => void; paid: string[] }) {
    const [items, setItems] = useState<ThAccount[] | null>(null);
    const [q, setQ] = useState('');
    const [vipFor, setVipFor] = useState<ThAccount | null>(null);
    const [detailFor, setDetailFor] = useState<string | null>(null);

    const refresh = useCallback(async () => {
      try { setItems((await th.accounts(q)).items); }
      catch (e) { toast((e as Error).message, 'bad'); }
    }, [q]);

    useEffect(() => { void refresh(); }, [refresh]);

    return (
      <Card
        title={t('thAccounts')}
        action={
          <div className="flex items-center gap-2">
            <input className="input w-40" value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)} placeholder={t('search')} />
            <ActionButton className="btn btn-sm" onClick={refresh}>
              <RefreshCw className="h-4 w-4" />
            </ActionButton>
          </div>
        }
      >
        <Table
          head={[t('name'), t('thContact'), t('thPlan'), t('thRemaining'), t('thDevices'), t('status'), '']}
          empty={items?.length === 0}
        >
          {(items || []).map((a) => (
            <Row key={a.accountId} onClick={() => setDetailFor(a.accountId)}>
              <Cell>{a.name || '—'}</Cell>
              <Cell mono>{a.email || a.phone || '—'}</Cell>
              <Cell>{a.vip ? a.plan : <span className="text-ink-muted">{t('thFree')}</span>}</Cell>
              <Cell>{a.vip ? `${a.daysLeft} ${t('thDaysLeft')}` : '—'}</Cell>
              <Cell>{a.devices}</Cell>
              <Cell>
                <Badge tone={a.disabled ? 'bad' : a.vip ? 'good' : 'neutral'}>
                  {a.disabled ? t('thDisabled') : a.vip ? 'VIP' : t('thFree')}
                </Badge>
              </Cell>
              <Cell>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={(e) => { e.stopPropagation(); setVipFor(a); }}
                >
                  {t('thGiveVip')}
                </button>
              </Cell>
            </Row>
          ))}
        </Table>

        {vipFor && (
          <VipModal
            account={vipFor}
            paid={paid}
            onClose={() => setVipFor(null)}
            onDone={() => { setVipFor(null); void refresh(); onChanged(); }}
          />
        )}
        {detailFor && (
          <DetailModal
            id={detailFor}
            onClose={() => setDetailFor(null)}
            onChanged={() => { void refresh(); onChanged(); }}
          />
        )}
      </Card>
    );
  }

  function VipModal({
    account, paid, onClose, onDone,
  }: { account: ThAccount; paid: string[]; onClose: () => void; onDone: () => void }) {
    const [plans, setPlans] = useState<ThPlan[]>([]);
    const [planCode, setPlanCode] = useState('');
    const [amount, setAmount] = useState(1);
    const [unit, setUnit] = useState('month');
    const [maxDevices, setMaxDevices] = useState(1);
    const [features, setFeatures] = useState<string[]>(paid);

    useEffect(() => {
      void th.plans().then((r) => {
        const active = r.items.filter((p) => p.active);
        setPlans(active);
        if (active[0]) {
          setPlanCode(active[0].code);
          setAmount(active[0].amount);
          setUnit(active[0].unit);
          setMaxDevices(active[0].max_devices);
          setFeatures(active[0].features);
        }
      }).catch(() => {});
    }, []);

    return (
      <Modal open title={`${t('thGiveVip')} — ${account.name || account.email || account.phone}`} onClose={onClose}>
        <div className="space-y-3">
          <Field label={t('thPlan')}>
            <Select
              value={planCode}
              onChange={(v) => {
                setPlanCode(v);
                const p = plans.find((x) => x.code === v);
                if (p) { setAmount(p.amount); setUnit(p.unit); setMaxDevices(p.max_devices); setFeatures(p.features); }
              }}
              options={[
                ...plans.map((p) => ({ value: p.code, label: p.title })),
                { value: 'custom', label: t('thCustom') },
              ]}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('thAmount')}>
              <input className="input" type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </Field>
            <Field label={t('thUnit')}>
              <Select value={unit} onChange={setUnit} options={UNITS.map((u) => ({ value: u.value, label: t(u.key) }))} />
            </Field>
          </div>

          <Field label={t('thMaxDevices')}>
            <input className="input" type="number" min={1} value={maxDevices} onChange={(e) => setMaxDevices(Number(e.target.value))} />
          </Field>

          <Field label={t('thFeatures')}>
            <div className="flex flex-wrap gap-2">
              {paid.map((f) => (
                <label key={f} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={features.includes(f)}
                    onChange={(e) => setFeatures(
                      e.target.checked ? [...features, f] : features.filter((x) => x !== f),
                    )}
                  />
                  {f}
                </label>
              ))}
            </div>
          </Field>

          <ActionButton
            className="btn btn-primary w-full"
            busyLabel={t('thSaving')}
            onClick={async () => {
              try {
                await th.grantVip(account.accountId, {
                  planCode: planCode === 'custom' ? 'custom' : planCode,
                  amount, unit, maxDevices, features,
                });
                toast(t('saved'), 'good');
                onDone();
              } catch (e) { toast((e as Error).message, 'bad'); }
            }}
          >
            {t('thGiveVip')}
          </ActionButton>
        </div>
      </Modal>
    );
  }

  function DetailModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
    const [data, setData] = useState<Awaited<ReturnType<typeof th.account>> | null>(null);

    const refresh = useCallback(async () => {
      try { setData(await th.account(id)); }
      catch (e) { toast((e as Error).message, 'bad'); }
    }, [id]);
    useEffect(() => { void refresh(); }, [refresh]);

    if (!data) return <Modal open title="…" onClose={onClose}><Loading /></Modal>;
    const a = data.account;

    return (
      <Modal open title={a.name || a.email || a.phone || id} onClose={onClose}>
        <div className="space-y-4">
          <div>
            <KV label={t('thContact')} mono>{a.email || a.phone || '—'}</KV>
            <KV label={t('thAccountId')} mono>{a.accountId}</KV>
            <KV label={t('thCreated')}>{dateTime(a.createdAt, lang)}</KV>
            <KV label={t('thLastSeen')}>{a.lastSeenAt ? relative(a.lastSeenAt, lang) : '—'}</KV>
            <KV label={t('status')}>
              {data.entitlement.isPaid
                ? `${data.entitlement.planTitle} — ${data.entitlement.daysLeft} ${t('thDaysLeft')}`
                : t('thFree')}
            </KV>
            {data.shop.shop && <KV label={t('thShop')}>{data.shop.shop.name} ({data.shop.members.length})</KV>}
          </div>

          <div>
            <h4 className="mb-2 text-sm font-medium">{t('thSubscriptions')}</h4>
            <Table head={[t('thPlan'), t('thFrom'), t('thUntil'), t('status'), '']} empty={!data.subscriptions.length}>
              {data.subscriptions.map((s) => (
                <Row key={s.id}>
                  <Cell>{s.plan_title}</Cell>
                  <Cell>{dateTime(s.starts_at, lang)}</Cell>
                  <Cell>{dateTime(s.ends_at, lang)}</Cell>
                  <Cell><Badge tone={s.status === 'active' ? 'good' : 'bad'}>{s.status}</Badge></Cell>
                  <Cell>
                    <div className="flex gap-1">
                      <ActionButton
                        className="btn btn-sm"
                        onClick={async () => {
                          await th.extend(s.id, { amount: 1, unit: 'month' });
                          toast(t('saved'), 'good'); await refresh(); onChanged();
                        }}
                      >
                        +۱ {t('thMonth')}
                      </ActionButton>
                      <ActionButton
                        className="btn btn-sm"
                        onClick={async () => {
                          await th.setStatus(s.id, s.status === 'active' ? 'suspended' : 'active');
                          toast(t('saved'), 'good'); await refresh(); onChanged();
                        }}
                      >
                        {s.status === 'active' ? t('thSuspend') : t('thResume')}
                      </ActionButton>
                      <ActionButton
                        className="btn btn-sm btn-danger"
                        onClick={async () => {
                          if (!window.confirm(t('thConfirm'))) return;
                          await th.setStatus(s.id, 'cancelled');
                          toast(t('saved'), 'good'); await refresh(); onChanged();
                        }}
                      >
                        {t('thCancel')}
                      </ActionButton>
                    </div>
                  </Cell>
                </Row>
              ))}
            </Table>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-medium">{t('thDevices')}</h4>
            <Table head={[t('name'), t('thLastSeen'), t('status'), '']} empty={!data.devices.length}>
              {data.devices.map((d) => (
                <Row key={d.id}>
                  <Cell>{d.name || d.uid}</Cell>
                  <Cell>{relative(d.last_seen, lang)}</Cell>
                  <Cell>
                    <Badge tone={d.revoked ? 'bad' : 'good'}>
                      {d.revoked ? t('thRevoked') : t('thActive')}
                    </Badge>
                  </Cell>
                  <Cell>
                    <ActionButton
                      className="btn btn-sm"
                      onClick={async () => {
                        await th.revokeDevice(d.id, !d.revoked);
                        toast(t('saved'), 'good'); await refresh(); onChanged();
                      }}
                    >
                      {d.revoked ? t('thAllow') : t('thRevoke')}
                    </ActionButton>
                  </Cell>
                </Row>
              ))}
            </Table>
          </div>

          <ActionButton
            className={`btn w-full ${a.disabled ? '' : 'btn-danger'}`}
            onClick={async () => {
              if (!window.confirm(t('thConfirm'))) return;
              await th.setDisabled(a.accountId, !a.disabled);
              toast(t('saved'), 'good'); await refresh(); onChanged();
            }}
          >
            {a.disabled ? <><CheckCircle2 className="h-4 w-4" />{t('thEnableAccount')}</>
              : <><Ban className="h-4 w-4" />{t('thDisableAccount')}</>}
          </ActionButton>
        </div>
      </Modal>
    );
  }

  function Online() {
    const [items, setItems] = useState<ThOnline[] | null>(null);

    const refresh = useCallback(async () => {
      try { setItems((await th.online()).items); }
      catch (e) { toast((e as Error).message, 'bad'); }
    }, []);

    useEffect(() => {
      void refresh();
      const timer = setInterval(refresh, 15000);
      return () => clearInterval(timer);
    }, [refresh]);

    return (
      <Card title={t('thOnline')} action={
        <ActionButton className="btn btn-sm" onClick={refresh}><RefreshCw className="h-4 w-4" /></ActionButton>
      }>
        <Notice>{t('thOnlineHint')}</Notice>
        <Table head={[t('name'), t('thContact'), t('thConnectedFor'), t('thKind'), 'IP']} empty={items?.length === 0}>
          {(items || []).map((c, i) => (
            <Row key={`${c.accountId}-${c.deviceUid}-${i}`}>
              <Cell>{c.name || t('thGuest')}</Cell>
              <Cell mono>{c.contact || '—'}</Cell>
              <Cell>{duration(c.connectedMs)}</Cell>
              <Cell>{c.kind}</Cell>
              <Cell mono>{c.ip || '—'}</Cell>
            </Row>
          ))}
        </Table>
      </Card>
    );
  }

  function Plans({ paid }: { paid: string[] }) {
    const [items, setItems] = useState<ThPlan[] | null>(null);
    const [editing, setEditing] = useState<Partial<ThPlan> | null>(null);

    const refresh = useCallback(async () => {
      try { setItems((await th.plans()).items); }
      catch (e) { toast((e as Error).message, 'bad'); }
    }, []);
    useEffect(() => { void refresh(); }, [refresh]);

    return (
      <Card title={t('thPlans')} action={
        <button type="button" className="btn btn-sm btn-primary"
          onClick={() => setEditing({ code: '', title: '', amount: 1, unit: 'month', price: 0, max_devices: 1, features: paid })}>
          <Plus className="h-4 w-4" />{t('add')}
        </button>
      }>
        <Notice>{t('thPlansHint')}</Notice>
        <Table head={[t('thPlan'), t('thAmount'), t('thPrice'), t('thMaxDevices'), t('status'), '']} empty={items?.length === 0}>
          {(items || []).map((p) => (
            <Row key={p.code} onClick={() => setEditing(p)}>
              <Cell>{p.title} <span className="text-ink-muted">({p.code})</span></Cell>
              <Cell>{p.amount} {t(UNITS.find((u) => u.value === p.unit)?.key ?? 'thMonth')}</Cell>
              <Cell>{p.price}</Cell>
              <Cell>{p.max_devices}</Cell>
              <Cell><Badge tone={p.active ? 'good' : 'neutral'}>{p.active ? t('thActive') : t('thOff')}</Badge></Cell>
              <Cell>
                <ActionButton className="btn btn-sm btn-danger"
                  onClick={async () => {
                    if (!window.confirm(t('thConfirm'))) return;
                    await th.deletePlan(p.code); toast(t('saved'), 'good'); await refresh();
                  }}>
                  {t('delete')}
                </ActionButton>
              </Cell>
            </Row>
          ))}
        </Table>

        {editing && (
          <Modal open title={editing.code || t('add')} onClose={() => setEditing(null)}>
            <div className="space-y-3">
              <Field label={t('thCode')}>
                <input className="input" value={editing.code || ''} onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
              </Field>
              <Field label={t('name')}>
                <input className="input" value={editing.title || ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('thAmount')}>
                  <input className="input" type="number" min={1} value={editing.amount ?? 1}
                    onChange={(e) => setEditing({ ...editing, amount: Number(e.target.value) })} />
                </Field>
                <Field label={t('thUnit')}>
                  <Select value={editing.unit || 'month'} onChange={(v) => setEditing({ ...editing, unit: v })}
                    options={UNITS.map((u) => ({ value: u.value, label: t(u.key) }))} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('thPrice')}>
                  <input className="input" type="number" value={editing.price ?? 0}
                    onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })} />
                </Field>
                <Field label={t('thMaxDevices')}>
                  <input className="input" type="number" min={1} value={editing.max_devices ?? 1}
                    onChange={(e) => setEditing({ ...editing, max_devices: Number(e.target.value) })} />
                </Field>
              </div>
              <Field label={t('thBadge')}>
                <input className="input" value={editing.badge || ''} onChange={(e) => setEditing({ ...editing, badge: e.target.value })} />
              </Field>
              <ActionButton className="btn btn-primary w-full" busyLabel={t('thSaving')}
                onClick={async () => {
                  try {
                    await th.savePlan({
                      code: editing.code, title: editing.title, amount: editing.amount,
                      unit: editing.unit, price: editing.price, badge: editing.badge,
                      maxDevices: editing.max_devices, features: editing.features ?? paid,
                      active: editing.active === undefined ? true : Boolean(editing.active),
                    });
                    toast(t('saved'), 'good'); setEditing(null); await refresh();
                  } catch (e) { toast((e as Error).message, 'bad'); }
                }}>
                {t('save')}
              </ActionButton>
            </div>
          </Modal>
        )}
      </Card>
    );
  }

  function Requests({ onChanged }: { onChanged: () => void }) {
    const [items, setItems] = useState<ThRequest[] | null>(null);
    const refresh = useCallback(async () => {
      try { setItems((await th.requests()).items); }
      catch (e) { toast((e as Error).message, 'bad'); }
    }, []);
    useEffect(() => { void refresh(); }, [refresh]);

    return (
      <Card title={t('thRequests')}>
        <Table head={[t('thDate'), t('name'), t('thPlan'), t('thContact'), t('status'), '']} empty={items?.length === 0}>
          {(items || []).map((r) => (
            <Row key={r.id}>
              <Cell>{dateTime(r.created_at, lang)}</Cell>
              <Cell>{r.name || '—'}</Cell>
              <Cell>{r.plan_code || '—'}</Cell>
              <Cell mono>{r.contact || r.email || r.phone || '—'}</Cell>
              <Cell><Badge tone={r.status === 'new' ? 'warn' : 'good'}>{r.status}</Badge></Cell>
              <Cell>
                {r.status === 'new' && (
                  <ActionButton className="btn btn-sm"
                    onClick={async () => { await th.setRequestStatus(r.id, 'done'); await refresh(); onChanged(); }}>
                    {t('thMarkDone')}
                  </ActionButton>
                )}
              </Cell>
            </Row>
          ))}
        </Table>
      </Card>
    );
  }

  function SettingsTab({
    settings, keyId, onSaved,
  }: { settings?: ThSettings; keyId?: string | null; onSaved: () => void }) {
    const [form, setForm] = useState<ThSettings | null>(settings ?? null);
    const [password, setPassword] = useState('');
    const [testTo, setTestTo] = useState('');

    useEffect(() => { setForm(settings ?? null); }, [settings]);
    if (!form) return <Loading />;

    const setMail = (patch: Partial<ThSettings['mail']>) => setForm({ ...form, mail: { ...form.mail, ...patch } });

    return (
      <div className="space-y-4">
        <Card title={t('thConnection')} icon={<Settings2 className="h-4 w-4" />}>
          <Notice>{t('thConnectionHint')}</Notice>
          <KV label={t('thConnectionExample')} mono>
            <span dir="ltr">ws://192.168.1.10:4700/tohid</span>
          </KV>
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            {t('thEnable')}
          </label>
          <Field label={t('thServerToken')} hint={t('thServerTokenHint')}>
            <input className="input" value={form.serverToken} onChange={(e) => setForm({ ...form, serverToken: e.target.value })} dir="ltr" />
          </Field>
          <KV label={t('thKeyId')} mono>{keyId || '—'}</KV>
        </Card>

        <Card title={t('thMail')} icon={<Mail className="h-4 w-4" />}>
          <Notice tone="warn">{t('thGmailHint')}</Notice>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('thMailHost')}>
              <input className="input" value={form.mail.host} onChange={(e) => setMail({ host: e.target.value })} dir="ltr" placeholder="smtp.gmail.com" />
            </Field>
            <Field label={t('thMailPort')}>
              <input className="input" type="number" value={form.mail.port} onChange={(e) => setMail({ port: Number(e.target.value) })} dir="ltr" />
            </Field>
            <Field label={t('thMailUser')}>
              <input className="input" value={form.mail.user} onChange={(e) => setMail({ user: e.target.value })} dir="ltr" />
            </Field>
            <Field label={t('thMailPassword')} hint={form.mail.passwordSet ? t('thMailPasswordSet') : ''}>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" placeholder="••••••••" />
            </Field>
            <Field label={t('thMailFrom')}>
              <input className="input" value={form.mail.from} onChange={(e) => setMail({ from: e.target.value })} dir="ltr" />
            </Field>
            <Field label={t('thMailFromName')}>
              <input className="input" value={form.mail.fromName} onChange={(e) => setMail({ fromName: e.target.value })} />
            </Field>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Field label={t('thTestMailTo')}>
              <input className="input" value={testTo} onChange={(e) => setTestTo(e.target.value)} dir="ltr" />
            </Field>
            <ActionButton
              className="btn"
              busyLabel={t('thSending')}
              onClick={async () => {
                const res = await th.testMail(testTo);
                if (res.ok) toast(t('thMailSent'), 'good');
                else toast(res.detail || res.error || t('thMailFailed'), 'bad');
              }}
            >
              {t('thSendTest')}
            </ActionButton>
          </div>
        </Card>

        <Card title={t('thPrices')} icon={<Tag className="h-4 w-4" />}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('thCurrency')}>
              <input className="input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
            </Field>
            <Field label={t('thWhatsapp')}>
              <input className="input" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} dir="ltr" />
            </Field>
          </div>
        </Card>

        <ActionButton
          className="btn btn-primary w-full"
          busyLabel={t('thSaving')}
          onClick={async () => {
            try {
              const body: Record<string, unknown> = {
                enabled: form.enabled, serverToken: form.serverToken,
                currency: form.currency, whatsapp: form.whatsapp, mail: form.mail,
              };
              if (password) body.mailPassword = password;
              await th.saveSettings(body);
              setPassword('');
              toast(t('saved'), 'good');
              onSaved();
            } catch (e) { toast((e as Error).message, 'bad'); }
          }}
        >
          {t('save')}
        </ActionButton>
      </div>
    );
  }
}
