// ---------------------------------------------------------------------------
//  «برو به بخشِ خودش» — یک کارت، یک دکمه
//
//  خواستهٔ صاحب سامانه (۱۴۰۵/۰۷/۱۳): «همهٔ اشتراک‌ها داخلِ یک بخش داده بشه
//  و توی بخش‌های دیگه وقتی بزنی، مستقیم بیاد توی همین بخش.» همان برای
//  کدهای شش‌رقمی.
//
//  ⛔ پس «پمپ‌بنزین‌ها ← اشتراک‌ها» و «فروشگاه‌ها ← اشتراک‌ها» دیگر رونوشتِ
//     فهرست را داخلِ خودشان نمی‌نشانند (۱.۵۰.۱۱ تا ۱.۵۰.۱۵ همین بود): یک
//     کارت‌اند که با بخشِ درست به صفحهٔ مرکزی می‌روند. دو جای دیدنِ یک چیز
//     همان سردرگمیِ گامِ ۴ی ریمیک است.
// ---------------------------------------------------------------------------
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpLeft } from 'lucide-react';
import { Card } from '../../components/ui';

export default function GoTo({
  icon, title, hint, to, cta, children,
}: {
  icon?: ReactNode;
  title: string;
  hint: string;
  to: string;
  cta: string;
  children?: ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {icon && (
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <p className="font-medium text-ink">{title}</p>
            <p className="text-xs text-ink-muted">{hint}</p>
          </div>
        </div>
        <Link to={to} className="btn btn-primary btn-sm">
          {cta} <ArrowUpLeft className="h-4 w-4" />
        </Link>
      </div>
      {children}
    </Card>
  );
}
