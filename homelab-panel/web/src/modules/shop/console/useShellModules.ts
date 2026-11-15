// ---------------------------------------------------------------------------
//  فهرستِ ماژول‌های همین نشست (‎GET /console/modules‎) — **یک** خواندن برای پوسته و منوی کناری (۱.۵۱.۱)
//
//  از ۱.۵۱.۱ منوی بخش در نوارِ کناریِ پنل است (‎SubNav.tsx‎) و پوسته (‎Shell.tsx‎) هم همین فهرست را می‌خواهد؛ هر دو این هوک را
//  صدا می‌زنند و درخواستِ هم‌زمان یکی می‌شود (ده ثانیه، بسته به همان توکن — نقشِ نشستِ دیگر قاطی نمی‌شود).
//  ⛔ قاعدهٔ «کدام ماژول برای کدام نقش» همچنان فقط در سرور است؛ این‌جا فقط خواندن.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, getToken, type Load } from '../host';
import { SHELL_API, type ModulesResponse } from './contract';

const FRESH_MS = 10_000;
let shared: { token: string | null; at: number; promise: Promise<ModulesResponse> } | null = null;

function fetchModules(force: boolean): Promise<ModulesResponse> {
  const token = getToken();
  if (!force && shared && shared.token === token && Date.now() - shared.at < FRESH_MS) return shared.promise;
  const entry = { token, at: Date.now(), promise: api<ModulesResponse>(SHELL_API.modules) };
  shared = entry;
  entry.promise.catch(() => { if (shared === entry) shared = null; });
  return entry.promise;
}

export function useShellModules(): Load<ModulesResponse> {
  const [data, setData] = useState<ModulesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(true);
  const [at, setAt] = useState<number | null>(null);
  const alive = useRef(true);
  const run = useCallback(async (force: boolean) => {
    setBusy(true);
    try {
      const res = await fetchModules(force);
      if (!alive.current) return;
      setData(res);
      setAt(Date.now());
      setError(null);
      setCode('');
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : 'خواندنِ فهرستِ ماژول‌ها نشد');
      setCode(e instanceof ApiError ? e.code : '');
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void run(false);
    return () => { alive.current = false; };
  }, [run]);
  return { data, error, code, busy, at, reload: () => run(true) };
}
