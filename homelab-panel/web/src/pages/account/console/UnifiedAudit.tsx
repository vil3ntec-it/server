// ---------------------------------------------------------------------------
//  دفترِ رخدادِ یکپارچه — هر سه دفتر در یک فهرست (فاز ۱ ِ ممیزی، ۶-۷ / S9)
//
//  ⛔ از ۱.۵۰.۷۴ جایش بخشِ «فروشگاه» است (`/shop?tab=audit`، ماژولِ `audit` برای admin) — همان «یک نمای دفترِ رخداد در
//     فروشگاه» ِ ممیزی. نشانی‌های پیشین (`/logs?tab=audit`، `/control/audit`، `/account-server?tab=audit`) برای admin به
//     همین‌جا می‌آیند؛ نسخهٔ دوم ساخته نشود.
//  ⛔ صفحه‌بندی، جست‌وجو و فیلتر همه در سرور (`GET /api/audit`)؛ این صفحه هیچ ردیفی را خودش نمی‌سازد، نمی‌شمارد و پاک
//     نمی‌کند — فقط‌خواندنی است. «یک دکان» (`?shop=`) هم در سرور: دفترِ سرورِ حساب با `shopId` ِ خودش.
//  ⚠️ دفترِ سرورِ حساب فقط ۵۰۰ ردیفِ آخرش را می‌دهد؛ وقتی به آن سقف رسیده همین گفته می‌شود، و سرورِ حسابِ در
//     دسترس‌نبوده هم «در دسترس نیست»، نه فهرستِ خالی.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { ScrollText, Search } from 'lucide-react';
import { useApp } from '../../../app-context';
import { api } from '../../../api';
import { Card, Skeleton } from '../../../components/ui';
import { dateTime } from '../../../format';
import { Cell, Notice, Row, Select, Table } from '../../../control/ui';
import { useTx } from './text';

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
  shopId?: string | null;
};

type Payload = {
  rows: AuditRow[];
  total: number;
  shop?: string | null;
  sources: {
    panel?: { ok: boolean; total: number };
    account?: { ok: boolean; total?: number; capped?: boolean; error?: string; message?: string };
  };
  /** ردیف‌هایی که از دیتابیس هرس شده‌اند — فقط نام و اندازهٔ پرونده‌ها (۱.۵۰.۷۱) */
  archive?: { dir: string; files: { name: string; bytes: number }[]; bytes: number };
  generatedAt: number;
};

type Source = 'all' | 'panel' | 'account';
const SOURCES: Source[] = ['all', 'panel', 'account'];
const SHOP_RE = /^[A-Za-z0-9_-]{1,80}$/;
const PAGE = 50;

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

export default function UnifiedAudit({ params, setParams }: { params: URLSearchParams; setParams: (next: Record<string, string>) => void }) {
  const { lang } = useApp();
  const tx = useTx();
  //  دفتر و دکان در نشانی‌اند (لینکِ مستقیم، برگشتِ مرورگر)؛ بقیه محلی
  const source: Source = SOURCES.includes(params.get('source') as Source) ? (params.get('source') as Source) : 'all';
  const shop = SHOP_RE.test(params.get('shop') || '') ? (params.get('shop') as string) : '';
  const [shopInput, setShopInput] = useState(shop);
  const [result, setResult] = useState('');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  const BOOK: Record<AuditRow['book'], string> = {
    sensitive: tx('پنل · کارِ حساس', 'Panel · sensitive', 'پینل · حساس کار'),
    control: tx('پنل · مدیریت', 'Panel · management', 'پینل · مدیریت'),
    account: tx('سرورِ حساب', 'Account server', 'د حساب سرور'),
  };
  const go = (next: { source?: Source; shop?: string }) => {
    setOffset(0);
    const s = next.source ?? source;
    setParams({ source: s === 'all' ? '' : s, shop: next.shop ?? shop });
  };

  useEffect(() => setShopInput(shop), [shop]);
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
      if (shop) qs.set('shop', shop);
      setData(await api<Payload>(`/api/audit?${qs}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [source, result, debounced, offset, shop]);

  useEffect(() => {
    load();
  }, [load]);

  const acc = data?.sources.account;
  const total = data?.total ?? 0;
  const shopBad = shopInput.trim() !== '' && !SHOP_RE.test(shopInput.trim());

  return (
    <div className="space-y-4" data-audit="unified">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{tx('دفترِ رخدادِ یکپارچه', 'Unified audit log', 'د پېښو یوځای کتاب')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-40">
            <Select
              value={source}
              onChange={(v) => go({ source: v as Source })}
              options={[
                { value: 'all', label: tx('هر سه دفتر', 'All three logs', 'درې واړه کتابونه') },
                { value: 'panel', label: tx('فقط پنل', 'Panel only', 'یوازې پینل') },
                { value: 'account', label: tx('فقط سرورِ حساب', 'Account server only', 'یوازې د حساب سرور') },
              ]}
            />
          </div>
          <div className="w-40">
            <Select
              value={result}
              onChange={(v) => { setOffset(0); setResult(v); }}
              options={[
                { value: '', label: tx('هر نتیجه', 'Any result', 'هره پایله') },
                { value: 'ok', label: tx('موفق', 'Succeeded', 'بریالی') },
                { value: 'failed', label: tx('ناموفق / رد شده', 'Failed / denied', 'ناکام / رد شوی') },
              ]}
            />
          </div>
          <div className="relative w-64 max-w-full">
            <Search className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-4 w-4 text-ink-muted" />
            <input
              className="input ps-9"
              placeholder={tx('کار، کاربر، هدف یا جزئیات…', 'Action, user, target or detail…', 'کار، کارن، موخه یا جزئیات…')}
              value={query}
              onChange={(e) => { setOffset(0); setQuery(e.target.value); }}
            />
          </div>
        </div>
      </header>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); if (!shopBad) go({ shop: shopInput.trim() }); }}
      >
        <input
          className="input w-full sm:w-64"
          dir="ltr"
          aria-label={tx('شناسهٔ دکان', 'Shop ID', 'د هټۍ پېژندنه')}
          placeholder={tx('شناسهٔ دکان (خالی = همه)', 'Shop ID (empty = all)', 'د هټۍ پېژندنه (تش = ټول)')}
          value={shopInput}
          onChange={(e) => setShopInput(e.target.value)}
        />
        <button className="btn btn-sm" type="submit" disabled={shopBad}>{tx('نشان بده', 'Show', 'وښایه')}</button>
        {shop && (
          <button className="btn btn-sm" type="button" onClick={() => go({ shop: '' })}>{tx('همهٔ دکان‌ها', 'All shops', 'ټولې هټۍ')}</button>
        )}
        {shopBad && <span className="text-xs" style={{ color: 'var(--status-critical)' }}>{tx('شناسه فقط حرف، رقم، _ و -', 'ID: letters, digits, _ and - only', 'پېژندنه یوازې توري، شمېرې، _ او -')}</span>}
      </form>

      <Notice tone="info">
        {tx(
          'فقط‌خواندنی: هیچ‌کس — مالک هم — از این صفحه ردیفی پاک یا ویرایش نمی‌کند. سه دفتر: کارهای حساسِ پنل (ورود، دوعاملی، احرازِ دوباره)، مدیریتِ پنل (کاربران، پل، بازیابیِ مالک)، و دفترِ خودِ سرورِ حساب.',
          'Read-only: nobody — not even the owner — deletes or edits a row here. Three logs: sensitive panel actions (sign-in, 2FA, re-authentication), panel management (users, bridge, owner recovery), and the account server’s own log.',
          'یوازې لوستل: هېڅوک — مالک هم — دلته کرښه نه ړنګوي او نه بدلوي. درې کتابونه: د پینل حساس کارونه (ننوتل، دوه‌ګامه، بیا تصدیق)، د پینل مدیریت (کارنان، پل، د مالک بیا راګرځول)، او د حساب سرور خپل کتاب.',
        )}
      </Notice>
      {source !== 'panel' && (
        <Notice tone="warn">
          {tx(
            'در دفترِ سرورِ حساب، کارِ پنل بی کلیدِ سرویس به نامِ همان یک حسابِ ارشدِ پل ثبت می‌شود، نه آدمِ پشتِ پنل — انجام‌دهندهٔ واقعی ردیفِ «پنل · مدیریت» ِ همان کار است؛ با کلیدِ سرویس و «انجام‌دهنده» (actor.v1) خودِ سرورِ حساب نامش را می‌نویسد.',
            'In the account-server log, a panel action without the service key is recorded under the single bridge superadmin, not the person — the real actor is the matching “Panel · management” row; with the service key and actor (actor.v1) the account server records the person itself.',
            'د حساب سرور په کتاب کې، د پینل کار بې د خدمت کلي د پُل د لوی مدیر په نوم ثبتېږي، نه د پینل تر شا کس — اصلي کس د همدې کار «پینل · مدیریت» کرښه ده؛ د خدمت کلي او «ترسره کوونکي» (actor.v1) سره د حساب سرور په خپله نوم لیکي.',
          )}
        </Notice>
      )}
      {shop && (
        <Notice tone="info">
          {tx(
            'فقط دکانِ «{s}»: دفترِ سرورِ حساب در خودِ سرورِ حساب پالایش می‌شود؛ از دو دفترِ پنل ردیف‌هایی که هدفشان همین دکان است یا شناسه‌اش در جزئیات آمده.',
            'Only shop “{s}”: the account-server log is filtered on the account server itself; from the two panel logs, rows whose target is this shop or whose detail names it.',
            'یوازې هټۍ «{s}»: د حساب سرور کتاب په خپله د حساب په سرور کې چاڼ کېږي؛ د پینل له دوو کتابونو هغه کرښې چې موخه یې همدا هټۍ ده یا یې پېژندنه په جزئیاتو کې راغلې.',
            { s: shop },
          )}
        </Notice>
      )}
      {acc && !acc.ok && (
        <Notice tone="warn">
          {tx('دفترِ سرورِ حساب در دسترس نیست', 'The account-server log is unavailable', 'د حساب سرور کتاب نشته')}
          {acc.message ? ` — ${acc.message}` : ''}.{' '}
          {tx('ردیف‌های پنل کامل‌اند؛ ردیف‌های سرورِ حساب در این فهرست نیستند.', 'Panel rows are complete; account-server rows are not in this list.', 'د پینل کرښې بشپړې دي؛ د حساب سرور کرښې په دې لړ کې نشته.')}
        </Notice>
      )}
      {acc?.ok && acc.capped && (
        <Notice tone="warn">
          {tx('از سرورِ حساب فقط ۵۰۰ ردیفِ آخر خوانده می‌شود؛ ردیف‌های کهنه‌ترِ آن‌جا در این فهرست نیستند.',
            'Only the last 500 rows are read from the account server; older rows there are not in this list.',
            'د حساب له سرور یوازې وروستۍ ۵۰۰ کرښې لوستل کېږي؛ زړې کرښې په دې لړ کې نشته.')}
        </Notice>
      )}
      {/* ⛔ هرس هیچ ردیفی را بی ردِ پا پاک نمی‌کند (۱.۵۰.۷۱): کهنه‌ترها روی دیسکِ همین سرورند، نه در این فهرست */}
      {data?.archive && data.archive.files.length > 0 && (
        <Notice tone="info">
          {tx(
            'ردیف‌های کهنه‌ترِ دو دفترِ پنل (بیش از ۲۰ هزار ردیفِ آخر) پاک نشده‌اند؛ روی همین سرور بایگانی شده‌اند ({n} پرونده، {mb} مگابایت):',
            'Older rows of the two panel logs (beyond the last 20,000) were not deleted; they are archived on this server ({n} files, {mb} MB):',
            'د پینل د دوو کتابونو زړې کرښې (له وروستیو ۲۰ زرو ها خوا) نه دي ړنګې شوې؛ په همدې سرور کې آرشیف دي ({n} دوتنې، {mb} مېګابایټه):',
            { n: data.archive.files.length.toLocaleString(lang === 'en' ? 'en-US' : 'fa-IR'), mb: (data.archive.bytes / 1048576).toLocaleString(lang === 'en' ? 'en-US' : 'fa-IR', { maximumFractionDigits: 1 }) },
          )}{' '}<code dir="ltr">{data.archive.dir}</code>
        </Notice>
      )}
      {error && <Notice tone="bad">{error}</Notice>}

      <Card title={tx('رخدادها', 'Events', 'پېښې')} icon={<ScrollText className="h-4 w-4" />}>
        {busy && !data ? (
          <Skeleton rows={6} />
        ) : (
          <Table
            head={[tx('کِی', 'When', 'کله'), tx('دفتر', 'Log', 'کتاب'), tx('چه کسی', 'Who', 'څوک'), tx('چه کاری', 'Action', 'څه کار'),
              tx('روی چه', 'Target', 'پر څه'), tx('نتیجه', 'Result', 'پایله'), tx('جزئیات', 'Detail', 'جزئیات')]}
            empty={(data?.rows.length ?? 0) === 0}
          >
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
                  {r.result === 'ok' ? tx('موفق', 'Succeeded', 'بریالی') : r.result}
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
          <button className="btn btn-sm" disabled={busy || offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}
            aria-label={tx('صفحهٔ پیش', 'Previous page', 'مخکنۍ پاڼه')}>
            ←
          </button>
          <span className="tnum text-xs text-ink-muted">
            {total ? tx('{a}–{b} از {t}', '{a}–{b} of {t}', '{a}–{b} له {t}', { a: offset + 1, b: Math.min(offset + PAGE, total), t: total }) : '۰'}
            {data ? ` · ${dateTime(data.generatedAt, lang)} · GET /api/audit` : ''}
          </span>
          <button className="btn btn-sm" disabled={busy || offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}
            aria-label={tx('صفحهٔ بعد', 'Next page', 'بله پاڼه')}>
            →
          </button>
        </div>
      </Card>
    </div>
  );
}
