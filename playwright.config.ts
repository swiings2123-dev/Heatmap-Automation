import { defineConfig } from "@playwright/test";
import { rmSync } from "node:fs";

const PORT = 3100;
// Fresh, isolated data dir for every run.
// (The config is re-evaluated in test workers while the server holds the DB: main process only.)
if (!process.env.TEST_WORKER_INDEX) rmSync("data-e2e", { recursive: true, force: true });

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: "npx tsx server/src/index.ts",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { HEATMAP_NO_DOTENV: "1", PORT: String(PORT), PUBLIC_URL: `http://localhost:${PORT}`, DATA_DIR: "data-e2e", NODE_ENV: "development" },
  },
});
