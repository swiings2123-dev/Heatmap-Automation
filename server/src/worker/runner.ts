// Serialised capture queue shared by the API (POST /api/capture) and the CLI.
import { randomUUID } from "node:crypto";
import { chromium, type Browser } from "playwright";
import type { Device } from "../../../shared/types";
import type { Config } from "../config";
import type { Storage } from "../storage/types";
import { capturePage, type CaptureResult } from "./capture";

export interface CaptureRequest {
  store: string;
  handle: string;
  url: string;
  devices: Device[];
  force?: boolean;
}

export interface CaptureJobState {
  id: string;
  request: CaptureRequest;
  status: "queued" | "running" | "done" | "error";
  results: CaptureResult[];
  errors: string[];
  createdAt: number;
}

const IDLE_CLOSE_MS = 2 * 60_000;
/** After a failed/started auto-capture, don't try the same page+device again for this long. */
const AUTO_RETRY_MS = 30 * 60_000;

export class CaptureRunner {
  private browser: Promise<Browser> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private idleTimer: NodeJS.Timeout | null = null;
  readonly jobs = new Map<string, CaptureJobState>();
  private readonly autoAttempts = new Map<string, number>();

  constructor(
    private readonly storage: Storage,
    private readonly cfg: Config,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  enqueue(request: CaptureRequest): CaptureJobState {
    const job: CaptureJobState = { id: randomUUID(), request, status: "queued", results: [], errors: [], createdAt: Date.now() };
    this.jobs.set(job.id, job);
    if (this.jobs.size > 200) this.jobs.delete(this.jobs.keys().next().value!);
    this.chain = this.chain.then(() => this.run(job));
    return job;
  }

  /** Enqueue and wait for completion. */
  async capture(request: CaptureRequest): Promise<CaptureJobState> {
    const job = this.enqueue(request);
    await this.chain;
    return job;
  }

  /** Latest job (any status) for a page, used by the dashboard to show progress. */
  latestFor(store: string, handle: string): CaptureJobState | null {
    let found: CaptureJobState | null = null;
    for (const j of this.jobs.values()) if (j.request.store === store && j.request.handle === handle) found = j;
    return found;
  }

  private async getBrowser(): Promise<Browser> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (!this.browser) {
      this.browser = chromium.launch({ headless: true }).catch((e) => {
        this.browser = null;
        throw new Error(`Could not start Chromium (${e.message}). Run: npx playwright install chromium`);
      });
    }
    return this.browser;
  }

  private scheduleIdleClose() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.close(), IDLE_CLOSE_MS);
    this.idleTimer.unref();
  }

  private async run(job: CaptureJobState) {
    job.status = "running";
    try {
      const browser = await this.getBrowser();
      for (const device of job.request.devices) {
        try {
          const res = await capturePage(browser, this.storage, this.cfg, { ...job.request, device });
          job.results.push(res);
          this.log(`[capture] ${job.request.store}/${job.request.handle} ${device}: ${res.status} (v${res.screenshot.version})`);
        } catch (e) {
          const msg = `${device}: ${(e as Error).message.split("\n")[0]}`;
          job.errors.push(msg);
          this.log(`[capture] ${job.request.store}/${job.request.handle} ${msg}`);
        }
      }
      job.status = job.errors.length && !job.results.length ? "error" : "done";
    } catch (e) {
      job.status = "error";
      job.errors.push((e as Error).message);
      this.log(`[capture] ${(e as Error).message}`);
    } finally {
      this.scheduleIdleClose();
    }
  }

  /**
   * Called after every collected batch: if this page has no screenshot for this device yet,
   * queue one. Deduplicated in memory so a busy page triggers one capture, not hundreds.
   */
  async autoCapture(store: string, handle: string, url: string, device: Device): Promise<CaptureJobState | null> {
    const key = `${store}|${handle}|${device}`;
    const last = this.autoAttempts.get(key);
    if (last && Date.now() - last < AUTO_RETRY_MS) return null;
    this.autoAttempts.set(key, Date.now());
    if (await this.storage.getActiveScreenshot(store, handle, device)) return null;
    this.log(`[auto-capture] first ${device} traffic on ${store}/${handle}: queueing screenshot`);
    return this.enqueue({ store, handle, url, devices: [device] });
  }

  /** capture:all — re-check every known page × device; saves a new version only when the layout changed. */
  async checkAll(opts: { force?: boolean; device?: Device } = {}) {
    const pages = await this.storage.listPages();
    let captured = 0;
    let unchanged = 0;
    let failed = 0;
    for (const p of pages) {
      const devices = opts.device ? [opts.device] : await this.devicesFor(p.store, p.handle);
      const job = await this.capture({ store: p.store, handle: p.handle, url: p.url, devices, force: opts.force });
      captured += job.results.filter((r) => r.status === "captured").length;
      unchanged += job.results.filter((r) => r.status === "unchanged").length;
      failed += job.errors.length;
    }
    this.log(`[capture:all] ${pages.length} page(s): ${captured} new version(s), ${unchanged} unchanged, ${failed} failed`);
    return { pages: pages.length, captured, unchanged, failed };
  }

  /** Devices to capture for a page: configured ones + any device that actually has traffic. */
  async devicesFor(store: string, handle: string): Promise<Device[]> {
    const seen = await this.storage.devicesForPage(store, handle);
    const set = new Set<Device>([...this.cfg.captureDevices, ...seen]);
    return (["mobile", "tablet", "desktop"] as const).filter((d) => set.has(d));
  }

  async close() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const b = this.browser;
    this.browser = null;
    if (b) await (await b).close().catch(() => {});
  }
}
