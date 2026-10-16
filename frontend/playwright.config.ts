import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60000,
  outputDir: process.env.MISSION_BROWSER_ARTIFACTS || 'test-results/browser',
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile:
          process.env.MISSION_BROWSER_JSON ||
          'test-results/browser-results.json',
      },
    ],
    [
      'junit',
      {
        outputFile:
          process.env.MISSION_BROWSER_JUNIT || 'test-results/browser-junit.xml',
      },
    ],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'on',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
