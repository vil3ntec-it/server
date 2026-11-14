/// <reference types="vite/client" />
// ---------------------------------------------------------------------------
//  🏪 ساختِ جدای بخشِ «فروشگاه» — کمینه‌ترین میزبان: ورود، نشست، زبان و یک چیدمانِ ساده (شرح: ‎docs/SHOP-MODULE-fa.md‎)
//
//  ⛔ ورود همان ورودِ پلِ سرورِ حساب است: ‎POST /api/auth/login‎ (+ ‎/login/totp‎ اگر دوعاملی روشن است) روی همان سروری که
//     ‎/api/account-admin/*‎ را می‌دهد (امروز سرورِ پنل). نقش و «مالک» از ‎GET /api/auth/me‎ — فقط برای نشان دادن؛ مرز در سرور است.
//  ⛔ هیچ صفحه‌ای از پنل این‌جا نیست: فقط شناسنامهٔ ماژول (‎../index.ts‎) و تکه‌های ‎shared-pieces.json‎.
//  ⛔ رمز هرگز نگه داشته نمی‌شود؛ فقط توکنِ نشست، همان‌جا که ‎api.ts‎ نگهش می‌دارد.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LogOut, Store } from 'lucide-react';

import { api, ApiError, getToken, setToken, setUnauthorizedHandler } from '../../../api';
import { AppStateProvider, type AppState, type PanelRole } from '../../../app-context';
import { serverFeatureOn, type ServerFeatures } from '../../../features';
import { dirOf, LANGUAGES, translate, type Dict, type Lang } from '../../../i18n';
import { Loading, ToastHost } from '../../../components/ui';
import ReauthHost from '../../../components/ReauthHost';
import { useTx } from '../../../pages/account/console/text';
import shop from '../index';

type User = { username: string; role: PanelRole };
type Me = { user: User; owner?: boolean; mustChangePassword?: boolean; deploy?: { features?: ServerFeatures } };
type LoginRes = { totpRequired?: boolean; ticket?: string; token?: string; mustChangePassword?: boolean; user?: User };

const RANK: Record<PanelRole, number> = { viewer: 0, operator: 1, admin: 2 };
const LANG_KEY = 'hlp.lang';
const readLang = (): Lang => {
  try { return (localStorage.getItem(LANG_KEY) as Lang) || 'fa'; } catch { return 'fa'; }
};

/** زمینهٔ ‎useApp‎ برای تکه‌های مشترک — همهٔ فیلدهای ‎AppState‎ (نبودنِ یکی ⇒ ‎tsc‎ سرخ)، ولی فقط آن‌چه این میزبان واقعاً دارد. */
function useStandaloneState(): AppState {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(Boolean(getToken()));
  const [user, setUser] = useState<User | null>(null);
  const [owner, setOwner] = useState(false);
  const [mustChangePassword, setMustChange] = useState(false);
  const [features, setFeatures] = useState<ServerFeatures | null>(null);
  const [lang, setLangState] = useState<Lang>(readLang);
  const dir = dirOf(lang);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', dir);
  }, [lang, dir]);

  const signedOut = useCallback(() => {
    setAuthed(false); setUser(null); setOwner(false); setMustChange(false); setFeatures(null);
  }, []);
  useEffect(() => { setUnauthorizedHandler(signedOut); }, [signedOut]);

  /** نشستِ مانده یا تازه ⇒ نقش، «مالک» و قابلیت‌های همین میزبان از ‎/api/auth/me‎ */
  const loadMe = useCallback(async () => {
    const me = await api<Me>('/api/auth/me');
    setUser({ username: me.user.username, role: me.user.role || 'viewer' });
    setOwner(Boolean(me.owner));
    setMustChange(Boolean(me.mustChangePassword));
    setFeatures(me.deploy?.features || null);
    setAuthed(true);
  }, []);

  useEffect(() => {
    (async () => {
      if (getToken()) { try { await loadMe(); } catch { signedOut(); } }
      setReady(true);
    })();
  }, [loadMe, signedOut]);

  const afterLogin = useCallback(async (res: { token?: string }) => {
    setToken(res.token || null);
    await loadMe();
  }, [loadMe]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api<LoginRes>('/api/auth/login', { body: { username, password } });
    if (res.totpRequired && res.ticket) return { totpRequired: true as const, ticket: res.ticket };
    await afterLogin(res);
  }, [afterLogin]);

  const loginTotp = useCallback(async (ticket: string, code: string) => {
    await afterLogin(await api<LoginRes>('/api/auth/login/totp', { body: { ticket, code } }));
  }, [afterLogin]);

  const logout = useCallback(async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* توکن شاید از پیش باطل بوده */ }
    setToken(null);
    signedOut();
  }, [signedOut]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* حالتِ خصوصی */ }
  }, []);

  const role: PanelRole = user?.role || 'viewer';
  const can = useCallback((needed: PanelRole) => RANK[role] >= RANK[needed], [role]);
  const t = useCallback((key: keyof Dict, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);

  return useMemo<AppState>(() => ({
    ready, initialized: true, setupCodeNeeded: false, authed, username: user?.username || null, role, owner, mustChangePassword,
    can, serverOn: (f) => serverFeatureOn(features, f), deployProfile: null, serverName: '', hasLogo: false,
    lang, dir, theme: 'dark', resolvedTheme: 'dark',
    //  نه نمودارِ پنل، نه فهرستِ سایت‌ها، نه سوکت: صفحه‌ها با خواندنِ خودشان تازه می‌شوند
    metrics: null, history: [], sites: [], connected: false, socket: null,
    t, setLang, setTheme: () => {}, login, loginTotp,
    setup: async () => { throw new ApiError(400, 'setup_in_panel', 'نخستین مدیر در خودِ پنل ساخته می‌شود'); },
    logout, refreshPublic: async () => {},
  }), [ready, authed, user, role, owner, mustChangePassword, can, features, lang, dir, t, setLang, login, loginTotp, logout]);
}

function LoginForm({ state }: { state: AppState }) {
  const tx = useTx();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [ticket, setTicket] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (ticket) await state.loginTotp(ticket, code.trim());
      else {
        const r = await state.login(username.trim(), password);
        if (r && r.totpRequired) { setTicket(r.ticket); setPassword(''); }
      }
    } catch (err) {
      setError(err instanceof ApiError ? `${err.message} (${err.code})` : String((err as Error)?.message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form className="card rise w-full max-w-sm p-5" onSubmit={submit}>
        <div className="mb-4 flex items-center gap-2">
          <Store className="h-5 w-5" />
          <h1 className="text-lg font-semibold">{tx('فروشگاه', 'Shop', 'هټۍ')}</h1>
        </div>
        <p className="mb-4 text-xs text-ink-muted">
          {tx('با همان حسابِ پنل وارد شوید — نقش و دسترسی همان است که سرور می‌گوید.', 'Sign in with your panel account — the server decides role and access.', 'د پینل په حساب ننوځئ.')}
        </p>
        {ticket ? (
          <label className="block">
            <span className="label">{tx('کدِ شش‌رقمیِ اپ', '6-digit app code', 'د اپ شپږ عددي کوډ')}</span>
            <input className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          </label>
        ) : (
          <>
            <label className="block">
              <span className="label">{tx('نامِ کاربری', 'Username', 'کارن نوم')}</span>
              <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </label>
            <label className="mt-3 block">
              <span className="label">{tx('رمز', 'Password', 'پټنوم')}</span>
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </>
        )}
        {error && <p role="alert" className="mt-3 rounded-xl px-3 py-2 text-xs text-state-bad">{error}</p>}
        <button className="btn btn-primary mt-4 w-full" disabled={busy || (ticket ? code.trim().length < 6 : !username.trim() || !password)}>
          {tx('ورود', 'Sign in', 'ننوتل')}
        </button>
        {ticket && (
          <button type="button" className="btn mt-2 w-full" onClick={() => { setTicket(null); setCode(''); setError(null); }}>
            {tx('برگشت', 'Back', 'شاته')}
          </button>
        )}
      </form>
    </div>
  );
}

/** چیدمانِ ساده: یک نوار (نام، کاربر، زبان، خروج) و جای ماژول — بی منوی پنل. */
function PlainLayout({ state }: { state: AppState }) {
  const tx = useTx();
  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <Store className="h-5 w-5" />
        <span className="font-semibold">{tx('فروشگاه', 'Shop', 'هټۍ')}</span>
        <span className="ms-auto text-xs text-ink-muted" data-testid="standalone-user">{state.username} · {state.role}</span>
        <select className="input w-auto py-1 text-xs" aria-label={tx('زبان', 'Language', 'ژبه')} value={state.lang} onChange={(e) => state.setLang(e.target.value as Lang)}>
          {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <button type="button" className="btn py-1 text-xs" onClick={() => void state.logout()}>
          <LogOut className="me-1 inline h-3.5 w-3.5" />{tx('خروج', 'Sign out', 'وتل')}
        </button>
      </header>
      <main className="mx-auto max-w-7xl p-4">
        <Routes>
          {shop.routes.map((r) => <Route key={r.path} path={r.path} element={<r.component />} />)}
          <Route path="*" element={<Navigate to={shop.routes[0].path} replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Body({ state }: { state: AppState }) {
  const tx = useTx();
  if (!state.ready) return <Loading />;
  if (!state.authed) return <LoginForm state={state} />;
  if (state.mustChangePassword) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-4 text-center">
        <p>{tx('این نشست با رمزِ یک‌بارمصرف است — رمزِ تازه را در خودِ پنل بگذارید.', 'This session uses a one-time password — set a new one in the panel first.', 'لومړی په پینل کې نوی پټنوم کېږدئ.')}</p>
        <button type="button" className="btn" onClick={() => void state.logout()}>{tx('خروج', 'Sign out', 'وتل')}</button>
      </div>
    );
  }
  return <PlainLayout state={state} />;
}

/** ‎VITE_SHOP_ROUTER=hash‎ ⇒ ‎HashRouter‎ (پوشیدن در برنامهٔ دسکتاپ/موبایل که ‎file://‎ یا نشانیِ ثابت دارد). */
const Router = import.meta.env.VITE_SHOP_ROUTER === 'hash' ? HashRouter : BrowserRouter;

export default function StandaloneApp() {
  const state = useStandaloneState();
  return (
    <Router>
      <AppStateProvider value={state}>
        <Body state={state} />
        <ToastHost />
        <ReauthHost />
      </AppStateProvider>
    </Router>
  );
}
