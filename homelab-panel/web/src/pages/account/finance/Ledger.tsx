// ---------------------------------------------------------------------------
//  ماژولِ «مالی» (۴.۵) — دفترِ پرداخت‌ها، پروندهٔ هر پرداخت (سند، تغییرِ راهِ پیشین، سابقه)، سندِ اصلاحی و
//  فهرستِ سندها (بازپرداخت/اصلاح/ابطال/شمارهٔ تراکنش)، و خروجیِ CSV ِ صفحه‌به‌صفحه.
//
//  ⛔ هیچ ویرایش یا حذفی نیست: اصلاح = سندِ تازه (`AdjustDialog`) با دلیل، رمزِ پنل (احرازِ دوباره)، تأیید و
//     کلیدِ یکتایی (یکی برای هر پنجره ⇒ دوبار زدن یک سند است). نتیجه فقط از پاسخِ سرورِ حساب نشان داده می‌شود.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileText, ReceiptText } from 'lucide-react';

import { api, ApiError } from '../../../api';
import { Loading, Modal, toast } from '../../../components/ui';
import { useApp } from '../../../app-context';
import { ActionButton, Cell, KV, Notice, Row, Table } from '../../../control/ui';
import { fa, money, useLoad } from '../shared';
import { newIdemKey } from '../consoleData';
import { useFinT, type FinKey, type FinT } from './strings';
import {
  KINDS, actorText, dateOf, downloadCsv, finUrl, isUnavail, timeOf,
  type AdjustResult, type Adjustments, type Kind, type Payment, type PaymentDetail, type Payments, type Unavail,
} from './data';
import { AppSelect, FinCard, Problem, SourceLine, Unavailable, appLabel } from './parts';

const KIND_LABEL: Record<string, FinKey> = {
  correction: 'kindCorrection', refund: 'kindRefund', reversal: 'kindReversal', reference: 'kindReference',
};
const METHOD: Record<string, string> = { cash: 'نقد', hawala: 'حواله', exchange: 'صرافی' };
const errText = (e: unknown) => (e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));

function Chips({ p }: { p: Payment }) {
  const ft = useFinT();
  const chips: [string, string][] = [];
  if (p.deleted) chips.push([ft('deleted'), 'var(--status-critical)']);
  if (p.adjustments?.reversed) chips.push([ft('reversed'), 'var(--status-critical)']);
  if (p.adjustments?.refunded) chips.push([ft('refunded'), 'var(--status-warning)']);
  if (p.adjustments?.count && p.adjustments.total && !p.adjustments.reversed && !p.adjustments.refunded) chips.push([ft('corrected'), 'var(--status-warning)']);
  if (p.revisions) chips.push([ft('edited'), 'var(--status-warning)']);
  if (!chips.length) return <span className="text-[11px] text-ink-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {chips.map(([label, color]) => (
        <span key={label} className="chip whitespace-nowrap" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}>{label}</span>
      ))}
    </span>
  );
}

/** دکمهٔ خروجیِ CSV؛ اگر سرورِ حساب صفحهٔ بعد را گفت، دکمهٔ «صفحهٔ بعدیِ خروجی». */
function ExportButton({ q, label }: { q: Record<string, string | number | undefined>; label: string }) {
  const ft = useFinT();
  const [next, setNext] = useState<string | null>(null);
  const run = async (cursor?: string | null) => {
    try {
      const out = await downloadCsv({ ...q, cursor: cursor || undefined });
      setNext(out.next);
      toast(ft('exportDone', { n: fa(out.rows) }));
    } catch (e) { toast(errText(e), 'bad'); }
  };
  return (
    <span className="flex gap-2">
      <ActionButton onClick={() => run(null)}><Download size={14} /> {label}</ActionButton>
      {next && <ActionButton onClick={() => run(next)}>{ft('exportNext')}</ActionButton>}
    </span>
  );
}

/* ─────────────────────────────── دفترِ پرداخت‌ها ─────────────────────────────── */

type Filters = { q: string; status: string; method: string; currency: string; app: string; fromDate: string; toDate: string };

export function PaymentsView() {
  const ft = useFinT();
  const { can } = useApp();
  const [f, setF] = useState<Filters>({ q: '', status: 'all', method: '', currency: '', app: 'all', fromDate: '', toDate: '' });
  const [applied, setApplied] = useState(f);
  const [extra, setExtra] = useState<Payment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState<string>('');
  const q = {
    q: applied.q || undefined, status: applied.status, method: applied.method || undefined, currency: applied.currency || undefined,
    app: applied.app, fromDate: applied.fromDate || undefined, toDate: applied.fromDate ? (applied.toDate || undefined) : undefined, limit: 50,
  };
  const url = finUrl('/payments', q);
  const load = useLoad<Payments | Unavail>(url);
  useEffect(() => { setExtra([]); setCursor(null); }, [url]);
  const first = load.data && !isUnavail(load.data) ? load.data : null;
  const rows = [...(first?.payments || []), ...extra];
  const nextCursor = cursor ?? first?.nextCursor ?? null;
  const more = async () => {
    try {
      const page = await api<Payments>(finUrl('/payments', { ...q, cursor: nextCursor }));
      setExtra((x) => [...x, ...(page.payments || [])]);
      setCursor(page.nextCursor || '');
    } catch (e) { toast(errText(e), 'bad'); }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <input className="input w-full sm:w-72" placeholder={ft('search')} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })}
               onKeyDown={(e) => { if (e.key === 'Enter') setApplied(f); }} />
        <select className="input w-auto" value={f.status} aria-label={ft('status')} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="all">{ft('statusAll')}</option>
          <option value="active">{ft('statusActive')}</option>
          <option value="deleted">{ft('statusDeleted')}</option>
        </select>
        <select className="input w-auto" value={f.method} aria-label={ft('method')} onChange={(e) => setF({ ...f, method: e.target.value })}>
          <option value="">{ft('anyMethod')}</option>
          {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input w-auto" value={f.currency} aria-label={ft('anyCurrency')} onChange={(e) => setF({ ...f, currency: e.target.value })}>
          <option value="">{ft('anyCurrency')}</option>
          <option value="AFN">AFN</option>
          <option value="USD">USD</option>
        </select>
        <AppSelect value={f.app} onChange={(app) => setF({ ...f, app })} />
        <label className="text-xs">{ft('from')} <input type="date" dir="ltr" className="input w-auto" value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} /></label>
        <label className="text-xs">{ft('to')} <input type="date" dir="ltr" className="input w-auto" value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></label>
        <button className="btn btn-sm btn-primary" onClick={() => setApplied(f)}>{ft('apply')}</button>
        {can('admin') && <ExportButton q={{ ...q, dataset: 'payments', limit: undefined }} label={ft('export')} />}
      </div>
      {!can('admin') && <p className="text-[11px] text-ink-muted">{ft('exportOnly')}</p>}

      <FinCard title={ft('tabPayments')} icon={<ReceiptText size={16} />} source="/api/admin/finance/payments" load={load}>
        {() => (
          <>
            {rows.length === 0 ? <Notice>{ft('noPayments')}</Notice> : (
              <Table head={[ft('date'), ft('shop'), ft('receipt'), ft('amount'), ft('net'), ft('method'), ft('refs'), ft('status')]}>
                {rows.map((p) => (
                  <Row key={p.id} onClick={() => setOpen(p.id)}>
                    <Cell>{dateOf(p.paidAt)}</Cell>
                    <Cell>{p.tenantName || <code dir="ltr" className="font-mono text-xs">{p.tenantId}</code>} <span className="text-[11px] text-ink-muted">· {appLabel(ft, p.app)}</span></Cell>
                    <Cell mono>{p.receiptNo || '—'}</Cell>
                    <Cell style={p.deleted ? { textDecoration: 'line-through' } : undefined}>{money(p.amount, p.currency)}</Cell>
                    <Cell><b>{p.deleted ? '—' : money(p.net, p.currency)}</b></Cell>
                    <Cell>{METHOD[p.method] || p.method}</Cell>
                    <Cell mono>{p.references?.length ? p.references.join('، ') : '—'}</Cell>
                    <Cell><Chips p={p} /></Cell>
                  </Row>
                ))}
              </Table>
            )}
            {nextCursor && <div className="mt-3"><ActionButton onClick={more}>{ft('more')}</ActionButton></div>}
          </>
        )}
      </FinCard>
      {open && <PaymentModal id={open} onClose={() => setOpen('')} onChanged={() => { setExtra([]); setCursor(null); void load.reload(); }} />}
    </div>
  );
}

/* ─────────────────────────────── پروندهٔ یک پرداخت ─────────────────────────────── */

function PaymentModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const ft = useFinT();
  const { can } = useApp();
  const load = useLoad<PaymentDetail | Unavail>(finUrl(`/payments/${encodeURIComponent(id)}`));
  const [adjusting, setAdjusting] = useState(false);
  const d = load.data && !isUnavail(load.data) ? load.data : null;
  const p = d?.payment;
  return createPortal(
    <Modal open wide onClose={onClose} title={`${ft('detail')} — ${p?.receiptNo || id}`}
           footer={<>
             {p && !p.deleted && can('admin') && <button className="btn btn-primary" onClick={() => setAdjusting(true)}>{ft('newDoc')}</button>}
             <button className="btn" onClick={onClose}>{ft('close')}</button>
           </>}>
      {load.error ? <Problem load={load as never} /> : !load.data ? <Loading /> : isUnavail(load.data) ? <Unavailable data={load.data} /> : p && d ? (
        <div className="space-y-4 text-sm">
          <div className="grid gap-x-6 sm:grid-cols-2">
            <KV label={ft('shop')}>{p.tenantName || p.tenantId} · {appLabel(ft, p.app)}</KV>
            <KV label={ft('paidAt')}>{timeOf(p.paidAt)}</KV>
            <KV label={ft('amount')}>{money(p.amount, p.currency)}</KV>
            <KV label={ft('netNow')}><b>{p.deleted ? '—' : money(p.net, p.currency)}</b></KV>
            <KV label={ft('method')}>{METHOD[p.method] || p.method}</KV>
            <KV label={ft('receipt')} mono>{p.receiptNo || '—'}</KV>
            <KV label={ft('subscription')} mono>{p.subscriptionId || '—'}</KV>
            <KV label={ft('plan')}>{p.plan || '—'}</KV>
            <KV label={ft('createdBy')} mono>{p.createdBy || '—'}</KV>
            <KV label={ft('status')}><Chips p={p} /></KV>
          </div>
          <section>
            <h3 className="mb-2 text-sm font-semibold">{ft('docs')}</h3>
            {d.adjustments.length === 0 ? <p className="text-xs text-ink-muted">{ft('noDocs')}</p> : (
              <Table head={[ft('docNo'), ft('kind'), ft('amount'), ft('net'), ft('refs'), ft('reason'), ft('actor'), ft('date')]}>
                {d.adjustments.map((a) => (
                  <Row key={a.id}>
                    <Cell mono>{a.docNo}</Cell>
                    <Cell>{ft(KIND_LABEL[a.kind] || 'kind')}</Cell>
                    <Cell>{a.amount ? money(a.amount, a.currency) : '—'}</Cell>
                    <Cell>{money(a.netBefore, a.currency)} ← {money(a.netAfter, a.currency)}</Cell>
                    <Cell mono>{a.reference || '—'}</Cell>
                    <Cell>{a.reason}</Cell>
                    <Cell>{actorText(a.actor, a.createdBy)}</Cell>
                    <Cell>{timeOf(a.createdAt)}</Cell>
                  </Row>
                ))}
              </Table>
            )}
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold">{ft('revisions')}</h3>
            {d.revisions.length === 0 ? <p className="text-xs text-ink-muted">{ft('noRevisions')}</p> : (
              <Table head={[ft('date'), ft('changed'), ft('before'), ft('after')]}>
                {d.revisions.map((r) => (
                  <Row key={r.id}>
                    <Cell>{timeOf(r.changedAt)}</Cell>
                    <Cell mono>{r.op === 'DELETE' ? 'DELETE' : r.changed.join(', ') || '—'}</Cell>
                    <Cell mono>{r.changed.map((k) => `${k}=${JSON.stringify(r.before?.[k] ?? null)}`).join(' · ') || '—'}</Cell>
                    <Cell mono>{r.after ? r.changed.map((k) => `${k}=${JSON.stringify(r.after?.[k] ?? null)}`).join(' · ') : '—'}</Cell>
                  </Row>
                ))}
              </Table>
            )}
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold">{ft('audit')}</h3>
            <Table head={[ft('date'), ft('action'), ft('actor'), ft('reason')]} empty={d.audit.length === 0}>
              {d.audit.map((x) => (
                <Row key={x.id}>
                  <Cell>{timeOf(x.at)}</Cell>
                  <Cell>{actionLabel(ft, x.action)}</Cell>
                  <Cell>{actorText(x.actor, x.adminId)}</Cell>
                  <Cell>{typeof x.detail?.reason === 'string' ? x.detail.reason : '—'}</Cell>
                </Row>
              ))}
            </Table>
          </section>
          <SourceLine source={`/api/admin/finance/payments/${id}`} data={d} at={load.at} />
          {adjusting && <AdjustDialog payment={p} onClose={() => setAdjusting(false)}
                                      onDone={() => { setAdjusting(false); void load.reload(); onChanged(); }} />}
        </div>
      ) : null}
    </Modal>,
    document.body,
  );
}

export function actionLabel(ft: FinT, action: string): string {
  const key = `a_${action.replace(/^admin\./, '')}` as FinKey;
  const s = ft(key);
  return s === key ? action : s;
}

/* ─────────────────────────────── سندِ اصلاحی ─────────────────────────────── */

function AdjustDialog({ payment, onClose, onDone }: { payment: Payment; onClose: () => void; onDone: () => void }) {
  const ft = useFinT();
  const [kind, setKind] = useState<Kind>('refund');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<AdjustResult | null>(null);
  //  ⛔ یک کلید برای هر پنجره: دوبار زدن یا تکرار پس از قطعِ شبکه همان یک سند است
  const [idem] = useState(newIdemKey);
  const n = Number(amount);
  const amountOk = kind === 'reversal' || kind === 'reference' || (amount.trim() !== '' && Number.isSafeInteger(n) && n !== 0 && (kind !== 'refund' || n > 0));
  const ok = amountOk && reason.trim().length >= 3 && password.length > 0 && ack && (kind !== 'reference' || reference.trim().length > 0);
  const effect: Record<Kind, string> = {
    correction: ft('effectCorrection'), refund: ft('effectRefund'),
    reversal: ft('effectReversal', { net: money(payment.net, payment.currency) }), reference: ft('effectReference'),
  };
  const send = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setErr('');
    try {
      const out = await api<AdjustResult>(finUrl('/adjustments'), {
        method: 'POST',
        body: {
          paymentId: payment.id, kind, reason: reason.trim(), confirm: true, idempotencyKey: idem, password,
          expectedNet: payment.net,
          ...(kind === 'correction' || kind === 'refund' ? { amount: n } : {}),
          ...(reference.trim() ? { reference: reference.trim() } : {}),
        },
      });
      setPassword('');
      setResult(out);
    } catch (e) {
      setPassword('');
      setErr(errText(e));
    } finally { setBusy(false); }
  };
  return createPortal(
    <Modal open onClose={onClose} title={`${ft('newDoc')} — ${payment.receiptNo || payment.id}`}
           footer={result ? <button className="btn btn-primary" onClick={onDone}>{ft('close')}</button> : <>
             <button className="btn" onClick={onClose}>{ft('cancel')}</button>
             <button className="btn btn-danger" disabled={!ok || busy} onClick={send}>{busy ? ft('sending') : ft('send')}</button>
           </>}>
      {result ? (
        <Notice tone="good">
          <b>{ft('serverConfirmed')}</b> — {result.replayed
            ? ft('docReplayed', { doc: result.adjustment?.docNo || '—' })
            : ft('docSaved', { doc: result.adjustment?.docNo || '—', net: money(result.adjustment?.netAfter ?? null, payment.currency) })}
        </Notice>
      ) : (
        <div className="space-y-3 text-sm">
          <KV label={ft('netNow')}>{money(payment.net, payment.currency)}</KV>
          <select className="input w-full" value={kind} aria-label={ft('kind')} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map((k) => <option key={k} value={k}>{ft(KIND_LABEL[k])}</option>)}
          </select>
          <Notice tone="warn">{effect[kind]}</Notice>
          {(kind === 'correction' || kind === 'refund') && (
            <label className="block text-xs">{ft('amount')} ({payment.currency})
              <input className="input mt-1 w-full" dir="ltr" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
          )}
          <label className="block text-xs">{ft('reference')}
            <input className="input mt-1 w-full" dir="ltr" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
          <label className="block text-xs">{ft('reason')}
            <textarea className="input mt-1 w-full" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label className="block text-xs">{ft('password')}
            <input className="input mt-1 w-full" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> {ft('ack')}
          </label>
          {err && <Notice tone="bad">{err}</Notice>}
        </div>
      )}
    </Modal>,
    document.body,
  );
}

/* ─────────────────────────────── فهرستِ سندها ─────────────────────────────── */

export function AdjustmentsView() {
  const ft = useFinT();
  const { can } = useApp();
  const [kind, setKind] = useState<string>('refund');
  const [app, setApp] = useState('all');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [extra, setExtra] = useState<Adjustments['adjustments']>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const query = { kind: kind || undefined, app, q: applied || undefined, limit: 50 };
  const url = finUrl('/adjustments', query);
  const load = useLoad<Adjustments | Unavail>(url);
  useEffect(() => { setExtra([]); setCursor(null); }, [url]);
  const first = load.data && !isUnavail(load.data) ? load.data : null;
  const rows = [...(first?.adjustments || []), ...extra];
  const nextCursor = cursor ?? first?.nextCursor ?? null;
  const more = async () => {
    try {
      const page = await api<Adjustments>(finUrl('/adjustments', { ...query, cursor: nextCursor }));
      setExtra((x) => [...x, ...(page.adjustments || [])]);
      setCursor(page.nextCursor || '');
    } catch (e) { toast(errText(e), 'bad'); }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <select className="input w-auto" value={kind} aria-label={ft('kind')} onChange={(e) => setKind(e.target.value)}>
          <option value="">{ft('kindAll')}</option>
          {KINDS.map((k) => <option key={k} value={k}>{ft(KIND_LABEL[k])}</option>)}
        </select>
        <AppSelect value={app} onChange={setApp} />
        <input className="input w-full sm:w-64" placeholder={ft('search')} value={q} onChange={(e) => setQ(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') setApplied(q.trim()); }} />
        <button className="btn btn-sm btn-primary" onClick={() => setApplied(q.trim())}>{ft('apply')}</button>
        {can('admin') && <ExportButton q={{ dataset: 'adjustments', kind: kind || undefined, app, q: applied || undefined }} label={ft('exportAdj')} />}
      </div>
      <FinCard title={ft('tabAdjustments')} icon={<FileText size={16} />} source="/api/admin/finance/adjustments" load={load}>
        {(d) => (
          <>
            {Object.keys(d.totals || {}).length > 0 && (
              <p className="mb-2 text-xs">
                {ft('total')}: {Object.entries(d.totals).map(([cur, b]) => `${money(b.amount, cur)} (${fa(b.count)})`).join(' · ')}
              </p>
            )}
            {rows.length === 0 ? <Notice>{ft('noAdjustments')}</Notice> : (
              <Table head={[ft('docNo'), ft('kind'), ft('shop'), ft('receipt'), ft('amount'), ft('refs'), ft('reason'), ft('actor'), ft('date')]}>
                {rows.map((a) => (
                  <Row key={a.id}>
                    <Cell mono>{a.docNo}</Cell>
                    <Cell>{ft(KIND_LABEL[a.kind] || 'kind')}</Cell>
                    <Cell>{a.tenantName || a.tenantId} <span className="text-[11px] text-ink-muted">· {appLabel(ft, a.app)}</span></Cell>
                    <Cell mono>{a.receiptNo || '—'}</Cell>
                    <Cell>{a.amount ? money(a.amount, a.currency) : '—'}</Cell>
                    <Cell mono>{a.reference || '—'}</Cell>
                    <Cell>{a.reason}</Cell>
                    <Cell>{actorText(a.actor, a.createdBy)}</Cell>
                    <Cell>{timeOf(a.createdAt)}</Cell>
                  </Row>
                ))}
              </Table>
            )}
            {nextCursor && <div className="mt-3"><ActionButton onClick={more}>{ft('more')}</ActionButton></div>}
          </>
        )}
      </FinCard>
    </div>
  );
}
