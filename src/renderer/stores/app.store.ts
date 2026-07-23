import { create } from 'zustand';
import type {
  AppSettings,
  CaStatus,
  CertificateInfo,
  ConfigPreview,
  PlatformStatus,
  ProxyStatus,
} from '../../shared/types';
import { unwrap, errorMessage, errorDetails } from '../lib/bridge';
import { toast } from './toast.store';

export type Page = 'dashboard' | 'domains' | 'traffic' | 'certificates' | 'logs' | 'settings';

interface AppState {
  page: Page;
  platform: PlatformStatus | null;
  settings: AppSettings | null;
  preview: ConfigPreview | null;
  proxy: ProxyStatus | null;
  ca: CaStatus | null;
  certificates: CertificateInfo[];
  proxyBusy: boolean;
  caBusy: boolean;
  setPage(page: Page): void;
  loadPlatform(): Promise<void>;
  loadSettings(): Promise<void>;
  loadPreview(): Promise<void>;
  setPreview(preview: ConfigPreview): void;
  updateSettings(patch: Partial<AppSettings>): Promise<boolean>;
  loadProxy(): Promise<void>;
  proxyAction(action: 'start' | 'stop' | 'restart'): Promise<void>;
  loadCa(): Promise<void>;
  installCa(): Promise<void>;
  loadCertificates(): Promise<void>;
  regenerateCertificates(): Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  page: 'dashboard',
  platform: null,
  settings: null,
  preview: null,
  proxy: null,
  ca: null,
  certificates: [],
  proxyBusy: false,
  caBusy: false,

  setPage: (page) => set({ page }),

  loadPlatform: async () => {
    try {
      set({ platform: await unwrap(window.localBridge.system.platformStatus()) });
    } catch (err) {
      toast.error('Failed to load platform status', errorMessage(err));
    }
  },

  loadSettings: async () => {
    try {
      set({ settings: await unwrap(window.localBridge.settings.get()) });
    } catch (err) {
      toast.error('Failed to load settings', errorMessage(err));
    }
  },

  loadPreview: async () => {
    try {
      set({ preview: await unwrap(window.localBridge.config.preview()) });
    } catch (err) {
      toast.error('Failed to load configuration preview', errorMessage(err));
    }
  },

  setPreview: (preview) => set({ preview }),

  updateSettings: async (patch) => {
    try {
      const updated = await unwrap(window.localBridge.settings.update(patch));
      set({ settings: updated });
      toast.success('Settings saved');
      void get().loadPreview();
      void get().loadPlatform();
      return true;
    } catch (err) {
      toast.error('Failed to save settings', [errorMessage(err), errorDetails(err)].filter(Boolean).join('\n'));
      return false;
    }
  },

  loadProxy: async () => {
    try {
      set({ proxy: await unwrap(window.localBridge.proxy.status()) });
    } catch {
      // Status polling failures should not spam toasts.
    }
  },

  proxyAction: async (action) => {
    set({ proxyBusy: true });
    try {
      const status = await unwrap(window.localBridge.proxy[action]());
      set({ proxy: status });
      toast.success(
        action === 'start' ? 'Proxy started' : action === 'stop' ? 'Proxy stopped' : 'Proxy restarted',
      );
    } catch (err) {
      toast.error(`Could not ${action} the proxy`, [errorMessage(err), errorDetails(err)].filter(Boolean).join('\n'));
      void get().loadProxy();
    } finally {
      set({ proxyBusy: false });
    }
  },

  loadCa: async () => {
    try {
      set({ ca: await unwrap(window.localBridge.certificates.authorityStatus()) });
    } catch {
      // Non-critical; the Certificates page shows a retry.
    }
  },

  installCa: async () => {
    set({ caBusy: true });
    try {
      const status = await unwrap(window.localBridge.certificates.installAuthority());
      set({ ca: status });
      toast.success('Certificate authority installed and trusted');
      void get().loadCertificates();
      void get().loadPreview();
      void get().loadProxy();
    } catch (err) {
      toast.error('CA installation failed', [errorMessage(err), errorDetails(err)].filter(Boolean).join('\n'));
      void get().loadCa();
    } finally {
      set({ caBusy: false });
    }
  },

  loadCertificates: async () => {
    try {
      set({ certificates: await unwrap(window.localBridge.certificates.list()) });
    } catch (err) {
      toast.error('Failed to load certificates', errorMessage(err));
    }
  },

  regenerateCertificates: async () => {
    set({ caBusy: true });
    try {
      const certs = await unwrap(window.localBridge.certificates.regenerate());
      set({ certificates: certs });
      toast.success('Certificates regenerated');
      void get().loadPreview();
    } catch (err) {
      toast.error('Certificate regeneration failed', [errorMessage(err), errorDetails(err)].filter(Boolean).join('\n'));
    } finally {
      set({ caBusy: false });
    }
  },
}));
