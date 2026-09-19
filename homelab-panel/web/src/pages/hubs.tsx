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
