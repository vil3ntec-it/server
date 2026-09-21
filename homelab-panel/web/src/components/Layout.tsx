import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity,
  Bot,
  Archive,
  Boxes,
  ChevronDown,
  CalendarClock,
  Workflow,
  Container,
  Cpu,
  Database,
  Layers,
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
  ScrollText,
  Server,
  ServerCog,
  Settings as SettingsIcon,
  Sun,
  TerminalSquare,
  UserCog,
  X,
  Fuel,
  Store,
  Hash,
  LogIn,
  Megaphone,
  MessagesSquare,
  RefreshCw,
  Search,
  Tag,
  Users,
  Wallet,
} from 'lucide-react';
import { useApp } from '../app-context';
import { LANGUAGES, type Dict } from '../i18n';
import { featureOn, type FeatureKey } from '../features';
import { logoUrl } from '../api';
import CommandPalette, { usePaletteKey, type PaletteItem } from './CommandPalette';

type NavItem = {
  to: string;
  key: keyof Dict;
  icon: typeof Gauge;
  end?: boolean;
  needs?: 'operator' | 'admin';
  /** اگر این بخش در features.ts خاموش باشد، اصلاً در منو نمی‌آید */
  feature?: FeatureKey;
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
      { to: '/assistant', key: 'agTitle', icon: Bot },
      { to: '/control', key: 'ccCommand', icon: CommandIcon, end: true, feature: 'commandCenter' },
      { to: '/sites', key: 'websites', icon: Server },
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
      { to: '/shop', key: 'navShops', icon: Store },
      { to: '/codes', key: 'codesTitle', icon: Hash },
    ],
  },
  /*
   *  مشتری، پول و پیام — هر شش‌تا از **سرورِ حساب** می‌آیند و هیچ دفترِ
   *  دومی در این پنل ندارند. باز است چون کارِ هر روزِ صاحبِ سامانه است:
   *  اشتراک دادن، رسید بریدن، جوابِ پشتیبانی.
   */
  {
    id: 'money',
    key: 'navMoney',
    items: [
      { to: '/customers', key: 'acCustomers', icon: Users },
      { to: '/sales', key: 'acSales', icon: Wallet },
      { to: '/plans', key: 'acPlans', icon: Tag },
      { to: '/notices', key: 'acNotices', icon: Megaphone },
      { to: '/support', key: 'acSupport', icon: MessagesSquare },
      { to: '/sync', key: 'acSync', icon: RefreshCw },
      { to: '/logins', key: 'logins', icon: LogIn },
    ],
  },
  {
    id: 'projects',
    key: 'ccSection',
    collapsed: true,
    items: [
      { to: '/control/projects', key: 'ccProjects', icon: Boxes },
      { to: '/control/servers', key: 'ccServers', icon: Server },
      { to: '/docker', key: 'docker', icon: Container },
      { to: '/databases', key: 'databases', icon: Database },
      { to: '/runtimes', key: 'runtimes', icon: Layers },
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
      { to: '/processes', key: 'processes', icon: Cpu },
      { to: '/cron', key: 'cron', icon: CalendarClock },
      { to: '/automation', key: 'automation', icon: Workflow },
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
      { to: '/control/panel-users', key: 'ccPanelUsers', icon: UserCog, needs: 'admin', feature: 'panelUsers' },
      { to: '/files', key: 'files', icon: FolderTree, feature: 'files' },
      { to: '/terminal', key: 'terminal', icon: TerminalSquare, needs: 'admin' },
      { to: '/settings', key: 'settings', icon: SettingsIcon, feature: 'settings' },
    ],
  },
];

/** گروه‌هایی که بارِ اول بسته‌اند — تا همه‌چیز یک‌جا در قاب جا شود */
const DEFAULT_COLLAPSED = NAV_GROUPS.filter((g) => g.collapsed).map((g) => g.id);

const COLLAPSE_KEY = 'hlp.nav.collapsed';

export default function Layout() {
  const { t, serverName, hasLogo, resolvedTheme, setTheme, lang, setLang, logout, connected, username, role, can } = useApp();
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

  useEffect(() => setOpen(false), [location.pathname]);

  /*
   *  فهرستِ جست‌وجو از همان منو ساخته می‌شود، با همان فیلترِ نقش و ویژگی —
   *  پس هیچ دری از این‌جا باز نمی‌شود که در منو بسته باشد.
   */
  const paletteItems: PaletteItem[] = useMemo(
    () => NAV_GROUPS.flatMap((group) =>
      group.items
        .filter((item) => (!item.feature || featureOn(item.feature)) && (!item.needs || can(item.needs)))
        .map((item) => ({ to: item.to, label: t(item.key), group: t(group.key) }))),
    [t, can]
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

  const nav = (
    <nav className="flex flex-col gap-1 p-3">
      {NAV_GROUPS.map((group) => {
        const isCollapsed = collapsed.includes(group.id);
        // چیزی که خاموش است یا نقشِ کاربر به آن دسترسی ندارد، اصلاً نشان داده نمی‌شود
        const items = group.items.filter(
          (item) => (!item.feature || featureOn(item.feature)) && (!item.needs || can(item.needs))
        );
        if (items.length === 0) return null;
        return (
          <section key={group.id} className="mb-1">
            <button
              className="nav-group-title flex w-full items-center gap-1.5 hover:text-ink-soft"
              onClick={() => toggleGroup(group.id)}
              aria-expanded={!isCollapsed}
            >
              <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${isCollapsed ? 'ltr:-rotate-90 rtl:rotate-90' : ''}`} />
              <span className="truncate">{t(group.key)}</span>
            </button>
            {!isCollapsed && (
              <div className="flex flex-col gap-0.5">
                {items.map(({ to, key, icon: Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{t(key)}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </nav>
  );

  return (
    <div className="flex h-full">
      {/* نوار کناری — دسکتاپ */}
      <aside className="hidden w-[15rem] shrink-0 flex-col border-e border-line bg-surface-nav lg:flex">
        <Brand serverName={serverName} hasLogo={hasLogo} subtitle={t('appName')} />
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <footer className="border-t border-line p-3 text-[11px] text-ink-muted">
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
            <div className="flex-1 overflow-y-auto">{nav}</div>
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
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Brand({ serverName, hasLogo, subtitle }: { serverName: string; hasLogo: boolean; subtitle: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line p-4">
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
