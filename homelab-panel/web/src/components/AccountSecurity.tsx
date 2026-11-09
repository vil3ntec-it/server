// ---------------------------------------------------------------------------
//  امنیتِ حسابِ خودِ آدم: رمز، ورودِ دوعاملی، دستگاه‌های واردشده
//
//  ⛔ (فاز ۱ ِ ممیزی، ۶-۲ / S5) تا ۱.۵۰.۶۱ این بخش فقط داخلِ `Settings` بود و
//  `Settings` پشتِ `FEATURES.settings=false` — یعنی صاحبِ سامانه از **هیچ**
//  رابطی نمی‌توانست دوعاملی روشن کند، با این‌که API آماده و آزموده بود. حالا
//  همین یک جزء هم در «حسابِ من» (`/account`، همیشه روشن) است و هم در
//  `Settings`؛ دو نسخه نیست.
//
//  ⚠️ روشن کردنِ دوعاملی احرازِ دوباره می‌خواهد (سرور)؛ پنجره‌اش را
//  `ReauthHost` خودکار باز می‌کند.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useApp } from '../app-context';
import { api, ApiError } from '../api';
import { Card, Field, toast } from './ui';
import CodeInput from './CodeInput';
import { dateTime } from '../format';

type Session = { id: string; created_at: number; user_agent: string; ip: string; last_seen_at?: number | null; current?: boolean };

const PW_ERRORS: Record<string, string> = {
  wrong_password: 'رمزِ فعلی درست نیست.',
  same_password: 'رمزِ تازه باید با رمزِ فعلی فرق کند.',
  password_too_short: 'رمزِ تازه دست‌کم ۸ نویسه.',
  password_too_long: 'رمزِ تازه حداکثر ۲۰۰ نویسه.',
  rate_limited: 'تلاش زیاد شد؛ کمی بعد دوباره.',
};

export default function AccountSecurity({ onPasswordChanged }: { onPasswordChanged?: () => void }) {
  const { t, lang } = useApp();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [totp, setTotp] = useState<{ enabled: boolean; recoveryLeft: number } | null>(null);
  const [totpSetup, setTotpSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disablePw, setDisablePw] = useState('');
  const [codeReset, setCodeReset] = useState(0);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const loadSessions = () => api<{ sessions: Session[] }>('/api/auth/sessions').then((r) => setSessions(r.sessions)).catch(() => {});
  const loadTotp = () => api<{ enabled: boolean; recoveryLeft: number }>('/api/auth/totp').then(setTotp).catch(() => {});

  useEffect(() => {
    loadSessions();
    loadTotp();
  }, []);

  return (
    <Card title={t('security')} icon={<KeyRound className="h-4 w-4" />}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('currentPassword')}>
          <input
            className="input"
            type="password"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <Field label={t('newPassword')}>
          <input
            className="input"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
      </div>
      <p className="-mt-1 mb-2 text-[11px] text-ink-muted">
        با عوض شدنِ رمز، همهٔ دستگاه‌ها — همین یکی هم — بیرون می‌روند و باید با رمزِ تازه وارد شوید.
      </p>
      <button
        className="btn btn-primary"
        disabled={busy || !oldPassword || newPassword.length < 8}
        onClick={async () => {
          setBusy(true);
          try {
            await api('/api/auth/change-password', { body: { oldPassword, newPassword } });
            setOldPassword('');
            setNewPassword('');
            toast(t('saved'));
            onPasswordChanged?.();
          } catch (e) {
            const c = e instanceof ApiError ? e.code : '';
            toast(PW_ERRORS[c] || c || t('error'), 'bad');
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('changePassword')}
      </button>

      {/* ورودِ دوعاملی — بخشِ ۴ پرامپت */}
      <p className="label mt-5">{t('totpTitle')}</p>
      <p className="mb-2 text-xs text-ink-muted">{t('totpHint')}</p>
      {!totp && <p className="text-xs text-ink-muted">…</p>}
      {totp && !totp.enabled && !totpSetup && (
        <button
          className="btn"
          onClick={async () => {
            try {
              setTotpSetup(await api('/api/auth/totp/setup', { method: 'POST' }));
              setRecoveryCodes(null);
            } catch (e) {
              toast(e instanceof ApiError ? (e.code === 'reauth_required' ? 'بی رمزِ تازه روشن نشد.' : e.code) : t('error'), 'bad');
            }
          }}
        >
          {t('totpEnable')}
        </button>
      )}
      {totpSetup && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-line p-4">
          <p className="text-xs text-ink-soft">{t('totpScan')}</p>
          <img src={totpSetup.qr} alt="" className="h-44 w-44 rounded-lg bg-white p-1" />
          <p className="text-[11px] text-ink-muted">
            {t('totpSecret')}: <code className="select-all" dir="ltr">{totpSetup.secret}</code>
          </p>
          <CodeInput
            resetKey={codeReset}
            autoFocus={false}
            onComplete={async (code) => {
              try {
                const r = await api<{ recoveryCodes: string[] }>('/api/auth/totp/enable', { body: { code } });
                setRecoveryCodes(r.recoveryCodes);
                setTotpSetup(null);
                loadTotp();
                toast(t('totpEnabled'));
              } catch (e) {
                toast(e instanceof ApiError && e.code === 'totp_invalid' ? t('totpWrong') : t('error'), 'bad');
                setCodeReset((n) => n + 1);
              }
            }}
          />
          <button className="btn btn-sm" onClick={() => setTotpSetup(null)}>{t('cancel')}</button>
        </div>
      )}
      {recoveryCodes && (
        <div className="rounded-xl border border-line p-4">
          <p className="text-xs font-semibold">{t('totpRecoveryTitle')}</p>
          <p className="mb-2 text-[11px] text-ink-muted">{t('totpRecoveryHint')}</p>
          <div className="grid grid-cols-2 gap-1 text-xs tnum" dir="ltr">
            {recoveryCodes.map((c) => (
              <code key={c} className="select-all rounded bg-surface-sunken px-2 py-1">{c}</code>
            ))}
          </div>
        </div>
      )}
      {totp?.enabled && (
        <div className="rounded-xl border border-line p-4">
          <p className="text-xs" style={{ color: 'var(--status-ok)' }}>
            ✓ {t('totpEnabled')} · {totp.recoveryLeft} {t('recoveryLeft')}
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('currentPassword')}>
              <input className="input" type="password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} autoComplete="current-password" />
            </Field>
            <Field label={t('totpCode')}>
              <CodeInput
                resetKey={codeReset}
                autoFocus={false}
                disabled={!disablePw}
                onComplete={async (code) => {
                  try {
                    await api('/api/auth/totp/disable', { body: { password: disablePw, code } });
                    setDisablePw('');
                    setRecoveryCodes(null);
                    loadTotp();
                    toast(t('totpDisabled'));
                  } catch (e) {
                    toast(e instanceof ApiError ? (e.code === 'totp_invalid' ? t('totpWrong') : PW_ERRORS[e.code] || e.code) : t('error'), 'bad');
                    setCodeReset((n) => n + 1);
                  }
                }}
              />
            </Field>
          </div>
          <p className="mt-1 text-[11px] text-ink-muted">{t('totpDisable')}: {t('currentPassword')} + {t('totpCode')}</p>
        </div>
      )}

      {/* دستگاه‌های واردشده — «فهرستِ دستگاه‌ها، خروج از همه» */}
      {sessions.length > 0 && (
        <>
          <div className="mt-5 flex items-center justify-between">
            <p className="label">{t('devices')}</p>
            <button
              className="btn btn-sm"
              onClick={async () => {
                try {
                  await api('/api/auth/logout-all', { method: 'POST' });
                  loadSessions();
                  toast(t('saved'));
                } catch (e) {
                  toast(e instanceof ApiError ? e.code : t('error'), 'bad');
                }
              }}
            >
              {t('logoutAll')}
            </button>
          </div>
          <ul className="divide-y divide-line text-xs">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-ink-soft">
                  {s.current && <span className="me-1 rounded bg-surface-sunken px-1.5 py-0.5 text-[10px]">{t('thisDevice')}</span>}
                  {s.user_agent || '—'}
                  {s.ip && <span className="ms-2 text-ink-muted" dir="ltr">{s.ip}</span>}
                </span>
                <span className="tnum shrink-0 text-ink-muted" title={t('lastSeen')}>{dateTime(s.last_seen_at || s.created_at, lang)}</span>
                {!s.current && (
                  <button
                    className="btn btn-sm"
                    onClick={async () => {
                      try {
                        await api(`/api/auth/sessions/${s.id}`, { method: 'DELETE' });
                        loadSessions();
                      } catch (e) {
                        toast(e instanceof ApiError ? e.code : t('error'), 'bad');
                      }
                    }}
                  >
                    {t('revoke')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
