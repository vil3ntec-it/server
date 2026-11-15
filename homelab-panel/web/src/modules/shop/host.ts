// ---------------------------------------------------------------------------
//  🏪 میزبانِ بخشِ «فروشگاه» — **تنها** درِ این ماژول به پنل (شرح: ‎docs/SHOP-MODULE-fa.md‎)
//
//  ⛔ هیچ فایلی در ‎modules/shop/‎ جز همین فایل (و ‎standalone/‎ که میزبانِ دیگر است) چیزی از پنل وارد نمی‌کند؛
//     فقط از ‎./‎ ِ خودِ ماژول، از همین ‎host‎ و از بسته‌های npm. سنجه: ‎server/test/module-boundary.mjs‎ (در ‎npm test‎).
//  ⛔ هر نامِ تازه‌ای که این‌جا بیفزایید باید در ‎standalone/host.tsx‎ هم باشد (همان نوع) — ‎standalone/host.check.ts‎ با
//     ‎tsc‎ می‌سنجد؛ ساختِ جدا (‎npm run build:shop-standalone‎) همین فایل را با آن عوض می‌کند.
//
//  گروه‌ها همان «رابطِ میزبان» ِ سند: درخواستِ واردشده، کاربر و نقش، پیمایش، اعلان، جای صفحه، زبان و قالب‌بندی،
//  و چند تکهٔ مشترکِ «سرورِ حساب» که پمپ هم دارد (سرِ جایشان می‌مانند، فقط از این‌جا).
// ---------------------------------------------------------------------------
import type { ComponentType } from 'react';
import { useApp as usePanelApp } from '../../app-context';
import PanelUsersPage from '../../pages/control/PanelUsers';

/* ── ۱) درخواستِ واردشده: توکنِ نشست، «احرازِ دوباره» ِ کارِ حساس و ۴۰۱ همه در خودِ ‎api‎ ─────────────────── */
export { api, ApiError, fetchBlobUrl, getToken } from '../../api';

/* ── ۲) کاربر، نقش و زبانِ همین نشست — فقط همین پنج تا (مرزِ واقعی در سرور است) ─────────────────────────── */
type PanelApp = ReturnType<typeof usePanelApp>;
export type HostApp = Pick<PanelApp, 'can' | 'dir' | 'lang' | 't' | 'username'>;
export const useApp: () => HostApp = usePanelApp;

/* ── ۳) پیمایش: ‎react-router-dom‎ (بستهٔ npm) — نشانی‌های ماژول زیرِ همین پایه‌اند ───────────────────────── */
export const SHOP_HOME = '/shop';

/* ── ۴) اعلان و تکه‌های رابط (کارت، پنجره، جدول…) ──────────────────────────────────────────────────────── */
export { Card, ConfirmDialog, CopyButton, Loading, Modal, Skeleton, toast } from '../../components/ui';
export { ActionButton, Cell, KV, Notice, Row, Select, Stat, Table, Tabs } from '../../control/ui';

/* ── ۵) زبان و قالب‌بندی ────────────────────────────────────────────────────────────────────────────── */
export type { Dict } from '../../i18n';
export { dateTime } from '../../format';
export { usePick, useTx, type Tx } from '../../pages/account/console/text';

/* ── ۶) تکه‌های مشترکِ «سرورِ حساب» (پمپ و فروشگاه، و صفحهٔ «همگام‌سازی») — سرِ جایشان می‌مانند ─────────── */
export { CloudProblem, fa, money, useLoad, type Load } from '../../pages/account/shared';
export {
  errCode, errText, fmtTime, Forbidden, Guarded, NotSupported, outcomeUnknown, SensitiveDialog, StateEmpty, StateLoading,
  type SensitiveSubmit,
} from '../../pages/account/console/parts';
export { default as GrantNeeded, GRANT_REQUIRED, SUPPORT_ACCESS_ANCHOR } from '../../pages/account/console/GrantNeeded';

/* ── ۷) جای صفحه‌های مشترک (اشتراک و فروش با پمپ یکی است)؛ ‎null‎ = این میزبان ندارد و ماژول آن تکه را نشان نمی‌دهد ── */
export { default as AppSubscriptions } from '../../pages/account/AppSubscriptions';
export { default as Sales } from '../../pages/account/Sales';
/** کاربرانِ **پنل** (نه مدیرانِ سرورِ حساب) — مالِ پنل است؛ میزبانِ جدا ‎null‎ می‌دهد. */
export const PanelUsers: ComponentType | null = PanelUsersPage;

/* ── ۸) قراردادِ ثبتِ ماژول در پنل (مسیر، منو، نقش) ─────────────────────────────────────────────────────── */
export type { PanelModule, PanelSubNavProps } from '../types';
