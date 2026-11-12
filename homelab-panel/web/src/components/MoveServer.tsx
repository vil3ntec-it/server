// ---------------------------------------------------------------------------
//  «جابه‌جایی به کامپیوترِ دیگر» (۱.۵۰.۹۳) — سرور: ‎/api/move‎ (routes/move.js)
//
//  • `MoveServerCard` در «تنظیمات» (فقط مالک): ساختنِ فایل + دانلود، و بازگرداندن روی همین کامپیوتر (کنار گذاشتنِ
//    دادهٔ فعلی، پاک نه).
//  • `MoveRestore` در صفحهٔ نخستِ نصبِ تازه: فایل + رمز ⇒ سنجش ⇒ راه‌اندازیِ دوباره ⇒ «همان بسته است».
//  • `MoveResultBanner` در صفحهٔ ورود: نتیجهٔ آخرین بازگردانی (تا ۳۰ دقیقه) — رابط پس از راه‌اندازیِ دوباره
//    از صفحهٔ تنظیمات بیرون می‌افتد (نشست‌های کامپیوترِ قدیم آمده‌اند)، پس نتیجه همین‌جا هم دیده می‌شود.
//  ⛔ رمزِ فایل فقط در حافظهٔ همین صفحه؛ هیچ‌جا ذخیره نمی‌شود.
// ---------------------------------------------------------------------------
import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeftRight, CheckCircle2, Download, Loader2, Trash2, Upload } from 'lucide-react';
import { api, ApiError, getToken, openWithTicket } from '../api';
import { useApp } from '../app-context';
import { bytes } from '../format';
import { Card } from './ui';

type Summary = { files: number; tables: number; bytes: number; account: { reconciled: boolean; reason?: string | null }; outside: string[] };
type Job = { id: string; kind: 'export' | 'import'; state: 'running' | 'done' | 'failed'; step: string; error: string | null; result: any };
type PublicResult = { at: string; ok: boolean; same: boolean; diffs: number; files: number; tables: number; account: boolean };
type Info = {
  minPassphrase: number;
  maxBytes: number;
  busy: boolean;
  accountServer: { supervised: boolean; running: boolean };
  excluded: { what: string; why: string; optional: string | null }[];
  outside: string[];
  pending: boolean;
  lastImport: null | { at: string; ok: boolean; error?: string; previous?: string | null; summary?: Summary; compare?: { same: boolean; diffs: string[]; files: number } };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MIN_PASS = 12;

const STEP_KEY: Record<string, string> = {
  start: 'mvStepStart', 'panel-db': 'mvStepPanel', 'account-pause': 'mvStepPause', 'account-copy': 'mvStepCopy', pack: 'mvStepPack', verify: 'mvStepVerify',
};

function useErr() {
  const { t } = useApp();
  return (e: unknown): string => {
    if (e instanceof ApiError) {
      if (e.code === 'passphrase_too_short') return t('mvPassShort');
      if (e.code === 'not_vmove') return t('mvNotVmove');
      if (e.code === 'too_large') return t('mvTooLarge');
      if (e.code === 'busy') return t('mvBusy');
      if (e.code === 'setup_code_required') return t('setupCodeRequired');
      if (e.code === 'setup_code_invalid') return t('setupCodeInvalid');
      return e.message && e.message !== e.code ? e.message : e.code;
    }
    return e instanceof Error ? e.message : String(e);
  };
}

async function waitJob(id: string, onStep: (s: string) => void): Promise<Job> {
  for (;;) {
    const r = await api<{ job: Job }>(`/api/move/jobs/${id}`);
    if (r.job.state !== 'running') return r.job;
    onStep(r.job.step);
    await sleep(700);
  }
}

/** تکه‌تکه (هر تکه یک درخواستِ کوتاه — سقفِ زمانِ درخواستِ سرور به فایلِ چندگیگی نمی‌خورد)؛ قطعیِ کوتاه ⇒ از همان‌جا ادامه */
async function sendBundle(file: File, opts: { force?: boolean; setupCode?: string; onProgress: (p: number) => void }): Promise<string> {
  const begin = await api<{ uploadId: string; chunkBytes: number }>('/api/move/import/begin', {
    body: { size: file.size, force: opts.force, setupCode: opts.setupCode },
  });
  let off = 0;
  while (off < file.size) {
    const end = Math.min(file.size, off + begin.chunkBytes);
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
    const tok = getToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
    let res: Response | null = null;
    for (let attempt = 0; attempt < 5 && !res; attempt++) {
      try {
        res = await fetch(`/api/move/import/${begin.uploadId}/chunk?offset=${off}`, { method: 'PUT', headers, body: file.slice(off, end) });
      } catch {
        await sleep(1000 * (attempt + 1));
      }
    }
    if (!res) throw new ApiError(0, 'network');
    const json = await res.json().catch(() => null);
    if (res.status === 409 && json?.error === 'bad_offset' && typeof json.received === 'number') { off = json.received; continue; }
    if (!res.ok) throw new ApiError(res.status, json?.error || 'request_failed', json?.message);
    off = json.received;
    opts.onProgress(off / file.size);
  }
  return begin.uploadId;
}

/** پنل پایین می‌رود و برمی‌گردد؛ نتیجه از درِ بی‌ورود (پس از راه‌اندازیِ دوباره نشستِ فعلی دیگر معتبر نیست) */
async function waitRestart(since: number, onSlow: () => void): Promise<PublicResult> {
  const t0 = Date.now();
  let slow = false;
  for (;;) {
    await sleep(1500);
    if (!slow && Date.now() - t0 > 90_000) { slow = true; onSlow(); }
    try {
      const r = await fetch('/api/move/public', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j?.lastImport && Date.parse(j.lastImport.at) >= since - 5000) return j.lastImport as PublicResult;
      }
    } catch { /* هنوز پایین است */ }
  }
}

function Note({ tone, children }: { tone: 'good' | 'bad' | 'warn' | 'muted'; children: ReactNode }) {
  const color = tone === 'good' ? 'var(--status-good)' : tone === 'bad' ? 'var(--status-critical)' : 'var(--status-warning)';
  if (tone === 'muted') return <div className="mt-3 rounded-xl bg-surface-sunken px-3 py-2 text-xs leading-6 text-ink-muted">{children}</div>;
  return (
    <div className="mt-3 rounded-xl px-3 py-2 text-xs leading-6" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>
      {children}
    </div>
  );
}

function ResultNote({ r }: { r: PublicResult }) {
  const { t } = useApp();
  if (!r.ok) return <Note tone="bad">{t('mvFailed', { e: '' })} {t('mvNothingChanged')}</Note>;
  return (
    <Note tone={r.same ? 'good' : 'warn'}>
      {r.same ? t('mvSame', { files: r.files, tables: r.tables }) : t('mvDiff', { n: r.diffs })}
      <br />
      {t('mvLoginOld')}
    </Note>
  );
}

/* ─────────────── بازگرداندن (مشترکِ صفحهٔ نخست و تنظیمات) ─────────────── */

function RestoreForm({ force, setupCodeNeeded = false }: { force: boolean; setupCodeNeeded?: boolean }) {
  const { t } = useApp();
  const err = useErr();
  const [file, setFile] = useState<File | null>(null);
  const [pass, setPass] = useState('');
  const [code, setCode] = useState('');
  const [agree, setAgree] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'upload' | 'verify' | 'restart' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PublicResult | null>(null);
  const busy = phase === 'upload' || phase === 'verify' || phase === 'restart';

  async function go() {
    if (!file) return;
    if (pass.length < MIN_PASS) { setError(t('mvPassShort')); setPhase('error'); return; }
    setError(null);
    setSlow(false);
    try {
      setPhase('upload');
      setProgress(0);
      const setupCode = setupCodeNeeded ? code.trim() : undefined;
      const uploadId = await sendBundle(file, { force: force || undefined, setupCode, onProgress: setProgress });
      setPhase('verify');
      const since = Date.now();
      const r = await api<{ job: Job }>('/api/move/import/start', { body: { uploadId, passphrase: pass, force: force || undefined, setupCode } });
      const job = await waitJob(r.job.id, () => {});
      if (job.state !== 'done') throw new Error(job.error || 'failed');
      setPass('');
      setPhase('restart');
      setResult(await waitRestart(since, () => setSlow(true)));
      setPhase('done');
    } catch (e) {
      setError(err(e));
      setPhase('error');
    }
  }

  return (
    <div>
      <label className="label">{t('mvChoose')}</label>
      <input className="input" type="file" accept=".vmove" disabled={busy}
        onChange={(e) => { setFile(e.target.files?.[0] || null); setPhase('idle'); setError(null); }} />
      {file && <p className="mt-1 text-xs text-ink-muted" dir="ltr">{file.name} · {bytes(file.size)}</p>}
      <label className="label mt-3">{t('mvPass')}</label>
      <input className="input" type="password" value={pass} disabled={busy} autoComplete="off" onChange={(e) => setPass(e.target.value)} />
      {setupCodeNeeded && (
        <>
          <label className="label mt-3">{t('setupCode')}</label>
          <input className="input font-mono tracking-wider" dir="ltr" value={code} disabled={busy} placeholder="XXXX-XXXX-XXXX"
            autoComplete="one-time-code" onChange={(e) => setCode(e.target.value)} />
          <p className="mt-1.5 text-xs text-ink-muted">{t('setupCodeHint')}</p>
        </>
      )}
      {force && (
        <label className="mt-3 flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-1" checked={agree} disabled={busy} onChange={(e) => setAgree(e.target.checked)} />
          <span>{t('mvForce')}</span>
        </label>
      )}

      {phase === 'upload' && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
            <div className="h-full" style={{ width: `${Math.round(progress * 100)}%`, background: 'var(--accent)' }} />
          </div>
          <p className="mt-1 text-xs text-ink-muted">{t('mvUploading', { p: Math.round(progress * 100) })}</p>
        </div>
      )}
      {phase === 'verify' && <Note tone="muted"><Loader2 className="me-1 inline h-3.5 w-3.5 animate-spin" />{t('mvStepVerify')}</Note>}
      {phase === 'restart' && (
        <Note tone="good">
          <Loader2 className="me-1 inline h-3.5 w-3.5 animate-spin" />{t('mvRestarting')}
          {slow && <><br />{t('mvRestartSlow')}</>}
        </Note>
      )}
      {phase === 'error' && error && <Note tone="bad">{t('mvFailed', { e: error })} {t('mvNothingChanged')}</Note>}
      {phase === 'done' && result && (
        <>
          <ResultNote r={result} />
          <button type="button" className="btn btn-primary mt-3 w-full" onClick={() => window.location.reload()}>{t('mvGoLogin')}</button>
        </>
      )}

      {phase !== 'done' && (
        <button type="button" className="btn btn-primary mt-4 w-full" disabled={busy || !file || pass.length < MIN_PASS || (force && !agree) || (setupCodeNeeded && !code.trim())} onClick={go}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {t('mvRestore')}
        </button>
      )}
    </div>
  );
}

/** صفحهٔ نخستِ نصبِ تازه — به‌جای «ساختنِ مدیر» */
export function MoveRestore({ setupCodeNeeded, onBack }: { setupCodeNeeded: boolean; onBack: () => void }) {
  const { t } = useApp();
  return (
    <div className="card rise p-5">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><ArrowLeftRight className="h-4 w-4" />{t('mvFromFile')}</h2>
      <p className="mb-4 text-xs leading-6 text-ink-muted">{t('mvFromFileHint')}</p>
      <RestoreForm force={false} setupCodeNeeded={setupCodeNeeded} />
      <button type="button" className="btn mt-3 w-full" onClick={onBack}>{t('mvBackToSetup')}</button>
    </div>
  );
}

/** صفحهٔ ورود: نتیجهٔ آخرین بازگردانی (تا ۳۰ دقیقه پس از آن) */
export function MoveResultBanner() {
  const [r, setR] = useState<PublicResult | null>(null);
  useEffect(() => {
    fetch('/api/move/public', { cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)).then((j) => setR(j?.lastImport || null)).catch(() => {});
  }, []);
  if (!r) return null;
  return <div className="mb-3"><ResultNote r={r} /></div>;
}

/* ─────────────────────────── «تنظیمات» (مالک) ─────────────────────────── */

export function MoveServerCard() {
  const { t } = useApp();
  const err = useErr();
  const [info, setInfo] = useState<Info | null>(null);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [withBackups, setWithBackups] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<null | { id: string; name: string; size: number; summary: Summary; account: { paused: boolean; pauseMs: number; resumed: boolean | null } }>(null);
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    api<Info>('/api/move/info').then(setInfo).catch((e) => setError(err(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function make() {
    setError(null);
    if (pass.length < MIN_PASS) return setError(t('mvPassShort'));
    if (pass !== pass2) return setError(t('mvPassMismatch'));
    setMade(null);
    setStep('start');
    try {
      const r = await api<{ job: Job }>('/api/move/export', { body: { passphrase: pass, include: { backups: withBackups } } });
      const job = await waitJob(r.job.id, setStep);
      if (job.state !== 'done') throw new Error(job.error || 'failed');
      setMade(job.result);
      setPass('');
      setPass2('');
    } catch (e) {
      setError(err(e));
    } finally {
      setStep(null);
    }
  }

  async function drop() {
    if (!made) return;
    await api(`/api/move/export/${made.id}`, { method: 'DELETE' }).catch(() => {});
    setMade(null);
  }

  const last = info?.lastImport;
  return (
    <Card title={t('mvTitle')} icon={<ArrowLeftRight className="h-4 w-4" />}>
      <p className="text-xs leading-6 text-ink-muted">{t('mvIntro')}</p>

      {last && (
        <Note tone={last.ok && last.compare?.same ? 'good' : last.ok ? 'warn' : 'bad'}>
          <b>{t('mvLast')}:</b>{' '}
          {last.ok
            ? last.compare?.same
              ? t('mvSame', { files: last.summary?.files ?? 0, tables: last.summary?.tables ?? 0 })
              : t('mvDiff', { n: last.compare?.diffs.length ?? 0 })
            : t('mvFailed', { e: last.error || '' })}
          {last.ok && last.compare && !last.compare.same && (
            <ul className="mt-1 list-disc ps-5 font-mono text-[11px]" dir="ltr">{last.compare.diffs.slice(0, 8).map((d) => <li key={d}>{d}</li>)}</ul>
          )}
          {last.previous && <><br />{t('mvPrevious')} <span className="font-mono" dir="ltr">{last.previous}</span></>}
        </Note>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-line p-3">
          <h3 className="mb-1 text-xs font-semibold">{t('mvIncluded')}</h3>
          <p className="text-xs leading-6 text-ink-muted">{t('mvIncludedList')}</p>
        </div>
        <div className="rounded-xl border border-line p-3">
          <h3 className="mb-1 text-xs font-semibold">{t('mvExcluded')}</h3>
          <ul className="space-y-1 text-xs leading-5 text-ink-muted">
            {(info?.excluded || []).filter((x) => !['panel.db-wal', '*.part', '.vmove-*'].includes(x.what)).map((x) => (
              <li key={x.what}><span className="font-mono" dir="ltr">{x.what}</span> — {x.why}</li>
            ))}
          </ul>
        </div>
      </div>
      {!!info?.outside.length && (
        <Note tone="warn">
          {t('mvOutside')}
          <ul className="mt-1 list-disc ps-5 font-mono text-[11px]" dir="ltr">{info.outside.map((p) => <li key={p}>{p}</li>)}</ul>
        </Note>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">{t('mvPass')}</label>
          <input className="input" type="password" autoComplete="new-password" value={pass} disabled={!!step} onChange={(e) => setPass(e.target.value)} />
        </div>
        <div>
          <label className="label">{t('mvPass2')}</label>
          <input className="input" type="password" autoComplete="new-password" value={pass2} disabled={!!step} onChange={(e) => setPass2(e.target.value)} />
        </div>
      </div>
      <p className="mt-1.5 text-xs text-ink-muted">{t('mvPassHint')}</p>
      <label className="mt-3 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={withBackups} disabled={!!step} onChange={(e) => setWithBackups(e.target.checked)} />
        {t('mvWithBackups')}
      </label>
      {info?.accountServer.running && <Note tone="warn"><AlertTriangle className="me-1 inline h-3.5 w-3.5" />{t('mvShopPause')}</Note>}

      {step && <Note tone="muted"><Loader2 className="me-1 inline h-3.5 w-3.5 animate-spin" />{t((STEP_KEY[step] || 'mvStepStart') as any)}</Note>}
      {error && <Note tone="bad">{t('mvFailed', { e: error })}</Note>}

      <button type="button" className="btn btn-primary mt-4" disabled={!!step || !info || pass.length < MIN_PASS || pass !== pass2} onClick={make}>
        {step ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
        {t('mvMake')}
      </button>

      {made && (
        <div className="mt-4 rounded-xl border border-line p-3">
          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--status-good)' }}><CheckCircle2 className="h-4 w-4" />{t('mvReady')}</p>
          <p className="mt-1 font-mono text-xs" dir="ltr">{made.name} · {bytes(made.size)}</p>
          <p className="mt-1 text-xs text-ink-muted">
            {t('mvCounts', { files: made.summary.files, tables: made.summary.tables })} ·{' '}
            {made.summary.account.reconciled ? t('mvAccountOk') : t('mvAccountNo', { reason: made.summary.account.reason || '' })}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {made.account.paused ? t('mvPaused', { s: (made.account.pauseMs / 1000).toFixed(1) }) : t('mvNotPaused')} {t('mvKeepNote')}
          </p>
          {!!made.summary.outside.length && (
            <Note tone="warn">{t('mvOutside')} <span className="font-mono" dir="ltr">{made.summary.outside.join(' · ')}</span></Note>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={() => openWithTicket(`/api/move/export/${made.id}/download`)}>
              <Download className="h-4 w-4" />{t('mvDownload')}
            </button>
            <button type="button" className="btn" onClick={drop}><Trash2 className="h-4 w-4" />{t('mvDeleteFile')}</button>
          </div>
        </div>
      )}

      <div className="mt-5 border-t border-line pt-4">
        <button type="button" className="btn btn-sm" onClick={() => setShowImport((v) => !v)}>
          <Upload className="h-4 w-4" />{t('mvImportTitle')}
        </button>
        {showImport && (
          <div className="mt-3">
            <p className="mb-3 text-xs leading-6 text-ink-muted">{t('mvImportHint')}</p>
            <RestoreForm force />
          </div>
        )}
      </div>
    </Card>
  );
}
