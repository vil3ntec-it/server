// ---------------------------------------------------------------------------
//  تکه‌های مشترکِ پوستهٔ «فروشگاه»: نگهبانِ خطای هر ماژول، حالت‌های یک‌دستِ بارگذاری/خطا/خالی/«پشتیبانی نمی‌شود»،
//  و پنجرهٔ کارِ حساس (دلیل + تأیید + رمزِ پنل + کلیدِ یکتایی). ماژول‌های تازه همین‌ها را به کار ببرند.
// ---------------------------------------------------------------------------
import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Ban, Inbox, Wrench } from 'lucide-react';

import { ApiError } from '../../../api';
import { Loading, Modal } from '../../../components/ui';
import { Notice } from '../../../control/ui';
import { newIdemKey, reasonOk } from '../consoleData';
import { useTx } from './text';

/* ───────────────────────── نگهبانِ خطای هر ماژول ───────────────────────── */

type BoundaryProps = { name: string; children: ReactNode; compact?: boolean; labels: { title: string; body: string; retry: string } };
type BoundaryState = { err: Error | null };

/**
 * ⛔ یک ماژولِ شکسته فقط خودش سرخ می‌شود — منوی بخش، جست‌وجو و ماژول‌های دیگر سرِ جایشان می‌مانند (همان قاعدهٔ
 * `PageBoundary`، یک لایه پایین‌تر). پوسته آن را با `key` ِ شناسهٔ ماژول می‌سازد، پس رفتن به ماژولِ دیگر پاکش می‌کند.
 */
export class ModuleBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { err: null };

  static getDerivedStateFromError(err: Error): BoundaryState {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error(`[ماژولِ «${this.props.name}» شکست]`, err, info.componentStack);
  }

  render() {
    const { err } = this.state;
    if (!err) return this.props.children;
    const { labels, compact, name } = this.props;
    return (
      <div role="alert" className={`rounded-2xl border ${compact ? 'p-3 text-xs' : 'p-5 text-sm'} leading-relaxed`}
           style={{ borderColor: 'color-mix(in srgb, var(--status-critical) 35%, transparent)',
                    background: 'color-mix(in srgb, var(--status-critical) 8%, transparent)' }}>
        <p className="mb-1 font-semibold" style={{ color: 'var(--status-critical)' }}>{labels.title.replace('{name}', name)}</p>
        {!compact && <p className="mb-2 text-ink-muted">{labels.body}</p>}
        <pre className="mb-2 overflow-x-auto rounded-lg bg-surface-sunken p-2 text-[11px] text-ink-muted" dir="ltr">{err.message || String(err)}</pre>
        <button className="btn btn-sm" onClick={() => this.setState({ err: null })}>{labels.retry}</button>
      </div>
    );
  }
}

/** همان نگهبان با برچسب‌های سه‌زبانه. */
export function Guarded({ name, children, compact }: { name: string; children: ReactNode; compact?: boolean }) {
  const tx = useTx();
  return (
    <ModuleBoundary name={name} compact={compact} labels={{
      title: tx('«{name}» باز نشد', '“{name}” failed to open', '«{name}» پرانیستل نشو'),
      body: tx('بقیهٔ بخشِ فروشگاه سرِ جایش است — از منو به ماژولِ دیگری بروید یا دوباره تلاش کنید.',
        'The rest of the Shop section still works — pick another module or try again.',
        'د هټۍ نوره برخه کار کوي — بل ماډل وټاکئ یا بیا هڅه وکړئ.'),
      retry: tx('دوباره تلاش کن', 'Try again', 'بیا هڅه'),
    }}>
      {children}
    </ModuleBoundary>
  );
}

/* ───────────────────────── حالت‌های یک‌دست ───────────────────────── */

export function StateLoading({ label }: { label?: string }) {
  return <Loading label={label} />;
}

export function StateEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 py-3 text-xs text-ink-muted"><Inbox size={14} />{children}</p>
  );
}

/** «پشتیبانی نمی‌شود» — صادقانه، با دلیل و آن‌چه لازم است؛ نه دکمهٔ بی‌عمل. */
export function NotSupported({ children, needs }: { children: ReactNode; needs?: string }) {
  const tx = useTx();
  return (
    <Notice tone="warn">
      <span className="flex items-center gap-1 font-semibold"><Wrench size={13} />{tx('پشتیبانی نمی‌شود', 'Not supported', 'ملاتړ نه کېږي')}</span>
      <span className="block">{children}</span>
      {needs && <code dir="ltr" className="mt-1 block font-mono text-[11px] text-ink-muted">{needs}</code>}
    </Notice>
  );
}

export function Forbidden({ children }: { children: ReactNode }) {
  return (
    <Notice tone="bad"><span className="flex items-center gap-1"><Ban size={13} />{children}</span></Notice>
  );
}

export const errText = (e: unknown) => (e instanceof ApiError ? `${e.message} (${e.code})` : String((e as Error)?.message || e));
export const errCode = (e: unknown) => (e instanceof ApiError ? e.code : '');

export function fmtTime(ms: unknown): string {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0
    ? new Date(n).toLocaleString('fa-AF', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';
}

/* ───────────────────────── پنجرهٔ کارِ حساس ───────────────────────── */

export type SensitiveSubmit = { reason: string; idempotencyKey: string; password?: string; confirmKey?: string };

/**
 * دلیل (۳ تا ۲۰۰) + تأیید + (در صورتِ نیاز) رمزِ پنل و نوشتنِ نامِ کلید + **یک** کلیدِ یکتایی برای همین پنجره
 * (دوبار زدن یا تکرارِ پس از قطعِ شبکه همان یک کار است). نتیجه را صداکننده نشان می‌دهد: «تأییدشده از سرور».
 */
export function SensitiveDialog({ title, effect, danger, needPassword, confirmKey, onSubmit, onClose, children, disabled }: {
  title: string; effect: ReactNode; danger?: boolean; needPassword?: boolean; confirmKey?: string;
  onSubmit: (x: SensitiveSubmit) => Promise<void>; onClose: () => void; children?: ReactNode; disabled?: boolean;
}) {
  const tx = useTx();
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [idem] = useState(newIdemKey);
  const ready = reasonOk(reason) && (!needPassword || password.length > 0) && (!confirmKey || typed === confirmKey) && !disabled;
  const send = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setErr('');
    try {
      await onSubmit({ reason: reason.trim(), idempotencyKey: idem, ...(needPassword ? { password } : {}), ...(confirmKey ? { confirmKey: typed } : {}) });
    } catch (e) {
      setErr(errText(e));
    } finally { setBusy(false); }
  };
  return createPortal(
    <Modal open onClose={onClose} title={title}
           footer={<>
             <button className="btn" onClick={onClose}>{tx('انصراف', 'Cancel', 'لغوه')}</button>
             <button className={danger ? 'btn btn-danger' : 'btn btn-primary'} disabled={!ready || busy} onClick={send}>
               {busy ? tx('در حالِ فرستادن…', 'Sending…', 'لېږل کېږي…') : tx('تأیید و فرستادن', 'Confirm and send', 'تایید او لېږل')}
             </button>
           </>}>
      <div className="space-y-3 text-sm">
        {children}
        <Notice tone={danger ? 'bad' : 'warn'}>{effect}</Notice>
        <label className="block text-xs">
          {tx('دلیل (در دفترِ رخداد می‌ماند، ۳ تا ۲۰۰ نویسه)', 'Reason (kept in the audit log, 3–200 chars)', 'لامل (د پېښو په دفتر کې پاتې کېږي، ۳–۲۰۰ توري)')}
          <textarea className="input mt-1 w-full" rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {confirmKey && (
          <label className="block text-xs">
            {tx('برای تأیید، «{k}» را بنویسید', 'To confirm, type “{k}”', 'د تایید لپاره «{k}» ولیکئ', { k: confirmKey })}
            <input className="input mt-1 w-full font-mono" dir="ltr" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
        )}
        {needPassword && (
          <label className="block text-xs">
            {tx('رمزِ پنلِ خودتان (احرازِ دوباره)', 'Your panel password (re-authentication)', 'ستاسو د پینل پټنوم (بیا تصدیق)')}
            <input className="input mt-1 w-full" type="password" dir="ltr" autoComplete="current-password" value={password}
                   onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>,
    document.body,
  );
}
