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
import { AlertTriangle, ArrowRightLeft, Boxes, Link2, Plus, Power, RefreshCw, Unlink } from 'lucide-react';
import { api, ApiError } from '../api';
import { useLive } from '../useLive';
import { useApp } from '../app-context';
import { bytes, percent, relative } from '../format';
import type { Dict } from '../i18n';
import { Badge, Card, ConfirmDialog, CopyButton, Field, Loading, Modal, StatusDot, toast } from '../components/ui';
import { Cell, Notice, Row, Select, Table } from '../control/ui';
import { MoveServerCard } from '../components/MoveServer';

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
  tunnel?: { running?: boolean; mode?: string | null; auto?: boolean } | null;
};
type Holder = { id: string; name: string; self: boolean; running: boolean; online: boolean };
type MoveStep = { op: string; state: 'running' | 'done' | 'failed' | 'skipped'; at: number; endedAt?: number; info?: Record<string, unknown> };
type RouteStep = {
  hostname: string | null;
  how: 'auto' | 'cname' | 'public-hostname' | 'a-record' | 'no-hostname';
  done: boolean;
  tunnel?: string | null;
  server?: string | null;
  command?: string;
  port?: number | null;
  fromServer?: string | null;
  url?: string | null;
  detail?: string | null;
};
type MoveView = {
  id: string;
  app: string;
  appType: string;
  appName: string;
  from: { id: string; name: string };
  to: { id: string; name: string };
  state: 'running' | 'rolling_back' | 'done' | 'failed';
  active: boolean;
  step: string | null;
  steps: MoveStep[];
  route: { steps: RouteStep[]; manual: number; auto: boolean; guarded?: string[] } | null;
  error: string | null;
  bytes: number | null;
  waitingFor: string | null;
  delivered: boolean | null;
  createdAt: number;
  finishedAt: number | null;
};
type Placed = {
  id: string;
  type: 'account' | 'pump' | 'site';
  name: string;
  kind: string | null;
  dataful: boolean;
  holders: Holder[];
  node: { id: string; name: string | null } | null;
  source: 'table' | 'observed' | 'unknown';
  mismatch: boolean;
  movable: boolean;
  why: string | null;
  move: MoveView | null;
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
  placement?: Placed[];
  moves?: MoveView[];
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

      {/* «این برنامه روی کدام سرور» (1.50.95) — فقط روی مرکزی که سرورِ دیگری دارد */}
      {!isNode && data.nodes.some((n) => n.status === 'active') && <PlacementCard data={data} load={load} />}
      {!isNode && (data.moves || []).length > 0 && <MovesCard moves={data.moves || []} />}

      {/* وصلِ همین سرور به مرکزِ دیگر — همین‌جا هم، چون صفحهٔ «تنظیمات» در features.ts خاموش است */}
      {(isNode || !data.nodes.some((n) => n.status === 'active')) && <FleetLinkBody data={data} load={load} />}

      {/* «جابه‌جایی به کامپیوترِ دیگر» (1.50.93) — همین‌جا، چون «تنظیمات» در features.ts خاموش است و کارت آن‌جا دیده نمی‌شد */}
      <MoveServerCard />

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

/* ─────────────── «این برنامه روی کدام سرور» (1.50.95) — سرور: src/fleet/placement.js ───────────────
 *  ⛔ «جابه‌جا به…» فقط مالک؛ `api()` خودش پنجرهٔ احرازِ دوباره را باز می‌کند (ReauthHost). تأییدِ صریح: نامِ برنامه
 *     نوشته می‌شود و نامِ دو سرور همان که این‌جا دیده شد به سرور می‌رود (سرور دوباره می‌سنجد).
 *  ⛔ هیچ کلیدی این‌جا نیست — کلیدِ بسته فقط در حافظهٔ مرکز و همان دو سرور.
 */

const TYPE_KEY: Record<string, keyof Dict> = { account: 'fpTypeAccount', site: 'fpTypeSite', pump: 'fpTypePump' };
const STEP_KEY: Record<string, keyof Dict> = {
  freeze: 'fpStepFreeze', export: 'fpStepExport', import: 'fpStepImport', start: 'fpStepStart', route: 'fpStepRoute', retire: 'fpStepRetire',
  'rollback:unfreeze': 'fpStepUnfreeze', 'rollback:discard': 'fpStepDiscard',
};
const eligible = (e: Entry) => e.status === 'active' && e.online && !e.maintenance.wanted && !e.maintenance.applied;

function WhereCell({ a }: { a: Placed }) {
  const { t } = useApp();
  const running = a.holders.filter((h) => h.running);
  return (
    <div className="flex flex-col gap-0.5">
      {a.node ? (
        <span className="font-medium text-ink">{a.node.name || '—'}</span>
      ) : running.length > 1 ? (
        <Badge tone="bad">{t('fpUnknown', { n: running.length })}</Badge>
      ) : (
        <span className="text-xs text-ink-muted">{t('fpNowhere')}</span>
      )}
      {a.node && <span className="text-[11px] text-ink-muted">{a.source === 'table' ? t('fpFromTable') : t('fpObserved')}</span>}
      {a.mismatch && (
        <span className="text-[11px]" style={{ color: 'var(--status-warning)' }}>
          {t('fpMismatch', { table: a.node?.name || '', where: running.map((h) => h.name).join('، ') })}
        </span>
      )}
    </div>
  );
}

function MoveProgress({ m, servers }: { m: MoveView; servers: Entry[] }) {
  const { t } = useApp();
  const step = m.step ? (m.state === 'rolling_back' ? STEP_KEY[`rollback:${m.step}`] : STEP_KEY[m.step]) : null;
  const waiting = m.waitingFor && m.waitingFor !== 'self' && !m.delivered ? servers.find((s) => s.id === m.waitingFor)?.name : null;
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <Badge tone={m.state === 'rolling_back' ? 'warn' : 'info'}>{m.state === 'rolling_back' ? t('fpStateRolling') : t('fpStateRunning')}</Badge>
      {step && <span className="text-ink-soft">{t(step)}{m.bytes ? ` · ${bytes(m.bytes)}` : ''}</span>}
      {waiting && <span className="text-[11px] text-ink-muted">{t('fpWaiting', { name: waiting })}</span>}
    </div>
  );
}

function PlacementCard({ data, load }: { data: Overview; load: () => void }) {
  const { t } = useApp();
  const [moving, setMoving] = useState<Placed | null>(null);
  const rows = data.placement || [];
  const servers = [data.self, ...data.nodes.filter((n) => n.status === 'active')];
  if (!rows.length) return null;
  //  ⛔ پنجره بیرون از کارت: `.card.rise` با transform برای `position: fixed` ِ فرزند قاب می‌سازد و پنجره بریده می‌شد
  return (
    <>
    <Card title={t('fpTitle')} icon={<ArrowRightLeft className="h-4 w-4" />}>
      <p className="mb-3 text-xs leading-6 text-ink-soft">{t('fpIntro')}</p>
      <Table head={[t('fpColApp'), t('fpColWhere'), t('fpColState'), '']}>
        {rows.map((a) => {
          const targets = servers.filter((s) => s.id !== a.node?.id && eligible(s));
          return (
            <Row key={a.id}>
              <Cell>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-ink">{a.name}</span>
                  <span className="text-[11px] text-ink-muted">{TYPE_KEY[a.type] ? t(TYPE_KEY[a.type]) : a.type}{a.dataful ? ` · ${t('fsDataful')}` : ''}</span>
                </div>
              </Cell>
              <Cell><WhereCell a={a} /></Cell>
              <Cell>{a.move ? <MoveProgress m={a.move} servers={servers} /> : <span className="text-xs text-ink-muted">—</span>}</Cell>
              <Cell>
                {a.movable ? (
                  <div className="flex flex-col items-end gap-1">
                    <button className="btn btn-sm" disabled={Boolean(a.move) || !a.node || !targets.length} onClick={() => setMoving(a)}>
                      <ArrowRightLeft className="h-3.5 w-3.5" /> {t('fpMove')}
                    </button>
                    {!a.move && a.node && !targets.length && <span className="text-[11px] text-ink-muted">{t('fpNoTarget')}</span>}
                  </div>
                ) : (
                  <span className="block max-w-[18rem] text-[11px] leading-5 text-ink-muted">{a.why === 'pump_cli_only' ? t('fpPumpCli') : t('fpMainSite')}</span>
                )}
              </Cell>
            </Row>
          );
        })}
      </Table>
    </Card>
    {moving && <MoveDialog app={moving} servers={servers} onClose={() => { setMoving(null); load(); }} />}
    </>
  );
}

function MoveDialog({ app, servers, onClose }: { app: Placed; servers: Entry[]; onClose: () => void }) {
  const { t } = useApp();
  const from = servers.find((s) => s.id === app.node?.id) || null;
  const targets = servers.filter((s) => s.id !== app.node?.id && eligible(s));
  const [to, setTo] = useState(targets[0]?.id || '');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const dest = targets.find((s) => s.id === to) || null;
  const ready = Boolean(from && dest && typed.trim() === app.name.trim());
  const destHasAccount = Boolean(dest?.apps.some((x) => x.type === 'account'));

  const go = async () => {
    if (!from || !dest) return;
    setBusy(true);
    setErr('');
    try {
      await api('/api/fleet/moves', { method: 'POST', body: { app: app.id, from: from.id, to: dest.id, confirm: { app: typed, from: from.name, to: dest.name } } });
      toast(t('fpStarted', { app: app.name }));
      onClose();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('fpDialogTitle', { app: app.name })}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <button className="btn btn-danger" disabled={!ready || busy} onClick={go}>
            <ArrowRightLeft className="h-3.5 w-3.5" /> {t('fpGo')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('fpFrom')}>
            <input className="input" value={from?.name || ''} disabled />
          </Field>
          <Field label={t('fpTo')}>
            <Select value={to} onChange={setTo} options={targets.map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
        </div>
        <ol className="list-decimal space-y-0.5 ps-5 text-xs text-ink-soft">
          {(['freeze', 'export', 'import', 'start', 'route', 'retire'] as const).map((op) => <li key={op}>{t(STEP_KEY[op])}</li>)}
        </ol>
        <Notice tone="warn">{t('fpDowntime')}</Notice>
        {app.type === 'account' && <Notice tone="info">{t('fpAccountFull')}</Notice>}
        {app.type === 'account' && destHasAccount && dest && <Notice tone="warn">{t('fpDestHasAccount', { name: dest.name })}</Notice>}
        {dest && <p className="text-xs text-ink-muted">{dest.tunnel?.auto ? t('fpRouteAuto', { name: dest.name }) : t('fpRouteManual')}</p>}
        <Field label={t('fpTypeName', { app: app.name })}>
          <input className="input" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={app.name} />
        </Field>
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>
  );
}

function RouteGuide({ m }: { m: MoveView }) {
  const { t } = useApp();
  if (!m.route) return null;
  return (
    <div className="mt-2 flex flex-col gap-1.5 text-xs leading-6">
      <span className="font-medium text-ink">{t('fpRouteTitle')}</span>
      {m.route.steps.map((s, i) => (
        <div key={`${s.hostname || 'none'}-${i}`} className="rounded-lg bg-surface-sunken px-3 py-2">
          {s.how === 'auto' && <span style={{ color: 'var(--status-good)' }}>✅ <span dir="ltr">{s.hostname}</span> — {t('fpRouteAutoDone', { host: s.hostname || '', tunnel: s.tunnel || '', server: s.server || '' })}</span>}
          {s.how === 'cname' && (
            <>
              <span>{t('fpRouteCname', { host: s.hostname || '', tunnel: s.tunnel || '', server: s.server || '' })}</span>
              <pre dir="ltr" className="mt-1 overflow-x-auto rounded bg-surface px-2 py-1 text-[11px]">{s.command}</pre>
            </>
          )}
          {s.how === 'public-hostname' && <span>{t('fpRoutePublic', { host: s.hostname || '', server: s.server || '', port: s.port ?? '—', from: s.fromServer || m.from.name })}</span>}
          {s.how === 'a-record' && <span>{t('fpRouteA', { host: s.hostname || '', server: s.server || '' })}</span>}
          {s.how === 'no-hostname' && (
            <span>
              {t('fpRouteNone')}
              {s.url && <> {t('fpRouteNewUrl')} <span dir="ltr" className="font-mono">{s.url}</span></>}
            </span>
          )}
          {s.detail && !s.done && <div className="text-[11px] text-ink-muted">{t('fpDetail', { d: s.detail })}</div>}
        </div>
      ))}
      {m.route.manual > 0 && <Notice tone="warn">{t('fpRouteManualWarn', { from: m.from.name })}</Notice>}
      {(m.route.guarded || []).length > 0 && <span className="text-[11px] text-ink-muted">{t('fpGuarded', { list: (m.route.guarded || []).join('، ') })}</span>}
    </div>
  );
}

function MovesCard({ moves }: { moves: MoveView[] }) {
  const { t, lang } = useApp();
  return (
    <Card title={t('fpMovesTitle')} icon={<ArrowRightLeft className="h-4 w-4" />}>
      <div className="flex flex-col gap-3">
        {moves.map((m) => (
          <div key={m.id} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink">{m.appName}: {m.from.name} {lang === 'en' ? '⇒' : '⇐'} {m.to.name}</span>
              <div className="flex items-center gap-2">
                <Badge tone={m.state === 'done' ? 'good' : m.state === 'failed' ? 'bad' : m.state === 'rolling_back' ? 'warn' : 'info'}>
                  {m.state === 'done' ? t('fpStateDone') : m.state === 'failed' ? t('fpStateFailed') : m.state === 'rolling_back' ? t('fpStateRolling') : t('fpStateRunning')}
                </Badge>
                <span className="text-[11px] text-ink-muted">{relative(m.createdAt, lang)}</span>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {m.steps.map((s, i) => (
                <span
                  key={`${s.op}-${i}`}
                  className="chip"
                  style={{
                    color: s.state === 'done' ? 'var(--status-good)' : s.state === 'failed' ? 'var(--status-critical)' : 'var(--text-secondary)',
                    background: 'color-mix(in srgb, currentColor 10%, transparent)',
                  }}
                >
                  {s.state === 'done' ? '✓' : s.state === 'failed' ? '✗' : s.state === 'skipped' ? '–' : '…'} {STEP_KEY[s.op] ? t(STEP_KEY[s.op]) : s.op}
                </span>
              ))}
            </div>
            {m.error && <p className="mt-2 text-xs" style={{ color: m.state === 'done' ? 'var(--status-warning)' : 'var(--status-critical)' }}>{t('fpError', { e: m.error })}</p>}
            {m.state === 'done' && <RouteGuide m={m} />}
          </div>
        ))}
      </div>
    </Card>
  );
}
