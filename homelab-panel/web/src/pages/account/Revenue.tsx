// ---------------------------------------------------------------------------
//  نمودارِ درآمدِ دوازده ماه — بندِ ۱۱.۴
//
//  ⛔ **دو ارز روی یک محور نمی‌نشینند.** افغانی و دالر دو مقیاسِ جدا
//     دارند؛ یک محورِ مشترک عددها را دروغ نشان می‌دهد و محورِ دوم هم
//     بدترین کارِ ممکن است. پس برای هر ارز یک نمودارِ جدا، با محورِ خودش.
//  ⛔ رنگ دنبالِ **موجودیت** است نه رتبه: دکان همیشه `--series-1` و پمپ
//     همیشه `--series-2`. فیلتری که یکی را بردارد، رنگِ آن یکی را عوض
//     نمی‌کند.
//  ⚠️ رنگ تنها نشانه نیست: راهنما همیشه هست و هر ستون `title` دارد.
// ---------------------------------------------------------------------------
import { fa, money } from './shared';

type Bucket = { month: string; shop: Record<string, number>; pump: Record<string, number> };

const SERIES = [
  { id: 'shop' as const, label: 'دکان', color: 'var(--series-1)' },
  { id: 'pump' as const, label: 'پمپ‌بنزین', color: 'var(--series-2)' },
];

/** «۱۴۰۴-۰۷» از «2026-03» — ماهِ میلادیِ سرور، با رقمِ فارسی. */
function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return `${Number(m).toLocaleString('fa-AF')}/${String(y).slice(2)}`;
}

export default function Revenue({ series, currency }: { series: Bucket[]; currency: string }) {
  const values = series.map((b) => ({
    month: b.month,
    shop: Number(b.shop?.[currency] || 0),
    pump: Number(b.pump?.[currency] || 0),
  }));
  const max = Math.max(1, ...values.map((v) => Math.max(v.shop, v.pump)));
  const H = 132;

  return (
    <figure className="m-0">
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-soft">درآمدِ دوازده ماه — {currency === 'USD' ? 'دالر' : 'افغانی'}</span>
        <span className="flex items-center gap-3">
          {SERIES.map((s) => (
            <span key={s.id} className="flex items-center gap-1.5 text-[11px] text-ink-muted">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </span>
      </figcaption>

      <div className="flex items-end gap-1.5" style={{ height: H + 22 }} dir="ltr">
        {values.map((v) => (
          <div key={v.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="flex h-full w-full items-end justify-center gap-[2px]" style={{ height: H }}>
              {SERIES.map((s) => {
                const value = v[s.id];
                const h = Math.max(value > 0 ? 3 : 1, Math.round((value / max) * H));
                return (
                  <div
                    key={s.id}
                    className="w-1/2 rounded-t"
                    style={{ height: h, background: value > 0 ? s.color : 'color-mix(in srgb, var(--text-muted) 18%, transparent)' }}
                    title={`${s.label} · ${monthLabel(v.month)} · ${money(value, currency)}`}
                  />
                );
              })}
            </div>
            <span className="tnum text-[9px] text-ink-muted">{monthLabel(v.month)}</span>
          </div>
        ))}
      </div>

      <p className="mt-1 text-[11px] text-ink-muted">
        بیشترین ماه: {money(max, currency)} · مجموعِ دوازده ماه: {fa(values.reduce((n, v) => n + v.shop + v.pump, 0))}
      </p>
    </figure>
  );
}
