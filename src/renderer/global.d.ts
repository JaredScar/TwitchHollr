import type { HollrApi } from '@shared/ipc';

declare global {
  interface Window {
    hollr: HollrApi;
  }
}

export {};
