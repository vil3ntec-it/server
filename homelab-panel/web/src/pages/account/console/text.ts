// ---------------------------------------------------------------------------
//  سه‌زبانهٔ پوستهٔ «فروشگاه» — فارسی، انگلیسی، پشتو در **همان** جای نوشتن (عربی ⇒ انگلیسی، همان قاعدهٔ `i18n.ts`)
//
//  چرا جدا از `i18n.ts`: چند ماژول هم‌زمان ساخته می‌شوند و هر کدام اگر به جدولِ مشترک کلید بیفزاید، هر ادغام
//  تعارض می‌شد. `tx(fa, en, ps)` سه زبان را **اجباری** می‌کند (بی هر سه کامپایل نمی‌شود) و کلیدی گم نمی‌شود.
// ---------------------------------------------------------------------------
import { useCallback } from 'react';
import { useApp } from '../../../app-context';
import type { Tri } from './contract';

export type Tx = (fa: string, en: string, ps: string, vars?: Record<string, string | number>) => string;

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), s) : s;

export function pick(lang: string, tri: Partial<Tri> | null | undefined): string {
  if (!tri) return '';
  if (lang === 'fa' || lang === 'ps') return tri[lang] || tri.fa || tri.en || '';
  return tri.en || tri.fa || '';
}

/** `const tx = useTx(); tx('داشبورد', 'Dashboard', 'ډشبورډ')` */
export function useTx(): Tx {
  const { lang } = useApp();
  return useCallback<Tx>((fa, en, ps, vars) => fill(pick(lang, { fa, en, ps }), vars), [lang]);
}

/** برچسبِ سه‌زبانه‌ای که سرور فرستاده (عنوانِ ماژول، گروه، معیارِ کارت). */
export function usePick(): (tri: Partial<Tri> | null | undefined) => string {
  const { lang } = useApp();
  return useCallback((tri) => pick(lang, tri), [lang]);
}
