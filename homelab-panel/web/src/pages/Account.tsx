// ---------------------------------------------------------------------------
//  «حسابِ من» — هر کسی که وارد شده، برای حسابِ خودش (فاز ۱ ِ ممیزی، ۶-۲)
//
//  ⛔ چرا صفحهٔ جدا و نه روشن کردنِ کلِ `Settings`: `Settings` پوشهٔ ریشهٔ
//  سایت‌ها، دامنهٔ پایه و فهرستِ پوشه‌های فایل‌منیجر را هم عوض می‌کند و عمداً
//  خاموش مانده. این صفحه فقط آن‌چه مالِ خودِ آدم است: رمز، دوعاملی،
//  دستگاه‌ها — همان APIهای آزمودهٔ `/api/auth/*`. پس «فقط جایی که امن است».
// ---------------------------------------------------------------------------
import { Link } from 'react-router-dom';
import { Crown, LifeBuoy, ShieldCheck, UserCog } from 'lucide-react';
import { useApp } from '../app-context';
import { Card } from '../components/ui';
import AccountSecurity from '../components/AccountSecurity';

const ROLE_FA: Record<string, string> = { admin: 'مدیر', operator: 'کارگزار', viewer: 'بیننده' };

export default function Account() {
  const { username, role, owner, can, logout } = useApp();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-base font-semibold">حسابِ من</h1>

      <Card title="شما" icon={<ShieldCheck className="h-4 w-4" />}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono" dir="ltr">{username}</span>
          <span className="chip" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>{ROLE_FA[role] || role}</span>
          {owner && (
            <span className="chip inline-flex items-center gap-1" style={{ background: 'color-mix(in srgb, var(--status-good) 15%, transparent)', color: 'var(--status-good)' }}>
              <Crown className="h-3 w-3" /> مالکِ اصلی
            </span>
          )}
        </div>
        {owner && (
          <p className="mt-2 text-xs text-ink-muted">
            مالکِ اصلی قدیمی‌ترین مدیرِ این پنل است. هیچ مدیرِ دیگری نقش، رمز یا دوعاملیِ شما را عوض نمی‌کند، شما را
            نمی‌بندد و حذف نمی‌کند — این را سرور اجبار می‌کند، نه این صفحه.
          </p>
        )}
        {can('admin') && (
          <Link to="/control/panel-users" className="btn btn-sm mt-3 inline-flex items-center gap-1.5">
            <UserCog className="h-4 w-4" /> کاربرانِ پنل و نقش‌ها
          </Link>
        )}
      </Card>

      <AccountSecurity onPasswordChanged={logout} />

      {owner && (
        <Card title="اگر رمز و دوعاملی هر دو گم شد" icon={<LifeBuoy className="h-4 w-4" />}>
          <p className="text-xs leading-6 text-ink-soft">
            روی <b>خودِ کامپیوترِ سرور</b> (نه از اینترنت و نه از این صفحه) بزنید:
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-sunken p-2 text-xs" dir="ltr">sudo vill3n owner-reset</pre>
          <p className="mt-2 text-xs leading-6 text-ink-muted">
            پیش از هر تغییر از دیتابیسِ پنل پشتیبان می‌گیرد، یک رمزِ یک‌بارمصرف همان‌جا نشان می‌دهد، دوعاملی را خاموش و
            همهٔ نشست‌ها را باطل می‌کند و در دفترِ رخدادها می‌نویسد. با آن رمز وارد شوید؛ پنل پیش از هر کاری رمزِ تازه
            می‌خواهد. روی ویندوز: در پوشهٔ <code dir="ltr">homelab-panel/server</code> بزنید
            <code dir="ltr"> node bin/vill3n.mjs owner-reset</code>.
          </p>
        </Card>
      )}
    </div>
  );
}
