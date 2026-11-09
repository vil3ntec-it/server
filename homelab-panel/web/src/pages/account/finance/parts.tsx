// ---------------------------------------------------------------------------
//  ماژولِ «مالی» (۴.۵) — تکه‌های مشترکِ زیرزبانه‌ها: کارتِ خواندنی (بارگذاری/خطا/«در دسترس نیست»/منبع و
//  زمان)، گزینهٔ بخش و صفحه‌بندیِ سمتِ سرور.
// ---------------------------------------------------------------------------
import type { ReactNode } from 'react';

import { Card, Loading } from '../../../components/ui';
import { useApp } from '../../../app-context';
import { Notice } from '../../../control/ui';
import { CloudProblem, fa, type Load } from '../shared';
import { minutesAgo, num, shown, stampOf } from '../consoleData';
import { useFinT, type FinT } from './strings';
import { isUnavail, type Unavail } from './data';

const moment = (ms: number) =>
  new Date(ms).toLocaleString('fa-AF', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 *  «منبع: … · سنجیدهٔ سرورِ حساب ۱۲:۳۰ (۳ دقیقه پیش)» — همان قاعدهٔ `SourceLine` ِ ‎ShopConsole.tsx‎ (سنجیدهٔ سرورِ
 *  حساب ⇐ رسیده به پنل ⇐ رسیده به صفحه؛ هیچ‌کدام ⇒ «—»)، این‌جا تا ‎finance/*‎ به آن فایل وابسته نباشد.
 */
export function SourceLine({ source, data, at }: { source: string; data?: unknown; at?: number | null }) {
  const { t } = useApp();
  const stamp = stampOf(data) || (num(at) ? { at: Number(at), kind: 'page' as const } : null);
  const ago = stamp ? minutesAgo(stamp.at, Date.now()) : null;
  const label = !stamp ? '' : stamp.kind === 'server' ? t('scCheckedByServer') : stamp.kind === 'panel' ? t('scReceivedByPanel') : t('scReceivedByPage');
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-muted">
      <span>{t('scSource')}:</span>
      <code dir="ltr" className="font-mono">{source}</code>
      <span>·</span>
      <span>
        {stamp ? `${label} ${moment(stamp.at)}` : `${t('scUpdated')} —`}
        {ago !== null && ` (${t('scMinutesAgo').replace('{n}', shown(ago))})`}
      </span>
    </p>
  );
}

/** خطای بالادست با پیام و **کدِ خودش**؛ گذرا ⇒ خودش دوباره (همان `useLoad`). */
export function Problem({ load }: { load: Load<unknown> }) {
  const { t } = useApp();
  return (
    <div>
      <CloudProblem code={load.code} message={load.error || ''} onRetry={load.reload} />
      {load.code && (
        <p className="-mt-2 mb-3 text-[11px] text-ink-muted">
          {t('scErrorCode')}: <code dir="ltr" className="font-mono">{load.code}</code>
        </p>
      )}
    </div>
  );
}

export function Unavailable({ data }: { data: Unavail }) {
  const ft = useFinT();
  return (
    <Notice tone="warn">
      <b>{ft('unavailable')}</b>
      <span className="mt-1 block text-[11px] text-ink-muted">
        {ft('capability')}: <code dir="ltr" className="font-mono">{data.capability || 'finance.v1'}</code>
        {data.needs ? <> · <span dir="ltr">{data.needs}</span></> : null}
      </span>
    </Notice>
  );
}

/** کارتِ خواندنی: بارگذاری/خطا (با کدِ خودش)/«در دسترس نیست»، و خطِ منبع و زمان. */
export function FinCard<D>({ title, icon, source, load, action, children }: {
  title: ReactNode; icon?: ReactNode; source: string; load: Load<D | Unavail>; action?: ReactNode; children: (d: D) => ReactNode;
}) {
  return (
    <Card title={title} icon={icon} action={action}>
      {load.error ? <Problem load={load as Load<unknown>} />
        : !load.data ? <Loading />
        : isUnavail(load.data) ? <Unavailable data={load.data} />
        : (
          <>
            {children(load.data as D)}
            <SourceLine source={source} data={load.data} at={load.at} />
          </>
        )}
    </Card>
  );
}

export const appLabel = (ft: FinT, app: string) => (app === 'pump' ? ft('appPump') : app === 'shop' ? ft('appShop') : app);

/** سه گزینهٔ بخش. */
export function AppSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ft = useFinT();
  return (
    <select className="input w-auto" value={value} onChange={(e) => onChange(e.target.value)} aria-label={ft('service')}>
      <option value="all">{ft('appAll')}</option>
      <option value="shop">{ft('appShop')}</option>
      <option value="pump">{ft('appPump')}</option>
    </select>
  );
}

/** «۱ تا ۲۰ از ۵۳» + قبلی/بعدی — صفحه‌بندیِ سمتِ سرور با offset. */
export function Pager({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (o: number) => void }) {
  const ft = useFinT();
  if (total <= limit && offset === 0) return null;
  return (
    <div className="mt-3 flex items-center justify-between gap-2 text-xs text-ink-muted">
      <span>{ft('page', { a: fa(total ? offset + 1 : 0), b: fa(Math.min(offset + limit, total)), n: fa(total) })}</span>
      <span className="flex gap-2">
        <button className="btn btn-sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>{ft('prev')}</button>
        <button className="btn btn-sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>{ft('next')}</button>
      </span>
    </div>
  );
}
