// ---------------------------------------------------------------------------
//  🏪 پوستهٔ بخشِ «فروشگاه» — یک برنامهٔ کامل داخلِ پنل (دستورِ صاحب محصول، ۱۴۰۵/۰۸/۱۰)
//
//  منوی گروه‌بندی‌شدهٔ ۱۳ ماژولِ پرامپتِ مالک (کناره روی صفحهٔ پهن، فهرستِ کشویی روی گوشی)، «ردِ نان»، جست‌وجوی
//  سراسری، لینکِ مستقیم (‎/shop?tab=<id>&…‎، برگشتِ مرورگر) و یک نگهبانِ خطا برای هر ماژول.
//
//  ⛔ کدام ماژول دیده می‌شود را **سرور** می‌گوید (‎/console/modules‎، به نقشِ همین نشست) و درهای همان ماژول هم با
//     همان قاعده بسته‌اند — پنهان یعنی سرور هم نمی‌دهد. این پوسته فقط آن فهرست را می‌چیند.
//  ⛔ ماژولِ «ساخته‌نشده» زبانهٔ خالی نمی‌گیرد؛ لینکِ مستقیم به آن صادقانه می‌گوید «هنوز ساخته نشده».
//  افزودنِ ماژول: ‎docs/CONSOLE-SHELL-fa.md‎ (یک ردیف در ‎server/src/console/modules.js‎ + یک فایل در ‎./modules/‎).
// ---------------------------------------------------------------------------
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Store } from 'lucide-react';

import { useApp } from '../../../app-context';
import { Card } from '../../../components/ui';
import { Notice } from '../../../control/ui';
import { useLoad, type Load } from '../shared';
import { Problem } from '../ShopConsole';
import { SHELL_API, WEB_MODULES, type ModulesResponse, type ServerModule } from './registry';
import { Forbidden, Guarded, NotSupported, StateLoading } from './parts';
import ConsoleSearch from './Search';
import { usePick, useTx } from './text';

export default function ConsoleShell() {
  const { dir } = useApp();
  const tx = useTx();
  const pick = usePick();
  const [params, setParams] = useSearchParams();
  const load = useLoad<ModulesResponse>(SHELL_API.modules);

  const data = load.data;
  const modules: ServerModule[] = useMemo(() => (Array.isArray(data?.modules) ? data!.modules : []), [data]);
  const groups = Array.isArray(data?.groups) ? data!.groups : [];
  //  در منو فقط آن‌چه سرور برای این نقش گفته **و** ساخته شده **و** فایلِ وب دارد
  const nav = modules.filter((m) => m.built && WEB_MODULES.has(m.id));

  const wanted = params.get('tab') || 'dash';
  const info = modules.find((m) => m.id === wanted) || null;
  const def = WEB_MODULES.get(wanted) || null;
  const group = info ? groups.find((g) => g.id === info.group) : null;
  const Sep = dir === 'rtl' ? ChevronLeft : ChevronRight;

  const go = (id: string) => setParams(id === 'dash' ? {} : { tab: id });
  const setModuleParams = (next: Record<string, string>) => {
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== '' && v != null));
    setParams(wanted === 'dash' && !Object.keys(clean).length ? {} : { tab: wanted, ...clean });
  };
  const crumb = info && def?.crumb ? def.crumb(params) : null;

  let body;
  if (load.error) body = <Problem load={load as Load<unknown>} />;
  else if (!data) body = <StateLoading label={tx('بخشِ فروشگاه', 'Shop section', 'د هټۍ برخه')} />;
  else if (info && info.built && def) {
    const Comp = def.component;
    body = (
      <Guarded key={info.id} name={pick(info.label)}>
        <Comp params={params} setParams={setModuleParams} info={info} role={data.role} owner={data.owner === true} />
      </Guarded>
    );
  } else if (info) {
    body = (
      <NotSupported needs={info.spec ? `${tx('بندِ پرامپت', 'Prompt section', 'د پرامپټ برخه')} ${info.spec}` : undefined}>
        {tx('«{m}» هنوز در این نسخهٔ پنل ساخته نشده است — داده‌ای ساختگی نشان داده نمی‌شود.',
          '“{m}” is not built in this panel version yet — no placeholder data is shown.',
          '«{m}» لا د پینل په دې نسخه کې نه دی جوړ شوی — جعلي معلومات نه ښودل کېږي.', { m: pick(info.label) })}
      </NotSupported>
    );
  } else if (def) {
    body = <Forbidden>{tx('این ماژول برای نقشِ شما باز نیست (سرور هم آن را نمی‌دهد).', 'This module is not open to your role (the server refuses it too).', 'دا ماډل ستاسو رول ته خلاص نه دی (سرور یې هم نه ورکوي).')}</Forbidden>;
  } else {
    body = (
      <Notice tone="warn">
        {tx('چنین ماژولی نیست:', 'No such module:', 'داسې ماډل نشته:')} <code dir="ltr">{wanted}</code> ·{' '}
        <Link className="underline" to="/shop">{tx('داشبورد', 'Dashboard', 'ډشبورډ')}</Link>
      </Notice>
    );
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-3">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-semibold"><Store size={18} />{tx('فروشگاه', 'Shop', 'هټۍ')}</h1>
          {/* ردِ نان: فروشگاه › گروه › ماژول › (زیربخش) */}
          <nav aria-label={tx('ردِ نان', 'Breadcrumb', 'د ډوډۍ نښه')} className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-ink-muted">
            <Link className="hover:underline" to="/shop">{tx('فروشگاه', 'Shop', 'هټۍ')}</Link>
            {group && <><Sep size={12} /><span>{pick(group.label)}</span></>}
            {info && <><Sep size={12} /><Link className="hover:underline" to={info.id === 'dash' ? '/shop' : `/shop?tab=${info.id}`} aria-current={crumb ? undefined : 'page'}>{pick(info.label)}</Link></>}
            {crumb && <><Sep size={12} /><span dir="auto" aria-current="page" className="max-w-[16rem] truncate">{crumb}</span></>}
          </nav>
        </div>
        {data && <ConsoleSearch />}
      </header>

      <div className="grid gap-3 lg:grid-cols-[13rem_minmax(0,1fr)]">
        {/* روی گوشی: یک فهرستِ کشویی با گروه‌ها */}
        {data && (
          <select className="input w-full lg:hidden" value={info && nav.some((m) => m.id === info.id) ? info.id : ''}
                  aria-label={tx('ماژول‌های فروشگاه', 'Shop modules', 'د هټۍ ماډلونه')} onChange={(e) => go(e.target.value)}>
            {!nav.some((m) => m.id === wanted) && <option value="">—</option>}
            {groups.map((g) => {
              const items = nav.filter((m) => m.group === g.id);
              return items.length ? (
                <optgroup key={g.id} label={pick(g.label)}>
                  {items.map((m) => <option key={m.id} value={m.id}>{pick(m.label)}</option>)}
                </optgroup>
              ) : null;
            })}
          </select>
        )}
        {/* روی صفحهٔ پهن: کناره */}
        {data && (
          <aside className="hidden lg:block">
            <Card className="!p-2">
              <nav aria-label={tx('ماژول‌های فروشگاه', 'Shop modules', 'د هټۍ ماډلونه')}>
                {groups.map((g) => {
                  const items = nav.filter((m) => m.group === g.id);
                  if (!items.length) return null;
                  return (
                    <div key={g.id} className="mb-2">
                      <p className="px-2 pb-1 pt-2 text-[11px] font-semibold text-ink-muted">{pick(g.label)}</p>
                      {items.map((m) => {
                        const Icon = WEB_MODULES.get(m.id)!.icon;
                        const active = m.id === wanted;
                        return (
                          <Link key={m.id} to={m.id === 'dash' ? '/shop' : `/shop?tab=${m.id}`} aria-current={active ? 'page' : undefined}
                                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${active ? 'font-semibold' : 'text-ink-soft hover:bg-surface-raised'}`}
                                style={active ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : undefined}>
                            <Icon size={15} />
                            <span className="min-w-0 flex-1 truncate">{pick(m.label)}</span>
                            {m.spec && <span className="text-[10px] opacity-60" dir="ltr">{m.spec.split(' ')[0]}</span>}
                          </Link>
                        );
                      })}
                    </div>
                  );
                })}
              </nav>
            </Card>
          </aside>
        )}
        <section className="min-w-0">{body}</section>
      </div>
    </div>
  );
}
