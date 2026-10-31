// ---------------------------------------------------------------------------
//  🛠 کنسولِ فروشگاه — ماژول‌های عملیاتِ پنلِ مرکزیِ مالک
//
//    ۴.۸  نسخه‌ها و انتشار     ⇐ ‎ReleasesTab‎   (زبانهٔ «نسخه‌ها»: همان کارت‌های فاز ۲ + انتشار، سازگاری، مرحله‌ای)
//    ۴.۹  سلامتِ سیستم         ⇐ ‎OpsHealthTab‎  (زبانهٔ «سلامت و خطاها»: سنجه‌های پنل + سرورِ حساب + فاز ۲)
//    ۴.۱۰ رخدادها              ⇐ ‎IncidentsTab‎  (زبانهٔ تازهٔ «رخدادها»)
//    ۴.۱۱ هشدارها              ⇐ ‎AlertsTab‎     (زبانهٔ تازهٔ «هشدارها»)
//    ۴.۱۳ یکپارچه‌سازی و API   ⇐ ‎IntegrationsOpsTab‎ (زبانهٔ «یکپارچه‌سازی»: فاز ۲ + فعالیت، اعتبارنامه، وب‌هوک، قرارداد)
//
//  ⛔ هر عدد از سرورِ حساب یا از سنجهٔ همین پنل؛ نیامده ⇒ «—» (‎shown‎ ِ consoleData)، نه صفر.
//  ⛔ زیرِ هر کارت منبع و زمان (‎SourceLine‎). خطای بالادست با کدِ خودش (‎Problem‎). «توانایی» نیامده ⇒
//     «داده در دسترس نیست»، و دکمه‌ای که جایی نمی‌رود ساخته نمی‌شود.
//  ⛔ هر نوشتن: پنجرهٔ تأیید، دلیل هر جا لازم است، کلیدِ یکتایی برای یادداشت، و «تأییدشده از سرور» فقط
//     پس از پاسخِ واقعی. مجوز در سرور است؛ پنهان کردنِ دکمه فقط برای درخواستِ بی‌نتیجه نزدن است.
// ---------------------------------------------------------------------------
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Activity, BellRing, FileWarning, KeyRound, Rocket, Server, ShieldAlert } from 'lucide-react';

import { api, ApiError, getToken } from '../../api';
import { Card, Loading, Modal } from '../../components/ui';
import { useApp } from '../../app-context';
import { ActionButton, Cell, KV, Notice, Row, Stat, Table } from '../../control/ui';
import { useLoad, type Load } from './shared';
import { HealthTab, IntegrationsTab, Problem, SourceLine, VersionsTab } from './ShopConsole';
import { bytes, isUnavailable, newIdemKey, num, reasonOk, shown } from './consoleData';
import { opsText, type OpsKey } from './consoleOpsI18n';

/** ترجمه با زبانِ همین نشست (جدولِ ‎consoleOpsI18n.ts‎)؛ متغیرها با ‎{n}‎. */
function useOpsT() {
  const { lang } = useApp();
  return (key: OpsKey, vars?: Record<string, string | number>) => opsText(lang, key, vars);
}
type T = ReturnType<typeof useOpsT>;
type Dict = Record<string, unknown>;

const BASE = '/api/account-admin/console';
const TONE: Record<string, string> = {
  ok: 'var(--status-good)', good: 'var(--status-good)', warn: 'var(--status-warning)', down: 'var(--status-critical)',
  bad: 'var(--status-critical)', unknown: 'var(--text-muted)', neutral: 'var(--text-muted)',
};
const SEV_TONE: Record<string, string> = { critical: 'down', high: 'warn', medium: 'warn', low: 'unknown' };

const moment = (ms: unknown) => {
  const n = num(ms);
  return n && n > 0 ? new Date(n).toLocaleString('fa-AF', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
};
const errText = (e: unknown) => (e instanceof ApiError ? `${e.message} (${e.code})` : String(e));
const arr = <X,>(v: unknown): X[] => (Array.isArray(v) ? (v as X[]) : []);
const qs = (o: Record<string, string | number | undefined>) =>
  Object.entries(o).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  const color = TONE[tone] || TONE.unknown;
  return <span className="chip whitespace-nowrap" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}>{children}</span>;
}
function StatePill({ s, t }: { s: unknown; t: T }) {
  const k = ['ok', 'warn', 'down', 'unknown'].includes(String(s)) ? String(s) : 'unknown';
  return <Pill tone={k}>{t(`st_${k}` as OpsKey)}</Pill>;
}
function NotAvail({ data, t }: { data: Dict; t: T }) {
  return (
    <Notice tone="warn">
      <b>{t('notAvailable')}</b> — {t('capabilityMissing')}
      <span className="mt-1 block text-[11px] text-ink-muted"><code dir="ltr" className="font-mono">{String(data.capability || '')}</code> · <span dir="ltr">{String(data.needs || '')}</span></span>
    </Notice>
  );
}
/** یک کارتِ خواندنی: بارگذاری · خطا با کد · «در دسترس نیست» · داده + خطِ منبع. */
function Block<D extends Dict>({ title, icon, source, load, children, action }: {
  title: string; icon?: ReactNode; source: string; load: Load<D>; children: (d: D) => ReactNode; action?: ReactNode;
}) {
  const t = useOpsT();
  return (
    <Card title={title} icon={icon} action={action}>
      {load.error ? <Problem load={load as Load<unknown>} /> : !load.data ? <Loading /> : isUnavailable(load.data) ? <NotAvail data={load.data as Dict} t={t} /> : (
        <>
          {children(load.data)}
          <SourceLine source={source} data={load.data} at={load.at} />
        </>
      )}
    </Card>
  );
}
function Definitions({ defs, t }: { defs: unknown; t: T }) {
  const d = (defs && typeof defs === 'object' ? defs : {}) as Record<string, string>;
  if (!Object.keys(d).length) return null;
  return (
    <details className="mt-3 text-[11px] text-ink-muted">
      <summary className="cursor-pointer">{t('definitions')}</summary>
      <ul className="mt-1 space-y-1">{['ok', 'warn', 'down', 'unknown'].map((k) => d[k] && <li key={k}><StatePill s={k} t={t} /> {d[k]}</li>)}</ul>
    </details>
  );
}
/** فرمِ نوشتنیِ تأییدشونده، بردهٔ `body` (کارتِ `.rise` قابِ fixed را زندانی می‌کند). */
function Dialog({ open, title, onClose, onSend, busy, ready, children }: {
  open: boolean; title: string; onClose: () => void; onSend: () => void; busy: boolean; ready: boolean; children: ReactNode;
}) {
  const t = useOpsT();
  if (!open) return null;
  return createPortal(
    <Modal open onClose={onClose} title={title} footer={<>
      <button className="btn" onClick={onClose}>{t('cancel')}</button>
      <button className="btn btn-danger" disabled={!ready || busy} onClick={onSend}>{busy ? '…' : t('confirmSend')}</button>
    </>}>
      <div className="space-y-3 text-sm">{children}</div>
    </Modal>,
    document.body,
  );
}

/* ═════════════════════════════ ۴.۸ نسخه‌ها و انتشار ═════════════════════════════ */

type Published = { tag: string; state: string; version?: string; publishedAt?: number | null; notes?: string; notesTruncated?: boolean; error?: string };
type Channel = { tag: string; app: string; platform: string; stable: Published; beta: Published };

function PublishedCell({ p, t }: { p: Published; t: T }) {
  if (p.state === 'none') return <span className="text-ink-muted">{t('relNone')}</span>;
  if (p.state !== 'published') return <span><Pill tone="unknown">{t('st_unknown')}</Pill> <code dir="ltr" className="text-[11px]">{p.error || ''}</code></span>;
  return (
    <span>
      <b dir="ltr">{p.version || '—'}</b> <span className="text-[11px] text-ink-muted">{moment(p.publishedAt)}</span>
      {p.notes && (
        <details className="text-[11px]"><summary className="cursor-pointer text-ink-muted">{t('relNotes')}</summary>
          <pre className="whitespace-pre-wrap font-sans">{p.notes}{p.notesTruncated ? '…' : ''}</pre></details>
      )}
    </span>
  );
}

function StageControls({ tags, versions }: { tags: string[]; versions: Record<string, string> }) {
  const t = useOpsT();
  const { can } = useApp();
  const load = useLoad<Dict>(can('admin') ? `${BASE}/release/stage` : null);
  const [mode, setMode] = useState<'set' | 'pause' | 'end' | null>(null);
  const [tag, setTag] = useState(tags[0] || '');
  const [version, setVersion] = useState('');
  const [percent, setPercent] = useState('10');
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  if (!can('admin')) return <Notice>{t('adminOnly')}</Notice>;
  if (load.error) return <Problem load={load as Load<unknown>} />;
  if (!load.data) return <Loading />;
  if (isUnavailable(load.data)) return <Notice tone="warn"><b>{t('stageNotSupported')}</b> — <code dir="ltr">{String(load.data.capability)}</code></Notice>;
  const stages = (load.data.stages || {}) as Record<string, { version?: string; percent?: number; updatedAt?: number; updatedBy?: string } | null>;
  const canChange = load.data.canChange === true;
  const close = () => { setMode(null); setReason(''); setPassword(''); setErr(''); };
  const pct = Number(percent);
  const ready = reasonOk(reason) && Boolean(password) && Boolean(tag)
    && (mode === 'end' || (/^\d+(\.\d+){1,3}$/.test(version.trim()) && (mode === 'pause' || (Number.isInteger(pct) && pct >= 0 && pct <= 100))));
  const send = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr('');
    try {
      if (mode === 'end') {
        await api(`${BASE}/release/stage/end`, { method: 'POST', body: { tag, reason: reason.trim(), confirm: true, password } });
      } else {
        await api(`${BASE}/release/stage`, { method: 'PUT', body: { tag, version: version.trim(), percent: mode === 'pause' ? 0 : pct, reason: reason.trim(), confirm: true, password } });
      }
      setDone(`${t('serverConfirmed')} — ${tag}`);
      close();
      void load.reload();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); setPassword(''); }
  };
  return (
    <>
      <Table head={[t('stageTag'), t('stageCurrent'), t('stagePercent'), t('updated')]} empty={tags.length === 0}>
        {tags.map((tg) => {
          const s = stages[tg];
          return (
            <Row key={tg}>
              <Cell mono>{tg}</Cell>
              <Cell>{s ? <b dir="ltr">{s.version}</b> : <span className="text-ink-muted">{t('stageNone')}</span>}</Cell>
              <Cell>{s ? `${shown(s.percent)}٪` : '—'}</Cell>
              <Cell>{s ? `${moment(s.updatedAt)} · ${s.updatedBy || '—'}` : '—'}</Cell>
            </Row>
          );
        })}
      </Table>
      {done && <Notice tone="good">{done}</Notice>}
      {canChange ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-sm" onClick={() => { setDone(''); setMode('set'); setVersion(versions[tag] || ''); }}>{t('stageSet')}</button>
          <button className="btn btn-sm" onClick={() => { setDone(''); setMode('pause'); setVersion(stages[tag]?.version || versions[tag] || ''); }}>{t('stagePause')}</button>
          <button className="btn btn-sm btn-danger" onClick={() => { setDone(''); setMode('end'); }}>{t('stageEnd')}</button>
        </div>
      ) : <p className="mt-2 text-[11px] text-ink-muted">{t('ownerOnly')}</p>}
      <p className="mt-2 text-[11px] text-ink-muted">{t('stagePauseNote')}</p>
      <Notice tone="warn">{t('rollbackNo')}</Notice>
      <p className="text-[11px] text-ink-muted">{t('scheduledNo')}</p>
      <SourceLine source="/api/admin/release/stage (OPS-01)" data={load.data} at={load.at} />
      <Dialog open={mode !== null} title={mode === 'end' ? t('stageEnd') : mode === 'pause' ? t('stagePause') : t('stageSet')} onClose={close} onSend={send} busy={busy} ready={ready}>
        <Notice tone="warn">{t('stageConfirm')}</Notice>
        <label className="block text-xs">{t('stageTag')}
          <select className="input mt-1 w-full" value={tag} onChange={(e) => setTag(e.target.value)}>{tags.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        </label>
        {mode !== 'end' && (
          <label className="block text-xs">{t('relVersion')}
            <input className="input mt-1 w-full" dir="ltr" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="2.14.5" />
          </label>
        )}
        {mode === 'set' && (
          <label className="block text-xs">{t('stagePercent')}
            <input className="input mt-1 w-full" type="number" min={0} max={100} step={1} dir="ltr" value={percent} onChange={(e) => setPercent(e.target.value)} />
          </label>
        )}
        <label className="block text-xs">{t('reason')}
          <textarea className="input mt-1 w-full" rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className="block text-xs">{t('password')}
          <input className="input mt-1 w-full" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err && <Notice tone="bad">{err}</Notice>}
      </Dialog>
    </>
  );
}

function ReleaseBoard() {
  const t = useOpsT();
  const load = useLoad<Dict>(`${BASE}/ops/releases`);
  return (
    <Block title={t('relTitle')} icon={<Rocket size={16} />} source="/api/admin/ops/releases" load={load}>
      {(d) => {
        const channels = arr<Channel>(d.channels);
        const apps = (d.apps || {}) as Record<string, Dict>;
        const schema = (d.schema || {}) as Dict;
        const stage = (d.stage || {}) as Dict;
        const shop = apps.shop || {};
        const devices = (shop.devices || null) as Dict | null;
        const after = shop.afterRelease as Dict | null;
        const versions: Record<string, string> = {};
        for (const c of channels) versions[c.tag] = c.beta.version || c.stable.version || '';
        return (
          <div className="space-y-4">
            <div>
              <h4 className="mb-2 text-xs font-semibold">{t('relThree')}</h4>
              <div className="grid gap-3 sm:grid-cols-3">
                <Stat label={t('relAppVersion')} value={<span dir="ltr">{channels.map((c) => c.stable.version).filter(Boolean).join(' · ') || '—'}</span>} sub={`${t('relMin')}: ${String(shop.minVersion || '—')}`} />
                <Stat label={t('relApiVersion')} value={<span dir="ltr">{String((d.api as Dict)?.version || '—')}</span>} />
                <Stat label={t('relSchema')} value={<span dir="ltr">{String(schema.migration || '—')}</span>}
                      sub={`${t('relAppSchema')}: ${arr<Dict>(schema.appSchema).map((a) => `${a.app} v${a.schemaVersion}`).join('، ') || '—'}`} />
              </div>
            </div>
            <Table head={[t('relPlatform'), t('relStable'), t('relBeta')]} empty={channels.length === 0}>
              {channels.map((c) => (
                <Row key={c.tag}>
                  <Cell><b>{c.app}</b> · {c.platform} <code dir="ltr" className="text-[11px] text-ink-muted">{c.tag}</code></Cell>
                  <Cell><PublishedCell p={c.stable} t={t} /></Cell>
                  <Cell><PublishedCell p={c.beta} t={t} /></Cell>
                </Row>
              ))}
            </Table>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label={t('relMin')} value={<span dir="ltr">{String(shop.minVersion || '—')}</span>} sub={`${t('relLatest')}: ${String(shop.latestDeclared || '—')}`} />
              <Stat label={t('relDevices')} value={shown(devices?.total)} />
              <Stat label={t('relBelowMin')} value={shown(devices?.belowMin)} tone={num(devices?.belowMin) ? 'bad' : undefined} />
              <Stat label={t('relOutdated')} value={shown(devices?.outdated)} tone={num(devices?.outdated) ? 'warn' : undefined} />
            </div>
            {after && <Notice tone={num(after.errors) ? 'warn' : 'info'}>{t('relAfter', { v: String(after.version), n: shown(after.errors), d: shown(after.devices) })}</Notice>}
            <div>
              <h4 className="mb-2 text-xs font-semibold">{t('relErrors')}</h4>
              <Table head={[t('relVersion'), t('relErrorsN'), t('incDevice'), t('relShops'), t('relIncidents'), t('relLast')]} empty={arr(shop.errorsByVersion).length === 0}>
                {arr<Dict>(shop.errorsByVersion).map((r) => (
                  <Row key={String(r.version) || 'none'}>
                    <Cell mono>{String(r.version || '—')}</Cell><Cell>{shown(r.errors)}</Cell><Cell>{shown(r.devices)}</Cell>
                    <Cell>{shown(r.shops)}</Cell><Cell>{shown(r.incidents)}</Cell><Cell>{moment(r.lastAt)}</Cell>
                  </Row>
                ))}
              </Table>
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold">{t('stageTitle')}</h4>
              {stage.supported === true
                ? <StageControls tags={channels.map((c) => c.tag)} versions={versions} />
                : <Notice tone="warn"><b>{t('stageNotSupported')}</b> — <code dir="ltr">{String(stage.reason || '—')}</code> <span dir="ltr" className="text-[11px]">{String(stage.needs || '')}</span>
                    <span className="mt-1 block">{t('rollbackNo')}</span></Notice>}
            </div>
          </div>
        );
      }}
    </Block>
  );
}

export function ReleasesTab() {
  return (
    <div className="space-y-4">
      <ReleaseBoard />
      {/* همان کارت‌های فاز ۲ (نسخهٔ دستگاه‌ها، کانالِ آزمایشی) — رونوشتِ دومی نیست */}
      <VersionsTab />
    </div>
  );
}

/* ═════════════════════════════ ۴.۹ سلامتِ سیستم ═════════════════════════════ */

function HealthBoard() {
  const t = useOpsT();
  const load = useLoad<Dict>(`${BASE}/ops/health`);
  if (load.error) return <Card title={t('hlTitle')} icon={<Activity size={16} />}><Problem load={load as Load<unknown>} /></Card>;
  if (!load.data) return <Card title={t('hlTitle')} icon={<Activity size={16} />}><Loading /></Card>;
  const panel = (load.data.panel || {}) as Dict;
  const p = (panel.panel || {}) as Dict;
  const bridge = (panel.bridge || {}) as Dict;
  const proc = (panel.accountProcess || {}) as Dict;
  const account = (load.data.account || {}) as Dict;
  const mins = (ms: unknown) => (num(ms) === null ? '—' : Number(ms) < 60000
    ? t('hlSeconds', { n: shown(Math.round(Number(ms) / 1000)) }) : t('hlMinutes', { n: shown(Math.floor(Number(ms) / 60000)) }));
  return (
    <div className="space-y-4">
      <Card title={`${t('hlTitle')} — ${t('hlPanel')}`} icon={<Activity size={16} />} action={<ActionButton onClick={load.reload}>{t('refresh')}</ActionButton>}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label={t('hlPanelVersion')} value={<span dir="ltr">{String(p.version || '—')}</span>} sub={`${t('hlUptime')} ${moment(p.startedAt)}`} />
          <Stat label={t('hlBridge')} value={<><StatePill s={bridge.status} t={t} /> <span dir="ltr">{shown(bridge.latencyMs)} ms</span></>}
                sub={bridge.error ? <code dir="ltr">{String(bridge.error)}</code> : `≤${shown((panel.limits as Dict)?.bridgeWarnMs)} ms ${t('st_ok')}`} />
          <Stat label={t('hlAccountProc')} value={proc.managed ? <StatePill s={proc.status} t={t} /> : <span className="text-xs text-ink-muted">{t('hlNotManaged')}</span>}
                sub={proc.managed ? `${t('hlRestarts')}: ${shown(proc.restarts)} · ${mins(proc.uptimeMs)}` : undefined} />
        </div>
        <SourceLine source="panel probes · GET /api/admin/me" data={{ fetchedAt: panel.checkedAt }} at={load.at} />
      </Card>
      <Card title={`${t('hlTitle')} — ${t('hlAccount')}`} icon={<Server size={16} />}>
        {account.available === false ? (
          account.capability ? <NotAvail data={account} t={t} /> : <Notice tone="bad">{t('hlBridgeDown')} — <code dir="ltr">{String(account.error || '')}</code> {String(account.message || '')}</Notice>
        ) : (() => {
          const server = (account.server || {}) as Dict;
          const se = (account.serverErrors || {}) as Dict;
          const loop = (account.eventLoop || {}) as Dict;
          const sync = arr<Dict>((account.sync as Dict)?.apps);
          return (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2"><StatePill s={account.status} t={t} />
                {Object.entries((account.parts || {}) as Record<string, string>).map(([k, v]) => <span key={k} className="text-[11px]">{k}: <StatePill s={v} t={t} /></span>)}</div>
              <div className="grid gap-3 sm:grid-cols-4">
                <Stat label={t('hlServerVersion')} value={<span dir="ltr">{String(server.version || '—')}</span>} sub={`${t('hlUptime')} ${mins(num(server.uptimeSeconds) === null ? null : Number(server.uptimeSeconds) * 1000)}`} />
                <Stat label={t('hlMemory')} value={bytes(server.rssBytes)} sub={String(server.driver || '—')} />
                <Stat label={t('hlServerErrors')} value={`${shown(se.lastHour)} / ${shown(se.last24h)}`} tone={se.status === 'warn' ? 'warn' : undefined}
                      sub={`${t('hlLastHour')} / ${t('hl24h')} · ${t('hlDropped')}: ${shown(se.dropped)}`} />
                <Stat label={t('hlLoop')} value={num(loop.p99Ms) === null ? '—' : `${shown(loop.p99Ms)} ms`} sub={<StatePill s={loop.status} t={t} />} />
              </div>
              <h4 className="mb-2 mt-4 text-xs font-semibold">{t('hlJobs')}</h4>
              <Table head={[t('hlJob'), t('incStatus'), t('hlEvery'), t('hlLastOk'), t('hlLastRun'), t('hlLastError')]} empty={arr(account.jobs).length === 0}>
                {arr<Dict>(account.jobs).map((j) => (
                  <Row key={String(j.name)}>
                    <Cell mono>{String(j.name)}</Cell>
                    <Cell><StatePill s={j.status} t={t} />{j.status === 'unknown' && <span className="ms-1 text-[11px] text-ink-muted">{t('hlNotStarted')}</span>}</Cell>
                    <Cell>{num(j.everyMs) ? mins(j.everyMs) : '—'}</Cell>
                    <Cell>{moment(j.lastOkAt)}</Cell><Cell>{moment(j.lastRunAt)}</Cell>
                    <Cell mono>{String(j.lastError || '—')}</Cell>
                  </Row>
                ))}
              </Table>
              <h4 className="mb-2 mt-4 text-xs font-semibold">{t('hlSync')}</h4>
              <Table head={[t('hlApp'), t('hlSync'), t('hlActive24h'), t('hlSyncErr24h')]} empty={sync.length === 0}>
                {sync.map((s) => (
                  <Row key={String(s.app)}><Cell mono>{String(s.app)}</Cell><Cell>{moment(s.lastOkAt)}</Cell><Cell>{shown(s.activeDevices24h)}</Cell><Cell>{shown(s.errors24h)}</Cell></Row>
                ))}
              </Table>
              <Definitions defs={account.definitions} t={t} />
              <SourceLine source="/api/admin/ops/health" data={account} at={load.at} />
            </>
          );
        })()}
      </Card>
    </div>
  );
}

export function OpsHealthTab() {
  return (
    <div className="space-y-4">
      <HealthBoard />
      {/* همان کارت‌های فاز ۲ (دیتابیس، صف‌ها، دیسک، پشتیبان، وارسیِ زنجیره، خطاهای خامِ برنامه) */}
      <HealthTab />
    </div>
  );
}

/* ═════════════════════════════ ۴.۱۰ رخدادها ═════════════════════════════ */

type Incident = { id: string; source: string; app: string; title: string; kind: string; status: string; priority: string;
  firstSeenAt: number; lastSeenAt: number; occurrences: number; recent1h?: number; lastVersion: string; supportThreadId: string; version: number };
const INC_PAGE = 25;

async function downloadCsv(path: string) {
  //  ⛔ توکن در سرآیند، نه در نشانی (‎?token=‎ در لاگ می‌ماند)
  const res = await fetch(path, { headers: { Authorization: `Bearer ${getToken() || ''}` } });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new ApiError(res.status, j?.error || 'request_failed', j?.message);
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `incidents-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function IncidentDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const t = useOpsT();
  const { can } = useApp();
  const load = useLoad<Dict>(`${BASE}/ops/incidents/${encodeURIComponent(id)}`);
  const [status, setStatus] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [note, setNote] = useState('');
  const [priority, setPriority] = useState('');
  const [reason, setReason] = useState('');
  const [thread, setThread] = useState<string | null>(null);
  const [noteKey, setNoteKey] = useState(() => newIdemKey());
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad' | 'warn'; text: string } | null>(null);
  const inc = (load.data?.incident || null) as Incident | null;
  const act = async (fn: () => Promise<unknown>, after?: () => void) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: 'good', text: t('serverConfirmed') });
      after?.();
      void load.reload();
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'incident_changed') { setMsg({ tone: 'warn', text: t('incChanged') }); void load.reload(); return; }
      setMsg({ tone: 'bad', text: errText(e) });
    }
  };
  const canWrite = can('operator');
  return createPortal(
    <Modal open onClose={onClose} title={`${t('incDetail')} ${inc ? `· ${inc.id}` : ''}`}>
      <div className="space-y-3 text-sm">
        {load.error ? <Problem load={load as Load<unknown>} /> : !load.data ? <Loading /> : isUnavailable(load.data) ? <NotAvail data={load.data as Dict} t={t} /> : inc && (
          <>
            <p className="font-medium">{inc.title}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              <Pill tone={inc.status === 'resolved' ? 'ok' : inc.status === 'investigating' ? 'warn' : 'down'}>{t(`inc_${inc.status}` as OpsKey)}</Pill>
              <Pill tone={inc.priority === 'p1' ? 'down' : inc.priority === 'p2' ? 'warn' : 'unknown'}>{inc.priority}</Pill>
              <span>{inc.source === 'server' ? t('incServer') : t('incClient')} · <code dir="ltr">{inc.app}</code></span>
              <span>{t('incCount')}: {shown(inc.occurrences)}</span>
            </div>
            <KV label={`${t('incFirst')} · ${t('incLastSeen')}`}>{moment(inc.firstSeenAt)} · {moment(inc.lastSeenAt)}</KV>
            <KV label={t('incSpread')}>{shown((load.data.spread as Dict)?.shops)} · {shown((load.data.spread as Dict)?.devices)}</KV>
            <KV label={t('incVersions')} mono>{arr<Dict>(load.data.versions).map((v) => `${v.version || '?'}×${v.count}`).join('  ') || '—'}</KV>
            <KV label={t('incSupport')}>{load.data.support ? `${String((load.data.support as Dict).subject || '—')} (${String((load.data.support as Dict).status || '—')})` : '—'}</KV>
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
            {canWrite && (
              <div className="grid gap-3 rounded border border-line p-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="block text-xs">{t('incChangeStatus')}
                    <select className="input mt-1 w-full" value={status || inc.status} onChange={(e) => setStatus(e.target.value)}>
                      {['open', 'investigating', 'resolved'].map((s) => <option key={s} value={s}>{t(`inc_${s}` as OpsKey)}</option>)}
                    </select></label>
                  <input className="input w-full" placeholder={t('incNote')} maxLength={1000} value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
                  <ActionButton disabled={!status || status === inc.status} onClick={() => act(() => api(`${BASE}/ops/incidents/${inc.id}/status`,
                    { method: 'POST', body: { status, note: statusNote.trim(), expectedVersion: inc.version } }), () => { setStatus(''); setStatusNote(''); })}>{t('save')}</ActionButton>
                </div>
                <div className="space-y-1">
                  <label className="block text-xs">{t('incChangePriority')}
                    <select className="input mt-1 w-full" value={priority || inc.priority} onChange={(e) => setPriority(e.target.value)}>
                      {['p1', 'p2', 'p3', 'p4'].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select></label>
                  <input className="input w-full" placeholder={t('reason')} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
                  <ActionButton disabled={!priority || priority === inc.priority} onClick={() => act(() => api(`${BASE}/ops/incidents/${inc.id}/priority`,
                    { method: 'POST', body: { priority, reason: reason.trim(), expectedVersion: inc.version } }), () => { setPriority(''); setReason(''); })}>{t('save')}</ActionButton>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <textarea className="input w-full" rows={2} maxLength={1000} placeholder={t('incNote')} value={note} onChange={(e) => setNote(e.target.value)} />
                  {/* ⛔ یک کلیدِ یکتایی برای هر یادداشت ⇒ دوبار زدن یک یادداشت است */}
                  <ActionButton disabled={note.trim().length < 2} onClick={() => act(() => api(`${BASE}/ops/incidents/${inc.id}/notes`,
                    { method: 'POST', body: { note: note.trim(), idempotencyKey: noteKey } }), () => { setNote(''); setNoteKey(newIdemKey()); })}>{t('incAddNote')}</ActionButton>
                </div>
                <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
                  <label className="block flex-1 text-xs">{t('incSupportId')}
                    <input className="input mt-1 w-full" dir="ltr" value={thread ?? inc.supportThreadId} onChange={(e) => setThread(e.target.value)} /></label>
                  <ActionButton disabled={thread === null} onClick={() => act(() => api(`${BASE}/ops/incidents/${inc.id}/link`,
                    { method: 'POST', body: { supportThreadId: (thread || '').trim() } }), () => setThread(null))}>{t('incLink')}</ActionButton>
                </div>
              </div>
            )}
            <h4 className="text-xs font-semibold">{t('incOccurrences')}</h4>
            <p className="text-[11px] text-ink-muted">{t('incNoSecrets')}</p>
            <Table head={[t('incAt'), t('incService'), t('incVersion'), t('incShop'), t('incDevice'), t('incMessage')]} empty={arr(load.data.occurrences).length === 0}>
              {arr<Dict>(load.data.occurrences).map((o) => (
                <Row key={String(o.id)}>
                  <Cell>{moment(o.at)}</Cell>
                  <Cell mono>{String(o.service || '—')}{o.location ? ` @${String(o.location)}` : ''}</Cell>
                  <Cell mono>{String(o.version || '—')}</Cell>
                  <Cell mono>{String(o.shopId || '—')}</Cell>
                  <Cell mono>{String(o.device || '—')}{o.isCrashReport ? ` · ${t('incCrash')}` : ''}</Cell>
                  <Cell className="max-w-[20rem] truncate">{String(o.message || '—')}</Cell>
                </Row>
              ))}
            </Table>
            <h4 className="text-xs font-semibold">{t('incHistory')}</h4>
            <ul className="space-y-1 text-xs">
              {arr<Dict>(load.data.events).map((e) => (
                <li key={String(e.id)}>
                  <span className="text-ink-muted">{moment(e.at)}</span> · <b>{t(`ev_${String(e.kind)}` as OpsKey)}</b>
                  {(e.from || e.to) ? <span dir="ltr"> {String(e.from || '∅')} → {String(e.to || '∅')}</span> : null}
                  {e.note ? <span> — {String(e.note)}</span> : null} <span className="text-ink-muted">({String(e.actor || '—')})</span>
                </li>
              ))}
            </ul>
            <SourceLine source={`/api/admin/ops/incidents/${inc.id}`} data={load.data} at={load.at} />
          </>
        )}
      </div>
    </Modal>,
    document.body,
  );
}

export function IncidentsTab({ shop: initialShop = '' }: { shop?: string }) {
  const t = useOpsT();
  const { can } = useApp();
  const [q, setQ] = useState('');
  const [f, setF] = useState({ q: '', status: 'live', source: '', priority: '', shop: initialShop, version: '', sort: 'last' });
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const path = `${BASE}/ops/incidents?${qs({ ...f, limit: INC_PAGE, offset })}`;
  const load = useLoad<Dict>(path, [path]);
  const rows = arr<Incident>(load.data?.incidents);
  const total = num(load.data?.total);
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setOffset(0); };
  return (
    <div className="space-y-4">
      <Card title={t('incTitle')} icon={<FileWarning size={16} />}
            action={can('admin') ? <ActionButton onClick={async () => { setErr(''); try { await downloadCsv(`${BASE}/ops/incidents.csv?${qs({ ...f })}`); } catch (e) { setErr(errText(e)); } }}>{t('incExport')}</ActionButton> : undefined}>
        <form className="mb-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); set('q', q.trim()); }}>
          <input className="input w-full sm:w-56" placeholder={t('incSearch')} value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn-sm" type="submit">{t('show')}</button>
          <select className="input w-auto" value={f.status} onChange={(e) => set('status', e.target.value)}>
            <option value="live">{t('incLive')}</option><option value="">{t('incAllStatus')}</option>
            {['open', 'investigating', 'resolved'].map((s) => <option key={s} value={s}>{t(`inc_${s}` as OpsKey)}</option>)}
          </select>
          <select className="input w-auto" value={f.source} onChange={(e) => set('source', e.target.value)}>
            <option value="">{t('incAllSources')}</option><option value="server">{t('incServer')}</option><option value="client">{t('incClient')}</option>
          </select>
          <select className="input w-auto" value={f.priority} onChange={(e) => set('priority', e.target.value)}>
            <option value="">{t('incAllPriorities')}</option>{['p1', 'p2', 'p3', 'p4'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input className="input w-36" dir="ltr" placeholder={t('incShop')} value={f.shop} onChange={(e) => set('shop', e.target.value.trim())} />
          <input className="input w-28" dir="ltr" placeholder={t('incVersion')} value={f.version} onChange={(e) => set('version', e.target.value.trim())} />
          <select className="input w-auto" value={f.sort} onChange={(e) => set('sort', e.target.value)}>
            <option value="last">{t('incSortLast')}</option><option value="count">{t('incSortCount')}</option><option value="priority">{t('incSortPriority')}</option>
          </select>
        </form>
        {err && <Notice tone="bad">{err}</Notice>}
        {load.error ? <Problem load={load as Load<unknown>} /> : !load.data ? <Loading /> : isUnavailable(load.data) ? <NotAvail data={load.data as Dict} t={t} /> : (
          <>
            <Table head={[t('incStatus'), t('incPriority'), t('incTitleCol'), t('incCount'), t('inc1h'), t('incLastSeen'), t('incVersion')]} empty={rows.length === 0}>
              {rows.map((r) => (
                <Row key={r.id} onClick={() => setOpen(r.id)}>
                  <Cell><Pill tone={r.status === 'resolved' ? 'ok' : r.status === 'investigating' ? 'warn' : 'down'}>{t(`inc_${r.status}` as OpsKey)}</Pill></Cell>
                  <Cell mono>{r.priority}</Cell>
                  <Cell className="max-w-[24rem] truncate">{r.source === 'server' ? '🖥 ' : '📱 '}{r.title}</Cell>
                  <Cell>{shown(r.occurrences)}</Cell><Cell>{shown(r.recent1h)}</Cell>
                  <Cell>{moment(r.lastSeenAt)}</Cell><Cell mono>{r.lastVersion || '—'}</Cell>
                </Row>
              ))}
            </Table>
            <div className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
              <button className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - INC_PAGE))}>{t('prev')}</button>
              <button className="btn btn-sm" disabled={total === null || offset + rows.length >= total} onClick={() => setOffset(offset + INC_PAGE)}>{t('next')}</button>
              <span>{t('rows', { from: shown(rows.length ? offset + 1 : 0), to: shown(offset + rows.length) })} · {t('of')} {shown(total)}</span>
            </div>
            <SourceLine source="/api/admin/ops/incidents (client_errors + server_errors)" data={load.data} at={load.at} />
          </>
        )}
      </Card>
      {open && <IncidentDetail id={open} onClose={() => setOpen(null)} onChanged={() => void load.reload()} />}
    </div>
  );
}

/* ═════════════════════════════ ۴.۱۱ هشدارها ═════════════════════════════ */

type Alert = { id: string; rule: string; target: string; severity: string; status: string; title: string; occurrences: number;
  firstSeenAt: number; lastSeenAt: number; liveSince: number; acknowledgedBy: string; resolution: string; resolvedBy: string; resolveReason: string };
const RULES = ['subscription_expiring', 'shop_disconnected', 'repeated_errors', 'service_down', 'payment_failed', 'order_stuck',
  'settlement_mismatch', 'version_incompatible', 'admin_suspicious'];
const ruleLabel = (t: T, r: string) => (RULES.includes(r) ? t(`rule_${r}` as OpsKey) : r);

function TelegramChannel() {
  const t = useOpsT();
  const { can } = useApp();
  const load = useLoad<Dict>(`${BASE}/ops/alerts/telegram`);
  const [types, setTypes] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  if (load.error) return <Problem load={load as Load<unknown>} />;
  if (!load.data) return <Loading />;
  const bot = (load.data.bot || {}) as Dict;
  const cur = types ?? arr<string>(load.data.types);
  const ready = bot.enabled === true && bot.hasToken === true && bot.chatSet === true;
  return (
    <div className="space-y-2 text-sm">
      <KV label={t('alTelegram')}>{ready ? <Pill tone={bot.ownerLoggedIn ? 'ok' : 'warn'}>{bot.ownerLoggedIn ? t('st_ok') : t('st_warn')}</Pill> : <span className="text-ink-muted">{t('alTelegramOff')}</span>}</KV>
      <p className="text-[11px] text-ink-muted">{t('alTelegramNote')}</p>
      <div className="grid gap-1 sm:grid-cols-3">
        {arr<string>(load.data.rules).map((r) => (
          <label key={r} className="flex items-center gap-2 text-xs">
            <input type="checkbox" disabled={!can('admin')} checked={cur.includes(r)}
                   onChange={(e) => setTypes(e.target.checked ? [...cur, r] : cur.filter((x) => x !== r))} />
            {ruleLabel(t, r)}
          </label>
        ))}
      </div>
      {can('admin') ? (
        <ActionButton disabled={types === null} onClick={async () => {
          setMsg(null);
          try { await api(`${BASE}/ops/alerts/telegram`, { method: 'PUT', body: { types: cur } }); setTypes(null); setMsg({ tone: 'good', text: t('savedPanel') }); void load.reload(); }
          catch (e) { setMsg({ tone: 'bad', text: errText(e) }); }
        }}>{t('save')}</ActionButton>
      ) : <p className="text-[11px] text-ink-muted">{t('adminOnly')}</p>}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <KV label={t('alSms')}><span className="text-ink-muted">{t('alFuture')}</span></KV>
      <KV label={t('alEmail')}><span className="text-ink-muted">{t('alFuture')}</span></KV>
    </div>
  );
}

export function AlertsTab() {
  const t = useOpsT();
  const { can } = useApp();
  const [status, setStatus] = useState('live');
  const [severity, setSeverity] = useState('');
  const [offset, setOffset] = useState(0);
  const [resolveOf, setResolveOf] = useState<Alert | null>(null);
  const [ackOf, setAckOf] = useState<Alert | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const path = `${BASE}/ops/alerts?${qs({ status, severity, limit: 50, offset })}`;
  const load = useLoad<Dict>(path, [path]);
  const rows = arr<Alert>(load.data?.alerts);
  const total = num(load.data?.total);
  const evaluation = (load.data?.evaluation || {}) as Dict;
  const evalRules = arr<Dict>(evaluation.rules);
  const close = () => { setResolveOf(null); setAckOf(null); setText(''); };
  const send = async () => {
    const a = resolveOf || ackOf;
    if (!a || busy) return;
    setBusy(true); setMsg(null);
    try {
      if (resolveOf) await api(`${BASE}/ops/alerts/${a.id}/resolve`, { method: 'POST', body: { reason: text.trim() } });
      else await api(`${BASE}/ops/alerts/${a.id}/ack`, { method: 'POST', body: { note: text.trim() } });
      setMsg({ tone: 'good', text: t('serverConfirmed') });
      close();
      void load.reload();
    } catch (e) { setMsg({ tone: 'bad', text: errText(e) }); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <Card title={t('alTitle')} icon={<BellRing size={16} />}
            action={can('operator') ? <ActionButton onClick={async () => { setMsg(null); try { await api(`${BASE}/ops/alerts/evaluate`, { method: 'POST', body: {} }); void load.reload(); } catch (e) { setMsg({ tone: 'bad', text: errText(e) }); } }}>{t('alEvaluate')}</ActionButton> : undefined}>
        <div className="mb-3 flex flex-wrap gap-2">
          <select className="input w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}>
            <option value="live">{t('alLive')}</option>
            {['open', 'acknowledged', 'resolved'].map((s) => <option key={s} value={s}>{t(`al_${s}` as OpsKey)}</option>)}
          </select>
          <select className="input w-auto" value={severity} onChange={(e) => { setSeverity(e.target.value); setOffset(0); }}>
            <option value="">{t('alAllSeverity')}</option>
            {['critical', 'high', 'medium', 'low'].map((s) => <option key={s} value={s}>{t(`sev_${s}` as OpsKey)}</option>)}
          </select>
        </div>
        <p className="mb-2 text-[11px] text-ink-muted">{t('alDedup')}</p>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {load.error ? <Problem load={load as Load<unknown>} /> : !load.data ? <Loading /> : isUnavailable(load.data) ? <NotAvail data={load.data as Dict} t={t} /> : (
          <>
            <Table head={[t('alSeverity'), t('alRule'), t('incTitleCol'), t('alSince'), t('alSeen'), t('incStatus'), '']} empty={rows.length === 0}>
              {rows.map((a) => (
                <Row key={a.id}>
                  <Cell><Pill tone={SEV_TONE[a.severity] || 'unknown'}>{t(`sev_${a.severity}` as OpsKey)}</Pill></Cell>
                  <Cell>{ruleLabel(t, a.rule)}</Cell>
                  <Cell className="max-w-[22rem] truncate">{a.title}</Cell>
                  <Cell>{moment(a.liveSince)}</Cell>
                  <Cell>{shown(a.occurrences)}</Cell>
                  <Cell>{t(`al_${a.status}` as OpsKey)}{a.status === 'resolved' ? <span className="text-[11px] text-ink-muted"> · {a.resolution === 'auto' ? t('alAuto') : `${t('alByHand')} ${a.resolvedBy}`}</span> : a.acknowledgedBy ? <span className="text-[11px] text-ink-muted"> · {a.acknowledgedBy}</span> : null}</Cell>
                  <Cell>{can('operator') && a.status !== 'resolved' && (
                    <span className="flex gap-1">
                      {a.status === 'open' && <button className="btn btn-sm" onClick={() => { setText(''); setAckOf(a); }}>{t('alAck')}</button>}
                      <button className="btn btn-sm" onClick={() => { setText(''); setResolveOf(a); }}>{t('alResolve')}</button>
                    </span>
                  )}</Cell>
                </Row>
              ))}
            </Table>
            <div className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
              <button className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>{t('prev')}</button>
              <button className="btn btn-sm" disabled={total === null || offset + rows.length >= total} onClick={() => setOffset(offset + 50)}>{t('next')}</button>
              <span>{t('of')} {shown(total)} · {t('alEvaluated')}: {moment(evaluation.evaluatedAt)}</span>
            </div>
            <SourceLine source="/api/admin/ops/alerts" data={load.data} at={load.at} />
          </>
        )}
      </Card>
      <Card title={t('alRules')} icon={<ShieldAlert size={16} />}>
        {!load.data || isUnavailable(load.data) ? <Loading /> : (
          <Table head={[t('alRule'), t('alSeverity'), t('alRuleState'), t('alFindings'), '']} empty={false}>
            {arr<Dict>(load.data.definitions).map((d) => {
              const r = evalRules.find((x) => x.id === d.id) || {};
              return (
                <Row key={String(d.id)}>
                  <Cell><b>{ruleLabel(t, String(d.id))}</b><span className="block text-[11px] text-ink-muted">{String(d.what || '')}</span></Cell>
                  <Cell>{t(`sev_${String(d.severity)}` as OpsKey)}</Cell>
                  <Cell>{r.state ? <Pill tone={r.state === 'ok' ? 'ok' : r.state === 'unavailable' ? 'unknown' : 'down'}>{t(`rs_${String(r.state)}` as OpsKey)}</Pill> : '—'}</Cell>
                  <Cell>{shown(r.findings)}</Cell>
                  <Cell className="text-[11px]">{String(r.reason || '')}</Cell>
                </Row>
              );
            })}
          </Table>
        )}
      </Card>
      <Card title={t('alChannels')} icon={<BellRing size={16} />}><TelegramChannel /></Card>
      <Dialog open={Boolean(resolveOf || ackOf)} title={resolveOf ? t('alResolve') : t('alAck')} onClose={close} onSend={send} busy={busy}
              ready={resolveOf ? reasonOk(text) : true}>
        <p>{(resolveOf || ackOf)?.title}</p>
        <label className="block text-xs">{resolveOf ? t('reason') : t('alAckNote')}
          <textarea className="input mt-1 w-full" rows={2} maxLength={resolveOf ? 200 : 300} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      </Dialog>
    </div>
  );
}

/* ═════════════════════════════ ۴.۱۳ یکپارچه‌سازی ═════════════════════════════ */

function IntegrationsBoard() {
  const t = useOpsT();
  const load = useLoad<Dict>(`${BASE}/ops/integrations`);
  const panel = (load.data?.panel || {}) as Dict;
  const gateway = (panel.gateway || {}) as Dict;
  const tg = (panel.telegram || null) as Dict | null;
  return (
    <Block title={t('itTitle')} icon={<KeyRound size={16} />} source="/api/admin/ops/integrations" load={load}>
      {(d) => {
        const policies = (d.policies || {}) as Dict;
        const rl = (policies.rateLimit || {}) as Dict;
        const ob = (policies.emailOutbox || null) as Dict | null;
        const al = (policies.alerts || {}) as Dict;
        const contracts = (d.contracts || {}) as Dict;
        const sk = (d.serviceKeys || {}) as Dict;
        const rotateOf = (c: Dict) => (c.rotate === 'env' ? t('itRotateEnv') : String(c.rotate || '—'));
        const mins = (ms: unknown) => (num(ms) === null ? '—' : t('hlMinutes', { n: shown(Math.round(Number(ms) / 60000)) }));
        return (
          <div className="space-y-4">
            <div>
              <h4 className="mb-2 text-xs font-semibold">{t('itActivity')}</h4>
              <Table head={[t('itService'), t('itState'), t('itLastOk'), t('itLastFail'), t('itOk24'), t('itFail24'), t('itErrCode')]} empty={arr(d.providers).length === 0}>
                {arr<Dict>(d.providers).map((p) => {
                  const a = (p.activity || null) as Dict | null;
                  return (
                    <Row key={String(p.id)}>
                      <Cell mono>{String(p.id)}</Cell>
                      <Cell><Pill tone={p.state === 'live' ? 'ok' : p.state === 'incomplete' ? 'down' : p.state === 'mock' ? 'warn' : 'unknown'}>{String(p.state || '—')}</Pill></Cell>
                      <Cell>{moment(a?.lastOkAt)}</Cell><Cell>{moment(a?.lastFailAt)}</Cell>
                      <Cell>{shown(a?.ok24h)}</Cell><Cell>{shown(a?.fail24h)}</Cell><Cell mono>{String(a?.lastErrorCode || '—')}</Cell>
                    </Row>
                  );
                })}
              </Table>
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold">{t('itCreds')}</h4>
              <Table head={[t('itCred'), t('itService'), t('itState'), t('itRotate')]} empty={arr(d.credentials).length === 0}>
                {arr<Dict>(d.credentials).map((c) => (
                  <Row key={String(c.id)}>
                    <Cell mono>{String(c.id)}</Cell><Cell mono>{String(c.service)}</Cell>
                    <Cell>{c.set ? <Pill tone="ok">{t('set')}</Pill> : <Pill tone="unknown">{t('notSet')}</Pill>}</Cell>
                    <Cell className="text-[11px]">{rotateOf(c)}</Cell>
                  </Row>
                ))}
              </Table>
              <p className="mt-1 text-[11px] text-ink-muted">{t('itRotateKey')} · {t('itRotateApps')}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label={t('itServiceKeys')} value={sk.available === false ? '—' : `${shown(sk.active)} ${t('itActive')}`} sub={`${shown(sk.revoked)} ${t('itRevoked')} · ${t('itLastUsed')}: ${moment(sk.lastUsedAt)}`} />
              <Stat label={t('itTelegramBot')} value={tg ? (tg.enabled && tg.hasToken ? <Pill tone={tg.ownerLoggedIn ? 'ok' : 'warn'}>{tg.ownerLoggedIn ? t('st_ok') : t('st_warn')}</Pill> : t('notSet')) : '—'} />
              <Stat label={t('itGateway')} value={gateway.paymentsWebhookForwarded ? t('yes') : t('no')} sub="/api/payments/*" tone={gateway.paymentsWebhookForwarded ? undefined : 'warn'} />
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold">{t('itWebhooks')}</h4>
              {arr<Dict>(d.webhooks).map((w) => (
                <div key={String(w.id)} className="rounded border border-line p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2"><b>{String(w.id)}</b>
                    <Pill tone={w.state === 'live' ? 'ok' : w.state === 'blocked' ? 'down' : 'unknown'}>{t(`wh_${['live', 'blocked'].includes(String(w.state)) ? String(w.state) : 'unknown'}` as OpsKey)}</Pill>
                    <code dir="ltr">{String(w.path || '')}</code> <code dir="ltr" className="text-ink-muted">{String(w.reason || '')}</code></div>
                  <KV label={t('itRoute')}>{w.routePresent ? t('yes') : t('no')} <span className="text-ink-muted">{String(w.needs || '')}</span></KV>
                  <KV label={t('itGateway')}>{gateway.paymentsWebhookForwarded ? t('yes') : t('no')}</KV>
                  <KV label={t('itSecret')}>{w.signatureSecretSet ? t('set') : t('notSet')}</KV>
                  <KV label={`${t('itLastReceived')} · ${t('itReceived24')} · ${t('itProblems24')}`}>{moment(w.lastReceivedAt)} · {shown(w.received24h)} · {shown(w.problems24h)}</KV>
                  {w.id === 'hesabpay' && w.state !== 'live' && <Notice tone="warn">{t('itBlockedHesab')}</Notice>}
                </div>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <h4 className="mb-2 text-xs font-semibold">{t('itContracts')}</h4>
                <KV label={t('relApiVersion')} mono>{String(contracts.api || '—')}</KV>
                <KV label={t('relSchema')} mono>{String((contracts.schema as Dict)?.migration || '—')}</KV>
                <KV label="sync" mono>{arr<string>(contracts.sync).join(' · ') || '—'}</KV>
                <KV label="admin" mono>{arr<string>(contracts.adminBasePaths).join(' · ') || '—'}</KV>
                <KV label={t('itBridgeRetry')} mono>{String((panel.bridge as Dict)?.contract || '—')}</KV>
              </div>
              <div>
                <h4 className="mb-2 text-xs font-semibold">{t('itPolicies')}</h4>
                <KV label={t('itRateWindow')}>{mins(rl.windowMs)}</KV>
                <KV label={t('itAuthMax')}>{shown(rl.authMax)}</KV>
                <KV label={t('itOtpMax')}>{shown(rl.otpMax)}</KV>
                <KV label={t('itLockout')}>{shown(rl.lockoutTries)} · {mins(rl.lockoutMs)}</KV>
                <KV label={t('itClientErr')}>{shown(rl.clientErrorsPerWindow)}</KV>
                <KV label={t('itOutbox')}>{ob ? `${shown(ob.maxAttempts)} · ${shown(ob.backoffMs)}ms · ${shown(ob.timeoutMs)}ms` : '—'}</KV>
                <KV label={t('itServerErr')}>{shown(policies.serverErrorsPerMinute)}</KV>
                <KV label={t('itAlertsCap')}>{mins(al.evaluateEveryMs)} · {shown(al.maxNewPerRun)} · {shown(al.maxPerRule)}</KV>
                <KV label={t('itBridgeRetry')}>{String((panel.bridge as Dict)?.retry || '—')}</KV>
              </div>
            </div>
          </div>
        );
      }}
    </Block>
  );
}

export function IntegrationsOpsTab() {
  return (
    <div className="space-y-4">
      {/* فاز ۲: کلیدِ سرویسِ پل (ساختن/چرخش/ابطال — مالک + احرازِ دوباره)، حالتِ سرویس‌ها، برنامه‌های مدیریت‌شده */}
      <IntegrationsTab />
      <IntegrationsBoard />
    </div>
  );
}

/** برچسبِ زبانه‌های تازه برای ‎ShopDesk‎ (بی دست زدن به ‎i18n.ts‎ ِ مشترک). */
export function useOpsTabLabels() {
  const t = useOpsT();
  return { incidents: t('tabIncidents'), alerts: t('tabAlerts') };
}
