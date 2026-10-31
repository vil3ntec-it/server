// ---------------------------------------------------------------------------
//  ۴.۱ — داشبوردِ بخشِ «فروشگاه»: یک کارت برای هر ماژولِ دیدنی، خلاصهٔ هشدارها، پیوندِ سریع — و زیرش نمای امروزِ
//  میز (مشتری، اشتراک‌دار، آنلاین، رو به پایان با ایمیل، پشتیبانی) همان‌طور که صاحبِ سامانه خواسته بود.
//
//  ⛔ هر عدد از ‎/console/summary‎ (سرورِ حساب یا پایگاهِ پنل) با **منبع** و **زمان**؛ نیامده/خطا ⇒ «—» با کد، نه صفر.
//  ⛔ کارتِ هر ماژول جدا نگهبان دارد — یکی بشکند، بقیه سرِ جایشان‌اند.
//  ⛔ ماژولی که هنوز ساخته نشده صادقانه «ساخته نشده» است، بی دکمه و بی عدد.
// ---------------------------------------------------------------------------
import { Link } from 'react-router-dom';
import { AlertTriangle, BellRing, ExternalLink, Info, OctagonAlert } from 'lucide-react';

import { Card } from '../../../components/ui';
import { Notice } from '../../../control/ui';
import { useLoad, type Load } from '../shared';
import { Problem } from '../ShopConsole';
import { minutesAgo, shown } from '../consoleData';
import { Dash } from '../ShopDesk';
import { SHELL_API, type ModuleProps, type ServerModule, type Tri } from './contract';
import { WEB_MODULES } from './registry';
import { Guarded, StateLoading, fmtTime } from './parts';
import { usePick, useTx, type Tx } from './text';

type Metric = { id: string; label: Tri; value: unknown; unit?: string; kind?: 'status' | 'time' };
type AlertRow = { level: 'bad' | 'warn' | 'info'; text: Tri; link?: string; module: string; source?: string; at?: number };
type Item = {
  module: string; ok: boolean; reason?: 'no_summary' | 'not_built' | 'error'; source?: string; at?: number | null;
  receivedAt?: number; metrics?: Metric[]; alerts?: AlertRow[]; error?: { code: string; message: string };
};
type Summary = { items: Item[]; alerts: AlertRow[]; fetchedAt: number };

const LEVEL = {
  bad: { color: 'var(--status-critical)', Icon: OctagonAlert },
  warn: { color: 'var(--status-warning)', Icon: AlertTriangle },
  info: { color: 'var(--accent)', Icon: Info },
} as const;

function statusText(tx: Tx, v: unknown) {
  if (v === 'ok') return tx('سالم', 'OK', 'روغ');
  if (v === 'warn') return tx('هشدار', 'Warning', 'خبرتیا');
  if (v === 'down') return tx('از کار افتاده', 'Down', 'ولاړ');
  return '—';
}

function value(tx: Tx, m: Metric) {
  if (m.kind === 'status') return statusText(tx, m.value);
  if (m.kind === 'time') return fmtTime(m.value);
  if (typeof m.value === 'string') return m.value || '—';
  const n = shown(m.value);
  return n === '—' ? n : `${n}${m.unit ? ` ${m.unit}` : ''}`;
}

/** «منبع · سنجیدهٔ آن‌جا / رسیده به پنل · چند دقیقه پیش» */
function Stamp({ item }: { item: Item }) {
  const tx = useTx();
  const at = item.at || item.receivedAt || null;
  const ago = at ? minutesAgo(at, Date.now()) : null;
  return (
    <p className="mt-2 text-[10px] leading-relaxed text-ink-muted">
      {tx('منبع', 'Source', 'سرچینه')}: <code dir="ltr" className="font-mono">{item.source || '—'}</code> ·{' '}
      {item.at ? tx('سنجیدهٔ منبع', 'measured at source', 'په سرچینه کې') : tx('رسیده به پنل', 'received by panel', 'پینل ته رسېدلی')} {fmtTime(at)}
      {ago !== null && ` (${tx('{n} دقیقه پیش', '{n} min ago', '{n} دقیقې مخکې', { n: shown(ago) })})`}
    </p>
  );
}

function ModuleCard({ info, item }: { info: ServerModule; item: Item | undefined }) {
  const tx = useTx();
  const pick = usePick();
  const def = WEB_MODULES.get(info.id);
  const Icon = def?.icon;
  const link = info.built && def ? `/shop?tab=${info.id}` : null;
  return (
    <Card title={<span className="flex items-center gap-2">{pick(info.label)}{info.spec && <span className="text-[10px] font-normal text-ink-muted" dir="ltr">{info.spec}</span>}</span>}
          icon={Icon ? <Icon size={15} /> : undefined}
          action={link ? <Link className="flex items-center gap-1 text-xs underline" to={link}>{tx('باز کن', 'Open', 'پرانیزئ')}<ExternalLink size={11} /></Link> : undefined}>
      {!item ? <StateLoading /> : !info.built || item.reason === 'not_built' ? (
        <p className="text-xs text-ink-muted">{tx('هنوز ساخته نشده — داده‌ای نشان داده نمی‌شود.', 'Not built yet — no data shown.', 'لا نه دی جوړ شوی — معلومات نه ښودل کېږي.')}</p>
      ) : item.reason === 'no_summary' ? (
        <p className="text-xs text-ink-muted">{tx('این ماژول خلاصهٔ عددی ندارد — از «باز کن» ببینید.', 'This module has no numeric summary — open it to see details.', 'دا ماډل شمېرنیز لنډیز نه لري — د جزییاتو لپاره یې پرانیزئ.')} —</p>
      ) : !item.ok ? (
        <div className="text-xs">
          <p className="text-2xl font-semibold text-ink-muted">—</p>
          <p className="mt-1 text-ink-muted">{tx('داده در دسترس نیست', 'Data not available', 'معلومات نشته')}: {item.error?.message || ''} <code dir="ltr">{item.error?.code}</code></p>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
            {(item.metrics || []).map((m) => (
              <div key={m.id} className="min-w-0">
                <dt className="truncate text-[11px] text-ink-muted">{pick(m.label)}</dt>
                <dd className="tnum truncate text-lg font-semibold" dir="auto">{value(tx, m)}</dd>
              </div>
            ))}
          </dl>
          <Stamp item={item} />
        </>
      )}
    </Card>
  );
}

function Alerts({ load, modules }: { load: Load<Summary>; modules: ServerModule[] }) {
  const tx = useTx();
  const pick = usePick();
  const d = load.data;
  const alerts = Array.isArray(d?.alerts) ? d!.alerts : [];
  const failed = (Array.isArray(d?.items) ? d!.items : []).filter((x) => x.reason === 'error');
  const label = (id: string) => pick(modules.find((m) => m.id === id)?.label) || id;
  return (
    <Card title={tx('خلاصهٔ هشدارها', 'Alerts summary', 'د خبرتیاوو لنډیز')} icon={<BellRing size={15} />}>
      {load.error ? <Problem load={load as Load<unknown>} /> : !d ? <StateLoading /> : (
        <>
          {alerts.length === 0 ? (
            <p className="text-xs text-ink-muted">{tx('از منابعی که سنجیده شد هشداری نیست.', 'No alerts from the sources that were checked.', 'له کتل شویو سرچینو څخه خبرتیا نشته.')}</p>
          ) : (
            <ul className="space-y-1.5">
              {alerts.map((a, i) => {
                const lv = LEVEL[a.level] || LEVEL.info;
                return (
                  <li key={`${a.module}-${i}`} className="flex items-start gap-2 text-sm">
                    <lv.Icon size={15} className="mt-0.5 shrink-0" style={{ color: lv.color }} />
                    <span className="min-w-0 flex-1">
                      {a.link ? <Link className="hover:underline" to={a.link}>{pick(a.text)}</Link> : pick(a.text)}
                      <span className="block text-[10px] text-ink-muted">{label(a.module)} · <code dir="ltr">{a.source}</code> · {fmtTime(a.at)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {/* ⛔ «هشداری نیست» فقط برای منابعی که واقعاً جواب دادند — نسنجیده‌ها گفته می‌شوند، نه سبزِ دروغ */}
          {failed.length > 0 && (
            <Notice tone="warn">
              {tx('سنجیده نشد:', 'Could not check:', 'ونه کتل شو:')} {failed.map((f) => `${label(f.module)} (${f.error?.code || '—'})`).join('، ')}
            </Notice>
          )}
          <p className="mt-2 text-[10px] text-ink-muted">{tx('منبع: ‎/console/summary‎ · دریافت', 'Source: /console/summary · received', 'سرچینه: /console/summary · ترلاسه')} {fmtTime(d.fetchedAt)}</p>
        </>
      )}
    </Card>
  );
}

export default function ConsoleDashboard(_props: ModuleProps) {
  const tx = useTx();
  const pick = usePick();
  const mods = useLoad<{ modules: ServerModule[] }>(SHELL_API.modules);
  //  ⚠️ زنده: با هر خبرِ «مشتری/فروش/پشتیبانی» ِ سرورِ حساب دوباره خوانده می‌شود (نه نبضِ کور)
  const sum = useLoad<Summary>(SHELL_API.summary, [], ['customers', 'sales', 'support']);
  const modules = (Array.isArray(mods.data?.modules) ? mods.data!.modules : []).filter((m) => m.id !== 'dash');
  const items = Array.isArray(sum.data?.items) ? sum.data!.items : [];

  return (
    <div className="space-y-4">
      <Alerts load={sum} modules={modules} />

      <section aria-label={tx('کارتِ ماژول‌ها', 'Module cards', 'د ماډلونو کارتونه')}>
        {sum.error && <Problem load={sum as Load<unknown>} />}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {modules.map((m) => (
            <Guarded key={m.id} name={pick(m.label)} compact>
              <ModuleCard info={m} item={sum.error ? { module: m.id, ok: false, reason: 'error', error: { code: sum.code, message: '' } } : items.find((x) => x.module === m.id)} />
            </Guarded>
          ))}
        </div>
      </section>

      {/* نمای امروزِ میز — همان داشبوردِ پیشین (فهرستِ رو به پایان با ایمیل، رشته‌های پشتیبانی) */}
      <Guarded name={tx('نمای امروز', 'Today', 'نن ورځ')}>
        <Dash />
      </Guarded>
    </div>
  );
}
