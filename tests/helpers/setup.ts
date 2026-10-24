import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

// Unmount React trees between tests (only relevant in the jsdom project files).
afterEach(async () => {
  if ('document' in globalThis) (await import('@testing-library/react')).cleanup();
});
