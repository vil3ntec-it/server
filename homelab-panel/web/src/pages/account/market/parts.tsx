// ---------------------------------------------------------------------------
//  تکه‌های مشترکِ ۴.۶ و ۴.۷: کارتِ خواندنی (بارگذاری/خطا/«نیست»/منبع)، برچسبِ کد، صفحه‌بندی، CSV، و دو پنجره:
//  «خاموش کردنِ یک سرویسِ دکان» (همان درِ حالت‌های دکان — درِ دومی ساخته نشد) و «کارِ حساس» (دلیل + رمز + تأیید).
// ---------------------------------------------------------------------------
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Download } from 'lucide-react';

import { api, ApiError, getToken } from '../../../api';
import { Card, Loading, Modal } from '../../../components/ui';
import { Notice } from '../../../control/ui';
import { isUnavailable, newIdemKey, reasonOk } from '../consoleData';
import { NotAvailable, Problem, SourceLine } from '../ShopConsole';
import type { Load } from '../shared';
import { ISSUE_LABEL, issuesOf, shownNum, type Issues } from './marketData';
import { useTx } from './tx';

export const errText = (e: unknown) => (e instanceof ApiError ? `${e.message} (${e.code})` : String(e));

export const moment = (ms: unknown) => {
  const n = typeof ms === 'number' ? ms : Number(ms);
  return Number.isFinite(n) && n > 0
    ? new Date(n).toLocaleString('fa-AF', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';
};

const TONE: Record<string, string> = {
  good: 'var(--status-good)', warn: 'var(--status-warning)', bad: 'var(--status-critical)', neutral: 'var(--text-muted)',
};
export function Chip({ tone = 'neutral', children, title }: { tone?: string; children: ReactNode; title?: string }) {
  const color = TONE[tone] || TONE.neutral;
  return (
    <span title={title} className="chip whitespace-nowrap" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}>
      {children}
    </span>
  );
}

/** کدهای «گیر کرده / ناهم‌خوان / اختلاف» — رنگِ هر نوع جدا؛ هیچ ⇒ «—». */
export function IssueChips({ issues }: { issues?: Issues | null }) {
  const { tri } = useTx();
  const list = issuesOf(issues);
  if (!list.length) return <span className="text-ink-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((x) => (
        <Chip key={`${x.kind}-${x.code}`} tone={x.kind === 'stuck' ? 'warn' : 'bad'} title={x.code}>
          {tri(ISSUE_LABEL[x.code], x.code)}
        </Chip>
      ))}
    </span>
  );
}

/** کارتِ خواندنی: خطا با کدِ خودش، «داده در دسترس نیست» با نامِ توانایی، و خطِ منبع و زمان. */
export function Box<D>({ title, icon, source, load, children, action }: {
  title: string; icon?: ReactNode; source: string; load: Load<D>; children: (d: D) => ReactNode; action?: ReactNode;
}) {
  return (
    <Card title={title} icon={icon} action={action}>
      {load.error ? <Problem load={load as Load<unknown>} />
        : !load.data ? <Loading />
        : isUnavailable(load.data) ? <NotAvailable data={load.data} />
        : (
          <>
            {children(load.data)}
            <SourceLine source={source} data={load.data} at={load.at} />
          </>
        )}
    </Card>
  );
}

export function Pager({ total, limit, offset, onChange }: { total?: number; limit: number; offset: number; onChange: (o: number) => void }) {
  const { tx } = useTx();
  const n = typeof total === 'number' ? total : null;
  return (
    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-ink-muted">
      <span>{n === null ? '—' : tx('{a}–{b} از {n}', '{a}–{b} of {n}', '{a}–{b} له {n}', {
        a: shownNum(n === 0 ? 0 : offset + 1), b: shownNum(Math.min(offset + limit, n)), n: shownNum(n),
      })}</span>
      <span className="flex gap-1">
        <button className="btn btn-sm" disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - limit))}>{tx('قبلی', 'Previous', 'مخکنی')}</button>
        <button className="btn btn-sm" disabled={n === null || offset + limit >= n} onClick={() => onChange(offset + limit)}>{tx('بعدی', 'Next', 'بل')}</button>
      </span>
    </div>
  );
}

/** دانلودِ CSV از پل (فقط admin؛ سرور می‌سنجد و یک ردیفِ دفتر می‌نویسد). نتیجه: شمارِ ردیف و «بریده شد؟». */
export function CsvButton({ url, name }: { url: string; name: string }) {
  const { tx } = useTx();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const go = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const token = getToken();
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) {
        let m = `${res.status}`;
        try { const j = await res.json(); m = `${j.message || ''} (${j.error || res.status})`; } catch { /* نه JSON */ }
        throw new Error(m);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      const rows = res.headers.get('X-Rows') || '—';
      setMsg({ tone: 'good', text: res.headers.get('X-Truncated') === 'true'
        ? tx('{n} ردیف (بریده در سقفِ ۵۰۰۰)', '{n} rows (cut at 5000)', '{n} کرښې (په ۵۰۰۰ پرې شوې)', { n: rows })
        : tx('{n} ردیف', '{n} rows', '{n} کرښې', { n: rows }) });
    } catch (e) { setMsg({ tone: 'bad', text: errText(e) }); }
    finally { setBusy(false); }
  };
  return (
    <span className="flex items-center gap-2">
      <button className="btn btn-sm" disabled={busy} onClick={go}><Download size={14} /> CSV</button>
      {msg && <span className="text-[11px]" style={{ color: msg.tone === 'good' ? 'var(--status-good)' : 'var(--status-critical)' }}>{msg.text}</span>}
    </span>
  );
}

/**
 * «خاموش کردنِ یک سرویسِ این دکان» یا برداشتنِ همان — ⛔ همان درِ حالت‌های دکان (`console/shops/:id/holds`)، نه درِ
 * دوم: کلیدِ یکتایی یکی برای همین پنجره، دلیلِ ۳ تا ۲۰۰، و اثرِ دقیق پیش از تأیید. نتیجه فقط «تأییدِ سرور».
 */
export function ServiceHoldDialog({ shopId, shopName, service, hold, onClose, onDone }: {
  shopId: string; shopName?: string; service: string; hold?: { id: string } | null; onClose: () => void; onDone: () => void;
}) {
  const { tx } = useTx();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [idem] = useState(newIdemKey);
  const lift = Boolean(hold);
  const send = async () => {
    if (!reasonOk(reason) || busy) return;
    setBusy(true);
    setErr('');
    try {
      const url = lift ? `/api/account-admin/console/shops/${encodeURIComponent(shopId)}/holds/${encodeURIComponent(hold!.id)}/lift`
        : `/api/account-admin/console/shops/${encodeURIComponent(shopId)}/holds`;
      const body = lift ? { reason: reason.trim(), confirm: true, idempotencyKey: idem }
        : { kind: 'service_disabled', service, reason: reason.trim(), confirm: true, idempotencyKey: idem };
      await api(url, { method: 'POST', body });
      onDone();
    } catch (e) { setErr(errText(e)); }
    finally { setBusy(false); }
  };
  return createPortal(
    <Modal open onClose={onClose}
           title={`${lift ? tx('روشن کردنِ دوباره', 'Re-enable', 'بیا فعالول') : tx('خاموش کردن', 'Disable', 'بندول')} · ${service} · ${shopName || shopId}`}
           footer={<>
             <button className="btn" onClick={onClose}>{tx('انصراف', 'Cancel', 'لغوه')}</button>
             <button className={lift ? 'btn btn-primary' : 'btn btn-danger'} disabled={!reasonOk(reason) || busy} onClick={send}>
               {busy ? '…' : tx('تأیید و فرستادن', 'Confirm and send', 'تایید او لېږل')}
             </button>
           </>}>
      <div className="space-y-3 text-sm">
        <Notice tone="warn">
          {lift
            ? tx('این حالت برداشته می‌شود و سرویس (اگر حالتِ دیگری نباشد) همان دم باز می‌شود؛ ردیفش در تاریخچه می‌ماند.',
              'The hold is lifted and the service reopens at once (if nothing else blocks it); the row stays in history.',
              'دا حالت لرې کېږي او خدمت سمدستي خلاصېږي؛ کرښه یې په تاریخچه کې پاتې کېږي.')
            : tx('فقط همین سرویس برای همین دکان خاموش می‌شود؛ دکان، داده، اشتراک و بقیهٔ سرویس‌ها دست نمی‌خورند و برگشت‌پذیر است.',
              'Only this service is turned off for this shop; the shop, its data, subscription and other services stay; reversible.',
              'یوازې همدا خدمت د همدې هټۍ لپاره بندېږي؛ هټۍ، معلومات او ګډون نه بدلېږي؛ بېرته کېدونکی دی.')}
        </Notice>
        <label className="block text-xs">
          {tx('دلیل (۳ تا ۲۰۰ نویسه — در سابقهٔ سرورِ حساب می‌ماند)', 'Reason (3–200 chars — kept in the account-server audit)', 'لامل (۳ تر ۲۰۰ توري)')}
          <textarea className="input mt-1 w-full" rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>,
    document.body,
  );
}

/**
 * پنجرهٔ کارِ حساس: محتوای خودِ کار (`children`)، دلیل، **رمزِ پنل** (احرازِ دوباره در سرور) و تأیید.
 * `send(reason, password)` خودِ درخواست است؛ خطا با کدِ خودش در همین پنجره.
 */
export function SensitiveDialog({ title, effect, children, ready = true, onClose, send }: {
  title: string; effect: string; children?: ReactNode; ready?: boolean; onClose: () => void;
  send: (reason: string, password: string) => Promise<void>;
}) {
  const { tx } = useTx();
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ok = ready && reasonOk(reason) && password.length > 0 && !busy;
  const go = async () => {
    if (!ok) return;
    setBusy(true);
    setErr('');
    try { await send(reason.trim(), password); }
    catch (e) { setErr(errText(e)); }
    finally { setBusy(false); setPassword(''); }
  };
  return createPortal(
    <Modal open onClose={onClose} title={title}
           footer={<>
             <button className="btn" onClick={onClose}>{tx('انصراف', 'Cancel', 'لغوه')}</button>
             <button className="btn btn-danger" disabled={!ok} onClick={go}>{busy ? '…' : tx('تأیید و فرستادن', 'Confirm and send', 'تایید او لېږل')}</button>
           </>}>
      <div className="space-y-3 text-sm">
        {children}
        <Notice tone="warn">{effect}</Notice>
        <label className="block text-xs">
          {tx('دلیل (۳ تا ۲۰۰ نویسه)', 'Reason (3–200 chars)', 'لامل (۳ تر ۲۰۰ توري)')}
          <textarea className="input mt-1 w-full" rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className="block text-xs">
          {tx('رمزِ پنلِ خودتان (احرازِ دوباره)', 'Your panel password (re-authentication)', 'ستاسو د پینل پټنوم (بیا تایید)')}
          <input className="input mt-1 w-full" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err && <Notice tone="bad">{err}</Notice>}
      </div>
    </Modal>,
    document.body,
  );
}
