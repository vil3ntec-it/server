// ---------------------------------------------------------------------------
//  ترمینالِ داخلِ پنل
//
//  محدودیتش همان بالای صفحه نوشته شده، نه در یک راهنمای جدا: این یک
//  اجراکنندهٔ فرمان است، نه شبیه‌سازِ پایانه. `vim` و `top` کار نمی‌کنند.
//  کاربری که این را از اول بداند، وقتی `top` جواب نداد فکر نمی‌کند سرور
//  خراب است.
//
//  تاریخچه با فلشِ بالا/پایین کار می‌کند و در همان مرورگر می‌ماند — چون
//  فرمان‌ها می‌توانند رمز داشته باشند و جای‌شان روی سرور نیست.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Square, TerminalSquare, Trash2 } from 'lucide-react';

import { useApp } from '../app-context';
import { Card, Empty } from '../components/ui';
import { Notice } from '../control/ui';

type Line = { kind: 'in' | 'out' | 'err' | 'sys'; text: string };

const HISTORY_KEY = 'hlp.term.history';
const MAX_LINES = 2000;

export default function TerminalPage() {
  const { t, role, socket } = useApp();
  const isAdmin = role === 'admin';

  const [ready, setReady] = useState(false);
  const [cwd, setCwd] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const [historyAt, setHistoryAt] = useState(-1);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const push = useCallback((kind: Line['kind'], text: string) => {
    setLines((prev) => {
      const next = [...prev, { kind, text }];
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
    });
  }, []);

  /* --------------------------- باز کردنِ نشست --------------------------- */

  useEffect(() => {
    if (!socket || !isAdmin) return;

    socket.emit('term:open', {}, (res: { ok: boolean; cwd?: string; shell?: string; error?: string }) => {
      if (res?.ok) {
        setReady(true);
        setCwd(res.cwd || '');
        push('sys', `${res.shell || ''} — ${res.cwd || ''}`);
      } else {
        setError(res?.error === 'forbidden' ? t('trmForbidden') : t('trmOpenFailed'));
      }
    });

    const onData = (payload: { chunk: string }) => {
      const text = payload?.chunk ?? '';
      if (!text) return;
      // خروجی تکه‌تکه می‌آید و لزوماً روی مرزِ خط نیست، پس تکهٔ تازه به
      // آخرین خط می‌چسبد مگر اینکه خودش خطِ جدید داشته باشد
      setLines((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.kind === 'out') {
          next[next.length - 1] = { kind: 'out', text: last.text + text };
        } else {
          next.push({ kind: 'out', text });
        }
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
      });
    };

    socket.on('term:data', onData);
    return () => {
      socket.off('term:data', onData);
      socket.emit('term:close', {}, () => {});
    };
  }, [socket, isAdmin, push, t]);

  // همیشه پایینِ خروجی
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  /* ------------------------------ اجرا -------------------------------- */

  function submit() {
    const command = input.trim();
    if (!command || busy || !socket || !ready) return;

    push('in', `${cwd} $ ${command}`);
    setInput('');
    setHistoryAt(-1);
    setBusy(true);

    const nextHistory = [command, ...history.filter((h) => h !== command)].slice(0, 100);
    setHistory(nextHistory);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
    } catch { /* حالتِ خصوصیِ مرورگر */ }

    socket.emit(
      'term:run',
      { command },
      (res: { ok: boolean; cwd?: string; exitCode?: number; error?: string; truncated?: boolean }) => {
        setBusy(false);
        if (!res?.ok) {
          push('err', res?.error === 'forbidden' ? t('trmForbidden') : `[${res?.error ?? 'error'}]`);
          return;
        }
        if (res.cwd) setCwd(res.cwd);
        if (res.exitCode) push('err', t('trmExitCode', { code: res.exitCode }));
        inputRef.current?.focus();
      }
    );
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
      return;
    }
    // Ctrl+C روی یک فرمانِ در حالِ اجرا، نه روی متنِ انتخاب‌شده
    if (e.key === 'c' && e.ctrlKey && busy) {
      e.preventDefault();
      socket?.emit('term:interrupt', {}, () => {});
      push('sys', '^C');
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const at = Math.min(historyAt + 1, history.length - 1);
      if (at >= 0) {
        setHistoryAt(at);
        setInput(history[at]);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const at = historyAt - 1;
      setHistoryAt(at);
      setInput(at >= 0 ? history[at] : '');
    }
  }

  /* ------------------------------ نمایش ------------------------------- */

  if (!isAdmin) {
    return (
      <Card>
        <Empty icon={<TerminalSquare className="h-8 w-8" />} title={t('trmForbidden')} hint={t('trmForbiddenHint')} />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">
            <TerminalSquare className="h-5 w-5" />
            {t('terminal')}
          </h1>
          <p className="page-sub ltr">{cwd || '…'}</p>
        </div>
        <div className="flex gap-2">
          {busy && (
            <button className="btn btn-sm btn-danger" onClick={() => socket?.emit('term:interrupt', {}, () => {})}>
              <Square className="h-3.5 w-3.5" />
              {t('trmStop')}
            </button>
          )}
          <button className="btn btn-sm" onClick={() => setLines([])}>
            <Trash2 className="h-3.5 w-3.5" />
            {t('trmClear')}
          </button>
        </div>
      </div>

      <Notice tone="warn">{t('trmLimitation')}</Notice>

      {error && <Notice tone="bad">{error}</Notice>}

      <Card className="p-0">
        <div
          ref={scrollRef}
          className="ltr h-[26rem] overflow-auto p-3 font-mono text-[12.5px] leading-relaxed"
          style={{ background: 'var(--surface-sunken)' }}
          onClick={() => inputRef.current?.focus()}
        >
          {lines.length === 0 && <p className="text-ink-muted">{t('trmEmpty')}</p>}
          {lines.map((line, i) => (
            <pre
              key={i}
              className="whitespace-pre-wrap break-words"
              style={{
                color:
                  line.kind === 'in' ? 'var(--accent)'
                    : line.kind === 'err' ? 'var(--status-critical)'
                      : line.kind === 'sys' ? 'var(--text-muted)'
                        : 'var(--text-primary)',
                fontWeight: line.kind === 'in' ? 600 : 400,
              }}
            >
              {line.text}
            </pre>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-line p-2">
          <span className="ltr shrink-0 ps-1 font-mono text-xs text-ink-muted">$</span>
          <input
            ref={inputRef}
            className="ltr input border-0 bg-transparent font-mono shadow-none focus:shadow-none"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={busy ? t('trmRunning') : t('trmPrompt')}
            disabled={!ready}
            spellCheck={false}
            autoComplete="off"
          />
          <button className="btn btn-sm btn-primary shrink-0" onClick={submit} disabled={!ready || busy || !input.trim()}>
            <CornerDownLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      </Card>
    </div>
  );
}
