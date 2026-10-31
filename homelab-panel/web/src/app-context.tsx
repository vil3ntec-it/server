import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, getToken, setMustChangeHandler, setToken, setUnauthorizedHandler } from './api';
import { dirOf, translate, type Dict, type Lang } from './i18n';
import type { HistoryPoint, MetricsSnapshot, Site } from './types';

type Theme = 'dark' | 'light' | 'system';

export type PanelRole = 'viewer' | 'operator' | 'admin';

type AppState = {
  ready: boolean;
  initialized: boolean;
  authed: boolean;
  username: string | null;
  role: PanelRole;
  /** مالکِ اصلیِ پنل (قدیمی‌ترین مدیرِ فعال) — فقط برای نمایش؛ مجوز در سرور است */
  owner: boolean;
  /** با رمزِ یک‌بارمصرفِ `vill3n owner-reset` وارد شده ⇒ اول رمزِ تازه */
  mustChangePassword: boolean;
  /** آیا نقشِ فعلی دستِ‌کم این اندازه دسترسی دارد؟ */
  can: (needed: PanelRole) => boolean;
  serverName: string;
  hasLogo: boolean;
  lang: Lang;
  dir: 'rtl' | 'ltr';
  theme: Theme;
  resolvedTheme: 'dark' | 'light';
  metrics: MetricsSnapshot | null;
  history: HistoryPoint[];
  sites: Site[];
  connected: boolean;
  socket: Socket | null;
  t: (key: keyof Dict, vars?: Record<string, string | number>) => string;
  setLang: (l: Lang) => void;
  setTheme: (t: Theme) => void;
  login: (username: string, password: string) => Promise<{ totpRequired: true; ticket: string } | void>;
  loginTotp: (ticket: string, code: string) => Promise<void>;
  setup: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshPublic: () => Promise<void>;
};

const Ctx = createContext<AppState | null>(null);

const prefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [initialized, setInitialized] = useState(true);
  const [authed, setAuthed] = useState(Boolean(getToken()));
  const [username, setUsername] = useState<string | null>(null);
  const [role, setRole] = useState<PanelRole>('viewer');
  const [owner, setOwner] = useState(false);
  const [mustChangePassword, setMustChange] = useState(false);
  const [serverName, setServerName] = useState('');
  const [hasLogo, setHasLogo] = useState(false);
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem('hlp.lang') as Lang) || 'fa');
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem('hlp.theme') as Theme) || 'dark');
  const [systemDark, setSystemDark] = useState(prefersDark);

  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  const resolvedTheme: 'dark' | 'light' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  const dir = dirOf(lang);

  // پوسته و جهت روی خودِ سند اعمال می‌شود
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', dir);
  }, [resolvedTheme, lang, dir]);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const handler = () => setSystemDark(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const t = useCallback(
    (key: keyof Dict, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang]
  );

  const RANK: Record<PanelRole, number> = { viewer: 0, operator: 1, admin: 2 };
  const can = useCallback((needed: PanelRole) => RANK[role] >= RANK[needed], [role]);

  const refreshPublic = useCallback(async () => {
    try {
      const [status, pub] = await Promise.all([
        api<{ initialized: boolean }>('/api/auth/status'),
        api<{ serverName: string; hasLogo: boolean; language: Lang; theme: Theme }>('/api/settings/public'),
      ]);
      setInitialized(status.initialized);
      setServerName(pub.serverName);
      setHasLogo(pub.hasLogo);
      // اگر کاربر روی این مرورگر انتخابی نکرده، از تنظیم سرور پیروی کن
      if (!localStorage.getItem('hlp.lang') && pub.language) setLangState(pub.language);
      if (!localStorage.getItem('hlp.theme') && pub.theme) setThemeState(pub.theme);
    } catch {
      /* سرور در دسترس نیست — صفحهٔ ورود همچنان نشان داده می‌شود */
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthed(false);
      setUsername(null);
      setRole('viewer');
      setOwner(false);
      setMustChange(false);
    });
    setMustChangeHandler(() => setMustChange(true));
    return () => setMustChangeHandler(null);
  }, []);

  useEffect(() => {
    (async () => {
      await refreshPublic();
      if (getToken()) {
        try {
          const me = await api<{ user: { username: string; role: PanelRole }; owner?: boolean; mustChangePassword?: boolean }>('/api/auth/me');
          setUsername(me.user.username);
          setRole(me.user.role || 'viewer');
          setOwner(Boolean(me.owner));
          setMustChange(Boolean(me.mustChangePassword));
          setAuthed(true);
        } catch {
          setAuthed(false);
        }
      }
      setReady(true);
    })();
  }, [refreshPublic]);

  // Socket.IO — اطلاعات لحظه‌ای
  useEffect(() => {
    //  نشستِ رمزِ یک‌بارمصرف وب‌سوکت ندارد (سرور هم ردش می‌کند)
    if (!authed || mustChangePassword) {
      setSocket(null);
      setConnected(false);
      return;
    }
    const s = io({ auth: { token: getToken() }, transports: ['websocket', 'polling'] });
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', () => setConnected(false));
    s.on('history', (h: HistoryPoint[]) => setHistory(h));
    s.on('metrics', (snapshot: MetricsSnapshot) => {
      setMetrics(snapshot);
      setHistory((prev) => {
        const next = [
          ...prev,
          {
            at: snapshot.at,
            cpu: snapshot.cpu.usage,
            memory: snapshot.memory.usage,
            disk: snapshot.disk.usage,
            rx: snapshot.network.rxBytesPerSec,
            tx: snapshot.network.txBytesPerSec,
            temp: snapshot.temperature.max,
          },
        ];
        return next.length > 180 ? next.slice(next.length - 180) : next;
      });
    });
    s.on('sites', (payload: { sites: Site[] }) => setSites(payload.sites));

    // وقتی تب پشت پنجره می‌رود به سرور خبر می‌دهیم تا بی‌جهت کار نکند
    // (روی کامپیوتر ضعیف تفاوتش محسوس است)
    const reportVisibility = () => s.emit('viewer', document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', reportVisibility);
    s.on('connect', reportVisibility);

    setSocket(s);
    return () => {
      document.removeEventListener('visibilitychange', reportVisibility);
      s.close();
    };
  }, [authed, mustChangePassword]);

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem('hlp.lang', l);
    setLangState(l);
  }, []);

  const setTheme = useCallback((v: Theme) => {
    localStorage.setItem('hlp.theme', v);
    setThemeState(v);
  }, []);

  const login = useCallback(async (u: string, p: string) => {
    const res = await api<{ ok: boolean; totpRequired?: boolean; ticket?: string; token?: string; mustChangePassword?: boolean; user?: { username: string; role: PanelRole } }>('/api/auth/login', {
      body: { username: u, password: p },
    });
    // ورودِ دوعاملی: رمز درست بود، حالا کدِ اپ لازم است
    if (res.totpRequired && res.ticket) return { totpRequired: true as const, ticket: res.ticket };
    setToken(res.token || null);
    setUsername(res.user?.username || null);
    setRole(res.user?.role || 'viewer');
    setMustChange(Boolean(res.mustChangePassword));
    setAuthed(true);
    api<{ owner?: boolean }>('/api/auth/me').then((me) => setOwner(Boolean(me.owner))).catch(() => {});
  }, []);

  const loginTotp = useCallback(async (ticket: string, code: string) => {
    const res = await api<{ token: string; user: { username: string; role: PanelRole } }>('/api/auth/login/totp', {
      body: { ticket, code },
    });
    setToken(res.token);
    setUsername(res.user.username);
    setRole(res.user.role || 'viewer');
    setMustChange(Boolean((res as { mustChangePassword?: boolean }).mustChangePassword));
    setAuthed(true);
    api<{ owner?: boolean }>('/api/auth/me').then((me) => setOwner(Boolean(me.owner))).catch(() => {});
  }, []);

  const setup = useCallback(async (u: string, p: string) => {
    const res = await api<{ token: string; user: { username: string; role: PanelRole } }>('/api/auth/setup', {
      body: { username: u, password: p },
    });
    setToken(res.token);
    setUsername(res.user.username);
    setRole(res.user.role || 'admin');
    setOwner(true);
    setInitialized(true);
    setAuthed(true);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* توکن شاید از قبل باطل بوده */
    }
    setToken(null);
    setAuthed(false);
    setUsername(null);
    setRole('viewer');
    setOwner(false);
    setMustChange(false);
    setMetrics(null);
    setHistory([]);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      ready,
      initialized,
      authed,
      username,
      role,
      owner,
      mustChangePassword,
      can,
      serverName,
      hasLogo,
      lang,
      dir,
      theme,
      resolvedTheme,
      metrics,
      history,
      sites,
      connected,
      socket,
      t,
      setLang,
      setTheme,
      login,
      loginTotp,
      setup,
      logout,
      refreshPublic,
    }),
    [
      ready, initialized, authed, username, role, owner, mustChangePassword, can, serverName, hasLogo, lang, dir, theme, resolvedTheme,
      metrics, history, sites, connected, socket, t, setLang, setTheme, login, setup, logout, refreshPublic,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
