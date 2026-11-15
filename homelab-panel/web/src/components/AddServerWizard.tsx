// ---------------------------------------------------------------------------
//  «افزودنِ سرور» (۱.۵۱.۱) — جادوگرِ گام‌به‌گامِ «سرورهای من»: چه خریده‌اید؟ ⇒ یک دستور / یک بسته ⇒ «وصل شد ✓»
//
//  دستورِ صاحب سامانه: «اگه من VPS یا هاست خرید کردم بتونم به برنامه‌ام وصل‌اش کنم» — مثلِ Coolify/Forge: یک انتخاب، یک
//  کپی، و صفحه خودش می‌بیند که سرورِ تازه آمد (‎GET /api/fleet/codes/:id‎: کد مصرف شد **و** نخستین تپشِ امضاشده رسید).
//    • VPS / لینوکس: یک خط ‎curl … install.sh | sudo VILL3N_DEPLOY=vps VILL3N_JOIN_CENTER=… VILL3N_JOIN_CODE=… bash‎
//    • کامپیوترِ دیگرِ خانه: همان، با ‎VILL3N_DEPLOY=home‎
//    • هاستِ اشتراکی (cPanel): بستهٔ zip (سرورِ حساب + نمایندهٔ هاست) و گام‌های «Setup Node.js App»؛ فقط سرورِ حساب
//    • سرورِ پنل‌دار: نشانیِ مرکز + کد ⇒ همان «سرورهای من ← وصل به مرکز» ِ آن سرور
//  ⛔ کد فقط در حافظهٔ همین پنجره؛ ۱۰ دقیقه و یک‌بارمصرف (سرور می‌سنجد)؛ «کدِ تازه» کدِ قبلی را بی‌اثر نمی‌کند ولی بی‌نیازش می‌کند.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Copy, Download, Globe, Home, Loader2, MonitorCog, Plus, RefreshCw, Server, Terminal } from 'lucide-react';
import { api, ApiError, openWithTicket } from '../api';
import { useApp } from '../app-context';
import { Card, toast } from './ui';
import { Notice } from '../control/ui';

export type Choice = 'vps' | 'host' | 'home' | 'panel';
type Center = { url: string; reach: 'internet' | 'lan' | 'local' };
type Issued = { code: string; codeId: string; expiresAt: number; serverTime: number; at: number; centers: Center[] };
type CodeState = { state: 'open' | 'used' | 'expired' | 'burned'; connected: boolean; node: { id: string; name: string; kind: string; online: boolean; beat: boolean } | null };

export const INSTALL_URL = 'https://raw.githubusercontent.com/vil3ntec-it/server/main/install.sh';
/** دستورِ یک‌خطیِ نصب + وصل — همان متغیرهای ‎install.sh‎ (‎join_center‎) */
export function installCommand(deploy: 'vps' | 'home', center: string, code: string): string {
  return `curl -fsSL ${INSTALL_URL} | sudo VILL3N_DEPLOY=${deploy} VILL3N_JOIN_CENTER=${center} VILL3N_JOIN_CODE=${code} bash`;
}

const errText = (e: unknown) => (e instanceof ApiError ? (e.message && e.message !== e.code ? e.message : e.code) : e instanceof Error ? e.message : String(e));

async function copy(value: string, done: string) {
  try { await navigator.clipboard.writeText(value); } catch {
    const el = document.createElement('textarea');
    el.value = value;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    el.remove();
  }
  toast(done);
}

function BigCopy({ value, label }: { value: string; label: string }) {
  const { t } = useApp();
  return (
    <button type="button" className="btn btn-primary" onClick={() => void copy(value, t('copied'))} data-testid="wizard-copy">
      <Copy className="h-4 w-4" /> {label}
    </button>
  );
}

function CopyLine({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const { t } = useApp();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-40 shrink-0 text-xs text-ink-muted">{label}</span>
      <code dir="ltr" className={`min-w-0 flex-1 truncate rounded-lg bg-surface-sunken px-3 py-1.5 text-sm ${mono ? 'font-mono' : ''}`}>{value}</code>
      <button type="button" className="btn btn-sm" onClick={() => void copy(value, t('copied'))}><Copy className="h-3.5 w-3.5" /> {t('awCopy')}</button>
    </div>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>{n.toLocaleString('fa-AF')}</span>
      <div className="min-w-0 flex-1 text-sm leading-7">{children}</div>
    </li>
  );
}

export default function AddServerWizard({ onClose, onConnected }: { onClose: () => void; onConnected?: () => void }) {
  const { t } = useApp();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [status, setStatus] = useState<CodeState | null>(null);

  const make = useCallback(async () => {
    setError('');
    setBusy(true);
    setStatus(null);
    try {
      const r = await api<Omit<Issued, 'at'>>('/api/fleet/codes', { method: 'POST', body: {} });
      setIssued({ ...r, at: Date.now() });
    } catch (e) {
      setError(errText(e));
    } finally { setBusy(false); }
  }, []);

  //  کد فقط وقتی لازم است ساخته می‌شود (پس از انتخاب) — نه با باز شدنِ پنجره
  useEffect(() => { if (choice && !issued && !busy && !error) void make(); }, [choice, issued, busy, error, make]);
  //  نبضِ آگاهانه: ثانیه‌شمارِ کد — هیچ درخواستی نمی‌زند
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  //  «منتظرِ وصل شدن…»: هر ۳ ثانیه حالِ همان کد (بی خودِ کد) تا «وصل شد ✓»؛ با بستنِ پنجره یا وصل شدن می‌ایستد
  const connected = Boolean(status?.connected);
  useEffect(() => {
    if (!issued || connected) return;
    let alive = true;
    const poll = async () => {
      try {
        const s = await api<CodeState>(`/api/fleet/codes/${encodeURIComponent(issued.codeId)}`);
        if (!alive) return;
        setStatus(s);
        if (s.connected) onConnected?.();
      } catch { /* بعدی */ }
    };
    void poll();
    const id = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [issued, connected, onConnected]);

  //  زمان با ساعتِ سرور (‎serverTime‎) — ساعتِ جلو/عقبِ مرورگر شمارش را خراب نمی‌کند
  const left = issued ? Math.max(0, Math.round((issued.expiresAt - issued.serverTime - (now - issued.at)) / 1000)) : 0;
  const expired = Boolean(issued) && (left === 0 || status?.state === 'expired' || status?.state === 'burned') && !connected && status?.state !== 'used';
  const centers = issued?.centers || [];
  const internet = centers.find((c) => c.reach === 'internet') || null;
  const lan = centers.find((c) => c.reach === 'lan') || null;
  const center = choice === 'home' || choice === 'panel' ? (internet || lan || centers[0] || null) : internet;

  const codeBox = issued && (
    <div className="flex flex-col gap-2 rounded-xl border border-line p-3" data-testid="wizard-code">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-ink-muted">{t('awCode')}</span>
        <span dir="ltr" className="tnum font-mono text-lg font-semibold tracking-widest" style={{ opacity: expired ? 0.4 : 1 }}>{issued.code}</span>
        <span className="tnum text-sm" data-testid="wizard-countdown" style={{ color: left < 60 ? 'var(--status-warning)' : 'var(--text-secondary)' }}>
          {expired ? t('fsCodeExpired') : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}
        </span>
        <button type="button" className="btn btn-sm ms-auto" onClick={() => { setIssued(null); }} disabled={busy}>
          <RefreshCw className="h-3.5 w-3.5" /> {t('awNewCode')}
        </button>
      </div>
      <p className="text-xs leading-6 text-ink-soft">{t('awCodeOnce')}</p>
    </div>
  );

  const live = issued && (
    <div className="flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm" data-testid="wizard-live"
         style={connected ? { borderColor: 'color-mix(in srgb, var(--status-good) 45%, transparent)', background: 'color-mix(in srgb, var(--status-good) 10%, transparent)' } : undefined}>
      {connected ? (
        <><CheckCircle2 className="h-5 w-5" style={{ color: 'var(--status-good)' }} /><span className="font-semibold">{t('awConnected')}</span>
          <span className="text-ink-soft">— «{status?.node?.name}»</span></>
      ) : status?.state === 'used' ? (
        <><Loader2 className="h-4 w-4 animate-spin" /><span>{t('awJoinedWaitBeat', { name: status.node?.name || '' })}</span></>
      ) : expired ? (
        <span className="text-ink-muted">{t('awExpiredHint')}</span>
      ) : (
        <><Loader2 className="h-4 w-4 animate-spin" /><span>{t('awWaiting')}</span></>
      )}
    </div>
  );

  const noInternet = !internet && (
    <Notice tone="warn">
      {t('awNoInternet')} <Link className="underline" to="/site-server">{t('siteServer')}</Link>
    </Notice>
  );

  let body: ReactNode = null;
  if (!choice) {
    const opts: { id: Choice; icon: ReactNode; title: string; sub: string }[] = [
      { id: 'vps', icon: <Server className="h-6 w-6" />, title: t('awVps'), sub: t('awVpsSub') },
      { id: 'host', icon: <Globe className="h-6 w-6" />, title: t('awHost'), sub: t('awHostSub') },
      { id: 'home', icon: <Home className="h-6 w-6" />, title: t('awHome'), sub: t('awHomeSub') },
    ];
    body = (
      <div className="flex flex-col gap-3" data-testid="wizard-choose">
        <p className="text-base font-semibold">{t('awWhat')}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {opts.map((o) => (
            <button key={o.id} type="button" onClick={() => setChoice(o.id)} data-choice={o.id}
                    className="flex flex-col items-start gap-2 rounded-2xl border border-line p-4 text-start transition-colors hover:border-[color:var(--accent)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2"
                    style={{ outlineColor: 'var(--accent)' }}>
              <span style={{ color: 'var(--accent)' }}>{o.icon}</span>
              <span className="text-[15px] font-semibold">{o.title}</span>
              <span className="text-xs leading-6 text-ink-soft">{o.sub}</span>
            </button>
          ))}
        </div>
        <button type="button" className="self-start text-xs text-ink-soft underline underline-offset-4" onClick={() => setChoice('panel')} data-choice="panel">
          <MonitorCog className="me-1 inline h-3.5 w-3.5" />{t('awPanelLink')}
        </button>
        <p className="text-xs text-ink-muted">{t('awCpanelNotNode')}</p>
      </div>
    );
  } else if (error) {
    body = (
      <div className="flex flex-col items-start gap-2">
        <Notice tone="bad">{error}</Notice>
        <button type="button" className="btn btn-sm" onClick={() => setError('')}><RefreshCw className="h-3.5 w-3.5" /> {t('awRetry')}</button>
      </div>
    );
  } else if (!issued) {
    body = <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" /> {t('awMaking')}</p>;
  } else if (choice === 'vps' || choice === 'home') {
    const cmd = center ? installCommand(choice, center.url, issued.code) : '';
    body = (
      <div className="flex flex-col gap-4" data-testid={`wizard-${choice}`}>
        {choice === 'vps' && <Notice tone="info">{t('awSpecs')}</Notice>}
        {choice === 'vps' ? noInternet : !center && noInternet}
        <ol className="flex flex-col gap-3">
          <Step n={1}>{choice === 'vps' ? t('awSshVps') : t('awSshHome')}
            {choice === 'vps' && <span className="mt-1 block text-xs text-ink-muted"><Terminal className="me-1 inline h-3.5 w-3.5" />{t('awSshHow')}</span>}
          </Step>
          <Step n={2}>
            {t('awPaste')}
            {center ? (
              <div className="mt-2 flex flex-col gap-2">
                <pre dir="ltr" className="whitespace-pre-wrap break-all rounded-xl bg-surface-sunken px-3 py-2.5 font-mono text-[13px] leading-6 text-ink" data-testid="wizard-command">{cmd}</pre>
                <div><BigCopy value={cmd} label={t('awCopyCommand')} /></div>
              </div>
            ) : null}
          </Step>
          <Step n={3}>{t('awWaitHere')}</Step>
        </ol>
        {codeBox}
        {live}
        {choice === 'home' && <p className="text-xs text-ink-muted">{t('awHomeWindows')}</p>}
      </div>
    );
  } else if (choice === 'host') {
    body = (
      <div className="flex flex-col gap-4" data-testid="wizard-host">
        <Notice tone="warn">{t('awHostLimits')}</Notice>
        {noInternet}
        <ol className="flex flex-col gap-3">
          <Step n={1}>
            {t('awHostDownload')}
            <div className="mt-2">
              <button type="button" className="btn btn-primary" disabled={!internet} data-testid="wizard-bundle"
                      onClick={() => internet && openWithTicket(`/api/fleet/host-bundle?center=${encodeURIComponent(internet.url)}`).catch((e) => toast(errText(e), 'bad'))}>
                <Download className="h-4 w-4" /> {t('awHostZip')}
              </button>
            </div>
          </Step>
          <Step n={2}>{t('awHostUpload')}</Step>
          <Step n={3}>
            {t('awHostApp')}
            <div className="mt-2 flex flex-col gap-1.5">
              <CopyLine label="Application root" value="vill3n-host" />
              <CopyLine label="Application startup file" value="vill3n-agent/start.cjs" />
              <CopyLine label="Node.js version" value="20 / 22" mono={false} />
            </div>
          </Step>
          <Step n={4}>
            {t('awHostEnv')}
            <div className="mt-2 flex flex-col gap-1.5">
              <CopyLine label="VILL3N_JOIN_CODE" value={issued.code} />
            </div>
            <span className="mt-1 block text-xs text-ink-muted">{t('awHostEnvMore')}</span>
          </Step>
          <Step n={5}>{t('awHostStart')}</Step>
        </ol>
        {codeBox}
        {live}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-4" data-testid="wizard-panel">
        <p className="text-sm leading-7">{t('awPanelHow')}</p>
        {center && <CopyLine label={t('awCenterUrl')} value={center.url} />}
        <CopyLine label={t('awCode')} value={issued.code} />
        {center?.reach !== 'internet' && <p className="text-xs text-ink-muted">{t('awLanOnly')}</p>}
        {codeBox}
        {live}
      </div>
    );
  }

  return (
    <Card title={t('fsAdd')} icon={<Plus className="h-4 w-4" />}
          action={<div className="flex gap-2">
            {choice && !connected && <button className="btn btn-sm" onClick={() => { setChoice(null); setIssued(null); setStatus(null); setError(''); }}>{t('awBack')}</button>}
            <button className="btn btn-sm" onClick={onClose}>{t('close')}</button>
          </div>}>
      {body}
    </Card>
  );
}
