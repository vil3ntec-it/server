import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './app-context';
import { Loading, ToastHost } from './components/ui';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Sites from './pages/Sites';
import Domains from './pages/Domains';
import Files from './pages/Files';
import Monitoring from './pages/Monitoring';
import NetworkPage from './pages/NetworkPage';
import Logs from './pages/Logs';
import SiteServer from './pages/SiteServer';
import Settings from './pages/Settings';

// ── مرکز فرمان ────────────────────────────────────────────────────────────
import Command from './pages/control/Command';
import CcProjects from './pages/control/Projects';
import ProjectDetail from './pages/control/ProjectDetail';
import CcServers from './pages/control/Servers';
import Networking from './pages/control/Networking';
import Routing from './pages/control/Routing';
import CloudflarePage from './pages/control/CloudflarePage';
import StoragePage from './pages/control/StoragePage';
import Vault from './pages/control/Vault';
import MonitoringPage from './pages/control/MonitoringPage';
import Audit from './pages/control/Audit';
import Updates from './pages/control/Updates';

function Shell() {
  const { ready, authed } = useApp();
  if (!ready) return <Loading />;
  if (!authed) return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/sites" element={<Sites />} />
        <Route path="/domains" element={<Domains />} />
        <Route path="/files" element={<Files />} />
        <Route path="/monitoring" element={<Monitoring />} />
        <Route path="/network" element={<NetworkPage />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/site-server" element={<SiteServer />} />
        <Route path="/settings" element={<Settings />} />

        {/* مرکز فرمان */}
        <Route path="/control" element={<Command />} />
        <Route path="/control/projects" element={<CcProjects />} />
        <Route path="/control/projects/:projectId" element={<ProjectDetail />} />
        <Route path="/control/servers" element={<CcServers />} />
        <Route path="/control/networking" element={<Networking />} />
        <Route path="/control/routing" element={<Routing />} />
        <Route path="/control/cloudflare" element={<CloudflarePage />} />
        <Route path="/control/storage" element={<StoragePage />} />
        <Route path="/control/vault" element={<Vault />} />
        <Route path="/control/monitoring" element={<MonitoringPage />} />
        <Route path="/control/audit" element={<Audit />} />
        <Route path="/control/updates" element={<Updates />} />
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
