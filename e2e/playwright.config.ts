// SPDX-License-Identifier: AGPL-3.0-only
// End-to-end tests against a real server + built web client.
// Run: pnpm build && pnpm e2e
import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 18_080;
const dataDir = mkdtempSync(path.join(tmpdir(), 'ocpc-e2e-'));

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    // Full Chromium (new headless mode): the stripped headless shell lacks media devices.
    channel: 'chromium',
    launchOptions: {
      // Fake camera/microphone so calls can be tested headlessly.
      // mDNS host-candidate obfuscation can't resolve inside the headless sandbox; use raw local IPs.
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--disable-features=WebRtcHideLocalIpsWithMdns',
      ],
    },
    permissions: ['camera', 'microphone'],
  },
  webServer: {
    command: 'node ../apps/server/dist/index.js',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    stdout: process.env.E2E_DEBUG ? 'pipe' : 'ignore',
    env: {
      PORT: String(PORT),
      OCPC_DATA_DIR: dataDir,
      OCPC_PUBLIC_URL: `http://localhost:${PORT}`,
      OCPC_LOG_LEVEL: process.env.E2E_DEBUG ? 'info' : 'warn',
      NODE_ENV: 'test',
      OCPC_STUN_PORT: '13478',
    },
  },
});
