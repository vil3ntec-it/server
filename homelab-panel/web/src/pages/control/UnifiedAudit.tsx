// ---------------------------------------------------------------------------
//  دفترِ رخدادِ یکپارچه — هر سه دفتر در یک فهرست (فاز ۱ ِ ممیزی، ۶-۷ / S9)
//
//  ⛔ صفحه‌بندی، جست‌وجو و فیلتر همه در سرور (`GET /api/audit`)؛ این صفحه هیچ
//  ردیفی را خودش نمی‌سازد، نمی‌شمارد و پاک نمی‌کند — فقط‌خواندنی است.
//  ⚠️ دفترِ سرورِ حساب فقط ۵۰۰ ردیفِ آخرش را می‌دهد؛ وقتی به آن سقف رسیده
//  همین گفته می‌شود، و سرورِ حسابِ در دسترس‌نبوده هم «در دسترس نیست»، نه
//  فهرستِ خالی.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { ScrollText, Search } from 'lucide-react';
import { useApp } from '../../app-context';
import { api } from '../../api';
import { Card, Skeleton } from '../../components/ui';
import { dateTime } from '../../format';
import { Cell, Notice, Row, Select, Table } from '../../control/ui';

type AuditRow = {
  source: 'panel' | 'account';
  book: 'sensitive' | 'control' | 'account';
  id: string;
  at: number;
  actor: string;
  action: string;
  target: string | null;
  result: string;
  ip: string | null;
  detail: string | null;
};

type Payload = {
  rows: AuditRow[];
  total: number;
  sources: {
    panel?: { ok: boolean; total: number };
    account?: { ok: boolean; total?: number; capped?: boolean; error?: string; message?: string };
  };
  generatedAt: number;
};

const PAGE = 50;
const BOOK: Record<AuditRow['book'], string> = {
  sensitive: 'پنل · کارِ حساس',
  control: 'پنل · مدیریت',
  account: 'سرورِ حساب',
};

/** جزئیاتِ JSON خوانا، متن همان متن */
function prettyDetail(d: string | null) {
  if (!d) return '—';
  try {
    const o = JSON.parse(d);
    return typeof o === 'object' && o ? Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ') : String(o);
  } catch {
    return d;
  }
}

export default function UnifiedAudit() {
  const { lang } = useApp();
  const [source, setSource] = useState<'all' | 'panel' | 'account'>('all');
  const [result, setResult] = useState('');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const tm = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(tm);
  }, [query]);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const qs = new URLSearchParams({ source, limit: String(PAGE), offset: String(offset) });
      if (debounced) qs.set('q', debounced);
      if (result) qs.set('result', result);
      setData(await api<Payload>(`/api/audit?${qs}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [source, result, debounced, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const acc = data?.sources.account;
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">دفترِ رخدادِ یکپارچه</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-40">
          <Select
            value={source}
            onChange={(v) => { setOffset(0); setSource(v as typeof source); }}
            options={[
              { value: 'all', label: 'هر سه دفتر' },
              { value: 'panel', label: 'فقط پنل' },
              { value: 'account', label: 'فقط سرورِ حساب' },
            ]}
          />
          </div>
          <div className="w-40">
          <Select
            value={result}
            onChange={(v) => { setOffset(0); setResult(v); }}
            options={[
              { value: '', label: 'هر نتیجه' },
              { value: 'ok', label: 'موفق' },
              { value: 'failed', label: 'ناموفق / رد شده' },
            ]}
          />
          </div>
          <div className="relative w-64 max-w-full">
            <Search className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-4 w-4 text-ink-muted" />
            <input
              className="input ps-9"
              placeholder="کار، کاربر، هدف یا جزئیات…"
              value={query}
              onChange={(e) => { setOffset(0); setQuery(e.target.value); }}
            />
          </div>
        </div>
      </header>

      <Notice tone="info">
        فقط‌خواندنی: هیچ‌کس — مالک هم — از این صفحه ردیفی پاک یا ویرایش نمی‌کند. سه دفتر: کارهای حساسِ پنل (ورود،
        دوعاملی، احرازِ دوباره)، مدیریتِ پنل (کاربران، پل، بازیابیِ مالک)، و دفترِ خودِ سرورِ حساب.
      </Notice>
      {acc && !acc.ok && (
        <Notice tone="warn">
          دفترِ سرورِ حساب در دسترس نیست{acc.message ? ` — ${acc.message}` : ''}. ردیف‌های پنل کامل‌اند؛ ردیف‌های سرورِ حساب
          در این فهرست نیستند.
        </Notice>
      )}
      {acc?.ok && acc.capped && (
        <Notice tone="warn">از سرورِ حساب فقط ۵۰۰ ردیفِ آخر خوانده می‌شود؛ ردیف‌های کهنه‌ترِ آن‌جا در این فهرست نیستند.</Notice>
      )}
      {error && <Notice tone="bad">{error}</Notice>}

      <Card title="رخدادها" icon={<ScrollText className="h-4 w-4" />}>
        {busy && !data ? (
          <Skeleton rows={6} />
        ) : (
          <Table head={['کِی', 'دفتر', 'چه کسی', 'چه کاری', 'روی چه', 'نتیجه', 'جزئیات']} empty={(data?.rows.length ?? 0) === 0}>
            {(data?.rows || []).map((r) => (
              <Row key={r.id}>
                <Cell className="whitespace-nowrap text-xs">{dateTime(r.at, lang)}</Cell>
                <Cell className="whitespace-nowrap text-[11px] text-ink-muted">{BOOK[r.book] || r.book}</Cell>
                <Cell className="text-xs"><span dir="ltr">{r.actor}</span></Cell>
                <Cell>
                  <span className="chip" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} dir="ltr">{r.action}</span>
                </Cell>
                <Cell className="text-[11px]"><span dir="ltr" className="font-mono">{r.target || '—'}</span></Cell>
                <Cell className="text-xs" style={{ color: r.result === 'ok' ? 'var(--status-good)' : 'var(--status-critical)' }}>
                  {r.result === 'ok' ? 'موفق' : r.result}
                </Cell>
                <Cell>
                  <span dir="ltr" className="block max-w-96 truncate font-mono text-[10px] text-ink-muted" title={r.detail || ''}>
                    {prettyDetail(r.detail)}
                  </span>
                </Cell>
              </Row>
            ))}
          </Table>
        )}

        <div className="mt-3 flex items-center justify-between gap-2">
          <button className="btn btn-sm" disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            ←
          </button>
          <span className="tnum text-xs text-ink-muted">
            {total ? `${offset + 1}–${Math.min(offset + PAGE, total)} از ${total}` : '۰'}
            {data ? ` · ${dateTime(data.generatedAt, lang)}` : ''}
          </span>
          <button className="btn btn-sm" disabled={busy || offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
            →
          </button>
        </div>
      </Card>
    </div>
  );
}
