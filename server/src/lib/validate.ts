import { z } from "zod";
import type { WireBatch } from "../../../shared/types";

const num = z.number().min(-1e6).max(1e7);
const frac = z.number().min(0).max(1);
const flag = z.union([z.literal(0), z.literal(1)]).optional();
const ts = z.number().int().positive();

const click = z.object({
  t: z.literal("click"),
  ts,
  x: num,
  y: num,
  pw: num,
  ph: num,
  vx: num,
  vy: num,
  sel: z.string().min(1).max(600),
  lbl: z.string().max(120),
  ex: frac,
  ey: frac,
  fx: flag,
  rg: flag,
  dd: flag,
  atc: flag,
});
const scroll = z.object({ t: z.literal("scroll"), ts, d: z.union([z.literal(25), z.literal(50), z.literal(75), z.literal(100)]) });
const pageview = z.object({ t: z.literal("pageview"), ts, pw: num, ph: num });

const id = z.string().min(6).max(64).regex(/^[\w-]+$/);
const short = (n: number) => z.string().max(n).optional();

export const batchSchema = z.object({
  v: z.literal(1),
  sid: id,
  vid: id,
  store: z.string().min(1).max(253).regex(/^[a-z0-9.-]+$/i),
  page: z.string().min(1).max(255),
  url: z.string().url().max(1000),
  dev: z.enum(["mobile", "tablet", "desktop"]),
  vw: z.number().int().min(0).max(20000),
  vh: z.number().int().min(0).max(20000),
  src: z.string().min(1).max(60),
  med: short(60),
  cmp: short(100),
  ref: short(253),
  ev: z.array(z.discriminatedUnion("t", [click, scroll, pageview])).min(1).max(100),
});

/**
 * Rewrites Shopify's theme-specific section ids ("#Quantity-template--2867…__main") to the
 * theme-independent form the tracker now emits. Covers batches from cached older trackers.
 */
export function canonicalSelector(sel: string): string {
  return sel.replace(/#([\w-]*?template--)\d+([\w-]*)/g, (_m, pre: string, suf: string) => `[id^="${pre}"]${suf ? `[id$="${suf}"]` : ""}`);
}

export type ParseResult = { ok: true; batch: WireBatch } | { ok: false; error: string };

/**
 * Parse + normalise a raw /api/collect body.
 * - `originHost`: hostname of the request's Origin header; when present it wins over the
 *   claimed `store`, so one store can't write into another store's data.
 * - timestamps outside [now-24h, now+5min] are replaced by the receive time (bad device clocks).
 */
export function parseBatch(raw: unknown, now: number, originHost?: string): ParseResult {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, error: "invalid JSON" };
    }
  }
  const parsed = batchSchema.safeParse(data);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid batch" };
  const b = parsed.data as WireBatch;
  if (originHost && originHost !== b.store) {
    if (!/^(localhost|127\.0\.0\.1)$/.test(originHost)) b.store = originHost.toLowerCase();
  }
  b.store = b.store.toLowerCase();
  b.page = b.page.toLowerCase();
  // The page URL must be on the store's own host (it's what the screenshot worker opens),
  // and query strings / fragments are stripped (no PII in URLs).
  try {
    const u = new URL(b.url);
    if (u.hostname.toLowerCase() !== b.store || !/^https?:$/.test(u.protocol)) return { ok: false, error: "url does not match store" };
    b.url = u.origin + u.pathname;
  } catch {
    return { ok: false, error: "invalid url" };
  }
  for (const e of b.ev) {
    if (e.ts < now - 86_400_000 || e.ts > now + 300_000) e.ts = now;
    if (e.t === "click") e.sel = canonicalSelector(e.sel);
  }
  return { ok: true, batch: b };
}
