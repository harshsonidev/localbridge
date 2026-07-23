import { create } from 'zustand';
import type { TrafficRecord } from '../../shared/types';
import { unwrap, errorMessage } from '../lib/bridge';
import { toast } from './toast.store';

interface TrafficState {
  records: TrafficRecord[];
  selectedId: number | null;
  domainFilter: string;
  methodFilter: string;
  statusFilter: 'all' | '2xx' | '3xx' | '4xx' | '5xx' | 'errors';
  search: string;
  paused: boolean;
  loading: boolean;
  select(id: number | null): void;
  setDomainFilter(domain: string): void;
  setMethodFilter(method: string): void;
  setStatusFilter(status: TrafficState['statusFilter']): void;
  setSearch(search: string): void;
  setPaused(paused: boolean): void;
  load(): Promise<void>;
  clear(): Promise<void>;
}

export const useTrafficStore = create<TrafficState>((set, get) => ({
  records: [],
  selectedId: null,
  domainFilter: 'all',
  methodFilter: 'all',
  statusFilter: 'all',
  search: '',
  paused: false,
  loading: false,

  select: (selectedId) => set({ selectedId }),
  setDomainFilter: (domainFilter) => set({ domainFilter }),
  setMethodFilter: (methodFilter) => set({ methodFilter }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setSearch: (search) => set({ search }),
  setPaused: (paused) => set({ paused }),

  load: async () => {
    if (get().loading || get().paused) return;
    set({ loading: true });
    try {
      const records = await unwrap(window.localBridge.traffic.list(1000));
      set({ records });
    } catch {
      // Silent while polling.
    } finally {
      set({ loading: false });
    }
  },

  clear: async () => {
    try {
      await unwrap(window.localBridge.traffic.clear());
      set({ records: [], selectedId: null });
      toast.success('Traffic cleared');
    } catch (err) {
      toast.error('Could not clear traffic', errorMessage(err));
    }
  },
}));
