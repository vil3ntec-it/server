// ---------------------------------------------------------------------------
//  🏪 کنسولِ فروشگاه — زبانه‌های فاز ۲ ِ پنلِ مرکزیِ مالک (OWNER-CONSOLE-AUDIT §۴ و §۸)
//
//  فروشگاه‌ها · مالی · نسخه‌ها · سلامت و خطاها · تنظیمات و پرچم‌ها · یکپارچه‌سازی · دفترِ رخداد
//  (+ کارتِ سلامت در داشبورد). همه **فقط‌خواندنی**، جز «وارسیِ زنجیرهٔ سابقه» که فقط می‌سنجد.
//
//  ⛔ هر عدد از سرورِ حساب، از راهِ پلِ فهرست‌سفیدِ ‎/api/account-admin/console/*‎؛ هیچ عددی این‌جا ساخته
//     یا جمع نمی‌شود. نیامده ⇒ «—» (`consoleData.ts`)، نه صفر.
//  ⛔ زیرِ هر کارت **منبع و زمان**: کدام درِ سرورِ حساب، و «سنجیدهٔ سرورِ حساب» یا «رسیده به پنل» —
//     هرگز ساعتِ مرورگر به‌جای زمانِ داده.
//  ⛔ خطای بالادست با **کدِ خودش** دیده می‌شود (`db_unavailable`، `account_server_outdated`…)، نه «نشد».
//  ⛔ فاز ۳ (shop) نیامده ⇒ «داده در دسترس نیست» با دلیل و نامِ توانایی؛ همان در، روزی که سرورِ حساب
//     توانایی را اعلام کرد، داده می‌آورد — بی به‌روزرسانیِ پنل.
//  ⛔ مجوز در سرور است؛ پنهان کردنِ یک کارت برای viewer فقط برای این است که درخواستِ بی‌نتیجه نزند.
// ---------------------------------------------------------------------------
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Boxes, FileClock, Flag, HeartPulse, Plug, ShieldCheck, Store, Wallet } from 'lucide-react';

import { api, ApiError } from '../../api';
import { Card, ConfirmDialog, Loading } from '../../components/ui';
import { useApp } from '../../app-context';
import type { Dict } from '../../i18n';
import { ActionButton, Cell, KV, Notice, Row, Stat, Table } from '../../control/ui';
import { CloudProblem, useLoad, type Load } from './shared';
import Sales from './Sales';
import {
  CONSOLE, bytes, healthTone, isUnavailable, minutesAgo, num, providerTone, shown, stampOf,
  type AppVersions, type ChainReport, type Flags, type LiveConfig, type Providers, type ReleaseBeta,
  type ShopHealth, type ShopSuspension, type SystemHealth, type Unavailable, type VersionHealth, type Versions,
} from './consoleData';

type T = (key: keyof Dict) => string;

const moment = (ms: unknown) => {
  const n = num(ms);
  return n && n > 0 ? new Date(n).toLocaleString('fa-AF', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
};

const TONE: Record<string, string> = {
  good: 'var(--status-good)', warn: 'var(--status-warning)', bad: 'var(--status-critical)', neutral: 'var(--text-muted)',
};

/* ───────────────────────────── تکه‌های مشترک ───────────────────────────── */

/** «منبع: … · سنجیدهٔ سرورِ حساب ۱۲:۳۰ (۳ دقیقه پیش)» — زیرِ هر کارت. */
export function SourceLine({ source, data, at }: { source: string; data?: unknown; at?: number | null }) {
  const { t } = useApp();
  //  سنجیدهٔ سرورِ حساب ⇐ رسیده به پنل ⇐ رسیده به همین صفحه؛ هیچ‌کدام ⇒ «—»
  const stamp = stampOf(data) || (num(at) ? { at: Number(at), kind: 'page' as const } : null);
  const ago = stamp ? minutesAgo(stamp.at, Date.now()) : null;
  const label = !stamp ? '' : stamp.kind === 'server' ? t('scCheckedByServer') : stamp.kind === 'panel' ? t('scReceivedByPanel') : t('scReceivedByPage');
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-muted">
      <span>{t('scSource')}:</span>
      <code dir="ltr" className="font-mono">{source}</code>
      <span>·</span>
      <span>
        {stamp ? `${label} ${moment(stamp.at)}` : `${t('scUpdated')} —`}
        {ago !== null && ` (${t('scMinutesAgo').replace('{n}', shown(ago))})`}
      </span>
    </p>
  );
}

/** خطای بالادست با پیام و **کدِ خودش**؛ گذرا ⇒ خودش دوباره (همان `useLoad`). */
export function Problem({ load }: { load: Load<unknown> }) {
  const { t } = useApp();
  return (
    <div>
      <CloudProblem code={load.code} message={load.error || ''} onRetry={load.reload} />
      {load.code && (
        <p className="-mt-2 mb-3 text-[11px] text-ink-muted">
          {t('scErrorCode')}: <code dir="ltr" className="font-mono">{load.code}</code>
        </p>
      )}
    </div>
  );
}

/** «داده در دسترس نیست» — با دلیل و نامِ توانایی، نه عدد. */
export function NotAvailable({ data }: { data: Unavailable }) {
  const { t } = useApp();
  return (
    <Notice tone="warn">
      <b>{t('scNotAvailable')}</b> — {t('scNeedsPhase3')}
      <span className="mt-1 block text-[11px] text-ink-muted">
        {t('scCapability')}: <code dir="ltr" className="font-mono">{data.capability}</code> · <span dir="ltr">{data.needs}</span>
      </span>
    </Notice>
  );
}

function Pill({ tone, children }: { tone: string; children: ReactNode }) {
  const color = TONE[tone] || TONE.neutral;
  return (
    <span className="chip whitespace-nowrap" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}>
      {children}
    </span>
  );
}

/** رنگِ کارتِ `Stat` — «ناشناخته» بی رنگ، نه سبز. */
const statTone = (x: 'good' | 'warn' | 'bad' | 'neutral') => (x === 'neutral' ? undefined : x);

function statusLabel(t: T, s: unknown) {
  if (s === 'ok') return t('scStOk');
  if (s === 'warn') return t('scStWarn');
  if (s === 'down') return t('scStDown');
  return t('scStUnknown');
}

/** یک کارتِ خواندنی با حالت‌های بارگذاری/خطا و خطِ منبع. */
function Panel<D>({ title, icon, source, load, children, action }: {
  title: string; icon?: ReactNode; source: string; load: Load<D>; children: (d: D) => ReactNode; action?: ReactNode;
}) {
  return (
    <Card title={title} icon={icon} action={action}>
      {load.error ? <Problem load={load as Load<unknown>} /> : !load.data ? <Loading /> : (
        <>
          {children(load.data)}
          <SourceLine source={source} data={load.data} at={load.at} />
        </>
      )}
    </Card>
  );
}

/* ───────────────────────── داشبورد: کارتِ سلامت ───────────────────────── */

export function HealthCard() {
  const { t } = useApp();
  const load = useLoad<SystemHealth>(CONSOLE.health);
  const versions = useLoad<Versions>(CONSOLE.versions);
  const shop = (versions.data?.apps || []).find((a) => a.app === 'shop');
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title={t('scHealth')} icon={<HeartPulse size={16} />} source="/api/admin/system/health" load={load}>
        {(d) => (
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={healthTone(d.status)}>{statusLabel(t, d.status)}</Pill>
            <span className="text-xs text-ink-soft">
              {t('scApiVersion')}: <span dir="ltr">{d.api?.version || '—'}</span> · {t('scClientErrors24h')}: {shown(d.sync?.clientErrors24h)}
              {' '}· {t('scConflicts24h')}: {shown(d.sync?.conflicts24h)}
            </span>
            <Link className="text-xs underline" to="/shop?tab=health">{t('scMore')}</Link>
          </div>
        )}
      </Panel>
      <Panel title={t('scVersions')} icon={<Boxes size={16} />} source="/api/admin/system/versions" load={versions}>
        {() => (!shop ? <Notice>{t('scNoShopVersions')}</Notice> : (
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
            <Pill tone={healthTone(shop.status)}>{statusLabel(t, shop.status)}</Pill>
            {t('scDevices')}: {shown(shop.devices)} · {t('scBelowMin')}: {shown(shop.belowMin)} · {t('scOutdated')}: {shown(shop.outdated)}
            <Link className="underline" to="/shop?tab=versions">{t('scMore')}</Link>
          </div>
        ))}
      </Panel>
    </div>
  );
}

/* ─────────────────────────── زبانه: فروشگاه‌ها ─────────────────────────── */

type ShopRow = { id: string; name?: string; status?: string; owner_email?: string; owner_name?: string; members?: number;
                 sub_status?: string; plan?: string; ends_at?: number | string | null; created_at?: number | string };
type ShopList = { shops?: ShopRow[]; total?: number; limit?: number; offset?: number };
type SyncDevice = { device_id: string; app_version?: string; last_seen_at?: number; last_push_at?: number | null;
                    queued_count?: number; behind?: number; conflicts?: number };

const PAGE = 25;

function ShopDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useApp();
  const sync = useLoad<{ devices?: SyncDevice[] }>(`/api/account-admin/sync/status?app=shop&account=${encodeURIComponent(id)}&limit=50`, [id]);
  const health = useLoad<ShopHealth | Unavailable>(CONSOLE.shopHealth(id), [id]);
  const susp = useLoad<ShopSuspension | Unavailable>(CONSOLE.shopSuspension(id), [id]);
  const devices = Array.isArray(sync.data?.devices) ? sync.data!.devices! : [];
  return (
    <Card title={`${t('scShop')} ${id}`} icon={<Store size={16} />}
          action={<ActionButton onClick={onClose}>{t('close')}</ActionButton>}>
      <h3 className="mb-2 text-xs font-semibold">{t('scSyncDevices')}</h3>
      {sync.error ? <Problem load={sync as Load<unknown>} /> : !sync.data ? <Loading /> : (
        <>
          <Table head={[t('scDevice'), t('scAppVersion'), t('scLastSeen'), t('scLastPush'), t('scQueued'), t('scBehind'), t('scConflicts')]}
                 empty={devices.length === 0}>
            {devices.map((d) => (
              <Row key={d.device_id}>
                <Cell mono>{d.device_id}</Cell>
                <Cell mono>{d.app_version || '—'}</Cell>
                <Cell>{moment(d.last_seen_at)}</Cell>
                <Cell>{moment(d.last_push_at)}</Cell>
                <Cell>{shown(d.queued_count)}</Cell>
                <Cell>{shown(d.behind)}</Cell>
                <Cell>{shown(d.conflicts)}</Cell>
              </Row>
            ))}
          </Table>
          <SourceLine source="/api/admin/sync/status?account=" at={sync.at} />
          <p className="text-[11px] text-ink-muted">{t('scSyncV1Only')}</p>
        </>
      )}

      <h3 className="mb-2 mt-4 text-xs font-semibold">{t('scShopHealth')}</h3>
      {health.error ? <Problem load={health as Load<unknown>} /> : !health.data ? <Loading /> : isUnavailable(health.data)
        ? <NotAvailable data={health.data} /> : (
          <>
            <KV label={t('scOnline')}>{health.data.online == null ? '—' : health.data.online ? t('scYes') : t('scNo')}</KV>
            <KV label={t('scLastSync')}>{moment(health.data.lastSyncAt)}</KV>
            <KV label={t('scDevices')}>{shown(health.data.devices?.length)}</KV>
            <SourceLine source="/api/admin/shops/:id/health" data={health.data} at={health.at} />
          </>
        )}

      <h3 className="mb-2 mt-4 text-xs font-semibold">{t('scSuspension')}</h3>
      {susp.error ? <Problem load={susp as Load<unknown>} /> : !susp.data ? <Loading /> : isUnavailable(susp.data)
        ? <NotAvailable data={susp.data} /> : (
          <>
            <KV label={t('status')}>{susp.data.state || '—'}</KV>
            <KV label={t('scReason')}>{susp.data.reason || '—'}</KV>
            <SourceLine source="/api/admin/shops/:id/suspension" data={susp.data} at={susp.at} />
          </>
        )}
      <p className="mt-3 text-xs"><Link className="underline" to={`/shop?tab=audit&shop=${encodeURIComponent(id)}`}>{t('scShopAudit')}</Link></p>
    </Card>
  );
}

export function ShopsTab() {
  const { t } = useApp();
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState('');
  useEffect(() => { setOffset(0); }, [q]);
  //  ⛔ جست‌وجو و صفحه‌بندی سمتِ سرورِ حساب (‎q · limit · offset‎)، نه آوردنِ همه و برش در مرورگر
  const load = useLoad<ShopList>(CONSOLE.shops(q.trim(), PAGE, offset), [q, offset], 'customers');
  const rows = Array.isArray(load.data?.shops) ? load.data!.shops! : [];
  return (
    <div className="space-y-4">
      <input className="input w-full sm:w-80" placeholder={t('shopDeskSearch')} value={q} onChange={(e) => setQ(e.target.value)} />
      {open && <ShopDetail id={open} onClose={() => setOpen('')} />}
      <Card title={t('scShops')} icon={<Store size={16} />}>
        {load.error ? <Problem load={load as Load<unknown>} /> : !load.data ? <Loading /> : (
          <>
            <Table head={[t('shopDeskName'), t('shopDeskEmail'), t('status'), t('scSub'), t('shopDeskEnds'), t('scMembers')]} empty={rows.length === 0}>
              {rows.map((r) => (
                <Row key={r.id} onClick={() => setOpen(r.id)}>
                  <Cell>{r.name || r.id}</Cell>
                  <Cell mono>{r.owner_email || '—'}</Cell>
                  <Cell>{r.status || '—'}</Cell>
                  <Cell>{r.sub_status || '—'}{r.plan ? ` · ${r.plan}` : ''}</Cell>
                  <Cell>{moment(r.ends_at)}</Cell>
                  <Cell>{shown(r.members)}</Cell>
                </Row>
              ))}
            </Table>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
              <button className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t('scPrev')}</button>
              <button className="btn btn-sm" disabled={rows.length < PAGE} onClick={() => setOffset(offset + PAGE)}>{t('scNext')}</button>
              <span>{t('scRows').replace('{from}', shown(rows.length ? offset + 1 : 0)).replace('{to}', shown(offset + rows.length))}</span>
              {/* ⚠️ «کل» ِ سرورِ حساب همهٔ دکان‌هاست، نه نتیجهٔ همین جست‌وجو — همان را می‌گوییم */}
              <span>· {t('scAllShops')}: {shown(load.data.total)}</span>
            </div>
            <SourceLine source="/api/admin/shops" at={load.at} />
          </>
        )}
      </Card>
    </div>
  );
}

/* ─────────────────────────────── زبانه: مالی ─────────────────────────────── */

export function FinanceTab() {
  const { t } = useApp();
  return (
    <div className="space-y-4">
      {/* ⛔ همان صفحهٔ «فروش و درآمد» (درآمد، پرداخت و رسید، بدهی، رو به پایان) — رونوشتِ دومی نیست */}
      <Sales fixedApp="shop" />
      <Card title={t('scFinanceLater')} icon={<Wallet size={16} />}>
        <Notice tone="warn">
          <b>{t('scNotAvailable')}</b> — {t('scFinanceLaterWhy')}
        </Notice>
      </Card>
    </div>
  );
}

/* ────────────────────────────── زبانه: نسخه‌ها ────────────────────────────── */

function VersionHealthCell({ app, version }: { app: string; version: string }) {
  const { t } = useApp();
  const [data, setData] = useState<VersionHealth | null>(null);
  const [err, setErr] = useState('');
  if (data) {
    return <span className="text-xs">{t('scInstalls')}: {shown(data.installs)} · {t('scCrashes')}: {shown(data.crashes)}</span>;
  }
  return (
    <span className="flex items-center gap-2">
      <ActionButton onClick={async () => {
        try { setData(await api<VersionHealth>(CONSOLE.versionHealth(app, version))); setErr(''); }
        catch (e) { setErr(e instanceof ApiError ? `${e.code}` : String(e)); }
      }}>{t('scCheckVersion')}</ActionButton>
      {err && <code dir="ltr" className="font-mono text-[11px]" style={{ color: TONE.bad }}>{err}</code>}
    </span>
  );
}

function AppVersionsCard({ a, data }: { a: AppVersions; data: Versions }) {
  const { t } = useApp();
  const rows = Array.isArray(a.versions) ? a.versions : [];
  return (
    <>
      <div className="mb-3 grid gap-3 sm:grid-cols-4">
        <Stat label={t('scDevices')} value={shown(a.devices)} sub={t('scActiveDays').replace('{n}', shown(data.activeDays))} />
        <Stat label={t('scLatest')} value={<span dir="ltr">{a.latest || '—'}</span>} sub={`${t('scMinVersion')}: ${a.minVersion || '—'}`} />
        <Stat label={t('scBelowMin')} value={shown(a.belowMin)} tone={num(a.belowMin) ? 'bad' : undefined} />
        {/* ⚠️ آخرین نسخه ثبت نشده ⇒ «کهنه» سنجیده نمی‌شود: `null` ⇒ «—»، نه صفر */}
        <Stat label={t('scOutdated')} value={shown(a.outdated)} tone={num(a.outdated) ? 'warn' : undefined} />
      </div>
      <Table head={[t('scVersion'), t('scDevices'), t('scLastSeen'), t('status'), '']} empty={rows.length === 0}>
        {rows.map((v) => (
          <Row key={v.version || 'unknown'}>
            <Cell mono>{v.version || '—'}</Cell>
            <Cell>{shown(v.devices)}</Cell>
            <Cell>{moment(v.lastSeenAt)}</Cell>
            <Cell>{v.state || '—'}</Cell>
            <Cell>{v.version ? <VersionHealthCell app={a.app} version={v.version} /> : '—'}</Cell>
          </Row>
        ))}
      </Table>
      {a.versionsTruncated && <p className="mt-2 text-[11px] text-ink-muted">{t('scTruncated')}</p>}
    </>
  );
}

export function VersionsTab() {
  const { t, can } = useApp();
  const load = useLoad<Versions>(CONSOLE.versions);
  //  ⛔ سرورِ حساب کانالِ آزمایشی را حتی برای خواندن فقط به ارشد می‌دهد ⇒ پل فقط admin؛ بقیه درخواستی نمی‌زنند
  const beta = useLoad<ReleaseBeta>(can('admin') ? CONSOLE.releaseBeta : null);
  return (
    <div className="space-y-4">
      <Panel title={t('scVersionsShop')} icon={<Boxes size={16} />} source="/api/admin/system/versions" load={load}>
        {(d) => {
          const a = (d.apps || []).find((x) => x.app === 'shop');
          return a ? <AppVersionsCard a={a} data={d} /> : <Notice>{t('scNoShopVersions')}</Notice>;
        }}
      </Panel>
      <Card title={t('scBeta')} icon={<Flag size={16} />}>
        {!can('admin') ? <Notice>{t('scAdminOnly')}</Notice> : beta.error ? <Problem load={beta as Load<unknown>} /> : !beta.data ? <Loading /> : (
          <>
            <KV label={t('scBetaShops')}>{(beta.data.shops?.ids || []).join('، ') || '—'}</KV>
            <KV label={t('scBetaDevices')}>{(beta.data.devices?.ids || []).join('، ') || '—'}</KV>
            <KV label={t('scChangedBy')}>{beta.data.shops?.updatedBy || '—'} · {moment(beta.data.shops?.updatedAt)}</KV>
            <SourceLine source="/api/admin/release/beta" data={beta.data} at={beta.at} />
          </>
        )}
      </Card>
    </div>
  );
}

/* ─────────────────────────── زبانه: سلامت و خطاها ─────────────────────────── */

type ClientError = { id?: string | number; app?: string; app_version?: string; message?: string; kind?: string; at?: number | string; account_id?: string };

function ChainVerify() {
  const { t, can } = useApp();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ChainReport | null>(null);
  const [err, setErr] = useState('');
  if (!can('admin')) return <Notice>{t('scAdminOnly')}</Notice>;
  const run = async () => {
    setAsk(false);
    setBusy(true);
    try { setRes(await api<ChainReport>(CONSOLE.chainVerify, { method: 'POST', body: {} })); setErr(''); }
    catch (e) { setErr(e instanceof ApiError ? `${e.message} (${e.code})` : String(e)); setRes(null); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <button className="btn btn-sm" disabled={busy} onClick={() => setAsk(true)}>{busy ? t('scChecking') : t('scChainVerify')}</button>
      {/* ⚠️ به `body` برده می‌شود: کارتِ `.rise` (انیمیشنِ transform) قابِ `fixed` را درونِ خودش زندانی می‌کرد و
          دکمهٔ «تایید» بیرونِ دید می‌ماند — کرومیومِ واقعی گرفتش (`test/shop-console-ui.mjs`) */}
      {createPortal(
        <ConfirmDialog open={ask} title={t('scChainVerify')} message={t('scChainVerifyConfirm')} onConfirm={run} onCancel={() => setAsk(false)} />,
        document.body,
      )}
      {err && <Notice tone="bad">{err}</Notice>}
      {res && (
        <div className="mt-3">
          {/* ⛔ «تأییدشده از سرور» فقط وقتی پاسخِ خودِ سرورِ حساب رسیده */}
          <Notice tone={res.ok ? 'good' : 'bad'}>
            {t('scServerConfirmed')} — {res.ok ? t('scChainOk') : t('scChainBroken')} · {t('scChains')}: {shown(res.total)} · {t('scBroken')}: {shown(res.brokenCount)}
          </Notice>
          {(res.broken || []).slice(0, 20).map((b) => (
            <p key={b.chain} className="font-mono text-[11px]" dir="ltr">{b.chain} #{shown(b.seq)} {b.reason || ''}</p>
          ))}
          <SourceLine source="POST /api/admin/system/chain-verify" data={res} />
        </div>
      )}
    </div>
  );
}

export function HealthTab() {
  const { t } = useApp();
  const load = useLoad<SystemHealth>(CONSOLE.health);
  const [limit, setLimit] = useState(50);
  //  ⛔ سقف و برنامه سمتِ سرورِ حساب (‎app · limit‎)؛ فهرستِ ۵۰۰ ردیفی به مرورگر نمی‌آید مگر خواسته شود
  const errors = useLoad<{ errors?: ClientError[] }>(`/api/account-admin/sync/errors?app=shop&limit=${limit}`, [limit], 'sync');
  const rows = Array.isArray(errors.data?.errors) ? errors.data!.errors! : [];
  return (
    <div className="space-y-4">
      <Panel title={t('scHealth')} icon={<HeartPulse size={16} />} source="/api/admin/system/health" load={load}>
        {(d) => (
          <>
            <div className="mb-3"><Pill tone={healthTone(d.status)}>{statusLabel(t, d.status)}</Pill></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Stat label={t('scDatabase')} value={statusLabel(t, d.database?.status)} tone={statTone(healthTone(d.database?.status))}
                    sub={`${shown(d.database?.latencyMs)} ms · ${d.database?.driver || '—'}`} />
              <Stat label={t('scEmailQueue')} value={shown(d.queues?.email?.queued)} tone={statTone(healthTone(d.queues?.email?.status))}
                    sub={`${t('scWorker')}: ${d.queues?.email?.worker || '—'} · ${t('scFailed24h')}: ${shown(d.queues?.email?.failed24h)}`} />
              <Stat label={t('scTelegramQueue')} value={shown(d.queues?.telegram?.pending)} sub={`${t('scFailed24h')}: ${shown(d.queues?.telegram?.failed24h)}`} />
              <Stat label={t('scClientErrors24h')} value={shown(d.sync?.clientErrors24h)} sub={`${t('scConflicts24h')}: ${shown(d.sync?.conflicts24h)}`} />
              <Stat label={t('scDisk')} value={d.storage?.freePct == null ? '—' : `${shown(d.storage.freePct)}٪`}
                    sub={`${bytes(d.storage?.freeBytes)} / ${bytes(d.storage?.totalBytes)}`} />
              <Stat label={t('scBackups')} value={d.backups?.enabled === false ? t('scOff') : shown(d.backups?.count)}
                    tone={statTone(healthTone(d.backups?.status))}
                    sub={`${t('scLastBackup')}: ${moment(d.backups?.last?.at)}`} />
            </div>
          </>
        )}
      </Panel>

      <Card title={t('scAuditChain')} icon={<ShieldCheck size={16} />}><ChainVerify /></Card>

      <Card title={t('scClientErrors')} icon={<FileClock size={16} />}
            action={<select className="input w-auto" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {[50, 100, 200, 500].map((n) => <option key={n} value={n}>{shown(n)}</option>)}
            </select>}>
        {errors.error ? <Problem load={errors as Load<unknown>} /> : !errors.data ? <Loading /> : (
          <>
            <Table head={[t('scAt'), t('scAppVersion'), t('scKind'), t('scMessage')]} empty={rows.length === 0}>
              {rows.map((e, i) => (
                <Row key={String(e.id ?? i)}>
                  <Cell>{moment(e.at)}</Cell>
                  <Cell mono>{e.app_version || '—'}</Cell>
                  <Cell>{e.kind || '—'}</Cell>
                  <Cell className="max-w-[28rem] truncate">{e.message || '—'}</Cell>
                </Row>
              ))}
            </Table>
            <p className="mt-2 text-[11px] text-ink-muted">{t('scLastN').replace('{n}', shown(limit))} · <Link className="underline" to="/sync">{t('scSyncPage')}</Link></p>
            <SourceLine source="/api/admin/sync/errors?app=shop" at={errors.at} />
          </>
        )}
      </Card>
    </div>
  );
}

/* ───────────────────────── زبانه: تنظیمات و پرچم‌ها ───────────────────────── */

export function SettingsTab() {
  const { t } = useApp();
  const [scope, setScope] = useState('');
  const [want, setWant] = useState('');
  const flags = useLoad<Flags | Unavailable>(CONSOLE.flags);
  const live = useLoad<LiveConfig>(want ? CONSOLE.liveConfig(want) : null, [want]);
  const cfg = useLoad<{ config?: Record<string, string> }>('/api/account-admin/account-config');
  const items = Array.isArray(live.data?.items) ? live.data!.items! : [];
  return (
    <div className="space-y-4">
      <Card title={t('scFlags')} icon={<Flag size={16} />}>
        {flags.error ? <Problem load={flags as Load<unknown>} /> : !flags.data ? <Loading /> : isUnavailable(flags.data)
          ? <NotAvailable data={flags.data} /> : (
            <>
              <Table head={[t('scKey'), t('scValue'), t('scChangedBy'), t('scReason')]} empty={!flags.data.flags?.length}>
                {(flags.data.flags || []).map((f) => (
                  <Row key={f.key}>
                    <Cell mono>{f.key}</Cell>
                    <Cell mono>{JSON.stringify(f.value)}</Cell>
                    <Cell>{f.updatedBy || '—'} · {moment(f.updatedAt)}</Cell>
                    <Cell>{f.reason || '—'}</Cell>
                  </Row>
                ))}
              </Table>
              <SourceLine source="/api/admin/flags" data={flags.data} at={flags.at} />
            </>
          )}
      </Card>

      <Card title={t('scLiveConfig')} icon={<Plug size={16} />}>
        <form className="mb-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setWant(scope.trim()); }}>
          <input className="input w-full sm:w-72" dir="ltr" placeholder={t('scScopeHint')} value={scope} onChange={(e) => setScope(e.target.value)} />
          <button className="btn btn-sm" type="submit" disabled={!scope.trim()}>{t('scShow')}</button>
        </form>
        {!want ? <p className="text-xs text-ink-muted">{t('scLiveConfigHint')}</p> : live.error ? <Problem load={live as Load<unknown>} /> : !live.data ? <Loading /> : (
          <>
            <Table head={[t('scKey'), t('scValue'), t('scChangedBy')]} empty={items.length === 0}>
              {items.map((it) => (
                <Row key={it.key}>
                  <Cell mono>{it.key}</Cell>
                  <Cell mono>{JSON.stringify(it.value)}</Cell>
                  <Cell>{it.updatedBy || '—'} · {moment(it.updatedAt)}</Cell>
                </Row>
              ))}
            </Table>
            <SourceLine source={`/api/admin/pump/live-config?scope=${live.data.scope || want}`} data={live.data} at={live.at} />
          </>
        )}
      </Card>

      <Card title={t('scServerConfig')} icon={<Plug size={16} />}>
        {cfg.error ? <Problem load={cfg as Load<unknown>} /> : !cfg.data ? <Loading /> : (
          <>
            <KV label={t('scTrialDaysShop')}>{shown(cfg.data.config?.trial_days)}</KV>
            <p className="mt-2 text-[11px] text-ink-muted">{t('scTrialWhere')}</p>
            <SourceLine source="/api/admin/plans (config)" at={cfg.at} />
          </>
        )}
      </Card>
    </div>
  );
}

/* ─────────────────────────── زبانه: یکپارچه‌سازی ─────────────────────────── */

type ManagedApp = { id: string; slug?: string; title?: string; status?: string; keySet?: boolean; keyHint?: string;
                    lastCheckAt?: number | null; lastOk?: boolean | null; lastStatus?: number | null };

export function IntegrationsTab() {
  const { t } = useApp();
  const load = useLoad<Providers>(CONSOLE.providers);
  const apps = useLoad<{ apps?: ManagedApp[] }>('/api/account-admin/apps');
  const list = Array.isArray(apps.data?.apps) ? apps.data!.apps! : [];
  return (
    <div className="space-y-4">
      <Panel title={t('scProviders')} icon={<Plug size={16} />} source="/api/admin/system/providers" load={load}>
        {(d) => (
          <>
            {d.production === false && <Notice tone="warn">{t('scNotProduction')}</Notice>}
            <Table head={[t('scService'), t('scMode'), t('status'), t('scMissing')]} empty={!d.providers?.length}>
              {(d.providers || []).map((p) => (
                <Row key={p.id}>
                  <Cell mono>{p.id}</Cell>
                  <Cell mono>{p.mode || '—'}</Cell>
                  <Cell><Pill tone={providerTone(p.state)}>{p.state || '—'}</Pill></Cell>
                  {/* ⛔ فقط نامِ فیلدِ کم — هرگز مقدار، کلید یا نشانی */}
                  <Cell>{(p.missing || []).join('، ') || '—'}</Cell>
                </Row>
              ))}
            </Table>
          </>
        )}
      </Panel>
      <Card title={t('scManagedApps')} icon={<Plug size={16} />}
            action={<Link className="text-xs underline" to="/account-server">{t('scManageThere')}</Link>}>
        {apps.error ? <Problem load={apps as Load<unknown>} /> : !apps.data ? <Loading /> : (
          <>
            <Table head={[t('scApp'), t('status'), t('scKey'), t('scLastCheck')]} empty={list.length === 0}>
              {list.map((a) => (
                <Row key={a.id}>
                  <Cell>{a.title || a.slug || a.id}</Cell>
                  <Cell>{a.status || '—'}</Cell>
                  {/* ⛔ کلید هرگز: فقط «هست/نیست» و چهار نویسهٔ آخر که خودِ سرورِ حساب پوشانده */}
                  <Cell mono>{a.keySet ? (a.keyHint || '✓') : '—'}</Cell>
                  <Cell>{a.lastOk == null ? '—' : a.lastOk ? t('scYes') : t('scNo')} · {moment(a.lastCheckAt)}</Cell>
                </Row>
              ))}
            </Table>
            <SourceLine source="/api/admin/apps" at={apps.at} />
          </>
        )}
      </Card>
    </div>
  );
}

/* ─────────────────────────── زبانه: دفترِ رخداد ─────────────────────────── */

type AccountAuditRow = { id: string | number; shop_id?: string; actor_type?: string; user_id?: string; action?: string;
                         target_type?: string; target_id?: string; ip?: string; created_at?: number | string };
type PanelAuditRow = { id: number; actor?: string; action?: string; entity?: string; entity_id?: string; result?: string; at?: number };

export function AuditTab({ shop: initialShop = '' }: { shop?: string }) {
  const { t } = useApp();
  const [shop, setShop] = useState(initialShop);
  const [shopWant, setShopWant] = useState(initialShop);
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  //  ⛔ پالایشِ دکان سمتِ سرورِ حساب (`shopId`)؛ سقفِ ۵۰۰ِ همان‌جا — صفحه‌بندیِ پیوسته آن‌جا نیست، پس
  //  صریح «آخرین N» می‌گوییم، نه «همه»
  const acct = useLoad<{ entries?: AccountAuditRow[] }>(CONSOLE.accountAudit(limit, shopWant), [limit, shopWant]);
  //  دفترِ خودِ پنل — صفحه‌بندیِ سمتِ سرور (‎limit · offset‎)، فقط کارهای پلِ سرورِ حساب (`account.*`)
  const panel = useLoad<{ rows?: PanelAuditRow[]; total?: number }>(
    `/api/control/audit?q=${encodeURIComponent(shopWant ? shopWant : 'account.')}&limit=${PAGE}&offset=${offset}`, [offset, shopWant]);
  const accRows = Array.isArray(acct.data?.entries) ? acct.data!.entries! : [];
  const panRows = Array.isArray(panel.data?.rows) ? panel.data!.rows! : [];
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); setShopWant(shop.trim()); setOffset(0); }}>
        <input className="input w-full sm:w-64" dir="ltr" placeholder={t('scShopIdFilter')} value={shop} onChange={(e) => setShop(e.target.value)} />
        <button className="btn btn-sm" type="submit">{t('scShow')}</button>
        <select className="input w-auto" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          {[50, 100, 200, 500].map((n) => <option key={n} value={n}>{t('scLastN').replace('{n}', shown(n))}</option>)}
        </select>
      </form>

      <Notice tone="warn">{t('scActorNote')}</Notice>

      <Card title={t('scAccountAudit')} icon={<FileClock size={16} />}>
        {acct.error ? <Problem load={acct as Load<unknown>} /> : !acct.data ? <Loading /> : (
          <>
            <Table head={[t('scAt'), t('scAction'), t('scActor'), t('scTarget'), t('scShop')]} empty={accRows.length === 0}>
              {accRows.map((r) => (
                <Row key={String(r.id)}>
                  <Cell>{moment(r.created_at)}</Cell>
                  <Cell mono>{r.action || '—'}</Cell>
                  <Cell mono>{[r.actor_type, r.user_id].filter(Boolean).join(':') || '—'}</Cell>
                  <Cell mono>{[r.target_type, r.target_id].filter(Boolean).join(':') || '—'}</Cell>
                  <Cell mono>{r.shop_id || '—'}</Cell>
                </Row>
              ))}
            </Table>
            <SourceLine source={`/api/admin/audit${shopWant ? `?shopId=${shopWant}` : ''}`} at={acct.at} />
          </>
        )}
      </Card>

      <Card title={t('scPanelAudit')} icon={<FileClock size={16} />}>
        {panel.error ? <Problem load={panel as Load<unknown>} /> : !panel.data ? <Loading /> : (
          <>
            <Table head={[t('scAt'), t('scAction'), t('scActor'), t('scTarget'), t('scResult')]} empty={panRows.length === 0}>
              {panRows.map((r) => (
                <Row key={r.id}>
                  <Cell>{moment(r.at)}</Cell>
                  <Cell mono>{r.action || '—'}</Cell>
                  <Cell>{r.actor || '—'}</Cell>
                  <Cell mono>{[r.entity, r.entity_id].filter(Boolean).join(':') || '—'}</Cell>
                  <Cell>{r.result || '—'}</Cell>
                </Row>
              ))}
            </Table>
            <div className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
              <button className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t('scPrev')}</button>
              <button className="btn btn-sm" disabled={num(panel.data.total) === null || offset + panRows.length >= Number(panel.data.total)} onClick={() => setOffset(offset + PAGE)}>{t('scNext')}</button>
              <span>{t('scRows').replace('{from}', shown(panRows.length ? offset + 1 : 0)).replace('{to}', shown(offset + panRows.length))} · {t('scOf')} {shown(panel.data.total)}</span>
            </div>
            <SourceLine source="/api/control/audit (cc_audit)" at={panel.at} />
          </>
        )}
      </Card>
    </div>
  );
}
