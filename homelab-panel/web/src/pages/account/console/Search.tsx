// ---------------------------------------------------------------------------
//  🔎 جست‌وجوی سراسریِ بخشِ «فروشگاه» — دکان، کاربر، پرداخت، سفارش، خطا، مدیر و کاربرِ پنل، با شناسه یا نام
//
//  ⛔ جست‌وجو در **سرور** است (‎/api/account-admin/console/search‎ ⇐ ‎/api/admin/search‎ ِ سرورِ حساب، به نقش) —
//     مرورگر چیزی را برش نمی‌دهد. هر منبع جدا: یکی شکست بخورد یا نسخهٔ سرورِ حساب نداشته باشد، همان یکی با کدش
//     «—»/«پشتیبانی نمی‌شود» است و بقیه می‌آیند. نتیجه پیوندِ مستقیم به جای خودش در همین بخش است.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search as SearchIcon, X } from 'lucide-react';

import { api } from '../../../api';
import { SHELL_API } from './contract';
import { errText, fmtTime } from './parts';
import { useTx, type Tx } from './text';

type Row = Record<string, unknown>;
type Source = { kind: string; module: string; ok: boolean; items?: Row[]; error?: { code: string; message: string } };
type Result = { q: string; results: Source[]; searchCapability: boolean; fetchedAt: number };

const s = (x: unknown) => (x === null || x === undefined ? '' : String(x));

function kindLabel(tx: Tx, kind: string) {
  switch (kind) {
    case 'shops': return tx('دکان‌ها', 'Shops', 'هټۍ');
    case 'users': return tx('کاربرانِ دکان', 'Shop users', 'د هټۍ کاروونکي');
    case 'payments': return tx('پرداخت‌ها', 'Payments', 'تادیې');
    case 'orders': return tx('سفارش‌ها', 'Orders', 'فرمایشونه');
    case 'errors': return tx('خطاها', 'Errors', 'تېروتنې');
    case 'admins': return tx('مدیرانِ سرورِ حساب', 'Account-server admins', 'د حساب سرور مدیران');
    case 'panelUsers': return tx('کاربرانِ پنل', 'Panel users', 'د پینل کاروونکي');
    default: return kind;
  }
}

/** هر ردیف ⇒ عنوان، زیرعنوان و نشانیِ مستقیم در همین بخش. */
function view(kind: string, r: Row): { title: string; sub: string; to: string } {
  const id = s(r.id);
  switch (kind) {
    case 'shops': return { title: s(r.name) || id, sub: [id, s(r.owner_email), s(r.status)].filter(Boolean).join(' · '), to: `/shop?tab=shops&shop=${encodeURIComponent(id)}` };
    case 'users': return { title: s(r.name) || id, sub: [s(r.email), s(r.shop_name), s(r.status)].filter(Boolean).join(' · '),
      to: `/shop?tab=shops&q=${encodeURIComponent(s(r.email) || s(r.name) || id)}` };
    case 'payments': return { title: `${s(r.amount)} ${s(r.currency)}`.trim() || id, sub: [s(r.receipt_no), s(r.tenant_id), fmtTime(r.paid_at)].filter(Boolean).join(' · '), to: '/shop?tab=finance' };
    case 'orders': return { title: `#${s(r.order_no) || id}`, sub: [s(r.status), s(r.payment_status), s(r.shop_id)].filter(Boolean).join(' · '),
      to: r.shop_id ? `/shop?tab=shops&shop=${encodeURIComponent(s(r.shop_id))}` : '/shop?tab=shops' };
    case 'errors': return { title: s(r.message).slice(0, 120) || id, sub: [s(r.app), s(r.app_version), fmtTime(r.at)].filter(Boolean).join(' · '), to: '/shop?tab=health' };
    case 'admins': return { title: s(r.username) || id, sub: [s(r.name), s(r.role), s(r.status)].filter(Boolean).join(' · '), to: `/shop?tab=users&admin=${encodeURIComponent(id)}` };
    case 'panelUsers': return { title: s(r.username) || id, sub: [s(r.role), r.disabled ? 'disabled' : ''].filter(Boolean).join(' · '), to: '/shop?tab=users' };
    default: return { title: id, sub: '', to: '/shop' };
  }
}

export default function ConsoleSearch() {
  const tx = useTx();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  //  ⏱ ۳۵۰ میلی‌ثانیه پس از آخرین حرف؛ پاسخِ کهنه‌تر روی تازه‌تر نمی‌نشیند
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRes(null); setErr(''); return undefined; }
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const out = await api<Result>(SHELL_API.search(term));
        if (my === seq.current) { setRes(out); setErr(''); }
      } catch (e) {
        if (my === seq.current) { setErr(errText(e)); setRes(null); }
      } finally {
        if (my === seq.current) setBusy(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const total = res ? res.results.reduce((n, x) => n + (x.ok && x.items ? x.items.length : 0), 0) : 0;
  return (
    <div ref={box} className="relative w-full sm:w-80" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
      <label className="sr-only" htmlFor="shop-console-search">{tx('جست‌وجو در بخشِ فروشگاه', 'Search the Shop section', 'په هټۍ برخه کې لټون')}</label>
      <div className="relative">
        <SearchIcon size={14} className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-muted" style={{ insetInlineStart: 10 }} />
        <input id="shop-console-search" className="input w-full" style={{ paddingInlineStart: 30 }} value={q}
               placeholder={tx('دکان، کاربر، پرداخت، سفارش، خطا… (شناسه یا نام)', 'Shop, user, payment, order, error… (id or name)', 'هټۍ، کاروونکی، تادیه، فرمایش، تېروتنه… (پېژند یا نوم)')}
               onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} autoComplete="off" />
        {q && (
          <button className="absolute top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted hover:bg-surface-raised" style={{ insetInlineEnd: 6 }}
                  aria-label={tx('پاک کردن', 'Clear', 'پاکول')} onClick={() => { setQ(''); setRes(null); }}>
            <X size={13} />
          </button>
        )}
      </div>
      {open && q.trim().length >= 1 && (
        <div className="card absolute z-40 mt-1 max-h-[70vh] w-full overflow-y-auto p-2 text-sm shadow-lg sm:w-[28rem]" style={{ insetInlineEnd: 0 }} role="listbox">
          {q.trim().length < 2 ? <p className="p-2 text-xs text-ink-muted">{tx('دستِ‌کم دو نویسه', 'At least two characters', 'لږ تر لږه دوه توري')}</p>
            : busy && !res ? <p className="p-2 text-xs text-ink-muted">{tx('در حالِ جست‌وجو…', 'Searching…', 'لټون کېږي…')}</p>
            : err ? <p className="p-2 text-xs" style={{ color: 'var(--status-critical)' }}>{err}</p>
            : res && (
              <>
                {total === 0 && <p className="p-2 text-xs text-ink-muted">{tx('چیزی پیدا نشد', 'Nothing found', 'هیڅ ونه موندل شو')}</p>}
                {res.results.map((src) => (
                  <div key={src.kind} className="mb-1">
                    <p className="px-2 pt-1 text-[11px] font-semibold text-ink-muted">{kindLabel(tx, src.kind)}</p>
                    {!src.ok ? (
                      <p className="px-2 pb-1 text-[11px] text-ink-muted">
                        {src.error?.code === 'capability_missing'
                          ? tx('این نسخهٔ سرورِ حساب این جست‌وجو را ندارد', 'This account-server version cannot search this', 'د حساب سرور دا نسخه دا لټون نه لري')
                          : '—'} <code dir="ltr">{src.error?.code}</code>
                      </p>
                    ) : !src.items?.length ? null : src.items.map((r, i) => {
                      const v = view(src.kind, r);
                      return (
                        <Link key={`${src.kind}-${s(r.id) || i}`} to={v.to} onClick={() => setOpen(false)}
                              className="block rounded-lg px-2 py-1.5 hover:bg-surface-raised focus:bg-surface-raised focus:outline-none">
                          <span className="block truncate">{v.title}</span>
                          {v.sub && <span className="block truncate text-[11px] text-ink-muted" dir="auto">{v.sub}</span>}
                        </Link>
                      );
                    })}
                  </div>
                ))}
                <p className="px-2 pt-1 text-[10px] text-ink-muted">
                  {tx('منبع: سرورِ حساب و پنل · دریافت', 'Source: account server and panel · received', 'سرچینه: د حساب سرور او پینل · ترلاسه')} {fmtTime(res.fetchedAt)}
                </p>
              </>
            )}
        </div>
      )}
    </div>
  );
}
