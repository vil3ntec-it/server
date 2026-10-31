// ---------------------------------------------------------------------------
//  ورود با رمزِ یک‌بارمصرفِ بازیابی ⇒ اول رمزِ تازه (فاز ۱ ِ ممیزی، ۶-۳)
//
//  ⛔ این صفحه فقط راهنماست؛ اجبار در سرور است: تا رمزِ تازه گذاشته نشده هر
//  درِ دیگری ۴۰۳ ِ `password_change_required` می‌دهد (`requireAuth`). پس از
//  گذاشتنِ رمز، سرور همهٔ نشست‌ها را می‌بندد و آدم با رمزِ تازه وارد می‌شود.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { useApp } from '../app-context';
import { api, ApiError } from '../api';
import { Card, Field, toast } from '../components/ui';

const ERR: Record<string, string> = {
  wrong_password: 'رمزِ یک‌بارمصرف درست نیست.',
  same_password: 'رمزِ تازه باید با رمزِ یک‌بارمصرف فرق کند.',
  password_too_short: 'رمزِ تازه دست‌کم ۸ نویسه.',
  password_too_long: 'رمزِ تازه حداکثر ۲۰۰ نویسه.',
  rate_limited: 'تلاش زیاد شد؛ کمی بعد دوباره.',
};

export default function ForceChangePassword() {
  const { username, logout } = useApp();
  const [oldPassword, setOld] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (busy) return;
    if (next.length < 8) return setError(ERR.password_too_short);
    if (next !== again) return setError('دو رمزِ تازه یکی نیستند.');
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/change-password', { body: { oldPassword, newPassword: next } });
      toast('رمزِ تازه نشست. حالا با همان وارد شوید.');
      await logout();
    } catch (e) {
      const c = e instanceof ApiError ? e.code : '';
      setError(ERR[c] || (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <Card title="رمزِ تازه بگذارید" icon={<KeyRound className="h-4 w-4" />}>
        <p className="mb-3 text-xs leading-6 text-ink-soft">
          حسابِ <b dir="ltr">{username}</b> با رمزِ یک‌بارمصرفِ بازیابی (<code dir="ltr">vill3n owner-reset</code>) وارد شده
          است. تا رمزِ تازه نگذارید، پنل هیچ کارِ دیگری انجام نمی‌دهد. پس از آن دوعاملی را از «حسابِ من» دوباره روشن کنید.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="رمزِ یک‌بارمصرف">
            <input className="input" type="password" dir="ltr" autoComplete="current-password" value={oldPassword} onChange={(e) => setOld(e.target.value)} />
          </Field>
          <Field label="رمزِ تازه">
            <input className="input" type="password" dir="ltr" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="تکرارِ رمزِ تازه">
            <input className="input" type="password" dir="ltr" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </Field>
          {error && <p role="alert" className="mb-2 text-xs" style={{ color: 'var(--status-critical)' }}>{error}</p>}
          <div className="flex items-center justify-between gap-2">
            <button type="submit" className="btn btn-primary" disabled={busy || !oldPassword || !next || !again}>
              {busy ? 'در حالِ ثبت…' : 'ثبتِ رمزِ تازه'}
            </button>
            <button type="button" className="btn btn-sm inline-flex items-center gap-1" onClick={() => logout()}>
              <LogOut className="h-4 w-4" /> خروج
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
