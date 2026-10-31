// ---------------------------------------------------------------------------
//  سه‌زبانهٔ ۴.۶/۴.۷ — فارسی، انگلیسی، پشتو در **همان** جای نوشتن (عربی ⇒ انگلیسی، همان قاعدهٔ `i18n.ts`).
//  چرا جدا از `i18n.ts`: چند ماژولِ کنسول هم‌زمان ساخته می‌شوند و افزودن به جدولِ مشترک هر ادغام را تعارض می‌کرد؛
//  `tx(fa, en, ps)` هر سه زبان را اجباری می‌کند (همان الگوی پوستهٔ کنسول، `console/text.ts`).
// ---------------------------------------------------------------------------
import { useCallback } from 'react';
import { useApp } from '../../../app-context';
import type { Tri } from './marketData';

export type Tx = (fa: string, en: string, ps: string, vars?: Record<string, string | number>) => string;
export type Lang3 = 'fa' | 'en' | 'ps';

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), s) : s;

export const lang3 = (lang: string): Lang3 => (lang === 'fa' || lang === 'ps' ? lang : 'en');

export function useTx(): { tx: Tx; tri: (x: Tri | undefined, fallback?: string) => string; lang: Lang3 } {
  const { lang } = useApp();
  const l = lang3(lang);
  const tx = useCallback<Tx>((fa, en, ps, vars) => fill(l === 'fa' ? fa : l === 'ps' ? ps : en, vars), [l]);
  const tri = useCallback((x: Tri | undefined, fallback = '') => (x ? x[l] || x.fa : fallback), [l]);
  return { tx, tri, lang: l };
}

/** عنوانِ دو زبانهٔ بخشِ «فروشگاه» (همان برچسب‌های رزروشدهٔ پوستهٔ کنسول برای ۴.۶ و ۴.۷). */
export const TAB_LABEL: Record<'market' | 'courier', Tri> = {
  market: { fa: 'مدیریتِ بازار', en: 'Marketplace management', ps: 'د بازار مدیریت' },
  courier: { fa: 'نظارتِ پیک', en: 'Courier monitoring', ps: 'د پېک څارنه' },
};
export const tabLabel = (id: 'market' | 'courier', lang: string) => TAB_LABEL[id][lang3(lang)];
