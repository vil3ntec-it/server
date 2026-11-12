// ---------------------------------------------------------------------------
//  «سرورهای من» (۱.۵۰.۹۴) — سرور: ‎/api/fleet‎ (routes/fleet.js، src/fleet/*)
//
//  • صفحهٔ `/my-servers` (فقط مالک؛ سرور هم فقط مالک را راه می‌دهد): همهٔ سرورها — همین مرکز و گره‌های وصل — با
//    نام، گونه، آنلاین/آفلاین، آخرین تپش، CPU/حافظه/دیسک، برنامه‌ها و سایت‌ها، نسخه؛ «افزودنِ سرور» (کدِ ۱۰ دقیقه‌ای)،
//    «غیرفعال/فعال» (حالتِ نگه‌داری) و «جدا کردن»؛ هشدارِ سرخِ «دو دفتر».
//  • `FleetLinkCard` در «تنظیمات» (فقط مالک): همین سرور را به مرکزِ دیگری وصل/جدا می‌کند.
//  ⛔ هر تغییر احرازِ دوباره می‌خواهد — `api()` خودش پنجرهٔ رمز را باز می‌کند (ReauthHost). کد فقط در حافظهٔ همین صفحه.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Boxes, Link2, Plus, Power, RefreshCw, Unlink } from 'lucide-react';
import { api, ApiError } from '../api';
import { useLive } from '../useLive';
import { useApp } from '../app-context';
import { bytes, percent, relative } from '../format';
import type { Dict } from '../i18n';
import { Badge, Card, ConfirmDialog, CopyButton, Field, Loading, StatusDot, toast } from '../components/ui';
import { Cell, Notice, Row, Select, Table } from '../control/ui';

type App = { id: string; type: 'account' | 'pump' | 'site'; name: string; kind?: string | null; dataful: boolean; running: boolean; count?: number };
type Entry = {
  id: string;
  self: boolean;
  name: string;
  kind: string;
  status: 'active' | 'revoked';
  online: boolean;
  lastSeenAt: number | null;
  joinedAt: number | null;
  maintenance: { wanted: boolean; at: number | null; applied: boolean; pumpsKeepRunning?: boolean };
  version: string | null;
  metrics: { cpu: number | null; memory: { usage: number | null; total: number | null }; disk: { usage: number | null; total: number | null } } | null;
  apps: App[];
};
type Conflict = { id: string; name: string; type: string; holders: { id: string; name: string; online: boolean; self: boolean }[] };
type LinkView = {
  status: 'active' | 'left' | 'revoked';
  centerUrl: string;
  centerName: string | null;
  nodeId: string;
  name: string | null;
  kind: string | null;
  joinedAt: number;
  lastOkAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  endedAt: number | null;
};
type Overview = {
  role: 'center' | 'node';
  self: Entry;
  nodes: Entry[];
  conflicts: Conflict[];
  offlineAfterMs: number;
  codeTtlMs: number;
  node: { linked: boolean; link: LinkView | null };
  maintenance: { active: boolean; source: 'center' | 'self' | null; since: number | null };
};

const KIND_KEY: Record<string, keyof Dict> = { home: 'fsKindHome', vps: 'fsKindVps', foreign: 'fsKindForeign', hosting: 'fsKindHosting' };

function errText(e: unknown): string {
  if (e instanceof ApiError) return e.message && e.message !== e.code ? e.message : e.code;
  return e instanceof Error ? e.message : String(e);
}

/** ‎enabled=false‎ (مدیرِ غیرِ مالک): هیچ درخواستی — وگرنه هر ده ثانیه یک ردیفِ «owner_only» در دفتر */
function useFleet(enabled = true) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      setData(await api<Overview>('/api/fleet'));
      setError('');
    } catch (e) {
      setError(errText(e));
    }
  }, [enabled]);
  useEffect(() => { load(); }, [load]);
  //  زنده: سرور با هر وصل/جدا شدن، نگه‌داری و تپشی که چیزی را عوض کرد ‎fleet‎ را بیدار می‌کند. تورِ ایمنیِ ۳۰ ثانیه
  //  فقط برای دادهٔ بیرونی‌ای که خودش خبر نمی‌دهد: درصدهای CPU/حافظه/دیسک و «آفلاین شدنِ» سرورِ خاموش (نبودنِ تپش).
  useLive('fleet', load, enabled ? 30_000 : 0);
  return { data, error, load };
}

/* ─────────────────────────────── کدِ وصل ─────────────────────────────── */

function JoinCode({ onClose }: { onClose: () => void }) {
  const { t } = useApp();
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const make = useCallback(async () => {
    setError('');
    try {
      const r = await api<{ code: string; expiresAt: number }>('/api/fleet/codes', { method: 'POST', body: {} });
      setCode({ code: r.code, expiresAt: r.expiresAt });
    } catch (e) {
      setError(errText(e));
    }
  }, []);
  useEffect(() => { make(); }, [make]);
  useEffect(() => {
    //  نبضِ آگاهانه: ساعتِ شمارشِ معکوسِ کدِ وصل — هیچ درخواستی نمی‌زند، فقط ثانیه‌شمار است
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = code ? Math.max(0, Math.round((code.expiresAt - now) / 1000)) : 0;
  return (
    <Card title={t('fsCodeTitle')} icon={<Plus className="h-4 w-4" />} action={<button className="btn btn-sm" onClick={onClose}>{t('close')}</button>}>
      {error && <Notice tone="bad">{error}</Notice>}
      {code && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span dir="ltr" className="tnum rounded-xl bg-surface-sunken px-4 py-2 font-mono text-2xl font-semibold tracking-widest text-ink" style={{ opacity: left ? 1 : 0.4 }}>
              {code.code}
            </span>
            {left > 0 && <CopyButton value={code.code} />}
          </div>
          <p className="text-xs text-ink-muted">
            {left > 0 ? t('fsCodeExpires', { s: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` }) : t('fsCodeExpired')} {t('fsCodeOnce')}
          </p>
          <p className="text-xs leading-6 text-ink-soft">{t('fsCodeHint')}</p>
          <p className="text-xs text-ink-muted">
            {t('fsCenterUrlHint')} <span dir="ltr" className="font-mono">{window.location.origin}</span>
          </p>
          <pre dir="ltr" className="overflow-x-auto rounded-xl bg-surface-sunken px-3 py-2 text-xs text-ink-soft">node scripts/join.mjs {window.location.origin} {code.code}</pre>
          {left === 0 && <button className="btn btn-sm self-start" onClick={make}><RefreshCw className="h-3.5 w-3.5" /> {t('fsAdd')}</button>}
        </div>
      )}
    </Card>
  );
}

/* ─────────────────────────────── ستون‌ها ─────────────────────────────── */

function StateCell({ e }: { e: Entry }) {
  const { t } = useApp();
  if (e.status === 'revoked') return <Badge>{t('fsRevoked')}</Badge>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusDot online={e.online} label={e.online ? t('fsOnline') : t('fsOffline')} />
      {e.maintenance.wanted && e.maintenance.applied && <Badge tone="warn">{t('fsInMaint')}</Badge>}
      {e.maintenance.wanted !== e.maintenance.applied && <Badge tone="info">{t('fsMaintPending')}</Badge>}
    </div>
  );
}

function Usage({ v, total }: { v: number | null | undefined; total?: number | null }) {
  if (v == null) return <span className="text-ink-muted">—</span>;
  const tone = v >= 90 ? 'var(--status-critical)' : v >= 75 ? 'var(--status-warning)' : 'var(--text-primary)';
  return (
    <span className="tnum" style={{ color: tone }} title={total ? bytes(total) : undefined}>
      {percent(v)}
    </span>
  );
}

function Apps({ e }: { e: Entry }) {
  const { t } = useApp();
  if (!e.apps.length) return <span className="text-xs text-ink-muted">{t('fsNoApps')}</span>;
  return (
    <div className="flex max-w-[22rem] flex-wrap gap-1">
      {e.apps.map((a) => (
        <span
          key={a.id}
          className="chip"
          title={a.dataful ? t('fsDataful') : undefined}
          style={{
            background: a.running ? 'color-mix(in srgb, var(--status-good) 14%, transparent)' : 'color-mix(in srgb, var(--text-muted) 14%, transparent)',
            color: a.running ? 'var(--status-good)' : 'var(--text-secondary)',
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: a.running ? 'var(--status-good)' : 'var(--text-muted)' }} />
          {a.name}
          {a.count != null ? ` (${a.count})` : ''}
        </span>
      ))}
      {e.maintenance.applied && e.maintenance.pumpsKeepRunning && <span className="text-[11px] text-ink-muted">{t('fsPumpsStay')}</span>}
    </div>
  );
}

/* ─────────────────────────────── صفحه ─────────────────────────────── */

type Pending = { kind: 'maint' | 'revoke'; entry: Entry; on?: boolean } | null;

export default function MyServers() {
  const { t, lang, owner } = useApp();
  const { data, error, load } = useFleet(owner);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending>(null);

  if (!owner) {
    return (
      <div className="mx-auto max-w-3xl">
        <Notice tone="warn">{t('fsOwnerOnly')}</Notice>
      </div>
    );
  }
  if (!data && !error) return <Loading />;
  if (!data) return <div className="mx-auto max-w-3xl"><Notice tone="bad">{error}</Notice></div>;

  const isNode = data.role === 'node';
  const rows = [data.self, ...data.nodes];

  const run = async () => {
    const p = pending;
    setPending(null);
    if (!p) return;
    try {
      if (p.kind === 'revoke') {
        await api(`/api/fleet/nodes/${p.entry.id}/revoke`, { method: 'POST', body: {} });
        toast(t('fsRevokedToast', { name: p.entry.name }));
      } else if (p.entry.self) {
        await api('/api/fleet/self/maintenance', { method: 'POST', body: { on: p.on } });
        toast(p.on ? t('fsMaintOnToast', { name: p.entry.name }) : t('fsMaintOffToast', { name: p.entry.name }));
      } else {
        await api(`/api/fleet/nodes/${p.entry.id}/maintenance`, { method: 'POST', body: { on: p.on } });
        toast(p.on ? t('fsMaintOnToast', { name: p.entry.name }) : t('fsMaintOffToast', { name: p.entry.name }));
      }
    } catch (e) {
      toast(errText(e), 'bad');
    }
    load();
  };

  const confirmText = (() => {
    if (!pending) return { title: '', message: '' };
    const name = pending.entry.name;
    if (pending.kind === 'revoke') return { title: t('fsRevokeQ', { name }), message: t('fsRevokeMsg') };
    if (pending.on) {
      return { title: t('fsDisableQ', { name }), message: pending.entry.self && data.nodes.some((n) => n.status === 'active') ? `${t('fsDisableMsg')} ${t('fsDisableSelfMsg')}` : t('fsDisableMsg') };
    }
    return { title: t('fsEnableQ', { name }), message: t('fsEnableMsg') };
  })();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <Card
        title={t('fsTitle')}
        icon={<Boxes className="h-4 w-4" />}
        action={!isNode && !adding ? <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> {t('fsAdd')}</button> : null}
      >
        <p className="text-xs leading-6 text-ink-soft">{t('fsIntro')}</p>
        {isNode && data.node.link && (
          <Notice tone="info">
            {t('fsRoleNode', { name: data.node.link.centerName || data.node.link.centerUrl })}{' '}
            <span dir="ltr" className="font-mono">{data.node.link.centerUrl}</span>
          </Notice>
        )}
        {!isNode && data.nodes.length === 0 && <p className="mt-2 text-xs text-ink-muted">{t('fsRoleAlone')}</p>}
        {data.maintenance.active && data.maintenance.source === 'self' && <Notice tone="warn">{t('fsMaintOnSelf')}</Notice>}
      </Card>

      {adding && <JoinCode onClose={() => { setAdding(false); load(); }} />}

      {data.conflicts.map((c) => (
        <div
          key={c.id}
          role="alert"
          className="flex items-start gap-2 rounded-xl border p-3 text-sm leading-6"
          style={{ borderColor: 'var(--status-critical)', background: 'color-mix(in srgb, var(--status-critical) 12%, transparent)', color: 'var(--status-critical)' }}
        >
          <AlertTriangle className="mt-1 h-4 w-4 shrink-0" />
          <div>
            <b>{t('fsTwoBooks', { app: c.name, where: c.holders.map((h) => (h.self ? `${h.name} (${t('fsThis')})` : h.name) + (h.online ? '' : ` — ${t('fsOffline')}`)).join('، ') })}</b>
            <div className="text-xs text-ink-soft">{t('fsTwoBooksHint')}</div>
          </div>
        </div>
      ))}

      <Card>
        <Table head={[t('fsColName'), t('fsColKind'), t('fsColState'), t('fsColSeen'), t('fsColCpu'), t('fsColMem'), t('fsColDisk'), t('fsColApps'), t('fsColVersion'), '']}>
          {rows.map((e) => (
            <Row key={e.id}>
              <Cell>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-ink">{e.name}</span>
                  {e.self && <span className="text-[11px] text-ink-muted">{t('fsThis')}</span>}
                </div>
              </Cell>
              <Cell>{KIND_KEY[e.kind] ? t(KIND_KEY[e.kind]) : e.kind}</Cell>
              <Cell><StateCell e={e} /></Cell>
              <Cell className="whitespace-nowrap text-xs text-ink-muted">{e.self ? '—' : relative(e.lastSeenAt, lang)}</Cell>
              <Cell><Usage v={e.metrics?.cpu} /></Cell>
              <Cell><Usage v={e.metrics?.memory?.usage} total={e.metrics?.memory?.total} /></Cell>
              <Cell><Usage v={e.metrics?.disk?.usage} total={e.metrics?.disk?.total} /></Cell>
              <Cell><Apps e={e} /></Cell>
              <Cell mono>{e.version || '—'}</Cell>
              <Cell>
                {e.status === 'active' && !(e.self && isNode) && (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <button
                      className={e.maintenance.wanted ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
                      onClick={() => setPending({ kind: 'maint', entry: e, on: !e.maintenance.wanted })}
                    >
                      <Power className="h-3.5 w-3.5" /> {e.maintenance.wanted ? t('fsEnable') : t('fsDisable')}
                    </button>
                    {!e.self && (
                      <button className="btn btn-sm btn-danger" onClick={() => setPending({ kind: 'revoke', entry: e })}>
                        <Unlink className="h-3.5 w-3.5" /> {t('fsRevoke')}
                      </button>
                    )}
                  </div>
                )}
              </Cell>
            </Row>
          ))}
        </Table>
        <p className="mt-3 text-[11px] text-ink-muted">{t('fsOfflineRule', { s: Math.round(data.offlineAfterMs / 1000) })}</p>
      </Card>

      {/* وصلِ همین سرور به مرکزِ دیگر — همین‌جا هم، چون صفحهٔ «تنظیمات» در features.ts خاموش است */}
      {(isNode || !data.nodes.some((n) => n.status === 'active')) && <FleetLinkBody data={data} load={load} />}

      <ConfirmDialog
        open={Boolean(pending)}
        title={confirmText.title}
        message={confirmText.message}
        danger={pending?.kind === 'revoke' || pending?.on === true}
        onConfirm={run}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}

/* ─────────────────────────────── تنظیمات: وصل به مرکز ─────────────────────────────── */

export function FleetLinkCard() {
  const { t } = useApp();
  const { data, error, load } = useFleet();
  if (!data) return error ? <Card title={t('fsJoinTitle')} icon={<Link2 className="h-4 w-4" />}><Notice tone="bad">{error}</Notice></Card> : null;
  return <FleetLinkBody data={data} load={load} />;
}

function FleetLinkBody({ data, load }: { data: Overview; load: () => void }) {
  const { t, lang, serverName } = useApp();
  const [center, setCenter] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const link = data.node.link;
  const linked = data.node.linked && link;
  const hasNodes = data.nodes.some((n) => n.status === 'active');

  const join = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api('/api/fleet/link', { method: 'POST', body: { center: center.trim(), code, ...(name.trim() ? { name: name.trim() } : {}), ...(kind ? { kind } : {}) } });
      setMsg({ tone: 'good', text: t('fsJoined') });
      setCode('');
    } catch (e) {
      setMsg({ tone: 'bad', text: errText(e) });
    } finally {
      setBusy(false);
      load();
    }
  };

  const leave = async () => {
    setConfirmLeave(false);
    setBusy(true);
    try {
      const r = await api<{ centerNotified: boolean }>('/api/fleet/link', { method: 'DELETE' });
      setMsg({ tone: 'good', text: r.centerNotified ? t('fsLeft') : `${t('fsLeft')} — ${t('fsCenterNotNotified')}` });
    } catch (e) {
      setMsg({ tone: 'bad', text: errText(e) });
    } finally {
      setBusy(false);
      load();
    }
  };

  return (
    <Card title={t('fsJoinTitle')} icon={<Link2 className="h-4 w-4" />} action={<Link className="btn btn-sm" to="/my-servers">{t('fsOpenPage')}</Link>}>
      {linked ? (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-ink">
            {t('fsLinked', { name: link.centerName || '' })} <span dir="ltr" className="font-mono text-xs">{link.centerUrl}</span>
          </p>
          <p className="text-xs text-ink-muted">{t('fsLastOk', { t: relative(link.lastOkAt, lang) })}</p>
          {link.lastError && <Notice tone="warn">{t('fsLastErr', { e: link.lastError })}</Notice>}
          {data.maintenance.active && <Notice tone="warn">{t('fsMaintByCenter')}</Notice>}
          <button className="btn btn-sm btn-danger self-start" disabled={busy} onClick={() => setConfirmLeave(true)}>
            <Unlink className="h-3.5 w-3.5" /> {t('fsLeave')}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs leading-6 text-ink-soft">{t('fsJoinIntro')}</p>
          {link?.status === 'revoked' && <Notice tone="warn">{t('fsRevokedByCenter', { t: relative(link.endedAt, lang) })}</Notice>}
          {link?.status === 'left' && <p className="text-xs text-ink-muted">{t('fsLeftAt', { t: relative(link.endedAt, lang) })}</p>}
          {hasNodes ? (
            <Notice tone="info">{t('fsCenterHasNodes')}</Notice>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('fsCenterUrl')}>
                  <input className="input" dir="ltr" placeholder="https://panel.example.com" value={center} onChange={(e) => setCenter(e.target.value)} />
                </Field>
                <Field label={t('fsCode')}>
                  <input className="input font-mono" dir="ltr" autoComplete="off" placeholder="XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} />
                </Field>
                <Field label={t('fsNodeName')}>
                  <input className="input" placeholder={serverName || ''} value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label={t('fsNodeKind')}>
                  <Select
                    value={kind}
                    onChange={setKind}
                    placeholder={t('fsKindAuto')}
                    options={Object.entries(KIND_KEY).map(([value, key]) => ({ value, label: t(key) }))}
                  />
                </Field>
              </div>
              <button className="btn btn-primary btn-sm self-start" disabled={busy || !center.trim() || !code.trim()} onClick={join}>
                <Link2 className="h-3.5 w-3.5" /> {busy ? t('fsJoining') : t('fsJoin')}
              </button>
            </>
          )}
        </div>
      )}
      {msg && (
        <p className="mt-3 text-xs" style={{ color: msg.tone === 'good' ? 'var(--status-good)' : 'var(--status-critical)' }}>{msg.text}</p>
      )}
      <ConfirmDialog open={confirmLeave} title={t('fsLeaveQ')} message={t('fsLeaveMsg')} danger onConfirm={leave} onCancel={() => setConfirmLeave(false)} />
    </Card>
  );
}
