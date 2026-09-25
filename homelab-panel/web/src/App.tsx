import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './app-context';
import { featureOn } from './features';
import { Loading, ToastHost } from './components/ui';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Sites from './pages/Sites';
import Files from './pages/Files';
import SiteServer from './pages/SiteServer';
import Settings from './pages/Settings';
import CodesPage from './pages/Codes';

// ── مرکز فرمان ────────────────────────────────────────────────────────────
import Command from './pages/control/Command';
import CcServers from './pages/control/Servers';
import StoragePage from './pages/control/StoragePage';
import Vault from './pages/control/Vault';
import Updates from './pages/control/Updates';
import PanelUsers from './pages/control/PanelUsers';
import Assistant from './pages/Assistant';
import { AccountServerHub, DomainsHub, LoginsHub, LogsHub, MonitoringHub, NetworkHub } from './pages/hubs';
import SubscriptionsHub from './pages/account/SubscriptionsHub';
import ShopDesk from './pages/account/ShopDesk';
import DatabasesPage from './pages/Databases';
import TerminalPage from './pages/Terminal';
import AutomationPage from './pages/Automation';
import StationsPage from './pages/Stations';
import StationProfile from './pages/StationProfile';

// ── مشتری‌ها، پول و پیام — همه از سرورِ حساب (routes/account-admin.js) ────
import SalesPage from './pages/account/Sales';
import NoticesPage from './pages/account/Notices';
import SupportPage from './pages/account/Support';
import SyncStatusPage from './pages/account/SyncStatus';

/**
 *  نشانیِ قدیمیِ اشتراک‌ها ⇒ تبِ خودش در `/subscriptions`، با همان پارامترها.
 *  `/customers?tab=visitors` هم تبِ «بازدیدکننده‌ها» می‌شود، و `/plans?tab=codes`
 *  «کدهای اشتراک» — همان نام‌های قبلی.
 */
function ToSubscriptions({ tab }: { tab: string }) {
  const loc = useLocation();
  const p = new URLSearchParams(loc.search);
  const old = p.get('tab');
  const target = old && ['subs', 'plans', 'discounts', 'codes', 'requests', 'visitors'].includes(old) ? old : tab;
  p.delete('tab');
  if (target !== 'subs') p.set('tab', target);
  const qs = p.toString();
  return <Navigate to={`/subscriptions${qs ? `?${qs}` : ''}`} replace />;
}

function Shell() {
  const { ready, authed } = useApp();
  if (!ready) return <Loading />;
  if (!authed) return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/sites" element={<Sites />} />
        <Route path="/domains" element={<DomainsHub />} />
        {featureOn('files') && <Route path="/files" element={<Files />} />}
        <Route path="/databases" element={<DatabasesPage />} />
        <Route path="/terminal" element={<TerminalPage />} />
        <Route path="/automation" element={<AutomationPage />} />
        <Route path="/tunnel-domains" element={<Navigate to="/domains?tab=tunnel" replace />} />
        {/*
          ⛔ پنج صفحه‌ای که از منو رفتند (۱۴۰۵/۰۷/۱۳): نشانیِ قدیمی نباید بشکند،
          پس هر کدام به نزدیک‌ترین صفحهٔ زنده می‌رود.
        */}
        <Route path="/docker" element={<Navigate to="/control/servers" replace />} />
        <Route path="/runtimes" element={<Navigate to="/control/servers" replace />} />
        <Route path="/processes" element={<Navigate to="/monitoring" replace />} />
        <Route path="/cron" element={<Navigate to="/automation" replace />} />
        <Route path="/control/projects/*" element={<Navigate to="/control/servers" replace />} />
        <Route path="/monitoring" element={<MonitoringHub />} />
        <Route path="/network" element={<NetworkHub />} />
        <Route path="/logs" element={<LogsHub />} />
        <Route path="/site-server" element={<SiteServer />} />
        <Route path="/logins" element={<LoginsHub />} />

        {/* مشتری‌ها و فروش — پلِ سرورِ حساب */}
        {/*
          ⛔ **اشتراک‌ها یک بخش‌اند** (۱۴۰۵/۰۷/۱۳): «مشتری‌ها و اشتراک‌ها» و
          «پلن‌ها و تخفیف‌ها» در `/subscriptions` یکی شدند. نشانی‌های قدیمی
          نمی‌شکنند — هر کدام با همان پارامترها (`app`، `q`) به تبِ خودش می‌رود.
        */}
        <Route path="/subscriptions" element={<SubscriptionsHub />} />
        <Route path="/customers" element={<ToSubscriptions tab="subs" />} />
        <Route path="/plans" element={<ToSubscriptions tab="plans" />} />
        <Route path="/visitors" element={<ToSubscriptions tab="visitors" />} />
        <Route path="/vip-codes" element={<ToSubscriptions tab="codes" />} />
        <Route path="/discounts" element={<ToSubscriptions tab="discounts" />} />
        {/*
          ⛔ میزِ فروشگاه صفحهٔ خودش را گرفت (بندهای ۴.۱ تا ۴.۴ سندِ ریمیک):
          داشبورد، سه گروهِ اشتراک، و کدِ شاگرد. کارهای اشتراکش حالا از همان
          `/subscriptions?app=shop` است.
        */}
        <Route path="/shop" element={<ShopDesk />} />
        <Route path="/account-server" element={<AccountServerHub />} />
        <Route path="/sales" element={<SalesPage />} />
        <Route path="/notices" element={<NoticesPage />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="/sync" element={<SyncStatusPage />} />
        <Route path="/stations" element={<StationsPage />} />
        <Route path="/stations/:code" element={<StationProfile />} />
        <Route path="/codes" element={<CodesPage />} />
        {featureOn('settings') && <Route path="/settings" element={<Settings />} />}

        {/* مرکز فرمان */}
        {featureOn('commandCenter') && <Route path="/control" element={<Command />} />}
        <Route path="/control/servers" element={<CcServers />} />
        <Route path="/control/networking" element={<Navigate to="/network?tab=projects" replace />} />
        <Route path="/control/routing" element={<Navigate to="/domains?tab=routing" replace />} />
        <Route path="/control/cloudflare" element={<Navigate to="/domains?tab=cloudflare" replace />} />
        <Route path="/control/storage" element={<StoragePage />} />
        <Route path="/control/vault" element={<Vault />} />
        <Route path="/control/monitoring" element={<Navigate to="/monitoring?tab=checks" replace />} />
        <Route path="/control/audit" element={<Navigate to="/logs?tab=audit" replace />} />
        <Route path="/control/updates" element={<Updates />} />
        {featureOn('panelUsers') && <Route path="/control/panel-users" element={<PanelUsers />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Shell />
        <ToastHost />
      </AppProvider>
    </BrowserRouter>
  );
}
