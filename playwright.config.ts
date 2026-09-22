import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4328",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node scripts/prepare-e2e.mjs && node scripts/prepare-standalone.mjs && PALWORLD_MANAGER_DATA_DIR=.e2e-data PSM_ADMIN_TOKEN=e2e-admin HOSTNAME=127.0.0.1 PORT=4328 node dist-standalone/server.js",
    url: "http://127.0.0.1:4328/api/i18n/current",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "browser", testMatch: /browser\/.*\.spec\.ts/ },
    { name: "packaged-electron", testMatch: /electron\/.*\.spec\.ts/ },
  ],
});
