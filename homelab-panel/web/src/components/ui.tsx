import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import { useApp } from '../app-context';

export function Card({
  children,
  className = '',
  title,
  action,
  icon,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <section className={`card rise p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            {icon}
            {title}
          </h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`h-4 w-4 animate-spin ${className}`} />;
}

export function Loading({ label }: { label?: string }) {
  const { t } = useApp();
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-soft">
      <Spinner />
      {label ?? t('loading')}
    </div>
  );
}

export function Empty({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      {icon && <div className="text-ink-muted">{icon}</div>}
      <p className="text-sm font-medium text-ink-soft">{title}</p>
      {hint && <p className="max-w-sm text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

export function StatusDot({ online, label }: { online: boolean; label: string }) {
  return (
    <span
      className="chip"
      style={{
        background: online
          ? 'color-mix(in srgb, var(--status-good) 16%, transparent)'
          : 'color-mix(in srgb, var(--text-muted) 18%, transparent)',
        color: online ? 'var(--status-good)' : 'var(--text-secondary)',
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: online ? 'var(--status-good)' : 'var(--text-muted)' }}
      />
      {label}
    </span>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info';
  children: ReactNode;
}) {
  const color =
    tone === 'good'
      ? 'var(--status-good)'
      : tone === 'warn'
        ? 'var(--status-warning)'
        : tone === 'bad'
          ? 'var(--status-critical)'
          : tone === 'info'
            ? 'var(--series-1)'
            : 'var(--text-secondary)';
  return (
    <span
      className="chip"
      style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
    >
      {children}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`card rise flex max-h-[92vh] w-full flex-col overflow-hidden rounded-b-none sm:rounded-2xl ${
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'
        }`}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button className="rounded-lg p-1.5 text-ink-soft hover:bg-surface-raised" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  danger,
}: {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  const { t } = useApp();
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm}>
            {t('confirm')}
          </button>
        </>
      }
    >
      <p className="flex items-start gap-2 text-sm text-ink-soft">
        {danger && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--status-critical)' }} />}
        {message}
      </p>
    </Modal>
  );
}

/* ---------------------------- پیام‌های کوتاه ---------------------------- */
type Toast = { id: number; text: string; tone: 'good' | 'bad' };
let pushToast: ((text: string, tone?: 'good' | 'bad') => void) | null = null;

export function toast(text: string, tone: 'good' | 'bad' = 'good') {
  pushToast?.(text, tone);
}

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);
  const nextId = useRef(1);

  useEffect(() => {
    pushToast = (text, tone = 'good') => {
      const id = nextId.current++;
      setItems((prev) => [...prev, { id, text, tone }]);
      setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 3200);
    };
    return () => {
      pushToast = null;
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
      {items.map((item) => (
        <div
          key={item.id}
          className="rise pointer-events-auto flex items-center gap-2 rounded-xl border border-line px-3.5 py-2.5 text-sm"
          style={{ background: 'var(--surface-2)', boxShadow: 'var(--shadow)' }}
        >
          {item.tone === 'good' ? (
            <Check className="h-4 w-4 shrink-0" style={{ color: 'var(--status-good)' }} />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: 'var(--status-critical)' }} />
          )}
          <span className="text-ink">{item.text}</span>
        </div>
      ))}
    </div>
  );
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useApp();
  return (
    <button
      className="btn btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast(t('copied'));
        } catch {
          const el = document.createElement('textarea');
          el.value = value;
          document.body.appendChild(el);
          el.select();
          document.execCommand('copy');
          el.remove();
          toast(t('copied'));
        }
      }}
    >
      {label ?? t('copyText')}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-3">
      <span className="label">{label}</span>
      {children}
      {hint && <p className="mt-1 text-[11px] text-ink-muted">{hint}</p>}
    </div>
  );
}
