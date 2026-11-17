// npm run capture -- <url> [--device mobile|tablet|desktop] [--force]
// npm run capture:all [-- --force]
// npm run watch            (re-checks every CAPTURE_INTERVAL_HOURS)
import type { Device } from "../../../shared/types";
import { loadConfig } from "../config";
import { createStorage } from "../storage";
import { CaptureRunner } from "./runner";

const cfg = loadConfig();
const storage = createStorage(cfg);
const runner = new CaptureRunner(storage, cfg, (m) => console.log(m));
const args = process.argv.slice(2);
const command = args[0];
const force = args.includes("--force");
const deviceArg = args.includes("--device") ? (args[args.indexOf("--device") + 1] as Device) : undefined;

function pageFromUrl(raw: string): { store: string; handle: string; url: string } {
  const u = new URL(raw);
  const m = u.pathname.match(/\/products\/([^/?#]+)/);
  return {
    store: u.hostname.toLowerCase(),
    handle: m ? decodeURIComponent(m[1]!).toLowerCase() : u.pathname.replace(/\/+$/, "") || "/",
    url: u.origin + u.pathname,
  };
}

async function captureAll(forceAll: boolean) {
  const r = await runner.checkAll({ force: forceAll, device: deviceArg });
  return r.failed;
}

let exitCode = 0;
try {
  if (command === "capture") {
    const target = args.find((a, i) => i > 0 && !a.startsWith("--") && args[i - 1] !== "--device");
    if (!target) throw new Error("usage: npm run capture -- <product-url> [--device mobile] [--force]");
    const page = pageFromUrl(target);
    await storage.upsertPage(page.store, page.handle, page.url, Date.now());
    const devices = deviceArg ? [deviceArg] : await runner.devicesFor(page.store, page.handle);
    // An explicit single-page capture always stores a new version unless the layout is identical.
    // Capture the exact URL given (keeps e.g. ?preview_theme_id=… for an unpublished theme).
    const job = await runner.capture({ ...page, url: target, devices, force });
    for (const r of job.results) console.log(`${r.device}: ${r.status} -> data/${r.screenshot.path}`);
    if (job.errors.length) exitCode = 1;
  } else if (command === "capture-all") {
    exitCode = (await captureAll(force)) ? 1 : 0;
  } else if (command === "watch") {
    const every = cfg.captureIntervalHours * 3_600_000;
    console.log(`[watch] re-checking all pages every ${cfg.captureIntervalHours}h (Ctrl+C to stop)`);
    for (;;) {
      await captureAll(false).catch((e) => console.error(e));
      await runner.close();
      await new Promise((r) => setTimeout(r, every));
    }
  } else {
    throw new Error(`unknown command "${command}" (capture | capture-all | watch)`);
  }
} catch (e) {
  console.error((e as Error).message);
  exitCode = 1;
} finally {
  await runner.close();
  await storage.close();
}
process.exit(exitCode);
