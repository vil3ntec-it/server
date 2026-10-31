// ---------------------------------------------------------------------------
//  پنجرهٔ «رمز را دوباره بزنید» — احرازِ دوباره برای کارِ حساس (۶-۵)
//
//  ⛔ سرور تصمیم می‌گیرد، نه این پنجره: هر درِ حساس از نشستی که ده دقیقه رمز
//  نزده ۴۰۳ ِ `reauth_required` می‌دهد و `api()` همین پنجره را باز می‌کند؛
//  پس از رمزِ درست همان درخواست یک بار دیگر می‌رود. چند درخواستِ هم‌زمان یک
//  پنجره می‌بینند، نه چندتا. «انصراف» یعنی همان کار انجام نشد — و همین گفته
//  می‌شود، نه «انجام شد».
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api, ApiError, setReauthHandler } from '../api';
import { Field, Modal } from './ui';
import CodeInput from './CodeInput';

export default function ReauthHost() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState('');
  const [codeReset, setCodeReset] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const waiters = useRef<((ok: boolean) => void)[]>([]);

  const settle = useCallback((ok: boolean) => {
    const list = waiters.current;
    waiters.current = [];
    setOpen(false);
    setPassword('');
    setCode('');
    setError('');
    for (const w of list) w(ok);
  }, []);

  useEffect(() => {
    setReauthHandler(
      () =>
        new Promise<boolean>((resolve) => {
          waiters.current.push(resolve);
          if (waiters.current.length > 1) return;
          setOpen(true);
          //  دوعاملی روشن است؟ — همان را از سرور، نه حدس
          api<{ enabled: boolean }>('/api/auth/totp')
            .then((r) => setNeedCode(Boolean(r.enabled)))
            .catch(() => setNeedCode(false));
        }),
    );
    return () => setReauthHandler(null);
  }, []);

  const submit = async (withCode = code) => {
    if (busy || !password) return;
    if (needCode && withCode.length !== 6) {
      setError('کدِ شش‌رقمیِ اپِ دوعاملی را هم بزنید.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/reauth', { body: { password, code: needCode ? withCode : undefined } });
      settle(true);
    } catch (e) {
      const c = e instanceof ApiError ? e.code : '';
      setError(
        c === 'wrong_password' ? 'رمز درست نیست.'
          : c === 'totp_invalid' ? 'کدِ دوعاملی درست نیست.'
            : c === 'rate_limited' ? 'تلاش زیاد شد؛ کمی بعد دوباره.'
              : (e as Error).message,
      );
      setCode('');
      setCodeReset((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => settle(false)}
      title={
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> برای این کار رمزتان را دوباره بزنید
        </span>
      }
      footer={
        <>
          <button className="btn" onClick={() => settle(false)} disabled={busy}>انصراف</button>
          <button className="btn btn-primary" onClick={() => submit()} disabled={busy || !password}>
            {busy ? 'در حالِ سنجش…' : 'تأیید'}
          </button>
        </>
      }
    >
      <p className="mb-3 text-xs text-ink-muted">
        کارهای حساس (دیدنِ رمز و کد، کاربرانِ پنل، روشن کردنِ دوعاملی، حذفِ حساب) فقط تا ده دقیقه پس از زدنِ رمز
        انجام می‌شوند. این را سرور می‌سنجد.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="رمزِ فعلیِ شما">
          <input
            className="input"
            type="password"
            dir="ltr"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {needCode && (
          <Field label="کدِ اپِ دوعاملی">
            <CodeInput
              resetKey={codeReset}
              autoFocus={false}
              disabled={!password || busy}
              onComplete={(c) => {
                setCode(c);
                submit(c);
              }}
            />
          </Field>
        )}
        {error && (
          <p role="alert" className="mt-2 text-xs" style={{ color: 'var(--status-critical)' }}>
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
