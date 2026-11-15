// ---------------------------------------------------------------------------
//  🏪 منوی بخشِ «فروشگاه» در **نوارِ کناریِ پنل** (drill-in، ۱.۵۱.۱)
//
//  دستورِ صاحب سامانه: «این منوی فروشگاه بیاد جای اون منوی بزرگ؛ روی فروشگاه کلیک می‌کنم این منو باز بشه، با برگشت دوباره
//  بره روی منوی قبلی.» تا ۱.۵۱.۰ پوسته ستونِ دومی کنارِ منوی پنل داشت؛ حالا همین منو **جای** منوی پنل می‌نشیند (ردیفِ
//  «منوی اصلی» را ‎Layout‎ بالایش می‌گذارد) و ستونِ دوم رفت.
//
//  ⛔ کدام ماژول دیده می‌شود را سرور می‌گوید (‎/console/modules‎، همان قاعدهٔ پوسته): فقط «ساخته + فایلِ وب».
//  ⛔ شمارهٔ بندِ پرامپت (۴.۱، ۴.۸…) دیگر کنارِ هر ردیف نیست؛ فقط در راهنمای کوچکِ همان ردیف (‎title‎).
//  میزبانِ جدا (‎standalone/StandaloneApp.tsx‎) همین را در کنارهٔ خودش می‌گذارد.
//  ۱.۵۱.۲: سرِ منو «میان‌بُرها» — «پنلِ مدیرِ سرور» (زبانهٔ تازه، نشانی از سرورِ پنل؛ نبود ⇒ همان کارت که می‌گوید چرا) و
//  «اعلانِ گوشی (Firebase)». فقط وقتی «تنظیماتِ مرکزی» برای این نقش هست.
// ---------------------------------------------------------------------------
import { Fragment } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { BellRing, ExternalLink } from 'lucide-react';
import { SHOP_HOME, type PanelSubNavProps, usePick, useTx } from '../host';
import { WEB_MODULES } from './registry';
import { useShellModules } from './useShellModules';
import { useAdminWebInfo } from './AdminWebCard';

export default function ShopSubNav({ rail, tip }: PanelSubNavProps) {
  const tx = useTx();
  const pick = usePick();
  const location = useLocation();
  const [params] = useSearchParams();
  const load = useShellModules();
  const label = tx('ماژول‌های فروشگاه', 'Shop modules', 'د هټۍ ماډلونه');

  const modules = Array.isArray(load.data?.modules) ? load.data!.modules : [];
  const groups = Array.isArray(load.data?.groups) ? load.data!.groups : [];
  const nav = modules.filter((m) => m.built && WEB_MODULES.has(m.id));
  const here = location.pathname === SHOP_HOME ? params.get('tab') || 'dash' : null;
  const hasSettings = nav.some((m) => m.id === 'settings');
  const adminWeb = useAdminWebInfo();
  const adminUrl = adminWeb.data?.url || null;

  //  پس از نخستین گروه (داشبورد همچنان نخستین ردیف است) — بالای منو، بی اسکرول
  const shortcuts = hasSettings ? (
    <section className="mb-1" data-testid="shop-shortcuts">
      {rail ? <hr className="nav-rail-sep" aria-hidden="true" /> : <p className="nav-group-title">{tx('میان‌بُرها', 'Shortcuts', 'لنډې لارې')}</p>}
      {rail && <span className="sr-only">{tx('میان‌بُرها', 'Shortcuts', 'لنډې لارې')}</span>}
      <div className="flex flex-col gap-0.5">
        {(() => {
          const name = tx('پنلِ مدیرِ سرور', 'Server admin panel', 'د سرور د مدیر پینل');
          const body = <><ExternalLink className="nav-icon" /><span className={rail ? 'sr-only' : 'truncate'}>{name}</span></>;
          return adminUrl
            ? <a className="nav-item" href={adminUrl} target="_blank" rel="noopener noreferrer" data-testid="nav-admin-web"
                 title={rail ? undefined : `${name} — ${adminUrl}`} {...tip(name)}>{body}</a>
            : <Link className="nav-item" to={`${SHOP_HOME}?tab=settings&card=admin`} data-testid="nav-admin-web"
                    title={rail ? undefined : name} {...tip(name)}>{body}</Link>;
        })()}
        {(() => {
          const name = tx('اعلانِ گوشی (Firebase)', 'Phone notifications (Firebase)', 'د ګوشي خبرتیا (Firebase)');
          return (
            <Link className="nav-item" to={`${SHOP_HOME}?tab=settings&card=push`} data-testid="nav-push"
                  title={rail ? undefined : name} {...tip(name)}>
              <BellRing className="nav-icon" /><span className={rail ? 'sr-only' : 'truncate'}>{name}</span>
            </Link>
          );
        })()}
      </div>
    </section>
  ) : null;
  const firstGroup = groups.find((g) => nav.some((m) => m.group === g.id))?.id;

  if (load.error) {
    return (
      <nav aria-label={label} className="px-1">
        <p className="px-3 py-2 text-xs text-ink-muted">{tx('فهرستِ ماژول‌ها خوانده نشد.', 'Could not read the module list.', 'د ماډلونو لېست ونه لوستل شو.')}</p>
        <Link className="nav-item" to={SHOP_HOME}>{tx('داشبوردِ فروشگاه', 'Shop dashboard', 'د هټۍ ډشبورډ')}</Link>
      </nav>
    );
  }
  if (!load.data) return <nav aria-label={label} aria-busy="true" className="space-y-1 px-1">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="nav-item opacity-40"><span className="h-4 w-full rounded bg-surface-2" /></div>)}</nav>;

  return (
    <nav aria-label={label} className="flex flex-col">
      {groups.map((g, gi) => {
        const items = nav.filter((m) => m.group === g.id);
        if (!items.length) return null;
        return (
          <Fragment key={g.id}>
            <section className="mb-1">
              {rail ? (gi > 0 && <hr className="nav-rail-sep" aria-hidden="true" />) : <p className="nav-group-title">{pick(g.label)}</p>}
              {rail && <span className="sr-only">{pick(g.label)}</span>}
              <div className="flex flex-col gap-0.5">
                {items.map((m) => {
                  const Icon = WEB_MODULES.get(m.id)!.icon;
                  const active = m.id === here;
                  const name = pick(m.label);
                  return (
                    <Link key={m.id} to={m.id === 'dash' ? SHOP_HOME : `${SHOP_HOME}?tab=${m.id}`} aria-current={active ? 'page' : undefined}
                          className={`nav-item ${active ? 'is-active' : ''}`}
                          title={rail ? undefined : m.spec ? `${name} · ${tx('بندِ', 'section', 'برخه')} ${m.spec}` : name}
                          {...tip(name)}>
                      <Icon className="nav-icon" />
                      <span className={rail ? 'sr-only' : 'truncate'}>{name}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
            {g.id === firstGroup && shortcuts}
          </Fragment>
        );
      })}
    </nav>
  );
}
