// Types shared by the tracker, server and dashboard.

export type Device = "mobile" | "tablet" | "desktop";
export const DEVICES: readonly Device[] = ["mobile", "tablet", "desktop"];

/** Viewport width -> device bucket. Must match the tracker. */
export function deviceFor(width: number): Device {
  return width < 768 ? "mobile" : width < 1024 ? "tablet" : "desktop";
}

// ---------------------------------------------------------------------------
// Wire format: what tracker.js POSTs to /api/collect (one batch per request).
// Session-level context is sent once per batch, not per event.
// ---------------------------------------------------------------------------
export interface WireClick {
  t: "click";
  ts: number; // epoch ms (UTC)
  /** page-relative px (fallback) */
  x: number;
  y: number;
  /** document size at click time */
  pw: number;
  ph: number;
  /** viewport-relative px (used for fixed/sticky elements) */
  vx: number;
  vy: number;
  /** stable CSS selector of the actionable element */
  sel: string;
  /** human label of the actionable element */
  lbl: string;
  /** click offset inside the element, 0..1 */
  ex: number;
  ey: number;
  fx?: 0 | 1; // inside a fixed/sticky ancestor
  rg?: 0 | 1; // rage click
  dd?: 0 | 1; // dead click
  atc?: 0 | 1; // matched an add-to-cart selector in the browser
}
export interface WireScroll {
  t: "scroll";
  ts: number;
  d: 25 | 50 | 75 | 100;
}
export interface WirePageview {
  t: "pageview";
  ts: number;
  pw: number;
  ph: number;
}
export type WireEvent = WireClick | WireScroll | WirePageview;

export interface WireBatch {
  v: 1;
  sid: string; // session id (30 min inactivity)
  vid: string; // visitor id (persistent)
  store: string; // location.hostname
  page: string; // product handle
  url: string; // origin + pathname (no query string)
  dev: Device;
  vw: number;
  vh: number;
  src: string; // utm_source, or inferred (facebook/google/referrer host/direct)
  med?: string; // utm_medium
  cmp?: string; // utm_campaign
  ref?: string; // referrer hostname only
  ev: WireEvent[];
}

// ---------------------------------------------------------------------------
// Layout file written next to every screenshot (<version>.layout.json)
// ---------------------------------------------------------------------------
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface LayoutElement extends Rect {
  fixed?: boolean;
  label?: string;
}
export interface LayoutFile {
  url: string;
  device: Device;
  /** capture viewport (CSS px); fixed elements' rects are relative to it */
  viewport: { w: number; h: number };
  width: number; // CSS px
  height: number; // CSS px
  capturedAt: number;
  hash: string;
  elements: Record<string, LayoutElement>;
}

// ---------------------------------------------------------------------------
// API responses
// ---------------------------------------------------------------------------
export interface PageInfo {
  store: string;
  handle: string;
  url: string;
  firstSeen: number;
  lastSeen: number;
  clicks: number;
}

export interface ScreenshotInfo {
  id: number;
  version: number;
  device: Device;
  imageUrl: string;
  width: number; // CSS px
  height: number; // CSS px
  viewport: { w: number; h: number };
  capturedAt: number;
  checkedAt: number;
}

/** [x, y, count] in screenshot CSS px */
export type HeatPoint = [number, number, number];

/**
 * `page`: document coordinates on the full-page screenshot.
 * `fixed`: clicks on position:fixed elements, in VIEWPORT coordinates of the capture
 * viewport. The dashboard draws these in a layer that floats like the real viewport.
 */
export interface PointSet {
  page: HeatPoint[];
  fixed: HeatPoint[];
}

export interface HotElement {
  selector: string;
  label: string;
  clicks: number;
  sessions: number;
  rect: Rect | null;
  fixed: boolean;
}

export interface HeatmapResponse {
  screenshot: ScreenshotInfo | null;
  clicks: PointSet;
  rage: PointSet;
  dead: PointSet;
  elements: HotElement[];
  total: number;
  anchored: number;
  fallback: number;
  /** anchored / total, 1 when there are no clicks */
  accuracy: number;
}

export interface ElementStat {
  selector: string;
  label: string;
  clicks: number;
  sessions: number;
  /** % of all sessions on the page that clicked this element */
  reach: number;
  /** clicks per clicking session */
  clicksPerSession: number;
  rage: number;
  dead: number;
}

export interface StatsResponse {
  clicks: number;
  sessions: number;
  visitors: number;
  clicksPerVisitor: number;
  rageClicks: number;
  deadClicks: number;
  atcClicks: number;
  atcSessions: number;
  /** sessions with an add-to-cart click / sessions */
  atcRate: number;
  scroll: { depth: 25 | 50 | 75 | 100; sessions: number; pct: number }[];
  topElements: ElementStat[];
  frustration: ElementStat[];
  perDay: { day: string; clicks: number; sessions: number }[];
  sources: { source: string; sessions: number }[];
}
