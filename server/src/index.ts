import { loadConfig } from "./config";
import { buildApp } from "./app";
import { createStorage } from "./storage";
import { CaptureRunner } from "./worker/runner";

const cfg = loadConfig();
const storage = createStorage(cfg);
const runner = new CaptureRunner(storage, cfg, (m) => console.log(m));
const app = await buildApp({ cfg, storage, runner, logger: true });

await app.listen({ port: cfg.port, host: cfg.host });
console.log(`
  Heatmap collector + dashboard  ->  ${cfg.publicUrl}
  Tracker snippet                ->  <script src="${cfg.publicUrl}/tracker.js" async></script>
  Mode: ${cfg.production ? "production (read APIs need DASHBOARD_TOKEN)" : "development"}${
    cfg.demo ? `\n  Demo product page              ->  ${cfg.publicUrl}/demo/products/demo-product` : ""
  }
`);

// Periodic re-check of every page (new screenshot version only when the layout changed).
if (cfg.autoCapture) {
  const every = Math.max(1, cfg.captureIntervalHours) * 3_600_000;
  const timer = setInterval(() => void runner.checkAll().catch((e) => console.error("[capture:all]", e)), every);
  timer.unref();
  console.log(`  Auto-capture: on (new pages/devices immediately, full re-check every ${cfg.captureIntervalHours}h)
`);
}

const shutdown = async () => {
  await app.close();
  await runner.close();
  await storage.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
