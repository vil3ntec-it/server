import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../app-context';
import { clockTime } from '../format';

/* ---------------------------------------------------------------------------
   نمودار زندهٔ سری‌زمانی — SVG خالص، بدون کتابخانهٔ بیرونی.
   رنگ سری‌ها با اعتبارسنجی کوررنگی انتخاب شده و در هر دو پوسته آزموده شده است.
   خط ۲ پیکسل، شبکهٔ کم‌رنگ، خط‌کش + راهنمای شناور، و برچسبِ مستقیمِ آخرین مقدار.
--------------------------------------------------------------------------- */

export type Series<T> = {
  key: string;
  label: string;
  color: string;
  value: (point: T) => number | null;
};

type Props<T> = {
  points: T[];
  series: Series<T>[];
  x: (point: T) => number;
  height?: number;
  yMax?: number | null; // اگر ندهید، از خودِ داده حساب می‌شود
  format: (v: number | null) => string;
  compact?: boolean;
  ariaLabel?: string;
};

const PAD = { top: 10, right: 8, bottom: 18, left: 40 };

export function LiveChart<T>({
  points,
  series,
  x,
  height = 180,
  yMax = null,
  format,
  compact = false,
  ariaLabel,
}: Props<T>) {
  const { lang } = useApp();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(160, entry.contentRect.width)));
    ro.observe(el);
    setWidth(Math.max(160, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const domain0 = useMemo(() => {
    if (yMax != null) return yMax;
    let max = 0;
    for (const p of points) {
      for (const s of series) {
        const v = s.value(p);
        if (v != null && v > max) max = v;
      }
    }
    return max > 0 ? max * 1.15 : 1;
  }, [points, series, yMax]);

  // جای برچسب‌های محور از روی بلندترین برچسب حساب می‌شود تا روی نمودار نیفتند
  const axisWidth = useMemo(() => {
    if (compact) return 0;
    const labels = [0, 0.5, 1].map((f) => format(f * domain0).replace(/[⁦⁩]/g, ''));
    const longest = Math.max(...labels.map((l) => l.length));
    return Math.min(78, Math.max(30, longest * 6.4 + 10));
  }, [compact, domain0, format]);

  const pad = compact ? { top: 6, right: 4, bottom: 4, left: 4 } : { ...PAD, left: axisWidth };
  const innerW = Math.max(10, width - pad.left - pad.right);
  const innerH = Math.max(10, height - pad.top - pad.bottom);
  const domain = domain0;

  const px = useCallback(
    (i: number) => (points.length <= 1 ? innerW : (i / (points.length - 1)) * innerW),
    [points.length, innerW]
  );
  const py = useCallback((v: number) => innerH - (Math.max(0, Math.min(v, domain)) / domain) * innerH, [innerH, domain]);

  const paths = useMemo(
    () =>
      series.map((s) => {
        let line = '';
        let area = '';
        let started = false;
        points.forEach((p, i) => {
          const v = s.value(p);
          if (v == null) return;
          const X = px(i);
          const Y = py(v);
          if (!started) {
            line = `M ${X} ${Y}`;
            area = `M ${X} ${innerH} L ${X} ${Y}`;
            started = true;
          } else {
            line += ` L ${X} ${Y}`;
            area += ` L ${X} ${Y}`;
          }
        });
        if (started) area += ` L ${px(points.length - 1)} ${innerH} Z`;
        return { ...s, line, area, last: points.length ? s.value(points[points.length - 1]) : null };
      }),
    [series, points, px, py, innerH]
  );

  const gridValues = useMemo(() => {
    if (compact) return [];
    return [0, 0.25, 0.5, 0.75, 1].map((f) => f * domain);
  }, [domain, compact]);

  const onMove = (e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX : e.clientX;
    if (clientX == null) return;
    // در چیدمان راست‌به‌چپ هم مختصات صفحه از چپ اندازه‌گیری می‌شود
    const relative = clientX - rect.left - pad.left;
    const ratio = Math.max(0, Math.min(1, relative / innerW));
    setHoverIndex(Math.round(ratio * (points.length - 1)));
  };

  const active = hoverIndex != null && points[hoverIndex] ? hoverIndex : null;
  const showLegend = series.length >= 2 && !compact;

  const summary =
    ariaLabel ??
    series.map((s) => `${s.label}: ${format(points.length ? s.value(points[points.length - 1]) : null)}`).join('، ');

  if (!points.length) {
    return <div ref={wrapRef} style={{ height }} className="flex items-center justify-center text-xs text-ink-muted" />;
  }

  return (
    <div ref={wrapRef} className="w-full">
      {showLegend && (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {paths.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-[11px] text-ink-soft">
              <span className="h-0.5 w-3.5 rounded-full" style={{ background: s.color }} />
              {s.label}
              <span className="tnum font-medium text-ink">{format(s.last)}</span>
            </span>
          ))}
        </div>
      )}
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={summary}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIndex(null)}
        onTouchStart={onMove}
        onTouchMove={onMove}
        onTouchEnd={() => setHoverIndex(null)}
        /* محورها و برچسب‌های عددی همیشه چپ‌به‌راست خوانده می‌شوند */
        style={{ display: 'block', touchAction: 'pan-y', direction: 'ltr' }}
      >
        <defs>
          {paths.map((s) => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={compact ? 0.3 : 0.24} />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        <g transform={`translate(${pad.left},${pad.top})`}>
          {/* شبکهٔ کم‌رنگ — عمداً پس‌زمینه‌ای */}
          {gridValues.map((v, i) => (
            <g key={i}>
              <line
                x1={0}
                x2={innerW}
                y1={py(v)}
                y2={py(v)}
                stroke="var(--border)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={-6}
                y={py(v)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={10}
                fill="var(--text-muted)"
                className="tnum"
              >
                {format(v)}
              </text>
            </g>
          ))}

          {paths.map((s) => (
            <g key={s.key}>
              <path d={s.area} fill={`url(#grad-${s.key})`} />
              <path
                d={s.line}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ))}

          {/* برچسب مستقیم روی آخرین نقطه — هویت سری فقط با رنگ منتقل نمی‌شود */}
          {!compact &&
            paths.map((s) =>
              s.last == null ? null : (
                <circle
                  key={s.key}
                  cx={px(points.length - 1)}
                  cy={py(s.last)}
                  r={3.5}
                  fill={s.color}
                  stroke="var(--surface-1)"
                  strokeWidth={2}
                />
              )
            )}

          {/* خط‌کش شناور */}
          {active != null && (
            <g>
              <line
                x1={px(active)}
                x2={px(active)}
                y1={0}
                y2={innerH}
                stroke="var(--text-muted)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              {paths.map((s) => {
                const v = s.value(points[active]);
                return v == null ? null : (
                  <circle
                    key={s.key}
                    cx={px(active)}
                    cy={py(v)}
                    r={4}
                    fill={s.color}
                    stroke="var(--surface-1)"
                    strokeWidth={2}
                  />
                );
              })}
            </g>
          )}
        </g>

        {!compact && (
          <text x={pad.left} y={height - 4} fontSize={10} fill="var(--text-muted)" className="tnum">
            {clockTime(x(points[0]) as number, lang)}
          </text>
        )}
        {!compact && (
          <text
            x={width - pad.right}
            y={height - 4}
            fontSize={10}
            textAnchor="end"
            fill="var(--text-muted)"
            className="tnum"
          >
            {clockTime(x(points[points.length - 1]) as number, lang)}
          </text>
        )}
      </svg>

      {active != null && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-soft">
          <span className="tnum text-ink-muted">{clockTime(x(points[active]) as number, lang)}</span>
          {paths.map((s) => (
            <span key={s.key} className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
              {s.label}
              <span className="tnum font-medium text-ink">{format(s.value(points[active]))}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
   حلقهٔ درصد — برای نمایش یک عدد اصلی (CPU/RAM/دیسک)
------------------------------------------------------------------------- */
export function Ring({
  value,
  color,
  size = 76,
  label,
}: {
  value: number;
  color: string;
  size?: number;
  label: string;
}) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <svg width={size} height={size} role="img" aria-label={`${label}: ${pct.toFixed(1)}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray .4s ease' }}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size / 4.2}
        fontWeight={600}
        fill="var(--text-primary)"
        className="tnum"
      >
        {Math.round(pct)}%
      </text>
    </svg>
  );
}

/* -------------------------------------------------------------------------
   نوار مصرف ساده (برای هر دیسک)
------------------------------------------------------------------------- */
export function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--border)' }}>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }}
      />
    </div>
  );
}
