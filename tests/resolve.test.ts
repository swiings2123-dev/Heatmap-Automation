import { describe, expect, it } from "vitest";
import { resolvePoints } from "../server/src/lib/resolve";

const layout = {
  width: 390,
  height: 5000,
  viewport: { w: 390, h: 844 },
  elements: {
    "#atc": { x: 16, y: 1350, w: 358, h: 52 },
    "#sticky": { x: 72, y: 782, w: 302, h: 52, fixed: true },
    "#swatch": { x: 100, y: 1200, w: 30, h: 30 },
  },
};

describe("resolvePoints", () => {
  it("places anchored clicks inside the element's rect for this screenshot", () => {
    const r = resolvePoints([{ selector: "#atc", gx: 10, gy: 10, n: 5 }], [], layout);
    expect(r.anchored).toBe(5);
    expect(r.fallback).toBe(0);
    const [x, y, n] = r.page[0]!;
    // centre of grid cell 10/20 -> 0.525 of the element
    expect(x).toBeCloseTo(16 + 0.525 * 358, 0);
    expect(y).toBeCloseTo(1350 + 0.525 * 52, 0);
    expect(n).toBe(5);
  });

  it("puts fixed elements in viewport coordinates, not on the page", () => {
    const r = resolvePoints([{ selector: "#sticky", gx: 0, gy: 0, n: 2 }], [], layout);
    expect(r.page).toHaveLength(0);
    expect(r.fixed[0]![1]).toBeGreaterThan(782);
    expect(r.fixed[0]![1]).toBeLessThan(834);
  });

  it("falls back to page-relative position scaled to the screenshot, and counts it", () => {
    const r = resolvePoints([], [{ fixed: false, qx: 100, qy: 500, n: 3 }], layout);
    expect(r.fallback).toBe(3);
    expect(r.anchored).toBe(0);
    const [x, y] = r.page[0]!;
    expect(x).toBeCloseTo(0.5025 * 390, 0);
    expect(y).toBeCloseTo(0.5005 * 5000, 0);
  });

  it("maps fixed fallback clicks by viewport fraction", () => {
    const r = resolvePoints([], [{ fixed: true, qx: 100, qy: 950, n: 1 }], layout);
    expect(r.fixed[0]![1]).toBeCloseTo(0.9505 * 844, 0);
  });

  it("merges nearby clicks into one binned point (bounded response size)", () => {
    const bins = Array.from({ length: 20 }, (_, i) => ({ selector: "#swatch", gx: i, gy: 5, n: 1 }));
    const r = resolvePoints(bins, [], layout);
    expect(r.anchored).toBe(20);
    expect(r.page.length).toBeLessThan(20);
    expect(r.page.reduce((s, p) => s + p[2], 0)).toBe(20);
  });

  it("clamps points into the screenshot", () => {
    const r = resolvePoints([], [{ fixed: false, qx: 250, qy: 1200, n: 1 }], layout);
    expect(r.page[0]![0]).toBeLessThanOrEqual(390);
    expect(r.page[0]![1]).toBeLessThanOrEqual(5000);
  });
});
