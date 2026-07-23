import { create } from 'zustand';

export interface Toast {
  id: number;
  title: string;
  description?: string;
  variant: 'default' | 'success' | 'warning' | 'error';
}

interface ToastState {
  toasts: Toast[];
  push(toast: Omit<Toast, 'id'>): void;
  dismiss(id: number): void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    const ttl = toast.variant === 'error' ? 9000 : 5000;
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, ttl);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ title, description, variant: 'success' }),
  error: (title: string, description?: string) =>
    useToastStore.getState().push({ title, description, variant: 'error' }),
  warning: (title: string, description?: string) =>
    useToastStore.getState().push({ title, description, variant: 'warning' }),
  info: (title: string, description?: string) =>
    useToastStore.getState().push({ title, description, variant: 'default' }),
};
