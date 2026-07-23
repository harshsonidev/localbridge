import { useEffect } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Toaster } from './components/common/Toaster';
import { useAppStore } from './stores/app.store';
import { DashboardPage } from './pages/Dashboard';
import { DomainsPage } from './pages/Domains';
import { SettingsPage } from './pages/Settings';
import { CertificatesPage } from './pages/Certificates';
import { TrafficPage } from './pages/Traffic';
import { LogsPage } from './pages/Logs';

export default function App() {
  const { page, loadPlatform, loadSettings, loadPreview } = useAppStore();

  useEffect(() => {
    void loadPlatform();
    void loadSettings();
    void loadPreview();
  }, [loadPlatform, loadSettings, loadPreview]);

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-hidden">
        {page === 'dashboard' ? <DashboardPage /> : null}
        {page === 'domains' ? <DomainsPage /> : null}
        {page === 'traffic' ? <TrafficPage /> : null}
        {page === 'certificates' ? <CertificatesPage /> : null}
        {page === 'logs' ? <LogsPage /> : null}
        {page === 'settings' ? <SettingsPage /> : null}
      </main>
      <Toaster />
    </div>
  );
}
