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
