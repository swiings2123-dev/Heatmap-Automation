// Storage adapter interface. Everything above this layer (routes, worker,
// aggregation) talks only to `Storage`, so SQLite can be swapped for
// Postgres/Supabase by writing one new class that implements it.

import type { Device, PageInfo, StatsResponse, WireBatch } from "../../../shared/types";

export interface EventFilter {
  store: string;
  handle: string;
  device: Device;
  /** epoch ms, inclusive */
  from: number;
  /** epoch ms, exclusive */
  to: number;
  /** first-touch source, e.g. "facebook" */
  source?: string;
}

/** Clicks anchored to an element, grouped into a 20x20 grid inside it. */
export interface AnchoredBin {
  selector: string;
  gx: number; // 0..19
  gy: number; // 0..19
  n: number;
}

/** Clicks whose selector is not in the layout: grouped by page-relative position. */
export interface FallbackBin {
  fixed: boolean;
  /** non-fixed: x / page_w in 1/200ths;  fixed: vx / vw in 1/200ths */
  qx: number;
  /** non-fixed: y / page_h in 1/1000ths; fixed: vy / vh in 1/1000ths */
  qy: number;
  n: number;
}

export type ClickKind = "all" | "rage" | "dead";

export interface ElementCount {
  selector: string;
  label: string;
  clicks: number;
  sessions: number;
}

export interface ScreenshotRow {
  id: number;
  store: string;
  handle: string;
  device: Device;
  version: number;
  url: string;
  path: string; // relative to dataDir
  layoutPath: string; // relative to dataDir
  pageWidth: number; // CSS px
  pageHeight: number; // CSS px
  layoutHash: string;
  capturedAt: number;
  checkedAt: number;
}

export interface StatsOptions {
  atcLabels: string[];
  /** browser's Date#getTimezoneOffset() in minutes, used for day boundaries */
  tzOffset: number;
}

export interface Storage {
  /** Validate-before-call: inserts one tracker batch, upserting page + session rows. Returns events stored. */
  insertEvents(batch: WireBatch, receivedAt: number): Promise<number>;

  listStores(): Promise<string[]>;
  listPages(store?: string): Promise<PageInfo[]>;
  getPage(store: string, handle: string): Promise<PageInfo | null>;
  /** Register a page without events (e.g. captured before any traffic). */
  upsertPage(store: string, handle: string, url: string, at: number): Promise<void>;

  /** Anchored click bins for selectors present in the layout (`knownSelectors`). */
  queryBins(filter: EventFilter, knownSelectors: string[], kind: ClickKind): Promise<AnchoredBin[]>;
  /** Fallback bins for clicks whose selector is NOT in `knownSelectors`. */
  queryFallbackBins(filter: EventFilter, knownSelectors: string[], kind: ClickKind): Promise<FallbackBin[]>;
  /** Clicks per element (for hover tooltips). */
  queryElementCounts(filter: EventFilter, limit: number): Promise<ElementCount[]>;
  queryStats(filter: EventFilter, opts: StatsOptions): Promise<StatsResponse>;
  /** Selectors clicked recently on a page+device (what the layout probe must measure). */
  recentSelectors(store: string, handle: string, device: Device, since: number, limit: number): Promise<string[]>;
  /** Devices that have any events for a page. */
  devicesForPage(store: string, handle: string): Promise<Device[]>;

  addScreenshot(row: Omit<ScreenshotRow, "id" | "version">): Promise<ScreenshotRow>;
  getActiveScreenshot(store: string, handle: string, device: Device): Promise<ScreenshotRow | null>;
  getScreenshot(id: number): Promise<ScreenshotRow | null>;
  markScreenshotChecked(id: number, at: number): Promise<void>;

  close(): Promise<void>;
}
