// ---------------------------------------------------------------------------
//  🏪 میزبانِ **ساختِ جدا** ِ بخشِ «فروشگاه» — جای ‎../host.ts‎ در ‎npm run build:shop-standalone‎ (‎vite.shop-standalone.config.ts‎
//  هر ‎import … from './host'‎ ِ ماژول را به این فایل می‌برد). همان نام‌ها، همان نوع‌ها (‎host.check.ts‎ با ‎tsc‎ می‌سنجد).
//
//  فرق با میزبانِ پنل فقط این‌ها: کاربرانِ **پنل** نیست (‎PanelUsers = null‎) و زمینهٔ ‎useApp‎ را ‎StandaloneApp.tsx‎ می‌دهد
//  (ورود، نشست و زبانِ خودش). بقیه همان تکه‌های مشترک‌اند — فهرستشان ‎shared-pieces.json‎؛ برای بیرون بردن همان‌ها کپی می‌شوند.
// ---------------------------------------------------------------------------
import type { ComponentType } from 'react';
import { useApp as useHostContext } from '../../../app-context';
import type { HostApp } from '../host';

export { api, ApiError, fetchBlobUrl, getToken } from '../../../api';

export type { HostApp } from '../host';
export const useApp: () => HostApp = useHostContext;

export const SHOP_HOME = '/shop';

export { Card, ConfirmDialog, CopyButton, Loading, Modal, Skeleton, toast } from '../../../components/ui';
export { ActionButton, Cell, KV, Notice, Row, Select, Stat, Table, Tabs } from '../../../control/ui';

export type { Dict } from '../../../i18n';
export { dateTime } from '../../../format';
export { usePick, useTx, type Tx } from '../../../pages/account/console/text';

export { CloudProblem, fa, money, useLoad, type Load } from '../../../pages/account/shared';
export {
  errCode, errText, fmtTime, Forbidden, Guarded, NotSupported, outcomeUnknown, SensitiveDialog, StateEmpty, StateLoading,
  type SensitiveSubmit,
} from '../../../pages/account/console/parts';
export { default as GrantNeeded, GRANT_REQUIRED, SUPPORT_ACCESS_ANCHOR } from '../../../pages/account/console/GrantNeeded';

export { default as AppSubscriptions } from '../../../pages/account/AppSubscriptions';
export { default as Sales } from '../../../pages/account/Sales';
/** کاربرانِ پنل مالِ پنل است — این میزبان ندارد و ماژول آن تکه را نشان نمی‌دهد. */
export const PanelUsers: ComponentType | null = null;

export type { PanelModule } from '../../types';
