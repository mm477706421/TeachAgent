import { defineConfig } from "@playwright/test";

const liveURL = process.env.TEACHAGENT_PAGES_URL;
export default defineConfig({
  testDir: "./e2e-pages",
  timeout: 60000,
  use: {
    baseURL: liveURL || "http://127.0.0.1:4173/TeachAgent/",
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: liveURL
    ? undefined
    : {
        command:
          "vite preview --mode pages --host 127.0.0.1 --port 4173 --strictPort",
        url: "http://127.0.0.1:4173/TeachAgent/",
        reuseExistingServer: false,
      },
  reporter: "list",
});
