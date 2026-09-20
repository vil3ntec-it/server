// ---------------------------------------------------------------------------
//  کادرِ کدِ شش‌رقمی — شش خانهٔ جدا، پرشِ خودکار، Paste، ارقامِ فارسی و
//  انگلیسی، و ارسالِ خودکار بعد از رقمِ ششم (بخشِ ۴ پرامپت).
//  همین یک کامپوننت هم برای کدِ ایمیل به کار می‌رود هم برای کدِ Authenticator.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';

const FA = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';
export function toEnglishDigits(s: string) {
  return s
    .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)))
    .replace(/\D/g, '');
}

export default function CodeInput({
  length = 6,
  onComplete,
  disabled,
  autoFocus = true,
  resetKey,
}: {
  length?: number;
  onComplete: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /** با عوض شدنش خانه‌ها خالی می‌شوند (مثلاً بعد از کدِ غلط) */
  resetKey?: number;
}) {
  const [digits, setDigits] = useState<string[]>(() => Array(length).fill(''));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    setDigits(Array(length).fill(''));
    refs.current[0]?.focus();
  }, [resetKey, length]);

  function commit(next: string[]) {
    setDigits(next);
    const code = next.join('');
    if (code.length === length && !next.includes('')) onComplete(code);
  }

  function setAt(i: number, raw: string) {
    const clean = toEnglishDigits(raw);
    if (!clean) {
      const next = [...digits];
      next[i] = '';
      setDigits(next);
      return;
    }
    // چند رقم با هم (تایپِ سریع یا Paste داخلِ یک خانه) — پخش روی خانه‌های بعدی
    const next = [...digits];
    let pos = i;
    for (const ch of clean) {
      if (pos >= length) break;
      next[pos] = ch;
      pos++;
    }
    refs.current[Math.min(pos, length - 1)]?.focus();
    commit(next);
  }

  function onKey(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      const next = [...digits];
      next[i - 1] = '';
      setDigits(next);
      refs.current[i - 1]?.focus();
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === 'ArrowRight' && i < length - 1) refs.current[i + 1]?.focus();
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = toEnglishDigits(e.clipboardData.getData('text'));
    if (!text) return;
    e.preventDefault();
    setAt(0, text);
  }

  return (
    <div className="flex justify-center gap-2" dir="ltr">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="input h-12 w-10 px-0 text-center text-lg tnum"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          autoFocus={autoFocus && i === 0}
          value={d}
          maxLength={length}
          disabled={disabled}
          onChange={(e) => setAt(i, e.target.value)}
          onKeyDown={(e) => onKey(i, e)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
          aria-label={`digit ${i + 1}`}
        />
      ))}
    </div>
  );
}
