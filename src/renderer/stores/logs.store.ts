import { create } from 'zustand';
import type { LogEntry, LogLevel } from '../../shared/types';
import { unwrap, errorMessage } from '../lib/bridge';
import { toast } from './toast.store';

interface LogsState {
  entries: LogEntry[];
  levelFilter: LogLevel | 'all';
  categoryFilter: string;
  search: string;
  autoRefresh: boolean;
  loading: boolean;
  setLevelFilter(level: LogLevel | 'all'): void;
  setCategoryFilter(category: string): void;
  setSearch(search: string): void;
  setAutoRefresh(on: boolean): void;
  load(): Promise<void>;
  clear(): Promise<void>;
  openDirectory(): Promise<void>;
}

export const useLogsStore = create<LogsState>((set, get) => ({
  entries: [],
  levelFilter: 'all',
  categoryFilter: 'all',
  search: '',
  autoRefresh: true,
  loading: false,

  setLevelFilter: (levelFilter) => set({ levelFilter }),
  setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
  setSearch: (search) => set({ search }),
  setAutoRefresh: (autoRefresh) => set({ autoRefresh }),

  load: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const entries = await unwrap(window.localBridge.logs.list(2000));
      set({ entries });
    } catch {
      // Silent - the page keeps its last snapshot while polling.
    } finally {
      set({ loading: false });
    }
  },

  clear: async () => {
    try {
      await unwrap(window.localBridge.logs.clear());
      set({ entries: [] });
      toast.success('Logs cleared');
    } catch (err) {
      toast.error('Could not clear logs', errorMessage(err));
    }
  },

  openDirectory: async () => {
    try {
      await unwrap(window.localBridge.logs.openDirectory());
    } catch (err) {
      toast.error('Could not open log directory', errorMessage(err));
    }
  },
}));
