// ---------------------------------------------------------------------------
//  Cloudflare — با API رسمیِ خودشان. توکن رمزنگاری‌شده در گاوصندوق می‌ماند و
//  هرگز در این صفحه نشان داده نمی‌شود.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Cloud, Plus, RefreshCw, ShieldCheck, Trash2, Waypoints } from 'lucide-react';
import { useApp } from '../../app-context';
import { Card, Empty, Field, Loading, Modal, toast } from '../../components/ui';
import { relative } from '../../format';
import { cc, type CfDnsRecord, type CfZone } from '../../control/api';
import type { CfAccount } from '../../control/types';
import { ActionButton, Cell, KV, Notice, Row, Select, StatusPill, Table, Tabs } from '../../control/ui';

export default function CloudflarePage() {
  const { t, lang } = useApp();
  const [accounts, setAccounts] = useState<CfAccount[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [zones, setZones] = useState<CfZone[]>([]);
  const [zone, setZone] = useState<string>('');
  const [records, setRecords] = useState<CfDnsRecord[]>([]);
  const [ssl, setSsl] = useState<{ mode: string | null; universalEnabled: boolean | null } | null>(null);
  const [cfTunnels, setCfTunnels] = useState<{ id: string; name: string; status: string; connections: number }[]>([]);
  const [tab, setTab] = useState('dns');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [dnsOpen, setDnsOpen] = useState(false);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await cc.cfAccounts();
      setAccounts(res.accounts);
      if (res.accounts.length && active == null) setActive(res.accounts[0].id);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const loadZones = useCallback(async () => {
    if (active == null) return;
    try {
      const res = await cc.cfZones(active);
      setZones(res.zones);
      if (res.zones.length && !zone) setZone(res.zones[0].id);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }, [active, zone]);

  useEffect(() => {
    loadZones();
  }, [loadZones]);

  const loadDns = useCallback(async () => {
    if (active == null || !zone) return;
    try {
      const res = await cc.cfDns(active, zone);
      setRecords(res.records);
      setSsl(res.ssl);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }, [active, zone]);

  useEffect(() => {
    if (tab === 'dns') loadDns();
  }, [tab, loadDns]);

  const loadTunnels = useCallback(async () => {
    if (active == null) return;
    try {
      setCfTunnels((await cc.cfTunnels(active)).tunnels);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  }, [active]);

  useEffect(() => {
    if (tab === 'tunnels') loadTunnels();
  }, [tab, loadTunnels]);

  if (loading) return <Loading />;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t('ccCloudflare')}</h1>
        <button className="btn btn-sm btn-primary" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          {t('ccApiToken')}
        </button>
      </header>

      {accounts.length === 0 ? (
        <Card>
          <Empty icon={<Cloud className="h-8 w-8" />} title={t('ccNoItems')} hint={t('ccApiToken')} />
        </Card>
      ) : (
        <>
          <Card title={t('ccAccounts')} icon={<Cloud className="h-4 w-4" />}>
            <ul className="space-y-2">
              {accounts.map((a) => (
                <li
                  key={a.id}
                  className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${active === a.id ? 'border-brand' : 'border-line'}`}
                  onClick={() => {
                    setActive(a.id);
                    setZone('');
                  }}
                  role="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{a.name}</span>
                    <span dir="ltr" className="block truncate font-mono text-[11px] text-ink-muted">
                      {a.account_id || '—'} · {a.token_hint || '••••'}
                    </span>
                  </span>
                  <StatusPill status={a.status === 'active' ? 'online' : a.status === 'error' ? 'offline' : 'unknown'} compact />
                  <ActionButton
                    busyLabel="…"
                    onClick={async () => {
                      const res = await cc.verifyCfAccount(a.id);
                      toast(res.ok ? t('ccVerify') : res.error || 'error', res.ok ? 'good' : 'bad');
                      loadAccounts();
                    }}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                  </ActionButton>
                  <ActionButton onClick={async () => { await cc.deleteCfAccount(a.id); setActive(null); loadAccounts(); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </ActionButton>
                </li>
              ))}
            </ul>
            {accounts.some((a) => a.last_error) && (
              <Notice tone="bad">{accounts.find((a) => a.last_error)?.last_error}</Notice>
            )}
          </Card>

          <Tabs
            tabs={[
              { id: 'dns', label: t('ccDnsRecords'), badge: records.length },
              { id: 'tunnels', label: t('ccTunnels'), badge: cfTunnels.length },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === 'dns' && (
            <Card
              title={t('ccZones')}
              action={
                <div className="flex gap-2">
                  <Select value={zone} onChange={setZone} options={zones.map((z) => ({ value: z.id, label: z.name }))} placeholder="—" />
                  <ActionButton className="btn btn-sm" onClick={loadDns}><RefreshCw className="h-3.5 w-3.5" /></ActionButton>
                  <button className="btn btn-sm btn-primary shrink-0" onClick={() => setDnsOpen(true)} disabled={!zone}>
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              }
            >
              {ssl && (
                <div className="mb-3 rounded-xl border border-line p-3">
                  <KV label={t('ccSslMode')}>{ssl.mode || '—'}</KV>
                  <KV label="Universal SSL">{ssl.universalEnabled == null ? '—' : ssl.universalEnabled ? '✓' : '✗'}</KV>
                </div>
              )}
              <Table head={[t('ccType'), t('name'), t('ccTarget'), 'TTL', t('ccProxied'), '']} empty={records.length === 0}>
                {records.map((r) => (
                  <Row key={r.id}>
                    <Cell><span className="chip" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>{r.type}</span></Cell>
                    <Cell mono><span dir="ltr">{r.name}</span></Cell>
                    <Cell mono><span dir="ltr" className="block max-w-56 truncate">{r.content}</span></Cell>
                    <Cell className="tnum">{r.ttl === 1 ? 'auto' : r.ttl}</Cell>
                    <Cell>
                      <input
                        type="checkbox"
                        checked={r.proxied}
                        onChange={async (e) => {
                          if (active == null) return;
                          try {
                            await cc.cfUpdateDns(active, zone, r.id, { proxied: e.target.checked });
                            loadDns();
                          } catch (err) {
                            toast((err as Error).message, 'bad');
                          }
                        }}
                      />
                    </Cell>
                    <Cell>
                      <div className="flex justify-end">
                        <ActionButton
                          onClick={async () => {
                            if (active == null) return;
                            await cc.cfDeleteDns(active, zone, r.id);
                            loadDns();
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </ActionButton>
                      </div>
                    </Cell>
                  </Row>
                ))}
              </Table>
            </Card>
          )}

          {tab === 'tunnels' && (
            <Card
              title={t('ccTunnels')}
              icon={<Waypoints className="h-4 w-4" />}
              action={
                <ActionButton
                  className="btn btn-sm btn-primary"
                  busyLabel="…"
                  onClick={async () => {
                    if (active == null) return;
                    const res = await cc.cfImportTunnels(active);
                    toast(`+${res.created} / ~${res.updated}`);
                    loadTunnels();
                  }}
                >
                  {t('ccImportTunnels')}
                </ActionButton>
              }
            >
              <Table head={[t('name'), 'ID', t('status'), 'Connections']} empty={cfTunnels.length === 0}>
                {cfTunnels.map((tn) => (
                  <Row key={tn.id}>
                    <Cell>{tn.name}</Cell>
                    <Cell mono><span dir="ltr" className="block max-w-48 truncate">{tn.id}</span></Cell>
                    <Cell><StatusPill status={tn.status === 'healthy' ? 'online' : tn.status === 'inactive' ? 'unknown' : 'offline'} /></Cell>
                    <Cell className="tnum">{tn.connections}</Cell>
                  </Row>
                ))}
              </Table>
            </Card>
          )}
        </>
      )}

      <AccountModal open={open} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); loadAccounts(); }} />
      <DnsModal
        open={dnsOpen}
        onClose={() => setDnsOpen(false)}
        accountId={active}
        zoneId={zone}
        onSaved={() => {
          setDnsOpen(false);
          loadDns();
        }}
      />
      {accounts.length > 0 && active != null && (
        <p className="text-[11px] text-ink-muted">
          {t('ccLastCheck')}: {accounts.find((a) => a.id === active)?.verified_at ? relative(accounts.find((a) => a.id === active)!.verified_at!, lang) : t('ccNever')}
        </p>
      )}
    </div>
  );
}

function AccountModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useApp();
  const [form, setForm] = useState({ name: '', token: '', account_id: '', email: '' });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ccApiToken')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <ActionButton
            className="btn btn-primary"
            busyLabel="…"
            onClick={async () => {
              if (!form.name.trim() || !form.token.trim()) return toast(t('ccRequired'), 'bad');
              try {
                const res = await cc.saveCfAccount(form);
                if (res.account.verify && !res.account.verify.ok) toast(res.account.verify.error || 'error', 'bad');
                else toast(t('ccVerify'));
                setForm({ name: '', token: '', account_id: '', email: '' });
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
      <Notice>{t('ccTokenHidden')}</Notice>
      <Field label={t('name')}><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
      <Field label={t('ccApiToken')} hint="Cloudflare → My Profile → API Tokens">
        <input dir="ltr" type="password" className="input font-mono text-xs" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
      </Field>
      <Field label="Account ID"><input dir="ltr" className="input font-mono text-xs" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })} /></Field>
      <Field label={t('ccEmail')}><input dir="ltr" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
    </Modal>
  );
}

function DnsModal({
  open, onClose, accountId, zoneId, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  accountId: number | null;
  zoneId: string;
  onSaved: () => void;
}) {
  const { t } = useApp();
  const [form, setForm] = useState({ type: 'CNAME', name: '', content: '', ttl: '1', proxied: true, comment: '' });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('ccDnsRecords')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <ActionButton
            className="btn btn-primary"
            onClick={async () => {
              if (accountId == null || !zoneId) return;
              try {
                await cc.cfAddDns(accountId, zoneId, { ...form, ttl: Number(form.ttl) });
                setForm({ ...form, name: '', content: '', comment: '' });
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
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label={t('ccType')}>
          <Select value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'SRV'].map((x) => ({ value: x, label: x }))} />
        </Field>
        <Field label="TTL"><input dir="ltr" className="input tnum" value={form.ttl} onChange={(e) => setForm({ ...form, ttl: e.target.value })} /></Field>
      </div>
      <Field label={t('name')} hint="api"><input dir="ltr" className="input font-mono" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
      <Field label={t('ccTarget')}><input dir="ltr" className="input font-mono" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></Field>
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.proxied} onChange={(e) => setForm({ ...form, proxied: e.target.checked })} />
        {t('ccProxied')}
      </label>
    </Modal>
  );
}
