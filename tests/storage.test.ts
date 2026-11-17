import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStorage } from "../server/src/storage/sqlite";
import type { EventFilter } from "../server/src/storage/types";
import { batch, click } from "./helpers";

let db: SqliteStorage;
const now = Date.now();
const f = (over: Partial<EventFilter> = {}): EventFilter => ({ store: "shop.test", handle: "tee", device: "mobile", from: now - 7 * 864e5, to: now + 60_000, ...over });

beforeEach(() => {
  db = new SqliteStorage(":memory:");
});
afterEach(() => db.close());

describe("SqliteStorage", () => {
  it("auto-creates page + session rows and lists every page (no 1000-row cap)", async () => {
    for (let i = 0; i < 1200; i++) await db.insertEvents(batch([click()], { page: `p-${i}`, url: `https://shop.test/products/p-${i}` }), now);
    const pages = await db.listPages("shop.test");
    expect(pages).toHaveLength(1200);
    expect(pages.find((p) => p.handle === "p-1199")?.clicks).toBe(1);
    expect(await db.listStores()).toEqual(["shop.test"]);
  });

  it("aggregates anchored bins in SQL, only for known selectors", async () => {
    await db.insertEvents(batch([click({ ex: 0.12, ey: 0.9 }), click({ ex: 0.13, ey: 0.91 }), click({ sel: "#other" })]), now);
    const bins = await db.queryBins(f(), ["#atc"], "all");
    expect(bins).toEqual([{ selector: "#atc", gx: 2, gy: 18, n: 2 }]);
    const fb = await db.queryFallbackBins(f(), ["#atc"], "all");
    expect(fb.reduce((s, b) => s + b.n, 0)).toBe(1);
  });

  it("clamps x_in_el = 1 into the last grid cell", async () => {
    await db.insertEvents(batch([click({ ex: 1, ey: 1 })]), now);
    expect((await db.queryBins(f(), ["#atc"], "all"))[0]).toMatchObject({ gx: 19, gy: 19 });
  });

  it("never mixes device buckets", async () => {
    await db.insertEvents(batch([click()], { dev: "desktop", vw: 1440 }), now);
    expect(await db.queryBins(f({ device: "mobile" }), ["#atc"], "all")).toEqual([]);
    expect(await db.queryBins(f({ device: "desktop" }), ["#atc"], "all")).toHaveLength(1);
  });

  it("filters rage/dead kinds, date range and source", async () => {
    await db.insertEvents(batch([click({ rg: 1 }), click({ dd: 1, sel: "#txt" }), click({ ts: now - 30 * 864e5 })]), now);
    await db.insertEvents(batch([click()], { src: "google" }), now);
    expect((await db.queryBins(f(), ["#atc"], "rage"))[0]?.n).toBe(1);
    expect((await db.queryFallbackBins(f(), ["#atc"], "dead"))[0]?.n).toBe(1);
    const all = await db.queryBins(f(), ["#atc"], "all");
    expect(all.reduce((s, b) => s + b.n, 0)).toBe(2); // the 30-day-old click is out of range
    const fb = await db.queryBins(f({ source: "facebook" }), ["#atc"], "all");
    expect(fb.reduce((s, b) => s + b.n, 0)).toBe(1);
  });

  it("computes stats: visitors, ATC rate, scroll funnel, top elements", async () => {
    // session A: pageview, scroll 25/50, ATC click
    await db.insertEvents(
      batch([
        { t: "pageview", ts: now - 5000, pw: 390, ph: 5000 },
        { t: "scroll", ts: now - 4000, d: 25 },
        { t: "scroll", ts: now - 3000, d: 50 },
        click({ atc: 1 }),
      ]),
      now,
    );
    // session B: pageview, image click (label matches nothing), rage
    await db.insertEvents(batch([{ t: "pageview", ts: now - 5000, pw: 390, ph: 5000 }, click({ sel: "#img", lbl: "Photo", rg: 1 })]), now);
    // session C: "Buy it now" label match without atc flag
    await db.insertEvents(batch([click({ sel: "#buy", lbl: "Buy it now" })]), now);

    const s = await db.queryStats(f(), { atcLabels: ["buy it now"], tzOffset: 0 });
    expect(s.clicks).toBe(3);
    expect(s.sessions).toBe(3);
    expect(s.visitors).toBe(3);
    expect(s.atcSessions).toBe(2);
    expect(s.atcRate).toBeCloseTo(2 / 3);
    expect(s.rageClicks).toBe(1);
    expect(s.scroll.find((d) => d.depth === 25)?.sessions).toBe(1);
    expect(s.scroll.find((d) => d.depth === 75)?.sessions).toBe(0);
    expect(s.topElements.map((e) => e.selector).sort()).toEqual(["#atc", "#buy", "#img"]);
    expect(s.frustration[0]?.selector).toBe("#img");
    expect(s.sources[0]).toEqual({ source: "facebook", sessions: 3 });
  });

  it("buckets days in the browser's timezone, not UTC", async () => {
    // 2026-03-10 20:00 UTC = 2026-03-11 01:30 in India (UTC+5:30, getTimezoneOffset() = -330)
    const ts = Date.UTC(2026, 2, 10, 20, 0);
    await db.insertEvents(batch([click({ ts })]), ts);
    const range = { from: Date.UTC(2026, 2, 9), to: Date.UTC(2026, 2, 12) };
    const utc = await db.queryStats(f(range), { atcLabels: [], tzOffset: 0 });
    const ist = await db.queryStats(f({ from: range.from - 330 * -60_000, to: range.to }), { atcLabels: [], tzOffset: -330 });
    expect(utc.perDay.find((d) => d.clicks)?.day).toBe("2026-03-10");
    expect(ist.perDay.find((d) => d.clicks)?.day).toBe("2026-03-11");
  });

  it("versions screenshots per page+device", async () => {
    const base = { store: "shop.test", handle: "tee", device: "mobile" as const, url: "u", path: "s/{version}.jpg", layoutPath: "s/{version}.json", pageWidth: 390, pageHeight: 5000, layoutHash: "a", capturedAt: now, checkedAt: now };
    const v1 = await db.addScreenshot(base);
    const v2 = await db.addScreenshot({ ...base, layoutHash: "b" });
    await db.addScreenshot({ ...base, device: "desktop" });
    expect([v1.version, v2.version, v2.path]).toEqual([1, 2, "s/2.jpg"]);
    expect((await db.getActiveScreenshot("shop.test", "tee", "mobile"))?.layoutHash).toBe("b");
    expect((await db.getActiveScreenshot("shop.test", "tee", "desktop"))?.version).toBe(1);
  });

  it("handles 100k events and still answers with small aggregated results", async () => {
    const evs = Array.from({ length: 100 }, (_, i) => click({ ex: (i % 20) / 20, ey: 0.5 }));
    for (let i = 0; i < 1000; i++) await db.insertEvents(batch(evs), now);
    const t0 = performance.now();
    const bins = await db.queryBins(f(), ["#atc"], "all");
    const ms = performance.now() - t0;
    expect(bins.reduce((s, b) => s + b.n, 0)).toBe(100_000);
    expect(bins.length).toBeLessThanOrEqual(400);
    expect(ms).toBeLessThan(2000);
  });
});
