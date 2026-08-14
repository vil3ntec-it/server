import { useState, type FormEvent } from 'react';
import { KeyRound, Loader2, Server, User } from 'lucide-react';
import { useApp } from '../app-context';
import { ApiError, logoUrl } from '../api';
import { LANGUAGES } from '../i18n';

export default function Login() {
  const { t, initialized, login, setup, serverName, hasLogo, lang, setLang, resolvedTheme, setTheme } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (initialized) await login(username, password);
      else await setup(username, password);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'invalid_credentials') setError(t('wrongCredentials'));
        else if (err.code === 'password_too_short') setError(t('passwordTooShort'));
        else if (err.code === 'username_too_short') setError(t('usernameTooShort'));
        else setError(err.code);
      } else {
        setError(t('connectionLost'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-surface-sunken p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          {hasLogo ? (
            <img src={logoUrl()} alt="" className="h-14 w-14 rounded-2xl object-cover" />
          ) : (
            <span
              className="flex h-14 w-14 items-center justify-center rounded-2xl text-white"
              style={{ background: 'var(--series-1)' }}
            >
              <Server className="h-7 w-7" />
            </span>
          )}
          <div>
            <h1 className="text-lg font-semibold">{serverName || t('appName')}</h1>
            <p className="text-xs text-ink-muted">{t('appName')}</p>
          </div>
        </div>

        <form onSubmit={submit} className="card rise p-5">
          <h2 className="mb-1 text-sm font-semibold">{initialized ? t('login') : t('createAdmin')}</h2>
          {!initialized && <p className="mb-4 text-xs text-ink-muted">{t('firstRunHint')}</p>}

          <label className="label mt-3">{t('username')}</label>
          <div className="relative">
            <User className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-ink-muted" />
            <input
              className="input ps-9"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          <label className="label mt-3">{t('password')}</label>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-ink-muted" />
            <input
              className="input ps-9"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={initialized ? 'current-password' : 'new-password'}
              required
            />
          </div>

          {error && (
            <p
              className="mt-3 rounded-xl px-3 py-2 text-xs"
              style={{
                background: 'color-mix(in srgb, var(--status-critical) 12%, transparent)',
                color: 'var(--status-critical)',
              }}
            >
              {error}
            </p>
          )}

          <button className="btn btn-primary mt-4 w-full" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {initialized ? t('login') : t('createAdmin')}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-center gap-2">
          <select
            className="input w-auto py-1.5 text-xs"
            value={lang}
            onChange={(e) => setLang(e.target.value as typeof lang)}
            aria-label={t('language')}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
            {resolvedTheme === 'dark' ? t('light') : t('dark')}
          </button>
        </div>
      </div>
    </div>
  );
}
