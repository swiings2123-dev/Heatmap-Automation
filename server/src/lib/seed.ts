// Realistic fake traffic for one page (dev only). Uses the active screenshot's
// layout when available so the fake clicks land on real elements.

import type { Device, LayoutElement, LayoutFile, WireBatch, WireClick, WireEvent } from "../../../shared/types";
import type { Storage } from "../storage/types";

export interface SeedOptions {
  store: string;
  handle: string;
  url: string;
  sessions?: number;
  days?: number;
  layouts?: Partial<Record<Device, LayoutFile>>;
  /** deterministic output for tests */
  seed?: number;
}

const DEVICE_MIX: [Device, number][] = [["mobile", 0.78], ["desktop", 0.18], ["tablet", 0.04]];
const SOURCES: [string, number][] = [["facebook", 0.5], ["instagram", 0.25], ["google", 0.12], ["direct", 0.13]];
const SIZES: Record<Device, { vw: number; vh: number; pw: number; ph: number }> = {
  mobile: { vw: 390, vh: 760, pw: 390, ph: 7200 },
  tablet: { vw: 820, vh: 1100, pw: 820, ph: 5200 },
  desktop: { vw: 1440, vh: 860, pw: 1440, ph: 4400 },
};

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

interface Target {
  sel: string;
  lbl: string;
  rect: LayoutElement;
  weight: number;
  atc: boolean;
}

function targetsFrom(layout: LayoutFile | undefined, device: Device): Target[] {
  const size = SIZES[device];
  if (!layout) {
    // No screenshot yet: synthetic targets (these resolve through the fallback path).
    const w = size.pw;
    return [
      { sel: "#seed-atc", lbl: "Add to cart", rect: { x: w * 0.05, y: 1180, w: w * 0.9, h: 48 }, weight: 10, atc: true },
      { sel: "#seed-buy", lbl: "Buy it now", rect: { x: w * 0.05, y: 1240, w: w * 0.9, h: 48 }, weight: 4, atc: true },
      { sel: "#seed-img", lbl: "Product image", rect: { x: 0, y: 80, w, h: w }, weight: 6, atc: false },
      { sel: "#seed-variant-1", lbl: "Small", rect: { x: w * 0.05, y: 1020, w: w * 0.28, h: 44 }, weight: 4, atc: false },
      { sel: "#seed-variant-2", lbl: "Large", rect: { x: w * 0.36, y: 1020, w: w * 0.28, h: 44 }, weight: 3, atc: false },
      { sel: "#seed-reviews", lbl: "Reviews", rect: { x: w * 0.05, y: 2600, w: w * 0.9, h: 60 }, weight: 2, atc: false },
    ];
  }
  const out: Target[] = [];
  for (const [sel, rect] of Object.entries(layout.elements)) {
    const lbl = rect.label || sel;
    const l = lbl.toLowerCase();
    // Visually-hidden radios/checkboxes are clicked through their <label>, never directly.
    if (/^input\[(radio|checkbox)\]/.test(l) || rect.w * rect.h < 300) continue;
    const atc = /add to cart|buy|add to bag/.test(l);
    let weight = 1;
    if (atc) weight = rect.fixed ? 8 : 14;
    else if (/size|colou?r|variant|small|medium|large|\bs\b|\bm\b|\bl\b|xl/.test(l) || sel.includes("label")) weight = 5;
    else if (/img|image|photo|gallery|slide/.test(l + sel)) weight = 4;
    else if (/review|star|faq|detail|summary|description|shipping/.test(l + sel)) weight = 2.5;
    else if (/cart|menu|search|logo/.test(l)) weight = 1.5;
    // Fewer shoppers scroll far: weight decays with depth.
    const depth = rect.fixed ? 0 : rect.y / Math.max(layout.height, 1);
    weight *= Math.max(0.08, 1 - depth * 1.1);
    out.push({ sel, lbl, rect, weight, atc });
  }
  return out;
}

function pick<T>(r: () => number, items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of items) if ((x -= w) <= 0) return v;
  return items[items.length - 1]![0];
}

export async function seedPage(storage: Storage, opts: SeedOptions): Promise<{ sessions: number; events: number }> {
  const r = rng(opts.seed ?? Date.now());
  const sessions = opts.sessions ?? 400;
  const days = opts.days ?? 14;
  const now = Date.now();
  const id = (p: string) => `${p}${Math.floor(r() * 1e12).toString(36)}${Math.floor(r() * 1e12).toString(36)}`;
  const targetsByDevice = new Map<Device, Target[]>();
  let events = 0;

  for (let i = 0; i < sessions; i++) {
    const device = pick(r, DEVICE_MIX);
    const layout = opts.layouts?.[device];
    if (!targetsByDevice.has(device)) targetsByDevice.set(device, targetsFrom(layout, device));
    const targets = targetsByDevice.get(device)!;
    const size = SIZES[device];
    const pw = layout?.width ?? size.pw;
    const ph = layout?.height ?? size.ph;
    // Busier recently, busier in the evening.
    const dayAgo = Math.floor(Math.pow(r(), 1.4) * days);
    const hour = pick(r, [[9, 1], [12, 2], [15, 2], [19, 4], [21, 5], [23, 2]] as [number, number][]);
    let ts = now - dayAgo * 86_400_000 - Math.floor(r() * 3) * 3_600_000;
    const d = new Date(ts);
    d.setHours(hour, Math.floor(r() * 60), Math.floor(r() * 60));
    ts = Math.min(d.getTime(), now - 60_000);

    const ev: WireEvent[] = [{ t: "pageview", ts, pw, ph }];
    let t = ts + 1500;
    for (const [depth, p] of [[25, 0.8], [50, 0.55], [75, 0.35], [100, 0.2]] as const) {
      if (r() > p) break;
      t += 2000 + r() * 8000;
      ev.push({ t: "scroll", ts: Math.round(t), d: depth });
    }

    const clicks = Math.floor(Math.pow(r(), 1.6) * 7);
    const weighted = targets.map((tg) => [tg, tg.weight] as [Target, number]);
    for (let c = 0; c < clicks && weighted.length; c++) {
      const tg = pick(r, weighted);
      const ex = Math.min(0.98, Math.max(0.02, 0.5 + (r() - 0.5) * 0.7));
      const ey = Math.min(0.98, Math.max(0.02, 0.5 + (r() - 0.5) * 0.6));
      const x = tg.rect.x + ex * tg.rect.w;
      const y = tg.rect.y + ey * tg.rect.h;
      t += 1500 + r() * 6000;
      const vy = tg.rect.fixed ? y : Math.min(size.vh - 10, Math.max(10, y % size.vh));
      const click: WireClick = {
        t: "click", ts: Math.round(t), x: Math.round(x), y: Math.round(y), pw, ph, vx: Math.round(x), vy: Math.round(vy),
        sel: tg.sel, lbl: tg.lbl.slice(0, 40), ex: Math.round(ex * 1000) / 1000, ey: Math.round(ey * 1000) / 1000,
      };
      if (tg.rect.fixed) click.fx = 1;
      if (tg.atc) click.atc = 1;
      ev.push(click);
      // ~5% rage-click an image that doesn't zoom.
      if (!tg.atc && r() < 0.05) {
        for (let k = 0; k < 3; k++) {
          t += 180 + r() * 150;
          ev.push({ ...click, ts: Math.round(t), x: click.x + Math.round((r() - 0.5) * 16), y: click.y + Math.round((r() - 0.5) * 16), rg: k >= 1 ? 1 : undefined });
        }
      }
    }
    // ~10% of sessions: dead click on plain text (no selector in layout -> fallback path).
    if (r() < 0.1) {
      t += 2000;
      const y = Math.round(ph * (0.25 + r() * 0.3));
      ev.push({
        t: "click", ts: Math.round(t), x: Math.round(pw * (0.2 + r() * 0.6)), y, pw, ph, vx: Math.round(pw / 2), vy: y % size.vh,
        sel: "main > section:nth-of-type(3) > p", lbl: "Free shipping on prepaid ord", ex: 0.5, ey: 0.5, dd: 1,
      });
    }

    const batch: WireBatch = {
      v: 1, sid: id("s"), vid: id("v"), store: opts.store, page: opts.handle, url: opts.url, dev: device,
      vw: size.vw, vh: size.vh, src: pick(r, SOURCES), med: "paid_social", ev,
    };
    events += await storage.insertEvents(batch, ts);
  }
  return { sessions, events };
}
