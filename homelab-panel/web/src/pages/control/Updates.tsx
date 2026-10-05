// ---------------------------------------------------------------------------
//  به‌روزرسانی از GitHub — بررسی، نصب، برگشت
//  پیش از هر نصب، از کلِ برنامه بکاپ گرفته می‌شود و data/ و .env دست نمی‌خورند.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { Download, GitBranch, RefreshCw, ServerCog, Tag } from 'lucide-react';
import { api, getToken } from '../../api';
import { useApp } from '../../app-context';
import { Card, Field, Loading, Modal, toast } from '../../components/ui';
import { dateTime, relative } from '../../format';
import { cc, type InstallProgress } from '../../control/api';
import type { UpdateInfo, UpdateStatus } from '../../control/types';
import { ActionButton, KV, Notice, Select } from '../../control/ui';

type Step = { name: string; status: string; detail: unknown; at: number };

export default function Updates() {
  const { t, lang } = useApp();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [pending, setPending] = useState<{ latest: string; at: number } | null>(null);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [restarting, setRestarting] = useState(false);
  //  ⛔ حالِ نصبِ در جریان — از سرور، پس رفتن و برگشتن همان را نشان می‌دهد
  const [prog, setProg] = useState<InstallProgress | null>(null);
  //  سرورِ حساب (ورود، اشتراک، باتِ تلگرام) — بستهٔ جدای خودش را دارد
  const [acct, setAcct] = useState<AcctUpdate | null>(null);
  const loadAcct = useCallback(async () => {
    try { setAcct(await api<AcctUpdate>('/api/account-server/update')); } catch { setAcct(null); }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await cc.updateStatus();
      setStatus(res.status);
      setPending(res.pending);
      setProg(res.progress || null);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadAcct();
  }, [load, loadAcct]);

  // بعد از نصب، پنل خودش را بالا می‌آورد؛ منتظر می‌مانیم تا برگردد
  useEffect(() => {
    if (!restarting) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/health', { cache: 'no-store' });
        if (res.ok) {
          setRestarting(false);
          window.location.reload();
        }
      } catch {
        /* هنوز بالا نیامده */
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [restarting]);

  //  تا نصب در جریان است، هر ثانیه چند مگابایت آمده. اگر پنل وسطِ کار
  //  خودش را دوباره بالا آورد (نصب تمام شد)، همان انتظارِ «restarting».
  const installing = !!prog?.running;
  useEffect(() => {
    if (!installing) return;
    const timer = setInterval(async () => {
      try {
        const res = await cc.updateStatus();
        setProg(res.progress || null);
      } catch {
        setRestarting(true);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [installing]);

  /* نصب — با force، حتی وقتی انتشار از نصبِ فعلی عقب‌تر است */
  const install = async (force = false) => {
    setProg({ running: true, phase: 'check', got: 0, total: 0, why: '' });
    try {
      const res = await cc.installUpdate(force);
      if (!res.ok) {
        toast(res.reason || 'error', 'bad');
        return;
      }
      setSteps((res.steps as Step[]) || []);
      if (res.restart) setRestarting(true);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      load();
    }
  };

  if (loading || !status) return <Loading />;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{t('ccUpdates')}</h1>

      {restarting && <Notice tone="warn">{t('ccRestartNotice')}</Notice>}

      <Card
        title={t('ccUpdates')}
        icon={status.channel === 'branch' ? <GitBranch className="h-4 w-4" /> : <Tag className="h-4 w-4" />}
        action={
          <div className="flex gap-2">
            <button className="btn btn-sm" onClick={() => setSettingsOpen(true)}>
              {t('settings')}
            </button>
            <ActionButton
              className="btn btn-sm"
              busyLabel="…"
              onClick={async () => {
                try {
                  //  ⛔ یک دکمه، هر دو: کاربر «بررسیِ به‌روزرسانی» را می‌زند و
                  //  انتظار دارد سرورِ حساب هم سنجیده شود — نه این‌که دنبالِ
                  //  درِ دومی در «اتوماسیون» بگردد.
                  loadAcct();
                  const res = await cc.checkUpdate();
                  setInfo(res);
                  if (res.error) toast(res.error, 'bad');
                  else toast(res.available ? t('ccUpdateAvailable') : t('ccUpToDate'), res.available ? 'bad' : 'good');
                  load();
                } catch (e) {
                  const message = (e as Error).message;
                  toast(
                    message.includes('package_incomplete')
                      ? t('ccUpdateIncomplete')
                      : message.includes('needs_installer')
                        ? t('ccUpdateNeedsInstaller')
                        : message,
                    'bad',
                  );
                }
              }}
            >
              <RefreshCw className="h-4 w-4" />
              {t('ccCheckUpdate')}
            </ActionButton>
          </div>
        }
      >
        <Notice>{t('ccUpdateWarn')}</Notice>

        <KV label={t('ccRepository')} mono>{status.repo}</KV>
        <KV label={t('ccUpdateChannelRelease')}>{status.channel === 'branch' ? `${t('ccUpdateChannelBranch')} · ${status.branch}` : t('ccUpdateChannelRelease')}</KV>
        <KV label={t('ccCurrentVersion')} mono>{status.current || '—'}{status.build ? ` (${status.build})` : ''}</KV>
        <KV label={t('ccLatestVersion')} mono>{info?.latest || pending?.latest || '—'}</KV>
        <KV label={t('ccLastCheck')}>{status.lastCheck ? relative(status.lastCheck, lang) : t('ccNever')}</KV>
        <KV label={t('lastUpdate')}>{status.installedAt ? dateTime(status.installedAt, lang) : t('ccNever')}</KV>
        <KV label={t('path')} mono>{status.installRoot}</KV>
        <KV label="نصبِ خودکار">{status.autoInstall ? 'روشن — هر ساعت و پس از روشن شدنِ کامپیوتر، بی کلیک' : 'خاموش — فقط با دکمه'}</KV>
        {status.autoFail?.why && (
          <div className="mt-3">
            <Notice tone="warn">
              نصبِ خودکارِ نسخهٔ {status.autoFail.latest || '؟'} نشد: {status.autoFail.why} — تا ۲۴ ساعت دوباره امتحان نمی‌شود؛ دکمهٔ نصب همین حالا هم کار می‌کند.
            </Notice>
          </div>
        )}

        {status.layout === 'packaged' && (
          <div className="mt-3">
            <Notice>
              <span className="font-medium">{t('ccUpdateApp')}</span> — {t('ccUpdateAppHow')} {t('ccUpdateAppDeps')}
            </Notice>
          </div>
        )}

        {installing && prog && <InstallBar p={prog} />}

        {!installing && (info?.available || pending) && (
          <div className="mt-4 rounded-xl border p-3" style={{ borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)' }}>
            <p className="mb-2 text-sm font-medium">
              {t('ccUpdateAvailable')} — <span className="tnum">{info?.latest || pending?.latest}</span>
            </p>
            {info?.publishedAt && <p className="mb-2 text-[11px] text-ink-muted">{dateTime(info.publishedAt, lang)}</p>}
            {info?.notes && (
              <pre dir="ltr" className="mb-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-sunken p-2.5 text-[11px] leading-relaxed">
                {info.notes}
              </pre>
            )}
            <ActionButton
              className="btn btn-sm btn-primary"
              busyLabel={t('ccInstalling')}
              onClick={() => install()}
            >
              <Download className="h-4 w-4" />
              {t('ccInstallUpdate')}
            </ActionButton>
          </div>
        )}

        {/*
          *  «انتشارِ آن‌طرف از نصبِ فعلی عقب‌تر است» با «به‌روز هستی» یکی
          *  نیست. تا وقتی هر دو پیامِ سبزِ یکسان می‌گرفتند، یک ناهماهنگیِ
          *  شمارهٔ نسخه شبیهِ «همه‌چیز مرتب است» دیده می‌شد.
          */}
        {info && !info.available && info.behind && !info.error && (
          <div className="mt-4 rounded-xl border p-3" style={{ borderColor: 'color-mix(in srgb, var(--status-warning) 45%, transparent)' }}>
            <p className="mb-2 text-sm font-medium" style={{ color: 'var(--status-warning)' }}>
              {t('ccUpdateBehind')}
            </p>
            <p className="mb-3 text-[11px] text-ink-muted">
              {t('ccUpdateBehindHow')} <span className="tnum" dir="ltr">{info.latest}</span> · <span className="tnum" dir="ltr">{info.current}</span>
            </p>
            <ActionButton className="btn btn-sm" busyLabel={t('ccInstalling')} onClick={() => install(true)}>
              <Download className="h-4 w-4" />
              {t('ccInstallAnyway')}
            </ActionButton>
          </div>
        )}

        {info && !info.available && !info.behind && !info.error && (
          <p className="mt-3 text-sm" style={{ color: 'var(--status-good)' }}>
            {t('ccUpToDate')}
          </p>
        )}
        {info?.error && (
          <p className="mt-3 text-sm" style={{ color: 'var(--status-critical)' }}>
            {info.error}
          </p>
        )}
      </Card>

      <AccountServerCard info={acct} onDone={loadAcct} />

      <PumpReleaseCard />

      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} status={status} onSaved={() => { setSettingsOpen(false); load(); }} />

      <Modal open={Boolean(steps)} onClose={() => setSteps(null)} title={t('ccInstallUpdate')} wide>
        <ul className="space-y-2">
          {steps?.map((s, i) => {
            const color = s.status === 'ok' ? 'var(--status-good)' : s.status === 'error' ? 'var(--status-critical)' : 'var(--status-warning)';
            return (
              <li key={i} className="flex items-start gap-2 rounded-xl border border-line p-2.5 text-xs">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium" style={{ color }}>{s.name} — {s.status}</p>
                  {s.detail != null && (
                    <p dir="ltr" className="mt-0.5 break-all font-mono text-[10px] text-ink-muted">
                      {typeof s.detail === 'string' ? s.detail : JSON.stringify(s.detail)}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {restarting && <Notice tone="warn">{t('ccRestartNotice')}</Notice>}
      </Modal>
    </div>
  );
}

function Settings({ open, onClose, status, onSaved }: { open: boolean; onClose: () => void; status: UpdateStatus; onSaved: () => void }) {
  const { t } = useApp();
  const [form, setForm] = useState({ repo: status.repo, channel: status.channel, branch: status.branch, autoCheck: status.autoCheck, autoInstall: status.autoInstall !== false, token: '' });

  useEffect(() => {
    if (open) setForm({ repo: status.repo, channel: status.channel, branch: status.branch, autoCheck: status.autoCheck, autoInstall: status.autoInstall !== false, token: '' });
  }, [open, status]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('settings')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('cancel')}</button>
          <ActionButton
            className="btn btn-primary"
            onClick={async () => {
              try {
                await cc.updateSettings({
                  repo: form.repo,
                  channel: form.channel,
                  branch: form.branch,
                  autoCheck: form.autoCheck,
                  autoInstall: form.autoInstall,
                  token: form.token || undefined,
                });
                toast(t('ccSave'));
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
      <Field label={t('ccRepository')} hint="owner/repo">
        <input dir="ltr" className="input font-mono text-xs" value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} />
      </Field>
      <Field label={t('ccUpdateChannelRelease')}>
        <Select
          value={form.channel}
          onChange={(v) => setForm({ ...form, channel: v as UpdateStatus['channel'] })}
          options={[
            { value: 'release', label: t('ccUpdateChannelRelease') },
            { value: 'branch', label: t('ccUpdateChannelBranch') },
          ]}
        />
      </Field>
      {form.channel === 'branch' && (
        <Field label={t('ccUpdateChannelBranch')}>
          <input dir="ltr" className="input font-mono text-xs" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
        </Field>
      )}
      <Field label="GitHub Token" hint={t('ccSecretHint')}>
        <input dir="ltr" type="password" className="input font-mono text-xs" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.autoCheck} onChange={(e) => setForm({ ...form, autoCheck: e.target.checked })} />
        {t('ccAutoCheck')}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.autoInstall} onChange={(e) => setForm({ ...form, autoInstall: e.target.checked })} />
        نصبِ خودکار — نسخهٔ تازه بی کلیک دانلود و نصب می‌شود و برنامه خودش دوباره باز می‌شود
      </label>
    </Modal>
  );
}

/** نوارِ «چند مگابایت آمده» برای نصبِ خودِ مرکز فرمان. */
function InstallBar({ p }: { p: InstallProgress }) {
  const pct = p.total > 0 ? Math.min(100, Math.round((p.got / p.total) * 100)) : 0;
  const label = p.phase === 'download' ? 'در حالِ دانلود' : p.phase === 'install' ? 'در حالِ نصب — پنل پس از آن خودش دوباره بالا می‌آید…' : 'در حالِ پرسیدن از گیت‌هاب…';
  return (
    <div className="mt-4 space-y-2 rounded-xl border p-3" style={{ borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)' }}>
      <p className="text-sm font-medium">
        {label}
        {p.phase === 'download' && (
          <span className="tnum" dir="ltr"> — {MB(p.got)}{p.total ? ` / ${MB(p.total)}` : ''} MB{p.total ? ` (${pct}%)` : ''}</span>
        )}
      </p>
      {p.phase === 'download' && p.total > 0 && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken" dir="ltr">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)', transition: 'width .4s' }} />
        </div>
      )}
      <p className="text-[11px] text-ink-muted">می‌توانید به بخشِ دیگری بروید؛ نصب روی سرور ادامه دارد و این‌جا دوباره دیده می‌شود.</p>
    </div>
  );
}

type AcctUpdate = {
  ok: boolean;
  current?: string;
  latest?: string;
  available?: boolean;
  size?: number;
  why?: string;
};

type AcctJob = {
  running: boolean;
  phase: 'idle' | 'check' | 'download' | 'extract' | 'swap' | 'restart' | 'verify' | 'done' | 'error';
  got: number;
  total: number;
  from: string;
  to: string;
  why: string;
  attempt: number;
  endedAt: number;
  code?: string;
  lines?: string[];
};

const MB = (n: number) => (n / 1048576).toFixed(1);

const PHASE: Record<AcctJob['phase'], string> = {
  idle: '',
  check: 'در حالِ پرسیدن از گیت‌هاب…',
  download: 'در حالِ دانلود',
  extract: 'در حالِ باز کردنِ بسته…',
  swap: 'در حالِ جابه‌جایی — سرورِ حساب یک لحظه خاموش است…',
  restart: 'در حالِ راه‌اندازیِ دوبارهٔ سرورِ حساب…',
  verify: 'در حالِ سنجیدنِ این‌که نسخهٔ تازه واقعاً بالا آمد…',
  done: '',
  error: '',
};

/**
 * ══ سرورِ حساب — همین‌جا، کنارِ خودِ مرکز فرمان ═══════════════════════════
 *
 * گزارشِ صاحب سامانه (۱۴۰۵/۰۷/۱۳): «بررسیِ به‌روزرسانی» را زد و چیزی نیامد،
 * چون سرورِ حساب (ورود، اشتراک، باتِ تلگرام) بستهٔ جدای خودش را دارد و تنها
 * درش کارِ «به‌روزرسانیِ سرورِ حساب» در «اتوماسیون» بود. ⛔ حالا همین صفحه
 * هر دو را نشان می‌دهد و یک دکمه نصبش می‌کند — همان `/api/account-server/update`
 * که آن کار هم می‌زند، پس راهِ دومی ساخته نشد.
 *
 * ⛔ و همان روز: «دانلود کنسل می‌شود، از سر می‌شود، با رفتن به بخشِ دیگر از
 * سر می‌شود و نشان نمی‌دهد چند مگابایت است.» کار حالا روی سرور است و این
 * کارت فقط هر ثانیه `/update/progress` را می‌خواند — رفتن و برگشتن همان کارِ
 * در جریان را نشان می‌دهد، نه دکمهٔ تازه.
 */
function AccountServerCard({ info, onDone }: { info: AcctUpdate | null; onDone: () => void }) {
  const [job, setJob] = useState<AcctJob | null>(null);
  const [starting, setStarting] = useState(false);

  const poll = useCallback(async () => {
    try {
      const j = await api<AcctJob>('/api/account-server/update/progress');
      setJob(j);
      return j;
    } catch {
      return null;
    }
  }, []);

  //  با باز شدنِ صفحه: اگر کاری در جریان است، همان را نشان بده
  useEffect(() => { poll(); }, [poll]);

  //  تا کار در جریان است، هر ثانیه
  const running = !!job?.running;
  useEffect(() => {
    if (!running) return;
    let alive = true;
    const timer = setInterval(async () => {
      const j = await poll();
      if (!alive || !j || j.running) return;
      if (j.phase === 'done') toast(j.why ? `سرورِ حساب: ${j.why}` : 'سرورِ حساب به‌روز شد', 'good');
      else if (j.phase === 'error') toast(j.why || 'به‌روزرسانی نشد', 'bad');
      onDone();
    }, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [running, poll, onDone]);

  if (!info && !job) return null;
  const pct = job && job.total > 0 ? Math.min(100, Math.round((job.got / job.total) * 100)) : 0;
  const showError = !running && job?.phase === 'error' && job.why;

  return (
    <Card title="سرورِ حساب (ورود، اشتراک، باتِ تلگرام)" icon={<ServerCog className="h-4 w-4" />}>
      <KV label="نسخهٔ نصب‌شده" mono>{info?.current || '—'}</KV>
      <KV label="تازه‌ترین نسخه" mono>{info?.latest || '—'}{info?.size ? ` · ${MB(info.size)} MB` : ''}</KV>

      {running && job && (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-medium">
            {PHASE[job.phase]}
            {job.phase === 'download' && (
              <span className="tnum" dir="ltr">
                {' '}— {MB(job.got)}{job.total ? ` / ${MB(job.total)}` : ''} MB{job.total ? ` (${pct}%)` : ''}
              </span>
            )}
            {job.phase === 'download' && job.attempt > 1 && <span className="text-ink-muted"> · تلاشِ {job.attempt} (ادامه از همان‌جا)</span>}
          </p>
          {job.phase === 'download' && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken" dir="ltr">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)', transition: 'width .4s' }} />
            </div>
          )}
          <p className="text-[11px] text-ink-muted">می‌توانید به بخشِ دیگری بروید؛ کار روی سرور ادامه دارد و این‌جا دوباره دیده می‌شود.</p>
        </div>
      )}

      {showError && (
        <p className="mt-3 text-sm" style={{ color: 'var(--status-critical)' }}>
          {job!.why}
          {job!.got > 0 && job!.total > 0 && job!.got < job!.total && (
            <span className="tnum" dir="ltr"> — {MB(job!.got)} / {MB(job!.total)} MB</span>
          )}
        </p>
      )}
      {/* ⛔ نسخهٔ تازه بالا نیامد و برگردانده شد — دلیلش همین‌جا، نه در لاگی که پیدا نمی‌شود */}
      {showError && !!job!.lines?.length && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-surface-sunken p-2 text-[11px] leading-5" dir="ltr">
          {job!.lines!.join('\n')}
        </pre>
      )}

      {!running && info && !info.ok && (
        <p className="mt-3 text-sm" style={{ color: 'var(--status-critical)' }}>{info.why || 'سنجیده نشد'}</p>
      )}
      {!running && info?.ok && info.available && (
        <div className="mt-3">
          <button
            className="btn btn-sm btn-primary"
            disabled={starting}
            onClick={async () => {
              setStarting(true);
              try {
                const out = await api<{ ok: boolean; started: boolean; progress: AcctJob }>('/api/account-server/update', { method: 'POST', body: {} });
                setJob(out.progress);
                if (!out.started) toast('به‌روزرسانیِ سرورِ حساب از قبل در جریان است', 'good');
              } catch (e) {
                toast((e as Error).message, 'bad');
              } finally {
                setStarting(false);
              }
            }}
          >
            <Download className="h-4 w-4" />
            {showError ? 'ادامهٔ به‌روزرسانی' : `به‌روز کردنِ سرورِ حساب به ${info.latest}`}
          </button>
          <p className="mt-2 text-[11px] text-ink-muted">دیتابیس و رازها دست نمی‌خورند؛ سرورِ حساب یک بار دوباره بالا می‌آید. اگر اینترنت قطع شد، دانلود از همان‌جا ادامه پیدا می‌کند.</p>
        </div>
      )}
      {!running && info?.ok && !info.available && (
        <p className="mt-3 text-sm" style={{ color: 'var(--status-good)' }}>سرورِ حساب به‌روز است.</p>
      )}
    </Card>
  );
}

type PumpVersion = { version: string; name: string | null; notes: string; publishedAt: string | null; mirroredAt: string | null; assets: { name: string; size: number }[] };
type PumpRelease = {
  enabled: boolean; mode: 'auto' | 'hold'; version: string | null; served: string | null; previous: string | null;
  waiting: boolean; checkedAt: string | null; error: string | null; releaseAt: string | null; versions: PumpVersion[];
  stable?: string | null; stableAt?: string | null; stableDays?: number;
  candidate?: { version: string; since: string | null; crashes: number; installs?: number } | null;
  minInstalls?: number;
  testers?: string[]; stations?: { code: string; name: string }[];
};

/**
 * 🚦 «آپدیت روی سرور باشد ولی تا خودم نخواهم به هیچ برنامه‌ای نرود» (۱۴۰۵/۰۷/۱۹)
 *
 * ⛔ این کارت هیچ تصمیمی نمی‌گیرد؛ همه در `pumpupdates/mirror.js` است. فقط حالت را
 * عوض می‌کند، یک نسخه را منتشر می‌کند، و نصابِ نسخهٔ نگه‌داشته را برای آزمودن روی
 * کامپیوترِ خودِ مدیر می‌دهد (از درِ پنل، نه درِ عمومی).
 */
function PumpReleaseCard() {
  const [st, setSt] = useState<PumpRelease | null>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    try { setSt(await api<PumpRelease>('/api/pump-updates-admin')); } catch { setSt(null); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!st) return null;

  const act = async (key: string, url: string, body: unknown, ok: string) => {
    setBusy(key);
    try { setSt(await api<PumpRelease>(url, { method: 'POST', body })); toast(ok, 'good'); }
    catch (e) { toast((e as Error).message, 'bad'); load(); }
    finally { setBusy(''); }
  };
  const token = (() => { try { return getToken() || ''; } catch { return ''; } })();
  const setupOf = (v: PumpVersion) => v.assets.find((a) => /Setup.*\.exe$/i.test(a.name));
  const hold = st.mode === 'hold';

  return (
    <Card title="به‌روزرسانیِ برنامهٔ پمپ — پخش به برنامه‌ها" icon={<Tag className="h-4 w-4" />}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium" style={{ color: hold ? 'var(--status-warning)' : 'var(--status-good)' }}>
          {hold ? '⏸ پخش خاموش است — هیچ نسخهٔ تازه‌ای به برنامه‌ها نمی‌رود' : '▶ پخش روشن است — نسخهٔ تازه خودکار به برنامه‌ها می‌رود'}
        </span>
        <button
          className={`btn btn-sm ${hold ? 'btn-primary' : ''}`}
          disabled={!!busy}
          onClick={() => act('mode', '/api/pump-updates-admin/mode', { mode: hold ? 'auto' : 'hold' },
            hold ? 'پخش روشن شد' : 'پخش خاموش شد — تا «انتشار» نزنید چیزی نمی‌رود')}
        >
          {hold ? 'روشن کردنِ پخشِ خودکار' : 'خاموش کردنِ پخش (اول خودم آزمایش می‌کنم)'}
        </button>
      </div>

      <div className="mt-3">
        <KV label="🛤️ کانالِ پایدار (پیش‌فرضِ همهٔ پمپ‌ها)" mono>{hold ? (st.served || '—') : (st.stable || st.served || '—')}</KV>
        <KV label="🧪 کانالِ آزمایشی" mono>{st.served || '— (هیچ نسخه‌ای)'}</KV>
        {!hold && st.candidate && (
          <KV label="نامزدِ پایدار">
            <span className="font-mono" dir="ltr">{st.candidate.version}</span>
            {' · '}{st.candidate.since ? `از ${relative(Date.parse(st.candidate.since), 'fa')}` : ''}
            {st.candidate.crashes > 0
              ? <span style={{ color: 'var(--status-critical)' }}> · {st.candidate.crashes} گزارشِ کرش — پایدار نمی‌شود</span>
              : <span className="text-ink-muted"> · پس از {st.stableDays ?? 7} روز بی کرش و دستِ‌کم روی {st.minInstalls ?? 3} دستگاه خودش پایدار می‌شود
                  {st.candidate.installs ? ` (تا حالا ${st.candidate.installs} دستگاه)` : ''}</span>}
          </KV>
        )}
        <KV label="تازه‌ترین نسخهٔ روی سرور" mono>{st.version || '—'}</KV>
        <KV label="آخرین پرسش از گیت‌هاب">{st.checkedAt ? relative(Date.parse(st.checkedAt), 'fa') : '—'}</KV>
      </div>
      {st.error && <p className="mt-2 text-sm" style={{ color: 'var(--status-critical)' }}>{st.error}</p>}
      {!st.enabled && <Notice tone="warn">آینهٔ آپدیتِ پمپ روی این نصب خاموش است.</Notice>}
      {st.waiting && (
        <Notice tone="warn">
          نسخهٔ {st.version} روی سرور آماده است ولی به هیچ برنامه‌ای نرفته
          {(st.testers?.length ?? 0) > 0 ? ' — جز پمپ‌های آزمایشیِ پایین، که خودشان از داخلِ برنامه می‌گیرندش' : ''}.
          {' '}درست بود «انتشار» را بزنید.
        </Notice>
      )}

      {/* 🧪 پمپ‌های آزمایشی (۱۴۰۵/۰۷/۲۱): تازه‌ترین نسخه از درونِ برنامه، فقط به همین‌ها */}
      <div className="mt-3 rounded-xl border border-line p-2.5">
        <p className="text-sm font-medium">🧪 کامپیوترهای آزمایشی</p>
        <p className="mt-1 text-[11px] text-ink-muted">
          پمپ‌های تیک‌خورده تازه‌ترین نسخهٔ روی سرور را از به‌روزرسانیِ خودِ برنامه می‌گیرند — حتی وقتی پخش خاموش است. بقیه همان نسخهٔ منتشرشده را می‌بینند.
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          {(st.stations || []).map((p) => {
            const on = (st.testers || []).includes(p.code);
            return (
              <label key={p.code} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!!busy}
                  onChange={() => {
                    const cur = st.testers || [];
                    const next = on ? cur.filter((c) => c !== p.code) : [...cur, p.code];
                    act('testers', '/api/pump-updates-admin/testers', { codes: next },
                      on ? `${p.name} دیگر آزمایشی نیست` : `${p.name} آزمایشی شد — نسخهٔ تازه از داخلِ برنامه می‌رسد`);
                  }}
                />
                {p.name} <span className="font-mono text-[11px] text-ink-muted" dir="ltr">{p.code}</span>
              </label>
            );
          })}
          {!(st.stations || []).length && <span className="text-sm text-ink-muted">هنوز هیچ پمپی به این سرور وصل نشده.</span>}
        </div>
      </div>

      <ul className="mt-3 space-y-2">
        {st.versions.map((v) => {
          const setup = setupOf(v);
          const live = v.version === st.served;
          return (
            <li key={v.version} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2.5 text-sm">
              <span className="font-mono" dir="ltr">{v.version}</span>
              {live && <span className="text-xs" style={{ color: 'var(--status-good)' }}>● پخش می‌شود</span>}
              {!live && <span className="text-xs text-ink-muted">نگه‌داشته</span>}
              {!hold && v.version === st.stable && <span className="text-xs" style={{ color: 'var(--status-good)' }}>● پایدار</span>}
              {v.mirroredAt && <span className="text-xs text-ink-muted">· رسید {relative(Date.parse(v.mirroredAt), 'fa')}</span>}
              <span className="flex-1" />
              {setup && (
                <a className="btn btn-sm" href={`/api/pump-updates-admin/files/${v.version}/${encodeURIComponent(setup.name)}?token=${encodeURIComponent(token)}`}>
                  <Download className="h-4 w-4" /> نصاب برای آزمایش ({MB(setup.size)} MB)
                </a>
              )}
              {!hold && v.version !== st.stable && (
                <button
                  className="btn btn-sm"
                  disabled={!!busy}
                  onClick={() => {
                    if (!window.confirm(`نسخهٔ ${v.version} همین حالا برای همهٔ پمپ‌هایی که کانالِ پایدار دارند برود؟`)) return;
                    act('st-' + v.version, '/api/pump-updates-admin/stable', { version: v.version }, `نسخهٔ ${v.version} پایدار شد`);
                  }}
                >
                  پایدار کن
                </button>
              )}
              {!live && (
                <button
                  className="btn btn-sm btn-primary"
                  disabled={!!busy}
                  onClick={() => {
                    if (!window.confirm(`نسخهٔ ${v.version} به همهٔ برنامه‌های پمپ برود؟`)) return;
                    act('pub-' + v.version, '/api/pump-updates-admin/publish', { version: v.version }, `نسخهٔ ${v.version} منتشر شد`);
                  }}
                >
                  انتشار برای همه
                </button>
              )}
            </li>
          );
        })}
        {!st.versions.length && <li className="text-sm text-ink-muted">هنوز هیچ نسخه‌ای از گیت‌هاب نیامده.</li>}
      </ul>

      <div className="mt-3 flex items-center gap-2">
        <button className="btn btn-sm" disabled={!!busy || !st.enabled}
          onClick={() => act('check', '/api/pump-updates-admin/check', {}, 'از گیت‌هاب پرسیده شد')}>
          <RefreshCw className="h-4 w-4" /> همین حالا از گیت‌هاب بپرس
        </button>
        <span className="text-[11px] text-ink-muted">خودش هم هر دو دقیقه می‌پرسد.</span>
      </div>
    </Card>
  );
}
