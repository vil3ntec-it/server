// ---------------------------------------------------------------------------
//  صفحه‌های یکی‌شده — «یک موضوع، یک صفحه»
//
//  تا ۱.۴۲.۰ پنل برای یک موضوع دو تا چهار صفحهٔ جدا داشت که با نام‌های
//  شبیه به هم در منو کنارِ هم می‌نشستند: «مانیتورینگ» و «پایش»، «لاگ‌ها» و
//  «دفتر رخدادها»، «شبکه» و «شبکه و آدرس‌ها»، و چهار صفحه برای دامنه/تونل.
//  صاحبِ سرور نمی‌دانست کدام را باز کند. حالا هر موضوع یک صفحه با تب است؛
//  خودِ صفحه‌های قبلی دست‌نخورده داخلِ تب می‌نشینند (‎?tab=‎ در نشانی می‌ماند
//  تا لینکِ مستقیم و برگشتِ مرورگر کار کند) و نشانی‌های قدیمی به همان تب
//  می‌روند.
// ---------------------------------------------------------------------------
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../app-context';
import { Tabs } from '../control/ui';
import Logs from './Logs';
import Audit from './control/Audit';
import Monitoring from './Monitoring';
import MonitoringPage from './control/MonitoringPage';
import NetworkPage from './NetworkPage';
import Networking from './control/Networking';
import TunnelDomains from './TunnelDomains';
import Domains from './Domains';
import Routing from './control/Routing';
import CloudflarePage from './control/CloudflarePage';
import AppLogins from './AppLogins';
import EmailLogins from './account/EmailLogins';
import { AccountAudit, AccountEmail, AccountSmsPush, ManagedApps } from './account/AccountServerSettings';
import AccountServerLog from './account/AccountServerLog';

type Tab = { id: string; label: string; body: ReactNode };

function Hub({ tabs }: { tabs: Tab[] }) {
  const [params, setParams] = useSearchParams();
  const wanted = params.get('tab') || tabs[0].id;
  const active = tabs.some((t) => t.id === wanted) ? wanted : tabs[0].id;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-2">
      <Tabs tabs={tabs.map((t) => ({ id: t.id, label: t.label }))} active={active} onChange={(id) => setParams(id === tabs[0].id ? {} : { tab: id })} />
      {tabs.find((t) => t.id === active)?.body}
    </div>
  );
}

/** لاگِ سرور + دفترِ رخدادها (چه کسی چه کاری کرد) */
export function LogsHub() {
  const { t } = useApp();
  return <Hub tabs={[{ id: 'events', label: t('logs'), body: <Logs /> }, { id: 'audit', label: t('ccAudit'), body: <Audit /> }]} />;
}

/** نمودارهای زنده + پایش و هشدارها */
export function MonitoringHub() {
  const { t } = useApp();
  return <Hub tabs={[{ id: 'live', label: t('monitoring'), body: <Monitoring /> }, { id: 'checks', label: t('ccMonitoring'), body: <MonitoringPage /> }]} />;
}

/** شبکهٔ همین سرور + آدرس‌ها و پورت‌های پروژه‌ها */
export function NetworkHub() {
  const { t } = useApp();
  return <Hub tabs={[{ id: 'server', label: t('network'), body: <NetworkPage /> }, { id: 'projects', label: t('ccNetworking'), body: <Networking /> }]} />;
}

/** دامنه‌ها و تونل، دامنه‌های سایت‌ها، مسیرِ دامنه‌ها، Cloudflare */
export function DomainsHub() {
  const { t } = useApp();
  return (
    <Hub
      tabs={[
        { id: 'tunnel', label: t('domainsTunnel'), body: <TunnelDomains /> },
        { id: 'sites', label: t('domains'), body: <Domains /> },
        { id: 'routing', label: t('ccRouting'), body: <Routing /> },
        { id: 'cloudflare', label: t('ccCloudflare'), body: <CloudflarePage /> },
      ]}
    />
  );
}

/*
 *  ⛔ `PlansHub` و `CustomersHub` در ۱.۵۰.۱۶ به `account/SubscriptionsHub.tsx`
 *     رفتند — «همهٔ اشتراک‌ها داخلِ یک بخش» (خواستهٔ صاحب سامانه). نشانی‌های
 *     `/customers` و `/plans` در App.tsx به تبِ خودشان در `/subscriptions` می‌روند.
 */

/**
 * تنظیماتِ خودِ سرورِ حساب — برنامه‌ها، ایمیل، پیامک و پوش، و دفترِ ممیزی‌اش.
 *
 * ⛔ تا دیروز تنها راهِ رسیدن به این‌ها `api.<دامنه>/admin/` بود، یعنی یک
 *    پنلِ دوم با یک ورودِ دوم — همان سردرگمی‌ای که قرار بود برداشته شود.
 */
export function AccountServerHub() {
  return (
    <Hub
      tabs={[
        { id: 'apps', label: 'برنامه‌ها', body: <ManagedApps /> },
        //  ⛔ پیامِ «سرورِ حساب افتاده» به همین تب می‌فرستد؛ تا ۱.۵۰.۱۶ هیچ
        //     صفحه‌ای لاگش را نشان نمی‌داد.
        { id: 'status', label: 'وضعیت و لاگ', body: <AccountServerLog /> },
        { id: 'email', label: 'ایمیل', body: <AccountEmail /> },
        { id: 'smspush', label: 'پیامک و پوش', body: <AccountSmsPush /> },
        { id: 'audit', label: 'دفترِ ممیزی', body: <AccountAudit /> },
      ]}
    />
  );
}

/**
 * ورودها — دو دفترِ جدا، یک موضوع.
 *
 * ⚠️ «برنامه‌های این سرور» ورودِ برنامه‌هایی است که خودِ پنل ثبتشان کرده؛
 * «کدِ ایمیلی» ورودِ مشتری‌ها به دکان و پمپ روی **سرورِ حساب** است. دو
 * دفترِ واقعاً جدا، و یکی کردنشان همان «دو دفترِ حساب» می‌شد.
 */
export function LoginsHub() {
  return (
    <Hub
      tabs={[
        { id: 'apps', label: 'برنامه‌های این سرور', body: <AppLogins /> },
        { id: 'email', label: 'کدِ ایمیلیِ مشتری‌ها', body: <EmailLogins /> },
      ]}
    />
  );
}
