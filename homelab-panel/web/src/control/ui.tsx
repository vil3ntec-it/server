// اجزای مشترکِ مرکز فرمان — همه با متغیرهای رنگ کار می‌کنند تا در تم روشن و
// تیره یکسان درست باشند.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Clock, HelpCircle, Lock, ShieldAlert, XCircle } from 'lucide-react';
import { useApp } from '../app-context';
import type { Dict } from '../i18n';
import type { ProbeStatus } from './types';

/* --------------------------- وضعیت اتصال --------------------------- */

const STATUS_KEY: Record<string, keyof Dict> = {
  online: 'stOnline',
  offline: 'stOffline',
  timeout: 'stTimeout',
  unauthorized: 'stUnauthorized',
  ssl_error: 'stSslError',
  dns_error: 'stDnsError',
  connection_error: 'stConnError',
  unknown: 'stUnknown',
};

export function statusColor(status?: string | null) {
  if (status === 'online' || status === 'healthy' || status === 'active' || status === 'ok') return 'var(--status-good)';
  if (status === 'unknown' || status == null || status === '') return 'var(--text-muted)';
  if (status === 'timeout' || status === 'unauthorized' || status === 'degraded') return 'var(--status-warning)';
  return 'var(--status-critical)';
}

function StatusIcon({ status, className = 'h-3.5 w-3.5' }: { status?: string | null; className?: string }) {
  if (status === 'online') return <CheckCircle2 className={className} />;
  if (status === 'timeout') return <Clock className={className} />;
  if (status === 'unauthorized') return <Lock className={className} />;
  if (status === 'ssl_error' || status === 'dns_error') return <ShieldAlert className={className} />;
  if (!status || status === 'unknown') return <HelpCircle className={className} />;
  return <XCircle className={className} />;
}

/** برچسب وضعیت — همیشه همان چیزی که واقعاً سنجیده شده */
export function StatusPill({
  status,
  code,
  latency,
  compact,
}: {
  status?: ProbeStatus | string | null;
  code?: number | null;
  latency?: number | null;
  compact?: boolean;
}) {
  const { t } = useApp();
  const color = statusColor(status);
  const key = STATUS_KEY[String(status || 'unknown')];
  const label = key ? t(key) : String(status);
  return (
    <span
      className="chip whitespace-nowrap"
      style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
      title={[label, code ? `HTTP ${code}` : null, latency != null ? `${latency}ms` : null].filter(Boolean).join(' · ')}
    >
      <StatusIcon status={status} />
      {!compact && label}
      {!compact && code ? <span className="tnum opacity-70">{code}</span> : null}
      {!compact && latency != null ? <span className="tnum opacity-70">{latency}ms</span> : null}
    </span>
  );
}

/* ------------------------------ کارت آمار ------------------------------ */

export function Stat({
  label,
  value,
  sub,
  tone,
  icon,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'good' | 'warn' | 'bad' | 'info';
  icon?: ReactNode;
  onClick?: () => void;
}) {
  const color =
    tone === 'good' ? 'var(--status-good)'
    : tone === 'warn' ? 'var(--status-warning)'
    : tone === 'bad' ? 'var(--status-critical)'
    : tone === 'info' ? 'var(--accent)'
    : 'var(--text-primary)';
  return (
    <div
      className={`card rise p-4 ${onClick ? 'cursor-pointer transition hover:brightness-105' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium text-ink-muted">{label}</p>
        {icon && <span style={{ color }}>{icon}</span>}
      </div>
      <p className="tnum mt-1.5 text-2xl font-semibold" style={{ color }}>
        {value}
      </p>
      {sub != null && <p className="mt-0.5 text-[11px] text-ink-muted">{sub}</p>}
    </div>
  );
}

/* ------------------------------ جدول ساده ------------------------------ */

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  const { t } = useApp();
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-start">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 text-start text-[11px] font-medium text-ink-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {empty ? (
            <tr>
              <td colSpan={head.length} className="px-3 py-10 text-center text-sm text-ink-muted">
                {t('ccNoItems')}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Row({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <tr
      className={`border-b border-line/60 last:border-0 ${onClick ? 'cursor-pointer hover:bg-surface-raised' : ''}`}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

export function Cell({
  children,
  className = '',
  mono,
  style,
}: {
  children: ReactNode;
  className?: string;
  mono?: boolean;
  style?: CSSProperties;
}) {
  return (
    <td className={`px-3 py-2.5 align-middle ${mono ? 'font-mono text-xs' : ''} ${className}`} style={style}>
      {children}
    </td>
  );
}

/* ------------------------------- زبانه‌ها ------------------------------ */

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: ReactNode; badge?: number }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="-mx-1 mb-4 flex gap-1 overflow-x-auto pb-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm transition-colors ${
            active === tab.id ? 'font-semibold' : 'text-ink-soft hover:bg-surface-raised'
          }`}
          style={active === tab.id ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : undefined}
        >
          {tab.label}
          {tab.badge != null && tab.badge > 0 && (
            <span
              className="tnum rounded-full px-1.5 text-[10px]"
              style={{
                background: active === tab.id ? 'rgb(255 255 255 / 22%)' : 'color-mix(in srgb, var(--text-muted) 20%, transparent)',
              }}
            >
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* --------------------------- کلید/مقدار ------------------------------- */

export function KV({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-2 last:border-0">
      <span className="shrink-0 text-[11px] text-ink-muted">{label}</span>
      <span className={`min-w-0 truncate text-end text-sm ${mono ? 'font-mono text-xs' : ''}`}>{children ?? '—'}</span>
    </div>
  );
}

/* ------------------------------ آدرس قابل کپی -------------------------- */

export function Url({ value, ok }: { value?: string | null; ok?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);
  if (!value) return <span className="text-ink-muted">—</span>;
  return (
    <button
      dir="ltr"
      className="max-w-full truncate rounded-lg px-1.5 py-0.5 text-start font-mono text-xs hover:bg-surface-raised"
      style={ok === false ? { color: 'var(--status-critical)' } : undefined}
      title={value}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(value).then(
          () => setCopied(true),
          () => {}
        );
      }}
    >
      {copied ? '✓' : value}
    </button>
  );
}

/* ------------------------------ هشدار درون‌صفحه ------------------------ */

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'bad' | 'good'; children: ReactNode }) {
  const color =
    tone === 'warn' ? 'var(--status-warning)'
    : tone === 'bad' ? 'var(--status-critical)'
    : tone === 'good' ? 'var(--status-good)'
    : 'var(--accent)';
  return (
    <div
      className="mb-4 flex items-start gap-2 rounded-xl border p-3 text-xs leading-relaxed"
      style={{ borderColor: `color-mix(in srgb, ${color} 35%, transparent)`, background: `color-mix(in srgb, ${color} 8%, transparent)`, color: 'var(--text-secondary)' }}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color }} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ------------------------------ دکمهٔ کار ------------------------------ */

/** دکمه‌ای که تا پایان کار خودش را قفل می‌کند و خطا را نشان می‌دهد */
export function ActionButton({
  onClick,
  children,
  className = 'btn btn-sm',
  busyLabel,
  disabled,
  title,
}: {
  onClick: () => Promise<unknown> | unknown;
  children: ReactNode;
  className?: string;
  busyLabel?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={className}
      disabled={busy || disabled}
      title={title}
      onClick={async (e) => {
        e.stopPropagation();
        if (busy) return;
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

/* -------------------------- انتخابگرها --------------------------- */

export function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string | number | null | undefined;
  onChange: (v: string) => void;
  options: { value: string | number; label: string }[];
  placeholder?: string;
}) {
  return (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {placeholder != null && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------ برچسب‌ها ------------------------------- */

export const PROJECT_TYPE_KEY: Record<string, keyof Dict> = {
  android: 'typeAndroid',
  desktop: 'typeDesktop',
  website: 'typeWebsite',
  webapp: 'typeWebapp',
  backend: 'typeBackend',
  api: 'typeApi',
  websocket: 'typeWebsocket',
  database: 'typeDatabase',
  service: 'typeService',
};

export const SERVER_KIND_KEY: Record<string, keyof Dict> = {
  home: 'kindHome',
  vps: 'kindVps',
  dedicated: 'kindDedicated',
  cloud: 'kindCloud',
  hosting: 'kindHosting',
};

export function useLabels() {
  const { t } = useApp();
  return {
    projectType: (type: string) => (PROJECT_TYPE_KEY[type] ? t(PROJECT_TYPE_KEY[type]) : type),
    serverKind: (kind: string) => (SERVER_KIND_KEY[kind] ? t(SERVER_KIND_KEY[kind]) : kind),
  };
}
