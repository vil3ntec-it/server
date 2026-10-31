import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
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
import SubscriptionsMoved from './pages/account/SubscriptionsMoved';
import ConsoleShell from './pages/account/console/Shell';
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
          ⛔ **بخشِ جدای «اشتراک‌ها» برداشته شد** (۱۴۰۵/۰۸/۰۹، دستورِ صاحب
          محصول): اشتراکِ پمپ در «پمپ‌بنزین‌ها ← 💳 اشتراک‌ها» (`/stations#subs`)
          و اشتراکِ فروشگاه در «فروشگاه‌ها ← اشتراک‌ها» (`/shop?tab=subs`) —
          `pages/account/AppSubscriptions.tsx`. نشانی‌های کهنه نمی‌شکنند: با
          همان `app`/`tab`/`q` به بخشِ درست، و بی برنامه به «کدام برنامه؟»
          (`SubscriptionsMoved` ⇐ `subsPath.ts`).
        */}
        <Route path="/subscriptions" element={<SubscriptionsMoved />} />
        <Route path="/customers" element={<SubscriptionsMoved defaultView="subs" />} />
        <Route path="/plans" element={<SubscriptionsMoved defaultView="plans" />} />
        <Route path="/visitors" element={<SubscriptionsMoved defaultView="visitors" />} />
        <Route path="/vip-codes" element={<SubscriptionsMoved defaultView="codes" />} />
        <Route path="/discounts" element={<SubscriptionsMoved defaultView="discounts" />} />
        {/*
          ⛔ میزِ فروشگاه صفحهٔ خودش را گرفت (بندهای ۴.۱ تا ۴.۴ سندِ ریمیک):
          داشبورد، اشتراک‌ها (همهٔ کارها، از ۱۴۰۵/۰۸/۰۹) و کدِ شاگرد.
        */}
        {/* ⛔ از ۱۴۰۵/۰۸/۱۰ بخشِ «فروشگاه» یک برنامهٔ کامل است: پوسته + ماژول‌ها (`console/`)، همان ‎?tab=‎ ِ پیشین */}
        <Route path="/shop" element={<ConsoleShell />} />
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
