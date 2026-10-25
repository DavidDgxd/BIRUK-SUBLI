import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

const viewport = (width, height) => ({
  ...devices['Desktop Chrome'],
  viewport: { width, height },
});

/*
 * End-to-end checks run against a fresh production build served by
 * `vite preview`, never a dev server left running, so they see what ships.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.js',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  projects: [
    { name: 'w320', use: viewport(320, 640) },
    { name: 'w360', use: viewport(360, 740) },
    { name: 'w768', use: viewport(768, 1024) },
    { name: 'w1280', use: viewport(1280, 800) },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
