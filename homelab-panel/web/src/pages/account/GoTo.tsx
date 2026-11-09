// ---------------------------------------------------------------------------
//  «برو به بخشِ خودش» — یک کارت، یک دکمه
//
//  برای وقتی که کاری جای خودش را دارد و این‌جا فقط راهش نشان داده می‌شود
//  (مثلِ «پمپ‌بنزین‌ها ← کد و ربات» ⇒ «کدهای شش‌رقمی»، یا صفحهٔ «کدام
//  برنامه؟»ِ نشانی‌های کهنهٔ اشتراک‌ها). دو جای دیدنِ یک چیز ساخته نمی‌شود.
//
//  ⛔ اشتراک‌ها از ۱۴۰۵/۰۸/۰۹ دیگر با این کارت به بخشِ مرکزی نمی‌روند —
//     بخشِ مرکزی نیست؛ خودشان داخلِ بخشِ هر برنامه‌اند (`AppSubscriptions.tsx`).
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
