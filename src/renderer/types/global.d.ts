import type { LocalBridgeApi } from '../../shared/types';

declare global {
  interface Window {
    localBridge: LocalBridgeApi;
  }
}

export {};
