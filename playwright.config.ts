import { defineConfig } from '@playwright/test';

// Run with a display (on Linux CI: `xvfb-run -a pnpm test:e2e`). Requires `pnpm build` first.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' }
});
