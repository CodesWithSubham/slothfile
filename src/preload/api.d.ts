import type { SlothFileApi } from '@shared/contracts';

declare global {
  interface Window {
    slothfile: SlothFileApi;
  }
}
export {};
