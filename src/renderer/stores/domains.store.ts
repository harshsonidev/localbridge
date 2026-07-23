import { create } from 'zustand';
import type { DomainConfig, DomainCreateInput, DomainUpdateInput } from '../../shared/types';
import { unwrap, errorMessage, errorDetails } from '../lib/bridge';
import { toast } from './toast.store';
import { useAppStore } from './app.store';

interface DomainsState {
  domains: DomainConfig[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  load(): Promise<void>;
  create(input: DomainCreateInput): Promise<DomainConfig | null>;
  update(id: string, input: DomainUpdateInput): Promise<DomainConfig | null>;
  remove(id: string): Promise<boolean>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  open(id: string): Promise<void>;
}

function showWarnings(warnings: string[]): void {
  for (const warning of warnings) {
    toast.warning('Heads up', warning);
  }
}

export const useDomainsStore = create<DomainsState>((set, get) => ({
  domains: [],
  loading: false,
  loaded: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const domains = await unwrap(window.localBridge.domains.list());
      set({ domains, loading: false, loaded: true });
    } catch (err) {
      set({ loading: false, loaded: true, error: errorMessage(err) });
    }
  },

  create: async (input) => {
    try {
      const result = await unwrap(window.localBridge.domains.create(input));
      set({ domains: [...get().domains.filter((d) => d.id !== result.domain.id), result.domain] });
      useAppStore.getState().setPreview(result.preview);
      showWarnings(result.warnings);
      return result.domain;
    } catch (err) {
      toast.error('Could not create domain', [errorMessage(err), errorDetails(err)].filter(Boolean).join('\n'));
      return null;
    }
  },

  update: async (id, input) => {
    try {
      const result = await unwrap(window.localBridge.domains.update(id, input));
      set({ domains: get().domains.map((d) => (d.id === id ? result.domain : d)) });
      useAppStore.getState().setPreview(result.preview);
      showWarnings(result.warnings);
      return result.domain;
    } catch (err) {
      toast.error('Could not update domain', [errorMessage(err), errorDetails(err)].filter(Boolean).join('\n'));
      return null;
    }
  },

  remove: async (id) => {
    try {
      const result = await unwrap(window.localBridge.domains.remove(id));
      set({ domains: get().domains.filter((d) => d.id !== id) });
      useAppStore.getState().setPreview(result.preview);
      toast.success('Domain removed');
      return true;
    } catch (err) {
      toast.error('Could not remove domain', errorMessage(err));
      return false;
    }
  },

  setEnabled: async (id, enabled) => {
    try {
      const result = await unwrap(
        enabled ? window.localBridge.domains.enable(id) : window.localBridge.domains.disable(id),
      );
      set({ domains: get().domains.map((d) => (d.id === id ? result.domain : d)) });
      useAppStore.getState().setPreview(result.preview);
    } catch (err) {
      toast.error(enabled ? 'Could not enable domain' : 'Could not disable domain', errorMessage(err));
    }
  },

  open: async (id) => {
    try {
      await unwrap(window.localBridge.domains.open(id));
    } catch (err) {
      toast.error('Could not open domain', errorMessage(err));
    }
  },
}));
