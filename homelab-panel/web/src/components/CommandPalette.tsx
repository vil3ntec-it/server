// ---------------------------------------------------------------------------
//  🔎 جست‌وجوی سراسری — Ctrl+K (بندِ ۱۶ پرامپت)
//
//  پنل بیش از سی صفحه دارد و منو بیشترشان را پشتِ گروه‌های بسته نگه
//  می‌دارد (عمداً، تا در قاب جا شوند). پس باید راهی باشد که بی گشتن،
//  با نامِ همان بخش، مستقیم به آن رفت.
//
//  ⚠️ فهرست از **همان** `NAV_GROUPS`ِ منو می‌آید، نه از یک فهرستِ دوم:
//     بخشی که در منو به نقش یا کلیدِ ویژگی بسته است، این‌جا هم دیده
//     نمی‌شود — وگرنه جست‌وجو دری می‌شد که منو بسته بود.
//  ⚠️ هیچ درخواستی به سرور نمی‌زند؛ فقط جای رفتن را می‌گوید.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useApp } from '../app-context';
import type { Dict } from '../i18n';

export type PaletteItem = { to: string; label: string; group: string };

export default function CommandPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: PaletteItem[];
}) {
  const { t } = useApp();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setCursor(0);
    const id = window.setTimeout(() => box.current?.focus(), 10);
    return () => window.clearTimeout(id);
  }, [open]);

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => `${i.label} ${i.group} ${i.to}`.toLowerCase().includes(needle));
  }, [items, q]);

  useEffect(() => { setCursor(0); }, [q]);

  if (!open) return null;

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card rise flex w-full max-w-lg flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-ink-muted" />
          <input
            ref={box}
            className="w-full bg-transparent text-sm outline-none"
            placeholder={t('searchGoto')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); onClose(); }
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
              if (e.key === 'Enter' && hits[cursor]) { e.preventDefault(); go(hits[cursor].to); }
            }}
          />
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1">
          {hits.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-muted">{t('searchNothing')}</li>}
          {hits.map((i, idx) => (
            <li key={i.to}>
              <button
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-start text-sm ${
                  idx === cursor ? 'font-semibold' : 'text-ink-soft hover:bg-surface-raised'
                }`}
                style={idx === cursor ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : undefined}
                onMouseEnter={() => setCursor(idx)}
                onClick={() => go(i.to)}
              >
                <span className="truncate">{i.label}</span>
                <span className="shrink-0 text-[11px] text-ink-muted">{i.group}</span>
              </button>
            </li>
          ))}
        </ul>
        <footer className="border-t border-line px-4 py-2 text-[11px] text-ink-muted">{t('searchHint')}</footer>
      </div>
    </div>
  );
}

/** کلیدِ باز کردن — Ctrl+K و ⌘K. جایی که کاربر تایپ می‌کند دست نمی‌خورد. */
export function usePaletteKey(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen]);
}

/** نامِ خواندنیِ یک کلیدِ ترجمه — تا فهرستِ جست‌وجو از خودِ منو ساخته شود. */
export type LabelOf = (key: keyof Dict) => string;
