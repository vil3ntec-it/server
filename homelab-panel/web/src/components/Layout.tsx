import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { PageBoundary } from './PageBoundary';
import {
  Activity,
  ArrowRight,
  Bot,
  Boxes,
  Archive,
  ChevronDown,
  Workflow,
  BellRing,
  Database,
  Command as CommandIcon,
  Download,
  FolderTree,
  Gauge,
  Globe,
  KeyRound,
  LayoutDashboard,
  Languages,
  LogOut,
  Menu,
  Moon,
  Network,
  PanelRightClose,
  PanelRightOpen,
  ScrollText,
  Server,
  ServerCog,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
  TerminalSquare,
  UserCog,
  X,
  Fuel,
  Hash,
  LogIn,
  Megaphone,
  MessagesSquare,
  RefreshCw,
  Search,
  Wallet,
} from 'lucide-react';
import { useApp } from '../app-context';
import { LANGUAGES, type Dict } from '../i18n';
import { featureOn, type FeatureKey, type ServerFeature } from '../features';
import { logoUrl } from '../api';
import CommandPalette, { usePaletteKey, type PaletteItem } from './CommandPalette';
import { subsPath } from '../pages/account/subsPath';
import { moduleMenu, PANEL_MODULES } from '../modules/registry';
import type { PanelModule, PanelNavTip } from '../modules/types';

type NavItem = {
  to: string;
  key: keyof Dict;
  icon: typeof Gauge;
  end?: boolean;
  needs?: 'operator' | 'admin';
  /** اگر این بخش در features.ts خاموش باشد، اصلاً در منو نمی‌آید */
  feature?: FeatureKey;
  /** اگر سرور بگوید این قابلیت روی این میزبان نیست (VPS/داکر)، در منو نمی‌آید */
  server?: ServerFeature;
  /** فقط مالکِ پنل (سرور هم فقط مالک را راه می‌دهد) — «سرورهای من» */
  owner?: boolean;
};
type NavGroup = {
  id: string;
  key: keyof Dict;
  items: NavItem[];
  /** بارِ اول بسته باشد؟ */
  collapsed?: boolean;
};

const NAV_GROUPS: NavGroup[] = [
  /*
   *  ترتیب از روی کاری است که آدم واقعاً می‌کند، نه از روی اینکه کد کجا
   *  نوشته شده. چیزهایی که هر روز لازم می‌شوند بالا هستند و بازند؛ بقیه
   *  بسته‌اند و با یک کلیک باز می‌شوند.
   *
   *  چرا مهم است: پیش از این نوزده آیتم در پنج گروهِ همیشه‌باز بود و روی
   *  یک نمایشگرِ معمولی، سه تای آخر — از جمله «آدرس اینترنتی» که آدرسِ
   *  ثابت آنجا ساخته می‌شود — زیرِ لبهٔ صفحه می‌ماند. نتیجه‌اش این بود که
   *  صاحبِ سرور فکر می‌کرد آن قابلیت اصلاً وجود ندارد.
   */
  {
    id: 'daily',
    key: 'navEveryday',
    items: [
      // صفحه‌ای که بعد از ورود روی آن می‌نشینید — پس اولین چیزِ منو
      { to: '/', key: 'dashboard', icon: LayoutDashboard, end: true },
      { to: '/assistant', key: 'agTitle', icon: Bot, server: 'agent' },
      { to: '/control', key: 'ccCommand', icon: CommandIcon, end: true, feature: 'commandCenter' },
      { to: '/sites', key: 'websites', icon: Server, server: 'sites' },
      { to: '/my-servers', key: 'fsTitle', icon: Boxes, owner: true },
      { to: '/site-server', key: 'siteServer', icon: Globe },
      { to: '/stations', key: 'stations', icon: Fuel },
      /*
       *  ⚠️ «پمپ‌بنزین‌ها» در منو بود و هیچ دری به نامِ فروشگاه نبود، و صاحبِ
       *  سامانه پرسید «کو بخشِ فروشگاه؟». حسابِ فروشگاه از روزِ اول در
       *  «مشتری‌ها و اشتراک‌ها» بود — فقط دیده نمی‌شد.
       *
       *  ⚠️ **و از ۱.۴۸.۰ درش عوض شد، نه دو شد.** تا آن روز همین آیتم به
       *  `/customers?app=shop` می‌رفت و همین‌جا نوشته بود «صفحهٔ تازه‌ای
       *  ساخته نشود». آن یادداشت وقتی درست بود که محتوای تازه‌ای در کار
       *  نبود؛ حالا هست (داشبورد، سه گروهِ اشتراک، کدِ شاگرد) و خودِ صاحب
       *  سامانه صریح «تمام‌صفحه‌اش کن» خواست. پس `/shop` ساخته شد و همین
       *  آیتم به آن‌جا می‌رود.
       *
       *  ⚠️ `/customers?app=shop` **دست‌نخورده کار می‌کند** — نشانیِ قدیمی
       *  نباید بشکند، و آن صفحه کارِ دیگری می‌کند (فهرستِ اشتراک‌ها با
       *  فیلتر)، پس `Navigate` هم نشد.
       *
       *  ⚠️ و چرا شکلش با پمپ فرق دارد: `/stations` دفترِ **سرورِ خانگی**ِ هر
       *  پمپ است (پوشه، رمزِ خواندن، دادهٔ زنده). فروشگاه چنین چیزی ندارد —
       *  کلاً روی سرورِ حساب است. پس دری که نیست ساخته نمی‌شود.
       */
      //  🏪 «فروشگاه» (‎/shop‎) — از ۱.۵۱.۰ ماژولِ جداشدنی؛ آیتمش از شناسنامهٔ خودش (‎modules/shop/index.ts‎)، همین‌جا
      ...moduleMenu('daily'),
      { to: '/codes', key: 'codesTitle', icon: Hash },
    ],
  },
  /*
   *  مشتری، پول و پیام — از **سرورِ حساب** می‌آیند و هیچ دفترِ دومی در این
   *  پنل ندارند. باز است چون کارِ هر روزِ صاحبِ سامانه است: رسید بریدن،
   *  جوابِ پشتیبانی. (اشتراک دادن در بخشِ خودِ هر برنامه است — پایین.)
   */
  {
    id: 'money',
    key: 'navMoney',
    items: [
      /*
       *  ⛔ **«اشتراک‌ها» دیگر درِ منو ندارد** (دستورِ صاحب محصول ۱۴۰۵/۰۸/۰۹:
       *     «بخشِ جدای اشتراک‌ها حذف شود»). اشتراکِ پمپ در «پمپ‌بنزین‌ها» و
       *     اشتراکِ فروشگاه در «فروشگاه‌ها»ی بالا؛ `/subscriptions` و نشانی‌های
       *     کهنه‌اش در App.tsx به همان‌جا می‌روند. جست‌وجوی Ctrl+K هر دو را با
       *     `PALETTE_EXTRA` پیدا می‌کند.
       */
      { to: '/sales', key: 'acSales', icon: Wallet },
      { to: '/notices', key: 'acNotices', icon: Megaphone },
      { to: '/support', key: 'acSupport', icon: MessagesSquare },
      { to: '/sync', key: 'acSync', icon: RefreshCw },
      { to: '/logins', key: 'logins', icon: LogIn },
    ],
  },
  /*
   *  ⛔ «پروژه‌ها»، «داکر»، «نسخه‌های اجرا»، «پروسه‌ها» و «زمان‌بندی» از منو
   *  رفتند (۱۴۰۵/۰۷/۱۳، خواستهٔ صاحب سامانه): این پنل برای پمپ و دکان است
   *  و هیچ‌کدام از آن پنج صفحه به کارِ سرور نبود. نشانی‌های قدیمی‌شان در
   *  App.tsx به نزدیک‌ترین صفحهٔ زنده می‌روند. «دامنه‌ها و تونل» ماند: تونل
   *  همان راهی است که api.<دامنه> به سرورِ حساب می‌رسد.
   */
  {
    id: 'projects',
    key: 'ccSection',
    collapsed: true,
    items: [
      { to: '/control/servers', key: 'ccServers', icon: Server },
      { to: '/databases', key: 'databases', icon: Database, server: 'databases' },
      { to: '/control/storage', key: 'ccStorage', icon: Archive },
      { to: '/control/vault', key: 'ccVault', icon: KeyRound, needs: 'admin' },
    ],
  },
  {
    id: 'net',
    key: 'ccInfra',
    collapsed: true,
    items: [
      { to: '/domains', key: 'domainsTunnel', icon: Globe },
      { to: '/network', key: 'network', icon: Network },
    ],
  },
  {
    id: 'watch',
    key: 'ccOps',
    collapsed: true,
    items: [
      { to: '/monitoring', key: 'monitoring', icon: Activity },
      { to: '/automation', key: 'automation', icon: Workflow },
      //  دروازهٔ پیام به مالک (۱.۵۳.۰): چه رفت، چه نرفت و چرا؛ تنظیمِ سقف، مهلت، خلاصه و ساعتِ آرام
      { to: '/alerts', key: 'ownerAlerts', icon: BellRing, needs: 'admin' },
      { to: '/logs', key: 'logs', icon: ScrollText },
    ],
  },
  {
    id: 'setup',
    key: 'navSetup',
    collapsed: true,
    items: [
      /*
       *  ⛔ تنظیماتِ سرورِ حساب (برنامه‌ها، ایمیل، پیامک، پوش، ممیزی) در
       *     ۱.۴۱.۰ از پنل رفت و تنها راهش `api.<دامنه>/admin/` شد — یعنی
       *     پنلِ دوم با ورودِ دوم. این‌جا در گروهِ **بسته** می‌نشیند، پس
       *     بلندیِ پیش‌فرضِ منو عوض نمی‌شود و سنجهٔ «منو در قاب جا می‌شود»
       *     دست‌نخورده می‌ماند.
       */
      { to: '/account-server', key: 'acServer', icon: ServerCog, needs: 'admin' },
      { to: '/control/updates', key: 'ccUpdates', icon: Download },
      //  «حسابِ من» برای هر واردشده (۶-۲) — همان گروهِ بسته، پس بلندیِ منو عوض نمی‌شود
      { to: '/account', key: 'myAccount', icon: ShieldCheck },
      { to: '/control/panel-users', key: 'ccPanelUsers', icon: UserCog, needs: 'admin', feature: 'panelUsers' },
      { to: '/files', key: 'files', icon: FolderTree, feature: 'files', server: 'files' },
      { to: '/terminal', key: 'terminal', icon: TerminalSquare, needs: 'admin', server: 'terminal' },
      { to: '/settings', key: 'settings', icon: SettingsIcon, feature: 'settings' },
    ],
  },
];

/**
 *  دری که در منو نیست ولی جست‌وجو باید پیدایش کند: «اشتراک» زدن باید به
 *  اشتراکِ هر برنامه، در بخشِ خودش، برسد (۱۴۰۵/۰۸/۰۹). نشانی از `subsPath`.
 */
const PALETTE_EXTRA: { to: string; key: keyof Dict; group: keyof Dict }[] = [
  { to: subsPath('pump'), key: 'subsPump', group: 'navEveryday' },
  { to: subsPath('shop'), key: 'subsShop', group: 'navEveryday' },
];

/** گروه‌هایی که بارِ اول بسته‌اند — تا همه‌چیز یک‌جا در قاب جا شود */
const DEFAULT_COLLAPSED = NAV_GROUPS.filter((g) => g.collapsed).map((g) => g.id);

const COLLAPSE_KEY = 'hlp.nav.collapsed';
/** نوارِ باریک (فقط نشانه) — به ازای هر مرورگر (۱.۵۱.۱) */
const RAIL_KEY = 'hlp.nav.rail';

/** ماژولی که این نشانی مالِ اوست و منوی درونی دارد (drill-in) — نشانی می‌گوید کدام منو، نه حافظهٔ صفحه. */
function moduleAt(pathname: string): PanelModule | null {
  return PANEL_MODULES.find((m) => m.subnav && m.routes.some((r) => pathname === r.path || pathname.startsWith(`${r.path}/`))) || null;
}

export default function Layout() {
  const { t, serverName, hasLogo, resolvedTheme, setTheme, lang, setLang, logout, connected, username, role, can, serverOn, owner, dir } = useApp();
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(COLLAPSE_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_COLLAPSED;
    } catch {
      return DEFAULT_COLLAPSED;
    }
  });
  const location = useLocation();
  /*
   *  ⛔ ۱.۵۱.۱ — یک جای منو، drill-in (مثلِ Azure portal / تنظیماتِ macOS): نشانیِ زیرِ ماژولی که منوی درونی دارد ⇒ همان منو
   *  **جای** منوی اصلی (ستونِ دوم رفت). ردیفِ «منوی اصلی» فقط نما را برمی‌گرداند (`peekMain`) تا نشانیِ بعدی؛ پس برگشت/جلوی
   *  مرورگر، لینکِ مستقیم و بارگذاریِ دوباره همیشه همان منویی را نشان می‌دهند که نشانی می‌گوید.
   */
  const active = moduleAt(location.pathname);
  const [peekMain, setPeekMain] = useState(false);
  useEffect(() => setPeekMain(false), [location.key]);
  const view: 'main' | 'module' = active && !peekMain ? 'module' : 'main';
  //  سُرخوردنِ کوتاه فقط وقتی نما **عوض** می‌شود (نه در نخستین بارگذاری)؛ کلاس تا نمای بعدی همان می‌ماند
  const slideRef = useRef<{ view: 'main' | 'module'; cls: string }>({ view, cls: '' });
  if (slideRef.current.view !== view) slideRef.current = { view, cls: view === 'module' ? 'nav-pane-forward' : 'nav-pane-back' };
  const slide = slideRef.current.cls;

  /*  نوارِ باریک (۶۴px، فقط نشانه + راهنمای کوچک روی ماوس و فوکوس)؛ در پنجرهٔ باریک همان کشوی رویِ صفحه می‌ماند  */
  const [rail, setRail] = useState<boolean>(() => {
    try { return localStorage.getItem(RAIL_KEY) === '1'; } catch { return false; }
  });
  const toggleRail = () => setRail((v) => {
    try { localStorage.setItem(RAIL_KEY, v ? '0' : '1'); } catch { /* حالتِ خصوصیِ مرورگر */ }
    return !v;
  });
  const [tip, setTip] = useState<{ text: string; top: number; edge: number } | null>(null);
  const tipFor = useCallback((text: string): PanelNavTip => {
    if (!rail) return {};
    const show = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      //  لبهٔ بیرونیِ نوار از سمتِ آغاز (راست در فارسی) — راهنما همان‌جا، رو به محتوا
      setTip({ text, top: r.top + r.height / 2, edge: dir === 'rtl' ? window.innerWidth - r.left : r.right });
    };
    return { onMouseEnter: (e) => show(e.currentTarget), onFocus: (e) => show(e.currentTarget), onMouseLeave: () => setTip(null), onBlur: () => setTip(null) };
  }, [rail, dir]);
  useEffect(() => setTip(null), [location.key, rail, view]);

  //  کشوی گوشی با رفتن به صفحهٔ دیگر بسته می‌شود — جز وقتی که همین کلیک به منوی درونیِ یک ماژول برد (منو را ببیند)
  const lastActive = useRef<string | null>(active?.id ?? null);
  useEffect(() => {
    const entered = Boolean(active) && lastActive.current !== active?.id;
    lastActive.current = active?.id ?? null;
    if (!entered) setOpen(false);
  }, [location.key, active]);

  /*
   *  فهرستِ جست‌وجو از همان منو ساخته می‌شود، با همان فیلترِ نقش و ویژگی —
   *  پس هیچ دری از این‌جا باز نمی‌شود که در منو بسته باشد.
   */
  const paletteItems: PaletteItem[] = useMemo(
    () => NAV_GROUPS.flatMap((group) =>
      group.items
        .filter((item) => (!item.feature || featureOn(item.feature)) && (!item.server || serverOn(item.server)) && (!item.needs || can(item.needs)) && (!item.owner || owner))
        .map((item) => ({ to: item.to, label: t(item.key), group: t(group.key) })))
      .concat(PALETTE_EXTRA.map((x) => ({ to: x.to, label: t(x.key), group: t(x.group) }))),
    [t, can, serverOn, owner]
  );
  usePaletteKey(useCallback(() => setPaletteOpen(true), []));

  const toggleGroup = (id: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch { /* حالتِ خصوصیِ مرورگر */ }
      return next;
    });
  };

  /** یک منو در هر لحظه: منوی اصلی، یا منوی درونیِ ماژولِ همین نشانی (با ردیفِ «منوی اصلی» بالایش). */
  const navBody = (compact: boolean) => {
    if (view === 'module' && active?.subnav) {
      const Sub = active.subnav.Nav;
      const ModIcon = active.subnav.icon;
      return (
        <div key="module" className={`flex flex-col gap-1 p-2 ${slide}`}>
          <button type="button" className="nav-back" onClick={() => setPeekMain(true)} data-testid="nav-back"
                  aria-label={`${t('navMainMenu')} — ${t(active.subnav.key)}`} {...tipFor(t('navMainMenu'))}>
            <ArrowRight className="nav-icon ltr:rotate-180" />
            {!compact && <span className="text-xs">{t('navMainMenu')}</span>}
          </button>
          <p className={`nav-module-title ${compact ? 'justify-center' : ''}`} title={compact ? t(active.subnav.key) : undefined}>
            <ModIcon className="nav-icon" />
            <span className={compact ? 'sr-only' : 'truncate'}>{t(active.subnav.key)}</span>
          </p>
          <Sub rail={compact} tip={tipFor} />
        </div>
      );
    }
    return (
      <nav key="main" className={`flex flex-col gap-1 p-2 ${slide}`} aria-label={t('navMainMenu')}>
        {NAV_GROUPS.map((group) => {
          const isCollapsed = collapsed.includes(group.id);
          // چیزی که خاموش است یا نقشِ کاربر به آن دسترسی ندارد، اصلاً نشان داده نمی‌شود
          const items = group.items.filter(
            (item) => (!item.feature || featureOn(item.feature)) && (!item.server || serverOn(item.server)) && (!item.needs || can(item.needs)) && (!item.owner || owner)
          );
          if (items.length === 0) return null;
          return (
            <section key={group.id} className="mb-1">
              <button
                className={`nav-group-title flex w-full items-center gap-1.5 hover:text-ink-soft ${compact ? 'justify-center' : ''}`}
                onClick={() => toggleGroup(group.id)}
                aria-expanded={!isCollapsed}
                aria-label={compact ? t(group.key) : undefined}
                {...tipFor(t(group.key))}
              >
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${isCollapsed ? 'ltr:-rotate-90 rtl:rotate-90' : ''}`} />
                <span className={compact ? 'sr-only' : 'truncate'}>{t(group.key)}</span>
              </button>
              {!isCollapsed && (
                <div className="flex flex-col gap-0.5">
                  {items.map(({ to, key, icon: Icon, end }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={end}
                      //  دوباره زدنِ «فروشگاه» وقتی منوی اصلی را نگاه می‌کنید ⇒ همان منوی درونی
                      onClick={() => setPeekMain(false)}
                      className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
                      {...tipFor(t(key))}
                    >
                      <Icon className="nav-icon" />
                      <span className={compact ? 'sr-only' : 'truncate'}>{t(key)}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </nav>
    );
  };

  return (
    <div className="flex h-full">
      {/* نوار کناری — دسکتاپ (پهن ۱۵rem، یا باریکِ ۶۴px فقط با نشانه) */}
      <aside className={`hidden shrink-0 flex-col border-e border-line bg-surface-nav transition-[width] duration-200 lg:flex ${rail ? 'w-16' : 'w-[15rem]'}`}
             data-rail={rail ? '1' : '0'}>
        <div className={`flex items-center border-b border-line ${rail ? 'flex-col gap-1 py-2' : 'justify-between'}`}>
          {rail ? <BrandMark hasLogo={hasLogo} /> : <Brand serverName={serverName} hasLogo={hasLogo} subtitle={t('appName')} />}
          <button type="button" className={`rounded-lg p-1.5 text-ink-soft hover:bg-surface-raised ${rail ? '' : 'me-3'}`} onClick={toggleRail}
                  aria-label={rail ? t('navExpand') : t('navCollapse')} aria-pressed={rail} data-testid="nav-rail-toggle" {...tipFor(t('navExpand'))}>
            {rail ? <PanelRightOpen className="h-[18px] w-[18px] ltr:-scale-x-100" /> : <PanelRightClose className="h-[18px] w-[18px] ltr:-scale-x-100" />}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden" onScroll={() => setTip(null)}>{navBody(rail)}</div>
        <footer className={`border-t border-line p-3 text-[11px] text-ink-muted ${rail ? 'hidden' : ''}`}>
          {username && (
            <p className="flex items-center gap-1.5">
              <span className="truncate">{username}</span>
              <span
                className="chip shrink-0"
                style={{
                  background: `color-mix(in srgb, ${role === 'admin' ? 'var(--status-warning)' : role === 'operator' ? 'var(--accent)' : 'var(--text-muted)'} 15%, transparent)`,
                  color: role === 'admin' ? 'var(--status-warning)' : role === 'operator' ? 'var(--accent)' : 'var(--text-secondary)',
                }}
              >
                {role === 'admin' ? t('ccRoleAdmin') : role === 'operator' ? t('ccRoleOperator') : t('ccRoleViewer')}
              </span>
            </p>
          )}
        </footer>
      </aside>
      {tip && rail && (
        <div role="tooltip" className="nav-tip" style={{ top: tip.top, insetInlineStart: tip.edge + 8 }}>{tip.text}</div>
      )}

      {/* کشوی موبایل */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 start-0 flex w-64 flex-col border-e border-line bg-surface-nav">
            <div className="flex items-center justify-between">
              <Brand serverName={serverName} hasLogo={hasLogo} subtitle={t('appName')} />
              <button className="me-3 rounded-lg p-1.5 text-ink-soft hover:bg-surface-raised" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overflow-x-hidden">{navBody(false)}</div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface/90 px-3 py-2.5 backdrop-blur sm:px-5">
          <button className="btn btn-sm lg:hidden" onClick={() => setOpen(true)} aria-label="menu">
            <Menu className="h-4 w-4" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{serverName || t('appName')}</p>
          </div>

          <span
            className="chip"
            title={connected ? t('online') : t('reconnecting')}
            style={{
              background: connected
                ? 'color-mix(in srgb, var(--status-good) 15%, transparent)'
                : 'color-mix(in srgb, var(--status-warning) 18%, transparent)',
              color: connected ? 'var(--status-good)' : 'var(--status-warning)',
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: connected ? 'var(--status-good)' : 'var(--status-warning)' }}
            />
            <span className="hidden sm:inline">{connected ? t('online') : t('reconnecting')}</span>
          </span>

          <button className="btn btn-sm" onClick={() => setPaletteOpen(true)} aria-label={t('searchOpen')} title="Ctrl+K">
            <Search className="h-4 w-4" />
            <span className="hidden sm:inline">{t('searchOpen')}</span>
          </button>

          <div className="relative">
            <button className="btn btn-sm" onClick={() => setLangOpen((v) => !v)} aria-label={t('language')}>
              <Languages className="h-4 w-4" />
              <span className="hidden sm:inline">{LANGUAGES.find((l) => l.code === lang)?.label}</span>
            </button>
            {langOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setLangOpen(false)} />
                <ul
                  className="card absolute end-0 z-20 mt-1 w-36 overflow-hidden p-1"
                  style={{ background: 'var(--surface-2)' }}
                >
                  {LANGUAGES.map((l) => (
                    <li key={l.code}>
                      <button
                        className={`w-full rounded-lg px-3 py-2 text-start text-sm hover:bg-surface-raised ${
                          l.code === lang ? 'font-semibold text-ink' : 'text-ink-soft'
                        }`}
                        onClick={() => {
                          setLang(l.code);
                          setLangOpen(false);
                        }}
                      >
                        {l.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <button
            className="btn btn-sm"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            aria-label={t('theme')}
          >
            {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <button className="btn btn-sm" onClick={logout} aria-label={t('logout')}>
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">{t('logout')}</span>
          </button>
        </header>

        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />

        <main className="min-h-0 flex-1 overflow-y-auto bg-surface-sunken p-3 sm:p-5">
          {/* ⛔ یک صفحهٔ خراب کلِ برنامه را نمی‌بندد (۱۴۰۵/۰۷/۱۰) — و
              `key`ِ مسیر یعنی با رفتن به صفحهٔ دیگر، از نو ساخته می‌شود. */}
          <PageBoundary key={location.pathname}>
            <Outlet />
          </PageBoundary>
        </main>
      </div>
    </div>
  );
}

/** نشانهٔ تنها (نوارِ باریک) */
function BrandMark({ hasLogo }: { hasLogo: boolean }) {
  return hasLogo ? (
    <img src={logoUrl()} alt="" className="h-8 w-8 rounded-lg object-cover" />
  ) : (
    <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
      <Server className="h-4 w-4" />
    </span>
  );
}

function Brand({ serverName, hasLogo, subtitle }: { serverName: string; hasLogo: boolean; subtitle: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 p-4">
      {hasLogo ? (
        <img src={logoUrl()} alt="" className="h-8 w-8 rounded-lg object-cover" />
      ) : (
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          <Server className="h-4 w-4" />
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{serverName || subtitle}</p>
        <p className="truncate text-[11px] text-ink-muted">{subtitle}</p>
      </div>
    </div>
  );
}
