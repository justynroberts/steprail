// MIT License - Copyright (c) fintonlabs.com
// Browser end-to-end suite (e2e/*.spec.ts). Complements the unit tests
// (vitest, src/**) and server integration tests (node --test, tests/**): this
// layer drives the real built app in Chromium — the browser → API → browser
// round-trip that only a browser can exercise (running a flow, the trace
// waterfall, a plain-language not-connected error rendering on the rail).
//
// Run:  npm run test:e2e   (builds the client, boots an isolated server, drives it)
import { defineConfig, devices } from '@playwright/test'

const PORT = process.env.E2E_PORT || '8455'
const BASE = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // one app instance, one shared store — keep runs ordered
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    // Copy OTLP writes to the clipboard; grant it so the click never throws.
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Serves dist/ + the API on one port. Requires a build — test:e2e runs it first.
    command: 'node e2e/server.mjs',
    url: `${BASE}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PORT,
      NODE_ENV: 'production',
      STEPRAIL_DATA_DIR: 'e2e/.data',
      STEPRAIL_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef', // throwaway, tests only
    },
  },
})
