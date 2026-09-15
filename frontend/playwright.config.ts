import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 120000,
  use: {
    baseURL: process.env.TEACHAGENT_TEST_URL || "http://127.0.0.1:8000",
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1100 },
  },
  reporter: "list",
});
