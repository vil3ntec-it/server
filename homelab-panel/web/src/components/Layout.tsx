import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity,
  FolderTree,
  Gauge,
  Globe,
  LayoutDashboard,
  Languages,
  LogOut,
  Menu,
  Moon,
  Network,
  ScrollText,
  Server,
  Settings as SettingsIcon,
  Sun,
  X,
} from 'lucide-react';
import { useApp } from '../app-context';
import { LANGUAGES, type Dict } from '../i18n';
import { logoUrl } from '../api';

const NAV: { to: string; key: keyof Dict; icon: typeof Gauge }[] = [
  { to: '/', key: 'dashboard', icon: LayoutDashboard },
  { to: '/sites', key: 'websites', icon: Server },
  { to: '/domains', key: 'domains', icon: Globe },
  { to: '/files', key: 'files', icon: FolderTree },
  { to: '/monitoring', key: 'monitoring', icon: Activity },
  { to: '/network', key: 'network', icon: Network },
  { to: '/logs', key: 'logs', icon: ScrollText },
  { to: '/site-server', key: 'siteServer', icon: Gauge },
  { to: '/settings', key: 'settings', icon: SettingsIcon },
];

export default function Layout() {
  const { t, serverName, hasLogo, resolvedTheme, setTheme, lang, setLang, logout, connected, username } = useApp();
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  const nav = (
    <nav className="flex flex-col gap-0.5 p-3">
      {NAV.map(({ to, key, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors ${
              isActive ? 'font-semibold text-white' : 'text-ink-soft hover:bg-surface-raised hover:text-ink'
            }`
          }
          style={({ isActive }) => (isActive ? { background: 'var(--series-1)' } : undefined)}
        >
          <Icon className="h-[18px] w-[18px] shrink-0" />
          {t(key)}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex h-full">
      {/* نوار کناری — دسکتاپ */}
      <aside className="hidden w-60 shrink-0 flex-col border-e border-line bg-surface lg:flex">
        <Brand serverName={serverName} hasLogo={hasLogo} subtitle={t('appName')} />
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <footer className="border-t border-line p-3 text-[11px] text-ink-muted">
          {username && <p className="truncate">{username}</p>}
        </footer>
      </aside>

      {/* کشوی موبایل */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 start-0 flex w-64 flex-col border-e border-line bg-surface">
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
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
          style={{ background: 'var(--series-1)' }}
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
