// Screenshot worker: opens a product page with real device emulation, triggers
// lazy loading, hides popups, measures every known selector (layout.json) and
// takes a full-page JPEG. A new version is stored only when the layout hash changes.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContextOptions } from "playwright";
import type { Device, LayoutFile } from "../../../shared/types";
import type { Config } from "../config";
import { ROOT } from "../config";
import type { ScreenshotRow, Storage } from "../storage/types";
import type { ProbeResult } from "../../../tracker/src/probe";

export const PROFILES: Record<Device, BrowserContextOptions> = {
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  },
  tablet: {
    viewport: { width: 820, height: 1180 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  },
  desktop: {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  },
};

/** Common popups / cookie banners / chat widgets, hidden before the screenshot. */
export const DEFAULT_HIDE_SELECTORS = [
  "#shopify-pc__banner", ".shopify-pc__banner__dialog", "#shopify-chat", "shopify-chat", "inbox-online-store-chat",
  "#onetrust-consent-sdk", "#CybotCookiebotDialog", ".cc-window", "#cookie-banner", ".cookie-banner",
  ".needsclick.kl-private-reset-css-Xuajs1", "[class*='klaviyo-form'][role='dialog']", "#attentive_overlay",
  "#privy-container", "#gorgias-chat-container", "#tidio-chat", "#launcher", "#fc_frame", "#hubspot-messages-iframe-container",
  "iframe[title*='chat' i]", "#wati-widget", ".wa-chat-box", "#whatsapp-chat-widget", ".popup-modal.is-open",
  "#ps__widget_container", ".privy-popup-container", "#smile-ui-container", "[id^='omnisend-form']",
  "#preview-bar-iframe", "#PBarNextFrameWrapper", "#admin-bar-iframe", // Shopify theme preview / admin bars
];

const JPEG_QUALITY = 75;
/** Chromium can't reliably capture images taller than ~16k device px (pages also grow while capturing). */
const MAX_DEVICE_PX = 13_000;

export interface CaptureJob {
  store: string;
  handle: string;
  url: string;
  device: Device;
  force?: boolean;
}

export interface CaptureResult {
  device: Device;
  status: "captured" | "unchanged";
  screenshot: ScreenshotRow;
}

const safe = (s: string) => s.replace(/[^a-z0-9._-]/gi, "_").slice(0, 120);

const r10 = (n: number) => Math.round(n / 10);

export function layoutHash(probe: Pick<ProbeResult, "width" | "height" | "interactive">): string {
  const h = createHash("sha1");
  h.update(`${Math.round(probe.height / 20)}|`);
  const items = probe.interactive
    .filter((i) => i.x >= 0 && i.x < probe.width) // skip off-canvas slides/drawers
    .map((i) => `${i.sel}|${r10(i.x)}|${r10(i.y)}|${r10(i.w)}|${r10(i.h)}`)
    .sort();
  for (const it of items) h.update(it + "\n");
  return h.digest("hex").slice(0, 16);
}

/** Height of a baseline/progressive JPEG (SOF marker). */
export function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1]!;
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

let probeSource: string | null = null;
function probeScript(): string {
  if (!probeSource) {
    const file = path.join(ROOT, "dist", "probe.js");
    if (!existsSync(file)) throw new Error("dist/probe.js missing - run `npm run build:tracker` first");
    probeSource = readFileSync(file, "utf8");
  }
  return probeSource;
}

// Scripts are passed as strings (not functions) so transpiler helpers never leak into the page.
const SCROLL_THROUGH = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = Math.max(200, Math.floor(innerHeight * 0.75));
  for (let i = 0; i < 120; i++) {
    window.scrollBy(0, step);
    await sleep(160);
    if (window.scrollY + innerHeight >= document.documentElement.scrollHeight - 2) break;
  }
  await sleep(400);
  window.scrollTo(0, 0);
})()`;

const SETTLE = `(async () => {
  try { await document.fonts.ready; } catch (e) {}
  const pending = Array.from(document.images).filter((i) => !i.complete);
  await Promise.race([
    Promise.all(pending.map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }))),
    new Promise((r) => setTimeout(r, 6000)),
  ]);
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 500));
})()`;

function hideStyleScript(css: string): string {
  return `(() => {
    const add = () => { const s = document.createElement('style'); s.setAttribute('data-heatmap-capture', ''); s.textContent = ${JSON.stringify(css)}; (document.head || document.documentElement).appendChild(s); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
  })();`;
}

export async function capturePage(browser: Browser, storage: Storage, cfg: Config, job: CaptureJob): Promise<CaptureResult> {
  const hide = [...DEFAULT_HIDE_SELECTORS, ...cfg.hideSelectors];
  const css = `${hide.join(",")}{display:none!important;visibility:hidden!important}`;
  const context = await browser.newContext({ ...PROFILES[job.device], locale: "en-US", serviceWorkers: "block" });
  try {
    // Never let our own capture show up as traffic.
    await context.addInitScript({ content: "window.HEATMAP_OPTOUT = true;" + hideStyleScript(css) });
    const page = await context.newPage();
    await page.goto(job.url, { waitUntil: "load", timeout: 60_000 });
    await page.keyboard.press("Escape").catch(() => {});
    await page.evaluate(SCROLL_THROUGH);
    await page.evaluate(SETTLE);
    await page.keyboard.press("Escape").catch(() => {});

    await page.addScriptTag({ content: probeScript() });
    const selectors = await storage.recentSelectors(job.store, job.handle, job.device, Date.now() - 60 * 86_400_000, 5000);
    const probe = (await page.evaluate(`window.__hmProbe(${JSON.stringify(selectors)})`)) as ProbeResult;
    const hash = layoutHash(probe);

    const active = await storage.getActiveScreenshot(job.store, job.handle, job.device);
    const now = Date.now();
    if (active && active.layoutHash === hash && !job.force && existsSync(path.join(cfg.dataDir, active.path))) {
      await storage.markScreenshotChecked(active.id, now);
      return { device: job.device, status: "unchanged", screenshot: { ...active, checkedAt: now } };
    }

    // Bottom-anchored fixed elements (sticky ATC bars, chat bubbles) would be painted over the
    // first screen and hide what's underneath. They're already measured; the dashboard draws
    // them in a floating layer instead. Top-anchored ones (headers) stay.
    await page.evaluate(`(() => {
      const vh = innerHeight;
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' || cs.display === 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.top > vh * 0.5) el.style.setProperty('visibility', 'hidden', 'important');
      }
    })()`);

    const dpr = PROFILES[job.device].deviceScaleFactor ?? 1;
    let scale: "css" | "device" = probe.height * dpr > MAX_DEVICE_PX ? "css" : "device";
    const shoot = () =>
      page.screenshot({ fullPage: true, type: "jpeg", quality: JPEG_QUALITY, scale, animations: "disabled", caret: "hide" });
    let image: Buffer;
    try {
      image = await shoot();
    } catch (e) {
      // "Unable to capture screenshot": usually the page is too tall at 2x. Retry at 1 px per CSS px.
      if (scale === "css") throw e;
      scale = "css";
      image = await shoot();
    }
    const size = jpegSize(image);
    const pxPerCss = scale === "css" ? 1 : dpr;
    const pageWidth = size ? Math.round(size.width / pxPerCss) : probe.width;
    const pageHeight = size ? Math.round(size.height / pxPerCss) : probe.height;

    const dirRel = path.posix.join("screenshots", safe(job.store), safe(job.handle), job.device);
    const dirAbs = path.join(cfg.dataDir, dirRel);
    mkdirSync(dirAbs, { recursive: true });
    const tmp = path.join(dirAbs, `.tmp-${randomUUID()}`);
    const layout: LayoutFile = {
      url: job.url,
      device: job.device,
      viewport: { w: PROFILES[job.device].viewport!.width, h: PROFILES[job.device].viewport!.height },
      width: pageWidth,
      height: pageHeight,
      capturedAt: now,
      hash,
      elements: probe.elements,
    };
    writeFileSync(`${tmp}.jpg`, image);
    writeFileSync(`${tmp}.json`, JSON.stringify(layout));
    const row = await storage.addScreenshot({
      store: job.store,
      handle: job.handle,
      device: job.device,
      url: job.url,
      path: `${dirRel}/{version}.jpg`,
      layoutPath: `${dirRel}/{version}.layout.json`,
      pageWidth,
      pageHeight,
      layoutHash: hash,
      capturedAt: now,
      checkedAt: now,
    });
    renameSync(`${tmp}.jpg`, path.join(cfg.dataDir, row.path));
    renameSync(`${tmp}.json`, path.join(cfg.dataDir, row.layoutPath));
    return { device: job.device, status: "captured", screenshot: row };
  } finally {
    await context.close();
  }
}
